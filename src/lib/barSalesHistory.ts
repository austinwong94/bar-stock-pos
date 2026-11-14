import { barPeriodRange } from './barReportPeriod';
import { allocateSaleItems, reportMoneyCents } from './moneyAllocation';
import type { Sale, SaleItem } from './types';

export type HistorySale = Sale & { sale_items: SaleItem[] };
function saleTimestamp(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(value) || !barPeriodRange('day', value.slice(0, 10)).range || !Number.isFinite(Date.parse(value))) throw new Error('Sale timestamps are incomplete.');
}

export function checkedHistorySales(rows: Array<Sale & { sale_items?: SaleItem[] }>, date: string): HistorySale[] {
  if (!barPeriodRange('day', date).range || !Array.isArray(rows)) throw new Error('Sales history is unavailable.');
  const ids = new Set<string>(), itemIds = new Set<string>();
  const result = rows.map(sale => {
    if (!sale || typeof sale.id !== 'string' || !sale.id.trim() || ids.has(sale.id) || typeof sale.sale_number !== 'string' || !sale.sale_number.trim() || sale.business_date !== date || !['cash', 'qr', 'complimentary'].includes(sale.payment_method) || !['completed', 'voided'].includes(sale.status)) throw new Error('Sale references are inconsistent.');
    ids.add(sale.id); saleTimestamp(sale.created_at);
    for (const value of [sale.order_taken_by, sale.table_number, sale.qr_reference, sale.qr_payment_type, sale.qr_receipt_image_path, sale.void_reason, sale.voided_at, sale.complimentary_reason]) if (value != null && typeof value !== 'string') throw new Error('Sale details are incomplete.');
    if (!['not_required', 'pending', 'verified', 'mismatch'].includes(sale.qr_status)) throw new Error('QR status is incomplete.');
    const total = reportMoneyCents(sale.total_amount), paid = reportMoneyCents(sale.paid_amount), discount = reportMoneyCents(sale.discount_amount);
    if (paid !== (sale.payment_method === 'complimentary' ? 0 : total)) throw new Error('Paid amount does not reconcile.');
    if (!Array.isArray(sale.sale_items) || (sale.status === 'completed' && !sale.sale_items.length)) throw new Error('Sale items are unavailable.');
    const items = sale.sale_items.map(item => {
      if (!item || typeof item.id !== 'string' || !item.id || itemIds.has(item.id) || item.sale_id !== sale.id || !Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > 2147483647) throw new Error('Sale item references or quantities are incomplete.');
      itemIds.add(item.id);
      if (item.product_id != null && typeof item.product_id !== 'string' || item.custom_item_name != null && typeof item.custom_item_name !== 'string' || item.products != null && (typeof item.products !== 'object' || Array.isArray(item.products) || item.products.name != null && typeof item.products.name !== 'string')) throw new Error('Sale item names are incomplete.');
      return { ...item, unit_price: reportMoneyCents(item.unit_price) / 100, line_total: reportMoneyCents(item.line_total) / 100 };
    });
    if (items.length) allocateSaleItems(total / 100, discount / 100, items.map(item => item.line_total));
    return { ...sale, total_amount: total / 100, paid_amount: paid / 100, discount_amount: discount / 100, sale_items: items };
  });
  historyTotals(result);
  return result;
}

export function historyTotals(sales: HistorySale[]) {
  const sums = { cash: 0n, qr: 0n, focCost: 0n, revenue: 0n };
  let transactions = 0, voided = 0;
  for (const sale of sales) {
    if (sale.status === 'voided') { voided++; continue; }
    transactions++;
    const paid = BigInt(reportMoneyCents(sale.paid_amount));
    if (sale.payment_method === 'cash') sums.cash += paid;
    if (sale.payment_method === 'qr') sums.qr += paid;
    if (sale.payment_method === 'complimentary') sums.focCost += BigInt(reportMoneyCents(sale.total_amount));
    else sums.revenue += paid;
  }
  for (const sum of Object.values(sums)) if (sum > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Sales totals exceed supported precision.');
  return { cash: Number(sums.cash) / 100, qr: Number(sums.qr) / 100, focCost: Number(sums.focCost) / 100, revenue: Number(sums.revenue) / 100, transactions, voided };
}

export function saleFingerprint(sale: HistorySale) {
  return JSON.stringify([sale.id, sale.business_date, sale.sale_number, sale.status, sale.payment_method, sale.total_amount, sale.paid_amount, sale.discount_amount, sale.created_at, sale.order_taken_by, sale.table_number, sale.qr_status, sale.qr_reference, sale.qr_payment_type, sale.qr_receipt_image_path, sale.void_reason, sale.voided_at, sale.complimentary_reason, sale.sale_items]);
}
export function historyItemName(item: SaleItem) {
  return item.products?.name?.trim() || item.custom_item_name?.trim() || item.product_id || '';
}
export function saleMatches(sale: HistorySale, query: string) {
  const needle = query.trim().toLowerCase();
  return !needle || [sale.sale_number, sale.order_taken_by, sale.table_number, sale.qr_reference, sale.void_reason, ...sale.sale_items.map(historyItemName)].some(value => typeof value === 'string' && value.toLowerCase().includes(needle));
}
export function saleTime(sale: Sale, language: 'en' | 'ms') {
  saleTimestamp(sale.created_at);
  return new Intl.DateTimeFormat(language === 'ms' ? 'ms-MY' : 'en-GB', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(sale.created_at));
}

export function receiptSource(path: unknown, cloud: boolean): { kind: 'stored'; path: string } | { kind: 'local'; path: string } {
  if (typeof path !== 'string' || !path || path !== path.trim()) throw new Error('Receipt path is unavailable.');
  if (!cloud && (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(path) || path.startsWith('demo/'))) return { kind: 'local', path };
  if (/[:?#\\\x00-\x1f\x7f]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Receipt path is invalid.');
  if (cloud && path.startsWith('demo/')) throw new Error('Sample receipt is not cloud evidence.');
  return { kind: 'stored', path };
}
export function signedReceiptUrl(value: unknown, path: string) {
  if (typeof value !== 'string') throw new Error('Receipt URL is unavailable.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || decodeURIComponent(url.pathname) !== '/storage/v1/object/sign/payment-receipts/' + path) throw new Error('Receipt URL does not match the selected attachment.');
  return value;
}
