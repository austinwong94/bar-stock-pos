import { z } from 'zod';
import { readRequestDraft } from './kitchenRequestDraft';
import { readPendingUsage, readUsageDraft, usageDate } from './dailyUsageDraft';
import { readCountAttempt } from './stockCount';
import { readCountDraft } from './stockCountDraft';
import { readStockOutAttempt } from './stockOut';
import { readStockOutDraft } from './stockOutDraft';
import { readArrivalDraft, readPendingArrival } from './kitchenArrivalDraft';
import { readPendingWater, readWaterDraft, waterKeys } from './waterUsageDraft';
import { deliveryRecoveryPrefix, deliveryRecoveryKey, readDeliveryRecovery } from './deliveryRecovery';
import { paymentRecoveryPrefix, readPaymentRecovery } from './purchasePaymentRecovery';

export type WorkKind = 'request' | 'receipt' | 'payment' | 'delivery' | 'receipt-delivery' | 'usage' | 'count' | 'arrival' | 'water' | 'waste';
export type WorkRow = { key: string; kind: WorkKind; id: string; title: string; date: string; time: string; actor: string; items: number; source: 'device' | 'saved'; state: 'draft' | 'review' | 'uncertain' | 'unreadable'; storageKey?: string; route?: string; requestId?: string };
type Store = Pick<Storage, 'length' | 'key' | 'getItem'>;
type Can = (permission: string) => boolean;
type Client = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{data: unknown; error: unknown}> };
const id = z.string().uuid(), time = z.string().refine(s => Number.isFinite(Date.parse(s)));
const previewId=id.or(z.string().regex(/^(pr-\d+|d-[a-z0-9]{1,20})$/));
const day = z.string().refine(usageDate), name = z.string().max(1000);
const requestSchema = z.object({id,request_no:name,needed_for_date:day,updated_at:time,status:z.literal('draft'),purchase_request_items:z.array(z.unknown()),submitted_by_name:name.nullish()});
const receiptSchema = z.object({id,status:z.literal('pending'),updated_at:time,created_by_name:name,data:z.object({supplier:name,receipt_no:name,purchase_date:z.string(),lines:z.array(z.unknown())}),request_snapshot:z.object({request_no:name}).nullish()});
const deliverySchema = z.object({id,request_id:id,request_no:name,updated_at:time,updated_by_name:name.nullish(),item_count:z.number().int().nonnegative()});
const receiptDeliverySchema = z.object({request:z.object({id,supplier:name,request_no:name,needed_for_date:day}),draft:z.object({id,status:z.literal('draft'),updated_at:time,updated_by_name:name.nullish(),items:z.array(z.unknown())}).nullable()});

export function workRecordId(value: unknown, preview=false) { const r=(preview?previewId:id).safeParse(value);return r.success?r.data:null; }

export async function workPages(read: (offset: number) => PromiseLike<unknown>, recordsKey: string, rowId: (row: unknown) => string) {
  const records: unknown[] = [], seen = new Set<string>(); let total: number | null = null;
  for (let offset = 0; offset < 10000;) {
    const page = z.object({total:z.number().int().min(0).max(10000)}).passthrough().parse(await read(offset));
    const rows = page[recordsKey];
    if (!Array.isArray(rows) || (total !== null && page.total !== total) || records.length + rows.length > page.total) throw Error('Unfinished records changed or are incomplete. Refresh the list.');
    total = page.total;
    for (const row of rows) { const key = rowId(row); if (!key || seen.has(key)) throw Error('Unfinished records changed or are incomplete. Refresh the list.'); seen.add(key); records.push(row); }
    if (records.length === total) return records;
    if (!rows.length) throw Error('Unfinished records are incomplete. Refresh the list.');
    offset += rows.length;
  }
  throw Error('Too many unfinished records. Ask a manager to check the queue.');
}

export async function savedKitchenWork(client: Client, requests: () => Promise<unknown[]>, can: Can, preview=false): Promise<WorkRow[]> {
  const rows: WorkRow[] = [];
  const rpc = async (name: string, args: Record<string, unknown>) => { const r = await client.rpc(name,args); if (r.error) throw r.error; return r.data; };
  if (can('kitchen.request.view')) {
    const records = await requests(), seen = new Set();
    for (const value of records) {
      // Old preview fixtures predate UUID keys and request update timestamps.
      const sample=preview?requestSchema.extend({id:z.string().refine(v=>!!workRecordId(v,true)),updated_at:time.optional(),created_at:time}).parse(value):null;
      const r = sample?{...sample,updated_at:sample.updated_at??sample.created_at}:requestSchema.parse(value);
      if(seen.has(r.id))throw Error('Request drafts changed. Refresh the list.');seen.add(r.id);rows.push({key:'request:'+r.id,kind:'request',id:r.id,title:r.request_no,date:r.needed_for_date,time:r.updated_at,actor:r.submitted_by_name??'',items:r.purchase_request_items.length,source:'saved',state:'draft',route:'/kitchen?request='+encodeURIComponent(r.id)});
    }
  }
  if (can('purchasing.view') && can('purchasing.cost.view')) {
    for (const value of await workPages(offset=>rpc('read_receipt_reviews',{p_status:'pending',p_offset:offset}),'records',r=>receiptSchema.parse(r).id)) { const r=receiptSchema.parse(value);rows.push({key:'receipt:'+r.id,kind:'receipt',id:r.id,title:[r.request_snapshot?.request_no,r.data.supplier,r.data.receipt_no].filter(Boolean).join(' · '),date:usageDate(r.data.purchase_date)?r.data.purchase_date:'',time:r.updated_at,actor:r.created_by_name,items:r.data.lines.length,source:'saved',state:'review',route:'/kitchen/purchases?view=receipts&review='+encodeURIComponent(r.id)}); }
  }
  if (can('purchasing.receive') && can('purchasing.view')) {
    const schema=preview?deliverySchema.extend({id:previewId,request_id:previewId}):deliverySchema;
    for (const value of await workPages(offset=>rpc('read_delivery_drafts',{p_limit:50,p_offset:offset}),'drafts',r=>schema.parse(r).id)) {const r=schema.parse(value);rows.push({key:'delivery:'+r.id,kind:'delivery',id:r.id,title:r.request_no,date:'',time:r.updated_at,actor:r.updated_by_name??'',items:r.item_count,source:'saved',state:'review',route:'/kitchen/stock?view=arrivals&delivery='+encodeURIComponent(r.id)});}
  }
  if (can('purchasing.receive')) {
    for (const value of await workPages(offset=>rpc('read_receipt_deliveries',{p_limit:50,p_offset:offset,p_query:''}),'records',r=>receiptDeliverySchema.parse(r).request.id)) {const r=receiptDeliverySchema.parse(value);if(r.draft)rows.push({key:'receipt-delivery:'+r.draft.id,kind:'receipt-delivery',id:r.request.id,title:[r.request.supplier,r.request.request_no].filter(Boolean).join(' · '),date:r.request.needed_for_date,time:r.draft.updated_at,actor:r.draft.updated_by_name??'',items:r.draft.items.length,source:'saved',state:'review',route:'/kitchen/stock?view=arrivals&receipt='+encodeURIComponent(r.request.id)+'&draft='+encodeURIComponent(r.draft.id)});}
  }
  return rows.map(row=>({...row,time:Number.isFinite(Date.parse(row.time))?row.time:''}));
}

export function deviceKitchenWork(store: Store, actorId: string, actorName: string, project: string | undefined, can: Can): WorkRow[] {
  const rows: WorkRow[] = [];
  if (!actorId) return rows;
  const keys: string[] = []; for(let i=0;i<store.length;i++){const k=store.key(i);if(k)keys.push(k);}
  const base = (key:string,kind:WorkKind,route?:string):WorkRow => ({key:'device:'+key,kind,id:key,title:'',date:'',time:'',actor:actorName,items:0,source:'device',state:'draft',storageKey:key,route});
  function keep(row:WorkRow,read:()=>boolean){try{if(read())rows.push(row);}catch{rows.push({...row,state:'unreadable'});}}
  if(can('purchasing.view')&&can('purchasing.cost.view')&&(can('purchasing.fulfil')||can('purchasing.cost.manage'))){
    const prefix=paymentRecoveryPrefix(project,actorId);
    for(const key of keys.filter(k=>k.startsWith(prefix))){const receiptId=key.slice(prefix.length),row=base(key,'payment','/kitchen/purchases?view=receipts&payment='+encodeURIComponent(receiptId));keep(row,()=>{
      if(!workRecordId(receiptId))throw Error('Invalid payment receipt identity');
      const d=readPaymentRecovery(store.getItem(key),receiptId);if(!d)return false;
      const op=d.operation;Object.assign(row,{id:receiptId,title:op.kind==='record'?'RM '+op.args.p_amount.toFixed(2)+(op.args.p_reference?' · '+op.args.p_reference:''):'',date:op.kind==='record'?op.args.p_paid_on:'',time:d.updatedAt??'',state:'uncertain'});return true;
    });}
  }
  if(can('purchasing.receive')){const prefix=deliveryRecoveryPrefix(project,actorId);for(const key of keys.filter(k=>k.startsWith(prefix))){const row=base(key,'delivery','/kitchen/stock?view=arrivals&deviceDelivery='+encodeURIComponent(key));keep(row,()=>{const d=readDeliveryRecovery(store.getItem(key));if(!d)return false;if(deliveryRecoveryKey(project,actorId,d.receiptSource,d.request.id)!==key)throw Error('Invalid delivery recovery identity');Object.assign(row,{kind:d.receiptSource?'receipt-delivery':'delivery',id:d.draftId,requestId:d.request.id,title:d.request.request_no,date:d.request.needed_for_date,time:d.updatedAt,items:Object.values(d.entries).filter(e=>e.quantity.trim()).length,state:d.operation?'uncertain':d.review?'review':'draft'});return true;});}}
  if(can('kitchen.request.create')){const prefix=`kitchen-request-draft:${project??'review'}:${actorId}:`;for(const key of keys.filter(k=>k.startsWith(prefix))) {const row=base(key,'request','/kitchen?draft='+encodeURIComponent(key));keep(row,()=>{const d=readRequestDraft(store.getItem(key));if(!d)return false;Object.assign(row,{title:d.requestNo,date:d.neededFor,time:d.updatedAt,items:d.items.filter(i=>i.quantity.trim()&&Number(i.quantity)!==0).length,state:d.attempted?'uncertain':'draft',requestId:d.requestId});return true;});}}
  if(can('purchasing.receive')){const key=`kitchen-arrival:${project??'review'}:${actorId}`,row=base(key,'arrival','/kitchen/stock?view=arrivals&resume=unlisted');keep(row,()=>{const p=readPendingArrival(store.getItem(key)),d=readArrivalDraft(store.getItem(key+':draft'));if(!p&&!d)return false;Object.assign(row,{title:p?.record.supplier??d?.supplier,date:p?.record.date??d?.date,time:d?.updatedAt??'',items:p?.record.lines.length??Object.values(d!.entries).filter(e=>e.value.trim()).length,state:p?.attempted?'uncertain':p?'review':'draft'});return true;});}
  if(can('kitchen.stock.count')){const prefix=`kitchen-count:${project??'preview'}:${actorId}`,row=base(prefix,'count','/kitchen/stock?view=count');keep(row,()=>{const p=readCountAttempt(store,prefix),d=readCountDraft(store.getItem(prefix+':draft'));if(!p&&!d)return false;Object.assign(row,{time:p?.createdAt??d?.updatedAt,items:p?.lines.length??Object.values(d!.entries).filter(e=>e.input.trim()).length,state:p?.attempted?'uncertain':p?'review':'draft'});return true;});}
  if(can('kitchen.production.manage')) {
    const prefix=`daily-kitchen-pending:${project??'review'}:${actorId}`;let pendingDate='';
    const row=base(prefix,'usage','/kitchen/stock?view=usage');keep(row,()=>{const p=readPendingUsage(store.getItem(prefix));if(!p)return false;pendingDate=p.record.business_date;Object.assign(row,{date:pendingDate,items:p.record.lines.length,state:p.attempted?'uncertain':'review'});return true;});
    for(const key of keys.filter(k=>k.startsWith(prefix+':draft:'))) {const date=key.slice((prefix+':draft:').length);if(date===pendingDate)continue;const row=base(key,'usage',`/kitchen/stock?view=usage&date=${encodeURIComponent(date)}`);keep(row,()=>{const d=readUsageDraft(store.getItem(key),date);if(!d)return false;Object.assign(row,{date,time:d.updatedAt,items:Object.values(d.entries).filter(e=>e.guest.trim()||e.staff.trim()).length});return true;});}
    const wastePrefix=`kitchen-stock-out:${project??'preview'}:${actorId}`,waste=base(wastePrefix,'waste','/kitchen/stock?view=out');keep(waste,()=>{const p=readStockOutAttempt(store,wastePrefix),d=readStockOutDraft(store.getItem(wastePrefix+':draft'));if(!p&&!d)return false;Object.assign(waste,{time:p?.createdAt??d?.updatedAt,items:p?.lines.length??Object.values(d!.entries).filter(e=>e.input.trim()).length,state:p?.attempted?'uncertain':p?'review':'draft'});return true;});
    const waterBase=`water-usage:${project??'review'}:${actorId}`;
    for(const size of waterKeys){const prefix=waterBase+(size==='snorkelling-mineral-water'?'':':'+size);let pendingDate='';const route=`/kitchen/stock?view=water&size=${encodeURIComponent(size)}`;
      const row=base(prefix,'water',route);row.title=size==='snorkelling-mineral-water'?'':size.endsWith('500ml')?'500 ml':'230 ml';keep(row,()=>{const p=readPendingWater(store.getItem(prefix),size);if(!p)return false;pendingDate=p.record.business_date;Object.assign(row,{date:pendingDate,state:p.attempted?'uncertain':'review'});return true;});
      for(const key of keys.filter(k=>k.startsWith(prefix+':draft:'))){const date=key.slice((prefix+':draft:').length);if(date===pendingDate)continue;const row=base(key,'water',route+'&date='+encodeURIComponent(date));row.title=size==='snorkelling-mineral-water'?'':size.endsWith('500ml')?'500 ml':'230 ml';keep(row,()=>{const d=readWaterDraft(store.getItem(key),date,size);if(!d)return false;Object.assign(row,{date,time:d.updatedAt});return true;});}
    }
  }
  return rows.map(row=>({...row,time:Number.isFinite(Date.parse(row.time))?row.time:''}));
}

export function combineKitchenWork(saved:WorkRow[],device:WorkRow[]) {
  const requestIds=new Set(device.filter(r=>r.kind==='request').map(r=>r.requestId).filter(Boolean));
  const deliveries=new Set(device.filter(r=>r.kind==='delivery'||r.kind==='receipt-delivery').map(r=>r.kind+':'+r.id));
  const rank=(r:WorkRow)=>r.state==='uncertain'||r.state==='unreadable'?0:r.source==='device'?1:2;
  return [...device,...saved.filter(r=>(r.kind!=='request'||!requestIds.has(r.id))&&!deliveries.has(r.kind+':'+(r.kind==='receipt-delivery'?r.key.slice('receipt-delivery:'.length):r.id)))].sort((a,b)=>rank(a)-rank(b)||(a.time||'9999').localeCompare(b.time||'9999')||a.key.localeCompare(b.key));
}
