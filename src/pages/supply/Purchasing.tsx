import { useSharedRefresh } from '../../lib/useSharedRefresh';
import { useSearchParams } from 'react-router-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, PackageCheck, PackageX, ReceiptText, Search, ShoppingBasket, Undo2 } from 'lucide-react';
import { PageHeader } from '../../components/Page';
import { KitchenHelp } from '../../components/KitchenHeader';
import { Field, buttonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import { loadLocalIngredientItems } from '../../lib/localStore';
import { useAccess } from '../../lib/access';
import { readErrorMessage } from '../../lib/opsData';
import { money } from '../../lib/format';
import { useLanguage } from '../../lib/language';
import { awaitingDelivery, receivedQuantity, remainingToBuy, requestProgress, type PurchaseQueue, type PurchaseQueueView } from '../../lib/purchasingProgress';
import type { DeliveryDraft, PurchaseReceipt, PurchaseRequest, PurchaseRequestItem } from '../../lib/platformTypes';
import type { IngredientWithBalance, SettingsMap } from '../../lib/types';
import { PurchaseBatch } from './PurchaseBatch';
import { PurchasingRecords } from './PurchasingRecords';
import { DeliveryBatch } from './DeliveryBatch';
import { DeliveryDraftInbox } from './DeliveryDraftInbox';
import { deliveryErrorLabels, deliveryLineError, fixedDeliveryUnit } from '../../lib/delivery';

const PAGE_SIZE = 25;
const emptyQueue: PurchaseQueue = { requests: [], total: 0, counts: { open: 0, receiving: 0, history: 0 } };

export default function Purchasing({ settings, embedded = false }: { settings: SettingsMap; embedded?: boolean }) {
  const [params]=useSearchParams();
  const toast = useToast();
  const { text } = useLanguage();
  const { can, reloadBadges } = useAccess();
  const currency = String(settings.currency_symbol ?? 'MYR');
  const [queue, setQueue] = useState<PurchaseQueue>(emptyQueue);
  const [view, setView] = useState<PurchaseQueueView>(()=>params.get('view')==='history'?'history':params.get('view')==='receiving'?'receiving':'open');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [batchRequest, setBatchRequest] = useState<PurchaseRequest | null>(null);
  const [deliveryRequest, setDeliveryRequest] = useState<PurchaseRequest | null>(null);
  const [deliveryDraft, setDeliveryDraft] = useState<DeliveryDraft>();
  const [draftRevision, setDraftRevision] = useState(0);
  const [purchaseRecords, setPurchaseRecords] = useState<PurchaseRequest | null>(null);
  const [receiving, setReceiving] = useState<PurchaseRequestItem | null>(null);
  const [receiptItem, setReceiptItem] = useState<PurchaseRequestItem | null>(null);
  const [receiptSaved, setReceiptSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const sequence = useRef(0);
  const canReceive = can('purchasing.receive');
  const canFulfil = can('purchasing.fulfil');
  const showCost = can('purchasing.cost.view');

  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(search.trim()); setPage(0); }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const refresh = useCallback(async () => {
    const version = ++sequence.current;
    try {
      const { data, error } = await supabase.rpc('read_purchasing_queue', {
        p_view: view, p_query: query, p_limit: PAGE_SIZE, p_offset: page * PAGE_SIZE,
      });
      if (error) throw error;
      if (version !== sequence.current) return;
      const next = data as PurchaseQueue;
      if (page > 0 && next.total <= page * PAGE_SIZE) {
        setPage(Math.max(0, Math.ceil(next.total / PAGE_SIZE) - 1));
        return;
      }
      setQueue(next);
      setLoadError('');
    } catch (error) {
      if (version === sequence.current) setLoadError(readErrorMessage(error, 'Could not load purchases. Previously loaded records may be out of date.'));
    } finally {
      if (version === sequence.current) setLoading(false);
    }
  }, [view, query, page]);

  useEffect(() => {
    setLoading(true);
    void refresh();
    return () => { sequence.current++; };
  }, [refresh]);
  useSharedRefresh(refresh, { tables: ['purchase_requests', 'purchase_request_items', 'purchase_receipts'] });

  async function quickSet(item: PurchaseRequestItem, status: 'pending' | 'unavailable') {
    if (busyItem) return;
    setBusyItem(item.id);
    try {
      const { error } = await supabase.rpc('set_purchase_item_status_checked', {
        p_item_id: item.id, p_expected_updated_at: item.updated_at, p_status: status,
        p_purchased_quantity: null, p_actual_cost: null, p_supplier: null, p_note: null,
      });
      if (error) throw error;
      await refresh();
      void reloadBadges();
    } catch (error) {
      toast.error(readErrorMessage(error, 'The purchase was not updated.'));
    } finally { setBusyItem(null); }
  }

  const tabs = ([
    ['open', text('Open', 'Terbuka')],
    ['receiving', text('To Receive', 'Untuk Diterima')],
    ['history', text('History', 'Sejarah')],
  ] as [PurchaseQueueView, string][]).filter(([key])=>!embedded||key==='history');
  const statusLabel = (request: PurchaseRequest) => {
    const status = requestProgress(request).status;
    const labels: Record<string, string> = {
      'To Buy': 'Untuk Dibeli', 'Awaiting Delivery': 'Menunggu Penghantaran',
      'Partially Received': 'Diterima Sebahagian', 'Received': 'Diterima',
      'Closed With Unavailable Items': 'Ditutup Dengan Item Tiada', 'Cancelled': 'Dibatalkan',
    };
    return text(status, labels[status] ?? status);
  };

  return (
    <>
      {!embedded ? <PageHeader title={text('Purchasing & Receiving', 'Pembelian & Penerimaan')} actions={<KitchenHelp/>} /> : null}
      <DeliveryDraftInbox revision={draftRevision} onOpen={(draft, request) => { setDeliveryDraft(draft); setDeliveryRequest(request); }} />
      <div className="mb-3 grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,22rem)]">
        <div role="tablist" aria-label={text('Purchase Views', 'Paparan Pembelian')} className={embedded ? 'flex items-center gap-2' : 'grid min-w-0 grid-cols-3 gap-1 rounded-lg border border-line bg-white p-1'}>
          {tabs.map(([key, label], index) => <button key={key} id={`purchase-tab-${key}`} role="tab" aria-selected={view === key} aria-controls="purchase-panel" tabIndex={view === key ? 0 : -1}
            onKeyDown={event => {
              const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
              if (next === null) return;
              event.preventDefault();
              setView(tabs[next][0]); setPage(0);
              document.getElementById(`purchase-tab-${tabs[next][0]}`)?.focus();
            }}
            onClick={() => { setView(key); setPage(0); }} className={`flex min-h-10 min-w-0 items-center justify-center gap-1.5 rounded-md px-1 text-xs font-semibold sm:text-sm ${view === key ? 'bg-accent text-white' : 'text-muted hover:bg-shell'}`}>
            <span>{label}</span><span className="tabular text-[11px] opacity-80">{queue.counts[key]}</span>
          </button>)}
        </div>
        <label className="relative min-w-0">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted" />
          <input aria-label="Search purchases" className={inputClass + ' !pl-9'} value={search} maxLength={160} onChange={event => setSearch(event.target.value)} placeholder={text('Search item, supplier or reference', 'Cari item, pembekal atau rujukan')} />
        </label>
      </div>
      {loadError ? <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-danger/30 bg-red-50 p-3 text-sm"><span>{loadError}</span><button className={secondaryButtonClass} onClick={() => void refresh()}>{text('Retry', 'Cuba Lagi')}</button></div> : null}
      <div id="purchase-panel" role="tabpanel" aria-labelledby={`purchase-tab-${view}`} aria-busy={loading} className="grid min-w-0 gap-3">
        {loading ? <p role="status" className="text-sm text-muted">{text('Updating purchases...', 'Mengemas Kini Pembelian...')}</p> : null}
        {queue.requests.map(request => {
          const items = [...(request.purchase_request_items ?? [])].sort((a, b) => a.sort_order - b.sort_order);
          const progress = requestProgress(request);
          const active = request.status !== 'cancelled';
          return <section key={request.id} className="min-w-0 overflow-hidden rounded-lg border border-line bg-white">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2.5">
              <div className="min-w-0">
                <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-bold"><ShoppingBasket className="h-4 w-4 shrink-0 text-accent" /><span className="break-all">{request.request_no}</span></p>
                <p className="mt-1 break-words text-xs text-muted">{request.needed_for_date} · {request.pax_count} pax{request.purpose ? ' · ' + request.purpose : ''}</p>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className={`rounded px-2 py-1 text-xs font-semibold ${progress.open ? 'bg-amber-50 text-warning' : 'bg-shell text-muted'}`}>{statusLabel(request)}</span>
                {active && canFulfil && items.some(item => item.purchase_status !== 'unavailable' && remainingToBuy(item)>0) ? <button className={buttonClass} onClick={() => setBatchRequest(request)}><ShoppingBasket className="h-4 w-4 shrink-0" />{text('Record Purchases', 'Rekod Pembelian')}</button> : null}
                {active && canReceive && items.some(awaitingDelivery) ? <button className={view === 'receiving' ? buttonClass : secondaryButtonClass} onClick={() => setDeliveryRequest(request)}><PackageCheck className="h-4 w-4 shrink-0" />{text('Receive Delivery', 'Terima Penghantaran')}</button> : null}
                <button className={secondaryButtonClass + ' !w-11 !px-0'} title={text('Records', 'Rekod')} aria-label={`${text('Records', 'Rekod')}: ${request.request_no}`} onClick={() => setPurchaseRecords(request)}><ReceiptText className="h-4 w-4" /></button>
              </div>
            </header>
            <ul className="divide-y divide-line">
              {items.map(item => <li key={item.id} className="grid min-w-0 grid-cols-1 items-center gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <p className="break-words text-sm font-bold">{item.item_name}</p>
                  <p className="mt-0.5 break-words text-xs text-muted">{text('Requested', 'Diminta')} {Number(item.quantity)} {item.unit}{item.note ? ' · ' + item.note : ''}{item.purchase_status === 'bought' && item.supplier ? ' · ' + item.supplier : ''}{showCost && item.actual_cost != null ? ' · ' + money(item.actual_cost, currency) : ''}</p>
                  <div className="purchase-progress" aria-label={text('Item Progress','Kemajuan Item')}>
                    <span>{text('Bought','Dibeli')} <strong>{item.purchase_status==='bought'?Number(item.purchased_quantity):0} {item.unit}</strong></span>
                    <span>{text('Received','Diterima')} <strong>{receivedQuantity(item)} {item.unit}</strong></span>
                    {remainingToBuy(item)>0?<span className="text-warning">{text('Still To Buy','Belum Dibeli')} <strong>{remainingToBuy(item)} {item.unit}</strong></span>:null}
                    {awaitingDelivery(item)?<span className="text-warning">{text('Not Arrived','Belum Sampai')} <strong>{Math.round((Number(item.purchased_quantity)-receivedQuantity(item))*100)/100} {item.unit}</strong></span>:null}
                  </div>
                  {item.purchase_status === 'unavailable' ? <p className="mt-1 text-xs font-semibold text-danger">{text('Unavailable', 'Tiada')}</p> : null}
                  {(item.purchase_receipts?.length ?? 0) > 0 ? <button type="button" className="mt-1 inline-flex min-h-9 items-center gap-1.5 text-xs font-semibold text-accent underline underline-offset-2" onClick={() => setReceiptItem(item)}><ReceiptText className="h-3.5 w-3.5" />{text('Receipts', 'Resit')} ({item.purchase_receipts!.length})</button> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {active && canReceive && awaitingDelivery(item) ? <button className={buttonClass} onClick={() => setDeliveryRequest({ ...request, purchase_request_items: [item] })}><PackageCheck className="h-4 w-4" />{text('Receive', 'Terima')}</button> : null}
                  {active && canFulfil && item.purchase_status !== 'unavailable' && remainingToBuy(item)>0 ? <>
                    <button className={buttonClass} onClick={() => setBatchRequest({ ...request, purchase_request_items: [item] })}><Check className="h-4 w-4" />{text('Record Purchase', 'Rekod Pembelian')}</button>
                    {!Number(item.purchased_quantity)?<button type="button" className={secondaryButtonClass + ' w-10 !p-0'} disabled={busyItem !== null} onClick={() => void quickSet(item, 'unavailable')} aria-label="Mark unavailable" title={text('Mark Unavailable', 'Tandakan Tiada')}><PackageX className="h-4 w-4" /></button>:null}
                  </> : active && canFulfil && item.purchase_status==='unavailable' ? <button type="button" className={secondaryButtonClass + ' w-10 !p-0'} disabled={busyItem !== null} onClick={() => void quickSet(item, 'pending')} aria-label="Retry unavailable item" title={text('Try Buying Again', 'Cuba Beli Lagi')}><Undo2 className="h-4 w-4" /></button> : null}
                </div>
              </li>)}
            </ul>
            {request.notes ? <p className="break-words border-t border-line px-3 py-2 text-xs text-muted">{request.notes}</p> : null}
          </section>;
        })}
        {!loading && !loadError && queue.requests.length === 0 ? <p className="py-8 text-center text-sm text-muted">{query ? text('No matching purchases.', 'Tiada Pembelian Sepadan.') : view === 'history' ? text('No completed deliveries yet.', 'Belum Ada Penghantaran Lengkap.') : text('No purchases or deliveries pending.', 'Tiada Pembelian Atau Penghantaran Tertunda.')}</p> : null}
      </div>
      {queue.total > 0 ? <nav aria-label="Purchase pages" className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs text-muted">
        <span>{page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, queue.total)} / {queue.total}</span>
        <div className="flex items-center gap-2">
          <button type="button" className={secondaryButtonClass + ' w-10 !p-0'} aria-label="Previous purchase page" disabled={page === 0 || loading} onClick={() => setPage(value => value - 1)}><ChevronLeft className="h-4 w-4" /></button>
          <span>{text('Page', 'Halaman')} {page + 1} / {Math.max(1, Math.ceil(queue.total / PAGE_SIZE))}</span>
          <button type="button" className={secondaryButtonClass + ' w-10 !p-0'} aria-label="Next purchase page" disabled={(page + 1) * PAGE_SIZE >= queue.total || loading} onClick={() => setPage(value => value + 1)}><ChevronRight className="h-4 w-4" /></button>
        </div>
      </nav> : null}
      {batchRequest ? <PurchaseBatch request={batchRequest} onClose={() => setBatchRequest(null)} onSaved={() => { void refresh(); void reloadBadges(); }} /> : null}
      {deliveryRequest ? <DeliveryBatch request={deliveryRequest} initialDraft={deliveryDraft} onClose={() => { setDeliveryRequest(null); setDeliveryDraft(undefined); setDraftRevision(value => value + 1); void refresh(); }} onSaved={() => { setDraftRevision(value => value + 1); void refresh(); void reloadBadges(); }} /> : null}
      {purchaseRecords ? <PurchasingRecords request={purchaseRecords} initialView={view === 'open' ? 'purchases' : 'deliveries'} onClose={() => setPurchaseRecords(null)} /> : null}
      {receiving ? <ReceiveForm item={receiving} onClose={() => { setReceiving(null); void refresh(); }} onSaved={receipt => {
        setReceiptItem({ ...receiving, purchase_receipts: [...(receiving.purchase_receipts ?? []), receipt] });
        setReceiptSaved(true);
        setReceiving(null); void refresh(); void reloadBadges();
      }} /> : null}
      {receiptItem ? <ReceiptHistory item={receiptItem} justSaved={receiptSaved} onClose={() => { setReceiptItem(null); setReceiptSaved(false); }} /> : null}
    </>
  );
}


function ReceiptHistory({ item, justSaved, onClose }: { item: PurchaseRequestItem; justSaved: boolean; onClose: () => void }) {
  const { language, text } = useLanguage();
  const [records, setRecords] = useState(item.purchase_receipts ?? []);
  const [refreshError, setRefreshError] = useState(false);
  const version = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++version.current;
    try {
      const { data, error } = await supabase.from('purchase_receipts').select('*').eq('purchase_item_id', item.id).order('received_at');
      if (error) throw error;
      if (current === version.current) { setRecords(data ?? []); setRefreshError(false); }
    } catch { if (current === version.current) setRefreshError(true); }
  }, [item.id]);
  useEffect(() => { void refresh(); return () => { version.current++; }; }, [refresh]);
  useSharedRefresh(refresh, { tables: ['purchase_receipts'] });
  const receipts = [...records].sort((a, b) => a.received_at.localeCompare(b.received_at));
  const quantity = (value: number) => Number(value).toLocaleString('en-MY', { maximumFractionDigits: 4 });
  const time = (value: string) => Number.isNaN(Date.parse(value)) ? '-' : new Intl.DateTimeFormat(
    language === 'ms' ? 'ms-MY' : 'en-GB',
    { timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false },
  ).format(new Date(value));

  return <Modal title={justSaved ? text('Delivery Confirmed', 'Penghantaran Disahkan') : text('Delivery Receipts', 'Resit Penghantaran')} wide onClose={onClose}
    footer={<button type="button" className={buttonClass} onClick={onClose}>{text('Done', 'Selesai')}</button>}>
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="min-w-0 break-words text-base font-bold">{item.item_name}</h3>
      <p className="text-sm font-semibold text-palm">{text('Received', 'Diterima')} {receivedQuantity({ ...item, purchase_receipts: records })} / {Number(item.purchased_quantity)} {item.unit}</p>
    </div>
    {refreshError ? <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-danger"><span>{text('Could not refresh receipts. Showing the last loaded records.', 'Resit tidak dapat dikemas kini. Memaparkan rekod terakhir dimuatkan.')}</span><button className={secondaryButtonClass} onClick={() => void refresh()}>{text('Retry', 'Cuba Lagi')}</button></div> : null}
    <table className="dense-table w-full table-fixed text-left text-xs">
      <thead><tr><th className="w-[37%] break-words">{text('Time (MYT)', 'Masa (MYT)')}</th><th className="w-[27%] break-words">{text('Delivery', 'Diterima')}</th><th className="w-[36%] break-words">{text('Stock Added', 'Stok Masuk')}</th></tr></thead>
      <tbody>{receipts.map(receipt => <tr key={receipt.id} className="border-t border-line">
        <td className="break-words">
          <p className="font-semibold">{time(receipt.received_at)}</p>
          <p className="mt-1">{receipt.received_by_name ?? text('Name Not Recorded', 'Nama Tidak Direkod')}</p>
          <p className="mt-1 break-all text-[10px] text-muted" title={receipt.id}>#{receipt.id.slice(0, 8)}</p>
        </td>
        <td className="break-words">
          <p className="font-semibold">{quantity(receipt.purchase_quantity)} {receipt.purchase_unit ?? item.unit}</p>
          <p className="mt-1 text-muted">{quantity(receipt.base_per_unit ?? Number(receipt.base_quantity) / Number(receipt.purchase_quantity))} {receipt.base_unit} / {receipt.purchase_unit ?? item.unit}</p>
        </td>
        <td className="break-words">
          <p>{receipt.ingredient_name ?? receipt.ingredient_id}</p>
          <p className="mt-1 font-bold text-palm">+{quantity(receipt.base_quantity)} {receipt.base_unit}</p>
        </td>
      </tr>)}</tbody>
    </table>
    {receipts.some(receipt => receipt.details_backfilled) ? <p className="mt-3 text-xs text-muted">{text('Earlier receipt names were recovered from existing records and may reflect later name changes.', 'Nama resit terdahulu dipulihkan daripada rekod sedia ada dan mungkin mencerminkan perubahan nama kemudian.')}</p> : null}
  </Modal>;
}

function ReceiveForm({ item, onClose, onSaved }: { item: PurchaseRequestItem; onClose: () => void; onSaved: (receipt: PurchaseReceipt) => void }) {
  const { text } = useLanguage();
  const [ingredients, setIngredients] = useState<IngredientWithBalance[]>([]);
  const [ingredientId, setIngredientId] = useState('');
  const remaining = Math.round((Number(item.purchased_quantity) - receivedQuantity(item)) * 100) / 100;
  const [quantity, setQuantity] = useState('');
  const [size, setSize] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [requestId] = useState(() => crypto.randomUUID());
  const [attempted, setAttempted] = useState(false);
  const [stale, setStale] = useState(false);
  const sending = useRef(false);
  const ingredient = ingredients.find(row => row.id === ingredientId);
  const base = Math.round(Number(quantity) * Number(size) * 100) / 100;
  const quantityValid = quantity.trim() !== '' && Number.isFinite(Number(quantity)) && Number(quantity) > 0 && Number(quantity) <= remaining && Math.abs(Number(quantity) * 100 - Math.round(Number(quantity) * 100)) < 1e-8;
  const sizeValid = size.trim() !== '' && Number.isFinite(Number(size)) && Number(size) > 0;
  const baseValid = Number.isFinite(base) && base > 0 && (ingredient?.base_unit !== 'unit' || Number.isInteger(base));
  const conversionIssue = ingredient ? deliveryLineError(item.unit, ingredient.base_unit, Number(quantity), Number(size), remaining) : null;
  const valid = !!ingredient && quantityValid && sizeValid && baseValid && !conversionIssue && !stale;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = isSupabaseConfigured
          ? await supabase.from('ingredient_items').select('*').eq('active', true).order('name')
          : { data: loadLocalIngredientItems(), error: null };
        if (result.error) throw result.error;
        if (!cancelled) setIngredients(result.data ?? []);
      } catch (err) { if (!cancelled) setError(readErrorMessage(err, 'Could not load inventory items.')); }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  function selectIngredient(id: string) {
    setIngredientId(id);
    setConfirmed(false);
    const selected = ingredients.find(row => row.id === id);
    const fixed = fixedDeliveryUnit(item.unit);
    const conversion = selected && fixed?.baseUnit === selected.base_unit ? fixed.size : null;
    setSize(conversion ? String(conversion) : '');
  }

  async function receive() {
    if (sending.current || !confirmed || !valid) return;
    sending.current = true;
    setBusy(true);
    setAttempted(true);
    setError('');
    try {
      const result = await supabase.rpc('receive_purchase_batch_checked', { p_request_id: item.request_id, p_operation_id: requestId,
        p_items: [{ item_id: item.id, ingredient_id: ingredientId, quantity: Number(quantity), base_per_unit: Number(size),
          expected_updated_at: item.updated_at, expected_received_quantity: receivedQuantity(item), expected_base_unit: ingredient!.base_unit }] });
      if (result.error) throw result.error;
      if (!result.data?.receipts?.[0]) throw new Error('The delivery could not be verified. Retry to check.');
      onSaved(result.data.receipts[0] as PurchaseReceipt);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      setStale(code === '40001');
      if (code && code !== '40001' && (/^[0-9A-Z]{5}$/.test(code) || code.startsWith('PGRST'))) { setAttempted(false); setConfirmed(false); }
      setError(readErrorMessage(err, 'Confirmation could not be verified. Retry with the same details.'));
    }
    finally { sending.current = false; setBusy(false); }
  }

  return <Modal title={text('Confirm Delivery', 'Sahkan Penghantaran')} onClose={() => { if (!busy) onClose(); }} footer={<button className={`${buttonClass} w-full`} disabled={busy || !confirmed || !valid} onClick={() => void receive()}><PackageCheck className="h-4 w-4" />{busy ? text('Confirming...', 'Mengesahkan...') : text('Confirm & Add to Stock', 'Sahkan & Tambah Stok')}</button>}>
    <div className="grid gap-4">
      <div><h3 className="font-bold break-words">{item.item_name}</h3><p className="mt-1 text-sm text-muted">{text('Awaiting Delivery', 'Menunggu Penghantaran')}: {remaining} {item.unit}</p></div>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <Field label={text('Inventory Item', 'Item Inventori')}><select aria-label={text('Inventory Item', 'Item Inventori')} className={inputClass} disabled={busy || attempted} value={ingredientId} onChange={event => selectIngredient(event.target.value)}><option value="">{text('Choose an ingredient', 'Pilih bahan')}</option>{ingredients.filter(row => !fixedDeliveryUnit(item.unit) || row.base_unit === fixedDeliveryUnit(item.unit)!.baseUnit).map(row => <option value={row.id} key={row.id}>{row.name} ({row.base_unit})</option>)}</select></Field>
      <div className="grid grid-cols-2 items-end gap-3">
        <Field label={`${text('Quantity', 'Kuantiti')} (${item.unit})`}><input className={inputClass} disabled={busy || attempted} aria-invalid={quantity !== '' && !quantityValid} type="number" inputMode="decimal" min="0.01" max={remaining} step="0.01" value={quantity} onChange={e => {setQuantity(e.target.value);setConfirmed(false);}} /></Field>
        <Field label={`${ingredient?.base_unit ?? text('Base Units', 'Unit Asas')} ${text('per', 'setiap')} ${item.unit}`}><input className={inputClass} disabled={busy || attempted} readOnly={!!fixedDeliveryUnit(item.unit)} aria-invalid={size !== '' && !sizeValid} type="number" inputMode="decimal" min="0.0001" step="0.0001" value={size} placeholder={text('Enter size', 'Masukkan saiz')} onChange={e => {setSize(e.target.value);setConfirmed(false);}} /></Field>
      </div>
      {quantity !== '' && !quantityValid ? <p className="text-xs text-danger">{text(`Enter 0.01 to ${remaining} ${item.unit}, with up to two decimal places.`, `Masukkan 0.01 hingga ${remaining} ${item.unit}, sehingga dua tempat perpuluhan.`)}</p> : null}
      {size !== '' && !sizeValid ? <p className="text-xs text-danger">{text('Unit size must be greater than zero.', 'Saiz unit mesti melebihi sifar.')}</p> : null}
      {conversionIssue && !['quantity', 'exceeds', 'whole'].includes(conversionIssue) && quantityValid && sizeValid ? <p className="text-xs text-danger">{text(...deliveryErrorLabels[conversionIssue])}</p> : null}
      {ingredient && quantityValid && sizeValid && !baseValid ? <p className="text-xs text-danger">{text(ingredient.base_unit === 'unit' ? 'Stock must add up to whole individual units.' : 'The stock quantity is too small or too large.', ingredient.base_unit === 'unit' ? 'Jumlah stok mesti dalam unit individu penuh.' : 'Kuantiti stok terlalu kecil atau terlalu besar.')}</p> : null}
      <dl className="flex flex-wrap items-baseline justify-between gap-3 border-y border-line py-3"><dt className="text-sm text-muted">{text('Add to Inventory', 'Tambah ke Inventori')}</dt><dd className="min-w-0 break-all text-lg font-bold tabular">{valid ? `${base.toLocaleString('en-MY', {maximumFractionDigits:2})} ${ingredient!.base_unit}` : text('Not Set', 'Belum Ditetapkan')}</dd></dl>
      <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" disabled={busy || attempted} className="h-5 w-5 shrink-0 accent-accent" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />{text('I checked the delivered quantity and unit size.', 'Saya telah menyemak kuantiti dan saiz unit yang dihantar.')}</label>
    </div>
  </Modal>;
}
