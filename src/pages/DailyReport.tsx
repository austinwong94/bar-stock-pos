import { Fragment, MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import { addDays, endOfISOWeek, endOfMonth, endOfYear, format, getISOWeek, parseISO, startOfISOWeek, startOfYear } from 'date-fns';
import { Download, Eye, Pencil, RefreshCcw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { buttonClass, iconButtonClass, inputClass, secondaryButtonClass } from '../components/Form';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/Page';
import { ViewChoices } from '../components/ViewChoices';
import { downloadArchivePdf, localArchives as buildLocalAccountReportArchives } from '../components/AccountReportArchivePanel';
import { archiveDownloadName, barReportScope, operationsReportScope, reportDownloadName } from '../lib/reportScope';
import { useToast } from '../components/Toast';
import { malaysiaBusinessDateInputValue, money } from '../lib/format';

import { loadLocalDailyReports, loadLocalProducts, loadLocalSaleItems, loadLocalSales, loadLocalStockInDrafts, loadLocalStockMovements } from '../lib/localStore';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type { AccountReportArchive, CashSession, DailyReport, ProductWithStock, Sale, SaleItem, SettingsMap, StockInDraftRecord, StockMovement } from '../lib/types';
import { useLanguage } from '../lib/language';
import { actualItemSales, type ItemSalesBreakdown } from '../lib/reportItems';
import SalesHistory from './SalesHistory';
import { unlockAdminAccess } from '../lib/adminAccess';
import { useSharedRefresh } from '../lib/useSharedRefresh';

type ReportPeriod = 'daily' | 'weekly' | 'monthly' | 'custom';
type ReportSection = 'daily' | 'weekly' | 'monthly' | 'annual' | 'selected';
type GeneratedReportKind = Exclude<ReportSection, 'selected'>;
type ClosingStatus = 'closed' | 'not_closed' | 'partial';
type SaleWithItems = Sale & { sale_items?: SaleItem[] };
type StockMovementWithProduct = StockMovement & { products?: { name: string } | null };
type JsonRecord = Record<string, unknown>;
type ArchiveColumn = { key: string; label: string; money?: boolean; negative?: boolean };

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function archiveRows(archive: AccountReportArchive | undefined, key: string) {
  const value = archive?.report_json?.[key];
  return Array.isArray(value) ? value.filter(isJsonRecord) : [];
}

function archiveQuantityParts(value: unknown) {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^([+-]?\s*\d+(?:\.\d+)?)(?:\s+(.+))?$/);
  if (!match) return { amount: archiveNumber(value), unit: 'unit' };
  return { amount: Number(match[1].replace(/\s/g, '')) || 0, unit: match[2] || 'unit' };
}

function archiveSignedQuantityText(value: number, unit: string | null | undefined) {
  const cleanUnit = unit || 'unit';
  const digits = cleanUnit === 'unit' ? 0 : 2;
  const amount = Number(value || 0);
  return `${amount > 0 ? '+' : ''}${amount.toFixed(digits)} ${cleanUnit}`;
}

function archiveIngredientExceptionRowsFromMovements(rows: JsonRecord[]) {
  const exceptionTypes = new Set(['Waste', 'Stock count', 'Adjustment']);
  const grouped = new Map<string, JsonRecord & { _lastTime?: string }>();

  rows.forEach((row) => {
    const type = archiveText(row.type);
    if (!exceptionTypes.has(type)) return;
    const ingredient = archiveText(row.ingredient);
    const category = archiveText(row.category);
    const { amount, unit } = archiveQuantityParts(row.quantity_change);
    const key = `${type}|${ingredient}|${category}|${unit}`;
    const existing = grouped.get(key);
    const entries = archiveNumber(existing?.entries) + 1;
    const netAmount = archiveNumber(existing?.net_amount) + amount;
    const time = archiveText(row.time);
    const isLatest = !existing?._lastTime || time > existing._lastTime;
    grouped.set(key, {
      type,
      ingredient,
      category,
      entries,
      net_amount: netAmount,
      net_change: archiveSignedQuantityText(netAmount, unit),
      latest_entry: isLatest ? time : existing?.latest_entry,
      entered_by: isLatest ? row.entered_by : existing?.entered_by,
      reason_or_notes: isLatest ? row.reason_or_notes : existing?.reason_or_notes,
      _lastTime: isLatest ? time : existing?._lastTime,
    });
  });

  return Array.from(grouped.values())
    .map(({ _lastTime, net_amount, ...row }) => row)
    .sort((a, b) => archiveText(a.type).localeCompare(archiveText(b.type)) || archiveText(a.ingredient).localeCompare(archiveText(b.ingredient)));
}

function archiveIngredientExceptionRows(archive: AccountReportArchive | undefined) {
  const savedRows = archiveRows(archive, 'ingredient_exception_summary');
  if (savedRows.length > 0) return savedRows;
  return archiveIngredientExceptionRowsFromMovements(archiveRows(archive, 'ingredient_stock_movements'));
}

function archiveNumber(value: unknown) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function archiveSummary(archive: AccountReportArchive | undefined) {
  const summary = isJsonRecord(archive?.report_json?.summary) ? archive.report_json.summary : {};
  return {
    cash: archiveNumber(summary.cash_payment),
    qr: archiveNumber(summary.qr_payment),
    focCost: archiveNumber(summary.foc_cost),
    totalRevenue: archiveNumber(summary.total_revenue),
  };
}

function archiveText(value: unknown) {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

type CategorySalesBreakdown = {
  category: string;
  quantity: number;
  cash: number;
  qr: number;
  focCost: number;
  discount: number;
};

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
  section: ReportSection;
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
  generatedAt?: string;
  archivedFileName?: string;
  archive?: AccountReportArchive;
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

function reportSectionLabel(section: ReportSection) {
  if (section === 'daily') return 'Daily';
  if (section === 'weekly') return 'Weekly';
  if (section === 'monthly') return 'Monthly';
  if (section === 'annual') return 'Annual';
  return 'Selected Period';
}

function dateRangeStrings(first: string, last: string) {
  const dates: string[] = [];
  let current = parseISO(first);
  const end = parseISO(last);
  while (current <= end && dates.length < 370) {
    dates.push(format(current, 'yyyy-MM-dd'));
    current = addDays(current, 1);
  }
  return dates;
}

function generatedAtLabel(report: ReportRow, localMode = false) {
  if (report.generatedAt) return format(parseISO(report.generatedAt), 'dd MMM yyyy, h:mm a');
  return localMode ? 'This-device report' : 'Not generated yet';
}

function compactRange(first: string, last: string) {
  if (first === last) return compactDate(first);
  if (first.slice(0, 4) === last.slice(0, 4)) {
    return `${format(parseISO(first), 'd MMM')} - ${format(parseISO(last), 'd MMM yyyy')}`;
  }
  return `${compactDate(first)} - ${compactDate(last)}`;
}

function reportFileTitle(report: ReportRow) {
  if (report.archive) return archiveDownloadName(report.archive).replace(/\.pdf$/i, '');
  const section = report.section === 'selected' ? 'selected-period' : report.section;
  return reportDownloadName('bar', section, report.fromDate, report.toDate).replace(/\.pdf$/i, '');
}

function reportFileName(report: ReportRow) {
  return `${reportFileTitle(report)}.pdf`;
}

function reportPreviewTitle(report: ReportRow) {
  const range = report.fromDate === report.toDate ? compactDate(report.fromDate) : report.range;
  return `${reportSectionLabel(report.section)} ${report.archive ? 'Operations' : 'Bar'} Report - ${range}`;
}

function archiveKey(section: ReportSection, fromDate: string, toDate: string) {
  return `${section}:${fromDate}:${toDate}`;
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

function saleBusinessDate(sale: Sale, closeTime: SettingsMap[keyof SettingsMap]) {
  return sale.business_date || (sale.created_at ? malaysiaBusinessDateInputValue(sale.created_at, closeTime) : '');
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

function qrStatusLabel(status: string | null | undefined) {
  if (status === 'pending') return 'Pending';
  if (status === 'verified') return 'Verified';
  if (status === 'mismatch') return 'Mismatch';
  return '-';
}

function saleItemName(item: SaleItem) {
  return item.products?.name ?? item.custom_item_name ?? item.product_id ?? 'Custom Order';
}

function movementBusinessDate(movement: StockMovement, closeTime: SettingsMap[keyof SettingsMap]) {
  return malaysiaBusinessDateInputValue(movement.created_at, closeTime);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  return format(new Date(value), 'dd MMM yyyy, h:mm a');
}

function signedUnits(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function stockInputLabel(movement: { unit_input?: string | null; input_quantity?: number | null; quantity_change?: number | null; carton_size_at_time?: number | null }) {
  const quantity = Number(movement.input_quantity ?? Math.abs(Number(movement.quantity_change ?? 0)));
  if (movement.unit_input === 'carton') return `${countLabel(quantity, 'Carton', 'Cartons')} x ${movement.carton_size_at_time ?? '-'} units`;
  return countLabel(quantity, 'Unit', 'Units');
}

function draftEntryInputLabel(entry: { quantity: number; unit: string; carton_size?: number | null }) {
  if (entry.unit === 'carton') return `${countLabel(Number(entry.quantity), 'Carton', 'Cartons')} x ${entry.carton_size ?? '-'}`;
  return countLabel(Number(entry.quantity), 'Unit', 'Units');
}

function movementTypeLabel(type: StockMovement['movement_type']) {
  if (type === 'stock_in') return 'Stock In';
  if (type === 'sale') return 'Sale';
  if (type === 'complimentary') return 'FOC';
  if (type === 'void_sale') return 'Void Sale';
  return 'Adjustment';
}

function stockInDraftStatusLabel(status: StockInDraftRecord['status'] | string) {
  if (status === 'confirmed') return 'Confirmed - Stock Added';
  if (status === 'cancelled') return 'Cancelled';
  return 'Draft Only - Stock Not Added';
}

function receiptStatusLabel(path: string | null | undefined) {
  if (!path) return 'Missing';
  if (path.startsWith('data:')) return 'Attached local photo';
  return `Attached: ${path}`;
}

function saleDateInPeriod(sale: Sale, dates: Set<string>, closeTime: SettingsMap[keyof SettingsMap]) {
  return dates.has(saleBusinessDate(sale, closeTime));
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

function numberFromSnapshot(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== null && value !== undefined && value !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function itemSalesFromReport(report: DailyReport): ItemSalesBreakdown[] | null {
  const json = report.report_json ?? {};
  const rawRows = Array.isArray(json.sales_by_product)
    ? json.sales_by_product
    : Array.isArray(json.itemSales)
      ? json.itemSales
      : null;
  if (!rawRows) return null;
  return rawRows.map((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const product = String(row.product ?? row.name ?? row.item ?? 'Custom Order');
    return {
      product,
      quantity: numberFromSnapshot(row, ['quantity', 'qty']),
      cash: numberFromSnapshot(row, ['cash']),
      qr: numberFromSnapshot(row, ['qr']),
      focCost: numberFromSnapshot(row, ['focCost', 'foc_cost', 'foc']),
      discount: numberFromSnapshot(row, ['discount', 'discount_amount', 'discountGiven']),
    };
  });
}

function mergeItemSales(rows: ItemSalesBreakdown[]) {
  const merged = new Map<string, ItemSalesBreakdown>();
  rows.forEach((row) => {
    const current = merged.get(row.product) ?? { product: row.product, quantity: 0, cash: 0, qr: 0, focCost: 0, discount: 0 };
    current.quantity += row.quantity;
    current.cash += row.cash;
    current.qr += row.qr;
    current.focCost += row.focCost;
    current.discount += row.discount;
    merged.set(row.product, current);
  });
  return Array.from(merged.values()).sort((a, b) => a.product.localeCompare(b.product));
}

function itemSalesForDates(sales: SaleWithItems[], reports: DailyReport[], dates: string[], closeTime: SettingsMap[keyof SettingsMap]) {
  const reportByDate = new Map(reports.filter((report) => report.status === 'closed').map((report) => [report.business_date, report]));
  const snapshotRows: ItemSalesBreakdown[] = [];
  const liveDates: string[] = [];
  dates.forEach((date) => {
    const snapshot = reportByDate.get(date);
    const snapshotItems = snapshot ? itemSalesFromReport(snapshot) : null;
    if (snapshotItems) snapshotRows.push(...snapshotItems);
    else liveDates.push(date);
  });
  return mergeItemSales([...snapshotRows, ...actualItemSales(sales, liveDates, closeTime)]);
}

function categorySalesFromReport(report: DailyReport): CategorySalesBreakdown[] | null {
  const json = report.report_json ?? {};
  if (!Array.isArray(json.sales_by_category)) return null;
  return json.sales_by_category.map((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const category = String(row.category ?? row.name ?? 'Others');
    return {
      category,
      quantity: numberFromSnapshot(row, ['quantity', 'qty']),
      cash: numberFromSnapshot(row, ['cash']),
      qr: numberFromSnapshot(row, ['qr']),
      focCost: numberFromSnapshot(row, ['focCost', 'foc_cost', 'foc']),
      discount: numberFromSnapshot(row, ['discount', 'discount_amount', 'discountGiven']),
    };
  });
}

function mergeCategorySales(rows: CategorySalesBreakdown[]) {
  const merged = new Map<string, CategorySalesBreakdown>();
  rows.forEach((row) => {
    const current = merged.get(row.category) ?? { category: row.category, quantity: 0, cash: 0, qr: 0, focCost: 0, discount: 0 };
    current.quantity += row.quantity;
    current.cash += row.cash;
    current.qr += row.qr;
    current.focCost += row.focCost;
    current.discount += row.discount;
    merged.set(row.category, current);
  });
  return Array.from(merged.values()).sort((a, b) => a.category.localeCompare(b.category));
}

function actualCategorySalesForDates(
  sales: SaleWithItems[],
  products: ProductWithStock[],
  dates: string[],
  closeTime: SettingsMap[keyof SettingsMap],
) {
  const dateSet = new Set(dates);
  const productById = new Map(products.map((product) => [product.id, product]));
  const rows: CategorySalesBreakdown[] = [];

  sales
    .filter((sale) => sale.status === 'completed' && saleDateInPeriod(sale, dateSet, closeTime))
    .forEach((sale) => {
      const items = sale.sale_items ?? [];
      const allocatedValues = allocateReportAmount(Number(sale.total_amount), items.map((item) => Number(item.line_total)));
      const allocatedDiscounts = allocateReportAmount(Number(sale.discount_amount ?? 0), items.map((item) => Number(item.line_total)));
      items.forEach((item, index) => {
        const product = item.product_id ? productById.get(item.product_id) : null;
        const category = product?.categories?.name ?? (item.product_id ? 'Others' : 'Custom Order');
        const value = allocatedValues[index] ?? 0;
        rows.push({
          category,
          quantity: Number(item.quantity),
          cash: sale.payment_method === 'cash' ? value : 0,
          qr: sale.payment_method === 'qr' ? value : 0,
          focCost: sale.payment_method === 'complimentary' ? value : 0,
          discount: allocatedDiscounts[index] ?? 0,
        });
      });
    });

  return mergeCategorySales(rows);
}

function categorySalesForDates(
  sales: SaleWithItems[],
  reports: DailyReport[],
  products: ProductWithStock[],
  dates: string[],
  closeTime: SettingsMap[keyof SettingsMap],
) {
  const reportByDate = new Map(reports.filter((report) => report.status === 'closed').map((report) => [report.business_date, report]));
  const snapshotRows: CategorySalesBreakdown[] = [];
  const liveDates: string[] = [];
  dates.forEach((date) => {
    const snapshot = reportByDate.get(date);
    const snapshotCategories = snapshot ? categorySalesFromReport(snapshot) : null;
    if (snapshotCategories) snapshotRows.push(...snapshotCategories);
    else liveDates.push(date);
  });
  return mergeCategorySales([...snapshotRows, ...actualCategorySalesForDates(sales, products, liveDates, closeTime)]);
}


function buildReportDays(
  reports: DailyReport[],
  sales: Sale[],
  stockMovements: StockMovement[],
  stockInDrafts: StockInDraftRecord[],
  closeTime: SettingsMap[keyof SettingsMap],
): ReportDay[] {
  const reportsByDate = new Map(reports.map((report) => [report.business_date, report]));
  const salesDates = sales.map((sale) => saleBusinessDate(sale, closeTime));
  const movementDates = stockMovements.map((movement) => movementBusinessDate(movement, closeTime));
  const draftDates = stockInDrafts.map((draft) => malaysiaBusinessDateInputValue(draft.created_at, closeTime));
  const allDates = Array.from(new Set([...reports.map((report) => report.business_date), ...salesDates, ...movementDates, ...draftDates]));

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

    const completedSales = sales.filter((sale) => saleBusinessDate(sale, closeTime) === date && sale.status === 'completed');
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

function summarizeReports(days: ReportDay[], period: ReportPeriod | GeneratedReportKind): ReportRow[] {
  if (period === 'daily' || period === 'custom') {
    return days.map((day) => ({
      id: day.id,
      section: period === 'custom' ? 'selected' : 'daily',
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
    const key = period === 'weekly' ? isoWeekKey(day.businessDate) : period === 'monthly' ? day.businessDate.slice(0, 7) : day.businessDate.slice(0, 4);
    groups.set(key, [...(groups.get(key) ?? []), day]);
  });
  return [...groups.entries()].map(([key, rows]) => {
    const sorted = [...rows].sort((a, b) => a.businessDate.localeCompare(b.businessDate));
    const first = sorted[0].businessDate;
    const baseDate = parseISO(first);
    const periodStart = period === 'weekly'
      ? startOfISOWeek(baseDate)
      : period === 'monthly'
        ? parseISO(`${key}-01`)
        : startOfYear(baseDate);
    const periodEnd = period === 'weekly'
      ? endOfISOWeek(baseDate)
      : period === 'monthly'
        ? endOfMonth(periodStart)
        : endOfYear(periodStart);
    const fromDate = format(periodStart, 'yyyy-MM-dd');
    const toDate = format(periodEnd, 'yyyy-MM-dd');
    const label = period === 'weekly' ? `Week ${getISOWeek(baseDate)}` : period === 'monthly' ? monthLabel(key) : `${key} Annual`;
    const closingStatus = sorted.every((day) => day.closingStatus === 'closed')
      ? 'closed'
      : sorted.every((day) => day.closingStatus === 'not_closed')
        ? 'not_closed'
        : 'partial';
    return {
      id: key,
      section: period,
      label,
      range: compactRange(fromDate, toDate),
      fromDate,
      toDate,
      dates: dateRangeStrings(fromDate, toDate),
      businessDate: sorted[sorted.length - 1].businessDate,
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

function ArchiveSnapshotTable({
  title,
  rows,
  columns,
  currency,
  emptyText,
}: {
  title: string;
  rows: JsonRecord[];
  columns: ArchiveColumn[];
  currency: string;
  emptyText: string;
}) {
  const visibleRows = rows.slice(0, 6);
  const fullWidthMobileKeys = new Set(['status', 'items', 'reason_or_notes', 'cancel_reason', 'ingredients_deducted', 'receipt_image_path', 'notes']);
  const wrappedDesktopKeys = new Set(['status', 'items', 'reason_or_notes', 'cancel_reason', 'ingredients_deducted', 'receipt_image_path', 'notes']);
  const cellDisplay = (row: JsonRecord, column: ArchiveColumn) => {
    const value = row[column.key];
    const display = column.money ? money(archiveNumber(value), currency) : archiveText(value);
    return column.negative && column.money ? `- ${display}` : display;
  };

  return (
    <section className="rounded-lg border border-line bg-white/85 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold sm:text-base">{title}</h3>
        <span className="rounded-full bg-shell px-2.5 py-1 text-[0.68rem] font-semibold text-neutral-600">{rows.length} row{rows.length === 1 ? '' : 's'}</span>
      </div>
      <div className="mt-2 grid gap-1.5 sm:hidden">
        {visibleRows.length > 0 ? visibleRows.map((row, index) => {
          const primary = columns[0];
          const secondary = columns[1];
          const details = columns.slice(2);
          return (
            <article key={`${title}-mobile-${index}`} className="rounded-xl border border-line bg-white/85 p-2 text-[11px] leading-tight">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <p className="min-w-0 break-words font-semibold">{primary ? cellDisplay(row, primary) : '-'}</p>
                {secondary ? <p className="min-w-0 break-words text-right font-semibold text-neutral-600">{cellDisplay(row, secondary)}</p> : null}
              </div>
              <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1">
                {details.map((column) => (
                  <div key={column.key} className={`min-w-0 ${fullWidthMobileKeys.has(column.key) ? 'col-span-2' : ''}`}>
                    <span className="block text-[9px] font-semibold uppercase text-neutral-500">{column.label}</span>
                    <span className={`block whitespace-normal break-words font-bold ${column.negative ? 'text-coral' : 'text-ink'}`}>{cellDisplay(row, column)}</span>
                  </div>
                ))}
              </div>
            </article>
          );
        }) : (
          <div className="rounded-xl border border-line bg-white/85 p-3 text-center text-sm font-bold text-neutral-500">{emptyText}</div>
        )}
      </div>
      <div className="clean-scroll mt-2 hidden overflow-x-auto rounded-xl border border-line bg-white/80 sm:block">
        <table className="dense-table w-full min-w-[640px] text-left text-xs">
          <thead className="bg-shell">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className={`p-2 ${wrappedDesktopKeys.has(column.key) ? 'min-w-[9rem] whitespace-normal' : 'whitespace-nowrap'}`}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length > 0 ? visibleRows.map((row, index) => (
              <tr key={`${title}-${index}`} className="border-t border-line">
                {columns.map((column) => {
                  return (
                    <td key={column.key} className={`p-2 align-top ${wrappedDesktopKeys.has(column.key) ? 'min-w-[9rem] whitespace-normal break-words' : 'whitespace-nowrap'} ${column.negative ? 'text-coral font-bold' : ''}`}>
                      {cellDisplay(row, column)}
                    </td>
                  );
                })}
              </tr>
            )) : (
              <tr className="border-t border-line">
                <td className="p-3 text-center font-bold text-neutral-500" colSpan={columns.length}>{emptyText}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > visibleRows.length ? <p className="mt-2 text-xs font-bold text-neutral-600">Showing latest {visibleRows.length} rows. Download PDF for the full saved report.</p> : null}
    </section>
  );
}

export default function DailyReportPage({ settings }: { settings: SettingsMap }) {
  const toast = useToast();
  const { text } = useLanguage();
  const today = malaysiaBusinessDateInputValue(new Date(), settings.business_day_close_time);
  const [reports, setReports] = useState<DailyReport[]>(() => isSupabaseConfigured?[]:loadLocalDailyReports());
  const [sales, setSales] = useState<SaleWithItems[]>(() => {
    if(isSupabaseConfigured)return [];
    const localSaleItems = loadLocalSaleItems();
    return loadLocalSales().map((sale) => ({
      ...sale,
      sale_items: localSaleItems.filter((item) => item.sale_id === sale.id),
    }));
  });
  const [stockMovements, setStockMovements] = useState<StockMovementWithProduct[]>(() => isSupabaseConfigured?[]:loadLocalStockMovements());
  const [stockInDrafts, setStockInDrafts] = useState<StockInDraftRecord[]>(() => isSupabaseConfigured?[]:loadLocalStockInDrafts());
  const [products, setProducts] = useState<ProductWithStock[]>(() => isSupabaseConfigured?[]:loadLocalProducts(true));
  const [sourceError,setSourceError]=useState(''),[sourceLoading,setSourceLoading]=useState(true);
  const sourceGeneration=useRef(0);
  const [cashSessions, setCashSessions] = useState<CashSession[]>([]);
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>('daily');
  const [, setBusinessDate] = useState(today);
  const [reportMonth, setReportMonth] = useState(today.slice(0, 7));
  const [reportMonthTouched, setReportMonthTouched] = useState(false);
  const [customStart, setCustomStart] = useState(today);
  const [customEnd, setCustomEnd] = useState(today);
  const [selectedReportDate, setSelectedReportDate] = useState(today);
  const [selectedReportId, setSelectedReportId] = useState('');
  const [reportSection, setReportSection] = useState<'reports' | 'sales'>('reports');
  const [generatedKind, setGeneratedKind] = useState<GeneratedReportKind>('daily');
  const [reportArchives, setReportArchives] = useState<AccountReportArchive[]>([]);
  const [previewReport, setPreviewReport] = useState<ReportRow | null>(null);
  const [showAllRows, setShowAllRows] = useState(false);
  const [editTarget, setEditTarget] = useState<ReportRow | null>(null);
  const [editPassword, setEditPassword] = useState('');
  const [refreshingGeneratedReports, setRefreshingGeneratedReports] = useState(false);
  const navigate = useNavigate();

  async function loadReports() {
      const generation=++sourceGeneration.current;
      try {
      if (!isSupabaseConfigured) {
        setReportArchives(buildLocalAccountReportArchives(settings));
        setReports(loadLocalDailyReports());
        const localSaleItems = loadLocalSaleItems();
        setSales(loadLocalSales().map((sale) => ({ ...sale, sale_items: localSaleItems.filter((item) => item.sale_id === sale.id) })));
        setStockMovements(loadLocalStockMovements());
        setStockInDrafts(loadLocalStockInDrafts());
        setProducts(loadLocalProducts(true));
        setSourceLoading(false);setSourceError('');
        return;
      }
      const result=await supabase.rpc('read_bar_reporting_source');if(result.error)throw result.error;
      const data=result.data;
      if(!data||['reports','sales','movements','drafts','products','cash_sessions','archives'].some(key=>!Array.isArray(data[key])))throw new Error('Report data is incomplete. Reload before exporting.');
      if(generation!==sourceGeneration.current)return;
      setReports(data.reports);setSales(data.sales);setStockMovements(data.movements);setStockInDrafts(data.drafts);
      setProducts(data.products);setCashSessions(data.cash_sessions);setReportArchives(data.archives);setSourceError('');
      }catch(e){if(generation===sourceGeneration.current)setSourceError((e as Error).message||'Report data could not be loaded.');}
      finally{if(generation===sourceGeneration.current)setSourceLoading(false);}
  }

  useEffect(() => {
    void loadReports();
    return()=>{sourceGeneration.current++;};
  }, [settings]);

  useSharedRefresh(loadReports, {
    tables: ['daily_reports', 'sales', 'sale_items', 'stock_movements', 'stock_in_drafts', 'products', 'inventory_balances', 'cash_sessions', 'account_report_archives'],
    intervalMs: 20000,
  });

  async function refreshGeneratedReportsNow() {
    setRefreshingGeneratedReports(true);
    try {
      if(isSupabaseConfigured){const result=await supabase.rpc('refresh_due_account_report_archives');if(result.error)throw result.error;}
      await loadReports();
    } catch(e) { toast.error((e as Error).message||'Reports could not be refreshed.');
    } finally {
      setRefreshingGeneratedReports(false);
    }
  }

  const reportDays = useMemo(() => buildReportDays(reports, sales, stockMovements, stockInDrafts, settings.business_day_close_time), [reports, sales, settings.business_day_close_time, stockInDrafts, stockMovements]);

  useEffect(() => {
    if (reportMonthTouched || reportDays.length === 0) return;
    if (reportDays.some((day) => day.businessDate.startsWith(reportMonth))) return;
    const latestMonthWithData = [...reportDays].sort((a, b) => b.businessDate.localeCompare(a.businessDate))[0]?.businessDate.slice(0, 7);
    if (latestMonthWithData) setReportMonth(latestMonthWithData);
  }, [reportDays, reportMonth, reportMonthTouched]);

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
    () => itemSalesForDates(sales, reports, activeReport?.dates ?? [], settings.business_day_close_time),
    [activeReport?.dates, reports, sales, settings.business_day_close_time],
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
      discount: sum.discount + item.discount,
      paidSales: sum.paidSales + item.cash + item.qr,
    }),
    { quantity: 0, cash: 0, qr: 0, focCost: 0, discount: 0, paidSales: 0 },
  );

  const selectedPeriodRow = useMemo<ReportRow>(() => {
    const closingStatus: ClosingStatus = reportRows.every((row) => row.closingStatus === 'closed')
      ? 'closed'
      : reportRows.every((row) => row.closingStatus === 'not_closed')
        ? 'not_closed'
        : 'partial';
    return {
      id: `selected-${customStart}-${customEnd}`,
      section: 'selected',
      label: 'Selected period',
      range: compactRange(customStart, customEnd),
      fromDate: customStart,
      toDate: customEnd,
      dates: dateRangeStrings(customStart, customEnd),
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

  const archiveByKey = useMemo(() => {
    return new Map(reportArchives.map((archive) => [archiveKey(archive.report_kind, archive.period_start, archive.period_end), archive]));
  }, [reportArchives]);

  const generatedReportRows = useMemo(() => {
    const pastDays = reportDays.filter((day) => day.businessDate < today);
    const rowsByKind: Record<GeneratedReportKind, ReportRow[]> = {
      daily: summarizeReports(pastDays, 'daily'),
      weekly: summarizeReports(reportDays, 'weekly').filter((row) => row.toDate < today),
      monthly: summarizeReports(reportDays, 'monthly').filter((row) => row.toDate < today),
      annual: summarizeReports(reportDays, 'annual').filter((row) => row.toDate < today),
    };
    const summarizedRows = rowsByKind[generatedKind]
      .sort((a, b) => b.toDate.localeCompare(a.toDate))
      .map((row) => {
        const archive = archiveByKey.get(archiveKey(row.section, row.fromDate, row.toDate));
        return archive ? { ...row, generatedAt: archive.generated_at, archivedFileName: archive.file_name, archive } : row;
      });
    const existingKeys = new Set(summarizedRows.map((row) => archiveKey(row.section, row.fromDate, row.toDate)));
    const archiveOnlyRows = reportArchives
      .filter((archive) => archive.report_kind === generatedKind && archive.period_end < today)
      .filter((archive) => !existingKeys.has(archiveKey(archive.report_kind, archive.period_start, archive.period_end)))
      .map<ReportRow>((archive) => {
        const summary = archiveSummary(archive);
        const closingRows = archiveRows(archive, 'daily_closing');
        const closedDays = closingRows.filter((row) => archiveText(row.status).toLowerCase() === 'closed').length;
        const closingStatus: ClosingStatus = closingRows.length > 0 && closedDays === closingRows.length ? 'closed' : closedDays > 0 ? 'partial' : 'not_closed';
        return {
          id: `archive-${archive.report_kind}-${archive.period_start}-${archive.period_end}`,
          section: archive.report_kind,
          label: reportSectionLabel(archive.report_kind),
          range: compactRange(archive.period_start, archive.period_end),
          fromDate: archive.period_start,
          toDate: archive.period_end,
          dates: dateRangeStrings(archive.period_start, archive.period_end),
          businessDate: archive.period_end,
          cash: summary.cash,
          qr: summary.qr,
          focCost: summary.focCost,
          paidSales: summary.totalRevenue,
          variance: archiveRows(archive, 'daily_closing').reduce((sum, row) => sum + archiveNumber(row.cash_variance), 0),
          closingStatus,
          statusLabel: compactStatusLabel(closingStatus),
          generatedAt: archive.generated_at,
          archivedFileName: archive.file_name,
          archive,
        };
      });
    return [...summarizedRows, ...archiveOnlyRows]
      .sort((a, b) => b.toDate.localeCompare(a.toDate))
      .slice(0, 24);
  }, [archiveByKey, generatedKind, reportArchives, reportDays, today]);

  const previewItemSales = useMemo(
    () => itemSalesForDates(sales, reports, previewReport?.dates ?? [], settings.business_day_close_time),
    [previewReport?.dates, reports, sales, settings.business_day_close_time],
  );

  const previewItemTotals = previewItemSales.reduce(
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

  const previewArchiveSummary = previewReport?.archive ? archiveSummary(previewReport.archive) : null;

  function downloadPdfReport(report?: ReportRow) {
    const selectedReport = report ?? activeReport ?? reportRows.find((row) => row.businessDate === selectedReportDate) ?? reportRows[0];
    if (!selectedReport) {
      toast.error('No report rows to download.');
      return;
    }
    const currency = String(settings.currency_symbol);
    if (selectedReport.archive) {
      downloadArchivePdf(selectedReport.archive, currency, toast);
      return;
    }
    const printable = window.open('', '_blank');
    if (!printable) {
      toast.error('Popup blocked. Allow popups to download/print PDF.');
      return;
    }
    const periodDates = selectedReport.dates.length > 0 ? selectedReport.dates : [selectedReport.businessDate];
    const selectedDates = new Set(periodDates);
    const reportItems = itemSalesForDates(sales, reports, periodDates, settings.business_day_close_time);
    const completedSales = sales.filter((sale) => sale.status === 'completed' && saleDateInPeriod(sale, selectedDates, settings.business_day_close_time));
    const allPeriodSales = sales.filter((sale) => saleDateInPeriod(sale, selectedDates, settings.business_day_close_time));
    const voidedSales = allPeriodSales.filter((sale) => sale.status === 'voided');
    const qrSales = completedSales.filter((sale) => sale.payment_method === 'qr');
    const reportByDate = new Map(reports.map((item) => [item.business_date, item]));
    const cashSessionByDate = new Map(cashSessions.map((item) => [item.business_date, item]));
    const periodMovements = stockMovements.filter((movement) => selectedDates.has(movementBusinessDate(movement, settings.business_day_close_time)));
    const stockInMovements = periodMovements.filter((movement) => movement.movement_type === 'stock_in');
    const stockOutMovements = periodMovements.filter((movement) => movement.movement_type !== 'stock_in');
    const stockInDraftProof = stockInDrafts
      .filter((draft) => selectedDates.has(malaysiaBusinessDateInputValue(draft.created_at, settings.business_day_close_time)))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const stockInDraftPendingCount = stockInDraftProof.filter((draft) => draft.status === 'draft').length;
    const stockInDraftCancelledCount = stockInDraftProof.filter((draft) => draft.status === 'cancelled').length;
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
        discount: sum.discount + item.discount,
        paidSales: sum.paidSales + item.cash + item.qr,
      }),
      { quantity: 0, cash: 0, qr: 0, focCost: 0, discount: 0, paidSales: 0 },
    );

    const productById = new Map(products.map((product) => [product.id, product]));
    const categoryBreakdown = categorySalesForDates(sales, reports, products, periodDates, settings.business_day_close_time);
    const inventoryRows = products.map((product) => {
      const current = Number(product.inventory_balances?.quantity_on_hand ?? 0);
      const productMovements = stockMovements.filter((movement) => movement.product_id === product.id);
      const afterPeriodChange = productMovements
        .filter((movement) => movementBusinessDate(movement, settings.business_day_close_time) > selectedReport.toDate)
        .reduce((sum, movement) => sum + Number(movement.quantity_change), 0);
      const periodProductMovements = productMovements.filter((movement) => selectedDates.has(movementBusinessDate(movement, settings.business_day_close_time)));
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
      const daySales = completedSales.filter((sale) => saleDateInPeriod(sale, new Set([date]), settings.business_day_close_time));
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
      .map((item) => `<tr><td>${htmlEscape(item.product)}</td><td>${item.quantity}</td><td>${money(item.cash, currency)}</td><td>${money(item.qr, currency)}</td><td class="warn">- ${money(item.discount, currency)}</td><td class="bad">${money(item.focCost, currency)}</td><td><strong>${money(item.cash + item.qr, currency)}</strong></td></tr>`)
      .join('');
    const categoryRows = categoryBreakdown
      .map((item) => `<tr><td>${htmlEscape(item.category)}</td><td>${item.quantity}</td><td>${money(item.cash, currency)}</td><td>${money(item.qr, currency)}</td><td class="warn">- ${money(item.discount, currency)}</td><td class="bad">${money(item.focCost, currency)}</td><td><strong>${money(item.cash + item.qr, currency)}</strong></td></tr>`)
      .join('');
    const salesRows = completedSales
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((sale) => `<tr><td>${htmlEscape(saleBusinessDate(sale, settings.business_day_close_time))}</td><td>${htmlEscape(formatDateTime(sale.created_at))}</td><td>${htmlEscape(sale.sale_number)}</td><td>${htmlEscape(sale.order_taken_by ?? '-')}</td><td>${htmlEscape(paymentLabel(sale.payment_method))}</td><td>${htmlEscape(sale.payment_method === 'qr' ? (sale.qr_payment_type ?? '-') : '-')}</td><td>${htmlEscape(sale.payment_method === 'qr' ? qrStatusLabel(sale.qr_status) : '-')}</td><td>${money(Number(sale.discount_amount ?? 0), currency)}</td><td>${money(sale.total_amount, currency)}</td><td>${money(sale.paid_amount, currency)}</td></tr>`)
      .join('');
    const saleItemDetailRows = completedSales
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .flatMap((sale) => {
        const items = sale.sale_items ?? [];
        const discountShares = allocateReportAmount(Number(sale.discount_amount ?? 0), items.map((item) => Number(item.line_total)));
        return items.map((item, index) => {
          const lineTotal = Number(item.line_total);
          const discountShare = discountShares[index] ?? 0;
          const netValue = Math.max(0, lineTotal - discountShare);
          const valueClass = sale.payment_method === 'complimentary' ? 'bad' : '';
          return `<tr><td>${htmlEscape(saleBusinessDate(sale, settings.business_day_close_time))}</td><td>${htmlEscape(formatDateTime(sale.created_at))}</td><td>${htmlEscape(sale.sale_number)}</td><td>${htmlEscape(sale.order_taken_by ?? '-')}</td><td>${htmlEscape(saleItemName(item))}</td><td>${item.quantity}</td><td>${money(item.unit_price, currency)}</td><td>${money(lineTotal, currency)}</td><td class="warn">- ${money(discountShare, currency)}</td><td>${htmlEscape(paymentLabel(sale.payment_method))}</td><td class="${valueClass}">${sale.payment_method === 'complimentary' ? '- ' : ''}${money(netValue, currency)}</td></tr>`;
        });
      })
      .join('');
    const qrRows = qrSales
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((sale) => `<tr><td>${htmlEscape(saleBusinessDate(sale, settings.business_day_close_time))}</td><td>${htmlEscape(formatDateTime(sale.created_at))}</td><td>${htmlEscape(sale.sale_number)}</td><td>${htmlEscape(sale.order_taken_by ?? '-')}</td><td>${htmlEscape(sale.qr_payment_type ?? '-')}</td><td>${htmlEscape(sale.qr_reference ?? '-')}</td><td>${htmlEscape(qrStatusLabel(sale.qr_status))}</td><td>${htmlEscape(receiptStatusLabel(sale.qr_receipt_image_path))}</td><td>${money(sale.paid_amount, currency)}</td></tr>`)
      .join('');
    const closingTableRows = closingRows
      .map((row) => `<tr><td>${htmlEscape(row.date)}</td><td class="${row.status === 'Closed' ? 'good' : 'warn'}">${htmlEscape(row.status)}</td><td>${money(row.openingFloat, currency)}</td><td>${money(row.cash, currency)}</td><td>${money(row.qr, currency)}</td><td class="bad">${money(row.focCost, currency)}</td><td><strong>${money(row.totalRevenue, currency)}</strong></td><td>${row.actualCash === null ? '-' : money(row.actualCash, currency)}</td><td>${row.expectedCash === null ? '-' : money(row.expectedCash, currency)}</td><td>${row.variance === null ? '-' : money(row.variance, currency)}</td><td>${htmlEscape(formatDateTime(row.closedAt))}</td><td>${htmlEscape(row.notes || '-')}</td></tr>`)
      .join('');
    const voidedRows = voidedSales
      .sort((a, b) => (a.voided_at ?? a.created_at).localeCompare(b.voided_at ?? b.created_at))
      .map((sale) => `<tr><td>${htmlEscape(saleBusinessDate(sale, settings.business_day_close_time))}</td><td>${htmlEscape(formatDateTime(sale.created_at))}</td><td>${htmlEscape(sale.sale_number)}</td><td>${htmlEscape(formatDateTime(sale.voided_at ?? sale.created_at))}</td><td>${htmlEscape(sale.order_taken_by ?? '-')}</td><td>${htmlEscape(paymentLabel(sale.payment_method))}</td><td>${money(sale.total_amount, currency)}</td><td>${htmlEscape(sale.void_reason ?? '-')}</td></tr>`)
      .join('');
    const voidedTotal = voidedSales.reduce((sum, sale) => sum + Number(sale.total_amount), 0);
    const stockInRows = stockInMovements
      .map((movement) => `<tr><td>${htmlEscape(movementBusinessDate(movement, settings.business_day_close_time))}</td><td>${htmlEscape(formatDateTime(movement.created_at))}</td><td>${htmlEscape(movement.products?.name ?? (movement.product_id ? productById.get(movement.product_id)?.name : null) ?? '-')}</td><td>${signedUnits(Number(movement.quantity_change))}</td><td>${htmlEscape(stockInputLabel(movement))}</td><td>${htmlEscape(movement.entered_by ?? '-')}</td><td>${htmlEscape(movement.reason ?? '-')}</td><td>${htmlEscape(movement.notes ?? '-')}</td></tr>`)
      .join('');
    const stockInDraftRows = stockInDraftProof
      .map((draft) => {
        const items = draft.entries
          .map((entry) => `${entry.product_name} ${draftEntryInputLabel(entry)}`)
          .join(', ');
        return `<tr><td>${htmlEscape(malaysiaBusinessDateInputValue(draft.created_at, settings.business_day_close_time))}</td><td>${htmlEscape(formatDateTime(draft.created_at))}</td><td>${htmlEscape(draft.draft_number)}</td><td>${htmlEscape(stockInDraftStatusLabel(draft.status))}</td><td>${htmlEscape(draft.entered_by ?? '-')}</td><td>${draft.total_units}</td><td>${htmlEscape(items || '-')}</td><td>${htmlEscape(draft.supplier ?? '-')}</td><td>${htmlEscape(draft.reference ?? '-')}</td><td>${htmlEscape(draft.cancel_reason ?? '-')}</td><td>${htmlEscape(formatDateTime(draft.confirmed_at))}</td><td>${htmlEscape(formatDateTime(draft.cancelled_at))}</td></tr>`;
      })
      .join('');
    const stockOutRows = stockOutMovements
      .map((movement) => `<tr><td>${htmlEscape(movementBusinessDate(movement, settings.business_day_close_time))}</td><td>${htmlEscape(formatDateTime(movement.created_at))}</td><td>${htmlEscape(movement.products?.name ?? (movement.product_id ? productById.get(movement.product_id)?.name : null) ?? '-')}</td><td>${htmlEscape(movementTypeLabel(movement.movement_type))}</td><td>${signedUnits(Number(movement.quantity_change))}</td><td>${htmlEscape(movement.entered_by ?? '-')}</td><td>${htmlEscape(movement.reference_type ?? '-')}</td><td>${htmlEscape(movement.reason ?? movement.notes ?? '-')}</td></tr>`)
      .join('');
    const inventoryTableRows = inventoryRows
      .map((row) => `<tr><td>${htmlEscape(row.product.name)}</td><td>${htmlEscape(row.product.categories?.name ?? 'Others')}</td><td>${row.opening}</td><td>${row.stockIn}</td><td>${row.stockOut}</td><td>${row.voidReturns}</td><td>${signedUnits(row.adjustmentNet)}</td><td><strong>${row.closing}</strong></td><td class="${row.low ? 'bad' : 'good'}">${row.low ? 'Low' : 'OK'}</td></tr>`)
      .join('');
    const lowStockRows = inventoryRows
      .filter((row) => row.low)
      .map((row) => `<tr><td>${htmlEscape(row.product.name)}</td><td>${row.closing}</td><td>${row.product.low_stock_threshold}</td><td>${htmlEscape(row.product.active ? 'Active' : 'Inactive')}</td></tr>`)
      .join('');
    const fileTitle = reportFileTitle(selectedReport);
    printable.document.write(`
      <html><head><title>${htmlEscape(fileTitle)}</title>
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
          <h1>Lovely Paradise Bar ${htmlEscape(reportSectionLabel(selectedReport.section))} Report</h1>
          <div class="muted">${htmlEscape(selectedReport.label)} · ${htmlEscape(selectedReport.range)}</div>
          <div class="muted">${htmlEscape(barReportScope[0])}</div>
        </div>
        <div>
          <strong>Generated:</strong> ${htmlEscape(formatDateTime(new Date().toISOString()))}<br>
          <strong>File name:</strong> ${htmlEscape(reportFileName(selectedReport))}<br>
          <strong>Closing status:</strong> <span class="${selectedReport.closingStatus === 'closed' ? 'good' : 'warn'}">${htmlEscape(selectedReport.statusLabel)}</span>
        </div>
      </div>
      <div class="summary">
        <div class="box">Cash Payment<b>${money(selectedReport.cash, currency)}</b></div>
        <div class="box">QR Payment<b>${money(selectedReport.qr, currency)}</b></div>
        <div class="box">Total Revenue<b>${money(selectedReport.paidSales, currency)}</b></div>
        <div class="box">FOC Value<b class="bad">${money(selectedReport.focCost, currency)}</b></div>
        <div class="box">Discount Given<b>${money(discountTotal, currency)}</b></div>
        <div class="box">Cash Variance<b>${money(selectedReport.variance, currency)}</b></div>
        <div class="box">Transactions<b>${completedSales.length}</b></div>
        <div class="box">Voided Sales<b>${voidedSales.length}</b></div>
        <div class="box">QR Pending<b>${money(qrPendingTotal, currency)}</b></div>
        <div class="box">QR Verified<b>${money(qrVerifiedTotal, currency)}</b></div>
        <div class="box">QR Mismatch<b>${money(qrMismatchTotal, currency)}</b></div>
        <div class="box">Report Dates<b>${periodDates.length}</b></div>
        <div class="box">Stock In Drafts<b>${stockInDraftPendingCount} pending / ${stockInDraftCancelledCount} cancelled</b></div>
      </div>
      <div class="section">
        <h2>Daily Closing</h2>
        ${tableHtml(['Date', 'Status', 'Opening Float', 'Cash Payment', 'QR Payment', 'FOC Value', 'Total Revenue', 'Actual Cash', 'Expected Cash', 'Variance', 'Closed At', 'Notes'], closingTableRows, 'No closing rows for this period.')}
      </div>
      <div class="section">
        <h2>Sales of All Items</h2>
        ${tableHtml(['Item', 'Quantity', 'Cash Payment', 'QR Payment', 'Discount', 'FOC Value', 'Total Revenue'], `${rows}<tr class="total"><td>Total</td><td>${reportItemTotals.quantity}</td><td>${money(reportItemTotals.cash, currency)}</td><td>${money(reportItemTotals.qr, currency)}</td><td class="warn">- ${money(reportItemTotals.discount, currency)}</td><td class="bad">${money(reportItemTotals.focCost, currency)}</td><td>${money(reportItemTotals.paidSales, currency)}</td></tr>`, 'No item sales for this period.')}
      </div>
      <div class="section">
        <h2>Sales by Category</h2>
        ${tableHtml(['Category', 'Quantity', 'Cash Payment', 'QR Payment', 'Discount', 'FOC Value', 'Total Revenue'], `${categoryRows}<tr class="total"><td>Total</td><td>${reportItemTotals.quantity}</td><td>${money(reportItemTotals.cash, currency)}</td><td>${money(reportItemTotals.qr, currency)}</td><td class="warn">- ${money(reportItemTotals.discount, currency)}</td><td class="bad">${money(reportItemTotals.focCost, currency)}</td><td>${money(reportItemTotals.paidSales, currency)}</td></tr>`, 'No category sales for this period.')}
      </div>
      <div class="section">
        <h2>Sales Transactions</h2>
        ${tableHtml(['Business Date', 'Time', 'Sale No.', 'Staff', 'Method', 'QR Type', 'QR Status', 'Discount', 'Sale Value', 'Paid'], salesRows, 'No completed sales for this period.')}
      </div>
      <div class="section">
        <h2>Sale Item Details</h2>
        ${tableHtml(['Business Date', 'Time', 'Sale No.', 'Staff', 'Item', 'Qty', 'Unit Price at Sale', 'Line Total', 'Discount Share', 'Method', 'Paid / FOC Value'], saleItemDetailRows, 'No sale item details for this period.')}
      </div>
      <div class="two">
        <div class="section">
          <h2>QR Payment Verification</h2>
          ${tableHtml(['Business Date', 'Time', 'Sale No.', 'Staff', 'QR Type', 'Reference', 'Status', 'Receipt', 'Amount'], qrRows, 'No QR Payment sales for this period.')}
        </div>
        <div class="section">
          <h2>Voided Sales</h2>
          ${tableHtml(['Business Date', 'Sale Time', 'Sale No.', 'Voided At', 'Staff', 'Method', 'Original Value', 'Reason'], `${voidedRows}${voidedSales.length > 0 ? `<tr class="total"><td colspan="6">Total voided original value</td><td>${money(voidedTotal, currency)}</td><td></td></tr>` : ''}`, 'No voided sales for this period.')}
        </div>
      </div>
      <div class="section">
        <h2>Stock In</h2>
        ${tableHtml(['Business Date', 'Time', 'Product', 'Units Added', 'Input', 'Entered By', 'Reference', 'Notes'], stockInRows, 'No Stock In records for this period.')}
      </div>
      <div class="section">
        <h2>Stock In Draft Proof</h2>
        ${tableHtml(['Business Date', 'Time', 'Draft No.', 'Status', 'Entered By', 'Total Units', 'Items', 'Supplier', 'Reference', 'Cancel Reason', 'Confirmed At', 'Cancelled At'], stockInDraftRows, 'No Stock In draft proof records for this period.')}
      </div>
      <div class="section">
        <h2>Stock Out / Adjustments</h2>
        ${tableHtml(['Business Date', 'Time', 'Product', 'Type', 'Quantity Change (Units)', 'Entered By', 'Reference', 'Reason / Notes'], stockOutRows, 'No Stock Out, void, or adjustment records for this period.')}
      </div>
      <div class="section">
        <h2>Inventory Balance</h2>
        ${tableHtml(['Product', 'Category', 'Opening Units', 'Stock In (Units)', 'Stock Out (Units)', 'Void Return Units', 'Adjustment Units', 'Closing Units', 'Status'], inventoryTableRows, 'No inventory rows available.')}
      </div>
      <div class="section">
        <h2>Low Unit Stock Items</h2>
        ${tableHtml(['Product', 'Closing Balance (Individual Units)', 'Low Alert At (Individual Units)', 'Product Status'], lowStockRows, 'No low unit stock items for this period.')}
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

  async function confirmEditReport() {
    if (!editTarget) return;
    const result = await unlockAdminAccess(editPassword);
    if (!result.ok) {
      toast.error(result.error);
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

  if(sourceLoading||sourceError)return <><PageHeader title={text('Reports','Laporan')}/><p role={sourceError?'alert':'status'} className="my-3 text-sm">{sourceError||text('Loading Reports...','Memuatkan Laporan...')}</p>{sourceError?<button className={secondaryButtonClass} onClick={()=>void loadReports()}>{text('Retry','Cuba Lagi')}</button>:null}</>;

  return (
    <>
      <PageHeader
        title={text('Reports', 'Laporan')}
      />
      <ViewChoices className="mb-4" label={text('Report View', 'Paparan Laporan')} value={reportSection} onChange={value => setReportSection(value as 'reports' | 'sales')} items={[
        { value: 'reports', label: text('Reports Table', 'Jadual Laporan') },
        { value: 'sales', label: text('Sales History', 'Sejarah Jualan') },
      ]} />
      {reportSection === 'sales' ? (
        <SalesHistory settings={settings} embedded />
      ) : (
      <>
      <dl className="bar-metrics">
        {[
          {label: text('Cash Payment', 'Bayaran Tunai'), value: money(periodTotals.cash, String(settings.currency_symbol))},
          {label: text('QR Payment', 'Bayaran QR'), value: money(periodTotals.qr, String(settings.currency_symbol))},
          {label: text('FOC Value', 'Nilai FOC'), value: money(periodTotals.focCost, String(settings.currency_symbol))},
          {label: text('Total Revenue', 'Jumlah Hasil'), value: money(periodTotals.paidSales, String(settings.currency_symbol))},
        ].map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
      </dl>
      <section className="island-panel rounded-lg p-2.5 sm:rounded-xl sm:p-5">
        <h2 className="text-base font-semibold sm:text-xl">{text('Bar Reports', 'Laporan Bar')}</h2>
        <p className="mt-1 text-xs text-muted" data-report-scope="bar">{text(...barReportScope)}</p>
        <div className="mt-2 flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <ViewChoices className="bar-report-periods" label={text('Report Period', 'Tempoh Laporan')} value={reportPeriod} onChange={value => setReportPeriod(value as ReportPeriod)} items={[
            {value: 'daily', label: text('Daily', 'Harian')},
            {value: 'weekly', label: text('Weekly', 'Mingguan')},
            {value: 'monthly', label: text('Monthly', 'Bulanan')},
            {value: 'custom', label: text('Selected', 'Pilihan')},
          ]} />
          <div className="grid w-full min-w-0 gap-2 lg:max-w-[560px] lg:justify-end">
            {reportPeriod === 'daily' ? (
              <input
                className={`${inputClass} lg:w-[240px]`}
                type="month"
                value={reportMonth}
                onChange={(event) => {
                  setReportMonthTouched(true);
                  setReportMonth(event.target.value);
                }}
              />
            ) : null}
            {reportPeriod === 'custom' ? (
              <div className="grid w-full min-w-0 gap-2 lg:grid-cols-[minmax(0,170px)_minmax(0,170px)_auto]">
                <input className={inputClass} type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} />
                <input className={inputClass} type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} />
                <button className={`${secondaryButtonClass} justify-center`} onClick={() => downloadPdfReport(selectedPeriodRow)}>
                  <Download className="h-4 w-4" />
                  {text('Bar PDF', 'PDF Bar')}
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="mt-3 overflow-hidden rounded-lg border border-line bg-white/80 sm:hidden">
          <table className="w-full table-fixed text-left text-[11px]">
            <thead className="bg-shell">
              <tr>
                <th className="w-[44%] p-2">{text('Report dates', 'Tarikh laporan')}</th>
                <th className="w-[31%] p-2 text-right">{text('Total Revenue', 'Jumlah Hasil')}</th>
                <th className="w-[25%] p-2 text-center whitespace-nowrap">{text('Status', 'Status')}</th>
              </tr>
            </thead>
            <tbody>
              {visibleReportRows.map((sample) => (
                <Fragment key={`mobile-${sample.id}`}>
                  <tr
                    className={`cursor-pointer border-t border-line align-top ${activeReport?.id === sample.id ? 'bg-shell' : ''}`}
                    onClick={() => selectReport(sample)}
                  >
                    <td className="p-2 font-semibold">
                      <span className="block truncate tabular-nums">{sample.range}</span>
                      <span className="mt-0.5 block text-[10px] font-bold text-neutral-500">{sample.label}</span>
                    </td>
                    <td className="p-2 text-right font-semibold">{money(sample.paidSales, String(settings.currency_symbol))}</td>
                    <td className="p-2 text-center">
                      <span className={`inline-flex whitespace-nowrap rounded-lg px-1.5 py-0.5 text-[9px] font-semibold ${sample.closingStatus === 'closed' ? 'bg-shell text-accent' : sample.closingStatus === 'partial' ? 'bg-amber-50 text-warning' : 'bg-pink-100 text-coral'}`}>
                        {sample.closingStatus === 'closed' ? text('Closed', 'Tutup') : sample.closingStatus === 'partial' ? text('Partial', 'Sebahagian') : text('Not closed', 'Belum')}
                      </span>
                    </td>
                  </tr>
                  <tr className={`border-t border-line bg-white/70 ${activeReport?.id === sample.id ? 'bg-shell' : ''}`}>
                    <td colSpan={3} className="px-2 pb-2 pt-1">
                      <div className="grid grid-cols-3 gap-1 text-[10px] font-semibold leading-tight">
                        <span className="rounded-lg bg-shell px-1.5 py-1 text-muted">{text('Cash Payment', 'Bayaran Tunai')}<br />{money(sample.cash, String(settings.currency_symbol))}</span>
                        <span className="rounded-lg bg-shell px-1.5 py-1 text-muted">{text('QR Payment', 'Bayaran QR')}<br />{money(sample.qr, String(settings.currency_symbol))}</span>
                        <span className="rounded-lg bg-shell px-1.5 py-1 text-coral">{text('FOC Value', 'Nilai FOC')}<br />{money(sample.focCost, String(settings.currency_symbol))}</span>
                      </div>
                      <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1">
                        <p className="min-w-0 truncate text-[10px] font-bold text-neutral-500">{`${text('Variance', 'Beza')}: ${money(sample.variance, String(settings.currency_symbol))}`}</p>
                        <div className={`grid gap-1 ${sample.dates.length === 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                          {sample.dates.length === 1 ? (
                            <button className={`${secondaryButtonClass} dense-action justify-center`} onClick={(event) => openEditReport(event, sample)}>
                              {text('Edit', 'Edit')}
                            </button>
                          ) : null}
                          <button className={`${secondaryButtonClass} dense-action justify-center`} onClick={(event) => downloadRowPdf(event, sample)}>
                            <Download className="h-3.5 w-3.5" />
                            PDF
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                </Fragment>
              ))}
              {visibleReportRows.length === 0 ? (
                <tr className="border-t border-line">
                  <td className="p-4 text-center text-sm font-bold text-neutral-600" colSpan={3}>{text('No report rows for this filter.', 'Tiada baris laporan untuk tapisan ini.')}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="clean-scroll mt-3 hidden overflow-x-auto rounded-lg border border-line bg-white/75 sm:block sm:rounded-xl">
          <table className="dense-table w-full min-w-[1040px] text-left text-[11px] lg:text-xs">
            <thead className="bg-shell text-[11px] lg:text-xs">
              <tr>
                <th className="w-[12%] px-2 py-2 whitespace-nowrap">{text('Period', 'Tempoh')}</th>
                <th className="w-[14%] px-2 py-2">{text('Dates', 'Tarikh')}</th>
                <th className="w-[10%] px-2 py-2 whitespace-nowrap">{text('Closing', 'Tutup')}</th>
                <th className="w-[11%] px-2 py-2 leading-tight">{text('Cash Payment', 'Bayaran Tunai')}</th>
                <th className="w-[10%] px-2 py-2 leading-tight">{text('QR Payment', 'Bayaran QR')}</th>
                <th className="w-[11%] px-2 py-2 leading-tight">{text('FOC Value', 'Nilai FOC')}</th>
                <th className="w-[12%] px-2 py-2 leading-tight">{text('Total Revenue', 'Jumlah Hasil')}</th>
                <th className="w-[9%] px-2 py-2 whitespace-nowrap">{text('Variance', 'Beza')}</th>
                <th className="w-[11%] px-2 py-2 whitespace-nowrap">{text('Action', 'Tindakan')}</th>
              </tr>
            </thead>
            <tbody>
              {visibleReportRows.map((sample) => (
                <tr
                  key={sample.id}
                  className={`cursor-pointer border-t border-line hover:bg-shell ${activeReport?.id === sample.id ? 'bg-shell' : ''}`}
                  onClick={() => selectReport(sample)}
                >
                  <td className="px-2 py-2 font-semibold whitespace-nowrap tabular-nums">{sample.label}</td>
                  <td className="px-2 py-2 leading-tight tabular-nums">{sample.range}</td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    <span className={`inline-flex rounded-lg px-2 py-0.5 text-[10px] font-semibold ${sample.closingStatus === 'closed' ? 'bg-shell text-accent' : sample.closingStatus === 'partial' ? 'bg-amber-50 text-warning' : 'bg-pink-100 text-coral'}`}>
                      {sample.statusLabel}
                    </span>
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap">{money(sample.cash, String(settings.currency_symbol))}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{money(sample.qr, String(settings.currency_symbol))}</td>
                  <td className="px-2 py-2 whitespace-nowrap text-coral">{money(sample.focCost, String(settings.currency_symbol))}</td>
                  <td className="px-2 py-2 font-semibold whitespace-nowrap">{money(sample.paidSales, String(settings.currency_symbol))}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{money(sample.variance, String(settings.currency_symbol))}</td>
                  <td className="px-2 py-2">
                    <div className="flex gap-1">
                      {sample.dates.length === 1 ? (
                        <button className={`${iconButtonClass} dense-action`} title={text('Edit', 'Edit')} aria-label={text('Edit', 'Edit')} onClick={(event) => openEditReport(event, sample)}>
                          <Pencil className="h-4 w-4" />
                        </button>
                      ) : null}
                      <button className={`${iconButtonClass} dense-action`} title={text('Bar PDF', 'PDF Bar')} aria-label={text('Bar PDF', 'PDF Bar')} onClick={(event) => downloadRowPdf(event, sample)}>
                        <Download className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-bold text-neutral-600">{activeReport ? `${text('Selected', 'Dipilih')}: ${activeReport.label}` : text('Select a row', 'Pilih satu baris')}</p>
          {reportRows.length > 12 ? (
            <button className={secondaryButtonClass} onClick={() => setShowAllRows((value) => !value)}>
              {showAllRows ? text('Show latest 12', 'Tunjuk 12 terkini') : text('View more', 'Lihat lagi')}
            </button>
          ) : null}
        </div>
      </section>
      <section className="island-panel mt-4 rounded-lg p-3 sm:mt-5 sm:rounded-xl sm:p-5">
        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold sm:text-xl">{text('Saved Operations Reports', 'Laporan Operasi Tersimpan')}</h2>
            <p className="mt-1 text-xs text-muted" data-report-scope="operations">{text(...operationsReportScope)}</p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-semibold sm:text-xs">
              <span className="rounded-full bg-shell px-2.5 py-1 text-accent">
                {isSupabaseConfigured ? text('Cloud Auto 00:00 MYT', 'Cloud Auto 00:00 MYT') : text('Device Preview', 'Pratonton Peranti')}
              </span>
              <span className="rounded-full bg-shell px-2.5 py-1 text-neutral-600">
                {countLabel(generatedReportRows.length, text('Row', 'Baris'), text('Rows', 'Baris'))}
              </span>
            </div>
          </div>
          <button
            type="button"
            className={`${secondaryButtonClass} dense-action justify-center`}
            onClick={() => void refreshGeneratedReportsNow()}
            disabled={refreshingGeneratedReports}
          >
            <RefreshCcw className={`h-4 w-4 ${refreshingGeneratedReports ? 'animate-spin' : ''}`} />
            {refreshingGeneratedReports ? text('Refreshing', 'Menyegar') : text('Refresh Reports', 'Segar Laporan')}
          </button>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-1 rounded-lg bg-white/80 p-1 text-xs font-semibold sm:max-w-[560px] sm:text-sm">
          {(['daily', 'weekly', 'monthly', 'annual'] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={`min-h-9 rounded-xl px-1.5 py-1.5 ${generatedKind === item ? 'bg-accent text-white' : ''}`}
              onClick={() => setGeneratedKind(item)}
            >
              {item === 'daily' ? text('Daily', 'Harian') : item === 'weekly' ? text('Weekly', 'Mingguan') : item === 'monthly' ? text('Monthly', 'Bulanan') : text('Annual', 'Tahunan')}
            </button>
          ))}
        </div>
        <div className="mt-3 overflow-hidden rounded-lg border border-line bg-white/80 sm:hidden">
          <table className="dense-table w-full table-fixed text-left text-[11px]">
            <thead className="bg-shell">
              <tr>
                <th className="w-[47%] p-2">{text('Report dates', 'Tarikh laporan')}</th>
                <th className="w-[31%] p-2 text-right">{text('Total Revenue', 'Jumlah Hasil')}</th>
                <th className="w-[22%] p-2 text-center whitespace-nowrap">{text('Status', 'Status')}</th>
              </tr>
            </thead>
            <tbody>
          {generatedReportRows.map((row) => {
            const archiveReady = Boolean(row.archive);
            const generatedStatus = archiveReady
              ? isSupabaseConfigured
                ? text('Saved file', 'Fail disimpan')
                : text('This-device report', 'Laporan peranti ini')
              : isSupabaseConfigured
                ? text('Not generated yet', 'Belum dijana')
                : text('This-device report', 'Laporan peranti ini');
            const generatedStatusClass = archiveReady
              ? isSupabaseConfigured
                ? 'bg-shell text-accent'
                : 'bg-shell text-neutral-600'
              : isSupabaseConfigured
                ? 'bg-amber-50 text-warning'
                : 'bg-shell text-neutral-600';
            return (
              <Fragment key={`generated-mobile-${row.section}-${row.id}`}>
                <tr className="border-t border-line align-top">
                  <td className="p-2 font-semibold">
                    <span className="line-clamp-2 tabular-nums">{row.range}</span>
                    <span className="mt-0.5 block text-[10px] font-bold text-neutral-500">{reportSectionLabel(row.section)}</span>
                  </td>
                  <td className="p-2 text-right font-semibold">{money(row.paidSales, String(settings.currency_symbol))}</td>
                  <td className="p-2 text-center">
                    <span className={`inline-flex whitespace-nowrap rounded-lg px-1.5 py-0.5 text-[9px] font-semibold ${row.closingStatus === 'closed' ? 'bg-shell text-accent' : row.closingStatus === 'partial' ? 'bg-amber-50 text-warning' : 'bg-pink-100 text-coral'}`}>
                      {row.closingStatus === 'closed' ? text('Closed', 'Tutup') : row.closingStatus === 'partial' ? text('Partial', 'Sebahagian') : text('Not closed', 'Belum')}
                    </span>
                  </td>
                </tr>
                <tr className="border-t border-line bg-white/70">
                  <td colSpan={3} className="px-2 pb-2 pt-1">
                    <div className="grid grid-cols-3 gap-1 text-[10px] font-semibold leading-tight">
                      <span className="rounded-lg bg-shell px-1.5 py-1 text-muted">{text('Cash Payment', 'Bayaran Tunai')}<br />{money(row.cash, String(settings.currency_symbol))}</span>
                      <span className="rounded-lg bg-shell px-1.5 py-1 text-muted">{text('QR Payment', 'Bayaran QR')}<br />{money(row.qr, String(settings.currency_symbol))}</span>
                      <span className="rounded-lg bg-shell px-1.5 py-1 text-coral">{text('FOC Value', 'Nilai FOC')}<br />{money(row.focCost, String(settings.currency_symbol))}</span>
                    </div>
                    <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1">
                      <div className="min-w-0">
                        <span className={`inline-flex rounded-lg px-2 py-0.5 text-[10px] font-semibold ${generatedStatusClass}`}>{generatedStatus}</span>
                        <p className="mt-0.5 truncate text-[10px] font-bold text-neutral-500" title={reportFileName(row)}>{reportFileName(row)}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <button className={`${secondaryButtonClass} dense-action justify-center`} onClick={() => setPreviewReport(row)}>{text('View', 'Lihat')}</button>
                        <button className={`${secondaryButtonClass} dense-action justify-center`} onClick={(event) => downloadRowPdf(event, row)}><Download className="h-3.5 w-3.5" />PDF</button>
                      </div>
                    </div>
                  </td>
                </tr>
              </Fragment>
            );
          })}
          {generatedReportRows.length === 0 ? (
            <tr className="border-t border-line">
              <td className="p-4 text-center text-sm font-bold text-neutral-600" colSpan={3}>{text('No generated report is ready for this section yet.', 'Belum ada laporan dijana untuk bahagian ini.')}</td>
            </tr>
          ) : null}
            </tbody>
          </table>
        </div>
        <div className="clean-scroll mt-3 hidden overflow-x-auto rounded-lg border border-line bg-white/75 sm:block sm:rounded-xl">
          <table className="dense-table w-full min-w-[1040px] table-fixed text-left text-[11px] lg:text-xs">
            <thead className="bg-shell text-[11px] lg:text-xs">
              <tr>
                <th className="w-[7%] px-2 py-2 whitespace-nowrap">{text('Section', 'Bahagian')}</th>
                <th className="w-[13%] px-2 py-2">{text('Report Dates', 'Tarikh Laporan')}</th>
                <th className="w-[18%] px-2 py-2">{text('Generated File', 'Fail Dijana')}</th>
                <th className="w-[9%] px-2 py-2 whitespace-nowrap">{text('Closing', 'Tutup')}</th>
                <th className="w-[10%] px-2 py-2 whitespace-nowrap">{text('Cash Payment', 'Bayaran Tunai')}</th>
                <th className="w-[10%] px-2 py-2 whitespace-nowrap">{text('QR Payment', 'Bayaran QR')}</th>
                <th className="w-[10%] px-2 py-2 whitespace-nowrap">{text('FOC Value', 'Nilai FOC')}</th>
                <th className="w-[12%] px-2 py-2 whitespace-nowrap">{text('Total Revenue', 'Jumlah Hasil')}</th>
                <th className="w-[11%] px-2 py-2 whitespace-nowrap">{text('Action', 'Tindakan')}</th>
              </tr>
            </thead>
            <tbody>
              {generatedReportRows.map((row) => {
                const archiveReady = Boolean(row.archive);
                const generatedStatus = archiveReady
                  ? isSupabaseConfigured
                    ? text('Saved file', 'Fail disimpan')
                    : text('This-device report', 'Laporan peranti ini')
                  : isSupabaseConfigured
                    ? text('Not generated yet', 'Belum dijana')
                    : text('This-device report', 'Laporan peranti ini');
                const generatedStatusClass = archiveReady
                  ? isSupabaseConfigured
                    ? 'bg-shell text-accent'
                    : 'bg-shell text-neutral-600'
                  : isSupabaseConfigured
                    ? 'bg-amber-50 text-warning'
                    : 'bg-shell text-neutral-600';
                return (
                  <tr key={`generated-${row.section}-${row.id}`} className="border-t border-line hover:bg-shell">
                    <td className="px-2 py-2 font-semibold whitespace-nowrap">{reportSectionLabel(row.section)}</td>
                    <td className="px-2 py-2 leading-tight tabular-nums">{row.range}</td>
                    <td className="min-w-0 px-2 py-2 tabular-nums">
                      <span className={`inline-flex rounded-lg px-2 py-0.5 text-[10px] font-semibold ${generatedStatusClass}`}>{generatedStatus}</span>
                      <span className="mt-1 block whitespace-nowrap text-xs font-semibold text-neutral-700">{generatedAtLabel(row, !isSupabaseConfigured)}</span>
                      <span className="mt-0.5 block truncate text-[11px] font-bold text-neutral-500" title={reportFileName(row)}>{reportFileName(row)}</span>
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap"><span className={`inline-flex rounded-lg px-2 py-0.5 text-[10px] font-semibold ${row.closingStatus === 'closed' ? 'bg-shell text-accent' : row.closingStatus === 'partial' ? 'bg-amber-50 text-warning' : 'bg-pink-100 text-coral'}`}>{row.statusLabel}</span></td>
                    <td className="px-2 py-2 whitespace-nowrap">{money(row.cash, String(settings.currency_symbol))}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{money(row.qr, String(settings.currency_symbol))}</td>
                    <td className="px-2 py-2 whitespace-nowrap font-bold text-coral">{money(row.focCost, String(settings.currency_symbol))}</td>
                    <td className="px-2 py-2 font-semibold whitespace-nowrap">{money(row.paidSales, String(settings.currency_symbol))}</td>
                    <td className="px-2 py-2">
                      <div className="flex gap-1">
                        <button className={`${iconButtonClass} dense-action`} title={text('Preview', 'Pratonton')} aria-label={text('Preview', 'Pratonton')} onClick={() => setPreviewReport(row)}><Eye className="h-4 w-4" /></button>
                        <button className={`${iconButtonClass} dense-action`} title={archiveReady ? text('Operations PDF', 'PDF Operasi') : text('Bar PDF', 'PDF Bar')} aria-label={archiveReady ? text('Operations PDF', 'PDF Operasi') : text('Bar PDF', 'PDF Bar')} onClick={(event) => downloadRowPdf(event, row)}><Download className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {generatedReportRows.length === 0 ? (
            <div className="border-t border-line p-4 text-center text-sm font-bold text-neutral-600">{text('No generated report is ready for this section yet.', 'Belum ada laporan dijana untuk bahagian ini.')}</div>
          ) : null}
        </div>
      </section>
      <section className="island-panel mt-4 rounded-lg p-3 sm:mt-5 sm:rounded-xl sm:p-5">
        <h2 className="text-lg font-semibold sm:text-xl">{text('Sales of All Items', 'Jualan Semua Item')} · {activeReport ? `${activeReport.label} (${activeReport.range})` : selectedReportDate}</h2>
        <div className="clean-scroll mt-3 overflow-x-auto rounded-lg border border-line bg-white/75 sm:hidden">
          <table className="dense-table w-full min-w-[720px] text-left text-xs">
            <thead className="bg-shell">
              <tr>
                <th className="p-2 whitespace-nowrap">{text('Item', 'Item')}</th>
                <th className="p-2 whitespace-nowrap">{text('Quantity', 'Kuantiti')}</th>
                <th className="p-2 whitespace-nowrap">{text('Cash Payment', 'Bayaran Tunai')}</th>
                <th className="p-2 whitespace-nowrap">{text('QR Payment', 'Bayaran QR')}</th>
                <th className="p-2 whitespace-nowrap">{text('Discount', 'Diskaun')}</th>
                <th className="p-2 whitespace-nowrap">{text('FOC Value', 'Nilai FOC')}</th>
                <th className="p-2 whitespace-nowrap">{text('Total Revenue', 'Jumlah Hasil')}</th>
              </tr>
            </thead>
            <tbody>
              {selectedItemSales.map((item) => (
                <tr key={item.product} className="border-t border-line">
                  <td className="p-2 font-semibold whitespace-nowrap">{item.product}</td>
                  <td className="p-2 whitespace-nowrap">{item.quantity}</td>
                  <td className="p-2 whitespace-nowrap">{money(item.cash, String(settings.currency_symbol))}</td>
                  <td className="p-2 whitespace-nowrap">{money(item.qr, String(settings.currency_symbol))}</td>
                  <td className="p-2 text-warning whitespace-nowrap">- {money(item.discount, String(settings.currency_symbol))}</td>
                  <td className="p-2 text-coral whitespace-nowrap">{money(item.focCost, String(settings.currency_symbol))}</td>
                  <td className="p-2 font-semibold whitespace-nowrap">{money(item.cash + item.qr, String(settings.currency_symbol))}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-ink bg-white/80">
                <td className="p-2 font-semibold">{text('Total', 'Jumlah')}</td>
                <td className="p-2 font-semibold whitespace-nowrap">{itemTotals.quantity}</td>
                <td className="p-2 font-semibold whitespace-nowrap">{money(itemTotals.cash, String(settings.currency_symbol))}</td>
                <td className="p-2 font-semibold whitespace-nowrap">{money(itemTotals.qr, String(settings.currency_symbol))}</td>
                <td className="p-2 font-semibold text-warning whitespace-nowrap">- {money(itemTotals.discount, String(settings.currency_symbol))}</td>
                <td className="p-2 font-semibold text-coral whitespace-nowrap">{money(itemTotals.focCost, String(settings.currency_symbol))}</td>
                <td className="p-2 font-semibold whitespace-nowrap">{money(itemTotals.paidSales, String(settings.currency_symbol))}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="clean-scroll mt-3 hidden overflow-x-auto rounded-lg border border-line bg-white/75 sm:block">
          <table className="dense-table w-full min-w-[760px] text-left text-xs sm:text-sm">
            <thead className="bg-shell text-sm">
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
              {selectedItemSales.map((item) => (
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
      </>
      )}
      {previewReport ? (
        <Modal
          title={reportPreviewTitle(previewReport)}
          onClose={() => setPreviewReport(null)}
          size="wide"
          footer={
            <div className="grid w-full gap-2 sm:flex sm:justify-end">
              <button className={secondaryButtonClass} onClick={() => setPreviewReport(null)}>{text('Close', 'Tutup')}</button>
              <button className={buttonClass} onClick={() => downloadPdfReport(previewReport)}><Download className="h-4 w-4" />{previewReport.archive ? text('Archived PDF', 'PDF arkib') : text('Create PDF', 'Cipta PDF')}</button>
            </div>
          }
        >
          <p className="mb-3 text-xs text-muted">{previewReport.archive ? text(...operationsReportScope) : text(...barReportScope)}</p>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div className="rounded-lg border border-line bg-shell p-3"><p className="text-xs font-semibold text-neutral-600">{text('Section', 'Bahagian')}</p><p className="mt-1 font-semibold">{reportSectionLabel(previewReport.section)}</p></div>
              <div className="rounded-lg border border-line bg-shell p-3"><p className="text-xs font-semibold text-neutral-600">{text('Generated at', 'Dijana pada')}</p><p className="mt-1 font-semibold">{generatedAtLabel(previewReport, !isSupabaseConfigured)}</p></div>
              <div className="rounded-lg border border-line bg-shell p-3"><p className="text-xs font-semibold text-neutral-600">{text('Closing', 'Tutup')}</p><p className="mt-1 font-semibold">{previewReport.statusLabel}</p></div>
              <div className="rounded-lg border border-line bg-shell p-3"><p className="text-xs font-semibold text-neutral-600">{text('File name', 'Nama fail')}</p><p className="mt-1 break-words text-xs font-semibold">{reportFileName(previewReport)}</p></div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div className="rounded-lg border border-line bg-shell p-3"><p className="text-xs font-semibold text-muted">{text('Cash Payment', 'Bayaran Tunai')}</p><p className="mt-1 text-lg font-semibold">{money(previewArchiveSummary?.cash ?? previewReport.cash, String(settings.currency_symbol))}</p></div>
              <div className="rounded-lg border border-line bg-shell p-3"><p className="text-xs font-semibold text-muted">{text('QR Payment', 'Bayaran QR')}</p><p className="mt-1 text-lg font-semibold">{money(previewArchiveSummary?.qr ?? previewReport.qr, String(settings.currency_symbol))}</p></div>
              <div className="rounded-lg border border-line bg-shell p-3"><p className="text-xs font-semibold text-accent">{text('FOC Value', 'Nilai FOC')}</p><p className="mt-1 text-lg font-semibold text-coral">{money(previewArchiveSummary?.focCost ?? previewReport.focCost, String(settings.currency_symbol))}</p></div>
              <div className="rounded-lg border border-line bg-shell p-3"><p className="text-xs font-semibold text-ink">{text('Total Revenue', 'Jumlah Hasil')}</p><p className="mt-1 text-lg font-semibold">{money(previewArchiveSummary?.totalRevenue ?? previewReport.paidSales, String(settings.currency_symbol))}</p></div>
            </div>
            {previewReport.archive ? (
              <>
                <div className="rounded-lg border border-teal-200 bg-shell p-3 text-sm font-bold text-accent">
                  {isSupabaseConfigured
                    ? text('Saved archive snapshot. Preview and PDF use the same saved report data.', 'Snapshot arkib disimpan. Pratonton dan PDF guna data laporan tersimpan yang sama.')
                    : text('This-device report snapshot. Preview and PDF use the same local report data.', 'Snapshot laporan peranti ini. Pratonton dan PDF guna data laporan tempatan yang sama.')}
                </div>
                <ArchiveSnapshotTable
                  title={text('Daily Closing', 'Tutup Harian')}
                  rows={archiveRows(previewReport.archive, 'daily_closing')}
                  currency={String(settings.currency_symbol)}
                  emptyText={text('No daily closing rows in this saved report.', 'Tiada baris tutup harian dalam laporan tersimpan ini.')}
                  columns={[
                    { key: 'business_date', label: text('Date', 'Tarikh') },
                    { key: 'status', label: text('Closing', 'Tutup') },
                    { key: 'cash_payment', label: text('Cash Payment', 'Bayaran Tunai'), money: true },
                    { key: 'qr_payment', label: text('QR Payment', 'Bayaran QR'), money: true },
                    { key: 'foc_cost', label: text('FOC Value', 'Nilai FOC'), money: true },
                    { key: 'total_revenue', label: text('Total Revenue', 'Jumlah Hasil'), money: true },
                  ]}
                />
                <ArchiveSnapshotTable
                  title={text('Sales of All Items', 'Jualan Semua Item')}
                  rows={archiveRows(previewReport.archive, 'item_sales')}
                  currency={String(settings.currency_symbol)}
                  emptyText={text('No item sales in this saved report.', 'Tiada jualan item dalam laporan tersimpan ini.')}
                  columns={[
                    { key: 'item', label: text('Item', 'Item') },
                    { key: 'quantity', label: text('Quantity', 'Kuantiti') },
                    { key: 'cash_payment', label: text('Cash Payment', 'Bayaran Tunai'), money: true },
                    { key: 'qr_payment', label: text('QR Payment', 'Bayaran QR'), money: true },
                    { key: 'foc_cost', label: text('FOC Value', 'Nilai FOC'), money: true },
                    { key: 'total_revenue', label: text('Total Revenue', 'Jumlah Hasil'), money: true },
                  ]}
                />
                <ArchiveSnapshotTable
                  title={text('Stock In', 'Stok Masuk')}
                  rows={archiveRows(previewReport.archive, 'stock_in')}
                  currency={String(settings.currency_symbol)}
                  emptyText={text('No Stock In rows in this saved report.', 'Tiada Stok Masuk dalam laporan tersimpan ini.')}
                  columns={[
                    { key: 'business_date', label: text('Date', 'Tarikh') },
                    { key: 'product', label: text('Product', 'Produk') },
                    { key: 'units_added', label: text('Units Added', 'Unit Masuk') },
                    { key: 'input', label: text('Input', 'Input') },
                    { key: 'entered_by', label: text('Entered By', 'Diisi Oleh') },
                  ]}
                />
                <ArchiveSnapshotTable
                  title={text('Stock In Draft Proof', 'Bukti Draf Stok Masuk')}
                  rows={archiveRows(previewReport.archive, 'stock_in_draft_proof')}
                  currency={String(settings.currency_symbol)}
                  emptyText={text('No Stock In draft proof rows in this saved report.', 'Tiada bukti draf Stok Masuk dalam laporan tersimpan ini.')}
                  columns={[
                    { key: 'business_date', label: text('Date', 'Tarikh') },
                    { key: 'draft_number', label: text('Draft No.', 'No. Draf') },
                    { key: 'status', label: text('Status', 'Status') },
                    { key: 'entered_by', label: text('Entered By', 'Diisi Oleh') },
                    { key: 'total_units', label: text('Total Units', 'Jumlah Unit') },
                    { key: 'items', label: text('Items', 'Item') },
                    { key: 'cancel_reason', label: text('Cancel Reason', 'Sebab Batal') },
                  ]}
                />
                <ArchiveSnapshotTable
                  title={text('Stock Out / Adjustments', 'Stok Keluar / Pelarasan')}
                  rows={archiveRows(previewReport.archive, 'stock_out_adjustments')}
                  currency={String(settings.currency_symbol)}
                  emptyText={text('No Stock Out rows in this saved report.', 'Tiada Stok Keluar dalam laporan tersimpan ini.')}
                  columns={[
                    { key: 'business_date', label: text('Date', 'Tarikh') },
                    { key: 'product', label: text('Product', 'Produk') },
                    { key: 'type', label: text('Type', 'Jenis') },
                    { key: 'quantity_change_units', label: text('Change in units', 'Perubahan unit') },
                    { key: 'entered_by', label: text('Entered By', 'Diisi Oleh') },
                  ]}
                />
                <ArchiveSnapshotTable
                  title={text('Kitchen Pax Count', 'Jumlah Pax Dapur')}
                  rows={archiveRows(previewReport.archive, 'kitchen_pax')}
                  currency={String(settings.currency_symbol)}
                  emptyText={text('No pax rows in this saved report.', 'Tiada baris pax dalam laporan tersimpan ini.')}
                  columns={[
                    { key: 'business_date', label: text('Date', 'Tarikh') },
                    { key: 'pax_count', label: text('Pax count', 'Jumlah pax') },
                    { key: 'entered_by', label: text('Entered By', 'Diisi Oleh') },
                    { key: 'updated_at', label: text('Updated', 'Dikemas kini') },
                  ]}
                />
                <ArchiveSnapshotTable
                  title={text('Kitchen Platter Production', 'Penyediaan Platter Dapur')}
                  rows={archiveRows(previewReport.archive, 'kitchen_production')}
                  currency={String(settings.currency_symbol)}
                  emptyText={text('No kitchen production rows in this saved report.', 'Tiada baris penyediaan dapur dalam laporan tersimpan ini.')}
                  columns={[
                    { key: 'business_date', label: text('Date', 'Tarikh') },
                    { key: 'platter', label: text('Set / platter', 'Set / platter') },
                    { key: 'serving_basis', label: text('Basis', 'Asas') },
                    { key: 'prepared_count', label: text('Prepared', 'Disediakan') },
                    { key: 'submitted_by', label: text('Submitted by', 'Dihantar oleh') },
                    { key: 'ingredients_deducted', label: text('Ingredients deducted', 'Bahan ditolak') },
                  ]}
                />
                <ArchiveSnapshotTable
                  title={text('Ingredient Stock Movements', 'Pergerakan Stok Bahan')}
                  rows={archiveRows(previewReport.archive, 'ingredient_stock_movements')}
                  currency={String(settings.currency_symbol)}
                  emptyText={text('No ingredient movement rows in this saved report.', 'Tiada baris pergerakan bahan dalam laporan tersimpan ini.')}
                  columns={[
                    { key: 'business_date', label: text('Date', 'Tarikh') },
                    { key: 'ingredient', label: text('Ingredient', 'Bahan') },
                    { key: 'category', label: text('Category', 'Kategori') },
                    { key: 'type', label: text('Type', 'Jenis') },
                    { key: 'quantity_change', label: text('Quantity change', 'Perubahan kuantiti') },
                    { key: 'balance_after', label: text('Balance after', 'Baki selepas') },
                    { key: 'entered_by', label: text('Entered By', 'Diisi Oleh') },
                  ]}
                />
                <ArchiveSnapshotTable
                  title={text('Ingredient Stock Exceptions', 'Pengecualian Stok Bahan')}
                  rows={archiveIngredientExceptionRows(previewReport.archive)}
                  currency={String(settings.currency_symbol)}
                  emptyText={text('No count, waste, missing, or correction rows in this saved report.', 'Tiada baris kiraan, rosak, hilang, atau pembetulan dalam laporan tersimpan ini.')}
                  columns={[
                    { key: 'type', label: text('Type', 'Jenis') },
                    { key: 'ingredient', label: text('Ingredient', 'Bahan') },
                    { key: 'category', label: text('Category', 'Kategori') },
                    { key: 'entries', label: text('Entries', 'Rekod') },
                    { key: 'net_change', label: text('Net change', 'Perubahan bersih') },
                    { key: 'latest_entry', label: text('Latest entry', 'Rekod terbaru') },
                    { key: 'entered_by', label: text('Entered By', 'Diisi Oleh') },
                    { key: 'reason_or_notes', label: text('Latest reason / notes', 'Sebab / nota terbaru') },
                  ]}
                />
                <ArchiveSnapshotTable
                  title={text('Ingredient Inventory Balance', 'Baki Inventori Bahan')}
                  rows={archiveRows(previewReport.archive, 'ingredient_inventory_balance')}
                  currency={String(settings.currency_symbol)}
                  emptyText={text('No ingredient balance rows in this saved report.', 'Tiada baris baki bahan dalam laporan tersimpan ini.')}
                  columns={[
                    { key: 'ingredient', label: text('Ingredient', 'Bahan') },
                    { key: 'category', label: text('Category', 'Kategori') },
                    { key: 'opening_quantity', label: text('Opening', 'Awal') },
                    { key: 'stock_in', label: text('Stock in', 'Stok masuk') },
                    { key: 'cocktail_usage', label: text('Cocktail usage', 'Gunaan cocktail') },
                    { key: 'kitchen_usage', label: text('Kitchen usage', 'Gunaan dapur') },
                    { key: 'closing_quantity', label: text('Closing', 'Akhir') },
                    { key: 'status', label: text('Status', 'Status') },
                  ]}
                />
                <ArchiveSnapshotTable
                  title={text('Low Ingredient Stock', 'Stok Bahan Rendah')}
                  rows={archiveRows(previewReport.archive, 'low_ingredient_stock')}
                  currency={String(settings.currency_symbol)}
                  emptyText={text('No low ingredient stock rows in this saved report.', 'Tiada baris stok bahan rendah dalam laporan tersimpan ini.')}
                  columns={[
                    { key: 'ingredient', label: text('Ingredient', 'Bahan') },
                    { key: 'category', label: text('Category', 'Kategori') },
                    { key: 'closing_quantity', label: text('Closing', 'Akhir') },
                    { key: 'low_alert_at', label: text('Low alert at (base unit)', 'Amaran rendah pada unit asas') },
                    { key: 'status', label: text('Status', 'Status') },
                  ]}
                />
              </>
            ) : (
              <>
              <div className="grid gap-2 sm:hidden">
                {previewItemSales.map((item) => (
                  <article key={`mobile-preview-${item.product}`} className="rounded-lg border border-line bg-white/85 p-3 shadow-none">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{item.product}</p>
                        <p className="mt-0.5 text-xs font-bold text-neutral-600">{text('Quantity', 'Kuantiti')} {item.quantity}</p>
                      </div>
                      <p className="text-sm font-semibold">{money(item.cash + item.qr, String(settings.currency_symbol))}</p>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-1.5 text-[10px] font-bold">
                      <div className="rounded-xl bg-shell p-2 text-muted"><p>{text('Cash Payment', 'Bayaran Tunai')}</p><p>{money(item.cash, String(settings.currency_symbol))}</p></div>
                      <div className="rounded-xl bg-shell p-2 text-muted"><p>{text('QR Payment', 'Bayaran QR')}</p><p>{money(item.qr, String(settings.currency_symbol))}</p></div>
                      <div className="rounded-xl bg-shell p-2 text-coral"><p>{text('FOC Value', 'Nilai FOC')}</p><p>{money(item.focCost, String(settings.currency_symbol))}</p></div>
                    </div>
                  </article>
                ))}
                <article className="rounded-lg border border-ink bg-white/90 p-3 shadow-none">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold">{text('Total', 'Jumlah')}</p>
                    <p className="font-semibold">{money(previewItemTotals.paidSales, String(settings.currency_symbol))}</p>
                  </div>
                  <p className="mt-1 text-xs font-bold text-neutral-600">{countLabel(previewItemTotals.quantity, text('Unit', 'Unit'), text('Units', 'Unit'))}</p>
                </article>
              </div>
              <div className="clean-scroll hidden overflow-x-auto rounded-lg border border-line bg-white/80 sm:block">
                <table className="dense-table w-full min-w-[720px] text-left text-xs sm:text-sm">
                  <thead className="bg-shell">
                    <tr>
                      <th className="p-3 whitespace-nowrap">{text('Item', 'Item')}</th>
                      <th className="p-3 whitespace-nowrap">{text('Quantity', 'Kuantiti')}</th>
                      <th className="p-3 whitespace-nowrap">{text('Cash Payment', 'Bayaran Tunai')}</th>
                      <th className="p-3 whitespace-nowrap">{text('QR Payment', 'Bayaran QR')}</th>
                      <th className="p-3 whitespace-nowrap">{text('FOC Value', 'Nilai FOC')}</th>
                      <th className="p-3 whitespace-nowrap">{text('Total Revenue', 'Jumlah Hasil')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewItemSales.map((item) => (
                      <tr key={`preview-${item.product}`} className="border-t border-line">
                        <td className="p-3 font-semibold">{item.product}</td>
                        <td className="p-3 whitespace-nowrap">{item.quantity}</td>
                        <td className="p-3 whitespace-nowrap">{money(item.cash, String(settings.currency_symbol))}</td>
                        <td className="p-3 whitespace-nowrap">{money(item.qr, String(settings.currency_symbol))}</td>
                        <td className="p-3 whitespace-nowrap text-coral">{money(item.focCost, String(settings.currency_symbol))}</td>
                        <td className="p-3 font-semibold whitespace-nowrap">{money(item.cash + item.qr, String(settings.currency_symbol))}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-ink bg-white">
                      <td className="p-3 font-semibold">{text('Total', 'Jumlah')}</td>
                      <td className="p-3 font-semibold whitespace-nowrap">{previewItemTotals.quantity}</td>
                      <td className="p-3 font-semibold whitespace-nowrap">{money(previewItemTotals.cash, String(settings.currency_symbol))}</td>
                      <td className="p-3 font-semibold whitespace-nowrap">{money(previewItemTotals.qr, String(settings.currency_symbol))}</td>
                      <td className="p-3 font-semibold whitespace-nowrap text-coral">{money(previewItemTotals.focCost, String(settings.currency_symbol))}</td>
                      <td className="p-3 font-semibold whitespace-nowrap">{money(previewItemTotals.paidSales, String(settings.currency_symbol))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              </>
            )}
          </div>
        </Modal>
      ) : null}
      {reportSection === 'reports' && editTarget ? (
        <Modal
          title={`${text('Edit report', 'Edit laporan')} - ${editTarget.label}`}
          onClose={() => setEditTarget(null)}
          footer={
            <div className="grid w-full gap-2 sm:flex sm:justify-end">
              <button className={secondaryButtonClass} onClick={() => setEditTarget(null)}>{text('Cancel', 'Batal')}</button>
              <button className={buttonClass} disabled={!editPassword} onClick={() => void confirmEditReport()}>{text('Unlock edit', 'Buka edit')}</button>
            </div>
          }
        >
          <div className="grid gap-3">
            <p className="text-sm font-bold text-neutral-700">{text('Enter admin password to edit this report date.', 'Masukkan kata laluan admin untuk edit tarikh laporan ini.')}</p>
            <input className={inputClass} type="password" value={editPassword} onChange={(event) => setEditPassword(event.target.value)} placeholder={text('Admin password', 'Kata laluan admin')} />
          </div>
        </Modal>
      ) : null}
    </>
  );
}
