import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronLeft, ChevronRight, FilePenLine, MessageSquare, RefreshCw, Send, Trash2 } from 'lucide-react';
import { Field, buttonClass, iconButtonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { useAccess } from '../../lib/access';
import { useLanguage } from '../../lib/language';
import { readErrorMessage } from '../../lib/opsData';
import { isDemoMode, supabase } from '../../lib/supabase';
import { useSharedRefresh } from '../../lib/useSharedRefresh';
import { awaitingDelivery, receivedQuantity } from '../../lib/purchasingProgress';
import { deliveryIssueInput, receiptDeliveryIssueInput, deliveryIssueKinds, deliveryIssueLabels, type DeliveryIssue, type DeliveryIssueInput, type DeliveryIssueUpdate } from '../../lib/deliveryIssues';
import type { PurchaseRequest } from '../../lib/platformTypes';
import { deliveryTime } from './DeliveryRecord';
import { definitiveInitialSaveFailure } from '../../lib/saveAttempt';

type IssueDraft = { id: string; request: PurchaseRequest; receiptSource?: boolean; itemId: string; kind: string; quantity: string; note: string; updatedAt: string; attempt?: DeliveryIssueInput; removal?: {data: Record<string, unknown>; reason: string} };
const draftEvent = 'delivery-issue-draft-change';
const prefix = (actor: string) => `delivery-issue:${isDemoMode ? 'preview' : import.meta.env.VITE_SUPABASE_URL}:${actor}:`;
const quantityText = (n: number) => n.toLocaleString('en-MY', { maximumFractionDigits: 4 });

export function ReportDeliveryIssue({ request, receiptSource = false, onClose, onSaved }: { request: PurchaseRequest; receiptSource?: boolean; onClose: () => void; onSaved: () => void }) {
  const { text: t, language } = useLanguage(), { profile } = useAccess();
  const key = prefix(profile!.id) + (receiptSource ? 'receipt:' : '') + request.id;
  const [storageError, setStorageError] = useState('');
  const [form, setForm] = useState<IssueDraft>(() => {
    try { const saved = JSON.parse(localStorage.getItem(key) ?? 'null'); if (saved?.request?.id === request.id && saved.id) return saved; } catch { /* Keep the form accessible if device storage is unavailable. */ }
    return { id: crypto.randomUUID(), request, receiptSource, itemId: '', kind: '', quantity: '', note: '', updatedAt: new Date().toISOString() };
  });
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState<DeliveryIssue | null>(null);
  const [stale, setStale] = useState(false);
  const [removing,setRemoving]=useState(!!form.removal),[removeReason,setRemoveReason]=useState(form.removal?.reason??''),[removedAt,setRemovedAt]=useState('');
  const [currentRequest, setCurrentRequest] = useState(request), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  const [openIssues,setOpenIssues]=useState<DeliveryIssue[]>([]),[existingIssue,setExistingIssue]=useState<DeliveryIssue|null>(null),[viewUpdates,setViewUpdates]=useState<DeliveryIssue|null>(null);
  const sending = useRef(false);
  const items = currentRequest.purchase_request_items?.filter(i=>awaitingDelivery(i)||openIssues.some(issue=>(receiptSource?issue.receipt_line_id:issue.item_id)===i.id)) ?? [];
  const item = items.find(i => i.id === form.itemId);
  const precision = receiptSource ? 10000 : 100;
  const remaining = item ? Math.round((Number(item.purchased_quantity) - receivedQuantity(item)) * precision) / precision : 0;
  const parsed = (receiptSource ? receiptDeliveryIssueInput : deliveryIssueInput).safeParse({ item_id: form.itemId, kind: form.kind, quantity: Number(form.quantity), note: form.note,
    expected_updated_at: item?.updated_at ?? '', expected_received_quantity: item ? receivedQuantity(item) : 0 });
  const issueItemId=(issue:DeliveryIssue)=>receiptSource?issue.receipt_line_id:issue.item_id;
  const alreadyReported=openIssues.find(issue=>issueItemId(issue)===form.itemId);
  const valid = parsed.success && !!item && parsed.data.quantity <= remaining && !alreadyReported && !existingIssue;
  function store(next: IssueDraft) {
    setForm(next);
    try { const existing=JSON.parse(localStorage.getItem(key)??'null');if(existing?.id&&existing.id!==next.id){setStorageError(t('Another draft was started in this browser. Close and resume that draft before continuing.','Draf lain dimulakan dalam pelayar ini. Tutup dan sambung draf tersebut dahulu.'));return false;}localStorage.setItem(key, JSON.stringify(next)); window.dispatchEvent(new Event(draftEvent)); setStorageError(''); return true; }
    catch { setStorageError(t('Device draft could not save. Keep this window open and free browser storage.', 'Draf peranti gagal disimpan. Kekalkan tetingkap ini dan kosongkan storan pelayar.')); return false; }
  }
  function removeLocalDraft(){try{if(JSON.parse(localStorage.getItem(key)??'null')?.id===form.id)localStorage.removeItem(key);window.dispatchEvent(new Event(draftEvent));}catch{/* Server records still protect retries if device cleanup fails. */}}
  function update(patch: Partial<IssueDraft>) { if (!sending.current && !form.attempt) store({ ...form, ...patch, request: currentRequest, updatedAt: new Date().toISOString() }); }
  useEffect(() => {
    let active = true; setLoading(true);
    void (async () => { try {
      const r = await supabase.rpc(receiptSource ? 'read_receipt_delivery_issue' : 'read_delivery_issue_request', { [receiptSource ? 'p_receipt_id' : 'p_request_id']: request.id, p_draft_id:form.id }); if (r.error) throw r.error;
      if (!active) return; setCurrentRequest(r.data);
      if(r.data.saved_issue||r.data.removed_draft){setLoading(false);setStale(false);setRemoving(false);if(r.data.saved_issue)setSaved(r.data.saved_issue);else setRemovedAt(r.data.removed_draft.removed_at);removeLocalDraft();return;}
      const lookup=await supabase.rpc('read_delivery_source_issues',{[receiptSource?'p_receipt_id':'p_request_id']:request.id});if(lookup.error)throw lookup.error;
      if(!active)return;
      if(!Array.isArray(lookup.data))throw new Error(t('Could not check existing reports. Retry before sending.','Laporan sedia ada gagal disemak. Cuba lagi sebelum hantar.'));
      const issues=lookup.data as DeliveryIssue[];setOpenIssues(issues);setLoading(false);
      if(!form.attempt&&!form.removal){
        setExistingIssue(current=>issues.find(i=>i.id===current?.id)||issues.find(i=>issueItemId(i)===form.itemId)||null);
        if(issues.some(i=>issueItemId(i)===form.itemId)){setError('');setStale(false);}
      }
      const old = form.request.purchase_request_items?.find(i=>i.id===form.itemId), next = (r.data as PurchaseRequest).purchase_request_items?.find(i=>i.id===form.itemId);
      if (!form.attempt && !form.removal && form.itemId && (!next || next.item_name!==old?.item_name || next.unit!==old?.unit)) {
        store({ ...form, request:r.data, quantity:'', itemId:next?form.itemId:'' });
        setError(t('The item or unit changed. Check it and enter the affected quantity again.', 'Item atau unit berubah. Semak dan isi semula kuantiti terjejas.'));
      }
    } catch(e) { if(active)setError(readErrorMessage(e,t('Could not refresh the delivery. Retry before sending.', 'Penghantaran gagal dimuatkan. Cuba lagi sebelum hantar.'))); } })();
    return ()=>{active=false;};
  }, [request.id,receiptSource,retry]);
  async function send() {
    if (sending.current || form.removal || (!form.attempt && (!valid || loading))) return;
    const attempt = form.attempt ?? (parsed.success ? parsed.data : undefined); if (!attempt) return;
    if (!store({ ...form, attempt })) return;
    sending.current = true; setBusy(true); setError('');
    try {
      const result = await supabase.rpc(receiptSource ? 'report_receipt_delivery_issue' : 'report_delivery_issue', { p_id: form.id, p_data: attempt, ...(receiptSource ? {p_receipt_id:request.id} : {}) });
      if (result.error) throw result.error;
      if (!result.data?.id) throw new Error(t('Submission not verified. Retry the same report.', 'Penghantaran belum disahkan. Cuba laporan yang sama.'));
      setSaved(result.data);
      removeLocalDraft();
      onSaved();
    } catch (e) {
      setError(readErrorMessage(e, t('Submission not verified. Retry the same report.', 'Penghantaran belum disahkan. Cuba laporan yang sama.')));
      if (definitiveInitialSaveFailure(!!form.attempt, e)) store({ ...form, attempt: undefined });
      if ((e as { code?: string }).code === '40001') { setStale(true); setRetry(n=>n+1); onSaved(); }
    } finally { sending.current = false; setBusy(false); }
  }
  async function removeDraft(){
    if(sending.current||form.attempt||!removeReason.trim())return;
    const original=form.request.purchase_request_items?.find(i=>i.id===form.itemId);
    const removal=form.removal??{reason:removeReason.trim(),data:{...(receiptSource?{receipt_id:request.id,receipt_line_id:form.itemId}:{request_id:request.id,item_id:form.itemId}),request_no:request.request_no,item_name:original?.item_name??'',unit:original?.unit??'',kind:form.kind,quantity:form.quantity,note:form.note,device_updated_at:form.updatedAt}};
    if(!store({...form,removal}))return;
    sending.current=true;setBusy(true);setError('');
    try{
      const r=await supabase.rpc('remove_delivery_issue_draft',{p_id:form.id,p_data:removal.data,p_reason:removal.reason});if(r.error)throw r.error;
      if(!r.data?.removed_at)throw new Error(t('Removal not verified. Retry this removal.','Pembuangan belum disahkan. Cuba semula.'));
      setRemovedAt(r.data.removed_at);removeLocalDraft();onSaved();
    }catch(e){setError(readErrorMessage(e,t('Removal not verified. Retry this removal.','Pembuangan belum disahkan. Cuba semula.')));if((e as {code?:string}).code==='40001'){setStale(true);setRetry(n=>n+1);}else if(definitiveInitialSaveFailure(!!form.removal,e))store({...form,removal:undefined});}
    finally{sending.current=false;setBusy(false);}
  }
  if(viewUpdates)return <DeliveryIssueFollowUp initial={viewUpdates} onClose={()=>{setViewUpdates(null);setRetry(n=>n+1);onSaved();}}/>;
  return <Modal title={removedAt?t('Draft Removed','Draf Dibuang'):removing?t('Remove Unsent Draft?','Buang Draf Belum Dihantar?'):saved ? t('Issue Sent', 'Laporan Dihantar') : t('Report Delivery Issue', 'Lapor Masalah Penghantaran')} onClose={() => { if (!busy) onClose(); }} footer={existingIssue&&!form.attempt&&!removing&&!saved&&!removedAt?<div className="grid gap-2">{form.quantity||form.note?<p className="text-xs text-muted">{t('Your unsent draft is kept on this device.','Draf belum dihantar anda disimpan pada peranti ini.')}</p>:null}<button className={buttonClass+' w-full'} onClick={onClose}>{t('Done','Selesai')}</button></div>:saved || stale || removedAt ?
    <button className={buttonClass+' w-full'} onClick={onClose}>{stale ? t('Close & Refresh', 'Tutup & Muat Semula') : t('Done', 'Selesai')}</button> :
    removing?<div className="grid grid-cols-2 gap-2"><button className={secondaryButtonClass} disabled={busy||!!form.removal} onClick={()=>setRemoving(false)}>{t('Keep Draft','Simpan Draf')}</button><button className={buttonClass} disabled={busy||!removeReason.trim()} onClick={()=>void removeDraft()}>{form.removal?t('Retry Removal','Cuba Buang Semula'):t('Remove Draft','Buang Draf')}</button></div>:
    <div className="grid gap-2"><p className="text-xs text-muted">{form.attempt ? t('Submission Unverified · Retry This Report', 'Penghantaran Belum Disahkan · Cuba Laporan Ini') : t('Device Draft · Not Sent', 'Draf Peranti · Belum Dihantar')}</p>
      <div className="flex flex-wrap justify-between gap-2"><div className="flex gap-2"><button className={secondaryButtonClass} disabled={busy} onClick={onClose}>{t('Save & Close', 'Simpan & Tutup')}</button>{!form.attempt?<button className={iconButtonClass} aria-label={t('Remove Draft','Buang Draf')} title={t('Remove Draft','Buang Draf')} disabled={busy} onClick={()=>{setRemoving(true);setError('');}}><Trash2 size={16}/></button>:null}</div><button className={buttonClass} disabled={busy || (!form.attempt && (!valid || loading))} onClick={() => void send()}><Send size={16}/>{busy ? t('Sending...', 'Menghantar...') : form.attempt ? t('Retry Submission', 'Cuba Hantar Semula') : t('Send Issue', 'Hantar Laporan')}</button></div></div>}>
    {removedAt?<div className="grid gap-3 text-sm"><p>{t('Original draft and removal reason retained in the audit log. No stock changed.','Draf asal dan sebab pembuangan disimpan dalam log audit. Tiada perubahan stok.')}</p><p>{profile?.full_name} · {deliveryTime(removedAt,language)} MYT</p></div>:removing?<div className="grid gap-3"><p className="text-sm">{t('This report has not been sent. Its original details, your name and removal time will remain in the audit log.','Laporan ini belum dihantar. Butiran asal, nama anda dan masa pembuangan kekal dalam log audit.')}</p><Field label={t('Removal Reason','Sebab Pembuangan')}><textarea className={inputClass} aria-label={t('Removal Reason','Sebab Pembuangan')} rows={3} maxLength={500} disabled={busy||!!form.removal} value={removeReason} onChange={e=>setRemoveReason(e.target.value)}/></Field>{error||storageError?<p role="alert" className="text-sm text-danger">{error||storageError}</p>:null}</div>:saved ? <div className="grid gap-3 text-sm"><p role="status" className="font-semibold text-palm">{isDemoMode ? t('Saved in Local Preview', 'Disimpan dalam Pratonton Setempat') : t('Sent to Purchasing', 'Dihantar ke Pembelian')}</p><IssueDetails issue={saved}/><p className="text-muted">{t('No stock or purchase amounts changed.', 'Tiada perubahan stok atau jumlah pembelian.')}</p></div> : <>
      <p className="mb-3 text-sm font-semibold break-words">{receiptSource?t('Receipt','Resit')+' ':''}{request.request_no}</p>
      {loading?<p className="mb-3 text-xs text-muted">{t('Checking Latest Delivery...', 'Menyemak Penghantaran Terkini...')} <button className="underline" onClick={()=>{setError('');setRetry(n=>n+1);}}>{t('Retry','Cuba Lagi')}</button></p>:null}
      <fieldset className="grid gap-3 min-w-0" disabled={busy || loading || !!form.attempt || stale}>
        <Field label={t('Item', 'Item')}><select className={inputClass} aria-label={t('Affected Item', 'Item Terjejas')} value={existingIssue?issueItemId(existingIssue)??'':form.itemId} onChange={e => {
          const existing=openIssues.find(i=>issueItemId(i)===e.target.value);setExistingIssue(existing??null);
          if(!existing)update({itemId:e.target.value,quantity:''});
        }}><option value="">{t('Choose Item', 'Pilih Item')}</option>{items.map(i => <option key={i.id} value={i.id}>{i.item_name} ({i.unit}){openIssues.some(issue=>issueItemId(issue)===i.id)?' · '+t('Already Reported','Sudah Dilaporkan'):''}</option>)}</select></Field>
        {existingIssue&&!form.attempt?<section className="delivery-existing-issue" aria-label={t('Existing Report','Laporan Sedia Ada')}>
          <div className="flex items-center justify-between gap-2"><h3>{t('Already Reported','Sudah Dilaporkan')}</h3><button className={iconButtonClass} aria-label={t('Refresh Report','Muat Semula Laporan')} title={t('Refresh Report','Muat Semula Laporan')} onClick={()=>{setError('');setRetry(n=>n+1);}}><RefreshCw size={16}/></button></div>
          <IssueDetails issue={existingIssue}/>
          {!!existingIssue.update_count?<button className={secondaryButtonClass+' mt-3'} onClick={()=>setViewUpdates(existingIssue)}><MessageSquare size={16}/>{t('Updates','Kemaskini')} ({existingIssue.update_count})</button>:null}
        </section>:<>
        <div className="delivery-issue-kinds" role="group" aria-label={t('Issue Type', 'Jenis Masalah')}>{deliveryIssueKinds.map(kind => <button key={kind} type="button" aria-pressed={form.kind === kind} onClick={() => update({ kind })}>{t(deliveryIssueLabels[kind][0],deliveryIssueLabels[kind][1])}</button>)}</div>
        <Field label={t('Affected Quantity', 'Kuantiti Terjejas')+(item ? ' ('+item.unit+')' : '')}><input className={inputClass} aria-label={t('Affected Quantity', 'Kuantiti Terjejas')} inputMode="decimal" maxLength={12} value={form.quantity} onChange={e => update({ quantity: e.target.value })}/></Field>
        {item ? <p className="text-xs text-muted">{t('Still To Receive', 'Belum Diterima')}: {quantityText(remaining)} {item.unit}</p> : null}
        {!!form.quantity && (!parsed.success || Number(form.quantity)>remaining) ? <p className="text-xs text-danger">{t('Check the quantity and unit. Do not exceed the remaining delivery.', 'Semak kuantiti dan unit. Jangan melebihi baki penghantaran.')}</p> : null}
        <Field label={t('Details (Optional)', 'Butiran (Pilihan)')}><textarea className={inputClass} aria-label={t('Issue Details', 'Butiran Masalah')} rows={3} maxLength={500} value={form.note} onChange={e => update({ note: e.target.value })}/></Field>
        </>}
      </fieldset>
      {!existingIssue?<p className="mt-3 text-xs text-muted">{t('Only goods not accepted into stock. For losses after receiving, use Waste / Other.', 'Hanya barang belum diterima ke stok. Untuk kehilangan selepas penerimaan, guna Sisa / Lain.')}</p>:null}
      {storageError ? <p role="alert" className="mt-3 text-sm text-danger">{storageError}</p> : null}
      {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
    </>}
  </Modal>;
}

function IssueDetails({ issue, showUpdate = true }: { issue: DeliveryIssue; showUpdate?: boolean }) {
  const { text: t, language } = useLanguage();
  return <div className="min-w-0 grid gap-1 text-sm"><strong className="break-words">{issue.item_name} · {quantityText(Number(issue.quantity))} {issue.unit}</strong><span className="text-warning text-xs font-semibold">{t(deliveryIssueLabels[issue.kind][0],deliveryIssueLabels[issue.kind][1])}</span>
    <span className="text-xs text-muted break-words">{issue.receipt_id?t('Receipt','Resit')+' ':''}{issue.request_no}{issue.supplier ? ' · '+(issue.receipt_id?t('Supplier','Pembekal'):t('Last Supplier', 'Pembekal Terakhir'))+': '+issue.supplier : ''}</span>
    {issue.note ? <p className="break-words">{issue.note}</p> : null}
    <span className="text-xs text-muted break-words">{issue.created_by_name} · {deliveryTime(issue.created_at, language)} MYT</span>
    {showUpdate && issue.latest_update ? <div className="delivery-issue-update"><small>{t('Latest Update','Kemaskini Terkini')}</small><p>{issue.latest_update.note}</p><small>{issue.latest_update.created_by_name} · {deliveryTime(issue.latest_update.created_at,language)} MYT</small></div> : null}
    {issue.status === 'closed' ? <div className="border-l-2 border-line pl-2 mt-1"><p className="break-words">{issue.resolution}</p><small className="text-muted break-words">{t('Closed By', 'Ditutup Oleh')} {issue.closed_by_name} · {deliveryTime(issue.closed_at!, language)} MYT</small></div> : null}
  </div>;
}

export function DeliveryIssueInbox({ revision = 0 }: { revision?: number }) {
  const { text: t } = useLanguage(), { can, profile } = useAccess();
  const [status, setStatus] = useState<'open' | 'closed'>('open'), [page, setPage] = useState(0);
  const [result, setResult] = useState<{ records: DeliveryIssue[]; total: number; open: number; closed: number } | null>(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(false), [edit, setEdit] = useState<DeliveryIssue | null>(null);
  const [drafts, setDrafts] = useState<IssueDraft[]>([]), [resume, setResume] = useState<IssueDraft | null>(null);
  const [followUps,setFollowUps]=useState<FollowUpDraft[]>([]);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const ticket = ++generation.current; setLoading(true);
    try {
      const r = await supabase.rpc('read_delivery_issues', { p_status: status, p_limit: 5, p_offset: page*5 });
      if (ticket !== generation.current) return;
      if (r.error) throw r.error;
      if (page && r.data.total <= page*5) { setPage(Math.max(0, Math.ceil(r.data.total/5)-1)); return; }
      setResult(r.data); setError('');
    } catch (e) { if (ticket === generation.current) setError(readErrorMessage(e, t('Delivery issues could not load.', 'Laporan penghantaran gagal dimuatkan.'))); }
    finally { if (ticket === generation.current) setLoading(false); }
  }, [status, page, t]);
  useEffect(() => { void refresh(); return () => { generation.current++; }; }, [refresh, revision]);
  useSharedRefresh(refresh, { tables: ['delivery_issues'], intervalMs: 15000 });
  useEffect(() => {
    const read = () => { if (!profile) return; try {
      const own: IssueDraft[] = [],updates:FollowUpDraft[]=[];
      for (let i=0;i<localStorage.length;i++) { const key=localStorage.key(i)!;
        if (can('purchasing.receive')&&key.startsWith(prefix(profile.id))) { const d=JSON.parse(localStorage.getItem(key)!); if (d?.id && d.request?.id) own.push(d); }
        if ((can('purchasing.fulfil')||can('purchasing.manage'))&&key.startsWith(followUpPrefix(profile.id))) { const d=JSON.parse(localStorage.getItem(key)!);if(d?.id&&d.issue?.id&&(d.note||d.attempt))updates.push(d); }
      }
      setDrafts(own);setFollowUps(updates);
    } catch { setError(t('Unsent reports could not load. Check this device before starting another report.', 'Laporan belum dihantar gagal dimuatkan. Semak peranti sebelum membuat laporan lain.')); } };
    read(); window.addEventListener(draftEvent,read); window.addEventListener('storage',read); return () => { window.removeEventListener(draftEvent,read); window.removeEventListener('storage',read); };
  }, [profile, can, t]);
  if (!result?.open && !result?.closed && !error && !drafts.length && !followUps.length) return null;
  return <section className="delivery-issues" aria-label={t('Delivery Issues','Masalah Penghantaran')}>
    <div className="supply-toolbar"><h2 className="flex items-center gap-2"><AlertTriangle size={16}/>{t('Delivery Issues','Masalah Penghantaran')}</h2><button className={iconButtonClass} aria-label={t('Refresh Issues','Muat Semula Laporan')} title={t('Refresh Issues','Muat Semula Laporan')} disabled={loading} onClick={()=>void refresh()}><RefreshCw size={16}/></button></div>
    {drafts.map(d=><div key={d.id} className="delivery-issue-row"><span className="min-w-0"><strong className="text-sm break-words">{d.receiptSource?t('Receipt','Resit')+' ':''}{d.request.request_no}</strong><small className="block text-muted">{d.attempt?t('Submission Unverified','Penghantaran Belum Disahkan'):t('Device Draft · Not Sent','Draf Peranti · Belum Dihantar')}</small></span><button className={secondaryButtonClass} onClick={()=>setResume(d)}><FilePenLine size={16}/>{t('Resume','Sambung')}</button></div>)}
    {followUps.map(d=><div key={d.id} className="delivery-issue-row"><span className="min-w-0"><strong className="text-sm break-words">{d.issue.item_name}</strong><small className="block text-muted">{d.attempt?t('Update Unverified','Kemaskini Belum Disahkan'):t('Device Update · Not Sent','Kemaskini Peranti · Belum Dihantar')}</small></span><button className={secondaryButtonClass} onClick={()=>setEdit(d.issue)}><FilePenLine size={16}/>{t('Resume Update','Sambung Kemaskini')}</button></div>)}
    {result&&(result.open+result.closed)>0?<div className="supply-segments mb-2" role="group" aria-label={t('Issue Status','Status Laporan')}>{(['open','closed'] as const).map(s=><button key={s} aria-pressed={status===s} disabled={loading} onClick={()=>{setStatus(s);setPage(0);}}>{s==='open'?t('Open','Terbuka'):t('Closed','Ditutup')} ({result[s]})</button>)}</div>:null}
    {error?<p role="alert" className="text-sm text-danger">{error}</p>:null}
    <ul>{result?.records.map(issue=><li key={issue.id} className="delivery-issue-row"><IssueDetails issue={issue}/>{(issue.update_count||issue.status==='open'&&(can('purchasing.fulfil')||can('purchasing.manage')))?<button className={secondaryButtonClass} onClick={()=>setEdit(issue)}><MessageSquare size={16}/>{issue.status==='open'&&(can('purchasing.fulfil')||can('purchasing.manage'))?t('Follow Up','Susulan'):t('Updates','Kemaskini')+' ('+issue.update_count+')'}</button>:null}</li>)}</ul>
    {result&&!result.total?<p className="py-2 text-xs text-muted">{t('No issues in this view.','Tiada laporan dalam paparan ini.')}</p>:null}
    {result&&result.total>5?<div className="flex items-center justify-between gap-2 text-xs mt-2"><span>{page*5+1}-{Math.min(page*5+5,result.total)} / {result.total}</span><div className="flex gap-2"><button className={iconButtonClass} aria-label={t('Previous Issues','Laporan Sebelumnya')} disabled={!page||loading} onClick={()=>setPage(p=>p-1)}><ChevronLeft size={16}/></button><button className={iconButtonClass} aria-label={t('Next Issues','Laporan Seterusnya')} disabled={loading||(page+1)*5>=result.total} onClick={()=>setPage(p=>p+1)}><ChevronRight size={16}/></button></div></div>:null}
    {resume?<ReportDeliveryIssue request={resume.request} receiptSource={resume.receiptSource} onClose={()=>{setResume(null);void refresh();}} onSaved={()=>void refresh()}/>:null}
    {edit?<DeliveryIssueFollowUp key={edit.id} initial={edit} onClose={()=>{setEdit(null);void refresh();}}/>:null}
  </section>;
}

type FollowUpAttempt = { id:string; version:number; note:string; action:'update'|'resolve' };
type FollowUpDraft = { id:string; issue:DeliveryIssue; note:string; attempt?:FollowUpAttempt };
const followUpPrefix=(actor:string)=>`delivery-issue-followup:${isDemoMode?'preview':import.meta.env.VITE_SUPABASE_URL}:${actor}:`;
function DeliveryIssueFollowUp({initial,onClose}:{initial:DeliveryIssue;onClose:()=>void}) {
  const {text:t,language}=useLanguage(),{can,profile}=useAccess();
  const key=followUpPrefix(profile!.id)+initial.id,stored=useRef<string|null>(null);
  const [draft,setDraft]=useState<FollowUpDraft>(()=>{
    try{stored.current=localStorage.getItem(key);const d=JSON.parse(stored.current??'null');if(d?.id&&d.issue?.id===initial.id&&typeof d.note==='string')return d;}catch{/* Keep unsaved text in the open dialog if storage is unavailable. */}
    return {id:crypto.randomUUID(),issue:initial,note:''};
  });
  const [issue,setIssue]=useState(initial),[updates,setUpdates]=useState<DeliveryIssueUpdate[]>([]),[total,setTotal]=useState(0),[page,setPage]=useState(0);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[storageError,setStorageError]=useState(''),[retry,setRetry]=useState(0);
  const sending=useRef(false),editable=can('purchasing.fulfil')||can('purchasing.manage');
  useEffect(()=>{let active=true;setLoading(true);void(async()=>{try{
    const r=await supabase.rpc('read_delivery_issue_updates',{p_issue_id:initial.id,p_limit:5,p_offset:page*5});if(r.error)throw r.error;
    if(active){setIssue(r.data.issue);setUpdates(r.data.records);setTotal(r.data.total);setLoading(false);}
  }catch(e){if(active)setError(readErrorMessage(e,t('Could not load updates. Retry before saving.','Kemaskini gagal dimuatkan. Cuba lagi sebelum simpan.')));}})();return()=>{active=false;};},[initial.id,page,retry,t]);
  function store(next:FollowUpDraft){
    setDraft(next);
    try{if(localStorage.getItem(key)!==stored.current)throw new Error(t('This draft changed in another tab. Close and resume it.','Draf ini berubah dalam tab lain. Tutup dan sambung semula.'));
      const raw=JSON.stringify(next);localStorage.setItem(key,raw);stored.current=raw;setStorageError('');window.dispatchEvent(new Event(draftEvent));return true;
    }catch(e){setStorageError(readErrorMessage(e,t('Device draft could not save. Keep this window open.','Draf peranti gagal disimpan. Kekalkan tetingkap ini.')));return false;}
  }
  async function save(action:'update'|'resolve'){
    if(sending.current||!editable||(!draft.attempt&&(loading||issue.status!=='open'||!draft.note.trim())))return;
    const attempt=draft.attempt??{id:crypto.randomUUID(),version:issue.version,note:draft.note.trim(),action};
    if(!store({...draft,attempt}))return;
    sending.current=true;setBusy(true);setError('');
    try{
      const r=attempt.action==='update'?await supabase.rpc('add_delivery_issue_update',{p_id:attempt.id,p_issue_id:issue.id,p_version:attempt.version,p_note:attempt.note}):
        await supabase.rpc('close_delivery_issue',{p_id:issue.id,p_version:attempt.version,p_resolution:attempt.note});
      if(r.error)throw r.error;if(!r.data?.id)throw new Error(t('Save not verified. Retry the same update.','Simpanan belum disahkan. Cuba kemaskini yang sama.'));
      try{if(localStorage.getItem(key)===stored.current)localStorage.removeItem(key);window.dispatchEvent(new Event(draftEvent));}catch{/* The same attempt remains safe to retry. */}
      onClose();
    }catch(e){setError(readErrorMessage(e,t('Save not verified. Retry the same update.','Simpanan belum disahkan. Cuba kemaskini yang sama.')));
      if((e as {code?:string}).code==='40001'||definitiveInitialSaveFailure(!!draft.attempt,e)){store({...draft,attempt:undefined});setRetry(n=>n+1);}
    }finally{sending.current=false;setBusy(false);}
  }
  const canWrite=editable&&issue.status==='open';
  return <Modal title={t('Delivery Follow-up','Susulan Penghantaran')} onClose={()=>{if(!busy)onClose();}} footer={editable&&(canWrite||draft.attempt)?<div className="grid gap-2">
    <p className="text-xs text-muted">{draft.attempt?t('Save Unverified · Retry This Update','Simpanan Belum Disahkan · Cuba Kemaskini Ini'):t('Device Draft · Not Sent','Draf Peranti · Belum Dihantar')}</p>
    {draft.attempt?<button className={buttonClass+' w-full'} disabled={busy} onClick={()=>void save(draft.attempt!.action)}>{busy?t('Saving...','Menyimpan...'):draft.attempt.action==='update'?t('Retry Update','Cuba Kemaskini Semula'):t('Retry Resolution','Cuba Penyelesaian Semula')}</button>:
      <div className="delivery-followup-actions"><button className={buttonClass} disabled={busy||loading||!draft.note.trim()} onClick={()=>void save('update')}><MessageSquare size={16}/>{t('Save Update','Simpan Kemaskini')}</button><button className={secondaryButtonClass} disabled={busy||loading||!draft.note.trim()} onClick={()=>void save('resolve')}><Check size={16}/>{t('Resolve Issue','Selesaikan Masalah')}</button></div>}
  </div>:<button className={buttonClass+' w-full'} onClick={onClose}>{t('Done','Selesai')}</button>}>
    <IssueDetails issue={issue} showUpdate={false}/>
    {loading?<p role="status" className="text-sm mt-3">{t('Loading Updates...','Memuatkan Kemaskini...')} <button className="underline" onClick={()=>{setError('');setRetry(n=>n+1);}}>{t('Retry','Cuba Lagi')}</button></p>:null}
    {canWrite||draft.note?<div className="mt-4"><Field label={t('Follow-up / Outcome','Susulan / Keputusan')}><textarea className={inputClass} aria-label={t('Follow-up / Outcome','Susulan / Keputusan')} rows={3} maxLength={500} disabled={!canWrite||loading||busy||!!draft.attempt} value={draft.note} onChange={e=>store({...draft,note:e.target.value})}/></Field>
      <p className="mt-2 text-xs text-muted">{canWrite?t('Save Update keeps this issue open. Resolve only when settled; stock and refunds are recorded separately.','Simpan Kemaskini mengekalkan masalah terbuka. Selesaikan apabila selesai; stok dan bayaran balik direkod berasingan.'):t('This issue is resolved. Your unsent note is kept on this device.','Masalah ini telah selesai. Nota belum dihantar disimpan pada peranti ini.')}</p></div>:null}
    {error||storageError?<p role="alert" className="text-danger text-sm mt-3">{error||storageError}</p>:null}
    {total>0?<section className="delivery-followup-history" aria-label={t('Update History','Sejarah Kemaskini')}><h3>{t('Updates','Kemaskini')} ({total})</h3><ol>{updates.map(u=><li key={u.id}><p>{u.note}</p><small>{u.created_by_name} · {deliveryTime(u.created_at,language)} MYT</small></li>)}</ol>
      {total>5?<div className="flex justify-between items-center gap-2 mt-2"><span className="text-xs">{page*5+1}-{Math.min(total,page*5+5)} / {total}</span><div className="flex gap-2"><button className={iconButtonClass} aria-label={t('Newer Updates','Kemaskini Lebih Baharu')} disabled={loading||!page} onClick={()=>setPage(p=>p-1)}><ChevronLeft size={16}/></button><button className={iconButtonClass} aria-label={t('Older Updates','Kemaskini Terdahulu')} disabled={loading||(page+1)*5>=total} onClick={()=>setPage(p=>p+1)}><ChevronRight size={16}/></button></div></div>:null}</section>:null}
  </Modal>;
}
