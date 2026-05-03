import { MouseEvent, useEffect, useMemo, useState } from 'react';
import { endOfISOWeek, format, getISOWeek, parseISO, startOfISOWeek } from 'date-fns';
import { Download } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { buttonClass, inputClass, secondaryButtonClass } from '../components/Form';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/Page';
import { useToast } from '../components/Toast';
import { malaysiaDateInputValue, money } from '../lib/format';
import { demoMovements, demoReports } from '../lib/demo';
import { loadLocalProducts, loadLocalSaleItems, loadLocalSales } from '../lib/localStore';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type { CashSession, DailyReport, ProductWithStock, Sale, SaleItem, SettingsMap, StockMovement } from '../lib/types';
import { useLanguage } from '../lib/language';
import { actualItemSales } from '../lib/reportItems';
import SalesHistory from './SalesHistory';

type ReportPeriod = 'daily' | 'weekly' | 'monthly' | 'custom';
type ClosingStatus = 'closed' | 'not_closed' | 'partial';
type SaleWithItems = Sale & { sale_items?: SaleItem[] };
type StockMovementWithProduct = StockMovement & { products?: { name: string } | null };

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

function saleCalendarDate(sale: Sale) {
  return sale.created_at ? malaysiaDateInputValue(sale.created_at) : sale.business_date;
}

function htmlEscape(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function paymentLabel(method: Sale['payment_method']) {
  if (method === 'cash') return 'Cash Payment';
  if (method === 'qr') return 'QR Payment';
  return 'FOC';
}

function movementCalendarDate(movement: StockMovement) {
  return malaysiaDateInputValue(movement.created_at);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  return format(new Date(value), 'dd MMM yyyy, h:mm a');
}

function signedUnits(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function movementTypeLabel(type: StockMovement['movement_type']) {
  if (type === 'stock_in') return 'Stock In';
  if (type === 'sale') return 'Sale';
  if (type === 'complimentary') return 'FOC';
  if (type === 'void_sale') return 'Void Sale';
  return 'Adjustment';
}

function saleDateInPeriod(sale: Sale, dates: Set<string>) {
  return dates.has(sale.business_date) || dates.has(saleCalendarDate(sale));
}

function allocateReportAmount(total: number, weights: number[]) {
  const cents = Math.round(total * 100);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let used = 0;
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return (cents - used) / 100;
    const share = totalWeight > 0 ? weight / totalWeight : 1 / Math.max(weights.length, 1);
    const value = Math.round(cents * share);
    used += value;
    return value / 100;
  });
}

function buildReportDays(reports: DailyReport[], sales: Sale[]): ReportDay[] {
  const reportsByDate = new Map(reports.map((report) => [report.business_date, report]));
  const salesDates = Array.from(new Set(sales.map((sale) => saleCalendarDate(sale))));
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

    const completedSales = sales.filter((sale) => saleCalendarDate(sale) === date && sale.status === 'completed');
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
  const today = malaysiaDateInputValue(new Date());
  const [reports, setReports] = useState<DailyReport[]>(demoReports);
  const [sales, setSales] = useState<SaleWithItems[]>(() => {
    const localSaleItems = loadLocalSaleItems();
    return loadLocalSales().map((sale) => ({
      ...sale,
      sale_items: localSaleItems.filter((item) => item.sale_id === sale.id),
    }));
  });
  const [stockMovements, setStockMovements] = useState<StockMovementWithProduct[]>(demoMovements);
  const [products, setProducts] = useState<ProductWithStock[]>(() => loadLocalProducts(true));
  const [cashSessions, setCashSessions] = useState<CashSession[]>([]);
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>('daily');
  const [, setBusinessDate] = useState(today);
  const [reportMonth, setReportMonth] = useState(today.slice(0, 7));
  const [customStart, setCustomStart] = useState(today);
  const [customEnd, setCustomEnd] = useState(today);
  const [selectedReportDate, setSelectedReportDate] = useState(today);
  const [selectedReportId, setSelectedReportId] = useState('');
  const [reportSection, setReportSection] = useState<'reports' | 'sales'>('reports');
  const [showAllRows, setShowAllRows] = useState(false);
  const [editTarget, setEditTarget] = useState<ReportRow | null>(null);
  const [editPassword, setEditPassword] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    async function loadReports() {
      if (!isSupabaseConfigured) return;
      const [
        { data: reportData },
        { data: saleData },
        { data: movementData },
        { data: productData },
        { data: cashSessionData },
      ] = await Promise.all([
        supabase.from('daily_reports').select('*').order('business_date', { ascending: false }),
        supabase.from('sales').select('*, sale_items(*, products(name))').order('business_date', { ascending: false }),
        supabase.from('stock_movements').select('*, products(name)').order('created_at', { ascending: true }),
        supabase.from('products').select('*, categories(id,name,sort_order), inventory_balances(quantity_on_hand)').order('name'),
        supabase.from('cash_sessions').select('*').order('business_date', { ascending: false }),
      ]);
      setReports((reportData ?? []) as DailyReport[]);
      setSales((saleData ?? []) as SaleWithItems[]);
      setStockMovements((movementData ?? []) as StockMovementWithProduct[]);
      setProducts((productData ?? []) as ProductWithStock[]);
      setCashSessions((cashSessionData ?? []) as CashSession[]);
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
    () => actualItemSales(sales, activeReport?.dates ?? []),
    [activeReport?.dates, sales],
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
    const currency = String(settings.currency_symbol);
    const periodDates = selectedReport.dates.length > 0 ? selectedReport.dates : [selectedReport.businessDate];
    const selectedDates = new Set(periodDates);
    const reportItems = actualItemSales(sales, periodDates);
    const completedSales = sales.filter((sale) => sale.status === 'completed' && saleDateInPeriod(sale, selectedDates));
    const allPeriodSales = sales.filter((sale) => saleDateInPeriod(sale, selectedDates));
    const voidedSales = allPeriodSales.filter((sale) => sale.status === 'voided');
    const qrSales = completedSales.filter((sale) => sale.payment_method === 'qr');
    const reportByDate = new Map(reports.map((item) => [item.business_date, item]));
    const cashSessionByDate = new Map(cashSessions.map((item) => [item.business_date, item]));
    const periodMovements = stockMovements.filter((movement) => selectedDates.has(movementCalendarDate(movement)));
    const stockInMovements = periodMovements.filter((movement) => movement.movement_type === 'stock_in');
    const stockOutMovements = periodMovements.filter((movement) => movement.movement_type !== 'stock_in');
    const discountTotal = completedSales.reduce((sum, sale) => sum + Number(sale.discount_amount ?? 0), 0);
    const qrPendingTotal = qrSales.filter((sale) => sale.qr_status === 'pending').reduce((sum, sale) => sum + Number(sale.paid_amount), 0);
    const qrVerifiedTotal = qrSales.filter((sale) => sale.qr_status === 'verified').reduce((sum, sale) => sum + Number(sale.paid_amount), 0);
    const qrMismatchTotal = qrSales.filter((sale) => sale.qr_status === 'mismatch').reduce((sum, sale) => sum + Number(sale.paid_amount), 0);
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

    const productById = new Map(products.map((product) => [product.id, product]));
    const categoryBreakdown = new Map<string, { category: string; quantity: number; cash: number; qr: number; focCost: number }>();
    completedSales.forEach((sale) => {
      const items = sale.sale_items ?? [];
      const allocatedValues = allocateReportAmount(Number(sale.total_amount), items.map((item) => Number(item.line_total)));
      items.forEach((item, index) => {
        const product = item.product_id ? productById.get(item.product_id) : null;
        const category = product?.categories?.name ?? (item.product_id ? 'Others' : 'Custom Order');
        const current = categoryBreakdown.get(category) ?? { category, quantity: 0, cash: 0, qr: 0, focCost: 0 };
        const value = allocatedValues[index] ?? 0;
        current.quantity += Number(item.quantity);
        if (sale.payment_method === 'cash') current.cash += value;
        if (sale.payment_method === 'qr') current.qr += value;
        if (sale.payment_method === 'complimentary') current.focCost += value;
        categoryBreakdown.set(category, current);
      });
    });
    const inventoryRows = products.map((product) => {
      const current = Number(product.inventory_balances?.quantity_on_hand ?? 0);
      const productMovements = stockMovements.filter((movement) => movement.product_id === product.id);
      const afterPeriodChange = productMovements
        .filter((movement) => movementCalendarDate(movement) > selectedReport.toDate)
        .reduce((sum, movement) => sum + Number(movement.quantity_change), 0);
      const periodProductMovements = productMovements.filter((movement) => selectedDates.has(movementCalendarDate(movement)));
      const periodNet = periodProductMovements.reduce((sum, movement) => sum + Number(movement.quantity_change), 0);
      const closing = current - afterPeriodChange;
      const opening = closing - periodNet;
      const stockIn = periodProductMovements
        .filter((movement) => movement.movement_type === 'stock_in')
        .reduce((sum, movement) => sum + Number(movement.quantity_change), 0);
      const stockOut = Math.abs(periodProductMovements
        .filter((movement) => movement.quantity_change < 0)
        .reduce((sum, movement) => sum + Number(movement.quantity_change), 0));
      const voidReturns = periodProductMovements
        .filter((movement) => movement.movement_type === 'void_sale')
        .reduce((sum, movement) => sum + Number(movement.quantity_change), 0);
      const adjustmentNet = periodProductMovements
        .filter((movement) => movement.movement_type === 'adjustment')
        .reduce((sum, movement) => sum + Number(movement.quantity_change), 0);
      return {
        product,
        opening,
        stockIn,
        stockOut,
        voidReturns,
        adjustmentNet,
        closing,
        low: product.active && closing <= Number(product.low_stock_threshold),
      };
    });

    const closingRows = periodDates.map((date) => {
      const closedReport = reportByDate.get(date);
      const cashSession = cashSessionByDate.get(date);
      const daySales = completedSales.filter((sale) => saleDateInPeriod(sale, new Set([date])));
      const closedSnapshot = closedReport?.status === 'closed';
      const openingFloat = Number(cashSession?.opening_float ?? closedReport?.report_json?.opening_cash_float ?? 0);
      const fallbackExpectedCash = openingFloat + daySales.reduce((sum, sale) => sum + (sale.payment_method === 'cash' ? Number(sale.paid_amount) : 0), 0);
      const actualCash = closedReport?.actual_cash_counted ?? cashSession?.actual_cash_counted ?? null;
      const expectedCash = closedReport?.expected_cash ?? cashSession?.expected_cash ?? fallbackExpectedCash;
      const variance = closedReport?.cash_variance ?? cashSession?.cash_variance ?? null;
      return {
        date,
        status: closedSnapshot ? 'Closed' : 'Not closed',
        openingFloat,
        cash: closedReport ? Number(closedReport.total_cash) : daySales.reduce((sum, sale) => sum + (sale.payment_method === 'cash' ? Number(sale.paid_amount) : 0), 0),
        qr: closedReport ? Number(closedReport.total_qr) : daySales.reduce((sum, sale) => sum + (sale.payment_method === 'qr' ? Number(sale.paid_amount) : 0), 0),
        focCost: closedReport ? Number(closedReport.total_complimentary_value) : daySales.reduce((sum, sale) => sum + (sale.payment_method === 'complimentary' ? Number(sale.total_amount) : 0), 0),
        totalRevenue: closedReport ? Number(closedReport.total_sales) : daySales.reduce((sum, sale) => sum + (sale.payment_method === 'complimentary' ? 0 : Number(sale.paid_amount)), 0),
        actualCash,
        expectedCash,
        variance,
        notes: closedReport?.notes ?? cashSession?.notes ?? '',
        closedAt: closedReport?.closed_at ?? cashSession?.closed_at ?? null,
      };
    });

    const tableHtml = (headers: string[], rows: string, emptyText: string) => `
      <table>
        <thead><tr>${headers.map((header) => `<th>${htmlEscape(header)}</th>`).join('')}</tr></thead>
        <tbody>${rows || `<tr><td colspan="${headers.length}" class="empty">${htmlEscape(emptyText)}</td></tr>`}</tbody>
      </table>
    `;

    const rows = reportItems
      .map((item) => `<tr><td>${htmlEscape(item.product)}</td><td>${item.quantity}</td><td>${money(item.cash, currency)}</td><td>${money(item.qr, currency)}</td><td class="bad">- ${money(item.focCost, currency)}</td><td><strong>${money(item.cash + item.qr, currency)}</strong></td></tr>`)
      .join('');
    const categoryRows = Array.from(categoryBreakdown.values())
      .sort((a, b) => a.category.localeCompare(b.category))
      .map((item) => `<tr><td>${htmlEscape(item.category)}</td><td>${item.quantity}</td><td>${money(item.cash, currency)}</td><td>${money(item.qr, currency)}</td><td class="bad">- ${money(item.focCost, currency)}</td><td><strong>${money(item.cash + item.qr, currency)}</strong></td></tr>`)
      .join('');
    const salesRows = completedSales
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((sale) => `<tr><td>${htmlEscape(saleCalendarDate(sale))}</td><td>${htmlEscape(sale.sale_number)}</td><td>${htmlEscape(sale.order_taken_by ?? '-')}</td><td>${htmlEscape(paymentLabel(sale.payment_method))}</td><td>${htmlEscape(sale.payment_method === 'qr' ? (sale.qr_payment_type ?? '-') : '-')}</td><td>${htmlEscape(sale.payment_method === 'qr' ? sale.qr_status : '-')}</td><td>${money(Number(sale.discount_amount ?? 0), currency)}</td><td>${money(sale.total_amount, currency)}</td><td>${money(sale.paid_amount, currency)}</td></tr>`)
      .join('');
    const qrRows = qrSales
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((sale) => `<tr><td>${htmlEscape(saleCalendarDate(sale))}</td><td>${htmlEscape(sale.sale_number)}</td><td>${htmlEscape(sale.order_taken_by ?? '-')}</td><td>${htmlEscape(sale.qr_payment_type ?? '-')}</td><td>${htmlEscape(sale.qr_reference ?? '-')}</td><td>${htmlEscape(sale.qr_status)}</td><td>${htmlEscape(sale.qr_receipt_image_path ? 'Attached' : 'Missing')}</td><td>${money(sale.paid_amount, currency)}</td></tr>`)
      .join('');
    const closingTableRows = closingRows
      .map((row) => `<tr><td>${htmlEscape(row.date)}</td><td class="${row.status === 'Closed' ? 'good' : 'warn'}">${htmlEscape(row.status)}</td><td>${money(row.openingFloat, currency)}</td><td>${money(row.cash, currency)}</td><td>${money(row.qr, currency)}</td><td class="bad">- ${money(row.focCost, currency)}</td><td><strong>${money(row.totalRevenue, currency)}</strong></td><td>${row.actualCash === null ? '-' : money(row.actualCash, currency)}</td><td>${row.expectedCash === null ? '-' : money(row.expectedCash, currency)}</td><td>${row.variance === null ? '-' : money(row.variance, currency)}</td><td>${htmlEscape(formatDateTime(row.closedAt))}</td><td>${htmlEscape(row.notes || '-')}</td></tr>`)
      .join('');
    const voidedRows = voidedSales
      .sort((a, b) => (a.voided_at ?? a.created_at).localeCompare(b.voided_at ?? b.created_at))
      .map((sale) => `<tr><td>${htmlEscape(saleCalendarDate(sale))}</td><td>${htmlEscape(sale.sale_number)}</td><td>${htmlEscape(formatDateTime(sale.voided_at ?? sale.created_at))}</td><td>${htmlEscape(sale.order_taken_by ?? '-')}</td><td>${htmlEscape(paymentLabel(sale.payment_method))}</td><td>${money(sale.total_amount, currency)}</td><td>${htmlEscape(sale.void_reason ?? '-')}</td></tr>`)
      .join('');
    const voidedTotal = voidedSales.reduce((sum, sale) => sum + Number(sale.total_amount), 0);
    const stockInRows = stockInMovements
      .map((movement) => `<tr><td>${htmlEscape(movementCalendarDate(movement))}</td><td>${htmlEscape(movement.products?.name ?? (movement.product_id ? productById.get(movement.product_id)?.name : null) ?? '-')}</td><td>${signedUnits(Number(movement.quantity_change))}</td><td>${htmlEscape(movement.unit_input === 'carton' ? `${movement.input_quantity ?? '-'} CARTON(S) x ${movement.carton_size_at_time ?? '-'} units` : `${movement.input_quantity ?? Math.abs(movement.quantity_change)} UNIT(S)`)}</td><td>${htmlEscape(movement.entered_by ?? '-')}</td><td>${htmlEscape(movement.reason ?? '-')}</td><td>${htmlEscape(movement.notes ?? '-')}</td></tr>`)
      .join('');
    const stockOutRows = stockOutMovements
      .map((movement) => `<tr><td>${htmlEscape(movementCalendarDate(movement))}</td><td>${htmlEscape(movement.products?.name ?? (movement.product_id ? productById.get(movement.product_id)?.name : null) ?? '-')}</td><td>${htmlEscape(movementTypeLabel(movement.movement_type))}</td><td>${signedUnits(Number(movement.quantity_change))}</td><td>${htmlEscape(movement.entered_by ?? '-')}</td><td>${htmlEscape(movement.reference_type ?? '-')}</td><td>${htmlEscape(movement.reason ?? movement.notes ?? '-')}</td></tr>`)
      .join('');
    const inventoryTableRows = inventoryRows
      .map((row) => `<tr><td>${htmlEscape(row.product.name)}</td><td>${htmlEscape(row.product.categories?.name ?? 'Others')}</td><td>${row.opening}</td><td>${row.stockIn}</td><td>${row.stockOut}</td><td>${row.voidReturns}</td><td>${signedUnits(row.adjustmentNet)}</td><td><strong>${row.closing}</strong></td><td class="${row.low ? 'bad' : 'good'}">${row.low ? 'Low' : 'OK'}</td></tr>`)
      .join('');
    const lowStockRows = inventoryRows
      .filter((row) => row.low)
      .map((row) => `<tr><td>${htmlEscape(row.product.name)}</td><td>${row.closing}</td><td>${row.product.low_stock_threshold}</td><td>${htmlEscape(row.product.active ? 'Active' : 'Inactive')}</td></tr>`)
      .join('');
    const fileTitle = `${selectedReport.label} ${selectedReport.range}`.replace(/[<>]/g, '');
    printable.document.write(`
      <html><head><title>Lovely Paradise Report ${fileTitle}</title>
      <style>
        @page{size:A4 landscape;margin:10mm}
        *{box-sizing:border-box}
        body{font-family:Arial,Helvetica,sans-serif;padding:0;color:#2b1b27;font-size:11px;line-height:1.35}
        h1{margin:0 0 3px;font-size:24px}h2{margin:18px 0 8px;font-size:16px}h3{margin:12px 0 6px;font-size:13px}
        .muted{color:#6b5b68}.good{color:#087f72;font-weight:800}.warn{color:#b45309;font-weight:800}.bad{color:#d94d6a;font-weight:800}
        .top{display:flex;justify-content:space-between;gap:12px;border-bottom:2px solid #2b1b27;padding-bottom:10px;margin-bottom:12px}
        .summary{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin:12px 0}
        .box{border:1px solid #ead1dc;background:#fff7fb;border-radius:10px;padding:8px;min-height:54px}.box b{display:block;margin-top:4px;font-size:14px}
        table{border-collapse:collapse;width:100%;margin:0 0 12px;page-break-inside:auto}tr{page-break-inside:avoid;page-break-after:auto}
        td,th{border:1px solid #ddd;padding:6px;text-align:left;vertical-align:top}th{background:#fff0f5;font-size:10px;text-transform:uppercase;letter-spacing:.02em}
        .total{font-weight:800;background:#fff0f5}.empty{color:#6b5b68;text-align:center}
        .two{display:grid;grid-template-columns:1fr 1fr;gap:12px}.section{break-inside:avoid}
        @media print{button{display:none}.section{break-inside:avoid}}
      </style>
      </head><body>
      <div class="top">
        <div>
          <h1>Lovely Paradise Bar Account Report</h1>
          <div class="muted">${htmlEscape(selectedReport.label)} · ${htmlEscape(selectedReport.range)}</div>
        </div>
        <div>
          <strong>Generated:</strong> ${htmlEscape(formatDateTime(new Date().toISOString()))}<br>
          <strong>Closing status:</strong> <span class="${selectedReport.closingStatus === 'closed' ? 'good' : 'warn'}">${htmlEscape(selectedReport.statusLabel)}</span>
        </div>
      </div>
      <div class="summary">
        <div class="box">Cash Payment<b>${money(selectedReport.cash, currency)}</b></div>
        <div class="box">QR Payment<b>${money(selectedReport.qr, currency)}</b></div>
        <div class="box">Total Revenue<b>${money(selectedReport.paidSales, currency)}</b></div>
        <div class="box">FOC Cost<b class="bad">- ${money(selectedReport.focCost, currency)}</b></div>
        <div class="box">Discount Given<b>${money(discountTotal, currency)}</b></div>
        <div class="box">Cash Variance<b>${money(selectedReport.variance, currency)}</b></div>
        <div class="box">Transactions<b>${completedSales.length}</b></div>
        <div class="box">Voided Sales<b>${voidedSales.length}</b></div>
        <div class="box">QR Pending<b>${money(qrPendingTotal, currency)}</b></div>
        <div class="box">QR Verified<b>${money(qrVerifiedTotal, currency)}</b></div>
        <div class="box">QR Mismatch<b>${money(qrMismatchTotal, currency)}</b></div>
        <div class="box">Report Dates<b>${periodDates.length}</b></div>
      </div>
      <div class="section">
        <h2>Daily Closing</h2>
        ${tableHtml(['Date', 'Status', 'Opening Float', 'Cash Payment', 'QR Payment', 'FOC Cost', 'Total Revenue', 'Actual Cash', 'Expected Cash', 'Variance', 'Closed At', 'Notes'], closingTableRows, 'No closing rows for this period.')}
      </div>
      <div class="section">
        <h2>Sales of All Items</h2>
        ${tableHtml(['Item', 'Quantity', 'Cash Payment', 'QR Payment', 'FOC Cost', 'Total Revenue'], `${rows}<tr class="total"><td>Total</td><td>${reportItemTotals.quantity}</td><td>${money(reportItemTotals.cash, currency)}</td><td>${money(reportItemTotals.qr, currency)}</td><td class="bad">- ${money(reportItemTotals.focCost, currency)}</td><td>${money(reportItemTotals.paidSales, currency)}</td></tr>`, 'No item sales for this period.')}
      </div>
      <div class="section">
        <h2>Sales by Category</h2>
        ${tableHtml(['Category', 'Quantity', 'Cash Payment', 'QR Payment', 'FOC Cost', 'Total Revenue'], `${categoryRows}<tr class="total"><td>Total</td><td>${reportItemTotals.quantity}</td><td>${money(reportItemTotals.cash, currency)}</td><td>${money(reportItemTotals.qr, currency)}</td><td class="bad">- ${money(reportItemTotals.focCost, currency)}</td><td>${money(reportItemTotals.paidSales, currency)}</td></tr>`, 'No category sales for this period.')}
      </div>
      <div class="section">
        <h2>Sales Transactions</h2>
        ${tableHtml(['Date', 'Sale No.', 'Staff', 'Method', 'QR Type', 'QR Status', 'Discount', 'Sale Value', 'Paid'], salesRows, 'No completed sales for this period.')}
      </div>
      <div class="two">
        <div class="section">
          <h2>QR Payment Verification</h2>
          ${tableHtml(['Date', 'Sale No.', 'Staff', 'QR Type', 'Reference', 'Status', 'Receipt', 'Amount'], qrRows, 'No QR Payment sales for this period.')}
        </div>
        <div class="section">
          <h2>Voided Sales</h2>
          ${tableHtml(['Date', 'Sale No.', 'Voided At', 'Staff', 'Method', 'Original Value', 'Reason'], `${voidedRows}${voidedSales.length > 0 ? `<tr class="total"><td colspan="5">Total voided original value</td><td>${money(voidedTotal, currency)}</td><td></td></tr>` : ''}`, 'No voided sales for this period.')}
        </div>
      </div>
      <div class="section">
        <h2>Stock In</h2>
        ${tableHtml(['Date', 'Product', 'Units Added', 'Input', 'Entered By', 'Reference', 'Notes'], stockInRows, 'No stock-in records for this period.')}
      </div>
      <div class="section">
        <h2>Stock Out / Adjustments</h2>
        ${tableHtml(['Date', 'Product', 'Type', 'Quantity Change', 'Entered By', 'Reference', 'Reason / Notes'], stockOutRows, 'No stock-out, void, or adjustment records for this period.')}
      </div>
      <div class="section">
        <h2>Inventory Balance</h2>
        ${tableHtml(['Product', 'Category', 'Opening', 'Stock In', 'Stock Out', 'Void Returns', 'Adjustments', 'Closing', 'Status'], inventoryTableRows, 'No inventory rows available.')}
      </div>
      <div class="section">
        <h2>Low Stock Items</h2>
        ${tableHtml(['Product', 'Closing Balance', 'Low Alert Level', 'Product Status'], lowStockRows, 'No low stock items for this period.')}
      </div>
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
    sessionStorage.setItem(`lovely_paradise_report_edit:${editTarget.businessDate}`, 'ok');
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
        <div className="mt-2 flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="grid w-full min-w-0 grid-cols-4 gap-1 rounded-2xl bg-white/80 p-1 text-sm font-black lg:max-w-[520px]">
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
          <div className="grid w-full min-w-0 gap-2 lg:max-w-[560px] lg:justify-end">
            {reportPeriod === 'daily' ? (
              <input
                className={`${inputClass} lg:w-[240px]`}
                type="month"
                value={reportMonth}
                onChange={(event) => setReportMonth(event.target.value)}
              />
            ) : null}
            {reportPeriod === 'custom' ? (
              <div className="grid w-full min-w-0 gap-2 lg:grid-cols-[minmax(0,170px)_minmax(0,170px)_auto]">
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
          <table className="w-full min-w-[1120px] table-fixed text-left text-xs sm:text-sm">
            <thead className="bg-shell text-sm">
              <tr>
                <th className="w-[112px] px-2 py-2 whitespace-nowrap sm:px-3">Period</th>
                <th className="w-[180px] px-2 py-2 whitespace-nowrap sm:px-3">Dates</th>
                <th className="w-[90px] px-3 py-2 whitespace-nowrap">Closing</th>
                <th className="w-[145px] px-3 py-2 whitespace-nowrap">Cash Payment 💵</th>
                <th className="w-[135px] px-3 py-2 whitespace-nowrap">QR Payment 📱</th>
                <th className="w-[130px] px-3 py-2 whitespace-nowrap">FOC Cost 🎁</th>
                <th className="w-[140px] px-3 py-2 whitespace-nowrap">Total Revenue</th>
                <th className="w-[105px] px-3 py-2 whitespace-nowrap">Variance</th>
                <th className="w-[135px] px-3 py-2 whitespace-nowrap">Action</th>
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
