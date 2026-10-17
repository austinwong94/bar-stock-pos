import { addDays, format, parseISO } from 'date-fns';
import { paymentState } from './purchasePayments';
import { receiptBreakdown, type ExpenseReceipt, type ReceiptLine, type SupplyData } from './supplyWorkflow';
import type { WaterUsage } from './financeExport';

export type PurchaseFocus = {kind:'receipts';check?:'unchecked'|'unpaid'|'breakdown';purpose?:string;supplier?:string;category?:string;query?:string;item?:{name:string;category:string;unit:string}};
export type UsageFocus = {kind:'usage';side?:'guest'|'staff';ingredient?:{id:string;unit:string;display?:string;factor?:number|null}};
export type FinanceFocus = PurchaseFocus | UsageFocus;
const normal = (s:string) => s.trim().toLocaleLowerCase();
export function receiptCheck(r:ExpenseReceipt) {
  return {unchecked:paymentState(r)==='unchecked',unpaid:r.payment_checked===true&&Math.round((r.total_cost-(r.paid_amount??0))*100)>0,breakdown:!r.lines.length||receiptBreakdown(r).difference!==0};
}
export function inspectPurchases(data:SupplyData,start:string,end:string,focus:PurchaseFocus) {
  const detailed=!!focus.item||(focus.category??'all')!=='all'||!!focus.query?.trim();
  const matches=(l:ReceiptLine)=>((focus.category??'all')==='all'||l.category===focus.category)&&normal(l.name).includes(normal(focus.query??''))&&(!focus.item||(normal(l.name)===normal(focus.item.name)&&l.category===focus.item.category&&l.unit===focus.item.unit));
  const records=data.receipts.filter(r=>r.status==='confirmed'&&r.purchase_date>=start&&r.purchase_date<=end&&((focus.purpose??'all')==='all'||r.purpose===focus.purpose)&&((focus.supplier??'all')==='all'||normal(r.supplier)===normal(focus.supplier!))&&(!focus.check||receiptCheck(r)[focus.check])&&(!detailed||r.lines.some(matches)))
    .map(receipt=>({receipt,lines:receipt.lines.filter(matches),amount:detailed?Math.round(receipt.lines.filter(matches).reduce((sum,l)=>sum+l.amount,0)*100)/100:receipt.total_cost}))
    .sort((a,b)=>b.receipt.purchase_date.localeCompare(a.receipt.purchase_date)||a.receipt.supplier.localeCompare(b.receipt.supplier)||a.receipt.id.localeCompare(b.receipt.id));
  return {records,detailed,total:records.reduce((sum,r)=>sum+Math.round(r.amount*100),0)/100,outstanding:records.filter(r=>r.receipt.payment_checked).reduce((sum,r)=>sum+Math.round((r.receipt.total_cost-(r.receipt.paid_amount??0))*100),0)/100};
}
export function inspectUsage(data:SupplyData,start:string,end:string,focus:UsageFocus) {
  const matches=(l:SupplyData['usage'][number]['lines'][number])=>!focus.ingredient||(l.ingredient_id===focus.ingredient.id&&l.unit===focus.ingredient.unit&&l.display_unit===focus.ingredient.display&&l.display_factor===focus.ingredient.factor);
  return data.usage.filter(d=>d.business_date>=start&&d.business_date<=end)
    .map(record=>({record,lines:record.lines.filter(matches)})).filter(d=>!focus.ingredient||d.lines.length)
    .sort((a,b)=>b.record.business_date.localeCompare(a.record.business_date));
}
export function usageCost(lines:SupplyData['usage'][number]['lines'],side:'guest'|'staff') {
  const quantity=side==='guest'?'guest_quantity':'staff_quantity';
  if(lines.some(l=>l[quantity]>0&&l.unit_cost==null))return null;
  return lines.reduce((sum,l)=>sum+l[quantity]*(l.unit_cost??0),0);
}
export function usageDisplayRate(line:SupplyData['usage'][number]['lines'][number]) {
  return line.unit_cost==null?null:line.unit_cost*(line.display_factor??(line.unit==='g'?1000:1));
}
export function financeCoverage(data:SupplyData,water:WaterUsage[],start:string,end:string,today:string) {
  const valid=(d:string)=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
  if(!valid(start)||!valid(end)||!valid(today)||start>end)throw Error('Invalid finance coverage period.');
  const rows:{date:string;usage:SupplyData['usage'][number]|null;water:WaterUsage|null;state:'past'|'today'|'future'}[]=[];
  for(let date=start;date<=end;date=format(addDays(parseISO(date),1),'yyyy-MM-dd')){
    if(rows.length>=366||!/^\d{4}-\d{2}-\d{2}$/.test(date)||format(parseISO(date),'yyyy-MM-dd')!==date)throw Error('Invalid finance coverage period.');
    rows.push({date,usage:data.usage.find(d=>d.business_date===date)??null,water:water.find(d=>d.business_date===date)??null,state:date<today?'past':date===today?'today':'future'});
  }
  return rows;
}
