import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Eye, Smartphone } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Field, buttonClass, inputClass, secondaryButtonClass } from '../components/Form';
import { Modal } from '../components/Modal';
import { PageHeader, Stat } from '../components/Page';
import { WorkflowHelp } from '../components/WorkflowHelp';
import { useToast } from '../components/Toast';
import { malaysiaBusinessDateInputValue, money } from '../lib/format';
import { supabase } from '../lib/supabase';
import { isSupabaseConfigured } from '../lib/supabase';
import { loadLocalDailyReports, loadLocalProducts, loadLocalSaleItems, loadLocalSales, saveLocalDailyReport } from '../lib/localStore';
import type { DailyReport, Sale, SaleItem, SettingsMap } from '../lib/types';
import { useLanguage } from '../lib/language';
import { actualItemSales, type ItemSalesBreakdown } from '../lib/reportItems';
import { useSharedRefresh } from '../lib/useSharedRefresh';
import { useAccess } from '../lib/access';
import { readClosingAttempt, readClosingSnapshot, storeClosingAttempt, submitClosing, type ClosingAttempt } from '../lib/barClosing';
import { definitiveInitialSaveFailure } from '../lib/saveAttempt';
import { useSaleAction } from '../lib/useSaleAction';
import { SaleActionRecovery } from '../components/SaleActionRecovery';
import { QrReceiptPreview } from '../components/QrReceiptPreview';
import { historyTotals, saleFingerprint } from '../lib/barSalesHistory';
import { barPeriodRange } from '../lib/barReportPeriod';
import { useReportReopen } from '../lib/useReportReopen';
import { ReportReopenRecovery } from '../components/ReportReopenRecovery';

type SaleWithItems = Sale & { sale_items?: SaleItem[] };
const receiptFingerprint = (sale: SaleWithItems) => saleFingerprint({ ...sale, sale_items: sale.sale_items ?? [] });

function labelStatus(value: string | null | undefined) {
  return String(value ?? '-')
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function qrStatusClass(value: string | null | undefined) {
  if (value === 'verified') return 'bg-shell text-accent';
  if (value === 'mismatch') return 'bg-amber-50 text-warning';
  if (value === 'pending') return 'bg-pink-100 text-coral';
  return 'bg-white text-neutral-600';
}

function reportNumber(report: DailyReport | null, keys: string[]) {
  const json = report?.report_json ?? {};
  for (const key of keys) {
    const value = json[key];
    const numberValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isFinite(numberValue)) return numberValue;
  }
  return null;
}

function savedItemSales(report: DailyReport | null): ItemSalesBreakdown[] {
  const json = report?.report_json ?? {};
  const rawItems = Array.isArray(json.itemSales)
    ? json.itemSales
    : Array.isArray(json.sales_by_product)
      ? json.sales_by_product
      : [];

  return rawItems
    .map((raw) => {
      if (!raw || typeof raw !== 'object') return null;
      const row = raw as Record<string, unknown>;
      const product = String(row.product ?? row.name ?? 'Custom Order');
      const quantity = Number(row.quantity ?? 0);
      const cash = Number(row.cash ?? 0);
      const qr = Number(row.qr ?? 0);
      const focCost = Number(row.focCost ?? row.foc_cost ?? 0);
      const discount = Number(row.discount ?? 0);
      if (!product || !Number.isFinite(quantity)) return null;
      return {
        product,
        quantity: Number.isFinite(quantity) ? quantity : 0,
        cash: Number.isFinite(cash) ? cash : 0,
        qr: Number.isFinite(qr) ? qr : 0,
        focCost: Number.isFinite(focCost) ? focCost : 0,
        discount: Number.isFinite(discount) ? discount : 0,
      } satisfies ItemSalesBreakdown;
    })
    .filter((item): item is ItemSalesBreakdown => Boolean(item));
}

export default function DailyClosing({ settings }: { settings: SettingsMap }) {
  const {profile} = useAccess();
  return <DailyClosingWorkspace key={profile?.id ?? 'no-account'} settings={settings}/>;
}

function DailyClosingWorkspace({ settings }: { settings: SettingsMap }) {
  const toast = useToast();
  const { text } = useLanguage();
  const { profile } = useAccess();
  const pendingKey = 'lovely_paradise_closing:' + profile?.id;
  const [restored] = useState(() => { try { return { attempt:readClosingAttempt(localStorage,pendingKey),error:'' }; } catch(e) { return { attempt:null,error:(e as Error).message }; } });
  const [pendingClosing,setPendingClosing] = useState<ClosingAttempt|null>(restored.attempt);
  const [readError,setReadError] = useState(restored.error);
  const [reading,setReading] = useState(true);
  const [closingVersion,setClosingVersion] = useState('');
  const [verifiedDate, setVerifiedDate] = useState('');
  const [openingFloat,setOpeningFloat] = useState(0);
  const readGeneration=useRef(0),closingBusy=useRef(false);
  const [searchParams] = useSearchParams();
  const reopening = useReportReopen(profile?.id ?? null, async () => {
    const fresh = await refresh(currentDate.current, true);
    if (fresh?.status === 'reopened') enableCorrection(fresh);
  });
  const [businessDate, setBusinessDate] = useState(() => reopening.pending?.args.p_business_date ?? restored.attempt?.payload.p_business_date ?? searchParams.get('date') ?? malaysiaBusinessDateInputValue(new Date(), settings.business_day_close_time));
  const currentDate = useRef(businessDate); currentDate.current = businessDate;
  const reviewedVersion = useRef(''), requestedCorrection = useRef<string | null>(null), processedRoute = useRef<string | null>(null);
  const validDate = !!barPeriodRange('day', businessDate).range;
  const [actualCash, setActualCash] = useState('');
  const [notes, setNotes] = useState('');
  const [sales, setSales] = useState<SaleWithItems[]>([]);
  const [report, setReport] = useState<DailyReport | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [detailsConfirmed, setDetailsConfirmed] = useState(false);
  const [correctionMode, setCorrectionMode] = useState(false);
  const [receiptPreview, setReceiptPreview] = useState<{ date: string; id: string; fingerprint: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const saleAction = useSaleAction(profile?.id ?? null, async () => { await refresh(); });
  const verifyingQrKey = saleAction.busy && saleAction.pending ? `${saleAction.pending.args.p_sale_id}:${saleAction.pending.args.p_action}` : null;
  const readable = validDate && !reading && !readError && verifiedDate === businessDate;
  const readErrorLabel = readError === 'unverified'
    ? text('Closing figures could not be verified. Retry before using them.', 'Angka tutup tidak dapat disahkan. Cuba lagi sebelum menggunakannya.')
    : text('The saved closing recovery could not be read. Ask the owner to check this device.', 'Pemulihan tutup tersimpan tidak dapat dibaca. Minta pemilik menyemak peranti ini.');
  const isClosed = Boolean(report && report.status === 'closed');
  const isLocked = isClosed && !correctionMode;

  function changeBusinessDate(date: string) {
    if (date === businessDate) return;
    setActualCash(''); setNotes(''); setDetailsConfirmed(false); setConfirming(false);
    setReceiptPreview(null);
    setVerifiedDate(''); setReading(true); setReadError(restored.error);
    setClosingVersion(''); reviewedVersion.current = '';
    if (requestedCorrection.current !== date) requestedCorrection.current = null;
    currentDate.current = date;
    setBusinessDate(date);
  }

  async function refresh(date = businessDate, quiet = false) {
    const generation=++readGeneration.current;
    if (!barPeriodRange('day', date).range) { setReading(false); setVerifiedDate(''); return null; }
    if(!quiet)setReading(true);
    try {
    if (!isSupabaseConfigured) {
      const localSaleItems = loadLocalSaleItems();
      setSales(
        loadLocalSales()
          .filter((sale) => {
            const saleDate = sale.business_date || (sale.created_at ? malaysiaBusinessDateInputValue(sale.created_at, settings.business_day_close_time) : '');
            return saleDate === date;
          })
          .map((sale) => ({ ...sale, sale_items: localSaleItems.filter((item) => item.sale_id === sale.id) })),
      );
      const localReport = loadLocalDailyReports().find((item) => item.business_date === date) ?? null;
      setReport(localReport);
      setVerifiedDate(date); setReadError(restored.error);
      setCorrectionMode(false);
      setReading(false);
      return localReport;
    }
    const snapshot=await readClosingSnapshot(supabase,date);
    if(generation!==readGeneration.current || currentDate.current !== date)return null;
    if (reviewedVersion.current && reviewedVersion.current !== snapshot.version) { setDetailsConfirmed(false); setConfirming(false); }
    reviewedVersion.current = snapshot.version;
    setSales(snapshot.sales);
    setReport(snapshot.report);
    setClosingVersion(snapshot.version);
    setOpeningFloat(snapshot.cash_session?.opening_float ?? 0);
    setVerifiedDate(date);
    setReadError(restored.error);
    setCorrectionMode(false);
    return snapshot.report;
    } catch(e) {
      if(generation===readGeneration.current && currentDate.current === date) { setVerifiedDate(''); setReadError('unverified'); }
      return null;
    } finally { if(generation===readGeneration.current && currentDate.current === date)setReading(false); }
  }

  function enableCorrection(loadedReport: DailyReport) {
    if (loadedReport.business_date !== currentDate.current) return;
    setCorrectionMode(true);
    setActualCash(loadedReport.actual_cash_counted == null ? '' : String(loadedReport.actual_cash_counted));
    setNotes(loadedReport.notes ?? '');
  }

  async function openCorrectionFromReports(date: string, loadedReport: DailyReport | null) {
    if (!loadedReport || currentDate.current !== date || loadedReport.business_date !== date) return;
    if (!isSupabaseConfigured || loadedReport.status === 'reopened') {
      enableCorrection(loadedReport);
      return;
    }
    await reopening.run(loadedReport, closingVersion);
  }

  function consumeReportEditUnlock(date: string) {
    const key = `lovely_paradise_report_edit:${date}`;
    const unlocked = sessionStorage.getItem(key) === 'ok';
    if (unlocked) sessionStorage.removeItem(key);
    return unlocked;
  }

  useEffect(() => {
    const queryDate = reopening.pending?.args.p_business_date ?? pendingClosing?.payload.p_business_date ?? searchParams.get('date') ?? malaysiaBusinessDateInputValue(new Date(), settings.business_day_close_time);
    const route = searchParams.toString();
    if (processedRoute.current !== route) {
      processedRoute.current = route;
      requestedCorrection.current = null;
      if (searchParams.get('edit') === '1' && barPeriodRange('day', queryDate).range && !pendingClosing && !reopening.blocked) {
        if (consumeReportEditUnlock(queryDate)) requestedCorrection.current = queryDate;
        else toast.error(text('Open edit from Reports and enter the admin password first.', 'Buka sunting daripada Laporan dan masukkan kata laluan admin dahulu.'));
      }
    }
    changeBusinessDate(queryDate);
  }, [searchParams, settings.business_day_close_time, reopening.pending?.args.p_business_date]);

  useEffect(() => {
    void refresh();
    return () => { readGeneration.current++; };
  }, [businessDate]);

  useEffect(() => {
    if (!readable || requestedCorrection.current !== businessDate || pendingClosing || saleAction.blocked || reopening.blocked) return;
    requestedCorrection.current = null;
    if (report) void openCorrectionFromReports(businessDate, report);
  }, [businessDate, readable, report, pendingClosing, saleAction.blocked, reopening.blocked, searchParams]);

  useSharedRefresh(() => refresh(businessDate,true), {
    tables: ['sales', 'sale_items', 'daily_reports', 'cash_sessions', 'stock_movements'],
    intervalMs: 12000,
  });

  const previewSale = readable && receiptPreview?.date === businessDate
    ? sales.find(sale => sale.id === receiptPreview.id && receiptFingerprint(sale) === receiptPreview.fingerprint)
    : undefined;
  useEffect(() => {
    setReceiptPreview(selected => selected && !readError && selected.date === businessDate && sales.some(sale => sale.id === selected.id && receiptFingerprint(sale) === selected.fingerprint) ? selected : null);
  }, [sales, businessDate, readError]);

  const totals = useMemo(() => {
    const completed = sales.filter((sale) => sale.status === 'completed');
    const exact = historyTotals(sales);
    return {
      cash: exact.cash, qr: exact.qr, focCost: exact.focCost, paidRevenue: exact.revenue, tx: exact.transactions,
      qrPending: historyTotals(completed.filter(sale => sale.qr_status === 'pending')).qr,
      qrVerified: historyTotals(completed.filter(sale => sale.qr_status === 'verified')).qr,
      qrMismatch: historyTotals(completed.filter(sale => sale.qr_status === 'mismatch')).qr,
    };
  }, [sales]);

  const liveItemSales = useMemo(() => actualItemSales(sales), [sales]);
  const snapshotItemSales = useMemo(() => savedItemSales(report), [report]);
  const itemSales = isLocked && snapshotItemSales.length > 0 ? snapshotItemSales : liveItemSales;
  const actualCashNumber = Number(actualCash);
  const expectedCash=openingFloat+totals.cash;
  const actualCashValid = actualCash.trim().length > 0 && Number.isFinite(actualCashNumber) && actualCashNumber >= 0;
  const displayTransactions = isLocked
    ? reportNumber(report, ['number_of_transactions']) ?? (Array.isArray(report?.report_json?.sales) ? report.report_json.sales.length : totals.tx)
    : totals.tx;
  const displayQrPending = isLocked ? reportNumber(report, ['qr_pending_total', 'qrPending']) ?? totals.qrPending : totals.qrPending;
  const displayQrVerified = isLocked ? reportNumber(report, ['qr_verified_total', 'qrVerified']) ?? totals.qrVerified : totals.qrVerified;
  const displayQrMismatch = isLocked ? reportNumber(report, ['qr_mismatch_total', 'qrMismatch']) ?? totals.qrMismatch : totals.qrMismatch;
  const completedQrSales = sales.filter((sale) => sale.payment_method === 'qr' && sale.status === 'completed');
  const pendingQrSales = completedQrSales.filter((sale) => sale.qr_status === 'pending');
  const selectedDateLabel = useMemo(() => validDate ? new Intl.DateTimeFormat(text('en-GB', 'ms-MY'), { timeZone: 'Asia/Kuala_Lumpur', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(businessDate + 'T12:00:00+08:00')) : '', [businessDate, validDate, text]);
  const closeReadiness = isLocked
    ? { label: text('Closed', 'Ditutup'), tone: 'bg-shell text-accent border-accent', icon: <CheckCircle2 className="h-4 w-4" /> }
    : totals.qrPending > 0
      ? { label: text('QR Payment pending', 'Bayaran QR belum sah'), tone: 'bg-pink-100 text-coral border-danger', icon: <AlertTriangle className="h-4 w-4" /> }
      : actualCashValid
        ? { label: text('Ready to close', 'Sedia ditutup'), tone: 'bg-shell text-accent border-accent', icon: <CheckCircle2 className="h-4 w-4" /> }
        : { label: text('Enter actual cash', 'Isi tunai sebenar'), tone: 'bg-amber-50 text-warning border-warning', icon: <AlertTriangle className="h-4 w-4" /> };

  const itemTotals = itemSales.reduce(
    (sum, item) => ({
      quantity: sum.quantity + item.quantity,
      cash: sum.cash + item.cash,
      qr: sum.qr + item.qr,
      focCost: sum.focCost + item.focCost,
      discount: sum.discount + item.discount,
      paidSales: sum.paidSales + item.cash + item.qr,
    }),
    { quantity: 0, cash: 0, qr: 0, focCost: 0, discount: 0, paidSales: 0 },
  );

  async function closeReport() {
    if (saving || closingBusy.current || !readable || pendingClosing || saleAction.blocked || reopening.blocked) return;
    if (!actualCashValid) {
      toast.error(text('Enter a valid actual cash counted amount.', 'Masukkan jumlah tunai sebenar yang betul.'));
      return;
    }
    if (totals.qrPending > 0) {
      toast.error(text('Cannot close daily report while QR Payment is still pending.', 'Tidak boleh tutup laporan harian semasa Bayaran QR masih belum disahkan.'));
      return;
    }
    if (!detailsConfirmed) {
      toast.error(text('Please confirm all closing details are accurate before submitting.', 'Sahkan semua butiran tutup adalah tepat sebelum hantar.'));
      return;
    }
    setSaving(true);
    if (!isSupabaseConfigured) {
      const productCategoryByName = new Map(loadLocalProducts(true).map((product) => [product.name, product.categories?.name ?? 'Others']));
      const salesByCategory = Array.from(itemSales.reduce((rows, item) => {
        const category = productCategoryByName.get(item.product) ?? (item.product === 'Custom Order' ? 'Custom Order' : 'Others');
        const current = rows.get(category) ?? { name: category, quantity: 0, cash: 0, qr: 0, foc_cost: 0, discount: 0, paid_sales: 0 };
        current.quantity += item.quantity;
        current.cash += item.cash;
        current.qr += item.qr;
        current.foc_cost += item.focCost;
        current.discount += item.discount;
        current.paid_sales += item.cash + item.qr;
        rows.set(category, current);
        return rows;
      }, new Map<string, { name: string; quantity: number; cash: number; qr: number; foc_cost: number; discount: number; paid_sales: number }>()).values());
      const nextReport: DailyReport = {
        id: crypto.randomUUID(),
        business_date: businessDate,
        report_json: {
          business_date: businessDate,
          sales,
          itemSales,
          sales_by_product: itemSales.map((item) => ({
            name: item.product,
            quantity: item.quantity,
            cash: item.cash,
            qr: item.qr,
            foc_cost: item.focCost,
            discount: item.discount,
            paid_sales: item.cash + item.qr,
          })),
          sales_by_category: salesByCategory,
          number_of_transactions: totals.tx,
          focCost: totals.focCost,
          qrPending: totals.qrPending,
          qrVerified: totals.qrVerified,
          qrMismatch: totals.qrMismatch,
          qr_pending_total: totals.qrPending,
          qr_verified_total: totals.qrVerified,
          qr_mismatch_total: totals.qrMismatch,
        },
        total_cash: totals.cash,
        total_qr: totals.qr,
        total_complimentary_value: totals.focCost,
        total_sales: totals.paidRevenue,
        actual_cash_counted: actualCashNumber,
        expected_cash: totals.cash,
        cash_variance: actualCashNumber - totals.cash,
        closed_by: 'local',
        closed_at: new Date().toISOString(),
        reopened_by: null,
        reopened_at: null,
        status: 'closed',
        notes,
      };
      saveLocalDailyReport(nextReport);
      setReport(nextReport);
      setSaving(false);
      setConfirming(false);
      setDetailsConfirmed(false);
      toast.success(text('Daily closing saved. FOC is recorded as cost, not total revenue.', 'Tutup harian disimpan. FOC direkod sebagai kos, bukan jumlah hasil.'));
      return;
    }
    const attempt:ClosingAttempt={version:1,attempted:false,createdAt:new Date().toISOString(),payload:{
      p_business_date:businessDate,p_actual_cash_counted:actualCashNumber,p_notes:notes||null,
      p_expected_version:closingVersion,p_request_id:crypto.randomUUID(),
    }};
    await resolveClosing(attempt);
  }

  async function resolveClosing(attempt:ClosingAttempt) {
    if(closingBusy.current)return;
    closingBusy.current=true;setSaving(true);
    let submitted=false,confirmed=false;
    try {
      const retained={...attempt,attempted:true};
      storeClosingAttempt(localStorage,pendingKey,retained);setPendingClosing(retained);submitted=true;
      const result=await submitClosing(supabase,retained);confirmed=true;
      localStorage.removeItem(pendingKey);setPendingClosing(null);setReport(result);
      setConfirming(false);setDetailsConfirmed(false);
      toast.success(text('Daily closing saved.','Tutup harian disimpan.'));
      await refresh(result.business_date,true);
    }catch(e){
      if(submitted&&!confirmed&&definitiveInitialSaveFailure(attempt.attempted,e)){
        localStorage.removeItem(pendingKey);setPendingClosing(null);setConfirming(false);setDetailsConfirmed(false);
        await refresh(attempt.payload.p_business_date,true);
      }
      toast.error((e as Error).message || text('Closing confirmation is pending. Check the same closing.','Pengesahan tutup belum diterima. Semak tutup yang sama.'));
    }finally{closingBusy.current=false;setSaving(false);}
  }

  async function verifyQrPayment(sale: Sale, status: 'verified' | 'mismatch') {
    if (saleAction.blocked || reopening.blocked || pendingClosing || saving || !readable || isClosed) return;
    await saleAction.run(sale, status);
  }

  function viewQrReceipt(sale: SaleWithItems) {
    if (!readable || !sale.qr_receipt_image_path || !sales.some(current => current.id === sale.id && receiptFingerprint(current) === receiptFingerprint(sale))) return;
    setReceiptPreview({ date: businessDate, id: sale.id, fingerprint: receiptFingerprint(sale) });
  }

  return (
    <>
      <PageHeader
        title={text('Daily Closing', 'Tutup Harian')}
        actions={<WorkflowHelp area="bar" />}
      />
      <SaleActionRecovery action={saleAction} currency={String(settings.currency_symbol)}/>
      <ReportReopenRecovery action={reopening}/>
      <div className="mb-3 max-w-xs"><Field label={text('Business date', 'Tarikh bisnes')}>
        <input className={inputClass} type="date" value={businessDate} disabled={!!pendingClosing || saving || reopening.blocked} aria-invalid={!validDate} onChange={event => changeBusinessDate(event.target.value)} />
      </Field></div>
      {validDate && readError?<div role="alert" className="mb-3 text-sm text-danger">{readErrorLabel} <button className={secondaryButtonClass} onClick={()=>void refresh()}>{text('Retry','Cuba Lagi')}</button></div>:null}
      {reading?<p role="status" className="mb-3 text-sm text-muted">{text('Loading Closing...','Memuatkan Tutup...')}</p>:null}
      {pendingClosing?<section role="status" className="mb-3 border-y border-line py-3"><p className="text-sm font-semibold">{text('Closing Confirmation Pending','Pengesahan Tutup Belum Diterima')} · {pendingClosing.payload.p_business_date}</p><p className="my-2 text-sm">{text('Your original closing is kept. Check it before making another closing.','Rekod tutup asal dikekalkan. Semak sebelum membuat tutup lain.')}</p><button className={buttonClass} disabled={saving} onClick={()=>void resolveClosing(pendingClosing)}>{text('Check Closing','Semak Tutup')}</button></section>:null}
      {!validDate ? <p role="alert" className="mb-3 text-sm text-danger">{text('Enter a valid business date.', 'Masukkan tarikh bisnes yang sah.')}</p> : null}
      <div hidden={!readable}>
      <dl className="bar-metrics">
        {[
          {label: text('Cash Payment', 'Bayaran Tunai'), value: money(isLocked ? report!.total_cash : totals.cash, String(settings.currency_symbol))},
          {label: text('QR Payment', 'Bayaran QR'), value: money(isLocked ? report!.total_qr : totals.qr, String(settings.currency_symbol))},
          {label: text('FOC Value', 'Nilai FOC'), value: money(isLocked ? report!.total_complimentary_value : totals.focCost, String(settings.currency_symbol))},
          {label: text('Total Revenue', 'Jumlah Hasil'), value: money(isLocked ? report!.total_sales : totals.paidRevenue, String(settings.currency_symbol))},
          {label: text('Transactions', 'Transaksi'), value: displayTransactions},
        ].map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
      </dl>
      <section className="island-panel grid gap-3 rounded-lg p-3 sm:rounded-xl sm:p-5">
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-white/80 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
          <div className="min-w-0">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-accent sm:text-xs">{text('Closing status', 'Status tutup')}</p>
            <h2 className="mt-0.5 text-base font-semibold leading-tight sm:text-lg">{selectedDateLabel}</h2>
          </div>
          <span className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold sm:text-sm ${closeReadiness.tone}`}>
            {closeReadiness.icon}
            {closeReadiness.label}
          </span>
        </div>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <Field label={text('Actual cash counted', 'Tunai sebenar dikira')}>
            <input className={inputClass} type="number" min={0} step="0.01" value={actualCash} onChange={(event) => setActualCash(event.target.value)} disabled={isLocked||!!pendingClosing||saving||reopening.blocked} />
          </Field>
          <Field label={text('Notes', 'Nota')}>
            <input className={inputClass} value={notes} onChange={(event) => setNotes(event.target.value)} disabled={isLocked||!!pendingClosing||saving||reopening.blocked} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <Stat label={text('Expected Cash in Drawer', 'Tunai Dijangka Dalam Laci')} value={isLocked && report?.expected_cash == null ? text('Not Recorded', 'Tidak Direkod') : money(isLocked ? report!.expected_cash! : expectedCash, String(settings.currency_symbol))} />
          <Stat label={text('Cash variance', 'Beza tunai')} value={isLocked && report?.cash_variance == null ? text('Not Recorded', 'Tidak Direkod') : money(isLocked ? report!.cash_variance! : actualCashValid ? actualCashNumber - expectedCash : 0, String(settings.currency_symbol))} />
          <Stat label={text('QR Payment pending', 'Bayaran QR belum sah')} value={money(displayQrPending, String(settings.currency_symbol))} tone={displayQrPending > 0 ? 'warn' : 'default'} />
          <Stat label={text('QR Payment mismatch', 'Bayaran QR tidak padan')} value={money(displayQrMismatch, String(settings.currency_symbol))} tone={displayQrMismatch > 0 ? 'warn' : 'default'} />
        </div>
        {!isLocked ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            {totals.qrPending > 0 ? (
              <p className="rounded-xl border border-danger bg-pink-100 px-3 py-2 text-xs font-semibold text-coral sm:text-sm">
                {text('Cannot close until all QR Payment sales are verified or marked mismatch.', 'Tidak boleh tutup sehingga semua Bayaran QR disahkan atau ditanda tidak padan.')}
              </p>
            ) : <span />}
            <button className={`${buttonClass} w-full justify-center sm:w-auto`} disabled={saving || reading || !!readError || !!pendingClosing || saleAction.blocked || reopening.blocked || !actualCashValid || totals.qrPending > 0} onClick={() => { setDetailsConfirmed(false); setConfirming(true); }}>
              {saving ? text('Saving...', 'Menyimpan...') : correctionMode ? text('Close corrected report', 'Tutup laporan pembetulan') : text('Close Daily Report', 'Tutup Laporan Harian')}
            </button>
          </div>
        ) : null}
      </section>
      <section className="island-panel mt-4 rounded-lg p-3 sm:mt-5 sm:rounded-xl sm:p-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="text-lg font-semibold sm:text-xl">{text('Sales of All Items', 'Jualan Semua Item')} · {businessDate}</h2>
          {isLocked ? <p className="text-xs font-semibold text-accent sm:text-sm">{text('Showing saved closing snapshot', 'Memaparkan snapshot tutup yang disimpan')}</p> : null}
        </div>
        <div className="mt-3 overflow-hidden rounded-lg border border-line bg-white/80 shadow-none sm:hidden">
          <table className="dense-table w-full table-fixed text-left text-[11px]">
            <thead className="bg-paper">
              <tr>
                <th className="w-[46%] p-2">{text('Item', 'Item')}</th>
                <th className="w-[14%] p-2 text-center">{text('Qty', 'Qty')}</th>
                <th className="w-[40%] p-2 text-right">{text('Total Revenue', 'Jumlah Hasil')}</th>
              </tr>
            </thead>
            <tbody>
              {itemSales.map((item) => (
                <Fragment key={`mobile-${item.product}`}>
                  <tr className="border-t border-line align-top">
                    <td className="p-2 font-semibold"><span className="line-clamp-2">{item.product}</span></td>
                    <td className="p-2 text-center font-semibold">{item.quantity}</td>
                    <td className="p-2 text-right font-semibold">{money(item.cash + item.qr, String(settings.currency_symbol))}</td>
                  </tr>
                  <tr className="border-t border-line bg-white/70">
                    <td colSpan={3} className="px-2 pb-2 pt-1">
                      <div className="grid grid-cols-3 gap-1 text-[10px] font-semibold leading-tight">
                        <span className="rounded-lg bg-shell px-1.5 py-1 text-muted">{text('Cash Payment', 'Bayaran Tunai')}<br />{money(item.cash, String(settings.currency_symbol))}</span>
                        <span className="rounded-lg bg-shell px-1.5 py-1 text-muted">{text('QR Payment', 'Bayaran QR')}<br />{money(item.qr, String(settings.currency_symbol))}</span>
                        <span className="rounded-lg bg-shell px-1.5 py-1 text-coral">{text('FOC Value', 'Nilai FOC')}<br />{money(item.focCost, String(settings.currency_symbol))}</span>
                      </div>
                      {item.discount > 0 ? (
                        <p className="mt-1 rounded-lg bg-amber-50 px-1.5 py-1 text-[10px] font-semibold text-warning">
                          {text('Discount', 'Diskaun')}: - {money(item.discount, String(settings.currency_symbol))}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                </Fragment>
              ))}
              <tr className="border-t-2 border-ink bg-white/90 align-top">
                <td className="p-2 font-semibold">{text('Total', 'Jumlah')}</td>
                <td className="p-2 text-center font-semibold">{itemTotals.quantity}</td>
                <td className="p-2 text-right font-semibold">{money(itemTotals.paidSales, String(settings.currency_symbol))}</td>
              </tr>
              <tr className="bg-white/90">
                <td colSpan={3} className="px-2 pb-2 pt-1">
                  <div className="grid grid-cols-3 gap-1 text-[10px] font-semibold leading-tight">
                    <span className="rounded-lg bg-shell px-1.5 py-1 text-muted">{text('Cash Payment', 'Bayaran Tunai')}<br />{money(itemTotals.cash, String(settings.currency_symbol))}</span>
                    <span className="rounded-lg bg-shell px-1.5 py-1 text-muted">{text('QR Payment', 'Bayaran QR')}<br />{money(itemTotals.qr, String(settings.currency_symbol))}</span>
                    <span className="rounded-lg bg-shell px-1.5 py-1 text-coral">{text('FOC Value', 'Nilai FOC')}<br />{money(itemTotals.focCost, String(settings.currency_symbol))}</span>
                  </div>
                  {itemTotals.discount > 0 ? (
                    <p className="mt-1 rounded-lg bg-amber-50 px-1.5 py-1 text-[10px] font-semibold text-warning">
                      {text('Discount', 'Diskaun')}: - {money(itemTotals.discount, String(settings.currency_symbol))}
                    </p>
                  ) : null}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="clean-scroll mt-3 hidden overflow-x-auto rounded-lg border border-line bg-white/75 sm:block">
          <table className="dense-table w-full min-w-[780px] text-left text-xs sm:text-sm">
            <thead className="text-sm">
              <tr>
                <th className="p-3 whitespace-nowrap">{text('Item', 'Item')}</th>
                <th className="p-3 whitespace-nowrap">{text('Quantity', 'Kuantiti')}</th>
                <th className="p-3 whitespace-nowrap">{text('Cash Payment', 'Bayaran Tunai')}</th>
                <th className="p-3 whitespace-nowrap">{text('QR Payment', 'Bayaran QR')}</th>
                <th className="p-3 whitespace-nowrap">{text('Discount', 'Diskaun')}</th>
                <th className="p-3 whitespace-nowrap">{text('FOC Value', 'Nilai FOC')}</th>
                <th className="p-3 whitespace-nowrap">{text('Total Revenue', 'Jumlah Hasil')}</th>
              </tr>
            </thead>
            <tbody>
              {itemSales.map((item) => (
                <tr key={item.product} className="border-t border-line">
                  <td className="p-3 font-semibold">{item.product}</td>
                  <td className="p-3 whitespace-nowrap">{item.quantity}</td>
                  <td className="p-3 whitespace-nowrap">{money(item.cash, String(settings.currency_symbol))}</td>
                  <td className="p-3 whitespace-nowrap">{money(item.qr, String(settings.currency_symbol))}</td>
                  <td className="p-3 whitespace-nowrap text-warning">- {money(item.discount, String(settings.currency_symbol))}</td>
                  <td className="p-3 whitespace-nowrap text-coral">{money(item.focCost, String(settings.currency_symbol))}</td>
                  <td className="p-3 font-semibold whitespace-nowrap">{money(item.cash + item.qr, String(settings.currency_symbol))}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-ink bg-white/80">
                <td className="p-3 font-semibold">{text('Total', 'Jumlah')}</td>
                <td className="p-3 font-semibold whitespace-nowrap">{itemTotals.quantity}</td>
                <td className="p-3 font-semibold whitespace-nowrap">{money(itemTotals.cash, String(settings.currency_symbol))}</td>
                <td className="p-3 font-semibold whitespace-nowrap">{money(itemTotals.qr, String(settings.currency_symbol))}</td>
                <td className="p-3 font-semibold whitespace-nowrap text-warning">- {money(itemTotals.discount, String(settings.currency_symbol))}</td>
                <td className="p-3 font-semibold whitespace-nowrap text-coral">{money(itemTotals.focCost, String(settings.currency_symbol))}</td>
                <td className="p-3 font-semibold whitespace-nowrap">{money(itemTotals.paidSales, String(settings.currency_symbol))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section className="bar-qr-verification island-panel mt-4 rounded-lg p-3 sm:mt-5 sm:rounded-xl sm:p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold sm:text-xl"><Smartphone className="h-5 w-5 text-accent" /> {text('QR Payment verification', 'Pengesahan Bayaran QR')}</h2>
          <div className="grid grid-cols-3 gap-1.5 text-center text-[0.68rem] font-semibold sm:min-w-[22rem] sm:text-xs">
            <div className="rounded-xl border border-danger bg-pink-100 px-2 py-1.5 text-coral">{text('Pending', 'Belum sah')}<br />{money(displayQrPending, String(settings.currency_symbol))}</div>
            <div className="rounded-xl border border-accent bg-shell px-2 py-1.5 text-accent">{text('Verified', 'Disahkan')}<br />{money(displayQrVerified, String(settings.currency_symbol))}</div>
            <div className="rounded-xl border border-warning bg-amber-50 px-2 py-1.5 text-warning">{text('Mismatch', 'Tidak sepadan')}<br />{money(displayQrMismatch, String(settings.currency_symbol))}</div>
          </div>
        </div>
        {!isLocked && pendingQrSales.length > 0 ? (
          <div className="mt-3 rounded-lg border border-danger bg-shell/90 p-3 sm:rounded-xl sm:p-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-sm font-semibold text-coral sm:text-base">{text('Pending QR Payment checklist', 'Senarai semak Bayaran QR belum sah')}</h3>
              <p className="text-xs font-semibold text-coral sm:text-sm">{pendingQrSales.length} {text('sale(s) must be reviewed before closing', 'jualan mesti disemak sebelum tutup')}</p>
            </div>
            <div className="mt-3 grid gap-2">
              {pendingQrSales.map((sale) => {
                const hasReceipt = Boolean(sale.qr_receipt_image_path);
                const isQrUpdating = saleAction.blocked || reopening.blocked || !!pendingClosing || saving || reading || !!readError || isClosed;
                return (
                  <div key={`pending-qr-${sale.id}`} className="grid gap-2 rounded-lg border border-line bg-white/95 p-3 shadow-none lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-ink">{sale.sale_number}</p>
                        <span className="rounded-xl bg-pink-100 px-2.5 py-1 text-xs font-semibold text-coral">{money(sale.paid_amount, String(settings.currency_symbol))}</span>
                        <span className="rounded-xl bg-shell px-2.5 py-1 text-xs font-semibold text-neutral-700">{sale.order_taken_by ?? '-'}</span>
                      </div>
                      <p className="mt-1 text-xs font-bold text-neutral-600 sm:text-sm">
                        {text('Type', 'Jenis')}: {sale.qr_payment_type ?? '-'} · {text('Ref', 'Rujukan')}: {sale.qr_reference ?? '-'} · {hasReceipt ? text('Photo attached', 'Gambar ada') : text('No photo attached', 'Tiada gambar')}
                      </p>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5 sm:flex sm:justify-end">
                      <button type="button" className={`${secondaryButtonClass} bar-qr-receipt-action dense-action justify-center`} disabled={!hasReceipt || reading || !!readError} onClick={() => viewQrReceipt(sale)}><Eye className="h-3.5 w-3.5" />{text('Receipt', 'Resit')}</button>
                      <button className={`${buttonClass} dense-action justify-center`} disabled={isQrUpdating} onClick={() => verifyQrPayment(sale, 'verified')}><CheckCircle2 className="h-3.5 w-3.5" />{verifyingQrKey === `${sale.id}:verified` ? text('Updating', 'Mengemas kini') : text('Verify', 'Sahkan')}</button>
                      <button className={`${secondaryButtonClass} dense-action justify-center`} disabled={isQrUpdating} onClick={() => verifyQrPayment(sale, 'mismatch')}>{verifyingQrKey === `${sale.id}:mismatch` ? text('Updating', 'Mengemas kini') : text('Mismatch', 'Tidak sepadan')}</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
        <div className="mt-3 overflow-hidden rounded-lg border border-line bg-white/80 sm:hidden">
          {completedQrSales.length === 0 ? (
            <div className="p-4 text-sm font-bold text-neutral-600">{text('No QR Payment for this date.', 'Tiada Bayaran QR untuk tarikh ini.')}</div>
          ) : null}
          {completedQrSales.length > 0 ? (
            <table className="dense-table w-full table-fixed text-left text-[11px]">
              <thead className="bg-paper">
                <tr>
                  <th className="w-[46%] p-2">{text('Sale', 'Jualan')}</th>
                  <th className="w-[26%] p-2">{text('Amount', 'Jumlah')}</th>
                  <th className="w-[28%] p-2">{text('Status', 'Status')}</th>
                </tr>
              </thead>
              <tbody>
                {completedQrSales.map((sale) => {
                  const hasReceipt = Boolean(sale.qr_receipt_image_path);
                  const isQrUpdating = saleAction.blocked || reopening.blocked || !!pendingClosing || saving || reading || !!readError || isClosed;
                  return (
                    <Fragment key={`mobile-qr-${sale.id}`}>
                      <tr className="border-t border-line align-top">
                        <td className="p-2">
                          <p className="truncate font-semibold">{sale.sale_number}</p>
                          <p className="mt-0.5 truncate text-[10px] font-bold text-neutral-600">{sale.order_taken_by ?? '-'} · {sale.qr_payment_type ?? '-'}</p>
                          <p className="mt-1 truncate text-[10px] font-bold text-neutral-600">{text('Ref', 'Rujukan')}: {sale.qr_reference ?? '-'}</p>
                        </td>
                        <td className="p-2 font-semibold whitespace-nowrap">{money(sale.paid_amount, String(settings.currency_symbol))}</td>
                        <td className="p-2">
                          <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${qrStatusClass(sale.qr_status)}`}>{labelStatus(sale.qr_status)}</span>
                          <span className={`mt-1 block text-[10px] font-bold ${hasReceipt ? 'text-accent' : 'text-coral'}`}>{hasReceipt ? text('Photo', 'Gambar') : text('No photo', 'Tiada gambar')}</span>
                        </td>
                      </tr>
                      <tr className="border-t border-line bg-white/70">
                        <td colSpan={3} className="px-2 pb-2 pt-1">
                          <div className="grid grid-cols-3 gap-1">
                            <button type="button" className={`${secondaryButtonClass} bar-qr-receipt-action dense-action justify-center`} disabled={!hasReceipt || reading || !!readError} onClick={() => viewQrReceipt(sale)}><Eye className="h-3.5 w-3.5" />{text('Receipt', 'Resit')}</button>
                            <button type="button" className="inline-flex min-h-9 items-center justify-center gap-1 rounded-xl border border-line bg-white px-2 text-[10px] font-semibold text-accent shadow-none disabled:opacity-40" disabled={sale.qr_status === 'verified' || isQrUpdating} onClick={() => verifyQrPayment(sale, 'verified')} aria-label={text('Verify QR Payment', 'Sahkan Bayaran QR')}><CheckCircle2 className="h-3.5 w-3.5" />{text('Verify', 'Sahkan')}</button>
                            <button type="button" className="inline-flex min-h-9 items-center justify-center gap-1 rounded-xl border border-line bg-white px-2 text-[10px] font-semibold text-warning shadow-none disabled:opacity-40" disabled={sale.qr_status === 'mismatch' || isQrUpdating} onClick={() => verifyQrPayment(sale, 'mismatch')} aria-label={text('Mark QR Payment mismatch', 'Tanda Bayaran QR tidak sepadan')}><AlertTriangle className="h-3.5 w-3.5" />{text('Mismatch', 'Tidak padan')}</button>
                          </div>
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          ) : null}
        </div>
        <div className="clean-scroll mt-3 hidden overflow-x-auto rounded-lg border border-line bg-white/75 sm:block">
          <table className="dense-table w-full min-w-[920px] text-left text-xs sm:text-sm">
            <thead>
              <tr>
                <th className="whitespace-nowrap">{text('Sale', 'Jualan')}</th>
                <th className="whitespace-nowrap">{text('Amount', 'Jumlah')}</th>
                <th className="whitespace-nowrap">{text('Staff', 'Staf')}</th>
                <th className="whitespace-nowrap">{text('QR Type', 'Jenis QR')}</th>
                <th className="whitespace-nowrap">{text('Reference', 'Rujukan')}</th>
                <th className="whitespace-nowrap">{text('Receipt photo', 'Gambar resit')}</th>
                <th className="whitespace-nowrap">{text('Status', 'Status')}</th>
                <th className="whitespace-nowrap">{text('Action', 'Tindakan')}</th>
              </tr>
            </thead>
            <tbody>
              {completedQrSales.length === 0 ? (
                <tr className="border-t border-line"><td className="text-neutral-600" colSpan={8}>{text('No QR Payment for this date.', 'Tiada Bayaran QR untuk tarikh ini.')}</td></tr>
              ) : null}
              {completedQrSales.map((sale) => {
                const hasReceipt = Boolean(sale.qr_receipt_image_path);
                const isQrUpdating = saleAction.blocked || reopening.blocked || !!pendingClosing || saving || reading || !!readError || isClosed;
                return (
                <tr key={sale.id} className="border-t border-line">
                  <td className="whitespace-nowrap font-semibold">{sale.sale_number}</td>
                  <td className="whitespace-nowrap">{money(sale.paid_amount, String(settings.currency_symbol))}</td>
                  <td className="whitespace-nowrap">{sale.order_taken_by ?? '-'}</td>
                  <td className="whitespace-nowrap">{sale.qr_payment_type ?? '-'}</td>
                  <td className="whitespace-nowrap">{sale.qr_reference ?? '-'}</td>
                  <td className="whitespace-nowrap">
                    <div className="grid gap-1">
                      <button type="button" className={`${secondaryButtonClass} bar-qr-receipt-action dense-action justify-center`} disabled={!hasReceipt || reading || !!readError} onClick={() => viewQrReceipt(sale)}><Eye className="h-3.5 w-3.5" />{text('Receipt', 'Resit')}</button>
                      <span className={`text-[0.68rem] font-semibold ${hasReceipt ? 'text-accent' : 'text-coral'}`}>
                        {hasReceipt ? text('Photo attached', 'Gambar ada') : text('No photo attached', 'Tiada gambar')}
                      </span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap"><span className={`rounded-xl px-2.5 py-1 text-[0.68rem] font-semibold ${qrStatusClass(sale.qr_status)}`}>{labelStatus(sale.qr_status)}</span></td>
                  <td className="whitespace-nowrap">
                    <div className="grid grid-cols-2 gap-1.5">
                      <button className={`${secondaryButtonClass} dense-action justify-center`} disabled={sale.qr_status === 'verified' || isQrUpdating} onClick={() => verifyQrPayment(sale, 'verified')}><CheckCircle2 className="h-3.5 w-3.5" />{verifyingQrKey === `${sale.id}:verified` ? text('Updating', 'Mengemas kini') : text('Verify', 'Sahkan')}</button>
                      <button className={`${secondaryButtonClass} dense-action justify-center`} disabled={sale.qr_status === 'mismatch' || isQrUpdating} onClick={() => verifyQrPayment(sale, 'mismatch')}>{verifyingQrKey === `${sale.id}:mismatch` ? text('Updating', 'Mengemas kini') : text('Mismatch', 'Tidak sepadan')}</button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {confirming ? (
        <Modal
          title={text('Final Check Before Closing', 'Semakan Akhir Sebelum Tutup')}
          onClose={() => { if (!saving) { setConfirming(false); setDetailsConfirmed(false); } }}
          footer={
            <div className="grid w-full gap-2 sm:flex sm:justify-end">
              <button className={secondaryButtonClass} disabled={saving} onClick={() => { setConfirming(false); setDetailsConfirmed(false); }}>{text('Cancel', 'Batal')}</button>
              <button className={buttonClass} disabled={saving || reading || !!readError || !!pendingClosing || saleAction.blocked || reopening.blocked || !detailsConfirmed} onClick={closeReport}>{saving ? text('Closing...', 'Menutup...') : text('Yes, close report', 'Ya, tutup laporan')}</button>
            </div>
          }
        >
          <div className="grid gap-3">
            <p className="text-sm font-bold sm:text-base">{text('Please double-check all details before submitting. After closing, the snapshot should only be changed by admin correction.', 'Sila semak semua butiran sebelum hantar. Selepas tutup, snapshot hanya patut diubah melalui pembetulan admin.')}</p>
            <div className="grid gap-2 rounded-xl border border-line bg-shell p-3 text-sm font-bold sm:grid-cols-2 sm:rounded-lg sm:p-4">
              <div><span className="text-neutral-500">{text('Business date', 'Tarikh bisnes')}</span><p className="text-ink">{businessDate}</p></div>
              <div><span className="text-neutral-500">{text('Transactions', 'Transaksi')}</span><p className="text-ink">{displayTransactions}</p></div>
              <div><span className="text-neutral-500">{text('Cash Payment sales', 'Jualan Bayaran Tunai')}</span><p className="text-ink">{money(totals.cash, String(settings.currency_symbol))}</p></div>
              <div><span className="text-neutral-500">{text('QR Payment sales', 'Jualan Bayaran QR')}</span><p className="text-ink">{money(totals.qr, String(settings.currency_symbol))}</p></div>
              <div><span className="text-neutral-500">{text('FOC Value', 'Nilai FOC')}</span><p className="text-coral">{money(totals.focCost, String(settings.currency_symbol))}</p></div>
              <div><span className="text-neutral-500">{text('Total Revenue', 'Jumlah Hasil')}</span><p className="text-ink">{money(totals.paidRevenue, String(settings.currency_symbol))}</p></div>
              <div><span className="text-neutral-500">{text('Actual cash counted', 'Tunai sebenar dikira')}</span><p className="text-ink">{money(actualCashValid ? actualCashNumber : 0, String(settings.currency_symbol))}</p></div>
              <div><span className="text-neutral-500">{text('Cash variance', 'Beza tunai')}</span><p className="text-ink">{money((actualCashValid ? actualCashNumber : 0) - expectedCash, String(settings.currency_symbol))}</p></div>
              <div><span className="text-neutral-500">{text('QR Payment pending', 'Bayaran QR belum sah')}</span><p className="text-ink">{money(displayQrPending, String(settings.currency_symbol))}</p></div>
              <div><span className="text-neutral-500">{text('QR Payment mismatch', 'Bayaran QR tidak padan')}</span><p className="text-ink">{money(displayQrMismatch, String(settings.currency_symbol))}</p></div>
            </div>
            <label className="flex items-start gap-3 rounded-xl border border-line bg-white/90 p-3 text-sm font-semibold sm:rounded-lg sm:p-4">
              <input className="mt-1" type="checkbox" checked={detailsConfirmed} onChange={(event) => setDetailsConfirmed(event.target.checked)} />
              <span>{text('I confirm the cash count, QR Payment status, FOC Value, and closing details are accurate.', 'Saya sahkan kiraan tunai, status Bayaran QR, Nilai FOC, dan butiran tutup adalah tepat.')}</span>
            </label>
          </div>
        </Modal>
      ) : null}
      {previewSale ? <QrReceiptPreview key={receiptPreview!.date + receiptPreview!.id + receiptPreview!.fingerprint} sale={previewSale} currency={String(settings.currency_symbol)} onClose={() => setReceiptPreview(null)} /> : null}
      </div>
    </>
  );
}
