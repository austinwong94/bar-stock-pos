import { useLanguage } from '../../lib/language';
import { expenseSummary, type SupplyData } from '../../lib/supplyWorkflow';
import { paymentState } from '../../lib/purchasePayments';
import { ChevronRight } from 'lucide-react';
import type { FinanceFocus } from '../../lib/financeInspection';

const rm=(value:number)=>'RM '+value.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2});
const amount=(value:number)=>value.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2});
export default function FinanceOverview({data,period,onOpen}:{data:SupplyData;period:{start:string;end:string;previousStart:string;previousEnd:string};onOpen:(focus:FinanceFocus)=>void}){
  const {text:t}=useLanguage();
  const now=expenseSummary(data,period.start,period.end),before=expenseSummary(data,period.previousStart,period.previousEnd);
  const spend=(purpose:string,previous=false)=>expenseSummary(data,previous?period.previousStart:period.start,previous?period.previousEnd:period.end,purpose).total;
  const meal=(summary:typeof now,key:'guest'|'staff')=>{
    const count=key==='guest'?summary.meals.guest_meals:summary.meals.staff_meals;
    const missing=key==='guest'?summary.meals.guest_unpriced:summary.meals.staff_unpriced;
    const cost=key==='guest'?summary.meals.guest_cost:summary.meals.staff_cost;
    return !summary.usage.length||missing||!count?null:cost/count;
  };
  const guest=meal(now,'guest'),staff=meal(now,'staff'),oldGuest=meal(before,'guest'),oldStaff=meal(before,'staff');
  const rows:[string,number|null,number|null,boolean,FinanceFocus][]=[
    [t('Guest Purchases','Belian Tetamu'),spend('guest_meals'),spend('guest_meals',true),true,{kind:'receipts',purpose:'guest_meals'}],
    [t('Staff Purchases','Belian Staf'),spend('staff_meals'),spend('staff_meals',true),true,{kind:'receipts',purpose:'staff_meals'}],
    [t('Bar Purchases','Belian Bar'),spend('bar'),spend('bar',true),true,{kind:'receipts',purpose:'bar'}],
    ...(now.receipts.some(r=>r.purpose==='unclassified')||before.receipts.some(r=>r.purpose==='unclassified')?[[t('Needs Category','Perlu Kategori'),spend('unclassified'),spend('unclassified',true),true,{kind:'receipts',purpose:'unclassified'}] as [string,number,number,boolean,FinanceFocus]]:[]),
    [t('Guest Meals','Hidangan Tetamu'),now.usage.length?now.meals.guest_meals:null,before.usage.length?before.meals.guest_meals:null,false,{kind:'usage',side:'guest'}],
    [t('Staff Meals','Hidangan Staf'),now.usage.length?now.meals.staff_meals:null,before.usage.length?before.meals.staff_meals:null,false,{kind:'usage',side:'staff'}],
    [t('Cost / Guest Meal','Kos / Hidangan Tetamu'),guest,oldGuest,true,{kind:'usage',side:'guest'}],
    [t('Cost / Staff Meal','Kos / Hidangan Staf'),staff,oldStaff,true,{kind:'usage',side:'staff'}],
    [t('Guest Minus Staff / Meal','Beza Tetamu dan Staf / Hidangan'),guest===null||staff===null?null:guest-staff,oldGuest===null||oldStaff===null?null:oldGuest-oldStaff,true,{kind:'usage'}],
  ];
  const outstanding=now.receipts.filter(r=>r.payment_checked).reduce((sum,r)=>sum+Math.max(0,Math.round((r.total_cost-(r.paid_amount??0))*100)),0)/100;
  const unchecked=now.receipts.filter(r=>paymentState(r)==='unchecked').length;
  const render=(n:number|null,currency:boolean)=>n===null?t('Not Available','Belum Tersedia'):currency?rm(n):n.toLocaleString();
  return <div className="finance-overview">
    <div className="supply-metrics"><div><span>{t('Purchases (RM)','Belian (RM)')}</span><strong>{amount(now.total)}</strong><small>{now.receipts.length} {t('receipts','resit')}</small></div><div><span>{t('Previous (RM)','Sebelum (RM)')}</span><strong>{amount(before.total)}</strong></div><div><span>{t('Change (RM)','Perubahan (RM)')}</span><strong>{now.total>before.total?'+':''}{amount(now.total-before.total)}</strong></div></div>
    <table className="finance-comparison"><thead><tr><th>{t('Measure','Ukuran')}</th><th>{t('This Period','Tempoh Ini')}</th><th>{t('Previous','Sebelum')}</th></tr></thead><tbody>{rows.map(([name,current,previous,currency,focus])=><tr key={name}><th><button className="finance-measure-link" aria-label={t('View ','Lihat ')+name} onClick={()=>onOpen(focus)}><span>{name}</span><ChevronRight size={14}/></button></th><td>{render(current,currency)}{current!==null&&previous!==null?<small>{current-previous>0?'+':''}{currency?rm(current-previous):(current-previous).toLocaleString()}</small>:null}</td><td>{render(previous,currency)}</td></tr>)}</tbody></table>
    <p className="my-2 text-xs text-muted">{t('Meal costs are ingredient-cost estimates from confirmed usage, not purchase totals. Missing prices or meal counts show Not Available.','Kos hidangan ialah anggaran kos bahan daripada penggunaan disahkan, bukan jumlah belian. Harga atau bilangan hidangan tiada ditunjukkan sebagai Belum Tersedia.')}</p>
    <div className="finance-checks"><button onClick={()=>onOpen({kind:'usage'})}><span>{t('Usage Days Recorded','Hari Penggunaan Direkod')}</span><strong>{now.usage.length}</strong><ChevronRight size={14}/></button><button onClick={()=>onOpen({kind:'receipts',check:'unpaid'})}><span>{t('Known Unpaid Balance','Baki Belum Bayar Diketahui')}</span><strong>{rm(outstanding)}</strong><ChevronRight size={14}/></button><button onClick={()=>onOpen({kind:'receipts',check:'unchecked'})}><span>{t('Payments to Check','Bayaran Perlu Disemak')}</span><strong>{unchecked}</strong><ChevronRight size={14}/></button><button onClick={()=>onOpen({kind:'receipts',check:'breakdown'})}><span>{t('Receipt Breakdowns to Check','Pecahan Resit Perlu Disemak')}</span><strong>{now.unitemised+now.mismatched}</strong><ChevronRight size={14}/></button></div>
    <p className="mt-2 text-xs text-muted">{t('Payment figures cover purchases dated in this period. Unchecked payments are excluded from the known unpaid balance. Missing usage days are not zero usage.','Angka bayaran meliputi belian bertarikh dalam tempoh ini. Bayaran belum disemak tidak termasuk dalam baki diketahui. Hari tanpa rekod bukan penggunaan sifar.')}</p>
  </div>;
}
