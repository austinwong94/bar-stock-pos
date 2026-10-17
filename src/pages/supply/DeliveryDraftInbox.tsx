import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { iconButtonClass, secondaryButtonClass } from '../../components/Form';
import { useLanguage } from '../../lib/language';
import { readErrorMessage } from '../../lib/opsData';
import type { DeliveryDraft, DeliveryDraftSummary, PurchaseRequest } from '../../lib/platformTypes';
import { supabase } from '../../lib/supabase';
import { useSharedRefresh } from '../../lib/useSharedRefresh';
import { deliveryTime } from './DeliveryRecord';

export function DeliveryDraftInbox({ revision, onOpen }: { revision: number; onOpen: (draft: DeliveryDraft, request: PurchaseRequest) => void }) {
  const { text, language } = useLanguage();
  const [drafts, setDrafts] = useState<DeliveryDraftSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const sequence = useRef(0);
  const openingRef = useRef(false);
  const refresh = useCallback(async () => {
    const version = ++sequence.current;
    setLoading(true);
    try {
      const result = await supabase.rpc('read_delivery_drafts', { p_limit: 5, p_offset: page * 5 });
      if (result.error) throw result.error;
      if (version !== sequence.current) return;
      if (page && result.data.total <= page * 5) { setPage(Math.max(0, Math.ceil(result.data.total / 5) - 1)); return; }
      setDrafts(result.data.drafts); setTotal(result.data.total); setError('');
    } catch (failure) { if (version === sequence.current) setError(readErrorMessage(failure, text('Unconfirmed deliveries could not be checked.', 'Penghantaran belum disahkan tidak dapat disemak.'))); }
    finally { if (version === sequence.current) setLoading(false); }
  }, [page, text]);
  useEffect(() => { void refresh(); return () => { sequence.current++; }; }, [refresh, revision]);
  useSharedRefresh(refresh, { tables: ['delivery_drafts'] });
  async function open(id: string) {
    if (openingRef.current) return;
    openingRef.current = true; setOpening(id); setError('');
    try {
      const result = await supabase.rpc('read_delivery_draft', { p_id: id });
      if (result.error) throw result.error;
      onOpen(result.data.draft, result.data.request);
    } catch (failure) { setError(readErrorMessage(failure, text('Could not open this draft.', 'Draf ini tidak dapat dibuka.'))); }
    finally { openingRef.current = false; setOpening(null); }
  }
  if (!total && !error) return null;
  return <section aria-label={text('Unconfirmed Deliveries', 'Penghantaran Belum Disahkan')} className="mb-4 min-w-0 border-y border-warning/30 bg-amber-50/40 px-3 py-2">
    <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">{text('Unconfirmed Deliveries', 'Penghantaran Belum Disahkan')} <span className="text-warning tabular">{total}</span></h2><button className={iconButtonClass} title={text('Refresh Drafts', 'Muat Semula Draf')} aria-label={text('Refresh Drafts', 'Muat Semula Draf')} disabled={loading} onClick={() => void refresh()}><RefreshCw className="h-4 w-4" /></button></div>
    {error ? <p role="alert" className="my-2 break-words text-sm text-danger">{error}</p> : null}
    <ul className="divide-y divide-line">{drafts.map(draft => <li key={draft.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2">
      <div className="min-w-0"><p className="break-words text-sm font-semibold">{draft.request_no} <span className="text-xs font-normal text-muted">· {draft.item_count} {text(draft.item_count === 1 ? 'item' : 'items', 'item')}</span></p>
        <p className="mt-1 break-words text-xs text-muted">{draft.updated_by_name ?? text('Name Not Recorded', 'Nama Tidak Direkod')} · {deliveryTime(draft.updated_at, language)} MYT</p></div>
      <button className={secondaryButtonClass} disabled={opening !== null || loading} aria-label={`${text('Open Draft', 'Buka Draf')}: ${draft.id}`} onClick={() => void open(draft.id)}>{opening === draft.id ? text('Opening...', 'Membuka...') : text('Open', 'Buka')}</button>
    </li>)}</ul>
    {total > 5 ? <nav className="flex items-center justify-between gap-2 border-t border-line pt-2 text-xs text-muted"><span>{page * 5 + 1}-{Math.min(page * 5 + 5, total)} / {total}</span><div className="flex gap-2"><button className={iconButtonClass} disabled={loading || page === 0} aria-label={text('Previous Drafts', 'Draf Sebelumnya')} onClick={() => { setLoading(true); setPage(value => value - 1); }}><ChevronLeft className="h-4 w-4" /></button><button className={iconButtonClass} disabled={loading || (page + 1) * 5 >= total} aria-label={text('Next Drafts', 'Draf Seterusnya')} onClick={() => { setLoading(true); setPage(value => value + 1); }}><ChevronRight className="h-4 w-4" /></button></div></nav> : null}
  </section>;
}
