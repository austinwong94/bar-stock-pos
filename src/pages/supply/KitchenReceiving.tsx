import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, FilePenLine, PackageCheck, Plus, Search } from 'lucide-react';
import { buttonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { useLanguage } from '../../lib/language';
import { supabase } from '../../lib/supabase';
import { readErrorMessage } from '../../lib/opsData';
import { awaitingDelivery, receivedQuantity, type PurchaseQueue } from '../../lib/purchasingProgress';
import { useSharedRefresh } from '../../lib/useSharedRefresh';
import type { DeliveryDraft, PurchaseRequest } from '../../lib/platformTypes';
import KitchenArrivals from './KitchenArrivals';
import { DeliveryBatch } from './DeliveryBatch';
import { DeliveryDraftInbox } from './DeliveryDraftInbox';
import { useAccess } from '../../lib/access';
import { readArrivalDraft, readPendingArrival } from '../../lib/kitchenArrivalDraft';
import { DeliveryIssueInbox, ReportDeliveryIssue } from './DeliveryIssues';
import { ReceiptDeliveries } from './ReceiptDeliveries';
import { useSearchParams } from 'react-router-dom';
import { workRecordId } from '../../lib/kitchenWorkQueue';
import { deliveryRecoveryKey, readDeliveryRecovery } from '../../lib/deliveryRecovery';

export default function KitchenReceiving({ onSaved }: { onSaved?: () => Promise<void> }) {
  const {text:t}=useLanguage();
  const {profile,can}=useAccess();
  const [params,setParams]=useSearchParams(),resume=workRecordId(params.get('delivery'));
  const [resumeError,setResumeError]=useState('');
  const [queue,setQueue]=useState<PurchaseQueue|null>(null),[error,setError]=useState('');
  const [selected,setSelected]=useState<PurchaseRequest|null>(null),[direct,setDirect]=useState(params.get('resume')==='unlisted'),[page,setPage]=useState(0);
  const [draft,setDraft]=useState<DeliveryDraft|undefined>(),[revision,setRevision]=useState(0);
  const [receiptSource,setReceiptSource]=useState(false);
  const deviceResume=params.get('deviceDelivery');
  useEffect(()=>{if(!deviceResume||!profile?.id)return;try{if(!can('purchasing.receive'))throw Error('Receiving permission is required.');const d=readDeliveryRecovery(localStorage.getItem(deviceResume));if(!d||deliveryRecoveryKey(import.meta.env.VITE_SUPABASE_URL,profile.id,d.receiptSource,d.request.id)!==deviceResume)throw Error('This recovery does not belong to this account and project.');setReceiptSource(d.receiptSource);setDraft(d.draft??undefined);setSelected(d.request);setResumeError('');}catch(e){setResumeError(readErrorMessage(e,'Could not reopen the same delivery.'));}finally{setParams(previous=>{const next=new URLSearchParams(previous);next.delete('deviceDelivery');return next;},{replace:true});}},[deviceResume,profile?.id]);
  const [openedDirect,setOpenedDirect]=useState(params.get('resume')==='unlisted');
  useEffect(()=>{if(!resume)return;let active=true;void(async()=>{try{const r=await supabase.rpc('read_delivery_draft',{p_id:resume});if(r.error)throw r.error;
    if(active){if(r.data?.draft?.status!=='draft')setResumeError(t('This delivery is no longer awaiting confirmation. Check its history before entering it again.','Penghantaran ini tidak lagi menunggu pengesahan. Semak sejarah sebelum memasukkannya semula.'));else{setResumeError('');setDraft(r.data.draft);setSelected(r.data.request);}}
  }catch(e){if(active)setResumeError(readErrorMessage(e,'Could not open this same delivery draft.'));}finally{if(active)setParams(previous=>{const next=new URLSearchParams(previous);next.delete('delivery');return next;},{replace:true});}})();return()=>{active=false;};},[resume]);
  const [issueRequest,setIssueRequest]=useState<PurchaseRequest|null>(null);
  const [query,setQuery]=useState(''),[search,setSearch]=useState('');
  const [deviceDraft,setDeviceDraft]=useState<{supplier:string;date:string;count:number;attempted?:boolean}|null>(null);
  const storageKey=`kitchen-arrival:${import.meta.env.VITE_SUPABASE_URL??'review'}:${profile?.id}`;
  const readDeviceDraft=useCallback(()=>{
    try {
      const raw=localStorage.getItem(storageKey),dRaw=localStorage.getItem(storageKey+':draft');
      const pending=readPendingArrival(raw),draft=readArrivalDraft(dRaw);
      setDeviceDraft(pending?{supplier:pending.record.supplier,date:pending.record.date,count:pending.record.lines.length,attempted:pending.attempted}:draft?{supplier:draft.supplier,date:draft.date,count:Object.values(draft.entries).filter(e=>e.value.trim()).length}:null);
    }catch{setDeviceDraft({supplier:'',date:'',count:0});}
  },[storageKey]);
  useEffect(()=>{readDeviceDraft();window.addEventListener('storage',readDeviceDraft);return()=>window.removeEventListener('storage',readDeviceDraft);},[readDeviceDraft]);
  useEffect(()=>{if(query.trim()===search)return;const timer=window.setTimeout(()=>{setPage(0);setQueue(null);setSearch(query.trim());},250);return()=>window.clearTimeout(timer);},[query,search]);
  const sequence=useRef(0);
  const refresh=useCallback(async()=>{
    const ticket=++sequence.current;
    try {
    const r=await supabase.rpc('read_purchasing_queue',{p_view:'receiving',p_query:search,p_limit:25,p_offset:page*25});
    if(ticket!==sequence.current)return;
    if(r.error)throw r.error;
    if(page&&r.data.total<=page*25){setPage(Math.max(0,Math.ceil(r.data.total/25)-1));return;}
    setQueue(r.data);setError('');
    }catch(e){if(ticket===sequence.current)setError(readErrorMessage(e,t('Expected deliveries could not load.','Penghantaran dijangka tidak dapat dimuatkan.')));}
  },[page,search,t]);
  useEffect(()=>{void refresh();return()=>{sequence.current++;};},[refresh]);
  useSharedRefresh(refresh,{tables:['purchase_request_items','purchase_receipts'],intervalMs:15000});
  const saved=async()=>{setRevision(v=>v+1);await refresh();await onSaved?.();};
  return <>{openedDirect?<div hidden={!direct}><button className={secondaryButtonClass+' mb-3'} onClick={()=>setDirect(false)}><ArrowLeft size={16}/>{t('Expected Deliveries','Penghantaran Dijangka')}</button><KitchenArrivals active={direct} onDraftChange={readDeviceDraft} onSaved={saved}/></div>:null}<section className="supply-workspace" hidden={direct}>
    <div className="supply-toolbar"><h2>{t('Items Arrived','Barang Sampai')}</h2>{!deviceDraft?<button className={secondaryButtonClass} onClick={()=>{setOpenedDirect(true);setDirect(true);}}><Plus size={16}/>{t('Unlisted Delivery','Penghantaran Lain')}</button>:null}</div>
    {deviceDraft?<div className="arrival-resume"><div><strong>{deviceDraft.supplier||t('Unlisted Delivery','Penghantaran Lain')}</strong><small>{deviceDraft.date} · {deviceDraft.count} {t('Items','Item')}</small><small>{deviceDraft.attempted?t('Confirmation Not Verified','Status Pengesahan Belum Diketahui'):t('On This Device · Not Confirmed','Pada Peranti Ini · Belum Disahkan')}</small></div><button className={buttonClass} onClick={()=>{setOpenedDirect(true);setDirect(true);}}><FilePenLine size={16}/>{t('Resume Delivery','Sambung Penghantaran')}</button></div>:null}
    {error?<p role="alert" className="my-3 text-sm text-danger">{error} <button className="underline" onClick={()=>void refresh()}>{t('Retry','Cuba Lagi')}</button></p>:null}
    {resumeError?<p role="alert" className="my-2 text-sm text-danger">{resumeError}</p>:null}
    {!queue&&!error?<p role="status">{t('Loading Deliveries...','Memuatkan Penghantaran...')}</p>:null}
    <DeliveryDraftInbox revision={revision} onOpen={(d,r)=>{setDraft(d);setSelected(r);}}/>
    <DeliveryIssueInbox revision={revision}/>
    <label className="relative mb-3 block"><Search size={16} className="absolute left-3 top-3.5 text-muted"/><input type="search" className={inputClass+' pl-9'} maxLength={160} aria-label={t('Find Expected Delivery','Cari Penghantaran Dijangka')} placeholder={t('Supplier, Item or Request','Pembekal, Item atau Permintaan')} value={query} onChange={e=>setQuery(e.target.value)}/></label>
    <ReceiptDeliveries query={search} revision={revision} onSaved={saved}/>
    <ul className="divide-y divide-line border-y border-line">{queue?.requests.map(r=><li key={r.id} className="py-3">
      <div className="arrival-heading"><div><strong>{r.request_no}</strong><small>{t('Needed By','Diperlukan Pada')} {r.needed_for_date}</small></div><div className="arrival-actions"><button className={buttonClass} onClick={()=>setSelected(r)}><PackageCheck size={16}/>{t('Check Arrival','Semak Barang')}</button>{can('purchasing.receive')?<button className={secondaryButtonClass} onClick={()=>setIssueRequest(r)}><AlertTriangle size={16}/>{t('Report Issue','Lapor Masalah')}</button>:null}</div></div>
      <ul className="mt-2 text-sm">{r.purchase_request_items?.filter(awaitingDelivery).map(i=><li key={i.id} className="flex justify-between gap-3 py-1"><span className="min-w-0 break-words">{i.item_name}{i.supplier?<small className="block text-muted">{i.supplier}</small>:null}</span><strong className="shrink-0 tabular">{Math.round((Number(i.purchased_quantity)-receivedQuantity(i))*100)/100} {i.unit}</strong></li>)}</ul>
    </li>)}</ul>
    {queue&&!queue.total?<p className="py-3 text-xs text-muted">{search?t('No matching request-linked deliveries.','Tiada penghantaran permintaan sepadan.'):t('No request-linked purchases awaiting arrival.','Tiada pembelian permintaan menunggu ketibaan.')}</p>:null}
    {queue&&queue.total>25?<div className="mt-3 flex items-center justify-between gap-2"><button className={secondaryButtonClass} disabled={!page} onClick={()=>setPage(v=>v-1)}>{t('Previous','Sebelum')}</button><span className="text-sm">{page+1} / {Math.ceil(queue.total/25)}</span><button className={secondaryButtonClass} disabled={(page+1)*25>=queue.total} onClick={()=>setPage(v=>v+1)}>{t('Next','Seterusnya')}</button></div>:null}
    {selected?<DeliveryBatch key={profile?.id+':'+selected.id} receiptSource={receiptSource} request={selected} initialDraft={draft} onClose={()=>{setSelected(null);setDraft(undefined);setReceiptSource(false);void saved();}} onSaved={()=>void saved()}/>:null}
    {issueRequest?<ReportDeliveryIssue request={issueRequest} onClose={()=>{setIssueRequest(null);void saved();}} onSaved={()=>void saved()}/>:null}
  </section></>;
}
