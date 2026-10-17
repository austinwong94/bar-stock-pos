import { z } from 'zod';
import type { DeliveryDraft, PurchaseRequest } from './platformTypes';
import { fixedDeliveryUnit } from './delivery';
import { sizeToBase, baseToSize, type SizeUnit } from './kitchenUnitBatch';
import type { DeliveryEntry } from './deliveryEntry';

const id = z.string().min(1).max(200), stamp = z.string().refine(v => Number.isFinite(Date.parse(v)));
const measure=z.enum(['kg','g','L','ml']);
const entry = z.object({ quantity:z.string().max(12), ingredientId:z.string().max(200), size:z.string().max(14), pieces:z.string().max(11).optional(),quantity_measure:measure.optional(),quantity_value:z.string().max(40).optional(),size_measure:measure.optional(),size_value:z.string().max(40).optional() }).strict();
const requestSchema = z.object({ id, request_no:z.string().max(1000), needed_for_date:z.string().max(10), purchase_request_items:z.array(z.object({id,item_name:z.string(),unit:z.string()}).passthrough()).max(1000) }).passthrough();
const draftLine = z.object({item_id:id,ingredient_id:id,quantity:z.number().positive().finite(),base_per_unit:z.number().positive().finite().nullable(),measured_pieces:z.number().int().positive().nullable().optional(),expected_updated_at:stamp,expected_received_quantity:z.number().nonnegative().finite(),expected_base_unit:z.enum(['g','ml','unit']),purchase_name:z.string().max(1000),purchase_unit:z.string().max(100),ingredient_name:z.string().max(1000)}).passthrough();
const draftSchema = z.object({id,request_id:id,version:z.number().int().nonnegative(),status:z.enum(['draft','confirmed','cancelled']),updated_at:stamp,items:z.array(draftLine).max(1000)}).passthrough();
const saveArgs = z.object({p_id:z.string().uuid(),p_request_id:id,p_expected_version:z.number().int().nonnegative(),p_operation_id:z.string().uuid(),p_items:z.array(z.object({item_id:id,ingredient_id:id,quantity:z.number().positive().finite(),base_per_unit:z.number().positive().finite().nullable(),measured_pieces:z.number().int().positive().optional(),ingredient_version:stamp,expected_base_unit:z.string(),expected_updated_at:stamp,expected_received_quantity:z.number().nonnegative().finite()}).strict()).min(1).max(1000)}).strict();
const confirmArgs = z.object({p_id:id,p_expected_version:z.number().int().nonnegative()}).strict();
const operationSchema = z.discriminatedUnion('kind',[
  z.object({kind:z.literal('save'),args:saveArgs}).strict(),
  z.object({kind:z.literal('confirm'),args:confirmArgs}).strict(),
  z.object({kind:z.literal('cancel'),args:confirmArgs.extend({p_reason:z.string().trim().min(1).max(300)})}).strict(),
]);
const schema = z.object({version:z.literal(1),receiptSource:z.boolean(),request:requestSchema,draft:draftSchema.nullable(),draftId:id,entries:z.record(id,entry),review:z.boolean(),operation:operationSchema.nullable(),updatedAt:stamp}).strict();
export type DeliveryOperation = z.infer<typeof operationSchema>;
export type DeliveryRecovery = {version:1;receiptSource:boolean;request:PurchaseRequest;draft:DeliveryDraft|null;draftId:string;entries:Record<string,DeliveryEntry>;review:boolean;operation:DeliveryOperation|null;updatedAt:string};
export const deliveryRecoveryPrefix = (project:string|undefined,actor:string) => `delivery-recovery:${project??'review'}:${actor}:`;
export const deliveryRecoveryKey = (project:string|undefined,actor:string,receipt:boolean,requestId:string) => deliveryRecoveryPrefix(project,actor)+(receipt?'receipt:':'request:')+requestId;
export function readDeliveryRecovery(raw:string|null):DeliveryRecovery|null {
  if(raw===null)return null;
  try {
    const d=schema.parse(JSON.parse(raw)), ids=d.request.purchase_request_items.map(r=>r.id);
    if(new Set(ids).size!==ids.length || Object.keys(d.entries).some(k=>!ids.includes(k)) || (d.draft && (d.draft.id!==d.draftId || d.draft.request_id!==d.request.id || new Set(d.draft.items.map(r=>r.item_id)).size!==d.draft.items.length || d.draft.items.some(r=>!ids.includes(r.item_id)))))throw Error();
    for(const [id,e] of Object.entries(d.entries)){
      if(e.quantity_measure!==undefined||e.quantity_value!==undefined){
        const item=d.request.purchase_request_items.find(i=>i.id===id)!,fixed=fixedDeliveryUnit(item.unit);
        if(!fixed||fixed.baseUnit==='unit'||e.quantity_measure===undefined||e.quantity_value===undefined)throw Error();
        const base=sizeToBase(e.quantity_value,e.quantity_measure,fixed.baseUnit),purchaseUnit=(item.unit.toLowerCase()==='l'?'L':item.unit) as SizeUnit;
        const expected=base===null?(e.quantity_value.trim()?'invalid':''):baseToSize(base,purchaseUnit,fixed.baseUnit);
        if(expected!==e.quantity)throw Error();
      }
      if(e.size_measure!==undefined||e.size_value!==undefined){
        if(e.size_measure===undefined||e.size_value===undefined||(sizeToBase(e.size_value,e.size_measure,['kg','g'].includes(e.size_measure)?'g':'ml')??'')!==e.size)throw Error();
      }
    }
    if(d.operation?.args.p_id!==undefined && d.operation.args.p_id!==d.draftId)throw Error();
    if(d.operation?.kind==='save' && (d.operation.args.p_request_id!==d.request.id || new Set(d.operation.args.p_items.map(r=>r.item_id)).size!==d.operation.args.p_items.length || d.operation.args.p_items.some(r=>!ids.includes(r.item_id))))throw Error();
    if(d.operation && d.operation.kind!=='save' && (!d.draft || d.operation.args.p_expected_version!==d.draft.version))throw Error();
    return d as unknown as DeliveryRecovery;
  }catch {throw Error('This delivery recovery could not be read. Ask a manager to check this device.');}
}
export function writeDeliveryRecovery(store:Pick<Storage,'getItem'|'setItem'|'removeItem'>,key:string,next:DeliveryRecovery|null,expected:string|null) {
  if(store.getItem(key)!==expected)throw Error('This delivery changed in another tab. Close and reopen the same delivery.');
  const raw=next?JSON.stringify(next):null;
  if(raw){readDeliveryRecovery(raw);store.setItem(key,raw);}else store.removeItem(key);
  if(store.getItem(key)!==raw)throw Error('Delivery recovery was not saved on this device. Check browser storage and retry.');
  return raw;
}
