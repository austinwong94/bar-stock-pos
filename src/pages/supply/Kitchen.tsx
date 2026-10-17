import { useSharedRefresh } from '../../lib/useSharedRefresh';
import { useCallback, useEffect, useState } from 'react';
import { Copy, Eye, FilePenLine, Plus } from 'lucide-react';
import { Stat } from '../../components/Page';
import { buttonClass, secondaryButtonClass } from '../../components/Form';
import { useToast } from '../../components/Toast';
import { isDemoMode, supabase } from '../../lib/supabase';
import { useAccess } from '../../lib/access';
import { readErrorMessage } from '../../lib/opsData';
import { useLanguage } from '../../lib/language';
import { KitchenRequestReview } from './KitchenRequestReview';
import { KitchenHeader } from '../../components/KitchenHeader';
import { requestProgress } from '../../lib/purchasingProgress';
import type { PurchaseRequest } from '../../lib/platformTypes';
import { KitchenRequestForm } from './KitchenRequestForm';
import { latestRequestList, requestDraftList } from '../../lib/kitchenRequestDraft';
import { useSearchParams } from 'react-router-dom';
import { workRecordId } from '../../lib/kitchenWorkQueue';

export const requestStatusLabels: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  buying: 'Purchasing',
  completed: 'Purchased',
  cancelled: 'Cancelled',
};

export default function Kitchen() {
  const toast = useToast();
  const { text } = useLanguage();
  const { can, profile, reloadBadges } = useAccess();
  const [params,setParams]=useSearchParams();
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [editing, setEditing] = useState<PurchaseRequest | null>(null);
  const [repeat, setRepeat] = useState<PurchaseRequest | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const draftPrefix = `kitchen-request-draft:${import.meta.env.VITE_SUPABASE_URL ?? 'review'}:${profile?.id}:`;
  const [draftKey, setDraftKey] = useState(draftPrefix + 'new');
  const [deviceDrafts, setDeviceDrafts] = useState<ReturnType<typeof requestDraftList>>([]);
  const readDrafts = useCallback(() => {
    try { setDeviceDrafts(requestDraftList(localStorage, draftPrefix)); }
    catch { /* The form reports unavailable storage without overwriting entries. */ }
  }, [draftPrefix]);
  useEffect(() => { readDrafts(); window.addEventListener('storage', readDrafts); return () => window.removeEventListener('storage', readDrafts); }, [readDrafts]);
  const newDraft = deviceDrafts.some(d => d.key === draftPrefix + 'new');
  const lastList = latestRequestList(requests);
  function openForm(request: PurchaseRequest | null = null, repeat: PurchaseRequest | null = null, key?: string) {
    setEditing(request); setRepeat(repeat); setDraftKey(key ?? draftPrefix + (request?.id ?? 'new')); setFormOpen(true);
  }
  const resumeRequest=params.get('request'),resumeDraft=params.get('draft');
  useEffect(()=>{
    if(resumeDraft&&resumeDraft.startsWith(draftPrefix)&&can('kitchen.request.create')){
      try{if(localStorage.getItem(resumeDraft))openForm(null,null,resumeDraft);}catch{toast.error(text('This draft could not be opened. Keep this device and ask a manager.','Draf tidak dapat dibuka. Simpan peranti ini dan minta pengurus menyemak.'));}
    }else if(workRecordId(resumeRequest,isDemoMode))setPreview(resumeRequest);
    if(resumeRequest||resumeDraft)setParams(previous=>{const next=new URLSearchParams(previous);next.delete('request');next.delete('draft');return next;},{replace:true});
  },[resumeRequest,resumeDraft,draftPrefix]);

  const canCreate = can('kitchen.request.create');
  const statusLabel = (status: string) => text(requestStatusLabels[status], ({ draft: 'Draf', submitted: 'Dihantar', buying: 'Pembelian', completed: 'Dibeli', cancelled: 'Dibatalkan' } as Record<string, string>)[status]);

  const refresh = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('purchase_requests')
        .select('*, purchase_request_items(*, purchase_receipts(purchase_quantity))')
        .order('needed_for_date', { ascending: false })
        .limit(200);
      if (error) throw error;
      setRequests((data ?? []) as PurchaseRequest[]);
      setLoadError('');
    } catch (error) {
      setLoadError(readErrorMessage(error, text('Could not load kitchen requests.', 'Permintaan dapur tidak dapat dimuatkan.')));
    }
    setLoading(false);
  }, [text]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useSharedRefresh(refresh, { tables: ["purchase_requests","purchase_request_items","purchase_receipts"] });

  async function cancelRequest(request: PurchaseRequest) {
    const reason = window.prompt(text(`Why is ${request.request_no} being cancelled?`, `Mengapa ${request.request_no} dibatalkan?`));
    if (!reason?.trim()) return;
    const { error } = await supabase.rpc('cancel_purchase_request', { p_request_id: request.id, p_reason: reason.trim() });
    if (error) { toast.error(error.message); return; }
    toast.success(text('Request cancelled.', 'Permintaan dibatalkan.'));
    setPreview(null);
    void refresh();
  }

  const drafts = requests.filter((request) => request.status === 'draft');
  const open = requests.filter((request) => request.status === 'submitted' || request.status === 'buying');

  return (
    <>
      <KitchenHeader />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{text('Purchase Requests', 'Permintaan Belian')}</h2>
        {canCreate ? <div className="flex flex-wrap gap-2">
          {lastList && !newDraft ? <button type="button" className={secondaryButtonClass} onClick={() => openForm(null, lastList)}><Copy size={16}/>{text('Use Last List', 'Guna Senarai Terakhir')}</button> : null}
          {!newDraft ? <button type="button" className={buttonClass} onClick={() => openForm()}><Plus size={16}/>{text('New Request', 'Permintaan Baru')}</button> : null}
        </div> : null}
      </div>
      {canCreate && deviceDrafts.length ? <div className="request-device-drafts">
        <p>{text('On This Device · Not Sent', 'Pada Peranti Ini · Belum Dihantar')}</p>
        {deviceDrafts.map(({key, draft}) => <div key={key}><span><strong>{draft?.requestNo || text('New Request', 'Permintaan Baru')}</strong><small>{draft?.neededFor || text('Draft Needs Checking', 'Draf Perlu Disemak')}{draft ? ' · ' + draft.items.filter(i => i.quantity.trim() && Number(i.quantity) !== 0).length + ' ' + text('items', 'item') : ''}</small></span><button className={draft?.requestId ? secondaryButtonClass : buttonClass} onClick={() => openForm(null, null, key)}><FilePenLine size={16}/>{draft?.requestId ? text('Resume', 'Sambung') : text('Resume Draft', 'Sambung Draf')}</button></div>)}
      </div> : null}
      <div className="mb-3 grid grid-cols-3 gap-2">
        <Stat label={text('Drafts', 'Draf')} value={String(drafts.length)} tone={drafts.length ? 'warn' : 'good'} />
        <Stat label={text('Purchasing', 'Pembelian')} value={String(open.length)} />
        <Stat label={text('Total Requests', 'Jumlah Permintaan')} value={String(requests.length)} />
      </div>

      {loading ? <p className="p-4 font-bold">{text('Loading...', 'Memuatkan...')}</p> : null}
      {loadError ? <p role="alert" className="mb-3 text-sm text-danger">{loadError} <button className="underline" onClick={() => void refresh()}>{text('Retry', 'Cuba Lagi')}</button></p> : null}

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-shell text-xs text-muted"><tr><th className="px-3 py-2">{text('Request / Date', 'Permintaan / Tarikh')}</th><th className="px-3 py-2 text-right">{text('Items', 'Item')}</th><th className="px-3 py-2">Status</th><th className="px-3 py-2"><span className="sr-only">{text('Open', 'Buka')}</span></th></tr></thead>
          <tbody className="divide-y divide-line">{requests.map(request => <tr key={request.id} className="hover:bg-shell/50">
            <td className="px-3 py-2"><button className="text-left font-semibold text-accent" onClick={() => setPreview(request.id)}>{request.request_no}</button><div className="mt-0.5 text-xs text-muted">{request.needed_for_date} · {request.pax_count} pax</div></td>
            <td className="px-3 py-2 text-right tabular">{request.purchase_request_items?.length ?? 0}</td>
            <td className="px-3 py-2"><span className={`text-xs font-semibold ${request.status === 'draft' ? 'text-warning' : 'text-muted'}`}>{request.status==='completed'&&(can('kitchen.production.manage')||can('purchasing.view'))?text(requestProgress(request).status,({'Received':'Diterima','Awaiting Delivery':'Menunggu Penghantaran','Partially Received':'Sebahagian Diterima','Closed With Unavailable Items':'Ditutup dengan Item Tiada','To Buy':'Perlu Dibeli','Cancelled':'Dibatalkan'} as Record<string,string>)[requestProgress(request).status]):statusLabel(request.status)}</span></td>
            <td className="px-2 py-2 text-right"><button className={secondaryButtonClass + ' w-10 !p-0'} title={text('View Request', 'Lihat Permintaan')} aria-label={`View ${request.request_no}`} onClick={() => setPreview(request.id)}><Eye className="h-4 w-4" /></button></td>
          </tr>)}</tbody>
        </table>
        {!loading && !loadError && requests.length === 0 ? <p className="p-6 text-center text-sm text-muted">{text('No kitchen requests yet.', 'Belum ada permintaan dapur.')}</p> : null}
      </div>

      {preview ? <KitchenRequestReview key={preview} requestId={preview} onClose={() => setPreview(null)}
        onEdit={request => { setPreview(null); openForm(request); }}
        onCopy={request => { setPreview(null); openForm(null, request); }} onCancel={request => void cancelRequest(request)}
        onChanged={() => { void refresh(); void reloadBadges(); }} /> : null}
      {formOpen ? (
        <KitchenRequestForm
          key={draftKey}
          storageKey={draftKey}
          onDraftChange={readDrafts}
          request={editing}
          repeat={repeat}
          onClose={() => { setFormOpen(false); readDrafts(); }}
          onSaved={id => { setFormOpen(false); setPreview(id); void refresh(); void reloadBadges(); }}
        />
      ) : null}
    </>
  );
}
