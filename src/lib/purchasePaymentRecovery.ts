import { z } from 'zod';
import { usageDate } from './dailyUsageDraft';
import type { PaymentSummary } from './purchasePayments';

const id=z.string().min(1).max(200),day=z.string().refine(usageDate),stamp=z.string().refine(v=>Number.isFinite(Date.parse(v)));
const money=z.number().finite().min(0).max(99999999.99).refine(v=>Math.abs(v*100-Math.round(v*100))<1e-6);
const recordArgs=z.object({p_receipt_id:id,p_amount:money,p_paid_on:day,p_method:z.enum(['unpaid','bank','qr','cash']),p_reference:z.string().max(200),p_expected_version:z.number().int().nonnegative(),p_operation_id:z.string().uuid()}).strict().refine(p=>(p.p_amount===0)===(p.p_method==='unpaid'));
const reverseArgs=z.object({p_id:id,p_reason:z.string().trim().min(1).max(500),p_expected_version:z.number().int().nonnegative()}).strict();
const operation=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('record'),args:recordArgs}).strict(),
  z.object({kind:z.literal('reverse'),args:reverseArgs}).strict(),
]);
const schema=z.object({version:z.literal(1),receiptId:id,operation,updatedAt:stamp}).strict();
export type PaymentOperation=z.infer<typeof operation>;
export type PaymentRecovery=Omit<z.infer<typeof schema>,'updatedAt'>&{updatedAt:string|null};
export const paymentRecoveryPrefix=(project:string|undefined,actor:string)=>`purchase-payment:${project??'review'}:${actor}:`;
export const paymentRecoveryKey=(project:string|undefined,actor:string,receipt:string)=>paymentRecoveryPrefix(project,actor)+receipt;
export function readPaymentRecovery(raw:string|null,receiptId:string):PaymentRecovery|null {
  if(raw===null)return null;
  try {
    const value=JSON.parse(raw);
    // Earlier releases stored bare RPC arguments. Preserve their exact identity and payload.
    const d=value?.p_operation_id?{version:1 as const,receiptId,operation:{kind:'record' as const,args:recordArgs.parse(value)},updatedAt:null}:schema.parse(value);
    if(d.receiptId!==receiptId||(d.operation.kind==='record'&&d.operation.args.p_receipt_id!==receiptId))throw Error();
    return d;
  }catch{throw Error('This payment recovery could not be read. Keep this device and ask a manager to check it.');}
}
export function writePaymentRecovery(store:Pick<Storage,'getItem'|'setItem'|'removeItem'>,key:string,next:PaymentRecovery|null,expected:string|null){
  if(store.getItem(key)!==expected)throw Error('This payment changed in another tab. Close and reopen the receipt.');
  const raw=next?JSON.stringify(next):null;
  if(next){schema.parse(next);readPaymentRecovery(raw,next.receiptId);store.setItem(key,raw!);}else store.removeItem(key);
  if(store.getItem(key)!==raw)throw Error('Payment recovery could not be saved on this device. Close and reopen the receipt before continuing.');
  return raw;
}
const payment=z.object({id,receipt_id:id,amount:money,paid_on:day,method:z.enum(['unpaid','bank','qr','cash']),reference:z.string().max(200),recorded_by_name:z.string().min(1),created_at:stamp,void_reason:z.string().min(1).nullish()}).passthrough().refine(p=>(p.amount===0)===(p.method==='unpaid'));
const summary=z.object({version:z.number().int().nonnegative(),checked:z.boolean(),paid:money,total:money,payments:z.array(payment)});
export function readPaymentSummary(value:unknown,receiptId:string):PaymentSummary {
  try {
    const d=summary.parse(value),active=d.payments.filter(p=>!p.void_reason);
    if(new Set(d.payments.map(p=>p.id)).size!==d.payments.length||d.payments.some(p=>p.receipt_id!==receiptId)||d.version<d.payments.length||d.checked!==(active.length>0)||Math.round(d.paid*100)!==active.reduce((n,p)=>n+Math.round(p.amount*100),0)||d.paid>d.total)throw Error();
    return d;
  }catch{throw Error('Payment records are incomplete. Refresh before recording a payment.');}
}
export function paymentConfirmed(d:PaymentSummary,op:PaymentOperation){
  if(d.version<=op.args.p_expected_version)return false;
  if(op.kind==='reverse')return d.payments.some(p=>p.id===op.args.p_id&&p.void_reason===op.args.p_reason);
  const a=op.args;
  return d.payments.some(p=>p.amount===a.p_amount&&p.paid_on===a.p_paid_on&&p.method===a.p_method&&p.reference===a.p_reference.trim());
}
