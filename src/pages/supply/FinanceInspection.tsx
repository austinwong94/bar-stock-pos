import { useState } from 'react';
import { ArrowLeft, ChevronRight, FileSearch } from 'lucide-react';
import { Modal } from '../../components/Modal';
import { secondaryButtonClass } from '../../components/Form';
import { useLanguage } from '../../lib/language';
import { financeCoverage, inspectPurchases, inspectUsage, receiptCheck, usageCost, usageDisplayRate, type FinanceFocus } from '../../lib/financeInspection';
import { purposeLabels, receiptBreakdown, type ExpenseReceipt, type SupplyData } from '../../lib/supplyWorkflow';
import { paymentLabels, paymentState } from '../../lib/purchasePayments';
import type { WaterUsage } from '../../lib/financeExport';
import { countDisplay, countUnit } from '../../lib/stockCount';

const rm=(n:number)=>'RM '+n.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2});
export function FinanceInspection({focus,data,water,period,today,ready,error,onRetry,onClose,onReceipt}:{focus:FinanceFocus;data:SupplyData;water:WaterUsage[];period:{start:string;end:string};today:string;ready:boolean;error:string;onRetry:()=>void;onClose:()=>void;onReceipt:(r:ExpenseReceipt)=>void}) {
  const {text:t,language}=useLanguage(),[day,setDay]=useState<string|null>(null);
  const title=focus.kind==='receipts'?focus.check==='unchecked'?t('Payments to Check','Bayaran Perlu Disemak'):focus.check==='unpaid'?t('Unpaid Purchases','Belian Belum Bayar'):focus.check==='breakdown'?t('Receipt Breakdowns to Check','Pecahan Resit Perlu Disemak'):t('Purchase Details','Butiran Belian'):focus.ingredient?t('Ingredient Usage','Penggunaan Bahan'):focus.side==='guest'?t('Guest Meal Usage','Penggunaan Hidangan Tetamu'):focus.side==='staff'?t('Staff Meal Usage','Penggunaan Hidangan Staf'):t('Usage by Date','Penggunaan Mengikut Tarikh');
  const purchases=ready&&focus.kind==='receipts'?inspectPurchases(data,period.start,period.end,focus):null;
  const coverage=ready&&focus.kind==='usage'?financeCoverage(data,water,period.start,period.end,today):[];
  const days=ready&&focus.kind==='usage'?inspectUsage(data,period.start,period.end,focus):[];
  const selected=days.find(d=>d.record.business_date===day);
  const labelDate=(value:string)=>new Intl.DateTimeFormat(language==='ms'?'ms-MY':'en-GB',{dateStyle:'medium',timeZone:'Asia/Kuala_Lumpur'}).format(new Date(value+'T12:00:00+08:00'));
  const number=(n:number)=>n.toLocaleString('en-MY',{maximumFractionDigits:4});
  const quantity=(n:number,l:NonNullable<typeof selected>['lines'][number])=>l.display_factor?number(n/l.display_factor)+' '+(l.display_unit??countUnit(l.unit)):countDisplay(n,l.unit)+' '+countUnit(l.unit);
  return <Modal title={title} onClose={onClose} footer={<div className="flex justify-end"><button className={secondaryButtonClass} onClick={onClose}>{t('Close','Tutup')}</button></div>}>
    <p className="mb-3 text-xs text-muted">{period.start} {t('to','hingga')} {period.end}</p>
    {!ready?<p role={error?'alert':'status'} className={error?'text-sm text-danger':'text-sm text-muted'}>{error||t('Updating Report...','Mengemas Kini Laporan...')}{error?<button className={secondaryButtonClass+' mt-3'} onClick={onRetry}>{t('Retry','Cuba Lagi')}</button>:null}</p>:null}
    {purchases?<>
      <div className="finance-inspection-summary"><span>{purchases.detailed?t('Matched Items','Item Sepadan'):focus.kind==='receipts'&&focus.check==='unpaid'?t('Known Unpaid Balance','Baki Belum Bayar Diketahui'):t('Receipt Total','Jumlah Resit')}<small>{purchases.records.length} {t('Receipts','Resit')}</small></span><strong>{rm(focus.kind==='receipts'&&focus.check==='unpaid'?purchases.outstanding:purchases.total)}</strong></div>
      {focus.kind==='receipts'&&(focus.supplier&&focus.supplier!=='all'||focus.item)?<p className="my-2 break-words text-sm font-semibold">{focus.item?.name??focus.supplier}</p>:null}
      <ul className="finance-inspection-list">{purchases.records.map(({receipt:r,lines,amount})=>{const check=receiptCheck(r),difference=receiptBreakdown(r).difference;return <li key={r.id}><button className="finance-inspection-row" aria-label={t('Open Receipt: ','Buka Resit: ')+r.receipt_no} onClick={()=>onReceipt(r)}>
        <span className="min-w-0"><strong>{r.supplier}</strong><small>{labelDate(r.purchase_date)} · {r.receipt_no||t('No Receipt Number','Tiada Nombor Resit')}</small><small>{t(...purposeLabels[r.purpose])} · {r.created_by_name}</small><small className={check.unchecked||check.unpaid?'text-warning':''}>{t(...paymentLabels[paymentState(r)])}</small>
        {check.breakdown?<small className="text-danger">{!r.lines.length?t('No Item Breakdown','Tiada Pecahan Item'):t('Receipt / Items Difference','Beza Resit / Item')+': '+rm(difference)}</small>:null}
        {purchases.detailed?<small>{lines.map(l=>number(l.quantity)+' '+l.unit+' '+l.name).join(' · ')}</small>:null}</span>
        <span className="finance-inspection-amount"><strong>{rm(focus.kind==='receipts'&&focus.check==='unpaid'?r.total_cost-(r.paid_amount??0):amount)}</strong>{purchases.detailed||focus.kind==='receipts'&&focus.check==='unpaid'?<small>{t('Receipt','Resit')} {rm(r.total_cost)}</small>:null}<ChevronRight size={16}/></span>
      </button></li>;})}</ul>
      {!purchases.records.length?<p className="py-5 text-center text-sm text-muted">{t('No Matching Receipts','Tiada Resit Sepadan')}</p>:null}
      <p className="mt-3 text-xs text-muted">{purchases.detailed?t('Matched item amounts exclude receipt-level tax and discount. Receipt totals are reference only.','Amaun item sepadan tidak termasuk cukai dan diskaun resit. Jumlah resit untuk rujukan sahaja.'):t('Confirmed purchases only; voids excluded. Payments use purchase dates, not payment dates.','Belian disahkan sahaja; batal tidak termasuk. Bayaran berdasarkan tarikh belian, bukan tarikh bayaran.')}</p>
    </>:null}
    {ready&&focus.kind==='usage'?<>
      {selected?<>
        <button className={secondaryButtonClass+' mb-3'} onClick={()=>setDay(null)}><ArrowLeft size={16}/>{t('All Dates','Semua Tarikh')}</button>
        <div className="finance-inspection-summary"><span><strong>{labelDate(selected.record.business_date)}</strong><small>{selected.record.created_by_name} · {t('Revision','Semakan')} {selected.record.revision}</small></span></div>
        <div className="finance-day-totals">{(['guest','staff'] as const).map(side=>{const count=selected.record[side==='guest'?'guest_meals':'staff_meals'],cost=usageCost(selected.lines,side);return <div key={side}><span>{side==='guest'?t('Guest Meals','Hidangan Tetamu'):t('Staff Meals','Hidangan Staf')}</span><strong>{count.toLocaleString()}</strong><small>{cost===null?t('Missing Cost Rates','Kadar Kos Tiada'):rm(cost)+' '+t('(estimate)','(anggaran)')}</small><small>{!focus.ingredient&&cost!==null&&count>0?rm(cost/count)+' / '+t('meal','hidangan'):''}</small></div>;})}</div>
        <ul className="finance-inspection-list">{selected.lines.map((l,i)=><li className="finance-ingredient-row" key={l.ingredient_id+'|'+i}><strong>{l.name}</strong><div><span>{t('Guests','Tetamu')}: {quantity(l.guest_quantity,l)}</span><span>{t('Staff','Staf')}: {quantity(l.staff_quantity,l)}</span></div><small className={l.unit_cost==null&&l.guest_quantity+l.staff_quantity>0?'text-danger':'text-muted'}>{l.unit_cost==null?t('Cost Rate Not Recorded','Kadar Kos Belum Direkod'):rm(usageDisplayRate(l)!)+' / '+(l.display_unit??countUnit(l.unit))}</small></li>)}</ul>
        {selected.record.notes?<p className="mt-3 break-words text-sm">{selected.record.notes}</p>:null}
      </>:<>
        <div className="finance-inspection-summary"><span>{focus.ingredient?t('Days Using This Item','Hari Item Ini Diguna'):t('Usage Days Recorded','Hari Penggunaan Direkod')}<small>{t('Missing is not zero usage','Tiada rekod bukan penggunaan sifar')}</small></span><strong>{days.length}{!focus.ingredient?' / '+coverage.length:''}</strong></div>
        <ul className="finance-inspection-list">{(focus.ingredient?coverage.filter(c=>days.some(d=>d.record.business_date===c.date)):coverage).map(c=>{const usage=days.find(d=>d.record.business_date===c.date);return <li key={c.date}>
          {usage?<button className="finance-inspection-row" onClick={()=>setDay(c.date)} aria-label={t('Open Usage: ','Buka Penggunaan: ')+c.date}><span><strong>{labelDate(c.date)}</strong><small>{usage.record.guest_meals} {t('Guest Meals','Hidangan Tetamu')} · {usage.record.staff_meals} {t('Staff Meals','Hidangan Staf')}</small><small>{usage.record.created_by_name}{(['guest','staff'] as const).some(s=>usageCost(usage.lines,s)===null)?' · '+t('Missing Cost Rates','Kadar Kos Tiada'):''}</small></span><ChevronRight size={16}/></button>:<div className="finance-inspection-row"><span><strong>{labelDate(c.date)}</strong><small className={c.state==='past'?'text-warning':'text-muted'}>{c.state==='future'?t('Future Date','Tarikh Akan Datang'):c.state==='today'?t('Today · Not Recorded Yet','Hari Ini · Belum Direkod'):t('Meals Not Recorded','Hidangan Belum Direkod')}</small></span><FileSearch size={16} className="text-muted"/></div>}
          <p className="finance-water-note">{t('Snorkelling Water','Air Snorkelling')}: {c.water?c.water.closed?t('Closed','Cuti'):c.water.bottles.toLocaleString()+' '+t('bottles','botol'):c.state==='future'?t('Future Date','Tarikh Akan Datang'):t('Not Recorded','Belum Direkod')}</p>
        </li>;})}</ul>
      </>}
      {focus.ingredient?<p className="mt-3 text-xs text-muted">{t('Costs shown are for this ingredient only. Meal counts cover the whole day.','Kos ditunjukkan untuk bahan ini sahaja. Bilangan hidangan meliputi seluruh hari.')}</p>:null}
      <p className="mt-3 text-xs text-muted">{t('Saved ingredient rates are estimates, not audited cost of goods sold. No purchase filters apply to usage.','Kadar bahan tersimpan ialah anggaran, bukan kos jualan diaudit. Penapis belian tidak digunakan untuk penggunaan.')}</p>
    </>:null}
  </Modal>;
}
