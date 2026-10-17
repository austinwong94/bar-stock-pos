import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { addDays, addMonths, addWeeks, format } from 'date-fns';
import { ChevronLeft, ChevronRight, Download, Eye } from 'lucide-react';
import { Field, iconButtonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { useLanguage } from '../../lib/language';
import { supabase } from '../../lib/supabase';
import { readErrorMessage, todayIso } from '../../lib/opsData';
import { categoryLabels, expenseCategories, expenseSummary, purposeLabels, supplyPeriod, type ExpenseReceipt, type SupplyData } from '../../lib/supplyWorkflow';
import { countDisplay, countUnit } from '../../lib/stockCount';
import { PurposeButtons, ReceiptDetails } from './PurchaseReceipts';
import { useSharedRefresh } from '../../lib/useSharedRefresh';
import FinanceOverview from './FinanceOverview';
import { csvText, financeExport, financeSource, type WaterUsage } from '../../lib/financeExport';
import { FinanceInspection } from './FinanceInspection';
import type { FinanceFocus } from '../../lib/financeInspection';

const rm=(n:number)=>'RM '+n.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2});
export default function CostMonitor({actions}:{actions?:ReactNode}) {
  const {text:t}=useLanguage();
  const [mode,setMode]=useState<'day'|'week'|'month'>('day'),[date,setDate]=useState(todayIso),[purpose,setPurpose]=useState('all'),[supplier,setSupplier]=useState('all'),[category,setCategory]=useState('all'),[query,setQuery]=useState('');
  const [view,setView]=useState<'overview'|'suppliers'|'items'|'usage'|'receipts'>('overview');
  const [data,setData]=useState<SupplyData>({receipts:[],usage:[]}),[loading,setLoading]=useState(true),[error,setError]=useState(''),[selected,setSelected]=useState<ExpenseReceipt|null>(null);
  const [water,setWater]=useState<WaterUsage[]>([]),[loadedPeriod,setLoadedPeriod]=useState('');
  const [focus,setFocus]=useState<{period:string;value:FinanceFocus}|null>(null);
  const seq=useRef(0),period=supplyPeriod(date,mode);
  const ready=!loading&&!error&&loadedPeriod===date+'|'+mode;
  const refresh=useCallback(async()=>{const ticket=++seq.current;setLoading(true);try{
    const p=supplyPeriod(date,mode),a=await supabase.rpc('read_expense_receipts',{p_from:p.previousStart,p_to:p.end});if(a.error)throw a.error;
    const b=await supabase.rpc('read_daily_kitchen_usage',{p_from:p.previousStart,p_to:p.end});if(b.error)throw b.error;
    const w=await supabase.rpc('read_kitchen_water_usage',{p_from:p.previousStart,p_to:p.end});if(w.error)throw w.error;
    const source=financeSource(a.data,b.data,w.data);
    if(ticket===seq.current){setWater(source.water);setData(source.data);setLoadedPeriod(date+'|'+mode);setError('');}
  }catch(e){if(ticket===seq.current)setError(readErrorMessage(e,'Could not load cost monitoring.'));}finally{if(ticket===seq.current)setLoading(false);}},[date,mode]);
  useEffect(()=>{void refresh();return()=>{seq.current++;};},[refresh]);
  useEffect(()=>{setFocus(null);setSelected(null);},[date,mode]);
  useSharedRefresh(refresh,{tables:['expense_receipts','purchase_evidence','kitchen_daily_usage','kitchen_water_usage','purchase_payments']});
  const now=expenseSummary(data,period.start,period.end,purpose,supplier,category,query),before=expenseSummary(data,period.previousStart,period.previousEnd,purpose,supplier,category,query);
  const change=now.total-before.total,partial=period.start<=todayIso()&&period.end>=todayIso();
  const suppliers=[...new Set(data.receipts.map(r=>r.supplier))].sort();
  function move(n:number){setDate(format(mode==='day'?addDays(new Date(date+'T12:00:00'),n):mode==='week'?addWeeks(new Date(date+'T12:00:00'),n):addMonths(new Date(date+'T12:00:00'),n),'yyyy-MM-dd'));}
  function download(){
    if(!ready)return;
    const rows=[[t('Filtered Purchases Only','Belian Ditapis Sahaja'),period.start,period.end],[t('Purpose','Tujuan'),purpose,t('Supplier','Pembekal'),supplier,t('Category','Kategori'),category,t('Item Search','Carian Item'),query],[t('Scope','Skop'),t('Matched items only when item filters are active. Receipt totals are shown once for reference; do not sum them as filtered expenditure. Voids excluded.','Item sepadan sahaja jika penapis item digunakan. Jumlah resit ditunjukkan sekali sebagai rujukan; jangan jumlahkan sebagai belian ditapis. Batal tidak termasuk.')],[],[t('Date','Tarikh'),t('Supplier','Pembekal'),t('Purpose','Tujuan'),t('Receipt No','No Resit'),t('Receipt Total MYR (Reference)','Jumlah Resit MYR (Rujukan)'),t('Item','Item'),t('Category','Kategori'),t('Quantity','Kuantiti'),t('Unit','Unit'),t('Item Total MYR','Jumlah Item MYR'),t('Recorded By','Direkod Oleh'),t('Status','Status')]];
    for(const r of now.receipts){let first=true;for(const l of r.lines.length?r.lines:[null]){if(l&&((category!=='all'&&l.category!==category)||!l.name.toLowerCase().includes(query.trim().toLowerCase())))continue;rows.push([r.purchase_date,r.supplier,t(...purposeLabels[r.purpose]),r.receipt_no,first?String(r.total_cost):'',l?.name??'',l?t(l.category,categoryLabels[l.category]??l.category):'',l?String(l.quantity):'',l?.unit??'',l?String(l.amount):'',r.created_by_name,t('Confirmed','Disahkan')]);first=false;}}
    saveCsv(csvText(rows),`Lovely-Paradise_Filtered-Purchases_${mode}_${period.start}_to_${period.end}.csv`);
  }
  function saveCsv(csv:string,filename:string){
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);
  }
  function downloadFinance(){
    if(!ready)return;
    const report=financeExport(data,water,period,mode,new Date().toISOString(),todayIso(),t);
    saveCsv(report.csv,report.filename);
  }
  const waterNow=water.filter(r=>r.business_date>=period.start&&r.business_date<=period.end),waterBefore=water.filter(r=>r.business_date>=period.previousStart&&r.business_date<=period.previousEnd);
  const waterTotal=(rows:typeof water)=>rows.length?rows.reduce((sum,r)=>sum+r.bottles,0)+' '+t('bottles','botol'):t('Not Recorded','Belum Direkod');
  const usageItems=new Map<string,{id:string;name:string;unit:string;display?:string;factor?:number|null;guest:number;staff:number;previous:number}>();
  for(const d of now.usage)for(const l of d.lines){const key=l.ingredient_id+'|'+l.unit+'|'+l.display_unit+'|'+l.display_factor;const r=usageItems.get(key)??{id:l.ingredient_id,name:l.name,unit:l.unit,display:l.display_unit,factor:l.display_factor,guest:0,staff:0,previous:0};r.guest+=l.guest_quantity;r.staff+=l.staff_quantity;usageItems.set(key,r);}
  for(const d of before.usage)for(const l of d.lines){const key=l.ingredient_id+'|'+l.unit+'|'+l.display_unit+'|'+l.display_factor;const r=usageItems.get(key)??{id:l.ingredient_id,name:l.name,unit:l.unit,display:l.display_unit,factor:l.display_factor,guest:0,staff:0,previous:0};r.previous+=l.guest_quantity+l.staff_quantity;usageItems.set(key,r);}
  function inspect(value:FinanceFocus){if(ready)setFocus({period:date+'|'+mode,value});}
  return <section className="supply-workspace">
    <div className="supply-toolbar"><h2>{t('Finance','Kewangan')}</h2><div className="flex min-w-0 flex-wrap justify-end gap-2">{actions}<button className={secondaryButtonClass} disabled={!ready} onClick={downloadFinance} title={t('All purchases, payments and kitchen usage for this period; purchase filters do not apply.','Semua belian, bayaran dan penggunaan dapur untuk tempoh ini; penapis belian tidak digunakan.')}><Download size={16}/>{t('Finance CSV','CSV Kewangan')}</button>{view!=='overview'&&view!=='usage'?<button className={secondaryButtonClass} disabled={!ready} onClick={download}><Download size={16}/>{t('Filtered CSV','CSV Ditapis')}</button>:null}</div></div>
    <div className="supply-period"><div className="supply-segments">{(['day','week','month'] as const).map(m=><button key={m} aria-pressed={mode===m} onClick={()=>setMode(m)}>{m==='day'?t('Daily','Harian'):m==='week'?t('Weekly','Mingguan'):t('Monthly','Bulanan')}</button>)}</div><button className={iconButtonClass} title={t('Previous Period','Tempoh Sebelumnya')} aria-label="Previous period" onClick={()=>move(-1)}><ChevronLeft size={16}/></button><input className={inputClass} type="date" value={date} aria-label={t('Report Date','Tarikh Laporan')} onChange={e=>{if(e.target.value)setDate(e.target.value);}}/><button className={iconButtonClass} title={t('Next Period','Tempoh Seterusnya')} aria-label="Next period" onClick={()=>move(1)}><ChevronRight size={16}/></button></div>
    <p className="mb-3 text-xs text-muted">{period.start} – {period.end}{partial?' · '+t('Period in Progress','Tempoh Sedang Berjalan'):''}</p>
    <nav className="finance-tabs" aria-label={t('Finance Views','Paparan Kewangan')}>{(['overview','suppliers','items','usage','receipts'] as const).map(v=><button key={v} aria-pressed={view===v} onClick={()=>setView(v)}>{({overview:t('Overview','Ringkasan'),suppliers:t('Suppliers','Pembekal'),items:t('Items','Item'),usage:t('Usage','Guna'),receipts:t('Receipts','Resit')})[v]}</button>)}</nav>
    {view!=='overview'&&view!=='usage'?<><PurposeButtons all value={purpose} onChange={setPurpose}/>
    <div className="supply-monitor-filters"><Field label={t('Supplier','Pembekal')}><select className={inputClass} value={supplier} onChange={e=>setSupplier(e.target.value)}><option value="all">{t('All Suppliers','Semua Pembekal')}</option>{suppliers.map(s=><option key={s}>{s}</option>)}</select></Field><Field label={t('Item Category','Kategori Item')}><select className={inputClass} value={category} onChange={e=>setCategory(e.target.value)}><option value="all">{t('All Categories','Semua Kategori')}</option>{expenseCategories.map(c=><option key={c} value={c}>{t(c,categoryLabels[c])}</option>)}</select></Field><Field label={t('Find Item','Cari Item')}><input className={inputClass} value={query} onChange={e=>setQuery(e.target.value)} placeholder={t('e.g. Cabbage','cth. Kubis')}/></Field></div>
    </>:null}
    {error?<p role="alert" className="my-3 text-sm text-danger">{error} <button className="underline" onClick={()=>void refresh()}>{t('Retry','Cuba Lagi')}</button></p>:null}
    {loading?<p role="status" className="my-3 text-sm text-muted">{t('Updating Report...','Mengemas Kini Laporan...')}</p>:null}
    {ready?<>
    {view!=='overview'&&view!=='usage'?<div className="supply-metrics"><div><span>{category==='all'&&!query?t('Purchases','Pembelian'):t('Itemised Purchases','Pembelian Terperinci')}</span><strong>{rm(now.total)}</strong></div><div><span>{t('Previous Period','Tempoh Sebelumnya')}</span><strong>{rm(before.total)}</strong></div><div><span>{t('Change','Perubahan')}</span><strong>{change>0?'+':''}{rm(change)}</strong></div></div>:null}
    <p className="my-3 text-xs text-muted">{partial?t('Current period is still in progress.','Tempoh semasa masih berjalan.'):t('Compared with the previous date range.','Dibandingkan dengan julat tarikh sebelumnya.')} {now.unitemised?`${now.unitemised} `+t('receipts have no item breakdown.','resit tiada pecahan item.'):''} {now.mismatched?`${now.mismatched} `+t('receipt totals differ from their item breakdown.','jumlah resit berbeza daripada pecahan item.'):''}</p>
    {view==='overview'&&!loading&&!error?<FinanceOverview data={data} period={period} onOpen={inspect}/>:null}
    {view==='suppliers'?<ul className="supply-records">{now.suppliers.map(s=><li key={s.name}><button className="supply-receipt-row" aria-label={t('View Supplier: ','Lihat Pembekal: ')+s.name} onClick={()=>inspect({kind:'receipts',purpose,supplier:s.name,category,query})}><span><strong className="block">{s.name}</strong><span className="text-xs text-muted">{s.receipts} {t('Receipts','Resit')}</span></span><strong>{rm(s.amount)}</strong><ChevronRight size={16}/></button></li>)}</ul>:null}
    {view==='items'?<div className="supply-table-scroll"><table className="dense-table w-full text-left text-sm"><thead><tr><th>{t('Item / Category','Item / Kategori')}</th><th>{t('Bought','Dibeli')}</th><th className="text-right">{t('Total','Jumlah')}</th><th className="text-right">{t('Price / Unit','Harga / Unit')}</th><th className="text-right">{t('Previous / Unit','Sebelum / Unit')}</th></tr></thead><tbody>{now.items.map(i=>{const prev=before.items.find(p=>p.name.toLowerCase()===i.name.toLowerCase()&&p.unit===i.unit&&p.category===i.category);return <tr key={i.name+i.unit+i.category}><td><button className="finance-measure-link" aria-label={t('View Item: ','Lihat Item: ')+i.name+' ('+i.unit+')'} onClick={()=>inspect({kind:'receipts',purpose,supplier,category,query,item:{name:i.name,category:i.category,unit:i.unit}})}><span><strong>{i.name}</strong><small className="block text-xs text-muted">{t(i.category,categoryLabels[i.category]??i.category)}</small></span><ChevronRight size={14}/></button></td><td>{i.quantity.toLocaleString()} {i.unit}</td><td className="text-right">{rm(i.amount)}</td><td className="text-right">{rm(i.amount/i.quantity)}</td><td className="text-right">{prev?rm(prev.amount/prev.quantity):'—'}</td></tr>;})}</tbody></table></div>:null}
    {view==='usage'?<>
      <p className="my-3 text-sm text-muted">{t('Kitchen usage covers the whole period. Supplier and purchase-category filters apply to purchases only.','Penggunaan dapur meliputi seluruh tempoh. Penapis pembekal dan kategori hanya untuk pembelian.')}</p>
      <div className="supply-metrics"><div><span>{t('Guest Meals','Hidangan Tetamu')}</span><strong>{now.meals.guest_meals}</strong><small>{now.meals.guest_unpriced?t('Incomplete Ingredient Costs','Kos Bahan Belum Lengkap'):now.meals.guest_meals?rm(now.meals.guest_cost/now.meals.guest_meals)+' / '+t('meal (estimate)','hidangan (anggaran)'):'—'}</small></div><div><span>{t('Staff Meals','Hidangan Staf')}</span><strong>{now.meals.staff_meals}</strong><small>{now.meals.staff_unpriced?t('Incomplete Ingredient Costs','Kos Bahan Belum Lengkap'):now.meals.staff_meals?rm(now.meals.staff_cost/now.meals.staff_meals)+' / '+t('meal (estimate)','hidangan (anggaran)'):'—'}</small></div><div><span>{t('Days Recorded','Hari Direkod')}</span><strong>{now.usage.length}</strong><small>{t('Missing days are not zero usage','Hari tiada rekod bukan penggunaan sifar')}</small></div></div>
      <p className="my-3 text-xs text-muted">{t('Meal-cost estimates use ingredient rates saved when usage was confirmed. They are not purchase totals or audited cost of goods sold.','Anggaran kos hidangan menggunakan kadar bahan ketika penggunaan disahkan. Bukan jumlah pembelian atau kos jualan diaudit.')}</p>
      <div className="supply-summary-row"><div><strong>{t('Snorkelling Mineral Water','Air Mineral Snorkelling')}</strong><small className="block text-muted">{t('Previous Period','Tempoh Sebelumnya')}: {waterTotal(waterBefore)}</small></div><strong>{waterTotal(waterNow)}</strong></div>
      <div className="supply-table-scroll"><table className="dense-table w-full text-sm"><thead><tr><th>{t('Ingredient','Bahan')}</th><th className="text-right">{t('Guests','Tetamu')}</th><th className="text-right">{t('Staff','Staf')}</th><th className="text-right">{t('Previous Total','Jumlah Sebelumnya')}</th></tr></thead><tbody>{[...usageItems.values()].map(i=><tr key={i.id+i.unit+i.display+i.factor}><td><button className="finance-measure-link" aria-label={t('View Usage: ','Lihat Penggunaan: ')+i.name} onClick={()=>inspect({kind:'usage',ingredient:{id:i.id,unit:i.unit,display:i.display,factor:i.factor}})}><span>{i.name} <small className="text-xs text-muted">({i.display||countUnit(i.unit)})</small></span><ChevronRight size={14}/></button></td><td className="text-right">{i.factor?(i.guest/i.factor).toLocaleString():countDisplay(i.guest,i.unit)}</td><td className="text-right">{i.factor?(i.staff/i.factor).toLocaleString():countDisplay(i.staff,i.unit)}</td><td className="text-right">{before.usage.length?i.factor?(i.previous/i.factor).toLocaleString():countDisplay(i.previous,i.unit):'—'}</td></tr>)}</tbody></table></div>
    </>:null}
    {view==='receipts'?<ul className="supply-records">{now.receipts.map(r=><li key={r.id}><button className="supply-receipt-row" onClick={()=>setSelected(r)}><span><strong className="block">{r.supplier}</strong><span className="text-xs text-muted">{r.purchase_date} · {t(...purposeLabels[r.purpose])}</span></span><strong>{rm(r.total_cost)}</strong><Eye size={16}/></button></li>)}</ul>:null}
    {!loading&&!error&&((view==='suppliers'&&!now.suppliers.length)||(view==='items'&&!now.items.length)||(view==='usage'&&!now.usage.length)||(view==='receipts'&&!now.receipts.length))?<p className="py-8 text-center text-sm text-muted">{t('No recorded data for this selection.','Tiada data direkod untuk pilihan ini.')}</p>:null}
    </>:null}
    {selected?<ReceiptDetails key={selected.id} record={selected} onPaymentSaved={()=>void refresh()} onClose={()=>{setSelected(null);void refresh();}} onChanged={()=>{setSelected(null);void refresh();}}/>:null}
    {focus&&!selected&&focus.period===date+'|'+mode?<FinanceInspection focus={focus.value} data={data} water={water} period={period} today={todayIso()} ready={ready} error={error} onRetry={()=>void refresh()} onClose={()=>setFocus(null)} onReceipt={setSelected}/>:null}
  </section>;
}
