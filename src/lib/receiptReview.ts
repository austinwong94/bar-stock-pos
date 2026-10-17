import { z } from 'zod';
import { expenseCategories, purchasePurposes, type ExpenseReceipt } from './supplyWorkflow';
import { moneyCents } from './purchaseReceiptMath';
import type { PurchaseDraftRequest } from './purchaseDraft';

const text = (max: number) => z.string().max(max);
const photo = z.object({path:text(1000),hash:z.string().regex(/^[a-f0-9]{64}$/)}).nullable();
export const receiptLineSchema = z.object({id:z.string().uuid(),name:text(120),category:z.enum(expenseCategories),quantity:text(40),unit:text(40),amount:text(40)});
export const receiptDataSchema = z.object({
  purpose:z.enum(['',...purchasePurposes]),supplier:text(160),address:text(1000),tax_id:text(120),phone:text(100),receipt_no:text(120),
  purchase_date:text(10),currency:text(10),total_cost:text(40),subtotal:text(40),tax:text(40),discount:text(40),
  receipt:photo,items:photo,lines:z.array(receiptLineSchema).max(200),notes:text(2000),review_note:text(2000),
  request_entries:z.record(z.object({quantity:text(40),cost:text(40)})).optional(),
});
export type ReceiptData = z.infer<typeof receiptDataSchema>;
// JSONB changes object key order. Incomplete form values must remain comparable too.
export function sameReceiptData(a:unknown,b:unknown):boolean {
  if(a===b)return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
  if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>sameReceiptData(v,b[i]));
  const left=a as Record<string,unknown>,right=b as Record<string,unknown>,keys=Object.keys(left);
  return keys.length===Object.keys(right).length&&keys.every(k=>Object.prototype.hasOwnProperty.call(right,k)&&sameReceiptData(left[k],right[k]));
}
export type ReviewLine = ReceiptData['lines'][number];
export type ReceiptExtraction = {
  supplier:string|null;address:string|null;tax_id:string|null;phone:string|null;date:string|null;receipt_no:string|null;currency:string|null;
  subtotal:number|null;tax:number|null;discount:number|null;total:number|null;
  items:{description:string;quantity:number|null;unit:string|null;unit_price:number|null;amount:number|null}[];
  unreadable:{location:string;visible_text:string;reason:string}[];warnings:string[];
};
export type ReceiptReview = {
  id:string;data:ReceiptData;version:number;status:'pending'|'confirmed'|'deleted';created_by:string;created_by_name:string;created_at:string;updated_at:string;
  scan_status:'idle'|'scanning'|'complete'|'failed';scan_error:string|null;extraction:ReceiptExtraction|null;model:string|null;result_id:string|null;
  deleted_at:string|null;delete_reason:string|null;confirmed_at:string|null;
  request_id?:string|null;request_snapshot?:PurchaseDraftRequest|null;purchase_result?:ExpenseReceipt|null;
};
export type ReceiptEvent = {id:string;action:string;actor_name:string;created_at:string;before_json:unknown;after_json:unknown};
export type SupplierProfile = {id:string;name:string;address:string;tax_id:string;phone:string;version:number};
export type ReceiptAISettings = {enabled:boolean;daily_limit:number;model:string;version:number};
export const receiptUnits=['kg','g','L','ml','pcs','biji','ekor','pack','bag','gelen','botol','bottle','tin','cylinder','carton'];
export function receiptUnit(value:string|null){const unit=(value??'').trim();return receiptUnits.find(u=>u.toLowerCase()===unit.toLowerCase())??unit;}
export const blankReceiptLine=():ReviewLine=>({id:crypto.randomUUID(),name:'',category:'Other',quantity:'',unit:'',amount:''});
export const blankReceiptData=():ReceiptData=>({purpose:'',supplier:'',address:'',tax_id:'',phone:'',receipt_no:'',purchase_date:'',currency:'MYR',total_cost:'',subtotal:'',tax:'',discount:'',receipt:null,items:null,lines:[],notes:'',review_note:''});
export const reviewTime=(stamp:string,language='en')=>new Intl.DateTimeFormat(language==='ms'?'ms-MY':'en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kuala_Lumpur'}).format(new Date(stamp))+' MYT';
export function receiptLineProblem(line:ReviewLine):'name'|'quantity'|'unit'|'amount'|null {
  if(!line.name.trim())return 'name';
  if(!/^\d+(\.\d{1,4})?$/.test(line.quantity)||Number(line.quantity)<=0||Number(line.quantity)>1e9)return 'quantity';
  if(!receiptUnits.includes(line.unit))return 'unit';
  return moneyCents(line.amount)===null?'amount':null;
}
export function receiptProblems(d:ReceiptData,today:string) {
  const issues:string[]=[];
  if(!d.purpose)issues.push('purpose');if(!d.supplier.trim())issues.push('supplier');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d.purchase_date)||!Number.isFinite(Date.parse(d.purchase_date))||new Date(d.purchase_date).toISOString().slice(0,10)!==d.purchase_date||d.purchase_date>today)issues.push('date');
  if(d.currency!=='MYR')issues.push('currency');if(moneyCents(d.total_cost)===null)issues.push('total');
  if(!d.receipt||!d.items||d.receipt.hash===d.items.hash)issues.push('photos');
  if(d.lines.some(receiptLineProblem))issues.push('items');
  if(['subtotal','tax','discount'].some(k=>d[k as 'tax'].trim()&&moneyCents(d[k as 'tax'])===null))issues.push('tax');
  return issues;
}
export function receiptGaps(d:ReceiptData):string[] {
  return [...(!d.receipt_no.trim()?['Receipt Number']:[]),...(!d.address.trim()?['Supplier Address']:[]),...(!d.tax_id.trim()?['Tax / Registration ID']:[]),...(!d.lines.length?['Item Breakdown']:[])];
}
export function receiptReconciliation(d:ReceiptData) {
  const total=moneyCents(d.total_cost);if(total===null||!d.lines.length||d.lines.some(l=>moneyCents(l.amount)===null))return null;
  return (total-d.lines.reduce((n,l)=>n+moneyCents(l.amount)!,0)-(moneyCents(d.tax)||0)+(moneyCents(d.discount)||0))/100;
}
// Only empty fields are filled. The full extraction remains separate for accounting comparison.
export function applyReceiptExtraction(d:ReceiptData,s:ReceiptExtraction):ReceiptData {
  const value=(n:number|null)=>n===null?'':String(n);
  const next={...d};
  for(const key of ['supplier','address','tax_id','phone','receipt_no'] as const)if(!next[key].trim())next[key]=(s[key]??'').slice(0,key==='address'?1000:key==='supplier'?160:key==='phone'?100:120);
  if(!next.purchase_date)next.purchase_date=s.date??'';
  next.currency=(s.currency??'').slice(0,10);
  for(const [field,source] of [['total_cost','total'],['subtotal','subtotal'],['tax','tax'],['discount','discount']] as const)if(!next[field].trim())next[field]=value(s[source]);
  if(!next.lines.length)next.lines=s.items.slice(0,200).map(l=>({...blankReceiptLine(),name:l.description.slice(0,120),quantity:value(l.quantity),unit:receiptUnit(l.unit).slice(0,40),amount:value(l.amount)}));
  return next;
}
export function receiptPayload(d:ReceiptData):Omit<ExpenseReceipt,'id'|'status'|'created_at'|'created_by'|'created_by_name'> {
  return {purchase_date:d.purchase_date,purpose:d.purpose as ExpenseReceipt['purpose'],supplier:d.supplier.trim(),receipt_no:d.receipt_no.trim(),
    total_cost:Number(d.total_cost),receipt_path:d.receipt!.path,receipt_hash:d.receipt!.hash,items_path:d.items!.path,items_hash:d.items!.hash,
    lines:d.lines.map(l=>({name:l.name.trim(),category:l.category,quantity:Number(l.quantity),unit:l.unit,amount:Number(l.amount)})),notes:d.notes};
}
