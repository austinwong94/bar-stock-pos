import { db, require as requirePermission, currentUserIdRef } from './demoBackend';
import { loadLocalIngredientItems, stockInLocalIngredient, withLocalIngredientRollback } from './localStore';
import { deliveredStockQuantity, deliveryErrorLabels, deliveryLineError } from './delivery';
import { kitchenFactor, kitchenFractional, kitchenName, kitchenUnit } from './kitchenCatalogue';
import { malaysiaDateInputValue } from './format';

type Row = Record<string, any>;
const fail=(message:string,code='P0001'):never=>{throw Object.assign(new Error(message),{code});};
const actor=()=>currentUserIdRef.value!;
const who=()=>db.profiles.find(p=>p.id===actor())?.full_name?.trim()||fail('Your profile needs a staff name.');
function ensure(){db.receipt_delivery_sources??=[];db.receipt_delivery_drafts??=[];db.operation_requests??=[];}
const audit=(id:string,action:string,before:unknown,after:unknown)=>{const event={id:crypto.randomUUID(),actor_id:actor(),action,entity_type:'receipt_delivery',entity_id:id,before_json:structuredClone(before),after_json:structuredClone(after),created_at:new Date().toISOString()};db.audit_logs.push(event);return event;};
const signature=(lines:Row[])=>JSON.stringify(lines.map(l=>({name:l.name,unit:l.unit,quantity:Number(l.quantity)})));

// Only newly confirmed standalone receipts enter receiving. Never backfill old purchases.
export function queueReceiptDelivery(receipt:Row){
  ensure();if(!['guest_meals','staff_meals'].includes(receipt.purpose)||!receipt.lines.length||db.receipt_delivery_sources.some(s=>s.id===receipt.id))return;
  db.receipt_delivery_sources.push({id:receipt.id,supplier:receipt.supplier,reference:receipt.receipt_no,purchase_date:receipt.purchase_date,created_at:receipt.created_at,
    lines:receipt.lines.map((l:Row,index:number)=>({id:crypto.randomUUID(),name:l.name,unit:l.unit,quantity:Number(l.quantity),sort_order:index}))});
}
export function guardReceiptDeliveryChange(id:string,next:Row){
  ensure();const source=db.receipt_delivery_sources.find(s=>s.id===id);if(!source)return;
  if(next.status==='void'){
    if(db.receipt_delivery_drafts.some(d=>d.request_id===id&&d.status==='confirmed'))fail('Items were already received. Ask a manager to reconcile stock before correcting this receipt.');
    return;
  }
  if(!['guest_meals','staff_meals'].includes(next.purpose)||signature(next.lines)!==signature(source.lines))fail('These item quantities were sent to the kitchen. Only costs and categories can be edited here. Void and replace the receipt before receiving to correct items.');
}
function sourceFor(id:string){ensure();return db.receipt_delivery_sources.find(s=>s.id===id)??fail('Receipt delivery not found.');}
function active(id:string){if(!db.expense_receipts.some(r=>r.id===id&&r.status==='confirmed'))fail('This purchase receipt was voided. Do not receive it.','40001');}
function request(id:string){
  const s=sourceFor(id);
  return {id,request_no:s.reference||id.slice(0,8),supplier:s.supplier,origin:'kitchen',needed_for_date:s.purchase_date,status:'completed',created_at:s.created_at,updated_at:s.created_at,
    purchase_request_items:s.lines.map((l:Row)=>({id:l.id,request_id:id,item_name:l.name,unit:l.unit,quantity:l.quantity,purchased_quantity:l.quantity,purchase_status:'bought',supplier:s.supplier,sort_order:l.sort_order,updated_at:s.created_at,
      purchase_receipts:db.receipt_delivery_drafts.filter(d=>d.request_id===id&&d.status==='confirmed').flatMap(d=>d.confirmed_record.receipts).filter(r=>r.purchase_item_id===l.id)}))};
}
function validate(id:string,lines:Row[]):Row[]{
  active(id);const r=request(id),catalogue=loadLocalIngredientItems();
  if(!Array.isArray(lines)||!lines.length||lines.length>200||new Set(lines.map(l=>l.item_id)).size!==lines.length)fail('Review each receipt item once.');
  return lines.map(l=>{
    const p=r.purchase_request_items.find((p:Row)=>p.id===l.item_id),i=catalogue.find(i=>i.id===l.ingredient_id&&i.active&&['Food','Seafood','Condiment'].includes(i.category))??fail('Inventory item changed. Reopen the delivery.','40001');
    const received=p?.purchase_receipts.reduce((n:number,r:Row)=>n+Number(r.purchase_quantity),0)??0;
    if(!p||p.updated_at!==l.expected_updated_at||Math.abs(received-l.expected_received_quantity)>1e-8||!Number.isFinite(l.expected_received_quantity))fail('Another delivery changed. Reopen and check the remaining quantities.','40001');
    if(!i||i.base_unit!==l.expected_base_unit||(l.ingredient_version&&l.ingredient_version!==i.updated_at))fail('Inventory item changed. Reopen the delivery.','40001');
    const problem=deliveryLineError(p.unit,i.base_unit,l.quantity,l.base_per_unit,p.quantity-received,kitchenFractional(i),4,l.measured_pieces);if(problem)fail(deliveryErrorLabels[problem][0]);
    return {...l,purchase_name:p.item_name,purchase_unit:p.unit,ingredient_name:kitchenName(i),ingredient_version:i.updated_at,display_unit:kitchenUnit(i),display_factor:kitchenFactor(i)};
  });
}
export const demoReceiptDeliveryHandlers:Record<string,(a:any)=>any>={
  read_receipt_deliveries:({p_query='',p_limit=10,p_offset=0,p_history=false})=>{
    requirePermission('purchasing.receive');ensure();
    if(!Number.isInteger(p_limit)||p_limit<1||p_limit>50||!Number.isInteger(p_offset)||p_offset<0)fail('Invalid delivery page.');
    const all=db.receipt_delivery_sources.filter(s=>db.expense_receipts.some(r=>r.id===s.id&&r.status==='confirmed')).map(s=>request(s.id)).filter(r=>{
      const outstanding=r.purchase_request_items.some((i:Row)=>i.quantity-i.purchase_receipts.reduce((n:number,r:Row)=>n+r.purchase_quantity,0)>0.00001);
      return (p_history?!outstanding:outstanding)&&JSON.stringify([r.supplier,r.request_no,r.purchase_request_items.map((i:Row)=>i.item_name)]).toLowerCase().includes(p_query.trim().toLowerCase());
    }).sort((a,b)=>p_history?b.created_at.localeCompare(a.created_at):a.created_at.localeCompare(b.created_at));
    return structuredClone({total:all.length,records:all.slice(p_offset,p_offset+p_limit).map(r=>({request:r,draft:db.receipt_delivery_drafts.find(d=>d.request_id===r.id&&d.status==='draft')??null}))});
  },
  read_receipt_delivery:({p_request_id})=>{requirePermission('purchasing.receive');return structuredClone({request:request(p_request_id),draft:db.receipt_delivery_drafts.find(d=>d.request_id===p_request_id&&d.status==='draft')??null});},
  save_receipt_delivery_draft:args=>{
    requirePermission('purchasing.receive');ensure();if(!args.p_id||!args.p_operation_id)fail('Submission reference required.');
    const payload=JSON.stringify(args),oldOp=db.operation_requests.find(o=>o.actor_id===actor()&&o.operation==='receipt_delivery_save'&&o.request_id===args.p_operation_id);
    if(oldOp){if(oldOp.payload!==payload)fail('This submission has different details.');return structuredClone(db.audit_logs.find(e=>e.id===oldOp.result_id)!.after_json);}
    const old=db.receipt_delivery_drafts.find(d=>d.id===args.p_id);
    if(old?(old.request_id!==args.p_request_id||old.status!=='draft'||old.version!==args.p_expected_version):args.p_expected_version!==0)fail('Draft changed. Reopen it.','40001');
    if(db.receipt_delivery_drafts.some(d=>d.request_id===args.p_request_id&&d.status==='draft'&&d.id!==args.p_id))fail('A saved delivery already exists for this receipt. Open it from Items Arrived.','40001');
    const items=validate(args.p_request_id,args.p_items),stamp=new Date().toISOString(),name=who();
    const next:Row={...(old??{id:args.p_id,request_id:args.p_request_id,request_no:request(args.p_request_id).request_no,status:'draft',created_by:actor(),created_by_name:name,created_at:stamp,confirmed_record:null,cancelled_reason:null}),items,version:(old?.version??0)+1,updated_by:actor(),updated_by_name:name,updated_at:stamp};
    const event=audit(next.id,'receipt_delivery_saved',old??null,next);if(old)Object.assign(old,next);else db.receipt_delivery_drafts.push(next);
    db.operation_requests.push({actor_id:actor(),operation:'receipt_delivery_save',request_id:args.p_operation_id,payload,result_id:event.id});return structuredClone(next);
  },
  confirm_receipt_delivery_draft:({p_id,p_expected_version})=>{
    requirePermission('purchasing.receive');ensure();const d=db.receipt_delivery_drafts.find(d=>d.id===p_id)??fail('Draft not found.');
    if(d.status==='confirmed'){if(d.version!==p_expected_version+1)fail('Draft changed.','40001');return structuredClone(d.confirmed_record);}
    if(d.status!=='draft'||d.version!==p_expected_version)fail('Draft changed. Reopen it.','40001');
    const lines=validate(d.request_id,d.items),s=sourceFor(d.request_id),name=who(),stamp=new Date().toISOString(),before=structuredClone(d);
    const receipts=lines.map(l=>({id:crypto.randomUUID(),purchase_item_id:l.item_id,ingredient_id:l.ingredient_id,purchase_quantity:l.quantity,base_quantity:deliveredStockQuantity(l as any),base_unit:l.expected_base_unit,received_by:actor(),received_at:stamp,ingredient_name:l.ingredient_name,purchase_unit:l.purchase_unit,base_per_unit:l.base_per_unit,measured_pieces:l.measured_pieces,received_by_name:name,display_unit:l.display_unit,display_factor:l.display_factor,details_backfilled:false}));
    withLocalIngredientRollback(()=>{for(const r of receipts)stockInLocalIngredient({ingredientId:r.ingredient_id,inputQuantity:r.base_quantity,unitType:'base',enteredBy:name,notes:`Receipt ${s.reference} | ${s.supplier} | Delivery ${d.id}`});});
    const result={id:d.id,request_id:d.request_id,request_no:d.request_no,confirmed_at:stamp,confirmed_by:actor(),confirmed_by_name:name,receipts};
    db.kitchen_arrivals??=[];db.kitchen_arrivals.push({id:d.id,date:malaysiaDateInputValue(new Date()),supplier:s.supplier,reference:s.reference,receipt_id:s.id,created_by:actor(),created_by_name:name,created_at:stamp,lines:receipts.map(r=>({ingredient_id:r.ingredient_id,name:r.ingredient_name,quantity:r.base_quantity,unit:r.base_unit,entered_quantity:r.display_factor?r.base_quantity/r.display_factor:r.base_quantity,display_unit:r.display_factor?r.display_unit:r.base_unit}))});
    Object.assign(d,{status:'confirmed',confirmed_record:result,version:d.version+1,updated_at:stamp,updated_by:actor(),updated_by_name:name});audit(d.id,'receipt_delivery_confirmed',before,d);return structuredClone(result);
  },
  cancel_receipt_delivery_draft:({p_id,p_expected_version,p_reason})=>{
    requirePermission('purchasing.receive');ensure();const d=db.receipt_delivery_drafts.find(d=>d.id===p_id)??fail('Draft not found.');
    if(!p_reason?.trim()||p_reason.length>300)fail('Enter a cancellation reason.');
    if(d.status==='cancelled'&&d.cancelled_reason===p_reason.trim())return null;
    if(d.status!=='draft'||d.version!==p_expected_version)fail('Draft changed. Reopen it.','40001');
    const before=structuredClone(d);Object.assign(d,{status:'cancelled',cancelled_reason:p_reason.trim(),version:d.version+1,updated_at:new Date().toISOString(),updated_by:actor(),updated_by_name:who()});audit(d.id,'receipt_delivery_cancelled',before,d);return null;
  },
};
