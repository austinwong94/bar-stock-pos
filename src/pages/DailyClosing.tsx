import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Smartphone } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Field, buttonClass, inputClass, secondaryButtonClass } from '../components/Form';
import { Modal } from '../components/Modal';
import { PageHeader, Stat } from '../components/Page';
import { useToast } from '../components/Toast';
import { money, todayInputValue } from '../lib/format';
import { supabase } from '../lib/supabase';
import { isSupabaseConfigured } from '../lib/supabase';
import { demoReports } from '../lib/demo';
import { loadLocalSales } from '../lib/localStore';
import type { DailyReport, Sale, SettingsMap } from '../lib/types';
import { useLanguage } from '../lib/language';
import { assetPath } from '../lib/assets';
import { scaledItemSales } from '../lib/reportItems';

export default function DailyClosing({ settings }: { settings: SettingsMap }) {
  const toast = useToast();
  const { text } = useLanguage();
  const [searchParams] = useSearchParams();
  const [businessDate, setBusinessDate] = useState(todayInputValue());
  const [actualCash, setActualCash] = useState('');
  const [notes, setNotes] = useState('');
  const [sales, setSales] = useState<Sale[]>([]);
  const [report, setReport] = useState<DailyReport | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [detailsConfirmed, setDetailsConfirmed] = useState(false);
  const [correctionMode, setCorrectionMode] = useState(false);
  const [receiptPreview, setReceiptPreview] = useState<{ sale: Sale; url: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const isClosed = Boolean(report && report.status === 'closed');
  const isLocked = isClosed && !correctionMode;

  async function refresh(date = businessDate) {
    if (!isSupabaseConfigured) {
      setSales(loadLocalSales().filter((sale) => sale.business_date === date));
      const demoReport = demoReports.find((item) => item.business_date === date) ?? null;
      setReport(demoReport);
      setCorrectionMode(false);
      return demoReport;
    }
    const [{ data: currentSales }, { data: existingReport }] = await Promise.all([
      supabase.from('sales').select('*').eq('business_date', date).order('created_at'),
      supabase.from('daily_reports').select('*').eq('business_date', date).maybeSingle(),
    ]);
    setSales((currentSales ?? []) as Sale[]);
    setReport((existingReport as DailyReport | null) ?? null);
    setCorrectionMode(false);
    return (existingReport as DailyReport | null) ?? null;
  }

  async function openCorrectionFromReports(date: string, loadedReport: DailyReport | null) {
    if (!loadedReport) return;
    if (!isSupabaseConfigured) {
      setCorrectionMode(true);
      setActualCash(loadedReport.actual_cash_counted == null ? '' : String(loadedReport.actual_cash_counted));
      setNotes(loadedReport.notes ?? '');
      toast.success('Report unlocked for editing.');
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.rpc('reopen_daily_report', {
      p_business_date: date,
      p_reason: 'Admin correction from Reports',
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setReport(data);
    setCorrectionMode(true);
    setActualCash(data.actual_cash_counted == null ? '' : String(data.actual_cash_counted));
    setNotes(data.notes ?? '');
    toast.success('Report unlocked for editing.');
  }

  useEffect(() => {
    const queryDate = searchParams.get('date');
    const editFromReports = searchParams.get('edit') === '1';
    if (!isSupabaseConfigured) {
      const initialDate = queryDate || '2026-05-03';
      setBusinessDate(initialDate);
      refresh(initialDate).then((loadedReport) => {
        if (editFromReports) void openCorrectionFromReports(initialDate, loadedReport);
      });
      return;
    }
    if (queryDate) {
      setBusinessDate(queryDate);
      refresh(queryDate).then((loadedReport) => {
        if (editFromReports) void openCorrectionFromReports(queryDate, loadedReport);
      });
      return;
    }
    supabase.rpc('get_business_date').then(({ data }: { data: string | null }) => {
      if (data) {
        setBusinessDate(data);
        void refresh(data);
      } else {
        void refresh();
      }
    });
  }, [searchParams]);

  useEffect(() => {
    void refresh();
  }, [businessDate]);

  const totals = useMemo(() => {
    const completed = sales.filter((sale) => sale.status === 'completed');
    return {
      cash: completed.reduce((sum, sale) => sum + (sale.payment_method === 'cash' ? Number(sale.paid_amount) : 0), 0),
      qr: completed.reduce((sum, sale) => sum + (sale.payment_method === 'qr' ? Number(sale.paid_amount) : 0), 0),
      focCost: completed.reduce((sum, sale) => sum + (sale.payment_method === 'complimentary' ? Number(sale.total_amount) : 0), 0),
      paidRevenue: completed.reduce((sum, sale) => sum + (sale.payment_method === 'complimentary' ? 0 : Number(sale.paid_amount)), 0),
      tx: completed.length,
      qrPending: completed.filter((sale) => sale.payment_method === 'qr' && sale.qr_status === 'pending').reduce((sum, sale) => sum + Number(sale.paid_amount), 0),
      qrVerified: completed.filter((sale) => sale.payment_method === 'qr' && sale.qr_status === 'verified').reduce((sum, sale) => sum + Number(sale.paid_amount), 0),
      qrMismatch: completed.filter((sale) => sale.payment_method === 'qr' && sale.qr_status === 'mismatch').reduce((sum, sale) => sum + Number(sale.paid_amount), 0),
    };
  }, [sales]);

  const itemSales = useMemo(() => scaledItemSales({
    cash: report?.total_cash ?? totals.cash,
    qr: report?.total_qr ?? totals.qr,
    focCost: report?.total_complimentary_value ?? totals.focCost,
  }), [report?.total_cash, report?.total_complimentary_value, report?.total_qr, totals.cash, totals.focCost, totals.qr]);

  const itemTotals = itemSales.reduce(
    (sum, item) => ({
      quantity: sum.quantity + item.quantity,
      cash: sum.cash + item.cash,
      qr: sum.qr + item.qr,
      focCost: sum.focCost + item.focCost,
      paidSales: sum.paidSales + item.cash + item.qr,
    }),
    { quantity: 0, cash: 0, qr: 0, focCost: 0, paidSales: 0 },
  );

  async function closeReport() {
    if (totals.qrPending > 0) {
      toast.error('Cannot close daily report while QR Payment is still pending.');
      return;
    }
    if (!detailsConfirmed) {
      toast.error('Please confirm all closing details are accurate before submitting.');
      return;
    }
    setSaving(true);
    if (!isSupabaseConfigured) {
      const nextReport: DailyReport = {
        id: crypto.randomUUID(),
        business_date: businessDate,
        report_json: { demo: true, sales, focCost: totals.focCost },
        total_cash: totals.cash,
        total_qr: totals.qr,
        total_complimentary_value: totals.focCost,
        total_sales: totals.paidRevenue,
        actual_cash_counted: Number(actualCash),
        expected_cash: totals.cash,
        cash_variance: Number(actualCash) - totals.cash,
        closed_by: 'demo',
        closed_at: new Date().toISOString(),
        reopened_by: null,
        reopened_at: null,
        status: 'closed',
        notes,
      };
      setReport(nextReport);
      setSaving(false);
      setConfirming(false);
      setDetailsConfirmed(false);
      toast.success('Daily closing saved. FOC is recorded as cost, not total revenue.');
      return;
    }
    const { data, error } = await supabase.rpc('close_daily_report', {
      p_business_date: businessDate,
      p_actual_cash_counted: Number(actualCash),
      p_notes: notes || null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setReport(data);
    setConfirming(false);
    setDetailsConfirmed(false);
    toast.success('Daily closing saved as a report snapshot.');
  }

  async function verifyQrPayment(sale: Sale, status: 'verified' | 'mismatch') {
    if (!isSupabaseConfigured) {
      setSales((items) => items.map((item) => (item.id === sale.id ? { ...item, qr_status: status } : item)));
      toast.success(`QR Payment ${sale.sale_number} marked ${status}.`);
      return;
    }
    const { error } = await supabase.rpc('verify_qr_payment', { p_sale_id: sale.id, p_status: status, p_notes: null });
    if (error) toast.error(error.message);
    else {
      toast.success(`QR Payment ${sale.sale_number} marked ${status}.`);
      await refresh();
    }
  }

  async function viewQrReceipt(sale: Sale) {
    const path = sale.qr_receipt_image_path;
    if (!path) {
      toast.error('No QR Payment receipt image attached to this sale.');
      return;
    }
    if (path.startsWith('http') || path.startsWith('data:')) {
      setReceiptPreview({ sale, url: path });
      return;
    }
    if (path.startsWith('demo/')) {
      setReceiptPreview({ sale, url: assetPath('assets/qr-receipt-demo.svg') });
      return;
    }
    const { data, error } = await supabase.storage.from('payment-receipts').createSignedUrl(path, 60 * 5);
    if (error || !data?.signedUrl) {
      toast.error(error?.message ?? 'Could not open QR Payment receipt image.');
      return;
    }
    setReceiptPreview({ sale, url: data.signedUrl });
  }

  return (
    <>
      <PageHeader
        title={text('Daily Closing', 'Tutup Harian')}
        subtitle={text(`Choose the business date, verify QR Payment, count cash, and save the closing snapshot. Business day closes at ${String(settings.business_day_close_time)}.`, `Pilih tarikh bisnes, sahkan QR Payment, kira tunai, dan simpan snapshot penutupan. Hari bisnes tutup pada ${String(settings.business_day_close_time)}.`)}
      />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-5">
        <Stat label={`${text('Cash Payment', 'Bayaran tunai')} 💵`} value={money(report?.total_cash ?? totals.cash, String(settings.currency_symbol))} />
        <Stat label={`${text('QR Payment', 'Bayaran QR')} 📱`} value={money(report?.total_qr ?? totals.qr, String(settings.currency_symbol))} />
        <Stat label="FOC Cost 🎁" value={<span className="text-coral">- {money(report?.total_complimentary_value ?? totals.focCost, String(settings.currency_symbol))}</span>} tone="bad" />
        <Stat label={text('Total Revenue', 'Jumlah hasil')} value={money(report?.total_sales ?? totals.paidRevenue, String(settings.currency_symbol))} />
        <Stat label={text('Transactions', 'Transaksi')} value={totals.tx} />
      </div>
      <section className="island-panel grid gap-4 rounded-2xl p-3 sm:rounded-[2rem] sm:p-5">
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1.4fr]">
          <Field label={text('Business date', 'Tarikh bisnes')}>
            <input className={inputClass} type="date" value={businessDate} onChange={(event) => setBusinessDate(event.target.value)} />
          </Field>
          <Field label={text('Actual cash counted', 'Tunai sebenar dikira')}>
            <input className={inputClass} type="number" min={0} step="0.01" value={actualCash} onChange={(event) => setActualCash(event.target.value)} disabled={isLocked} />
          </Field>
          <Field label={text('Notes', 'Nota')}>
            <input className={inputClass} value={notes} onChange={(event) => setNotes(event.target.value)} disabled={isLocked} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <Stat label={text('Expected Cash Payment', 'Bayaran tunai dijangka')} value={money(report?.expected_cash ?? totals.cash, String(settings.currency_symbol))} />
          <Stat label={text('Cash variance', 'Beza tunai')} value={money(report?.cash_variance ?? Number(actualCash || 0) - totals.cash, String(settings.currency_symbol))} />
          <Stat label={text('QR Payment pending', 'Bayaran QR belum sah')} value={money(totals.qrPending, String(settings.currency_symbol))} tone={totals.qrPending > 0 ? 'warn' : 'default'} />
          <Stat label={text('QR Payment mismatch', 'Bayaran QR tidak padan')} value={money(totals.qrMismatch, String(settings.currency_symbol))} tone={totals.qrMismatch > 0 ? 'warn' : 'default'} />
        </div>
        {!isLocked ? (
          <div className="grid gap-3">
            {totals.qrPending > 0 ? (
              <p className="rounded-2xl border border-warning bg-amber-50 p-3 text-sm font-black text-warning">
                Cannot close yet: QR Payment pending is {money(totals.qrPending, String(settings.currency_symbol))}. Verify or mark mismatch first.
              </p>
            ) : null}
            <button className={`${buttonClass} w-full justify-center sm:w-auto`} disabled={!actualCash || totals.qrPending > 0} onClick={() => { setDetailsConfirmed(false); setConfirming(true); }}>
              {correctionMode ? 'Close corrected report' : text('Close Daily Report', 'Tutup Laporan Harian')}
            </button>
          </div>
        ) : null}
      </section>
      <section className="island-panel mt-4 rounded-2xl p-3 sm:mt-5 sm:rounded-[2rem] sm:p-5">
        <h2 className="text-lg font-black sm:text-xl">Sales of all items · {businessDate}</h2>
        <div className="mt-3 grid gap-3 md:hidden">
          {itemSales.map((item) => (
            <article key={item.product} className="rounded-2xl border border-line bg-white/85 p-3 shadow-soft sm:rounded-[1.5rem] sm:p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-black">{item.product}</p>
                  <p className="text-sm font-bold text-neutral-600">Quantity {item.quantity}</p>
                </div>
                <p className="font-black">{money(item.cash + item.qr, String(settings.currency_symbol))}</p>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1.5 text-xs font-bold sm:mt-3 sm:gap-2 sm:text-sm">
                <div className="rounded-2xl bg-emerald-50 p-2"><p className="text-emerald-700">Cash Payment</p><p>{money(item.cash, String(settings.currency_symbol))}</p></div>
                <div className="rounded-2xl bg-sky-50 p-2"><p className="text-sky-700">QR Payment</p><p>{money(item.qr, String(settings.currency_symbol))}</p></div>
                <div className="rounded-2xl bg-pink-50 p-2"><p className="text-pink-700">FOC</p><p className="text-coral">- {money(item.focCost, String(settings.currency_symbol))}</p></div>
              </div>
            </article>
          ))}
        </div>
        <div className="mt-3 hidden overflow-x-auto md:block">
          <table className="w-full min-w-[780px] text-left">
            <thead className="text-sm">
              <tr>
                <th className="p-3 whitespace-nowrap">Item</th>
                <th className="p-3 whitespace-nowrap">Quantity</th>
                <th className="p-3 whitespace-nowrap">Cash Payment 💵</th>
                <th className="p-3 whitespace-nowrap">QR Payment 📱</th>
                <th className="p-3 whitespace-nowrap">FOC Cost 🎁</th>
                <th className="p-3 whitespace-nowrap">Total Revenue</th>
              </tr>
            </thead>
            <tbody>
              {itemSales.map((item) => (
                <tr key={item.product} className="border-t border-line">
                  <td className="p-3 font-black">{item.product}</td>
                  <td className="p-3 whitespace-nowrap">{item.quantity}</td>
                  <td className="p-3 whitespace-nowrap">{money(item.cash, String(settings.currency_symbol))}</td>
                  <td className="p-3 whitespace-nowrap">{money(item.qr, String(settings.currency_symbol))}</td>
                  <td className="p-3 whitespace-nowrap text-coral">- {money(item.focCost, String(settings.currency_symbol))}</td>
                  <td className="p-3 font-black whitespace-nowrap">{money(item.cash + item.qr, String(settings.currency_symbol))}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-ink bg-white/80">
                <td className="p-3 font-black">Total</td>
                <td className="p-3 font-black whitespace-nowrap">{itemTotals.quantity}</td>
                <td className="p-3 font-black whitespace-nowrap">{money(itemTotals.cash, String(settings.currency_symbol))}</td>
                <td className="p-3 font-black whitespace-nowrap">{money(itemTotals.qr, String(settings.currency_symbol))}</td>
                <td className="p-3 font-black whitespace-nowrap text-coral">- {money(itemTotals.focCost, String(settings.currency_symbol))}</td>
                <td className="p-3 font-black whitespace-nowrap">{money(itemTotals.paidSales, String(settings.currency_symbol))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section className="island-panel mt-4 rounded-2xl p-3 sm:mt-5 sm:rounded-[2rem] sm:p-5">
        <h2 className="flex items-center gap-2 text-lg font-black sm:text-xl"><Smartphone className="h-5 w-5 text-accent" /> {text('QR Payment verification', 'Pengesahan Bayaran QR')}</h2>
        <p className="mt-2 rounded-xl bg-sky-50 p-2.5 text-sm font-bold text-sky-900 sm:rounded-2xl sm:p-3">
          {text('Mismatch means the QR Payment amount is recorded separately and is not counted as verified QR Payment until a manager follows up.', 'Tidak padan bermaksud amaun Bayaran QR direkod berasingan dan tidak dikira sebagai Bayaran QR disahkan sehingga pengurus semak.')}
        </p>
        <div className="mt-3 grid gap-3">
          {sales.filter((sale) => sale.payment_method === 'qr').length === 0 ? <p className="text-neutral-600">{text('No QR Payment for this date.', 'Tiada Bayaran QR untuk tarikh ini.')}</p> : null}
          {sales.filter((sale) => sale.payment_method === 'qr').map((sale) => (
            <div key={sale.id} className="flex flex-col gap-2 rounded-xl border border-line bg-white/80 p-3 md:flex-row md:items-center md:justify-between sm:rounded-2xl sm:p-4">
              <div>
                <p className="font-black">{sale.sale_number} · {money(sale.paid_amount, String(settings.currency_symbol))}</p>
                <p className="text-sm text-neutral-600">Staff: {sale.order_taken_by ?? '-'} · Ref: {sale.qr_reference ?? '-'} · Status: {sale.qr_status}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                {sale.qr_receipt_image_path ? (
                  <button className={`${secondaryButtonClass} justify-center`} onClick={() => viewQrReceipt(sale)}>View receipt</button>
                ) : null}
                <button className={`${secondaryButtonClass} justify-center`} onClick={() => verifyQrPayment(sale, 'verified')}><CheckCircle2 className="h-4 w-4" />Verify</button>
                <button className={`${secondaryButtonClass} justify-center`} onClick={() => verifyQrPayment(sale, 'mismatch')}>Mismatch</button>
              </div>
            </div>
          ))}
        </div>
      </section>
      {confirming ? (
        <Modal
          title="Final Check Before Closing"
          onClose={() => { setConfirming(false); setDetailsConfirmed(false); }}
          footer={
            <div className="grid w-full gap-2 sm:flex sm:justify-end">
              <button className={secondaryButtonClass} onClick={() => { setConfirming(false); setDetailsConfirmed(false); }}>Cancel</button>
              <button className={buttonClass} disabled={saving || !detailsConfirmed} onClick={closeReport}>{saving ? 'Closing...' : 'Yes, close report'}</button>
            </div>
          }
        >
          <div className="grid gap-3">
            <p className="text-sm font-bold sm:text-base">Please double-check all details before submitting. After closing, the snapshot should only be changed by admin correction.</p>
            <div className="grid gap-2 rounded-xl border border-line bg-shell p-3 text-sm font-bold sm:grid-cols-2 sm:rounded-2xl sm:p-4">
              <div><span className="text-neutral-500">Business date</span><p className="text-ink">{businessDate}</p></div>
              <div><span className="text-neutral-500">Transactions</span><p className="text-ink">{totals.tx}</p></div>
              <div><span className="text-neutral-500">Cash Payment sales</span><p className="text-ink">{money(totals.cash, String(settings.currency_symbol))}</p></div>
              <div><span className="text-neutral-500">QR Payment sales</span><p className="text-ink">{money(totals.qr, String(settings.currency_symbol))}</p></div>
              <div><span className="text-neutral-500">FOC Cost</span><p className="text-coral">- {money(totals.focCost, String(settings.currency_symbol))}</p></div>
              <div><span className="text-neutral-500">Total Revenue</span><p className="text-ink">{money(totals.paidRevenue, String(settings.currency_symbol))}</p></div>
              <div><span className="text-neutral-500">Actual cash counted</span><p className="text-ink">{money(Number(actualCash || 0), String(settings.currency_symbol))}</p></div>
              <div><span className="text-neutral-500">Cash variance</span><p className="text-ink">{money(Number(actualCash || 0) - totals.cash, String(settings.currency_symbol))}</p></div>
              <div><span className="text-neutral-500">QR Payment pending</span><p className="text-ink">{money(totals.qrPending, String(settings.currency_symbol))}</p></div>
              <div><span className="text-neutral-500">QR Payment mismatch</span><p className="text-ink">{money(totals.qrMismatch, String(settings.currency_symbol))}</p></div>
            </div>
            <label className="flex items-start gap-3 rounded-xl border border-line bg-white/90 p-3 text-sm font-black sm:rounded-2xl sm:p-4">
              <input className="mt-1" type="checkbox" checked={detailsConfirmed} onChange={(event) => setDetailsConfirmed(event.target.checked)} />
              <span>I confirm the cash count, QR Payment status, FOC Cost, and closing details are accurate.</span>
            </label>
          </div>
        </Modal>
      ) : null}
      {receiptPreview ? (
        <Modal
          title={`QR Payment Receipt - ${receiptPreview.sale.sale_number}`}
          onClose={() => setReceiptPreview(null)}
          footer={<button className={`${buttonClass} w-full sm:w-auto`} onClick={() => setReceiptPreview(null)}>Done</button>}
        >
          <div className="grid gap-3">
            <div className="rounded-2xl border border-line bg-shell p-3 text-sm font-bold">
              {money(receiptPreview.sale.paid_amount, String(settings.currency_symbol))} · Ref: {receiptPreview.sale.qr_reference ?? '-'} · Staff: {receiptPreview.sale.order_taken_by ?? '-'}
            </div>
            <img className="max-h-[70vh] w-full rounded-2xl border border-line object-contain" src={receiptPreview.url} alt={`QR Payment receipt for ${receiptPreview.sale.sale_number}`} />
          </div>
        </Modal>
      ) : null}
    </>
  );
}
