import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, History, Plus, Search, Trash2 } from 'lucide-react';
import { Field, buttonClass, iconButtonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { PurchaseEvidenceViewer } from '../../components/PurchasePhotoField';
import { useAccess } from '../../lib/access';
import { useLanguage } from '../../lib/language';
import { supabase } from '../../lib/supabase';
import { readErrorMessage, todayIso } from '../../lib/opsData';
import { moneyCents } from '../../lib/purchaseEvidence';
import { categoryLabels, expenseCategories, purchasePurposes, purposeLabels, receiptBreakdown, supplyPeriod, type ExpenseReceipt, type PurchasePurpose, type ReceiptLine } from '../../lib/supplyWorkflow';
import { useSharedRefresh } from '../../lib/useSharedRefresh';
import PurchasePayments from './PurchasePayments';
import { paymentLabels, paymentState } from '../../lib/purchasePayments';
import { ReceiptReviewEditor, ReceiptReviewQueue } from './ReceiptReview';
import { blankReceiptData, type ReceiptReview } from '../../lib/receiptReview';
import { useSearchParams } from 'react-router-dom';
import { workRecordId } from '../../lib/kitchenWorkQueue';
import { financeSource } from '../../lib/financeExport';
import type { PaymentSummary } from '../../lib/purchasePayments';

export function PurposeButtons({value,onChange,all=false}:{value:string;onChange:(v:string)=>void;all?:boolean}) {
  const {text:t}=useLanguage();
  return <div className={'supply-segments '+(all?'four':'')} role="group" aria-label={t('Purchase For','Pembelian Untuk')}>
    {(all?['all',...purchasePurposes]:purchasePurposes).map(p=><button type="button" key={p} aria-label={p==='all'?t('All','Semua'):t(...purposeLabels[p])} aria-pressed={value===p} onClick={()=>onChange(p)}>{p==='all'?t('All','Semua'):t(...purposeLabels[p])}</button>)}
  </div>;
}

export default function PurchaseReceipts() {
  const {text:t}=useLanguage(),{can}=useAccess();
  const [params,setParams]=useSearchParams(),resume=workRecordId(params.get('review'));
  const paymentResume=workRecordId(params.get('payment'));
  const [paymentRevision,setPaymentRevision]=useState(0);
  const [resumeError,setResumeError]=useState('');
  const [month,setMonth]=useState(todayIso().slice(0,7)),[purpose,setPurpose]=useState('all'),[query,setQuery]=useState('');
  const [records,setRecords]=useState<ExpenseReceipt[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [editing,setEditing]=useState<ReceiptReview|null>(null),[selected,setSelected]=useState<ExpenseReceipt|null>(null),[reviewRevision,setReviewRevision]=useState(0),[creating,setCreating]=useState(false);
  const newId=useRef<string|null>(null);
  useEffect(()=>{if(!paymentResume)return;let active=true;setCreating(true);void(async()=>{try{
    const result=await supabase.rpc('read_purchase_payment_receipt',{p_receipt_id:paymentResume});if(result.error)throw result.error;
    const receipt=financeSource([result.data],[],[]).data.receipts[0];if(!receipt||receipt.id!==paymentResume)throw Error('The original payment receipt could not be verified.');
    if(active){setResumeError('');setMonth(receipt.purchase_date.slice(0,7));setSelected(receipt);}
  }catch(e){if(active)setResumeError(readErrorMessage(e,'Could not open the original payment receipt. Keep this device and retry.'));}
  finally{if(active)setCreating(false);}})();return()=>{active=false;};},[paymentResume,paymentRevision]);
  useEffect(()=>{if(!resume)return;let active=true;setCreating(true);void(async()=>{try{
    const r=await supabase.rpc('read_receipt_reviews',{p_id:resume});if(r.error)throw r.error;
    if(active){if(!r.data||r.data.status!=='pending')setResumeError(t('This receipt is no longer pending. Check its history before entering it again.','Resit ini tidak lagi tertangguh. Semak sejarah sebelum memasukkannya semula.'));else{setResumeError('');setEditing(r.data);}}
  }catch(e){if(active)setResumeError(readErrorMessage(e,'Could not open this same receipt review.'));}finally{if(active){setCreating(false);setParams(previous=>{const next=new URLSearchParams(previous);next.delete('review');return next;},{replace:true});}}})();return()=>{active=false;};},[resume]);
  async function create(){if(creating)return;setCreating(true);try{newId.current??=crypto.randomUUID();const r=await supabase.rpc('save_receipt_review',{p_id:newId.current,p_version:0,p_data:blankReceiptData()});if(r.error)throw r.error;setEditing(r.data);newId.current=null;setReviewRevision(n=>n+1);setError('');}catch(e){setError(readErrorMessage(e,'Could not start a receipt review. Retry to check the same entry.'));}finally{setCreating(false);}}
  const seq=useRef(0);
  const refresh=useCallback(async()=>{const ticket=++seq.current;setLoading(true);try {
    const p=supplyPeriod(month+'-01','month'),r=await supabase.rpc('read_expense_receipts',{p_from:p.start,p_to:p.end});if(r.error)throw r.error;
    if(ticket===seq.current){setRecords(r.data??[]);setError('');}
  }catch(e){if(ticket===seq.current)setError(readErrorMessage(e,'Could not load purchase receipts.'));}finally{if(ticket===seq.current)setLoading(false);}},[month]);
  useEffect(()=>{void refresh();return()=>{seq.current++;};},[refresh]);
  useSharedRefresh(refresh,{tables:['expense_receipts','purchase_evidence','purchase_payments']});
  const visible=records.filter(r=>(purpose==='all'||r.purpose===purpose)&&`${r.supplier} ${r.receipt_no} ${r.lines.map(l=>l.name).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="supply-workspace">
    <div className="supply-toolbar"><h2>{t('Purchase Receipts','Resit Pembelian')}</h2>{can('purchasing.fulfil')?<button className={buttonClass} disabled={creating} onClick={()=>void create()}><Plus size={16}/>{t('Add Receipt','Tambah Resit')}</button>:null}</div>
    <ReceiptReviewQueue revision={reviewRevision} onOpen={setEditing}/>
    {resumeError?<p role="alert" className="my-2 text-sm text-danger">{resumeError} {paymentResume?<button className="underline" disabled={creating} onClick={()=>setPaymentRevision(n=>n+1)}>{t('Retry','Cuba Lagi')}</button>:null}</p>:null}
    <PurposeButtons all value={purpose} onChange={setPurpose}/>
    <div className="supply-filters"><input className={inputClass} type="month" aria-label={t('Purchase Month','Bulan Pembelian')} value={month} onChange={e=>{if(e.target.value)setMonth(e.target.value);}}/><label className="relative min-w-0"><Search size={16} className="absolute left-3 top-3.5 text-muted"/><input className={inputClass+' pl-9'} placeholder={t('Supplier, Receipt or Item','Pembekal, Resit atau Item')} value={query} onChange={e=>setQuery(e.target.value)}/></label></div>
    {error?<p role="alert" className="text-sm text-danger">{error} <button className="underline" onClick={()=>void refresh()}>{t('Retry','Cuba Lagi')}</button></p>:null}
    <div className="supply-total"><span>{visible.filter(r=>r.status!=='void').length} {t('Receipts','Resit')}</span><strong>RM {visible.filter(r=>r.status!=='void').reduce((n,r)=>n+Number(r.total_cost),0).toFixed(2)}</strong></div>
    {loading?<p role="status" className="text-sm text-muted">{t('Updating...','Mengemas Kini...')}</p>:null}
    <ul className="supply-records">{visible.map(r=><li key={r.id}><button onClick={()=>setSelected(r)} className="supply-receipt-row"><span className="min-w-0"><strong className="block break-words">{r.supplier}</strong><span className="block text-xs text-muted">{r.purchase_date} · {t(...purposeLabels[r.purpose])}{r.receipt_no?' · '+r.receipt_no:''}</span></span><span className="text-right"><strong className={r.status==='void'?'line-through text-muted':''}>RM {Number(r.total_cost).toFixed(2)}</strong><span className={'block text-xs '+(r.status==='void'?'text-danger':'text-muted')}>{r.status==='void'?t('Voided','Dibatalkan'):!r.lines.length?t('Receipt Only','Resit Sahaja'):receiptBreakdown(r).difference!==0?t('Check Breakdown','Semak Pecahan'):t('Itemised','Diperincikan')}</span>{r.status!=='void'?<span className="block text-xs font-semibold text-ink">{t(...paymentLabels[paymentState(r)])}</span>:null}</span><Eye size={16}/></button></li>)}</ul>
    {!visible.length&&!loading&&!error?<p className="py-8 text-center text-sm text-muted">{t('No receipts for this selection.','Tiada resit untuk pilihan ini.')}</p>:null}
    {editing?<ReceiptReviewEditor key={editing.id} initial={editing} onClose={()=>{setEditing(null);setReviewRevision(n=>n+1);}} onSaved={r=>{setEditing(null);setReviewRevision(n=>n+1);setMonth(r.purchase_date.slice(0,7));setSelected(r);void refresh();}}/>:null}
    {selected?<ReceiptDetails key={selected.id} record={selected} onPaymentSaved={()=>void refresh()} onClose={()=>{setSelected(null);setParams(previous=>{const next=new URLSearchParams(previous);next.delete('payment');return next;},{replace:true});void refresh();}} onChanged={()=>{setSelected(null);void refresh();}}/>:null}
  </section>;
}

type EntryLine={name:string;category:string;quantity:string;unit:string;amount:string};
const blankLine=():EntryLine=>({name:'',category:'Vegetables',quantity:'',unit:'kg',amount:''});
export function ReceiptDetails({record:r,onClose,onChanged,onPaymentSaved}:{record:ExpenseReceipt;onClose:()=>void;onChanged?:()=>void;onPaymentSaved?:(summary:PaymentSummary)=>void}) {
  const {text:t}=useLanguage(),{can,profile}=useAccess();const [reason,setReason]=useState(''),[voiding,setVoiding]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [coding,setCoding]=useState(false);
  const [review,setReview]=useState<ReceiptReview|null>(null);
  if(review)return <ReceiptReviewEditor initial={review} onClose={()=>setReview(null)} onSaved={()=>setReview(null)}/>;
  if(coding)return <ReceiptCoding record={r} onClose={()=>setCoding(false)} onSaved={()=>{setCoding(false);onChanged?.();}}/>;
  async function cancel(){setBusy(true);try{const res=await supabase.rpc('void_expense_receipt',{p_id:r.id,p_reason:reason});if(res.error)throw res.error;onChanged?.();}catch(e){setError(readErrorMessage(e,'Could not void receipt.'));}finally{setBusy(false);}}
  return <Modal title={t('Purchase Receipt','Resit Pembelian')} onClose={onClose} wide>
    <div className="supply-total"><strong className="break-words">{r.supplier}</strong><strong>RM {Number(r.total_cost).toFixed(2)}</strong></div>
    <p className="text-sm">{r.purchase_date} · {t(...purposeLabels[r.purpose])} · {r.receipt_no||t('No Receipt Number','Tiada Nombor Resit')}</p>
    <p className="my-2 text-xs text-muted">{r.created_by_name} · {new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kuala_Lumpur'}).format(new Date(r.created_at))} MYT</p>
    {r.accounting_details?.review_id?<button className={secondaryButtonClass+' my-2'} onClick={()=>void supabase.rpc('read_receipt_reviews',{p_id:r.accounting_details!.review_id}).then((res:{data:ReceiptReview|null;error:unknown})=>{if(res.error)setError(readErrorMessage(res.error,'History unavailable.'));else setReview(res.data);})}><History size={16}/>{t('Original Review & History','Semakan Asal & Sejarah')}</button>:null}
    {r.accounting_details?<div className="receipt-review-flags"><p>{t('Supplier Address','Alamat Pembekal')}: {r.accounting_details.address||t('Not Entered','Belum Diisi')}</p><p>{t('Tax / Registration ID','ID Cukai / Pendaftaran')}: {r.accounting_details.tax_id||t('Not Entered','Belum Diisi')} · {r.accounting_details.phone}</p><p>{t('Subtotal / Tax / Discount','Subtotal / Cukai / Diskaun')}: {r.accounting_details.subtotal||'?'} / {r.accounting_details.tax||'?'} / {r.accounting_details.discount||'?'}</p>{r.accounting_details.review_note?<p><strong>{t('Review Note','Nota Semakan')}: </strong>{r.accounting_details.review_note}</p>:null}{r.accounting_details.extraction?.unreadable.map((u,i)=><p key={i}>{u.location}: {u.visible_text} · {u.reason}</p>)}{r.accounting_details.extraction?.warnings.map((w,i)=><p key={i}>{w}</p>)}</div>:null}
    {r.receipt_path&&r.items_path?<PurchaseEvidenceViewer receipt={r.receipt_path} items={r.items_path}/>:<p className="text-xs text-muted">{t('No photos attached to this record.','Tiada foto dilampirkan pada rekod ini.')}</p>}
    {r.lines.length?<div className="overflow-x-auto"><table className="dense-table mt-4 w-full text-sm"><thead><tr><th>{t('Item','Item')}</th><th>{t('Category','Kategori')}</th><th>{t('Qty','Kuantiti')}</th><th className="text-right">RM</th></tr></thead><tbody>{r.lines.map((l,i)=><tr key={i}><td>{l.name}</td><td>{t(l.category,categoryLabels[l.category]??l.category)}</td><td>{l.quantity} {l.unit}</td><td className="text-right tabular">{Number(l.amount).toFixed(2)}</td></tr>)}</tbody></table><p className={'mt-2 text-sm '+(receiptBreakdown(r).difference?'text-warning':'text-palm')}>{t('Receipt Difference','Perbezaan Resit')}: RM {receiptBreakdown(r).difference.toFixed(2)}</p></div>:<p className="mt-3 text-sm text-muted">{t('Receipt total recorded. Item breakdown has not been entered.','Jumlah resit direkod. Pecahan item belum diisi.')}</p>}
    <PurchasePayments key={profile?.id+':'+r.id} receiptId={r.id} onSaved={onPaymentSaved} allowNew={r.status==='confirmed'}/>
    {r.notes?<p className="mt-3 text-sm">{r.notes}</p>:null}
    {r.status==='confirmed'&&onChanged&&(can('purchasing.cost.manage')||can('purchasing.manage'))?<button className={secondaryButtonClass+' mt-3'} onClick={()=>setCoding(true)}>{t('Edit Item Breakdown','Edit Pecahan Item')}</button>:null}
    {r.status==='void'?<p className="mt-3 text-sm text-danger">{t('Voided','Dibatalkan')}: {r.void_reason}</p>:null}
    {!r.legacy&&r.status==='confirmed'&&can('purchasing.manage')&&onChanged?<div className="mt-4 border-t border-line pt-3">{voiding?<><Field label={t('Correction Reason','Sebab Pembetulan')}><input className={inputClass} value={reason} onChange={e=>setReason(e.target.value)}/></Field><p className="my-2 text-xs text-muted">{t('Keeps the original evidence. Excludes this receipt from totals; enter its replacement separately.','Bukti asal dikekalkan. Resit dikecualikan daripada jumlah; masukkan pengganti secara berasingan.')}</p><button className={secondaryButtonClass} disabled={!reason.trim()||busy} onClick={()=>void cancel()}>{t('Confirm Void','Sahkan Pembatalan')}</button></>:<button className="min-h-11 text-sm text-danger" onClick={()=>setVoiding(true)}>{t('Void Incorrect Receipt','Batalkan Resit Salah')}</button>}</div>:null}
    {error?<p role="alert" className="text-sm text-danger">{error}</p>:null}
  </Modal>;
}

function ReceiptCoding({record:r,onClose,onSaved}:{record:ExpenseReceipt;onClose:()=>void;onSaved:()=>void}) {
  const {text:t}=useLanguage();const [purpose,setPurpose]=useState(r.purpose),[reason,setReason]=useState(''),[lines,setLines]=useState<EntryLine[]>(r.lines.map(l=>({...l,quantity:String(l.quantity),amount:String(l.amount)}))),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const parsed=lines.map(l=>({...l,quantity:Number(l.quantity),amount:(moneyCents(l.amount)??NaN)/100}));
  const valid=purpose!=='unclassified'&&reason.trim()&&parsed.every(l=>l.name.trim()&&Number.isFinite(l.quantity)&&l.quantity>0&&Number.isFinite(l.amount));
  function update(i:number,patch:Partial<EntryLine>){setLines(old=>old.map((l,index)=>i===index?{...l,...patch}:l));}
  async function save(){if(!valid||busy)return;setBusy(true);try{const result=await supabase.rpc('code_expense_receipt',{p_id:r.id,p_purpose:purpose,p_lines:parsed,p_expected_version:r.coding_version??1,p_reason:reason});if(result.error)throw result.error;onSaved();}catch(e){setError(readErrorMessage(e,'Could not update receipt breakdown.'));}finally{setBusy(false);}}
  return <Modal title={t('Receipt Item Breakdown','Pecahan Item Resit')} wide onClose={()=>{if(!busy)onClose();}} footer={<button className={buttonClass} disabled={!valid||busy} onClick={()=>void save()}>{busy?t('Saving...','Menyimpan...'):t('Save Breakdown','Simpan Pecahan')}</button>}>
    <div className="supply-total"><strong>{r.supplier}</strong><strong>RM {Number(r.total_cost).toFixed(2)}</strong></div>
    <fieldset disabled={busy} className="grid min-w-0 gap-3"><PurposeButtons value={purpose} onChange={v=>setPurpose(v as PurchasePurpose)}/>
    {lines.map((l,i)=><div className="receipt-line-entry" key={i}><input className={inputClass} aria-label={`Item ${i+1}`} placeholder={t('Item Name','Nama Item')} value={l.name} onChange={e=>update(i,{name:e.target.value})}/><select aria-label={`Category ${i+1}`} className={inputClass} value={l.category} onChange={e=>update(i,{category:e.target.value})}>{expenseCategories.map(c=><option key={c} value={c}>{t(c,categoryLabels[c])}</option>)}</select><div className="receipt-line-amounts"><input className={inputClass} inputMode="decimal" aria-label={`Quantity ${i+1}`} placeholder={t('Qty','Kuantiti')} value={l.quantity} onChange={e=>update(i,{quantity:e.target.value})}/><select className={inputClass} aria-label={`Unit ${i+1}`} value={l.unit} onChange={e=>update(i,{unit:e.target.value})}>{['kg','g','L','ml','pcs','biji','ekor','pack','bag','gelen','botol','bottle','tin','cylinder','carton'].map(u=><option key={u}>{u}</option>)}</select><input className={inputClass} inputMode="decimal" aria-label={`Line Total RM ${i+1}`} placeholder="RM" value={l.amount} onChange={e=>update(i,{amount:e.target.value})}/><button className={iconButtonClass} title={t('Remove Item','Buang Item')} aria-label={`Remove item ${i+1}`} onClick={()=>setLines(old=>old.filter((_,j)=>j!==i))}><Trash2 size={16}/></button></div></div>)}
    <button className={secondaryButtonClass} onClick={()=>setLines(old=>[...old,blankLine()])}><Plus size={16}/>{t('Add Item','Tambah Item')}</button>
    <p className="text-sm">{t('Receipt Difference','Perbezaan Resit')}: RM {receiptBreakdown({total_cost:r.total_cost,lines:parsed.filter(l=>Number.isFinite(l.amount))}).difference.toFixed(2)}</p>
    <Field label={t('Reason / Accounting Note','Sebab / Nota Akaun')}><input className={inputClass} value={reason} onChange={e=>setReason(e.target.value)}/></Field></fieldset>
    {error?<p role="alert" className="mt-3 text-sm text-danger">{error}</p>:null}
  </Modal>;
}
