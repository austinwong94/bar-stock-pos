import { MouseEvent, useEffect, useMemo, useState } from 'react';
import { endOfISOWeek, format, getISOWeek, parseISO, startOfISOWeek } from 'date-fns';
import { Download } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { buttonClass, inputClass, secondaryButtonClass } from '../components/Form';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/Page';
import { useToast } from '../components/Toast';
import { money } from '../lib/format';
import { demoReports } from '../lib/demo';
import { loadLocalSales } from '../lib/localStore';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type { DailyReport, Sale, SettingsMap } from '../lib/types';
import { useLanguage } from '../lib/language';
import { scaledItemSales } from '../lib/reportItems';
import SalesHistory from './SalesHistory';

type ReportPeriod = 'daily' | 'weekly' | 'monthly' | 'custom';
type ClosingStatus = 'closed' | 'not_closed' | 'partial';

type ReportDay = {
  id: string;
  businessDate: string;
  cash: number;
  qr: number;
  focCost: number;
  paidSales: number;
  variance: number;
  closingStatus: ClosingStatus;
};

type ReportRow = {
  id: string;
  label: string;
  range: string;
  fromDate: string;
  toDate: string;
  dates: string[];
  businessDate: string;
  cash: number;
  qr: number;
  focCost: number;
  paidSales: number;
  variance: number;
  closingStatus: ClosingStatus;
  statusLabel: string;
};

function isoWeekKey(date: string) {
  return format(parseISO(date), "RRRR-'W'II");
}

function compactDate(date: string) {
  return format(parseISO(date), 'd MMM yyyy');
}

function monthLabel(month: string) {
  return format(parseISO(`${month}-01`), 'MMMM yyyy');
}

function compactRange(first: string, last: string) {
  if (first === last) return compactDate(first);
  if (first.slice(0, 4) === last.slice(0, 4)) {
    return `${format(parseISO(first), 'd MMM')} - ${format(parseISO(last), 'd MMM yyyy')}`;
  }
  return `${compactDate(first)} - ${compactDate(last)}`;
}

function statusLabel(status: ClosingStatus) {
  if (status === 'closed') return 'Closed';
  if (status === 'partial') return 'Has unclosed days';
  return 'Not closed';
}

function compactStatusLabel(status: ClosingStatus) {
  if (status === 'partial') return 'Partial';
  return statusLabel(status);
}

function buildReportDays(reports: DailyReport[], sales: Sale[]): ReportDay[] {
  const reportsByDate = new Map(reports.map((report) => [report.business_date, report]));
  const salesDates = Array.from(new Set(sales.map((sale) => sale.business_date)));
  const allDates = Array.from(new Set([...reports.map((report) => report.business_date), ...salesDates]));

  return allDates.map((date) => {
    const report = reportsByDate.get(date);
    if (report && report.status === 'closed') {
      return {
        id: report.id,
        businessDate: report.business_date,
        cash: Number(report.total_cash),
        qr: Number(report.total_qr),
        focCost: Number(report.total_complimentary_value),
        paidSales: Number(report.total_cash) + Number(report.total_qr),
        variance: Number(report.cash_variance ?? 0),
        closingStatus: 'closed',
      };
    }

    const completedSales = sales.filter((sale) => sale.business_date === date && sale.status === 'completed');
    const cash = completedSales.reduce((sum, sale) => sum + (sale.payment_method === 'cash' ? Number(sale.paid_amount) : 0), 0);
    const qr = completedSales.reduce((sum, sale) => sum + (sale.payment_method === 'qr' ? Number(sale.paid_amount) : 0), 0);
    const focCost = completedSales.reduce((sum, sale) => sum + (sale.payment_method === 'complimentary' ? Number(sale.total_amount) : 0), 0);
    return {
      id: report?.id ?? `open-${date}`,
      businessDate: date,
      cash,
      qr,
      focCost,
      paidSales: cash + qr,
      variance: report ? Number(report.cash_variance ?? 0) : 0,
      closingStatus: 'not_closed',
    };
  });
}

function summarizeReports(days: ReportDay[], period: ReportPeriod): ReportRow[] {
  if (period === 'daily' || period === 'custom') {
    return days.map((day) => ({
      id: day.id,
      label: day.businessDate,
      range: format(parseISO(day.businessDate), 'EEE, d MMM yyyy'),
      fromDate: day.businessDate,
      toDate: day.businessDate,
      dates: [day.businessDate],
      businessDate: day.businessDate,
      cash: day.cash,
      qr: day.qr,
      focCost: day.focCost,
      paidSales: day.paidSales,
      variance: day.variance,
      closingStatus: day.closingStatus,
      statusLabel: compactStatusLabel(day.closingStatus),
    }));
  }
  const groups = new Map<string, ReportDay[]>();
  days.forEach((day) => {
    const key = period === 'weekly' ? isoWeekKey(day.businessDate) : day.businessDate.slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), day]);
  });
  return [...groups.entries()].map(([key, rows]) => {
    const sorted = [...rows].sort((a, b) => a.businessDate.localeCompare(b.businessDate));
    const first = sorted[0].businessDate;
    const last = sorted[sorted.length - 1].businessDate;
    const weekStart = startOfISOWeek(parseISO(first));
    const weekEnd = endOfISOWeek(parseISO(first));
    const label = period === 'weekly' ? `Week ${getISOWeek(parseISO(first))}` : monthLabel(key);
    const closingStatus = sorted.every((day) => day.closingStatus === 'closed')
      ? 'closed'
      : sorted.every((day) => day.closingStatus === 'not_closed')
        ? 'not_closed'
        : 'partial';
    return {
      id: key,
      label,
      range: period === 'weekly'
        ? compactRange(format(weekStart, 'yyyy-MM-dd'), format(weekEnd, 'yyyy-MM-dd'))
        : compactRange(first, last),
      fromDate: period === 'weekly' ? format(weekStart, 'yyyy-MM-dd') : first,
      toDate: period === 'weekly' ? format(weekEnd, 'yyyy-MM-dd') : last,
      dates: sorted.map((day) => day.businessDate),
      businessDate: last,
      cash: sorted.reduce((sum, day) => sum + day.cash, 0),
      qr: sorted.reduce((sum, day) => sum + day.qr, 0),
      focCost: sorted.reduce((sum, day) => sum + day.focCost, 0),
      paidSales: sorted.reduce((sum, day) => sum + day.paidSales, 0),
      variance: sorted.reduce((sum, day) => sum + day.variance, 0),
      closingStatus,
      statusLabel: compactStatusLabel(closingStatus),
    };
  });
}

export default function DailyReportPage({ settings }: { settings: SettingsMap }) {
  const toast = useToast();
  const { text } = useLanguage();
  const [reports, setReports] = useState<DailyReport[]>(demoReports);
  const [sales, setSales] = useState<Sale[]>(() => loadLocalSales());
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>('daily');
  const [, setBusinessDate] = useState('2026-05-03');
  const [reportMonth, setReportMonth] = useState('2026-05');
  const [customStart, setCustomStart] = useState('2026-04-30');
  const [customEnd, setCustomEnd] = useState('2026-05-03');
  const [selectedReportDate, setSelectedReportDate] = useState('2026-05-03');
  const [selectedReportId, setSelectedReportId] = useState('');
  const [reportSection, setReportSection] = useState<'reports' | 'sales'>('reports');
  const [showAllRows, setShowAllRows] = useState(false);
  const [editTarget, setEditTarget] = useState<ReportRow | null>(null);
  const [editPassword, setEditPassword] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    async function loadReports() {
      if (!isSupabaseConfigured) return;
      const [{ data: reportData }, { data: saleData }] = await Promise.all([
        supabase.from('daily_reports').select('*').order('business_date', { ascending: false }),
        supabase.from('sales').select('*').order('business_date', { ascending: false }),
      ]);
      setReports((reportData ?? []) as DailyReport[]);
      setSales((saleData ?? []) as Sale[]);
    }
    void loadReports();
  }, []);

  const reportDays = useMemo(() => buildReportDays(reports, sales), [reports, sales]);

  const filteredReports = useMemo(() => reportDays.filter((item) => {
    if (reportPeriod === 'daily') return item.businessDate.startsWith(reportMonth);
    if (reportPeriod === 'weekly') return true;
    if (reportPeriod === 'monthly') return true;
    return item.businessDate >= customStart && item.businessDate <= customEnd;
  }), [customEnd, customStart, reportDays, reportMonth, reportPeriod]);

  const reportRows = useMemo(
    () => summarizeReports(filteredReports, reportPeriod).sort((a, b) => b.businessDate.localeCompare(a.businessDate)),
    [filteredReports, reportPeriod],
  );
  const visibleReportRows = showAllRows ? reportRows : reportRows.slice(0, 12);

  const activeReport = reportRows.find((row) => row.id === selectedReportId) ?? reportRows.find((row) => row.businessDate === selectedReportDate) ?? reportRows[0] ?? null;
  const selectedItemSales = useMemo(
    () => scaledItemSales({
      cash: activeReport?.cash ?? 0,
      qr: activeReport?.qr ?? 0,
      focCost: activeReport?.focCost ?? 0,
    }),
    [activeReport],
  );

  const periodTotals = reportRows.reduce(
    (sum, report) => ({
      cash: sum.cash + report.cash,
      qr: sum.qr + report.qr,
      focCost: sum.focCost + report.focCost,
      paidSales: sum.paidSales + report.paidSales,
      variance: sum.variance + report.variance,
    }),
    { cash: 0, qr: 0, focCost: 0, paidSales: 0, variance: 0 },
  );

  const itemTotals = selectedItemSales.reduce(
    (sum, item) => ({
      quantity: sum.quantity + item.quantity,
      cash: sum.cash + item.cash,
      qr: sum.qr + item.qr,
      focCost: sum.focCost + item.focCost,
      paidSales: sum.paidSales + item.cash + item.qr,
    }),
    { quantity: 0, cash: 0, qr: 0, focCost: 0, paidSales: 0 },
  );

  const selectedPeriodRow = useMemo<ReportRow>(() => {
    const closingStatus: ClosingStatus = reportRows.every((row) => row.closingStatus === 'closed')
      ? 'closed'
      : reportRows.every((row) => row.closingStatus === 'not_closed')
        ? 'not_closed'
        : 'partial';
    return {
      id: `selected-${customStart}-${customEnd}`,
      label: 'Selected period',
      range: compactRange(customStart, customEnd),
      fromDate: customStart,
      toDate: customEnd,
      dates: filteredReports.map((report) => report.businessDate).sort(),
      businessDate: reportRows[0]?.businessDate ?? customEnd,
      cash: periodTotals.cash,
      qr: periodTotals.qr,
      focCost: periodTotals.focCost,
      paidSales: periodTotals.paidSales,
      variance: periodTotals.variance,
      closingStatus,
      statusLabel: compactStatusLabel(closingStatus),
    };
  }, [customEnd, customStart, filteredReports, periodTotals.cash, periodTotals.focCost, periodTotals.paidSales, periodTotals.qr, periodTotals.variance, reportRows]);

  function downloadPdfReport(report?: ReportRow) {
    const selectedReport = report ?? activeReport ?? reportRows.find((row) => row.businessDate === selectedReportDate) ?? reportRows[0];
    if (!selectedReport) {
      toast.error('No report rows to download.');
      return;
    }
    const printable = window.open('', '_blank');
    if (!printable) {
      toast.error('Popup blocked. Allow popups to download/print PDF.');
      return;
    }
    const reportItems = scaledItemSales({
      cash: selectedReport.cash,
      qr: selectedReport.qr,
      focCost: selectedReport.focCost,
    });
    const reportItemTotals = reportItems.reduce(
      (sum, item) => ({
        quantity: sum.quantity + item.quantity,
        cash: sum.cash + item.cash,
        qr: sum.qr + item.qr,
        focCost: sum.focCost + item.focCost,
        paidSales: sum.paidSales + item.cash + item.qr,
      }),
      { quantity: 0, cash: 0, qr: 0, focCost: 0, paidSales: 0 },
    );
    const rows = reportItems
      .map((item) => `<tr><td>${item.product}</td><td>${item.quantity}</td><td>${money(item.cash, String(settings.currency_symbol))}</td><td>${money(item.qr, String(settings.currency_symbol))}</td><td>- ${money(item.focCost, String(settings.currency_symbol))}</td><td>${money(item.cash + item.qr, String(settings.currency_symbol))}</td></tr>`)
      .join('');
    const fileTitle = `${selectedReport.label} ${selectedReport.range}`.replace(/[<>]/g, '');
    printable.document.write(`
      <html><head><title>Lovely Paradise Report ${fileTitle}</title>
      <style>body{font-family:Arial;padding:28px;color:#2b1b27}h1{margin-bottom:4px}.muted{color:#6b5b68}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0}.box{border:1px solid #ead1dc;background:#fff7fb;border-radius:14px;padding:12px}.box b{display:block;margin-top:6px;font-size:18px}.warn{color:#b45309}.bad{color:#d94d6a}table{border-collapse:collapse;width:100%;margin-top:20px}td,th{border:1px solid #ddd;padding:10px;text-align:left}th{background:#fff0f5}.total{font-weight:800;background:#fff0f5}@media print{button{display:none}.summary{grid-template-columns:repeat(2,1fr)}}</style>
      </head><body>
      <h1>Lovely Paradise Bar Sales Report</h1>
      <p class="muted">${selectedReport.label} · ${selectedReport.range}</p>
      <p><strong>Closing status:</strong> <span class="${selectedReport.closingStatus === 'closed' ? '' : 'warn'}">${selectedReport.statusLabel}</span></p>
      <div class="summary">
        <div class="box">Cash Payment<b>${money(selectedReport.cash, String(settings.currency_symbol))}</b></div>
        <div class="box">QR Payment<b>${money(selectedReport.qr, String(settings.currency_symbol))}</b></div>
        <div class="box">FOC Cost<b class="bad">- ${money(selectedReport.focCost, String(settings.currency_symbol))}</b></div>
        <div class="box">Total Revenue<b>${money(selectedReport.paidSales, String(settings.currency_symbol))}</b></div>
        <div class="box">Cash Variance<b>${money(selectedReport.variance, String(settings.currency_symbol))}</b></div>
        <div class="box">Item Detail Dates<b>${selectedReport.range}</b></div>
      </div>
      <h2>Sales of all items</h2>
      <table><thead><tr><th>Item</th><th>Quantity</th><th>Cash Payment</th><th>QR Payment</th><th>FOC Cost</th><th>Total Revenue</th></tr></thead><tbody>${rows}<tr class="total"><td>Total</td><td>${reportItemTotals.quantity}</td><td>${money(reportItemTotals.cash, String(settings.currency_symbol))}</td><td>${money(reportItemTotals.qr, String(settings.currency_symbol))}</td><td>- ${money(reportItemTotals.focCost, String(settings.currency_symbol))}</td><td>${money(reportItemTotals.paidSales, String(settings.currency_symbol))}</td></tr></tbody></table>
      <script>window.print();</script>
      </body></html>
    `);
    printable.document.close();
  }

  function downloadRowPdf(event: MouseEvent<HTMLButtonElement>, report: ReportRow) {
    event.stopPropagation();
    downloadPdfReport(report);
  }

  function openEditReport(event: MouseEvent<HTMLButtonElement>, report: ReportRow) {
    event.stopPropagation();
    setEditTarget(report);
    setEditPassword('');
  }

  function confirmEditReport() {
    if (!editTarget) return;
    if (editPassword !== '200000') {
      toast.error('Wrong admin password.');
      return;
    }
    navigate(`/daily-closing?date=${editTarget.businessDate}&edit=1`);
  }

  function selectReport(report: ReportRow) {
    setBusinessDate(report.businessDate);
    setSelectedReportId(report.id);
    setSelectedReportDate(report.businessDate);
  }

  return (
    <>
      <PageHeader
        title={text('Reports', 'Laporan')}
        subtitle={text('View summaries, saved reports, item sales, and sales records in one place.', 'Lihat ringkasan, laporan tersimpan, jualan item, dan rekod jualan di satu tempat.')}
      />
      <section className="island-panel mb-3 rounded-2xl p-1.5 sm:mb-5 sm:rounded-[2rem] sm:p-2">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className={`min-h-10 rounded-xl px-3 py-2 text-sm font-black sm:min-h-12 sm:rounded-2xl sm:px-4 sm:py-3 ${reportSection === 'reports' ? 'bg-accent text-white shadow-glow' : 'bg-white/80 text-ink'}`}
            onClick={() => setReportSection('reports')}
          >
            Reports Table
          </button>
          <button
            type="button"
            className={`min-h-10 rounded-xl px-3 py-2 text-sm font-black sm:min-h-12 sm:rounded-2xl sm:px-4 sm:py-3 ${reportSection === 'sales' ? 'bg-accent text-white shadow-glow' : 'bg-white/80 text-ink'}`}
            onClick={() => setReportSection('sales')}
          >
            Sales History
          </button>
        </div>
      </section>
      {reportSection === 'sales' ? (
        <SalesHistory settings={settings} embedded />
      ) : (
      <>
      <section className="mb-4 grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 shadow-soft sm:rounded-[1.5rem] sm:p-4 lg:p-5"><p className="text-xs font-black text-emerald-700 sm:text-sm">Cash Payment 💵</p><p className="mt-1.5 text-lg font-black sm:text-xl lg:text-2xl">{money(periodTotals.cash, String(settings.currency_symbol))}</p></div>
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3 shadow-soft sm:rounded-[1.5rem] sm:p-4 lg:p-5"><p className="text-xs font-black text-sky-700 sm:text-sm">QR Payment 📱</p><p className="mt-1.5 text-lg font-black sm:text-xl lg:text-2xl">{money(periodTotals.qr, String(settings.currency_symbol))}</p></div>
        <div className="rounded-2xl border border-pink-200 bg-pink-50 p-3 shadow-soft sm:rounded-[1.5rem] sm:p-4 lg:p-5"><p className="text-xs font-black text-pink-700 sm:text-sm">FOC Cost 🎁</p><p className="mt-1.5 text-lg font-black text-coral sm:text-xl lg:text-2xl">- {money(periodTotals.focCost, String(settings.currency_symbol))}</p></div>
        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-3 shadow-soft sm:rounded-[1.5rem] sm:p-4 lg:p-5"><p className="text-xs font-black text-violet-700 sm:text-sm">Total Revenue</p><p className="mt-1.5 text-lg font-black sm:text-xl lg:text-2xl">{money(periodTotals.paidSales, String(settings.currency_symbol))}</p></div>
      </section>
      <section className="island-panel rounded-2xl p-3 sm:rounded-[2rem] sm:p-5">
        <h2 className="text-lg font-black sm:text-xl">{text('All reports table', 'Jadual semua laporan')}</h2>
        <div className="mt-2 grid gap-2 md:grid-cols-[minmax(320px,1fr)_minmax(200px,260px)] md:items-center lg:grid-cols-[minmax(430px,560px)_minmax(220px,1fr)]">
          <div className="grid w-full grid-cols-4 gap-1 rounded-2xl bg-white/80 p-1 text-sm font-black">
            {(['daily', 'weekly', 'monthly', 'custom'] as const).map((item) => (
              <button
                key={item}
                className={`min-h-9 rounded-xl px-1.5 py-1.5 text-center text-xs sm:min-h-10 sm:px-3 sm:py-2 sm:text-sm ${reportPeriod === item ? 'bg-accent text-white' : ''}`}
                onClick={() => setReportPeriod(item)}
              >
                {item === 'daily' ? 'Daily' : item === 'weekly' ? 'Weekly' : item === 'monthly' ? 'Monthly' : 'Selected'}
              </button>
            ))}
          </div>
          <div className="grid w-full min-w-0 gap-2 lg:justify-end">
            {reportPeriod === 'daily' ? (
              <input
                className={inputClass}
                type="month"
                value={reportMonth}
                onChange={(event) => setReportMonth(event.target.value)}
              />
            ) : null}
            {reportPeriod === 'custom' ? (
              <div className="grid w-full min-w-0 gap-2 lg:grid-cols-[minmax(0,180px)_minmax(0,180px)_auto]">
                <input className={inputClass} type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} />
                <input className={inputClass} type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} />
                <button className={`${secondaryButtonClass} justify-center`} onClick={() => downloadPdfReport(selectedPeriodRow)}>
                  <Download className="h-4 w-4" />
                  Download selected period PDF
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-white/75 sm:rounded-[1.5rem]">
          <table className="w-full min-w-[980px] table-fixed text-left text-xs sm:text-sm">
            <thead className="bg-shell text-sm">
              <tr>
                <th className="w-[112px] px-2 py-2 whitespace-nowrap sm:px-3">Period</th>
                <th className="w-[180px] px-2 py-2 whitespace-nowrap sm:px-3">Dates</th>
                <th className="w-[90px] px-3 py-2 whitespace-nowrap">Closing</th>
                <th className="w-[120px] px-3 py-2 whitespace-nowrap">Cash Payment 💵</th>
                <th className="w-[115px] px-3 py-2 whitespace-nowrap">QR Payment 📱</th>
                <th className="w-[105px] px-3 py-2 whitespace-nowrap">FOC Cost 🎁</th>
                <th className="w-[120px] px-3 py-2 whitespace-nowrap">Total Revenue</th>
                <th className="w-[105px] px-3 py-2 whitespace-nowrap">Variance</th>
                <th className="w-[115px] px-3 py-2 whitespace-nowrap">Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleReportRows.map((sample) => (
                <tr
                  key={sample.id}
                  className={`cursor-pointer border-t border-line hover:bg-shell ${activeReport?.id === sample.id ? 'bg-pink-50' : ''}`}
                  onClick={() => selectReport(sample)}
                >
                  <td className="px-3 py-2 font-black whitespace-nowrap">{sample.label}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{sample.range}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={`rounded-xl px-3 py-1 text-xs font-black ${sample.closingStatus === 'closed' ? 'bg-teal-50 text-accent' : sample.closingStatus === 'partial' ? 'bg-amber-50 text-warning' : 'bg-pink-100 text-coral'}`}>
                      {sample.statusLabel}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{money(sample.cash, String(settings.currency_symbol))}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{money(sample.qr, String(settings.currency_symbol))}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-coral">- {money(sample.focCost, String(settings.currency_symbol))}</td>
                  <td className="px-3 py-2 font-black whitespace-nowrap">{money(sample.paidSales, String(settings.currency_symbol))}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{money(sample.variance, String(settings.currency_symbol))}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex gap-2">
                      <button className={`${secondaryButtonClass} min-h-9 justify-center rounded-xl px-3 py-1.5 text-xs`} onClick={(event) => openEditReport(event, sample)}>
                        Edit
                      </button>
                      <button className={`${secondaryButtonClass} min-h-9 justify-center rounded-xl px-3 py-1.5 text-xs`} onClick={(event) => downloadRowPdf(event, sample)}>
                        <Download className="h-4 w-4" />
                        PDF
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-bold text-neutral-600">Click a row to view item details below.</p>
          {reportRows.length > 12 ? (
            <button className={secondaryButtonClass} onClick={() => setShowAllRows((value) => !value)}>
              {showAllRows ? 'Show latest 12' : 'View more'}
            </button>
          ) : null}
        </div>
      </section>
      <section className="island-panel mt-4 rounded-2xl p-3 sm:mt-5 sm:rounded-[2rem] sm:p-5">
        <h2 className="text-lg font-black sm:text-xl">{text('Sales of all items', 'Jualan semua item')} · {activeReport ? `${activeReport.label} (${activeReport.range})` : selectedReportDate}</h2>
        <div className="hidden">
          {selectedItemSales.map((item) => (
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
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[780px] text-left">
            <thead className="bg-shell text-sm">
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
              {selectedItemSales.map((item) => (
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
      </>
      )}
      {reportSection === 'reports' && editTarget ? (
        <Modal
          title={`Edit report - ${editTarget.label}`}
          onClose={() => setEditTarget(null)}
          footer={
            <div className="grid w-full gap-2 sm:flex sm:justify-end">
              <button className={secondaryButtonClass} onClick={() => setEditTarget(null)}>Cancel</button>
              <button className={buttonClass} disabled={!editPassword} onClick={confirmEditReport}>Unlock edit</button>
            </div>
          }
        >
          <div className="grid gap-3">
            <p className="text-sm font-bold text-neutral-700">Enter admin password to edit this report date.</p>
            <input className={inputClass} type="password" value={editPassword} onChange={(event) => setEditPassword(event.target.value)} placeholder="Admin password" />
          </div>
        </Modal>
      ) : null}
    </>
  );
}
