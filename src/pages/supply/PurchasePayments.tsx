import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Plus, RefreshCw } from 'lucide-react';
import { Field, buttonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { useLanguage } from '../../lib/language';
import { useAccess } from '../../lib/access';
import { supabase } from '../../lib/supabase';
import { todayIso, readErrorMessage } from '../../lib/opsData';
import { moneyCents } from '../../lib/purchaseEvidence';
import { paymentLabels, paymentState, type PaymentSummary } from '../../lib/purchasePayments';
import { definitiveInitialSaveFailure } from '../../lib/saveAttempt';
import { paymentConfirmed, paymentRecoveryKey, readPaymentRecovery, readPaymentSummary, writePaymentRecovery, type PaymentOperation, type PaymentRecovery } from '../../lib/purchasePaymentRecovery';
import { usageDate } from '../../lib/dailyUsageDraft';
import { useSharedRefresh } from '../../lib/useSharedRefresh';

export default function PurchasePayments({receiptId,onSaved,allowNew=true}:{receiptId:string;onSaved?:(summary:PaymentSummary)=>void;allowNew?:boolean}) {
  const {text:t}=useLanguage(),{can,profile}=useAccess();
  const key=paymentRecoveryKey(import.meta.env.VITE_SUPABASE_URL,profile?.id??'',receiptId);
  const [loaded]=useState(()=>{try{const raw=localStorage.getItem(key);return {raw,value:readPaymentRecovery(raw,receiptId),error:''};}catch(e){return {raw:null,value:null,error:readErrorMessage(e,'Payment recovery unavailable.')};}});
  const raw=useRef(loaded.raw),pending=useRef(loaded.value),lock=useRef(false),seq=useRef(0),active=useRef(true);
  const [recovery,setRecovery]=useState(loaded.value),[storageError,setStorageError]=useState(loaded.error);
  const [data,setData]=useState<PaymentSummary|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[loading,setLoading]=useState(true);
  const [form,setForm]=useState(false),[amount,setAmount]=useState(''),[date,setDate]=useState(todayIso),[method,setMethod]=useState('bank'),[reference,setReference]=useState(''),[busy,setBusy]=useState(false);
  const readable=can('purchasing.view')&&can('purchasing.cost.view');
  const editable=readable&&(can('purchasing.cost.manage')||can('purchasing.fulfil'));
  const refresh=useCallback(async()=>{
    if(lock.current||!readable)return;
    const ticket=++seq.current;setLoading(true);
    try{const r=await supabase.rpc('read_purchase_payments',{p_receipt_id:receiptId});if(r.error)throw r.error;const next=readPaymentSummary(r.data,receiptId);if(active.current&&ticket===seq.current){setData(next);setError('');}}
    catch(e){if(active.current&&ticket===seq.current){setData(null);setError(readErrorMessage(e,t('Payment records could not load.','Rekod bayaran tidak dapat dimuatkan.')));}}
    finally{if(active.current&&ticket===seq.current)setLoading(false);}
  },[receiptId,readable,t]);
  useEffect(()=>{active.current=true;void refresh();return()=>{active.current=false;seq.current++;};},[refresh]);
  useSharedRefresh(refresh,{tables:['purchase_payments','purchase_payment_accounts'],intervalMs:60000});
  useEffect(()=>{const changed=()=>{try{if(localStorage.getItem(key)!==raw.current)setStorageError(t('This payment changed in another tab. Close and reopen the receipt.','Bayaran berubah dalam tab lain. Tutup dan buka semula resit.'));}catch{setStorageError(t('Device storage is unavailable. Reopen this receipt before continuing.','Storan peranti tidak tersedia. Buka semula resit sebelum meneruskan.'));}};window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);},[key,t]);
  const remaining=data?Math.round((data.total-data.paid)*100)/100:0,cents=moneyCents(amount);
  const valid=cents!==null&&cents>0&&cents<=Math.round(remaining*100)&&usageDate(date)&&date<=todayIso();
  async function submit(operation?:PaymentOperation){
    if(lock.current||!profile?.id||!editable||storageError||(!pending.current&&(!data||loading||!allowNew)))return;
    const prior=pending.current;
    const next:PaymentRecovery=prior??{version:1,receiptId,operation:operation!,updatedAt:new Date().toISOString()};
    if(!next.operation)return;
    const reverseId=next.operation.kind==='reverse'?next.operation.args.p_id:null;
    if(reverseId&&(!can('purchasing.cost.manage')||loading||!data?.payments.some(p=>p.id===reverseId)))return;
    lock.current=true;setBusy(true);setError('');setNotice('');++seq.current;
    try{
      if(prior){if(localStorage.getItem(key)!==raw.current)throw Error(t('This payment changed in another tab. Close and reopen the receipt.','Bayaran berubah dalam tab lain. Tutup dan buka semula resit.'));}
      else raw.current=writePaymentRecovery(localStorage,key,next,raw.current);
    }catch(e){setStorageError(readErrorMessage(e,t('Nothing new was sent. Reopen the receipt to check device storage.','Tiada rekod baharu dihantar. Buka semula resit untuk menyemak storan peranti.')));lock.current=false;setBusy(false);return;}
    pending.current=next;setRecovery(next);setForm(false);setLoading(false);
    try{
      const op=next.operation,r=await supabase.rpc(op.kind==='record'?'record_purchase_payment':'void_purchase_payment',op.args);
      if(r.error)throw r.error;
      const confirmed=readPaymentSummary(r.data,receiptId);
      if(!paymentConfirmed(confirmed,op))throw Error(t('Payment confirmation is uncertain. Check the same record again.','Pengesahan bayaran belum pasti. Semak rekod yang sama lagi.'));
      raw.current=writePaymentRecovery(localStorage,key,null,raw.current);pending.current=null;
      if(active.current){setRecovery(null);setData(confirmed);setAmount('');setReference('');setNotice(op.kind==='record'?t('Payment Record Saved','Rekod Bayaran Disimpan'):t('Payment Reversed','Bayaran Dibatalkan'));onSaved?.(confirmed);}
    }catch(e){
      if(active.current)setError(readErrorMessage(e,t('Confirmation could not be verified. Check the same record again.','Pengesahan tidak dapat disemak. Semak rekod yang sama lagi.')));
      if(definitiveInitialSaveFailure(!!prior,e)){
        try{raw.current=writePaymentRecovery(localStorage,key,null,raw.current);pending.current=null;if(active.current){setRecovery(null);setData(null);setLoading(false);}}
        catch(storage){if(active.current)setStorageError(readErrorMessage(storage,'Keep this device and reopen the receipt.'));}
      }
    }finally{lock.current=false;if(active.current)setBusy(false);}
  }
  function save(unpaid=false){
    if(!data||(!unpaid&&!valid)||!editable||loading)return;
    void submit({kind:'record',args:{p_receipt_id:receiptId,p_amount:unpaid?0:cents!/100,p_paid_on:date,p_method:unpaid?'unpaid':method as 'bank'|'qr'|'cash',p_reference:unpaid?'':reference.trim(),p_expected_version:data.version,p_operation_id:crypto.randomUUID()}});
  }
  function reverse(id:string){
    if(!data||busy||recovery||!can('purchasing.cost.manage'))return;
    const reason=window.prompt(t('Reason for reversing this payment record?','Sebab membatalkan rekod bayaran ini?'));
    if(reason?.trim())void submit({kind:'reverse',args:{p_id:id,p_reason:reason.trim(),p_expected_version:data.version}});
  }
  const op=recovery?.operation;
  const reverseId=op?.kind==='reverse'?op.args.p_id:null;
  const canRetry=editable&&(!reverseId||(can('purchasing.cost.manage')&&!loading&&data?.payments.some(p=>p.id===reverseId)));
  const methodName=(value:string)=>value==='cash'?t('Cash','Tunai'):value==='bank'?'Bank':value==='unpaid'?t('Confirmed Unpaid','Disahkan Belum Bayar'):'QR';
  return <section className="mt-4 border-t border-line pt-3" aria-label={t('Payments','Bayaran')}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold">{t('Payments','Bayaran')}</h3>{data&&!loading?<span className="text-xs font-semibold">{t(...paymentLabels[paymentState({total_cost:data.total,paid_amount:data.paid,payment_checked:data.checked})])}</span>:null}</div>
    {storageError?<p role="alert" className="my-2 break-words text-sm text-danger">{storageError}</p>:null}
    {error?<p role="alert" className="my-2 break-words text-sm text-danger">{error}</p>:null}{notice?<p role="status" className="my-2 text-sm text-palm">{notice}</p>:null}
    {op?<div className="my-3 grid gap-2 border-l-2 border-warning pl-3 text-sm"><strong>{t('Check Status · Same Payment Kept','Semak Status · Bayaran Sama Disimpan')}</strong><p className="break-words">{op.kind==='record'?`${op.args.p_paid_on} · ${op.args.p_method==='unpaid'?t('Confirm Unpaid','Sahkan Belum Bayar'):methodName(op.args.p_method)} · RM ${op.args.p_amount.toFixed(2)}${op.args.p_reference?' · '+op.args.p_reference:''}`:t('Payment Reversal','Pembatalan Bayaran')+' · '+op.args.p_reason}</p><p className="text-xs text-muted">{t('Resume from To Finish on this device. Do not enter it again.','Sambung melalui Belum Selesai pada peranti ini. Jangan masukkan semula.')}</p><button className={buttonClass+' justify-self-start'} disabled={busy||!!storageError||!canRetry} onClick={()=>void submit()}><RefreshCw size={16}/>{busy?t('Checking...','Menyemak...'):t('Check Confirmation','Semak Pengesahan')}</button></div>:null}
    {reverseId&&data&&!loading&&!data.payments.some(p=>p.id===reverseId)?<p role="alert" className="my-2 text-sm text-danger">{t('The original payment was not found in this receipt. Keep this device and ask a manager.','Bayaran asal tidak dijumpai dalam resit ini. Simpan peranti ini dan minta pengurus menyemak.')}</p>:null}
    {loading?<p role="status" className="my-2 text-sm text-muted">{t('Loading Payments...','Memuatkan Bayaran...')}</p>:null}
    {!loading&&!data?<button className={secondaryButtonClass} disabled={busy} onClick={()=>void refresh()}><RefreshCw size={16}/>{t('Refresh Payments','Muat Semula Bayaran')}</button>:null}
    {data&&!loading?<><div className="purchase-progress my-3"><span>{t('Paid','Dibayar')}<strong>RM {data.paid.toFixed(2)}</strong></span><span>{data.checked?t('Outstanding','Baki Bayaran'):t('Receipt Total','Jumlah Resit')}<strong>RM {(data.checked?remaining:data.total).toFixed(2)}</strong></span></div>
      {editable&&allowNew&&!form&&!op?<div className="flex flex-wrap gap-2">{remaining>0?<button className={buttonClass} disabled={busy||!!storageError} onClick={()=>{setForm(true);setAmount(remaining.toFixed(2));setNotice('');}}><Plus size={16}/>{t('Record Payment','Rekod Bayaran')}</button>:null}{!data.checked?<button className={secondaryButtonClass} disabled={busy||!!storageError} onClick={()=>save(true)}>{t('Confirm Unpaid','Sahkan Belum Bayar')}</button>:null}</div>:null}
      {form&&!op?<div className="grid gap-3"><fieldset disabled={busy||!!storageError} className="grid gap-3"><div className="grid grid-cols-2 gap-3"><Field label={t('Amount Paid (RM)','Jumlah Dibayar (RM)')}><input aria-label={t('Amount Paid (RM)','Jumlah Dibayar (RM)')} className={inputClass} inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)}/></Field><Field label={t('Payment Date','Tarikh Bayaran')}><input aria-label={t('Payment Date','Tarikh Bayaran')} type="date" className={inputClass} value={date} max={todayIso()} onChange={e=>setDate(e.target.value)}/></Field></div><div className="supply-segments three">{[['bank','Bank','Bank'],['qr','QR','QR'],['cash','Cash','Tunai']].map(([key,en,ms])=><button type="button" key={key} aria-pressed={method===key} onClick={()=>setMethod(key)}>{t(en,ms)}</button>)}</div><Field label={t('Payment Reference / Note','Rujukan Bayaran / Nota')}><input aria-label={t('Payment Reference / Note','Rujukan Bayaran / Nota')} className={inputClass} maxLength={200} value={reference} onChange={e=>setReference(e.target.value)}/></Field></fieldset><div className="flex flex-wrap justify-end gap-2"><button className={secondaryButtonClass} disabled={busy} onClick={()=>setForm(false)}>{t('Cancel','Batal')}</button><button className={buttonClass} disabled={busy||!!storageError||!valid} onClick={()=>save()}><Check size={16}/>{t('Confirm Payment','Sahkan Bayaran')}</button></div></div>:null}
      <ul className="mt-3 divide-y divide-line">{data.payments.map(p=><li key={p.id} className="py-2 text-sm"><div className="flex justify-between gap-3"><span>{p.paid_on} · {methodName(p.method)}</span><strong className={p.void_reason?'line-through':''}>RM {p.amount.toFixed(2)}</strong></div><p className="break-words text-xs text-muted">{p.recorded_by_name}{p.reference?' · '+p.reference:''}{p.void_reason?' · '+p.void_reason:''}</p>{!p.void_reason&&p.amount>0&&can('purchasing.cost.manage')?<button className="min-h-11 text-xs text-danger underline" disabled={busy||!!op||!!storageError} onClick={()=>reverse(p.id)}>{t('Reverse Incorrect Payment','Batalkan Bayaran Salah')}</button>:null}</li>)}</ul>
    </>:null}
  </section>;
}
