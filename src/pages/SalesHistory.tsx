import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Ban, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Eye, RefreshCw, Search, X } from 'lucide-react';
import { Field, dangerButtonClass, iconButtonClass, inputClass, secondaryButtonClass } from '../components/Form';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/Page';
import { ViewChoices } from '../components/ViewChoices';
import { QrReceiptPreview } from '../components/QrReceiptPreview';
import { readClosingSnapshot } from '../lib/barClosing';
import { barPeriodRange, shiftBarPeriod } from '../lib/barReportPeriod';
import { checkedHistorySales, historyItemName, historyTotals, saleFingerprint, saleMatches, saleTime, type HistorySale } from '../lib/barSalesHistory';
import { useToast } from '../components/Toast';
import { malaysiaBusinessDateInputValue, money } from '../lib/format';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { loadLocalSaleItems, loadLocalSales, updateLocalQrPayment, voidLocalSale } from '../lib/localStore';
import { useAccess } from '../lib/access';
import type { PaymentMethod, SettingsMap } from '../lib/types';
import { useLanguage } from '../lib/language';
import { useSharedRefresh } from '../lib/useSharedRefresh';

type Selection = { scope: string; id: string; fingerprint: string };

export default function SalesHistory({ settings, embedded = false }: { settings: SettingsMap; embedded?: boolean }) {
  const toast = useToast();
  const { text, language } = useLanguage();
  const { can, profile } = useAccess();
  const [date, setDate] = useState(() => malaysiaBusinessDateInputValue(new Date(), settings.business_day_close_time));
  const [method, setMethod] = useState<PaymentMethod | 'all'>('all'), [query, setQuery] = useState('');
  const [sales, setSales] = useState<HistorySale[]>([]);
  const [verifiedScope, setVerifiedScope] = useState(''), [failedScope, setFailedScope] = useState<string | null>(null);
  const [reading, setReading] = useState(true);
  const [preview, setPreview] = useState<Selection | null>(null), [voiding, setVoiding] = useState<Selection | null>(null);
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false);
  const busyRef = useRef(false), generation = useRef(0);
  const scope = JSON.stringify([profile?.id, date]);
  const currentScope = useRef(scope); currentScope.current = scope;
  const validDate = !!barPeriodRange('day', date).range;
  const failed = failedScope === scope;
  const readable = validDate && !reading && !failed && verifiedScope === scope;
  const currency = String(settings.currency_symbol);

  async function refresh(background = false) {
    const ticket = ++generation.current;
    if (!validDate) { setReading(false); return; }
    if (!background) setReading(true);
    try {
      let rows: HistorySale[];
      if (isSupabaseConfigured) {
        const snapshot = await readClosingSnapshot(supabase, date);
        rows = checkedHistorySales(snapshot.sales, date).reverse();
      } else {
        const items = loadLocalSaleItems();
        rows = checkedHistorySales(loadLocalSales().filter(sale => sale.business_date === date).map(sale => ({ ...sale, sale_items: items.filter(item => item.sale_id === sale.id) })), date)
          .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id));
      }
      if (ticket !== generation.current || currentScope.current !== scope) return;
      setSales(rows); setVerifiedScope(scope); setFailedScope(null);
      const stillMatches = (selected: Selection | null) => selected?.scope === scope && rows.some(row => row.id === selected.id && saleFingerprint(row) === selected.fingerprint);
      setPreview(selected => stillMatches(selected) ? selected : null);
      if (!busyRef.current) setVoiding(selected => stillMatches(selected) ? selected : null);
    } catch {
      if (ticket === generation.current && currentScope.current === scope) { setFailedScope(scope); setPreview(null); }
    } finally { if (ticket === generation.current && currentScope.current === scope) setReading(false); }
  }
  useEffect(() => { void refresh(); return () => { generation.current++; }; }, [scope]);
  useSharedRefresh(() => refresh(true), { tables: ['sales', 'sale_items', 'stock_movements'], intervalMs: 12000, enabled: validDate });

  const byMethod = useMemo(() => readable ? sales.filter(sale => method === 'all' || sale.payment_method === method) : [], [readable, sales, method]);
  const totals = useMemo(() => historyTotals(byMethod), [byMethod]);
  const filtered = byMethod.filter(sale => saleMatches(sale, query));
  const filterScope = JSON.stringify([scope, method, query]);
  const [windowState, setWindowState] = useState({ key: '', count: 50 });
  const limit = windowState.key === filterScope ? windowState.count : 50;
  const visible = filtered.slice(0, limit);
  function changeFilter(action: () => void) {
    if (busyRef.current) return;
    setPreview(null); setVoiding(null); setReason(''); setWindowState({ key: '', count: 50 }); action();
  }
  const selection = (sale: HistorySale): Selection => ({ scope, id: sale.id, fingerprint: saleFingerprint(sale) });
  function selectedSale(selected: Selection | null) {
    return readable && selected?.scope === scope ? sales.find(sale => sale.id === selected.id && saleFingerprint(sale) === selected.fingerprint) : undefined;
  }
  const previewSale = selectedSale(preview), voidSaleRecord = selectedSale(voiding);

  async function voidSale() {
    const sale = voidSaleRecord;
    if (!sale || sale.status !== 'completed' || !reason.trim() || !can('bar.pos.void') || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      if (isSupabaseConfigured) {
        const result = await supabase.rpc('void_sale', { p_sale_id: sale.id, p_reason: reason });
        if (result.error) throw result.error;
      } else if (!voidLocalSale(sale.id, reason.trim())) throw new Error('Sale could not be voided.');
      if (currentScope.current !== scope) return;
      setVoiding(null); setReason(''); await refresh();
      toast.success(text('Sale voided and stock reversed.', 'Jualan dibatalkan dan stok dibalikkan.'));
    } catch { if (currentScope.current === scope) toast.error(text('Could not confirm the result. Refresh and check this sale before trying again.', 'Keputusan tidak dapat disahkan. Muat semula dan semak jualan ini sebelum mencuba lagi.')); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function verifyQr(sale: HistorySale, status: 'verified' | 'mismatch') {
    if (!selectedSale(selection(sale)) || sale.status !== 'completed' || sale.payment_method !== 'qr' || !can('bar.closing.manage') || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      if (isSupabaseConfigured) {
        const result = await supabase.rpc('verify_qr_payment', { p_sale_id: sale.id, p_status: status, p_notes: null });
        if (result.error) throw result.error;
      } else updateLocalQrPayment(sale.id, status);
      if (currentScope.current !== scope) return;
      await refresh(); toast.success(text('QR status updated.', 'Status QR dikemas kini.'));
    } catch { if (currentScope.current === scope) toast.error(text('Could not confirm the result. Refresh and check this sale before trying again.', 'Keputusan tidak dapat disahkan. Muat semula dan semak jualan ini sebelum mencuba lagi.')); }
    finally { busyRef.current = false; setBusy(false); }
  }

  const methodLabel = (value: PaymentMethod | 'all') => value === 'all' ? text('All', 'Semua') : value === 'cash' ? text('Cash', 'Tunai') : value === 'qr' ? 'QR' : 'FOC';
  const badge = (sale: HistorySale) => <div className="flex flex-wrap gap-1 text-xs"><span className="rounded bg-shell px-1.5 py-0.5 font-semibold">{methodLabel(sale.payment_method)}</span>{sale.status === 'voided' ? <span className="rounded bg-red-50 px-1.5 py-0.5 font-semibold text-danger">{text('Voided', 'Dibatalkan')}</span> : sale.payment_method === 'qr' ? <span className={'rounded px-1.5 py-0.5 ' + (sale.qr_status === 'verified' ? 'bg-shell text-accent' : 'bg-amber-50 text-warning')}>{sale.qr_status === 'verified' ? text('Verified', 'Disahkan') : sale.qr_status === 'mismatch' ? text('Mismatch', 'Tidak Sepadan') : sale.qr_status === 'pending' ? text('Pending', 'Belum Disahkan') : text('Not Required', 'Tidak Diperlukan')}</span> : null}</div>;
  const items = (sale: HistorySale) => <div className="space-y-1 text-sm [overflow-wrap:anywhere]">{sale.sale_items.length ? sale.sale_items.map(item => <p key={item.id}><span className="font-semibold tabular-nums">{item.quantity} × </span>{historyItemName(item) || text('Item Unavailable', 'Item Tidak Tersedia')}</p>) : <p className="text-muted">{text('Item Details Unavailable', 'Butiran Item Tidak Tersedia')}</p>}{sale.discount_amount ? <p className="text-xs text-muted">{text('Discount', 'Diskaun')}: {money(sale.discount_amount, currency)}</p> : null}{sale.complimentary_reason ? <p className="text-xs text-muted">{text('FOC Reason', 'Sebab FOC')}: {sale.complimentary_reason}</p> : null}{sale.status === 'voided' ? <p className="text-xs text-danger">{text('Void Reason', 'Sebab Batal')}: {sale.void_reason || text('Not Recorded', 'Tidak Direkod')}</p> : null}</div>;
  const amount = (sale: HistorySale) => <div className="text-right"><p className="text-xs text-muted">{sale.status === 'voided' ? text('Original Value', 'Nilai Asal') : sale.payment_method === 'complimentary' ? text('FOC Value', 'Nilai FOC') : text('Paid', 'Dibayar')}</p><p className="font-semibold tabular-nums">{money(sale.payment_method === 'complimentary' || sale.status === 'voided' ? sale.total_amount : sale.paid_amount, currency)}</p></div>;
  const details = (sale: HistorySale) => <div className="mt-1 space-y-1 text-xs text-muted [overflow-wrap:anywhere]"><p>{text('Staff', 'Staf')}: {sale.order_taken_by || text('Not Recorded', 'Tidak Direkod')}{sale.table_number ? <> · {text('Table', 'Meja')}: {sale.table_number}</> : null}</p>{sale.payment_method === 'qr' ? <p>{sale.qr_payment_type ? sale.qr_payment_type + ' · ' : ''}{text('Reference', 'Rujukan')}: {sale.qr_reference || text('Not Recorded', 'Tidak Direkod')}</p> : null}</div>;
  const actions = (sale: HistorySale) => <div className="bar-sale-actions">
    {sale.payment_method === 'qr' && sale.qr_receipt_image_path ? <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => setPreview(selection(sale))}><Eye size={16} />{text('Receipt', 'Resit')}</button> : null}
    {sale.status === 'completed' && sale.payment_method === 'qr' && can('bar.closing.manage') ? <><button type="button" className={iconButtonClass} disabled={busy || sale.qr_status === 'verified'} title={text('Verify QR', 'Sahkan QR')} aria-label={text('Verify QR', 'Sahkan QR')} onClick={() => void verifyQr(sale, 'verified')}><CheckCircle2 size={18} /></button><button type="button" className={iconButtonClass} disabled={busy || sale.qr_status === 'mismatch'} title={text('Mark QR Mismatch', 'Tandakan QR Tidak Sepadan')} aria-label={text('Mark QR Mismatch', 'Tandakan QR Tidak Sepadan')} onClick={() => void verifyQr(sale, 'mismatch')}><AlertTriangle size={18} /></button></> : null}
    {sale.status === 'completed' && can('bar.pos.void') ? <button type="button" className={iconButtonClass + ' text-danger'} disabled={busy} title={text('Void Sale', 'Batalkan Jualan')} aria-label={text('Void Sale', 'Batalkan Jualan')} onClick={() => { setReason(''); setVoiding(selection(sale)); }}><Ban size={18} /></button> : null}
  </div>;

  return <div className="bar-sales-history">
    {!embedded ? <PageHeader title={text('Sales History', 'Sejarah Jualan')} /> : null}
    <div className="bar-sales-toolbar">
      <div><label className="mb-1 block text-xs text-muted" htmlFor="sales-business-date">{text('Business Date', 'Tarikh Perniagaan')} · MYT</label><div className="bar-date-stepper">
        {([-1, 0, 1] as const).map(direction => direction === 0 ? <input key="date" id="sales-business-date" type="date" value={date} disabled={busy} onChange={event => changeFilter(() => setDate(event.target.value))} /> : <button type="button" key={direction} disabled={busy || !shiftBarPeriod('day', date, direction)} title={direction < 0 ? text('Previous Day', 'Hari Sebelumnya') : text('Next Day', 'Hari Seterusnya')} aria-label={direction < 0 ? text('Previous Day', 'Hari Sebelumnya') : text('Next Day', 'Hari Seterusnya')} onClick={() => { const next = shiftBarPeriod('day', date, direction); if (next) changeFilter(() => setDate(next)); }}>{direction < 0 ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}</button>)}
      </div></div>
      <div className={busy ? 'pointer-events-none opacity-50' : ''} aria-disabled={busy}><ViewChoices label={text('Payment Method', 'Kaedah Bayaran')} value={method} className="bar-sales-methods" items={(['all', 'cash', 'qr', 'complimentary'] as const).map(value => ({ value, label: methodLabel(value) }))} onChange={next => changeFilter(() => setMethod(next as typeof method))} /></div>
      <button type="button" className={iconButtonClass} disabled={busy || reading || !validDate} aria-label={text('Refresh Sales', 'Muat Semula Jualan')} title={text('Refresh Sales', 'Muat Semula Jualan')} onClick={() => void refresh()}><RefreshCw size={16} /></button>
    </div>
    <div className="relative mb-3 min-w-0"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input type="search" disabled={busy} className={inputClass + ' pl-9 pr-11'} aria-label={text('Search Sales', 'Cari Jualan')} placeholder={text('Sale, staff, table or item', 'Jualan, staf, meja atau item')} value={query} onChange={event => changeFilter(() => setQuery(event.target.value))} />{query ? <button className="ui-icon absolute right-0 top-1/2 -translate-y-1/2 text-muted" disabled={busy} aria-label={text('Clear Search', 'Padam Carian')} title={text('Clear Search', 'Padam Carian')} onClick={() => changeFilter(() => setQuery(''))}><X size={16} /></button> : null}</div>
    {!validDate ? <p role="alert" className="py-3 text-sm text-danger">{text('Enter a valid business date.', 'Masukkan tarikh perniagaan yang sah.')}</p> : failed && !reading ? <div role="alert" className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-danger/30 p-3 text-sm text-danger"><span>{text('Sales could not be verified. Refresh before using these figures.', 'Jualan tidak dapat disahkan. Muat semula sebelum menggunakan angka ini.')}</span><button className={secondaryButtonClass} onClick={() => void refresh()}><RefreshCw size={16} />{text('Retry', 'Cuba Lagi')}</button></div> : !readable ? <p role="status" className="py-4 text-sm text-muted">{text('Checking Sales...', 'Menyemak Jualan...')}</p> : null}
    {readable ? <>
      <h2 className="text-sm font-semibold">{text('Day Totals', 'Jumlah Harian')} · {methodLabel(method)}</h2>
      <dl className="bar-metrics bar-sales-metrics" data-sales-totals>{[[text('Revenue', 'Hasil'), money(totals.revenue, currency)], [text('Cash', 'Tunai'), money(totals.cash, currency)], ['QR', money(totals.qr, currency)], [text('FOC Value', 'Nilai FOC'), money(totals.focCost, currency)], [text('Transactions', 'Transaksi'), totals.transactions], [text('Voided', 'Dibatalkan'), totals.voided]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <p className="mb-2 text-xs text-muted" role="status">{text('Showing', 'Memaparkan')} {visible.length} {text('of', 'daripada')} {filtered.length} {text('Sales', 'Jualan')}</p>
      <div className="bar-sales-mobile">{visible.map(sale => <article key={sale.id} data-sale-id={sale.id} className="min-w-0 border-b border-line py-3 first:pt-1"><div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2"><div className="min-w-0"><p className="text-sm font-semibold [overflow-wrap:anywhere]">{sale.sale_number}</p><time className="mt-1 block text-xs text-muted" dateTime={sale.created_at}>{saleTime(sale, language)} MYT</time></div>{amount(sale)}</div><div className="mt-2">{badge(sale)}</div>{details(sale)}<div className="my-3">{items(sale)}</div>{actions(sale)}</article>)}</div>
      <div className="bar-sales-desktop clean-scroll overflow-x-auto rounded-lg border border-line"><table className="dense-table w-full min-w-[960px] table-fixed text-left text-sm"><thead className="bg-shell text-xs text-muted"><tr><th className="w-[23%] p-3">{text('Sale / Time (MYT)', 'Jualan / Masa (MYT)')}</th><th className="w-[14%] p-3">{text('Payment', 'Bayaran')}</th><th className="w-[29%] p-3">{text('Items', 'Item')}</th><th className="w-[14%] p-3 text-right">{text('Amount', 'Amaun')}</th><th className="w-[20%] p-3">{text('Actions', 'Tindakan')}</th></tr></thead><tbody>{visible.map(sale => <tr key={sale.id} data-sale-id={sale.id} className="border-t border-line align-top"><td className="p-3 [overflow-wrap:anywhere]"><p className="font-semibold">{sale.sale_number}</p><time className="mt-1 block text-xs text-muted" dateTime={sale.created_at}>{saleTime(sale, language)} MYT</time>{details(sale)}</td><td className="p-3">{badge(sale)}</td><td className="p-3">{items(sale)}</td><td className="p-3">{amount(sale)}</td><td className="p-3">{actions(sale)}</td></tr>)}</tbody></table></div>
      {!filtered.length ? <p className="py-5 text-sm text-muted">{byMethod.length ? text('No matching sales.', 'Tiada jualan sepadan.') : text('No sales for this date and payment method.', 'Tiada jualan untuk tarikh dan kaedah bayaran ini.')}</p> : null}
      {visible.length < filtered.length ? <button className={secondaryButtonClass + ' mt-3 w-full sm:w-auto'} onClick={() => setWindowState({ key: filterScope, count: limit + 50 })}><ChevronDown size={16} />{text('Show More', 'Lihat Lagi')}</button> : null}
    </> : null}
    {previewSale ? <QrReceiptPreview key={preview!.scope + preview!.id + preview!.fingerprint} sale={previewSale} currency={currency} onClose={() => setPreview(null)} /> : null}
    {voidSaleRecord ? <Modal title={text('Void Sale', 'Batalkan Jualan') + ' · ' + voidSaleRecord.sale_number} onClose={() => { if (!busyRef.current) setVoiding(null); }} footer={<><button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => setVoiding(null)}>{text('Cancel', 'Batal')}</button><button type="button" className={dangerButtonClass} disabled={busy || !reason.trim()} onClick={() => void voidSale()}><Ban size={16} />{busy ? text('Saving...', 'Menyimpan...') : text('Void Sale', 'Batalkan Jualan')}</button></>}><Field label={text('Reason', 'Sebab')}><textarea className={inputClass} disabled={busy} value={reason} onChange={event => setReason(event.target.value)} /></Field></Modal> : null}
  </div>;
}
