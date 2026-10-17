import { Fragment, useEffect, useMemo, useState } from 'react';
import { addDays, endOfMonth, endOfWeek, format, parseISO, startOfMonth, startOfWeek } from 'date-fns';
import { Download, Eye, RefreshCcw } from 'lucide-react';
import { buttonClass, secondaryButtonClass } from './Form';
import { Modal } from './Modal';
import { useToast } from './Toast';
import { loadLocalDailyReports, loadLocalIngredientItems, loadLocalIngredientMovements, loadLocalKitchenPax, loadLocalKitchenProductionReports, loadLocalProducts, loadLocalSaleItems, loadLocalSales, loadLocalStockInDrafts, loadLocalStockMovements } from '../lib/localStore';
import { malaysiaBusinessDateInputValue, money } from '../lib/format';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type { AccountReportArchive, DailyReport, IngredientMovement, IngredientWithBalance, KitchenDailyPax, KitchenProductionReport, Sale, SaleItem, SettingsMap, StockInDraftRecord } from '../lib/types';
import { useLanguage } from '../lib/language';
import { actualItemSales } from '../lib/reportItems';
import { useSharedRefresh } from '../lib/useSharedRefresh';
import { db as previewDb } from '../lib/demoBackend';
import { archiveDownloadName, operationsReportScope, reportDownloadName } from '../lib/reportScope';

type ReportKind = AccountReportArchive['report_kind'];
type JsonRecord = Record<string, unknown>;
type SaleWithItems = Sale & { sale_items?: SaleItem[] };

type TableColumn = {
  key: string;
  label: string;
  money?: boolean;
  negative?: boolean;
  dateTime?: boolean;
};

const reportKinds: ReportKind[] = ['daily', 'weekly', 'monthly', 'annual'];

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function recordValue(record: JsonRecord, key: string) {
  return record[key];
}

function numberValue(value: unknown) {
  const next = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0;
  return Number.isFinite(next) ? next : 0;
}

function textValue(value: unknown) {
  if (value == null || value === '') return '-';
  return String(value);
}

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function stockInputLabel(movement: { unit_input?: string | null; input_quantity?: number | null; quantity_change?: number | null }) {
  const quantity = Number(movement.input_quantity ?? Math.abs(Number(movement.quantity_change ?? 0)));
  if (movement.unit_input === 'carton') return countLabel(quantity, 'Carton', 'Cartons');
  return countLabel(quantity, 'Unit', 'Units');
}

function draftEntryInputLabel(entry: { quantity: number; unit: string; carton_size?: number | null }) {
  if (entry.unit === 'carton') return `${countLabel(Number(entry.quantity), 'Carton', 'Cartons')} x ${entry.carton_size ?? '-'}`;
  return countLabel(Number(entry.quantity), 'Unit', 'Units');
}

function htmlEscape(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeDate(value: string) {
  try {
    return format(parseISO(value), 'd MMM yyyy');
  } catch {
    return value;
  }
}

function safeDateTime(value: unknown) {
  if (!value) return '-';
  try {
    return format(new Date(String(value)), 'dd MMM yyyy, h:mm a');
  } catch {
    return String(value);
  }
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

function paymentMethodLabel(method: string) {
  if (method === 'cash') return 'Cash Payment';
  if (method === 'qr') return 'QR Payment';
  if (method === 'complimentary') return 'FOC';
  return method || '-';
}

function qrStatusLabel(status: string | null | undefined) {
  if (status === 'pending') return 'Pending';
  if (status === 'verified') return 'Verified';
  if (status === 'mismatch') return 'Mismatch';
  if (status === 'not_applicable') return 'Not applicable';
  return status || '-';
}

function stockMovementTypeLabel(type: string) {
  if (type === 'sale') return 'Stock out';
  if (type === 'complimentary') return 'FOC';
  if (type === 'void_sale') return 'Void sale';
  if (type === 'adjustment') return 'Adjustment';
  if (type === 'stock_in') return 'Stock in';
  return type.replace(/_/g, ' ') || '-';
}

function ingredientMovementTypeLabel(type: string) {
  if (type === 'stock_in') return 'Ingredient stock in';
  if (type === 'sale') return 'Cocktail sale usage';
  if (type === 'complimentary') return 'FOC cocktail usage';
  if (type === 'void_sale') return 'Void return';
  if (type === 'kitchen_production') return 'Kitchen production';
  if (type === 'waste') return 'Waste';
  if (type === 'count') return 'Stock count';
  if (type === 'adjustment') return 'Adjustment';
  return type.replace(/_/g, ' ') || '-';
}

function stockInDraftStatusLabel(status: StockInDraftRecord['status'] | string) {
  if (status === 'confirmed') return 'Confirmed - Stock Added';
  if (status === 'cancelled') return 'Cancelled';
  return 'Draft Only - Stock Not Added';
}

function ingredientBalanceValue(item: IngredientWithBalance) {
  const balance = item.ingredient_balances;
  if (Array.isArray(balance)) return Number(balance[0]?.quantity_on_hand ?? 0);
  return Number(balance?.quantity_on_hand ?? 0);
}

function quantityText(value: number, unit: string | null | undefined) {
  const cleanUnit = unit || 'unit';
  const digits = cleanUnit === 'unit' ? 0 : 2;
  return `${Number(value || 0).toFixed(digits)} ${cleanUnit}`;
}

function signedQuantityText(value: number, unit: string | null | undefined) {
  const cleanUnit = unit || 'unit';
  const digits = cleanUnit === 'unit' ? 0 : 2;
  const amount = Number(value || 0);
  const prefix = amount > 0 ? '+' : '';
  return `${prefix}${amount.toFixed(digits)} ${cleanUnit}`;
}

function quantityParts(value: unknown) {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^([+-]?\s*\d+(?:\.\d+)?)(?:\s+(.+))?$/);
  if (!match) return { amount: numberValue(value), unit: 'unit' };
  return { amount: Number(match[1].replace(/\s/g, '')) || 0, unit: match[2] || 'unit' };
}

function ingredientExceptionRowsFromMovements(rows: JsonRecord[]) {
  const exceptionTypes = new Set(['Waste', 'Stock count', 'Adjustment']);
  const grouped = new Map<string, JsonRecord & { _lastTime?: string }>();

  rows.forEach((row) => {
    const type = textValue(row.type);
    if (!exceptionTypes.has(type)) return;
    const ingredient = textValue(row.ingredient);
    const category = textValue(row.category);
    const { amount, unit } = quantityParts(row.quantity_change);
    const key = `${type}|${ingredient}|${category}|${unit}`;
    const existing = grouped.get(key);
    const entries = numberValue(existing?.entries) + 1;
    const netAmount = numberValue(existing?.net_amount) + amount;
    const time = textValue(row.time);
    const isLatest = !existing?._lastTime || time > existing._lastTime;
    grouped.set(key, {
      type,
      ingredient,
      category,
      entries,
      net_amount: netAmount,
      net_change: signedQuantityText(netAmount, unit),
      latest_entry: isLatest ? time : existing?.latest_entry,
      entered_by: isLatest ? row.entered_by : existing?.entered_by,
      reason_or_notes: isLatest ? row.reason_or_notes : existing?.reason_or_notes,
      _lastTime: isLatest ? time : existing?._lastTime,
    });
  });

  return Array.from(grouped.values())
    .map(({ _lastTime, net_amount, ...row }) => row)
    .sort((a, b) => textValue(a.type).localeCompare(textValue(b.type)) || textValue(a.ingredient).localeCompare(textValue(b.ingredient)));
}

function ingredientExceptionRows(report: AccountReportArchive) {
  const savedRows = rowsOf(report, 'ingredient_exception_summary');
  if (savedRows.length > 0) return savedRows;
  return ingredientExceptionRowsFromMovements(rowsOf(report, 'ingredient_stock_movements'));
}

function kindLabel(kind: ReportKind) {
  if (kind === 'daily') return 'Daily';
  if (kind === 'weekly') return 'Weekly';
  if (kind === 'monthly') return 'Monthly';
  return 'Annual';
}

function periodLabel(report: AccountReportArchive) {
  if (report.period_start === report.period_end) return safeDate(report.period_start);
  return `${safeDate(report.period_start)} - ${safeDate(report.period_end)}`;
}

function summaryOf(report: AccountReportArchive) {
  const summary = isRecord(report.report_json.summary) ? report.report_json.summary : {};
  return {
    cash: numberValue(summary.cash_payment),
    qr: numberValue(summary.qr_payment),
    focCost: numberValue(summary.foc_cost),
    totalRevenue: numberValue(summary.total_revenue),
    discount: numberValue(summary.discount_given),
    transactions: numberValue(summary.transactions),
    voidedSales: numberValue(summary.voided_sales),
    qrPending: numberValue(summary.qr_pending),
    qrVerified: numberValue(summary.qr_verified),
    qrMismatch: numberValue(summary.qr_mismatch),
    kitchenPax: numberValue(summary.kitchen_pax),
    kitchenPlatters: numberValue(summary.kitchen_platters),
    ingredientUsageLines: numberValue(summary.ingredient_usage_lines),
    ingredientStockCounts: numberValue(summary.ingredient_stock_counts) || ingredientExceptionRows(report).filter((row) => textValue(row.type) === 'Stock count').reduce((sum, row) => sum + numberValue(row.entries), 0),
    ingredientWasteMissing: numberValue(summary.ingredient_waste_missing) || ingredientExceptionRows(report).filter((row) => textValue(row.type) === 'Waste').reduce((sum, row) => sum + numberValue(row.entries), 0),
    ingredientCorrections: numberValue(summary.ingredient_corrections) || ingredientExceptionRows(report).filter((row) => textValue(row.type) === 'Adjustment').reduce((sum, row) => sum + numberValue(row.entries), 0),
    stockInDraftsPending: numberValue(summary.stock_in_drafts_pending),
    stockInDraftsCancelled: numberValue(summary.stock_in_drafts_cancelled),
    stockInDraftsConfirmed: numberValue(summary.stock_in_drafts_confirmed),
  };
}

function rowsOf(report: AccountReportArchive, key: string) {
  const value = report.report_json[key];
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

type ArchiveClosingStatus = 'closed' | 'partial' | 'not_closed';

function closingOf(report: AccountReportArchive) {
  const rows = rowsOf(report, 'daily_closing');
  const totalDays = rows.length;
  const closedDays = rows.filter((row) => textValue(row.status).toLowerCase() === 'closed').length;
  const unclosedDays = Math.max(0, totalDays - closedDays);
  const status: ArchiveClosingStatus = totalDays > 0 && closedDays === totalDays ? 'closed' : closedDays > 0 ? 'partial' : 'not_closed';
  return { status, totalDays, closedDays, unclosedDays };
}

function closingEnglishLabel(status: ArchiveClosingStatus) {
  if (status === 'closed') return 'Closed';
  if (status === 'partial') return 'Has unclosed days';
  return 'Not closed';
}

function cellText(row: JsonRecord, column: TableColumn, currency: string) {
  const value = recordValue(row, column.key);
  if (column.money) {
    const formatted = money(numberValue(value), currency);
    return column.negative ? `- ${formatted}` : formatted;
  }
  if (column.dateTime) return safeDateTime(value);
  return textValue(value);
}

function htmlTable(title: string, rows: JsonRecord[], columns: TableColumn[], currency: string, emptyText = 'No records.') {
  const body = rows.length > 0
    ? rows.map((row) => `<tr>${columns.map((column) => `<td class="${column.negative ? 'bad' : ''}">${htmlEscape(cellText(row, column, currency))}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${columns.length}" class="empty">${htmlEscape(emptyText)}</td></tr>`;
  return `<section><h2>${htmlEscape(title)}</h2><table><thead><tr>${columns.map((column) => `<th>${htmlEscape(column.label)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></section>`;
}

function PreviewTable({
  title,
  rows,
  columns,
  currency,
  emptyText = 'No records.',
  maxRows = 6,
}: {
  title: string;
  rows: JsonRecord[];
  columns: TableColumn[];
  currency: string;
  emptyText?: string;
  maxRows?: number;
}) {
  const visibleRows = rows.slice(0, maxRows);
  const fullWidthMobileKeys = new Set(['status', 'items', 'reason_or_notes', 'cancel_reason', 'ingredients_deducted', 'receipt_image_path', 'notes']);
  const wrappedDesktopKeys = new Set(['status', 'items', 'reason_or_notes', 'cancel_reason', 'ingredients_deducted', 'receipt_image_path', 'notes']);
  return (
    <section className="rounded-2xl border border-line bg-white/85 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-black sm:text-base">{title}</h3>
        <span className="rounded-full bg-shell px-2.5 py-1 text-[0.68rem] font-black text-neutral-600">
          {rows.length} row{rows.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="mt-2 grid gap-1.5 sm:hidden">
        {visibleRows.length > 0 ? visibleRows.map((row, index) => {
          const primary = columns[0];
          const secondary = columns[1];
          const details = columns.slice(2);
          return (
            <article key={`${title}-mobile-${index}`} className="rounded-xl border border-line bg-white/85 p-2 text-[11px] leading-tight">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <p className="min-w-0 break-words font-black">{primary ? cellText(row, primary, currency) : '-'}</p>
                {secondary ? <p className="min-w-0 break-words text-right font-black text-neutral-600">{cellText(row, secondary, currency)}</p> : null}
              </div>
              <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1">
                {details.map((column) => (
                  <div key={column.key} className={`min-w-0 ${fullWidthMobileKeys.has(column.key) ? 'col-span-2' : ''}`}>
                    <span className="block text-[9px] font-black uppercase text-neutral-500">{column.label}</span>
                    <span className={`block whitespace-normal break-words font-bold ${column.negative ? 'text-coral' : 'text-ink'}`}>{cellText(row, column, currency)}</span>
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
          <thead className="bg-paper">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className={`p-2 ${wrappedDesktopKeys.has(column.key) ? 'min-w-[9rem] whitespace-normal' : 'whitespace-nowrap'}`}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length > 0 ? visibleRows.map((row, index) => (
              <tr key={`${title}-${index}`} className="border-t border-line">
                {columns.map((column) => (
                  <td key={column.key} className={`p-2 align-top ${wrappedDesktopKeys.has(column.key) ? 'min-w-[9rem] whitespace-normal break-words' : 'whitespace-nowrap'} ${column.negative ? 'text-coral font-bold' : ''}`}>
                    {cellText(row, column, currency)}
                  </td>
                ))}
              </tr>
            )) : (
              <tr className="border-t border-line">
                <td className="p-3 text-center font-bold text-neutral-500" colSpan={columns.length}>{emptyText}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > maxRows ? (
        <p className="mt-2 text-xs font-bold text-neutral-600">Showing latest {maxRows} rows. Download PDF for the full report.</p>
      ) : null}
    </section>
  );
}

function allocateAmount(total: number, weights: number[]) {
  const cents = Math.round(total * 100);
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const fallbackWeight = weightTotal > 0 ? 0 : 1 / Math.max(weights.length, 1);
  let used = 0;
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return (cents - used) / 100;
    const share = weightTotal > 0 ? weight / weightTotal : fallbackWeight;
    const value = Math.round(cents * share);
    used += value;
    return value / 100;
  });
}

function archiveFileName(kind: ReportKind, startDate: string, endDate: string) {
  return reportDownloadName('operations', kind, startDate, endDate);
}

export function localArchives(settings: SettingsMap): AccountReportArchive[] {
  const saleItems = loadLocalSaleItems();
  const sales = loadLocalSales();
  const reports = loadLocalDailyReports();
  const movements = loadLocalStockMovements();
  const ingredientMovements = loadLocalIngredientMovements();
  const stockInDrafts = loadLocalStockInDrafts();
  const ingredients = loadLocalIngredientItems(true);
  const kitchenPaxRows = loadLocalKitchenPax();
  const kitchenReports = loadLocalKitchenProductionReports();
  const products = loadLocalProducts(true);
  const productById = new Map(products.map((product) => [product.id, product]));
  const ingredientById = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
  const closeTime = settings.business_day_close_time;

  function buildArchive(kind: ReportKind, startDate: string, endDate: string, datesInPeriod: string[]): AccountReportArchive {
    const dates = [...datesInPeriod].sort();
    const dateSet = new Set(dates);
    const reportsInPeriod = reports.filter((report) => dateSet.has(report.business_date));
    const salesForPeriod: SaleWithItems[] = sales
      .filter((sale) => dateSet.has(sale.business_date))
      .map((sale) => ({ ...sale, sale_items: saleItems.filter((item) => item.sale_id === sale.id) }));
    const completedSales = salesForPeriod.filter((sale) => sale.status === 'completed');
    const itemSales = actualItemSales(salesForPeriod, dates, closeTime).map((item) => ({
      item: item.product,
      quantity: item.quantity,
      cash_payment: item.cash,
      qr_payment: item.qr,
      discount: item.discount,
      foc_cost: item.focCost,
      total_revenue: item.cash + item.qr,
    }));

    const categoryMap = new Map<string, { category: string; quantity: number; cash_payment: number; qr_payment: number; discount: number; foc_cost: number; total_revenue: number }>();
    const saleItemDetails: JsonRecord[] = [];
    completedSales.forEach((sale) => {
      const items = sale.sale_items ?? [];
      const weights = items.map((item) => Number(item.line_total));
      const netValues = allocateAmount(Number(sale.total_amount), weights);
      const discounts = allocateAmount(Number(sale.discount_amount ?? 0), weights);
      items.forEach((item, index) => {
        const product = item.product_id ? productById.get(item.product_id) : null;
        const itemName = item.products?.name ?? item.custom_item_name ?? product?.name ?? 'Custom Order';
        const category = product?.categories?.name ?? (item.product_id ? 'Others' : 'Custom Order');
        const value = netValues[index] ?? 0;
        const discount = discounts[index] ?? 0;
        const row = categoryMap.get(category) ?? { category, quantity: 0, cash_payment: 0, qr_payment: 0, discount: 0, foc_cost: 0, total_revenue: 0 };
        row.quantity += Number(item.quantity);
        row.discount += discount;
        if (sale.payment_method === 'cash') row.cash_payment += value;
        if (sale.payment_method === 'qr') row.qr_payment += value;
        if (sale.payment_method === 'complimentary') row.foc_cost += value;
        row.total_revenue = row.cash_payment + row.qr_payment;
        categoryMap.set(category, row);
        saleItemDetails.push({
          business_date: sale.business_date,
          time: sale.created_at,
          sale_number: sale.sale_number,
          staff: sale.order_taken_by,
          item: itemName,
          quantity: item.quantity,
          unit_price_at_sale: Number(item.unit_price),
          line_total: Number(item.line_total),
          discount_share: discount,
          method: paymentMethodLabel(sale.payment_method),
          paid_or_foc_value: value,
        });
      });
    });

    const movementsForPeriod = movements.filter((movement) => dateSet.has(malaysiaBusinessDateInputValue(movement.created_at, closeTime)));
    const stockIn = movementsForPeriod.filter((movement) => movement.movement_type === 'stock_in').map((movement) => ({
      business_date: malaysiaBusinessDateInputValue(movement.created_at, closeTime),
      time: movement.created_at,
      product: movement.products?.name ?? (movement.product_id ? productById.get(movement.product_id)?.name : null) ?? 'Product',
      units_added: Number(movement.quantity_change),
      input: stockInputLabel(movement),
      entered_by: movement.entered_by,
      reference: movement.reference_type,
      notes: movement.notes,
    }));
    const stockOutAdjustments = movementsForPeriod.filter((movement) => movement.movement_type !== 'stock_in').map((movement) => ({
      business_date: malaysiaBusinessDateInputValue(movement.created_at, closeTime),
      time: movement.created_at,
      product: movement.products?.name ?? (movement.product_id ? productById.get(movement.product_id)?.name : null) ?? 'Product',
      type: stockMovementTypeLabel(movement.movement_type),
      quantity_change_units: Number(movement.quantity_change),
      entered_by: movement.entered_by,
      reference: movement.reference_type,
      reason_or_notes: movement.reason ?? movement.notes,
    }));
    const stockInDraftProof = stockInDrafts
      .filter((draft) => dateSet.has(malaysiaBusinessDateInputValue(draft.created_at, closeTime)))
      .map((draft) => ({
        business_date: malaysiaBusinessDateInputValue(draft.created_at, closeTime),
        time: draft.created_at,
        draft_number: draft.draft_number,
        status: stockInDraftStatusLabel(draft.status),
        entered_by: draft.entered_by,
        total_units: Number(draft.total_units),
        supplier: draft.supplier,
        reference: draft.reference,
        item_count: draft.entries.length,
        items: draft.entries.map((entry) => `${entry.product_name} ${draftEntryInputLabel(entry)}`).join(', '),
        notes: draft.notes,
        cancel_reason: draft.cancel_reason,
        confirmed_at: draft.confirmed_at,
        cancelled_at: draft.cancelled_at,
      }));

    const inventoryRows = products.map((product) => {
      const productMovements = movements.filter((movement) => movement.product_id === product.id);
      const periodProductMovements = productMovements.filter((movement) => dateSet.has(malaysiaBusinessDateInputValue(movement.created_at, closeTime)));
      const afterPeriodChange = productMovements
        .filter((movement) => malaysiaBusinessDateInputValue(movement.created_at, closeTime) > endDate)
        .reduce((sum, movement) => sum + Number(movement.quantity_change), 0);
      const periodNet = periodProductMovements.reduce((sum, movement) => sum + Number(movement.quantity_change), 0);
      const stockInUnits = periodProductMovements.filter((movement) => movement.movement_type === 'stock_in').reduce((sum, movement) => sum + Number(movement.quantity_change), 0);
      const stockOutUnits = Math.abs(periodProductMovements.filter((movement) => Number(movement.quantity_change) < 0).reduce((sum, movement) => sum + Number(movement.quantity_change), 0));
      const voidReturnUnits = periodProductMovements.filter((movement) => movement.movement_type === 'void_sale').reduce((sum, movement) => sum + Number(movement.quantity_change), 0);
      const adjustmentUnits = periodProductMovements.filter((movement) => movement.movement_type === 'adjustment').reduce((sum, movement) => sum + Number(movement.quantity_change), 0);
      const currentUnits = Number(product.inventory_balances?.quantity_on_hand ?? 0);
      const lowAlertAtUnits = Number(product.low_stock_threshold);
      const closingUnits = currentUnits - afterPeriodChange;
      const reportRow = {
        product: product.name,
        category: product.categories?.name ?? 'Others',
        opening_units: closingUnits - periodNet,
        stock_in_units: stockInUnits,
        stock_out_units: stockOutUnits,
        void_return_units: voidReturnUnits,
        adjustment_units: adjustmentUnits,
        closing_units: closingUnits,
        status: product.active && closingUnits <= lowAlertAtUnits ? 'Low unit stock' : 'OK',
      };
      return {
        reportRow,
        lowStockRow: product.active && closingUnits <= lowAlertAtUnits
          ? {
              product: product.name,
              closing_balance_units: closingUnits,
              low_alert_at_units: lowAlertAtUnits,
              status: 'Low',
            }
          : null,
      };
    });
    const inventoryBalance = inventoryRows.map((row) => row.reportRow);
    const lowStockItems = inventoryRows
      .map((row) => row.lowStockRow)
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    const ingredientMovementsForPeriod = ingredientMovements.filter((movement) => dateSet.has(malaysiaBusinessDateInputValue(movement.created_at, closeTime)));
    const kitchenPax = kitchenPaxRows
      .filter((row) => dateSet.has(row.business_date))
      .map((row) => ({
        business_date: row.business_date,
        pax_count: Number(row.pax_count),
        entered_by: row.entered_by,
        updated_at: row.updated_at,
        notes: row.notes,
      }));
    const kitchenProduction: JsonRecord[] = kitchenReports
      .filter((report) => dateSet.has(report.business_date))
      .map((report) => ({
        business_date: report.business_date,
        time: report.created_at,
        platter: report.platter_name,
        serving_basis: report.serving_basis,
        prepared_count: Number(report.platter_count),
        submitted_by: report.submitted_by,
        ingredient_lines: (report.kitchen_production_items ?? []).length,
        ingredients_deducted: (report.kitchen_production_items ?? [])
          .map((item) => `${item.ingredient_items?.name ?? ingredientById.get(item.ingredient_id)?.name ?? 'Ingredient'} ${quantityText(Number(item.total_quantity), item.unit)}`)
          .join(', '),
        notes: report.notes,
      }));
    for(const day of previewDb.kitchen_daily_usage??[]){
      if(!dateSet.has(day.business_date))continue;
      for(const [field,count,label] of [['guest_quantity',day.guest_meals,'Guest Meals'],['staff_quantity',day.staff_meals,'Staff Meals']] as const){
        if(!Number(count))continue;
        kitchenProduction.push({business_date:day.business_date,time:day.updated_at,platter:label,serving_basis:'meals',prepared_count:Number(count),submitted_by:day.created_by_name,
          ingredient_lines:day.lines.length,ingredients_deducted:day.lines.filter((l:JsonRecord)=>Number(l[field])>0).map((l:JsonRecord)=>`${l.name} ${l[field]} ${l.unit}`).join(', '),notes:day.notes});
      }
    }
    const ingredientStockMovements = ingredientMovementsForPeriod.map((movement) => {
      const ingredient = ingredientById.get(movement.ingredient_id);
      return {
        business_date: malaysiaBusinessDateInputValue(movement.created_at, closeTime),
        time: movement.created_at,
        ingredient: movement.ingredient_items?.name ?? ingredient?.name ?? 'Ingredient',
        category: ingredient?.category ?? '-',
        type: ingredientMovementTypeLabel(movement.movement_type),
        quantity_change: quantityText(Number(movement.quantity_change), movement.ingredient_items?.base_unit ?? ingredient?.base_unit),
        balance_after: quantityText(Number(movement.quantity_after), movement.ingredient_items?.base_unit ?? ingredient?.base_unit),
        entered_by: movement.entered_by,
        reference: movement.reference_type,
        reason_or_notes: movement.reason ?? movement.notes,
      };
    });
    const ingredientInventoryRows = ingredients.map((ingredient) => {
      const ingredientPeriodMovements = ingredientMovements.filter((movement) => movement.ingredient_id === ingredient.id && dateSet.has(malaysiaBusinessDateInputValue(movement.created_at, closeTime)));
      const afterPeriodChange = ingredientMovements
        .filter((movement) => movement.ingredient_id === ingredient.id && malaysiaBusinessDateInputValue(movement.created_at, closeTime) > endDate)
        .reduce((sum, movement) => sum + Number(movement.quantity_change), 0);
      const periodNet = ingredientPeriodMovements.reduce((sum, movement) => sum + Number(movement.quantity_change), 0);
      const stockInQuantity = ingredientPeriodMovements.filter((movement) => movement.movement_type === 'stock_in').reduce((sum, movement) => sum + Number(movement.quantity_change), 0);
      const cocktailUsage = Math.abs(ingredientPeriodMovements.filter((movement) => movement.movement_type === 'sale' || movement.movement_type === 'complimentary').reduce((sum, movement) => sum + Math.min(0, Number(movement.quantity_change)), 0));
      const kitchenUsage = Math.abs(ingredientPeriodMovements.filter((movement) => movement.movement_type === 'kitchen_production').reduce((sum, movement) => sum + Math.min(0, Number(movement.quantity_change)), 0));
      const adjustmentQuantity = ingredientPeriodMovements.filter((movement) => movement.movement_type === 'adjustment' || movement.movement_type === 'waste' || movement.movement_type === 'count').reduce((sum, movement) => sum + Number(movement.quantity_change), 0);
      const closingQuantity = ingredientBalanceValue(ingredient) - afterPeriodChange;
      const reportRow = {
        ingredient: ingredient.name,
        category: ingredient.category,
        unit: ingredient.base_unit,
        opening_quantity: quantityText(closingQuantity - periodNet, ingredient.base_unit),
        stock_in: quantityText(stockInQuantity, ingredient.base_unit),
        cocktail_usage: quantityText(cocktailUsage, ingredient.base_unit),
        kitchen_usage: quantityText(kitchenUsage, ingredient.base_unit),
        adjustment_or_waste: quantityText(adjustmentQuantity, ingredient.base_unit),
        closing_quantity: quantityText(closingQuantity, ingredient.base_unit),
        status: ingredient.active && closingQuantity <= Number(ingredient.low_stock_threshold) ? 'Low ingredient stock' : 'OK',
      };
      return {
        reportRow,
        lowStockRow: ingredient.active && closingQuantity <= Number(ingredient.low_stock_threshold)
          ? {
              ingredient: ingredient.name,
              category: ingredient.category,
              closing_quantity: quantityText(closingQuantity, ingredient.base_unit),
              low_alert_at: quantityText(Number(ingredient.low_stock_threshold), ingredient.base_unit),
              status: 'Low',
            }
          : null,
      };
    });
    const ingredientInventoryBalance = ingredientInventoryRows.map((row) => row.reportRow);
    const lowIngredientStock = ingredientInventoryRows
      .map((row) => row.lowStockRow)
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    const ingredientExceptionSummary = ingredientExceptionRowsFromMovements(ingredientStockMovements);
    const summary = {
      cash_payment: completedSales.filter((sale) => sale.payment_method === 'cash').reduce((sum, sale) => sum + Number(sale.paid_amount), 0),
      qr_payment: completedSales.filter((sale) => sale.payment_method === 'qr').reduce((sum, sale) => sum + Number(sale.paid_amount), 0),
      foc_cost: completedSales.filter((sale) => sale.payment_method === 'complimentary').reduce((sum, sale) => sum + Number(sale.total_amount), 0),
      total_revenue: completedSales.filter((sale) => sale.payment_method !== 'complimentary').reduce((sum, sale) => sum + Number(sale.paid_amount), 0),
      discount_given: completedSales.reduce((sum, sale) => sum + Number(sale.discount_amount ?? 0), 0),
      transactions: completedSales.length,
      voided_sales: salesForPeriod.filter((sale) => sale.status === 'voided').length,
      qr_pending: completedSales.filter((sale) => sale.payment_method === 'qr' && sale.qr_status === 'pending').reduce((sum, sale) => sum + Number(sale.paid_amount), 0),
      qr_verified: completedSales.filter((sale) => sale.payment_method === 'qr' && sale.qr_status === 'verified').reduce((sum, sale) => sum + Number(sale.paid_amount), 0),
      qr_mismatch: completedSales.filter((sale) => sale.payment_method === 'qr' && sale.qr_status === 'mismatch').reduce((sum, sale) => sum + Number(sale.paid_amount), 0),
      kitchen_pax: kitchenPax.reduce((sum, row) => sum + Number(row.pax_count), 0),
      kitchen_platters: kitchenProduction.filter(row=>row.serving_basis!=='meals').reduce((sum, row) => sum + Number(row.prepared_count), 0),
      kitchen_guest_meals: kitchenProduction.filter(row=>row.platter==='Guest Meals'&&row.serving_basis==='meals').reduce((sum,row)=>sum+Number(row.prepared_count),0),
      kitchen_staff_meals: kitchenProduction.filter(row=>row.platter==='Staff Meals'&&row.serving_basis==='meals').reduce((sum,row)=>sum+Number(row.prepared_count),0),
      ingredient_usage_lines: ingredientStockMovements.length,
      ingredient_stock_counts: ingredientExceptionSummary.filter((row) => row.type === 'Stock count').reduce((sum, row) => sum + Number(row.entries), 0),
      ingredient_waste_missing: ingredientExceptionSummary.filter((row) => row.type === 'Waste').reduce((sum, row) => sum + Number(row.entries), 0),
      ingredient_corrections: ingredientExceptionSummary.filter((row) => row.type === 'Adjustment').reduce((sum, row) => sum + Number(row.entries), 0),
      stock_in_drafts_pending: stockInDraftProof.filter((row) => row.status === 'Draft Only - Stock Not Added').length,
      stock_in_drafts_cancelled: stockInDraftProof.filter((row) => row.status === 'Cancelled').length,
      stock_in_drafts_confirmed: stockInDraftProof.filter((row) => row.status === 'Confirmed - Stock Added').length,
    };
    const closedTimes = reportsInPeriod.map((report) => report.closed_at).sort();
    const generatedAt = closedTimes[closedTimes.length - 1] ?? new Date().toISOString();
    const fileName = archiveFileName(kind, startDate, endDate);
    const title = `Lovely Paradise ${kindLabel(kind)} Operations Report ${startDate === endDate ? startDate : `${startDate} to ${endDate}`}`;

    return {
      id: `local-${kind}-${startDate}-${endDate}`,
      report_kind: kind,
      period_start: startDate,
      period_end: endDate,
      title,
      file_name: fileName,
      generated_at: generatedAt,
      generated_by: reportsInPeriod[0]?.closed_by ?? null,
      report_json: {
        schema_version: 1,
        report_kind: kind,
        period_start: startDate,
        period_end: endDate,
        title,
        file_name: fileName,
        generated_at: generatedAt,
        summary,
        daily_closing: dates.map((date) => {
          const report = reports.find((item) => item.business_date === date && item.status === 'closed');
          const daySales = completedSales.filter((sale) => sale.business_date === date);
          const cash = report ? Number(report.total_cash) : daySales.filter((sale) => sale.payment_method === 'cash').reduce((sum, sale) => sum + Number(sale.paid_amount), 0);
          const qr = report ? Number(report.total_qr) : daySales.filter((sale) => sale.payment_method === 'qr').reduce((sum, sale) => sum + Number(sale.paid_amount), 0);
          const focCost = report ? Number(report.total_complimentary_value) : daySales.filter((sale) => sale.payment_method === 'complimentary').reduce((sum, sale) => sum + Number(sale.total_amount), 0);
          return {
            business_date: date,
            status: report ? 'Closed' : 'Not closed',
            opening_float: report ? numberValue(report.report_json.opening_cash_float) : 0,
            cash_payment: cash,
            qr_payment: qr,
            foc_cost: focCost,
            total_revenue: report ? Number(report.total_sales) : cash + qr,
            actual_cash_counted: report?.actual_cash_counted ?? null,
            expected_cash: report?.expected_cash ?? null,
            cash_variance: report?.cash_variance ?? null,
            closed_at: report?.closed_at ?? null,
            notes: report?.notes ?? '',
          };
        }),
        item_sales: itemSales,
        category_sales: Array.from(categoryMap.values()).sort((a, b) => a.category.localeCompare(b.category)),
        sales_transactions: salesForPeriod.map((sale) => ({
          business_date: sale.business_date,
          time: sale.created_at,
          sale_number: sale.sale_number,
          staff: sale.order_taken_by,
          method: paymentMethodLabel(sale.payment_method),
          qr_type: sale.qr_payment_type,
          qr_reference: sale.qr_reference,
          qr_status: qrStatusLabel(sale.qr_status),
          discount: Number(sale.discount_amount ?? 0),
          sale_value: Number(sale.total_amount),
          paid: Number(sale.paid_amount),
        })),
        sale_item_details: saleItemDetails,
        qr_verification: salesForPeriod.filter((sale) => sale.payment_method === 'qr').map((sale) => ({
          business_date: sale.business_date,
          time: sale.created_at,
          sale_number: sale.sale_number,
          staff: sale.order_taken_by,
          qr_type: sale.qr_payment_type,
          reference: sale.qr_reference,
          status: qrStatusLabel(sale.qr_status),
          receipt_image_path: sale.qr_receipt_image_path,
          amount: Number(sale.paid_amount),
        })),
        voided_sales: salesForPeriod.filter((sale) => sale.status === 'voided').map((sale) => ({
          business_date: sale.business_date,
          sale_time: sale.created_at,
          sale_number: sale.sale_number,
          voided_at: sale.voided_at,
          staff: sale.order_taken_by,
          method: paymentMethodLabel(sale.payment_method),
          original_value: Number(sale.total_amount),
          reason: sale.void_reason,
        })),
        stock_in: stockIn,
        stock_in_draft_proof: stockInDraftProof,
        stock_out_adjustments: stockOutAdjustments,
        kitchen_pax: kitchenPax,
        kitchen_production: kitchenProduction,
        ingredient_stock_movements: ingredientStockMovements,
        ingredient_exception_summary: ingredientExceptionSummary,
        ingredient_inventory_balance: ingredientInventoryBalance,
        low_ingredient_stock: lowIngredientStock,
        inventory_balance: inventoryBalance,
        low_stock_items: lowStockItems,
      },
    } satisfies AccountReportArchive;
  }

  const localToday = malaysiaBusinessDateInputValue(new Date(), '00:00');
  const sourceDates = Array.from(new Set([
    ...reports.map((report) => report.business_date),
    ...sales.map((sale) => sale.business_date),
    ...movements.map((movement) => malaysiaBusinessDateInputValue(movement.created_at, closeTime)),
    ...stockInDrafts.map((draft) => malaysiaBusinessDateInputValue(draft.created_at, closeTime)),
    ...ingredientMovements.map((movement) => malaysiaBusinessDateInputValue(movement.created_at, closeTime)),
    ...kitchenPaxRows.map((row) => row.business_date),
    ...kitchenReports.map((report) => report.business_date),
  ]))
    .filter((date) => date && date < localToday)
    .sort();

  const archives: AccountReportArchive[] = [];
  sourceDates.forEach((date) => archives.push(buildArchive('daily', date, date, [date])));

  const addGroupedArchives = (kind: Exclude<ReportKind, 'daily'>, getRange: (date: Date) => { start: string; end: string }) => {
    const grouped = new Map<string, { start: string; end: string }>();
    sourceDates.forEach((date) => {
      const range = getRange(parseISO(date));
      const key = `${range.start}:${range.end}`;
      grouped.set(key, range);
    });
    grouped.forEach((group) => {
      if (group.end < localToday) {
        archives.push(buildArchive(kind, group.start, group.end, dateRangeStrings(group.start, group.end)));
      }
    });
  };

  addGroupedArchives('weekly', (date) => ({
    start: format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
    end: format(endOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
  }));
  addGroupedArchives('monthly', (date) => ({
    start: format(startOfMonth(date), 'yyyy-MM-dd'),
    end: format(endOfMonth(date), 'yyyy-MM-dd'),
  }));
  addGroupedArchives('annual', (date) => {
    const year = format(date, 'yyyy');
    return { start: `${year}-01-01`, end: `${year}-12-31` };
  });

  return archives.sort((a, b) => b.period_end.localeCompare(a.period_end) || b.report_kind.localeCompare(a.report_kind));
}
export function downloadArchivePdf(report: AccountReportArchive, currency: string, toast: ReturnType<typeof useToast>) {
  const printable = window.open('', '_blank');
  if (!printable) {
    toast.error('Popup blocked. Allow popups to download/print PDF.');
    return;
  }
  const summary = summaryOf(report);
  const json = report.report_json;
  const closing = closingOf(report);
  const exceptionRows = ingredientExceptionRows(report);
  const sections = [
    htmlTable('Daily Closing', rowsOf(report, 'daily_closing'), [
      { key: 'business_date', label: 'Date' },
      { key: 'status', label: 'Status' },
      { key: 'opening_float', label: 'Opening Float', money: true },
      { key: 'cash_payment', label: 'Cash Payment', money: true },
      { key: 'qr_payment', label: 'QR Payment', money: true },
      { key: 'foc_cost', label: 'FOC Value', money: true },
      { key: 'total_revenue', label: 'Total Revenue', money: true },
      { key: 'actual_cash_counted', label: 'Actual Cash', money: true },
      { key: 'expected_cash', label: 'Expected Cash', money: true },
      { key: 'cash_variance', label: 'Variance', money: true },
      { key: 'closed_at', label: 'Closed At', dateTime: true },
      { key: 'notes', label: 'Notes' },
    ], currency),
    htmlTable('Sales of All Items', rowsOf(report, 'item_sales'), [
      { key: 'item', label: 'Item' },
      { key: 'quantity', label: 'Quantity' },
      { key: 'cash_payment', label: 'Cash Payment', money: true },
      { key: 'qr_payment', label: 'QR Payment', money: true },
      { key: 'discount', label: 'Discount', money: true, negative: true },
      { key: 'foc_cost', label: 'FOC Value', money: true },
      { key: 'total_revenue', label: 'Total Revenue', money: true },
    ], currency),
    htmlTable('Sales by Category', rowsOf(report, 'category_sales'), [
      { key: 'category', label: 'Category' },
      { key: 'quantity', label: 'Quantity' },
      { key: 'cash_payment', label: 'Cash Payment', money: true },
      { key: 'qr_payment', label: 'QR Payment', money: true },
      { key: 'discount', label: 'Discount', money: true, negative: true },
      { key: 'foc_cost', label: 'FOC Value', money: true },
      { key: 'total_revenue', label: 'Total Revenue', money: true },
    ], currency),
    htmlTable('Sales Transactions', rowsOf(report, 'sales_transactions'), [
      { key: 'business_date', label: 'Business Date' },
      { key: 'time', label: 'Time', dateTime: true },
      { key: 'sale_number', label: 'Sale No.' },
      { key: 'staff', label: 'Staff' },
      { key: 'method', label: 'Method' },
      { key: 'qr_type', label: 'QR Type' },
      { key: 'qr_status', label: 'QR Status' },
      { key: 'discount', label: 'Discount', money: true },
      { key: 'sale_value', label: 'Sale Value', money: true },
      { key: 'paid', label: 'Paid', money: true },
    ], currency),
    htmlTable('Sale Item Details', rowsOf(report, 'sale_item_details'), [
      { key: 'business_date', label: 'Business Date' },
      { key: 'time', label: 'Time', dateTime: true },
      { key: 'sale_number', label: 'Sale No.' },
      { key: 'staff', label: 'Staff' },
      { key: 'item', label: 'Item' },
      { key: 'quantity', label: 'Qty' },
      { key: 'unit_price_at_sale', label: 'Unit Price at Sale', money: true },
      { key: 'line_total', label: 'Line Total', money: true },
      { key: 'discount_share', label: 'Discount Share', money: true, negative: true },
      { key: 'method', label: 'Method' },
      { key: 'paid_or_foc_value', label: 'Paid / FOC Value', money: true },
    ], currency),
    htmlTable('QR Payment Verification', rowsOf(report, 'qr_verification'), [
      { key: 'business_date', label: 'Business Date' },
      { key: 'time', label: 'Time', dateTime: true },
      { key: 'sale_number', label: 'Sale No.' },
      { key: 'staff', label: 'Staff' },
      { key: 'qr_type', label: 'QR Type' },
      { key: 'reference', label: 'Reference' },
      { key: 'status', label: 'Status' },
      { key: 'receipt_image_path', label: 'Receipt' },
      { key: 'amount', label: 'Amount', money: true },
    ], currency),
    htmlTable('Voided Sales', rowsOf(report, 'voided_sales'), [
      { key: 'business_date', label: 'Business Date' },
      { key: 'sale_time', label: 'Sale Time', dateTime: true },
      { key: 'sale_number', label: 'Sale No.' },
      { key: 'voided_at', label: 'Voided At', dateTime: true },
      { key: 'staff', label: 'Staff' },
      { key: 'method', label: 'Method' },
      { key: 'original_value', label: 'Original Value', money: true },
      { key: 'reason', label: 'Reason' },
    ], currency),
    htmlTable('Stock In', rowsOf(report, 'stock_in'), [
      { key: 'business_date', label: 'Business Date' },
      { key: 'time', label: 'Time', dateTime: true },
      { key: 'product', label: 'Product' },
      { key: 'units_added', label: 'Units Added' },
      { key: 'input', label: 'Input' },
      { key: 'entered_by', label: 'Entered By' },
      { key: 'reference', label: 'Reference' },
      { key: 'notes', label: 'Notes' },
    ], currency),
    htmlTable('Stock In Draft Proof', rowsOf(report, 'stock_in_draft_proof'), [
      { key: 'business_date', label: 'Business Date' },
      { key: 'time', label: 'Time', dateTime: true },
      { key: 'draft_number', label: 'Draft No.' },
      { key: 'status', label: 'Status' },
      { key: 'entered_by', label: 'Entered By' },
      { key: 'total_units', label: 'Total Units' },
      { key: 'items', label: 'Items' },
      { key: 'supplier', label: 'Supplier' },
      { key: 'reference', label: 'Reference' },
      { key: 'cancel_reason', label: 'Cancel Reason' },
      { key: 'confirmed_at', label: 'Confirmed At', dateTime: true },
      { key: 'cancelled_at', label: 'Cancelled At', dateTime: true },
    ], currency, 'No Stock In draft proof records for this period.'),
    htmlTable('Stock Out / Adjustments', rowsOf(report, 'stock_out_adjustments'), [
      { key: 'business_date', label: 'Business Date' },
      { key: 'time', label: 'Time', dateTime: true },
      { key: 'product', label: 'Product' },
      { key: 'type', label: 'Type' },
      { key: 'quantity_change_units', label: 'Quantity Change (Units)' },
      { key: 'entered_by', label: 'Entered By' },
      { key: 'reference', label: 'Reference' },
      { key: 'reason_or_notes', label: 'Reason / Notes' },
    ], currency),
    htmlTable('Kitchen Pax Count', rowsOf(report, 'kitchen_pax'), [
      { key: 'business_date', label: 'Business Date' },
      { key: 'pax_count', label: 'Pax Count' },
      { key: 'entered_by', label: 'Entered By' },
      { key: 'updated_at', label: 'Updated At', dateTime: true },
      { key: 'notes', label: 'Notes' },
    ], currency),
    htmlTable('Kitchen Meals & Preparation', rowsOf(report, 'kitchen_production'), [
      { key: 'business_date', label: 'Business Date' },
      { key: 'time', label: 'Time', dateTime: true },
      { key: 'platter', label: 'Set / Platter' },
      { key: 'serving_basis', label: 'Basis' },
      { key: 'prepared_count', label: 'Prepared' },
      { key: 'submitted_by', label: 'Submitted By' },
      { key: 'ingredients_deducted', label: 'Ingredients Deducted' },
      { key: 'notes', label: 'Notes' },
    ], currency),
    htmlTable('Ingredient Stock Movements', rowsOf(report, 'ingredient_stock_movements'), [
      { key: 'business_date', label: 'Business Date' },
      { key: 'time', label: 'Time', dateTime: true },
      { key: 'ingredient', label: 'Ingredient' },
      { key: 'category', label: 'Category' },
      { key: 'type', label: 'Type' },
      { key: 'quantity_change', label: 'Quantity Change' },
      { key: 'balance_after', label: 'Balance After' },
      { key: 'entered_by', label: 'Entered By' },
      { key: 'reason_or_notes', label: 'Reason / Notes' },
    ], currency),
    htmlTable('Ingredient Stock Exceptions', exceptionRows, [
      { key: 'type', label: 'Type' },
      { key: 'ingredient', label: 'Ingredient' },
      { key: 'category', label: 'Category' },
      { key: 'entries', label: 'Entries' },
      { key: 'net_change', label: 'Net Change' },
      { key: 'latest_entry', label: 'Latest Entry', dateTime: true },
      { key: 'entered_by', label: 'Entered By' },
      { key: 'reason_or_notes', label: 'Latest Reason / Notes' },
    ], currency, 'No count, waste, missing, or correction records.'),
    htmlTable('Ingredient Inventory Balance', rowsOf(report, 'ingredient_inventory_balance'), [
      { key: 'ingredient', label: 'Ingredient' },
      { key: 'category', label: 'Category' },
      { key: 'unit', label: 'Unit' },
      { key: 'opening_quantity', label: 'Opening' },
      { key: 'stock_in', label: 'Stock In' },
      { key: 'cocktail_usage', label: 'Cocktail Usage' },
      { key: 'kitchen_usage', label: 'Kitchen Usage' },
      { key: 'adjustment_or_waste', label: 'Adjustment / Waste' },
      { key: 'closing_quantity', label: 'Closing' },
      { key: 'status', label: 'Status' },
    ], currency),
    htmlTable('Low Ingredient Stock', rowsOf(report, 'low_ingredient_stock'), [
      { key: 'ingredient', label: 'Ingredient' },
      { key: 'category', label: 'Category' },
      { key: 'closing_quantity', label: 'Closing' },
      { key: 'low_alert_at', label: 'Low Alert At' },
      { key: 'status', label: 'Status' },
    ], currency),
    htmlTable('Inventory Balance', rowsOf(report, 'inventory_balance'), [
      { key: 'product', label: 'Product' },
      { key: 'category', label: 'Category' },
      { key: 'opening_units', label: 'Opening Units' },
      { key: 'stock_in_units', label: 'Stock In (Units)' },
      { key: 'stock_out_units', label: 'Stock Out (Units)' },
      { key: 'void_return_units', label: 'Void Return Units' },
      { key: 'adjustment_units', label: 'Adjustment Units' },
      { key: 'closing_units', label: 'Closing Units' },
      { key: 'status', label: 'Status' },
    ], currency),
    htmlTable('Low Unit Stock Items', rowsOf(report, 'low_stock_items'), [
      { key: 'product', label: 'Product' },
      { key: 'closing_balance_units', label: 'Closing Balance (Individual Units)' },
      { key: 'low_alert_at_units', label: 'Low Alert At (Individual Units)' },
      { key: 'status', label: 'Status' },
    ], currency),
  ];

  printable.document.write(`
    <html><head><title>${htmlEscape(archiveDownloadName(report).replace(/\.pdf$/i, ''))}</title>
    <style>
      @page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}
      body{font-family:Arial,Helvetica,sans-serif;color:#2b1b27;font-size:11px;line-height:1.35}
      h1{margin:0 0 3px;font-size:24px}h2{margin:16px 0 7px;font-size:15px}.muted{color:#6b5b68}.bad{color:#d94d6a;font-weight:800}
      .top{display:flex;justify-content:space-between;gap:12px;border-bottom:2px solid #2b1b27;padding-bottom:10px;margin-bottom:12px}
      .summary{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin:12px 0}.box{border:1px solid #ead1dc;background:#fff7fb;border-radius:10px;padding:8px;min-height:54px}.box b{display:block;margin-top:4px;font-size:14px}
      table{border-collapse:collapse;width:100%;margin:0 0 12px;page-break-inside:auto}tr{page-break-inside:avoid;page-break-after:auto}td,th{border:1px solid #ddd;padding:6px;text-align:left;vertical-align:top}th{background:#fff0f5;font-size:10px;text-transform:uppercase;letter-spacing:.02em}.empty{color:#6b5b68;text-align:center}
      section{break-inside:avoid}@media print{button{display:none}}
    </style></head><body>
    <div class="top"><div><h1>Lovely Paradise ${htmlEscape(kindLabel(report.report_kind))} Operations Report</h1><div class="muted">${htmlEscape(periodLabel(report))}</div><div class="muted">${htmlEscape(operationsReportScope[0])}</div></div><div><strong>Generated:</strong> ${htmlEscape(safeDateTime(report.generated_at))}<br><strong>File name:</strong> ${htmlEscape(archiveDownloadName(report))}<br><strong>Archive reference:</strong> ${htmlEscape(report.file_name)}<br><strong>Closing:</strong> ${htmlEscape(closingEnglishLabel(closing.status))}${closing.totalDays > 1 ? ' (' + closing.closedDays + '/' + closing.totalDays + ' days closed)' : ''}</div></div>
    <div class="summary">
      <div class="box">Cash Payment<b>${money(summary.cash, currency)}</b></div><div class="box">QR Payment<b>${money(summary.qr, currency)}</b></div><div class="box">Total Revenue<b>${money(summary.totalRevenue, currency)}</b></div><div class="box">FOC Value<b class="bad">${money(summary.focCost, currency)}</b></div><div class="box">Discount Given<b>${money(summary.discount, currency)}</b></div><div class="box">Transactions<b>${summary.transactions}</b></div>
      <div class="box">Closing Status<b>${htmlEscape(closingEnglishLabel(closing.status))}</b></div><div class="box">Voided Sales<b>${summary.voidedSales}</b></div><div class="box">QR Pending<b>${money(summary.qrPending, currency)}</b></div><div class="box">QR Verified<b>${money(summary.qrVerified, currency)}</b></div><div class="box">QR Mismatch<b>${money(summary.qrMismatch, currency)}</b></div><div class="box">Kitchen Pax<b>${summary.kitchenPax}</b></div><div class="box">Kitchen Platters<b>${summary.kitchenPlatters}</b></div><div class="box">Ingredient Lines<b>${summary.ingredientUsageLines}</b></div><div class="box">Stock Counts<b>${summary.ingredientStockCounts}</b></div><div class="box">Waste / Missing<b>${summary.ingredientWasteMissing}</b></div><div class="box">Corrections<b>${summary.ingredientCorrections}</b></div><div class="box">Period Start<b>${htmlEscape(report.period_start)}</b></div><div class="box">Period End<b>${htmlEscape(report.period_end)}</b></div>
      <div class="box">Stock In Drafts<b>${summary.stockInDraftsPending} pending / ${summary.stockInDraftsCancelled} cancelled</b></div>
    </div>
    ${sections.join('')}
    <script>window.print();</script>
    </body></html>
  `);
  printable.document.close();
}

export function AccountReportArchivePanel({ settings }: { settings: SettingsMap }) {
  const toast = useToast();
  const { text } = useLanguage();
  const [kind, setKind] = useState<ReportKind>('daily');
  const [archives, setArchives] = useState<AccountReportArchive[]>([]);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<AccountReportArchive | null>(null);
  const currency = String(settings.currency_symbol);

  async function loadArchives() {
    setLoading(true);
    if (!isSupabaseConfigured) {
      setArchives(localArchives(settings));
      setLoading(false);
      return;
    }
    const refresh = await supabase.rpc('refresh_due_account_report_archives');
    if (refresh.error && !refresh.error.message.toLowerCase().includes('refresh_due_account_report_archives')) {
      toast.error(refresh.error.message);
    }
    const { data, error } = await supabase
      .from('account_report_archives')
      .select('*')
      .order('generated_at', { ascending: false })
      .limit(240);
    setLoading(false);
    if (error) {
      toast.error(error.message.toLowerCase().includes('account_report_archives') ? 'Cloud database needs the latest account report SQL update.' : error.message);
      setArchives([]);
      return;
    }
    setArchives((data ?? []) as AccountReportArchive[]);
  }

  useEffect(() => {
    void loadArchives();
  }, [settings.business_day_close_time]);

  useSharedRefresh(() => loadArchives(), {
    tables: ['account_report_archives', 'daily_reports', 'sales', 'sale_items', 'stock_movements', 'ingredient_movements', 'kitchen_daily_pax', 'kitchen_production_reports', 'kitchen_production_items'],
    intervalMs: 30000,
  });

  const visibleArchives = useMemo(
    () => archives.filter((archive) => archive.report_kind === kind).sort((a, b) => b.period_end.localeCompare(a.period_end)).slice(0, 80),
    [archives, kind],
  );
  const latestGenerated = useMemo(
    () => archives.map((archive) => archive.generated_at).sort((a, b) => b.localeCompare(a))[0] ?? null,
    [archives],
  );
  const archiveCounts = useMemo(() => {
    const counts: Record<ReportKind, number> = { daily: 0, weekly: 0, monthly: 0, annual: 0 };
    archives.forEach((archive) => {
      counts[archive.report_kind] += 1;
    });
    return counts;
  }, [archives]);

  const activeSummary = preview ? summaryOf(preview) : null;
  const kindLabelForUi = (item: ReportKind) =>
    item === 'daily'
      ? text('Daily', 'Harian')
      : item === 'weekly'
        ? text('Weekly', 'Mingguan')
        : item === 'monthly'
          ? text('Monthly', 'Bulanan')
          : text('Annual', 'Tahunan');
  const closingLabelForUi = (status: ArchiveClosingStatus) =>
    status === 'closed'
      ? text('Closed', 'Ditutup')
      : status === 'partial'
        ? text('Has unclosed days', 'Ada hari belum ditutup')
        : text('Not closed', 'Belum ditutup');
  const closingBadgeClass = (status: ArchiveClosingStatus) =>
    status === 'closed'
      ? 'bg-teal-50 text-accent'
      : status === 'partial'
        ? 'bg-amber-50 text-warning'
        : 'bg-pink-100 text-coral';
  const closingMobileLabel = (status: ArchiveClosingStatus) =>
    status === 'closed'
      ? text('Closed', 'Tutup')
      : status === 'partial'
        ? text('Partial', 'Sebahagian')
        : text('Not closed', 'Belum');

  return (
    <section className="island-panel rounded-2xl p-3 sm:rounded-xl sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-black sm:text-xl">{text('Operations Reports', 'Laporan Operasi')}</h2>
        <p className="mt-1 text-xs text-muted">{text(...operationsReportScope)}</p>
        <button type="button" className={secondaryButtonClass + ' dense-action shrink-0 justify-center'} onClick={() => void loadArchives()} disabled={loading}>
          <RefreshCcw className="h-4 w-4" />
          <span className="sm:hidden">{loading ? text('Generating...', 'Menjana...') : text('Refresh', 'Segar')}</span>
          <span className="hidden sm:inline">
            {loading
              ? text('Generating...', 'Menjana...')
              : isSupabaseConfigured
                ? text('Generate / Refresh Now', 'Jana / Segar Semula')
                : text('Refresh Device Reports', 'Segar Laporan Peranti')}
          </span>
        </button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1 rounded-2xl border border-line bg-white/75 p-1.5 text-[11px] font-black sm:mt-3 sm:flex sm:flex-wrap sm:items-center sm:gap-2 sm:p-2 sm:text-xs">
        <span className="rounded-xl bg-shell px-2 py-1 text-accent sm:px-3 sm:py-2">
          {isSupabaseConfigured ? text('Supabase Cloud', 'Cloud Supabase') : text('This Device Only', 'Peranti Ini Sahaja')}
        </span>
        <span className="rounded-xl bg-shell px-2 py-1 sm:px-3 sm:py-2">
          {isSupabaseConfigured
            ? text('Auto: 00:00 MYT', 'Auto: 00:00 MYT')
            : text('Generated on open', 'Dijana bila dibuka')}
        </span>
        <span className="rounded-xl bg-shell px-2 py-1 sm:px-3 sm:py-2">
          {text('Latest', 'Terbaru')}: {latestGenerated ? safeDateTime(latestGenerated) : text('None', 'Tiada')}
        </span>
        <span className="rounded-xl bg-shell px-2 py-1 sm:px-3 sm:py-2">
          D {archiveCounts.daily} · W {archiveCounts.weekly} · M {archiveCounts.monthly} · Y {archiveCounts.annual}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1 rounded-2xl bg-white/80 p-1 text-xs font-black sm:mt-3 sm:max-w-[640px] sm:text-sm">
        {reportKinds.map((item) => (
          <button
            key={item}
            type="button"
            className={`min-h-9 rounded-xl px-1.5 py-1 leading-tight sm:min-h-10 sm:py-1.5 ${kind === item ? 'bg-accent text-white' : ''}`}
            onClick={() => setKind(item)}
          >
            <span className="block">{kindLabelForUi(item)}</span>
            <span className={`mt-0.5 block text-[0.65rem] ${kind === item ? 'text-white/80' : 'text-neutral-500'}`}>
              {archiveCounts[item]}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-white/80 sm:hidden">
        <table className="dense-table w-full table-fixed text-left text-[11px]">
          <thead className="bg-paper">
            <tr>
              <th className="w-[45%] p-2">{text('Period', 'Tempoh')}</th>
              <th className="w-[32%] p-2 text-right">{text('Total Revenue', 'Jumlah Hasil')}</th>
              <th className="w-[23%] p-2 text-center">{text('Closing', 'Tutup')}</th>
            </tr>
          </thead>
          <tbody>
            {visibleArchives.map((archive) => {
              const summary = summaryOf(archive);
              const closing = closingOf(archive);
              return (
                <Fragment key={`archive-mobile-${archive.id}`}>
                  <tr className="border-t border-line align-top">
                    <td className="p-2 font-black">
                      <span className="line-clamp-2">{periodLabel(archive)}</span>
                      <span className="mt-0.5 block text-[10px] font-bold text-neutral-500">{kindLabelForUi(archive.report_kind)}</span>
                    </td>
                    <td className="p-2 text-right font-black">{money(summary.totalRevenue, currency)}</td>
                    <td className="p-2 text-center"><span className={'inline-flex whitespace-nowrap rounded-lg px-1.5 py-0.5 text-[9px] font-black ' + closingBadgeClass(closing.status)}>{closingMobileLabel(closing.status)}</span></td>
                  </tr>
                  <tr className="border-t border-pink-100 bg-white/70">
                    <td colSpan={3} className="px-2 pb-2 pt-1">
                      <div className="grid grid-cols-3 gap-1 text-[10px] font-black leading-tight">
                        <span className="rounded-lg bg-emerald-50 px-1.5 py-1 text-emerald-700">{text('Cash Payment', 'Bayaran Tunai')}<br />{money(summary.cash, currency)}</span>
                        <span className="rounded-lg bg-sky-50 px-1.5 py-1 text-sky-700">{text('QR Payment', 'Bayaran QR')}<br />{money(summary.qr, currency)}</span>
                        <span className="rounded-lg bg-pink-50 px-1.5 py-1 text-coral">{text('FOC Value', 'Nilai FOC')}<br />{money(summary.focCost, currency)}</span>
                      </div>
                      <p className="mt-1 truncate rounded-lg bg-shell px-1.5 py-1 text-[10px] font-bold text-neutral-600" title={archiveDownloadName(archive)}>{archiveDownloadName(archive)}</p>
                      <div className="mt-1 grid grid-cols-2 gap-1">
                        <button type="button" className={secondaryButtonClass + ' dense-action justify-center'} onClick={() => setPreview(archive)}>
                          <Eye className="h-3.5 w-3.5" />
                          {text('Preview', 'Pratonton')}
                        </button>
                        <button type="button" className={secondaryButtonClass + ' dense-action justify-center'} onClick={() => downloadArchivePdf(archive, currency, toast)}>
                          <Download className="h-3.5 w-3.5" />
                          PDF
                        </button>
                      </div>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
            {visibleArchives.length === 0 ? (
              <tr className="border-t border-line">
                <td className="p-5 text-center text-sm font-bold text-neutral-600" colSpan={3}>
                  {loading ? text('Loading reports...', 'Memuat laporan...') : text('No generated reports for this section yet.', 'Belum ada laporan dijana untuk bahagian ini.')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="clean-scroll mt-3 hidden overflow-x-auto rounded-2xl border border-line bg-white/75 sm:block">
        <table className="dense-table w-full min-w-[780px] text-left text-xs sm:text-sm">
          <thead className="bg-paper">
            <tr>
              <th className="p-3">{text('Period', 'Tempoh')}</th>
              <th className="p-3">{text('Closing', 'Tutup')}</th>
              <th className="p-3">{text('Generated file', 'Fail dijana')}</th>
              <th className="p-3">{text('Revenue', 'Hasil')}</th>
              <th className="p-3">{text('Activity', 'Aktiviti')}</th>
              <th className="p-3">{text('Action', 'Tindakan')}</th>
            </tr>
          </thead>
          <tbody>
            {visibleArchives.map((archive) => {
              const summary = summaryOf(archive);
              const closing = closingOf(archive);
              return (
                <tr key={archive.id} className="border-t border-line hover:bg-shell">
                  <td className="p-3 whitespace-nowrap tabular-nums">
                    <span className="block font-black">{periodLabel(archive)}</span>
                    <span className="mt-1 block w-fit rounded-full bg-shell px-2 py-0.5 text-[10px] font-black text-neutral-600">{kindLabelForUi(archive.report_kind)}</span>
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    <span className={'rounded-xl px-3 py-1 text-xs font-black ' + closingBadgeClass(closing.status)}>{closingLabelForUi(closing.status)}</span>
                    {closing.totalDays > 1 ? <span className="mt-1 block text-[11px] font-bold text-neutral-500">{closing.closedDays}/{closing.totalDays} {text('days closed', 'hari ditutup')}</span> : null}
                  </td>
                  <td className="max-w-[250px] p-3">
                    <span className="block whitespace-nowrap font-black tabular-nums">{safeDateTime(archive.generated_at)}</span>
                    <span className="mt-1 block truncate text-[11px] font-bold leading-tight text-neutral-600" title={archiveDownloadName(archive)}>{archiveDownloadName(archive)}</span>
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    <span className="block font-black">{money(summary.totalRevenue, currency)}</span>
                    <span className="mt-1 block text-[11px] font-bold text-neutral-600">{text('Cash Payment', 'Bayaran Tunai')}: {money(summary.cash, currency)}</span>
                    <span className="block text-[11px] font-bold text-neutral-600">{text('QR Payment', 'Bayaran QR')}: {money(summary.qr, currency)}</span>
                    <span className="block text-[11px] font-bold text-coral">{text('FOC Value', 'Nilai FOC')}: {money(summary.focCost, currency)}</span>
                  </td>
                  <td className="p-3 whitespace-nowrap text-[11px] font-bold text-neutral-600">
                    <span className="block">{text('Transactions', 'Transaksi')}: {summary.transactions}</span>
                    <span className="block">{text('Voids', 'Batal')}: {summary.voidedSales}</span>
                    <span className={summary.qrPending > 0 ? 'block text-warning' : 'block'}>{text('QR Pending', 'QR belum sah')}: {money(summary.qrPending, currency)}</span>
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" className={secondaryButtonClass + ' dense-action justify-center'} onClick={() => setPreview(archive)}>
                        <Eye className="h-4 w-4" />
                        {text('Preview', 'Pratonton')}
                      </button>
                      <button type="button" className={secondaryButtonClass + ' dense-action justify-center'} onClick={() => downloadArchivePdf(archive, currency, toast)}>
                        <Download className="h-4 w-4" />
                        PDF
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {visibleArchives.length === 0 ? (
          <div className="border-t border-line p-5 text-center text-sm font-bold text-neutral-600">
            {loading ? text('Loading reports...', 'Memuat laporan...') : text('No generated reports for this section yet.', 'Belum ada laporan dijana untuk bahagian ini.')}
          </div>
        ) : null}
      </div>

      {preview ? (
        <Modal
          title={`${kindLabelForUi(preview.report_kind)} ${text('Operations Report', 'Laporan Operasi')} - ${periodLabel(preview)}`}
          onClose={() => setPreview(null)}
          size="wide"
          footer={
            <div className="grid w-full gap-2 sm:flex sm:justify-end">
              <button className={secondaryButtonClass} onClick={() => setPreview(null)}>{text('Close', 'Tutup')}</button>
              <button className={buttonClass} onClick={() => downloadArchivePdf(preview, currency, toast)}><Download className="h-4 w-4" />PDF</button>
            </div>
          }
        >
          <p className="mb-3 text-xs text-muted">{text(...operationsReportScope)}</p>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3"><p className="text-xs font-black text-emerald-700">{text('Cash Payment', 'Bayaran Tunai')}</p><p className="mt-1 text-lg font-black">{money(activeSummary?.cash ?? 0, currency)}</p></div>
              <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3"><p className="text-xs font-black text-sky-700">{text('QR Payment', 'Bayaran QR')}</p><p className="mt-1 text-lg font-black">{money(activeSummary?.qr ?? 0, currency)}</p></div>
              <div className="rounded-2xl border border-pink-200 bg-pink-50 p-3"><p className="text-xs font-black text-pink-700">{text('FOC Value', 'Nilai FOC')}</p><p className="mt-1 text-lg font-black text-coral">{money(activeSummary?.focCost ?? 0, currency)}</p></div>
              <div className="rounded-2xl border border-violet-200 bg-violet-50 p-3"><p className="text-xs font-black text-violet-700">{text('Total Revenue', 'Jumlah Hasil')}</p><p className="mt-1 text-lg font-black">{money(activeSummary?.totalRevenue ?? 0, currency)}</p></div>
            </div>
            <div className="rounded-2xl border border-line bg-shell p-3 text-sm font-bold text-neutral-700">
              {(() => {
                const closing = closingOf(preview);
                return (
                  <>
                    <p>
                      <span className="font-black text-ink">{text('Closing', 'Tutup')}:</span>{' '}
                      <span className={'rounded-xl px-2.5 py-1 text-xs font-black ' + closingBadgeClass(closing.status)}>{closingLabelForUi(closing.status)}</span>
                      {closing.totalDays > 1 ? <span> {closing.closedDays}/{closing.totalDays} {text('days closed', 'hari ditutup')}</span> : null}
                    </p>
                    <p className="mt-2 break-words"><span className="font-black text-ink">{text('File name', 'Nama fail')}:</span> {archiveDownloadName(preview)}</p>
                    <p className="mt-1"><span className="font-black text-ink">{text('Generated', 'Dijana')}:</span> {safeDateTime(preview.generated_at)}</p>
                  </>
                );
              })()}
            </div>
            <div className="grid gap-3">
              <PreviewTable
                title={text('Daily Closing', 'Tutup Harian')}
                rows={rowsOf(preview, 'daily_closing')}
                currency={currency}
                columns={[
                  { key: 'business_date', label: text('Date', 'Tarikh') },
                  { key: 'status', label: text('Closing', 'Tutup') },
                  { key: 'cash_payment', label: text('Cash Payment', 'Bayaran Tunai'), money: true },
                  { key: 'qr_payment', label: text('QR Payment', 'Bayaran QR'), money: true },
                  { key: 'foc_cost', label: text('FOC Value', 'Nilai FOC'), money: true },
                  { key: 'total_revenue', label: text('Total Revenue', 'Jumlah Hasil'), money: true },
                  { key: 'cash_variance', label: text('Cash variance', 'Beza tunai'), money: true },
                ]}
              />
              <PreviewTable
                title={text('Sales of All Items', 'Jualan Semua Item')}
                rows={rowsOf(preview, 'item_sales')}
                currency={currency}
                columns={[
                  { key: 'item', label: text('Item', 'Item') },
                  { key: 'quantity', label: text('Quantity', 'Kuantiti') },
                  { key: 'cash_payment', label: text('Cash Payment', 'Bayaran Tunai'), money: true },
                  { key: 'qr_payment', label: text('QR Payment', 'Bayaran QR'), money: true },
                  { key: 'foc_cost', label: text('FOC Value', 'Nilai FOC'), money: true },
                  { key: 'total_revenue', label: text('Total Revenue', 'Jumlah Hasil'), money: true },
                ]}
              />
              <PreviewTable
                title={text('Sales by Category', 'Jualan Mengikut Kategori')}
                rows={rowsOf(preview, 'category_sales')}
                currency={currency}
                columns={[
                  { key: 'category', label: text('Category', 'Kategori') },
                  { key: 'quantity', label: text('Quantity', 'Kuantiti') },
                  { key: 'cash_payment', label: text('Cash Payment', 'Bayaran Tunai'), money: true },
                  { key: 'qr_payment', label: text('QR Payment', 'Bayaran QR'), money: true },
                  { key: 'discount', label: text('Discount', 'Diskaun'), money: true, negative: true },
                  { key: 'foc_cost', label: text('FOC Value', 'Nilai FOC'), money: true },
                  { key: 'total_revenue', label: text('Total Revenue', 'Jumlah Hasil'), money: true },
                ]}
              />
              <PreviewTable
                title={text('Sale Item Details', 'Butiran Item Jualan')}
                rows={rowsOf(preview, 'sale_item_details')}
                currency={currency}
                columns={[
                  { key: 'business_date', label: text('Date', 'Tarikh') },
                  { key: 'sale_number', label: text('Sale No.', 'No. Jualan') },
                  { key: 'staff', label: text('Staff', 'Staff') },
                  { key: 'item', label: text('Item', 'Item') },
                  { key: 'quantity', label: text('Quantity', 'Kuantiti') },
                  { key: 'unit_price_at_sale', label: text('Price at sale', 'Harga semasa jualan'), money: true },
                  { key: 'discount_share', label: text('Discount', 'Diskaun'), money: true, negative: true },
                  { key: 'paid_or_foc_value', label: text('Paid / FOC value', 'Nilai bayar / FOC'), money: true },
                ]}
              />
              <PreviewTable
                title={text('QR Payment Verification', 'Semakan Bayaran QR')}
                rows={rowsOf(preview, 'qr_verification')}
                currency={currency}
                emptyText={text('No QR payments in this report.', 'Tiada bayaran QR dalam laporan ini.')}
                columns={[
                  { key: 'business_date', label: text('Date', 'Tarikh') },
                  { key: 'sale_number', label: text('Sale No.', 'No. Jualan') },
                  { key: 'staff', label: text('Staff', 'Staff') },
                  { key: 'qr_type', label: text('QR Type', 'Jenis QR') },
                  { key: 'status', label: text('Status', 'Status') },
                  { key: 'amount', label: text('Amount', 'Jumlah'), money: true },
                ]}
              />
              <PreviewTable
                title={text('Voided Sales', 'Jualan Dibatalkan')}
                rows={rowsOf(preview, 'voided_sales')}
                currency={currency}
                emptyText={text('No voided sales in this report.', 'Tiada jualan dibatalkan dalam laporan ini.')}
                columns={[
                  { key: 'business_date', label: text('Date', 'Tarikh') },
                  { key: 'sale_number', label: text('Sale No.', 'No. Jualan') },
                  { key: 'staff', label: text('Staff', 'Staff') },
                  { key: 'method', label: text('Method', 'Kaedah') },
                  { key: 'original_value', label: text('Original value', 'Nilai asal'), money: true },
                  { key: 'reason', label: text('Reason', 'Sebab') },
                ]}
              />
              <PreviewTable
                title={text('Stock In', 'Stok Masuk')}
                rows={rowsOf(preview, 'stock_in')}
                currency={currency}
                emptyText={text('No Stock In records in this report.', 'Tiada rekod Stok Masuk dalam laporan ini.')}
                columns={[
                  { key: 'business_date', label: text('Date', 'Tarikh') },
                  { key: 'product', label: text('Product', 'Produk') },
                  { key: 'units_added', label: text('Units Added', 'Unit Masuk') },
                  { key: 'input', label: text('Input', 'Input') },
                  { key: 'entered_by', label: text('Entered By', 'Diisi Oleh') },
                ]}
              />
              <PreviewTable
                title={text('Stock In Draft Proof', 'Bukti Draf Stok Masuk')}
                rows={rowsOf(preview, 'stock_in_draft_proof')}
                currency={currency}
                emptyText={text('No Stock In draft proof records in this report.', 'Tiada bukti draf Stok Masuk dalam laporan ini.')}
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
              <PreviewTable
                title={text('Stock Out / Adjustments', 'Stok Keluar / Pelarasan')}
                rows={rowsOf(preview, 'stock_out_adjustments')}
                currency={currency}
                emptyText={text('No Stock Out or adjustment records in this report.', 'Tiada rekod Stok Keluar atau pelarasan dalam laporan ini.')}
                columns={[
                  { key: 'business_date', label: text('Date', 'Tarikh') },
                  { key: 'product', label: text('Product', 'Produk') },
                  { key: 'type', label: text('Type', 'Jenis') },
                  { key: 'quantity_change_units', label: text('Change in units', 'Perubahan unit') },
                  { key: 'entered_by', label: text('Entered By', 'Diisi Oleh') },
                ]}
              />
              <PreviewTable
                title={text('Kitchen Pax Count', 'Jumlah Pax Dapur')}
                rows={rowsOf(preview, 'kitchen_pax')}
                currency={currency}
                emptyText={text('No pax records in this report.', 'Tiada rekod pax dalam laporan ini.')}
                columns={[
                  { key: 'business_date', label: text('Date', 'Tarikh') },
                  { key: 'pax_count', label: text('Pax count', 'Jumlah pax') },
                  { key: 'entered_by', label: text('Entered By', 'Diisi Oleh') },
                  { key: 'updated_at', label: text('Updated', 'Dikemas kini'), dateTime: true },
                ]}
              />
              <PreviewTable
                title={text('Kitchen Meals & Preparation', 'Hidangan & Penyediaan Dapur')}
                rows={rowsOf(preview, 'kitchen_production')}
                currency={currency}
                emptyText={text('No kitchen production in this report.', 'Tiada penyediaan dapur dalam laporan ini.')}
                columns={[
                  { key: 'business_date', label: text('Date', 'Tarikh') },
                  { key: 'platter', label: text('Set / platter', 'Set / platter') },
                  { key: 'serving_basis', label: text('Basis', 'Asas') },
                  { key: 'prepared_count', label: text('Prepared', 'Disediakan') },
                  { key: 'submitted_by', label: text('Submitted by', 'Dihantar oleh') },
                  { key: 'ingredients_deducted', label: text('Ingredients deducted', 'Bahan ditolak') },
                ]}
              />
              <PreviewTable
                title={text('Ingredient Stock Movements', 'Pergerakan Stok Bahan')}
                rows={rowsOf(preview, 'ingredient_stock_movements')}
                currency={currency}
                emptyText={text('No ingredient movements in this report.', 'Tiada pergerakan bahan dalam laporan ini.')}
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
              <PreviewTable
                title={text('Ingredient Stock Exceptions', 'Pengecualian Stok Bahan')}
                rows={ingredientExceptionRows(preview)}
                currency={currency}
                emptyText={text('No count, waste, missing, or correction records in this report.', 'Tiada rekod kiraan, rosak, hilang, atau pembetulan dalam laporan ini.')}
                columns={[
                  { key: 'type', label: text('Type', 'Jenis') },
                  { key: 'ingredient', label: text('Ingredient', 'Bahan') },
                  { key: 'category', label: text('Category', 'Kategori') },
                  { key: 'entries', label: text('Entries', 'Rekod') },
                  { key: 'net_change', label: text('Net change', 'Perubahan bersih') },
                  { key: 'latest_entry', label: text('Latest entry', 'Rekod terbaru'), dateTime: true },
                  { key: 'entered_by', label: text('Entered By', 'Diisi Oleh') },
                  { key: 'reason_or_notes', label: text('Latest reason / notes', 'Sebab / nota terbaru') },
                ]}
              />
              <PreviewTable
                title={text('Ingredient Inventory Balance', 'Baki Inventori Bahan')}
                rows={rowsOf(preview, 'ingredient_inventory_balance')}
                currency={currency}
                emptyText={text('No ingredient balances in this report.', 'Tiada baki bahan dalam laporan ini.')}
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
              <PreviewTable
                title={text('Low Ingredient Stock', 'Stok Bahan Rendah')}
                rows={rowsOf(preview, 'low_ingredient_stock')}
                currency={currency}
                emptyText={text('No low ingredient stock in this report.', 'Tiada stok bahan rendah dalam laporan ini.')}
                columns={[
                  { key: 'ingredient', label: text('Ingredient', 'Bahan') },
                  { key: 'category', label: text('Category', 'Kategori') },
                  { key: 'closing_quantity', label: text('Closing', 'Akhir') },
                  { key: 'low_alert_at', label: text('Low alert at (base unit)', 'Amaran rendah pada unit asas') },
                  { key: 'status', label: text('Status', 'Status') },
                ]}
              />
              <PreviewTable
                title={text('Inventory Balance', 'Baki Inventori')}
                rows={rowsOf(preview, 'inventory_balance')}
                currency={currency}
                emptyText={text('No inventory balance rows in this report.', 'Tiada baris baki inventori dalam laporan ini.')}
                columns={[
                  { key: 'product', label: text('Product', 'Produk') },
                  { key: 'category', label: text('Category', 'Kategori') },
                  { key: 'opening_units', label: text('Opening units', 'Unit awal') },
                  { key: 'stock_in_units', label: text('Stock in (units)', 'Stok masuk (unit)') },
                  { key: 'stock_out_units', label: text('Stock out (units)', 'Stok keluar (unit)') },
                  { key: 'closing_units', label: text('Closing units', 'Unit akhir') },
                  { key: 'status', label: text('Status', 'Status') },
                ]}
              />
              <PreviewTable
                title={text('Low Unit Stock Items', 'Item Stok Unit Rendah')}
                rows={rowsOf(preview, 'low_stock_items')}
                currency={currency}
                emptyText={text('No low unit stock items in this report.', 'Tiada item stok unit rendah dalam laporan ini.')}
                columns={[
                  { key: 'product', label: text('Product', 'Produk') },
                  { key: 'closing_balance_units', label: text('Closing balance (individual units)', 'Baki akhir (unit individu)') },
                  { key: 'low_alert_at_units', label: text('Low alert at (individual units)', 'Amaran rendah pada unit individu') },
                  { key: 'status', label: text('Status', 'Status') },
                ]}
              />
            </div>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
