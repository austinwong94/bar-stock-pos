export type PurchasePayment = {id:string;amount:number;paid_on:string;method:string;reference:string;recorded_by_name:string;created_at:string;void_reason?:string|null};
export type PaymentSummary = {version:number;checked:boolean;paid:number;total:number;payments:PurchasePayment[]};
export function paymentState(receipt:{total_cost:number;payment_checked?:boolean;paid_amount?:number}) {
  if(!receipt.payment_checked)return 'unchecked';
  const paid=Math.round(Number(receipt.paid_amount??0)*100),total=Math.round(Number(receipt.total_cost)*100);
  return paid>=total?'paid':paid>0?'partial':'unpaid';
}
export const paymentLabels:Record<ReturnType<typeof paymentState>,[string,string]>={unchecked:['Payment Not Checked','Bayaran Belum Disemak'],unpaid:['Unpaid','Belum Bayar'],partial:['Part-paid','Bayaran Sebahagian'],paid:['Paid','Sudah Bayar']};
