import { useEffect, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCw, Search } from 'lucide-react';
import { buttonClass, iconButtonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { useLanguage } from '../../lib/language';
import { readErrorMessage } from '../../lib/opsData';
import { supabase } from '../../lib/supabase';
import type { DeliveryBatchRecord, PurchaseRequest } from '../../lib/platformTypes';
import { PurchaseBatchRecords } from './PurchaseBatch';
import { DeliveryRecord, deliveryTime } from './DeliveryRecord';

export function PurchasingRecords({ request, initialView, onClose }: { request: PurchaseRequest; initialView: 'purchases' | 'deliveries'; onClose: () => void }) {
  const { text } = useLanguage();
  const [view, setView] = useState(initialView);
  const tabs = [['purchases', text('Purchases', 'Pembelian')], ['deliveries', text('Deliveries', 'Penghantaran')]] as const;
  return <Modal title={text('Records', 'Rekod')} onClose={onClose} footer={<div className="flex justify-end"><button className={buttonClass} onClick={onClose}>{text('Done', 'Selesai')}</button></div>}>
    <p className="mb-3 break-words text-sm font-semibold">{request.request_no}</p>
    <div role="tablist" aria-label={text('Record Type', 'Jenis Rekod')} className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-shell p-1">
      {tabs.map(([key, label]) => <button key={key} id={`record-tab-${key}`} role="tab" aria-selected={view === key} aria-controls="record-panel" tabIndex={view === key ? 0 : -1}
        onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const next = event.key === 'Home' ? 'purchases' : event.key === 'End' ? 'deliveries' : view === 'purchases' ? 'deliveries' : 'purchases'; setView(next); document.getElementById(`record-tab-${next}`)?.focus(); }}
        className={`min-h-11 min-w-0 rounded-md px-2 text-sm font-semibold ${view === key ? 'bg-accent text-white' : 'text-muted'}`} onClick={() => setView(key)}>{label}</button>)}
    </div>
    <div id="record-panel" role="tabpanel" aria-labelledby={`record-tab-${view}`}>
      {view === 'purchases' ? <PurchaseBatchRecords request={request} /> : <DeliveryRecords request={request} />}
    </div>
  </Modal>;
}

function DeliveryRecords({ request }: { request: PurchaseRequest }) {
  const { text, language } = useLanguage();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [records, setRecords] = useState<DeliveryBatchRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<DeliveryBatchRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const pageSize = 10;
  const reload = () => { setLoading(true); setRetry(value => value + 1); };
  const changePage = (next: number) => { setLoading(true); setPage(next); };
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await supabase.rpc('read_delivery_records', { p_request_id: request.id, p_query: query.trim(), p_limit: pageSize, p_offset: page * pageSize });
          if (result.error) throw result.error;
          if (active) { setRecords(result.data.records); setTotal(result.data.total); }
        } catch (failure) { if (active) setError(readErrorMessage(failure, text('Could not load delivery records.', 'Rekod penghantaran tidak dapat dimuatkan.'))); }
        finally { if (active) setLoading(false); }
      })();
    }, query ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [request.id, query, page, retry, text]);
  if (selected) return <>
    <div className="mb-3 flex items-center gap-3"><button className={iconButtonClass} aria-label={text('Back to Deliveries', 'Kembali ke Penghantaran')} title={text('Back to Deliveries', 'Kembali ke Penghantaran')} onClick={() => setSelected(null)}><ArrowLeft className="h-4 w-4" /></button><span className="text-sm font-semibold text-palm">{text('Confirmed Delivery', 'Penghantaran Disahkan')}</span></div>
    <DeliveryRecord record={selected} />
  </>;
  return <>
    <div className="mb-3 flex gap-2"><label className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted" /><input className={inputClass + ' !pl-9'} aria-label={text('Search Deliveries', 'Cari Penghantaran')} placeholder={text('Item, Staff or Date', 'Item, Petugas atau Tarikh')} maxLength={160} value={query} onChange={event => { setLoading(true); setQuery(event.target.value); setPage(0); }} /></label><button className={iconButtonClass} disabled={loading} aria-label={text('Refresh Deliveries', 'Muat Semula Penghantaran')} title={text('Refresh Deliveries', 'Muat Semula Penghantaran')} onClick={reload}><RefreshCw className="h-4 w-4" /></button></div>
    {loading ? <p role="status" className="py-3 text-sm text-muted">{text('Loading Deliveries...', 'Memuatkan Penghantaran...')}</p> : error ? <div role="alert" className="grid gap-3 text-sm text-danger"><p className="break-words">{error}</p><button className={secondaryButtonClass} onClick={reload}>{text('Retry', 'Cuba Lagi')}</button></div> : <>
      <p className="mb-2 text-xs text-muted">{total} {text(total === 1 ? 'Confirmed Delivery' : 'Confirmed Deliveries', 'Penghantaran Disahkan')}</p>
      <ul className="divide-y divide-line border-y border-line">{records.map(record => <li key={record.id}>
        <button className="grid min-h-16 w-full grid-cols-[minmax(0,1fr)_auto_1rem] items-center gap-3 py-3 text-left hover:bg-shell" onClick={() => setSelected(record)} aria-label={`${text('Open Delivery', 'Buka Penghantaran')}: ${record.id}`}>
          <span className="min-w-0"><span className="block break-words text-sm font-semibold">{deliveryTime(record.confirmed_at, language)} MYT</span><span className="mt-1 block break-words text-xs text-muted">{record.confirmed_by_name ?? text('Name Not Recorded', 'Nama Tidak Direkod')}</span></span>
          <span className="text-xs text-muted tabular">{record.receipts.length} {text(record.receipts.length === 1 ? 'item' : 'items', 'item')}</span><ChevronRight className="h-4 w-4 text-muted" />
        </button>
      </li>)}</ul>
      {!records.length ? <p className="py-4 text-sm text-muted">{query ? text('No Matching Deliveries', 'Tiada Penghantaran Sepadan') : text('No Confirmed Deliveries Yet', 'Belum Ada Penghantaran Disahkan')}</p> : null}
      {total > pageSize ? <nav aria-label={text('Delivery Pages', 'Halaman Penghantaran')} className="mt-3 flex items-center justify-between gap-2 text-xs text-muted"><span>{page * pageSize + 1}-{Math.min((page + 1) * pageSize, total)} / {total}</span><div className="flex gap-2"><button className={iconButtonClass} disabled={page === 0} title={text('Previous Deliveries', 'Penghantaran Sebelumnya')} aria-label={text('Previous Deliveries', 'Penghantaran Sebelumnya')} onClick={() => changePage(page - 1)}><ChevronLeft className="h-4 w-4" /></button><button className={iconButtonClass} disabled={(page + 1) * pageSize >= total} title={text('Next Deliveries', 'Penghantaran Seterusnya')} aria-label={text('Next Deliveries', 'Penghantaran Seterusnya')} onClick={() => changePage(page + 1)}><ChevronRight className="h-4 w-4" /></button></div></nav> : null}
    </>}
  </>;
}
