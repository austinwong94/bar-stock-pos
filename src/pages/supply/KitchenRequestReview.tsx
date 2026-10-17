import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Copy, Send, Trash2 } from 'lucide-react';
import { Modal } from '../../components/Modal';
import { buttonClass, secondaryButtonClass } from '../../components/Form';
import { supabase } from '../../lib/supabase';
import { useAccess } from '../../lib/access';
import { useLanguage } from '../../lib/language';
import { useSharedRefresh } from '../../lib/useSharedRefresh';
import { readErrorMessage } from '../../lib/opsData';
import type { PurchaseRequest } from '../../lib/platformTypes';

export function KitchenRequestReview({ requestId, onClose, onEdit, onCopy, onCancel, onChanged }: {
  requestId: string;
  onClose: () => void;
  onEdit: (request: PurchaseRequest) => void;
  onCopy: (request: PurchaseRequest) => void;
  onCancel: (request: PurchaseRequest) => void;
  onChanged: () => void;
}) {
  const { can, profile } = useAccess();
  const { text, language } = useLanguage();
  const [request, setRequest] = useState<PurchaseRequest | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState(false);
  const loadedVersion = useRef<string | undefined>(undefined);
  const sequence = useRef(0);
  const sending = useRef(false);
  const refresh = useCallback(async () => {
    if (sending.current) return;
    const current = ++sequence.current;
    try {
      const result = await supabase.from('purchase_requests').select('*, purchase_request_items(*)').eq('id', requestId).maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) throw new Error('Saved request not found.');
      if (current !== sequence.current) return;
      const next = result.data as PurchaseRequest;
      if (loadedVersion.current !== next.updated_at) setChecked(false);
      loadedVersion.current = next.updated_at;
      setRequest(next); setLoadError(false);
    } catch { if (current === sequence.current) setLoadError(true); }
  }, [requestId]);
  useEffect(() => { void refresh(); return () => { sequence.current++; }; }, [refresh]);
  useSharedRefresh(refresh, { tables: ['purchase_requests', 'purchase_request_items'] });

  const items = [...(request?.purchase_request_items ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const missing = items.filter(item => !item.item_name.trim() || !item.unit.trim() || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0).length;
  const draft = request?.status === 'draft';
  const canEdit = can('kitchen.manage') || (can('kitchen.request.create') && request?.requested_by === profile?.id);
  const time = (value: string) => new Intl.DateTimeFormat(language === 'ms' ? 'ms-MY' : 'en-GB', {
    timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));

  async function send() {
    if (!request || sending.current || !checked || loadError || !draft || !items.length || missing) return;
    sending.current = true; sequence.current++;
    setBusy(true); setError('');
    try {
      const { data, error: failure } = await supabase.rpc('submit_purchase_request_checked', { p_request_id: request.id, p_expected_updated_at: request.updated_at });
      if (failure) throw failure;
      const next = { ...data, purchase_request_items: items } as PurchaseRequest;
      loadedVersion.current = next.updated_at;
      setRequest(next); setChecked(false); onChanged();
    } catch (failure) {
      setError(readErrorMessage(failure, text('Not confirmed. Retry with the same details.', 'Belum disahkan. Cuba lagi dengan butiran yang sama.')));
    } finally { sending.current = false; setBusy(false); }
  }

  return <Modal title={request?.request_no ?? text('Kitchen Request', 'Permintaan Dapur')} wide onClose={() => { if (!busy) onClose(); }}
    footer={<div className="grid gap-3">
      {draft && missing > 0 ? <p role="alert" className="text-sm text-danger">{text(`${missing} item(s) need a quantity before sending.`, `${missing} item memerlukan kuantiti sebelum dihantar.`)}</p> : null}
      {draft && can('kitchen.request.submit') ? <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={busy || loadError || missing > 0} className="mt-0.5 shrink-0 accent-accent" checked={checked} onChange={event => setChecked(event.target.checked)} />{text('I checked the date, items and quantities.', 'Saya telah menyemak tarikh, item dan kuantiti.')}</label> : null}
      <div className="flex flex-wrap justify-between gap-2">
      <div className="flex flex-wrap gap-2">
        {request && draft && canEdit ? <button className={secondaryButtonClass} disabled={busy} onClick={() => onEdit(request)}>{text('Edit', 'Edit')}</button> : null}
        {request && !draft && can('kitchen.request.create') ? <button className={secondaryButtonClass} disabled={busy} onClick={() => onCopy(request)}><Copy className="h-4 w-4" />{text('Use This List', 'Guna Senarai Ini')}</button> : null}
        {request && draft && canEdit ? <button className={secondaryButtonClass + ' w-10 !p-0 text-danger'} disabled={busy} aria-label={text('Cancel Request', 'Batal Permintaan')} title={text('Cancel Request', 'Batal Permintaan')} onClick={() => onCancel(request)}><Trash2 className="h-4 w-4" /></button> : null}
      </div>
      {draft && can('kitchen.request.submit') ? <button className={buttonClass} disabled={busy || !checked || loadError || missing > 0 || !items.length} onClick={() => void send()}><Send className="h-4 w-4" />{busy ? text('Sending...', 'Menghantar...') : text('Confirm & Send', 'Sahkan & Hantar')}</button>
        : <button className={buttonClass} disabled={busy} onClick={onClose}>{text('Done', 'Selesai')}</button>}
    </div></div>}>
    {loadError ? <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-danger"><span>{text('Could not load the saved request. Reconnect and retry.', 'Permintaan tersimpan tidak dapat dimuatkan. Sambung semula dan cuba lagi.')}</span><button className={secondaryButtonClass} onClick={() => void refresh()}>{text('Retry', 'Cuba Lagi')}</button></div> : null}
    {!request && !loadError ? <p role="status" className="text-sm text-muted">{text('Loading Saved Request...', 'Memuatkan Permintaan Tersimpan...')}</p> : null}
    {request ? <>
      <div className={`mb-3 border-l-4 py-1 pl-3 ${draft ? 'border-warning' : request.status === 'cancelled' ? 'border-danger' : 'border-palm'}`}>
        <p className="flex items-center gap-2 text-sm font-bold">{!draft && request.status !== 'cancelled' ? <CheckCircle2 className="h-4 w-4 shrink-0 text-palm" /> : null}{draft ? text('Draft Saved · Not Sent', 'Draf Disimpan · Belum Dihantar') : request.status === 'cancelled' ? text('Cancelled', 'Dibatalkan') : text('Sent to Purchasing', 'Dihantar ke Pembelian')}</p>
        {request.submitted_at ? <p className="mt-1 break-words text-xs text-muted">{text('Confirmed by', 'Disahkan oleh')} {request.submitted_by_name ?? text('Not Recorded', 'Tidak Direkod')} · {time(request.submitted_at)} MYT</p>
          : request.updated_at ? <p className="mt-1 text-xs text-muted">{text('Saved', 'Disimpan')} {time(request.updated_at)} MYT</p> : null}
      </div>
      <dl className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2 text-sm"><div><dt className="text-xs text-muted">{text('Needed For', 'Tarikh Diperlukan')}</dt><dd className="font-semibold">{request.needed_for_date}</dd></div><div className="text-right"><dt className="text-xs text-muted">Pax</dt><dd className="font-semibold tabular">{request.pax_count}</dd></div></dl>
      {request.purpose ? <p className="mb-2 break-words text-sm font-semibold">{request.purpose}</p> : null}
      <table className="dense-table w-full table-fixed text-left text-sm"><thead><tr><th className="w-3/5">{text('Item', 'Item')} ({items.length})</th><th className="text-right">{text('Quantity', 'Kuantiti')}</th></tr></thead><tbody>{items.map(item => <tr key={item.id}>
        <td className="break-words"><p className="font-semibold">{item.item_name}</p>{item.note ? <p className="mt-1 text-xs text-muted">{item.note}</p> : null}</td>
        <td className={`break-words text-right tabular ${Number(item.quantity) <= 0 ? 'font-bold text-danger' : ''}`}>{Number(item.quantity) > 0 ? `${Number(item.quantity)} ${item.unit}` : text('Not Entered', 'Belum Diisi')}</td>
      </tr>)}</tbody></table>
      {request.notes ? <p className="mt-3 break-words text-sm text-muted">{request.notes}</p> : null}
      {request.cancelled_reason ? <p className="mt-3 break-words text-sm text-danger">{request.cancelled_reason}</p> : null}
      {error ? <p role="alert" className="mt-3 break-words text-sm text-danger">{error}</p> : null}
    </> : null}
  </Modal>;
}
