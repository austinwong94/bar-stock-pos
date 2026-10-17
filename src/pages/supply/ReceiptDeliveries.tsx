import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, FilePenLine, PackageCheck } from 'lucide-react';
import { buttonClass, iconButtonClass, secondaryButtonClass } from '../../components/Form';
import { useLanguage } from '../../lib/language';
import { supabase } from '../../lib/supabase';
import { readErrorMessage } from '../../lib/opsData';
import { useSharedRefresh } from '../../lib/useSharedRefresh';
import type { DeliveryDraft, PurchaseRequest } from '../../lib/platformTypes';
import { awaitingDelivery } from '../../lib/purchasingProgress';
import { deliveryRemaining } from '../../lib/deliveryEntry';
import { DeliveryBatch } from './DeliveryBatch';
import { deliveryTime } from './DeliveryRecord';
import { ReportDeliveryIssue } from './DeliveryIssues';
import { useSearchParams } from 'react-router-dom';
import { workRecordId } from '../../lib/kitchenWorkQueue';
import { useAccess } from '../../lib/access';

type Row = {request:PurchaseRequest & {supplier:string};draft:DeliveryDraft|null};
export function ReceiptDeliveries({query,revision,onSaved}:{query:string;revision:number;onSaved:()=>Promise<void>}){
  const {text:t,language}=useLanguage();
  const {profile}=useAccess();
  const [params,setParams]=useSearchParams(),resume=workRecordId(params.get('receipt')),resumeDraft=workRecordId(params.get('draft'));
  const [resumeError,setResumeError]=useState('');
  const [rows,setRows]=useState<Row[]>([]),[total,setTotal]=useState(0),[page,setPage]=useState(0),[selected,setSelected]=useState<Row|null>(null);
  const [error,setError]=useState(''),[opening,setOpening]=useState(false);
  const [issueRequest,setIssueRequest]=useState<PurchaseRequest|null>(null);
  const sequence=useRef(0),lock=useRef(false);
  useEffect(()=>{if(!resume||!resumeDraft)return;let active=true;setOpening(true);void(async()=>{try{const r=await supabase.rpc('read_receipt_delivery',{p_request_id:resume});if(r.error)throw r.error;
    if(active){if(r.data?.draft?.id!==resumeDraft||r.data.draft.status!=='draft')setResumeError(t('This delivery draft changed or was completed. Refresh the list before receiving anything else.','Draf penghantaran berubah atau telah selesai. Muat semula senarai sebelum menerima barang lain.'));else{setResumeError('');setSelected(r.data);}}
  }catch(e){if(active)setResumeError(readErrorMessage(e,'Could not open this same receipt delivery.'));}finally{if(active){setOpening(false);setParams(previous=>{const next=new URLSearchParams(previous);next.delete('receipt');next.delete('draft');return next;},{replace:true});}}})();return()=>{active=false;};},[resume,resumeDraft]);
  useEffect(()=>setPage(0),[query]);
  const refresh=useCallback(async()=>{
    const ticket=++sequence.current;
    try{const r=await supabase.rpc('read_receipt_deliveries',{p_query:query,p_limit:5,p_offset:page*5});if(ticket!==sequence.current)return;if(r.error)throw r.error;
      if(page&&r.data.total<=page*5){setPage(Math.max(0,Math.ceil(r.data.total/5)-1));return;}setRows(r.data.records);setTotal(r.data.total);setError('');
    }catch(e){if(ticket===sequence.current)setError(readErrorMessage(e,t('Receipt deliveries could not load.','Penghantaran resit tidak dapat dimuatkan.')));}
  },[page,query,t]);
  useEffect(()=>{void refresh();return()=>{sequence.current++;};},[refresh,revision]);
  useSharedRefresh(refresh,{tables:['expense_receipts','receipt_delivery_drafts'],intervalMs:15000});
  async function open(id:string){
    if(lock.current)return;lock.current=true;setOpening(true);
    try{const r=await supabase.rpc('read_receipt_delivery',{p_request_id:id});if(r.error)throw r.error;setSelected(r.data);setError('');}
    catch(e){setError(readErrorMessage(e,t('Could not open delivery.','Penghantaran tidak dapat dibuka.')));}
    finally{lock.current=false;setOpening(false);}
  }
  const saved=()=>{void refresh();void onSaved();};
  if(!total&&!error&&!resumeError&&!selected&&!issueRequest)return null;
  return <section className="receipt-deliveries" aria-label={t('From Purchase Receipts','Daripada Resit Pembelian')}>
    <h3>{t('From Purchase Receipts','Daripada Resit Pembelian')} <span className="tabular text-muted">{total}</span></h3>
    {error?<p role="alert" className="my-2 text-sm text-danger">{error} <button className="underline" onClick={()=>void refresh()}>{t('Retry','Cuba Lagi')}</button></p>:null}
    {resumeError?<p role="alert" className="my-2 text-sm text-danger">{resumeError}</p>:null}
    <ul>{rows.map(({request:r,draft})=>{
      const items=r.purchase_request_items?.filter(awaitingDelivery)??[];
      return <li key={r.id} data-receipt-delivery={r.id}>
        <div className="arrival-heading"><div><strong>{r.supplier}</strong><small>{t('Receipt','Resit')} {r.request_no} · {r.needed_for_date}</small></div><div className="arrival-actions"><button className={buttonClass} disabled={opening} onClick={()=>void open(r.id)}>{draft?<FilePenLine size={16}/>:<PackageCheck size={16}/>}<span>{draft?t('Resume','Sambung'):t('Check Arrival','Semak Barang')}</span></button><button className={secondaryButtonClass} disabled={opening} onClick={()=>setIssueRequest(r)}><AlertTriangle size={16}/><span>{t('Report Issue','Lapor Masalah')}</span></button></div></div>
        {draft?<p className="receipt-delivery-pending">{t('Draft Saved · No Stock Added','Draf Disimpan · Tiada Stok Ditambah')}<small>{draft.updated_by_name} · {deliveryTime(draft.updated_at,language)} MYT</small></p>:null}
        <ul className="receipt-delivery-items">{items.slice(0,3).map(i=><li key={i.id}><span>{i.item_name}</span><strong>{deliveryRemaining(i).toLocaleString('en-MY',{maximumFractionDigits:4})} {i.unit}</strong></li>)}</ul>
        {items.length>3?<small className="text-muted">+{items.length-3} {t('More Items','Item Lagi')}</small>:null}
      </li>;
    })}</ul>
    {total>5?<nav className="flex items-center justify-between gap-2 py-2 text-xs"><span>{page*5+1}-{Math.min(total,(page+1)*5)} / {total}</span><div className="flex gap-2"><button className={iconButtonClass} aria-label={t('Previous Receipt Deliveries','Penghantaran Resit Sebelumnya')} disabled={!page||opening} onClick={()=>setPage(v=>v-1)}><ChevronLeft size={16}/></button><button className={iconButtonClass} aria-label={t('Next Receipt Deliveries','Penghantaran Resit Seterusnya')} disabled={(page+1)*5>=total||opening} onClick={()=>setPage(v=>v+1)}><ChevronRight size={16}/></button></div></nav>:null}
    {selected?<DeliveryBatch key={profile?.id+':'+selected.request.id} receiptSource request={selected.request} initialDraft={selected.draft??undefined} onSaved={saved} onClose={()=>{setSelected(null);saved();}}/>:null}
    {issueRequest?<ReportDeliveryIssue receiptSource request={issueRequest} onSaved={saved} onClose={()=>{setIssueRequest(null);saved();}}/>:null}
  </section>;
}
