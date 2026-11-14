import { movementBounds, type MovementBounds } from './barMovementHistory';
import { barPeriodRange, type BarRange } from './barReportPeriod';
import { reportMoneyCents } from './moneyAllocation';
import { readAllRows } from './readAllRows';
import type { ProductPriceHistory } from './types';

export const priceHistoryBounds = (range: BarRange) => movementBounds(range, '00:00');
function timestamp(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(value) || !barPeriodRange('day', value.slice(0, 10)).range || !Number.isFinite(Date.parse(value))) throw Error('Price-change timestamp is incomplete.');
  return Date.parse(value);
}
export function priceChanges(row: ProductPriceHistory) {
  return { price: row.old_price_per_unit !== row.new_price_per_unit, cost: row.old_cost_per_unit !== row.new_cost_per_unit };
}
export function checkedPriceHistory(rows: ProductPriceHistory[], bounds: MovementBounds): ProductPriceHistory[] {
  if (!Array.isArray(rows)) throw Error('Price history is unavailable.');
  const from = timestamp(bounds.startIso), to = timestamp(bounds.endIso), seen = new Set<string>();
  if (to <= from) throw Error('Price-history boundaries are invalid.');
  return rows.map(row => {
    if (!row || typeof row.id !== 'string' || !row.id.trim() || seen.has(row.id) || typeof row.product_id !== 'string' || !row.product_id.trim() || typeof row.product_name !== 'string' || row.changed_by !== null && (typeof row.changed_by !== 'string' || !row.changed_by.trim())) throw Error('Price-history references are incomplete.');
    seen.add(row.id);
    const time = timestamp(row.changed_at);
    if (time < from || time >= to) throw Error('Price history is outside the selected period.');
    if (row.profiles != null && (typeof row.profiles !== 'object' || Array.isArray(row.profiles) || row.profiles.full_name != null && typeof row.profiles.full_name !== 'string')) throw Error('Editor details are incomplete.');
    const amount = (value: number | null) => value === null ? null : reportMoneyCents(value) / 100;
    const checked = { ...row, old_price_per_unit: amount(row.old_price_per_unit), new_price_per_unit: amount(row.new_price_per_unit), old_cost_per_unit: amount(row.old_cost_per_unit), new_cost_per_unit: amount(row.new_cost_per_unit) };
    if (!priceChanges(checked).price && !priceChanges(checked).cost) throw Error('Price-history values do not describe a change.');
    return checked;
  });
}
export async function readPriceHistory(bounds: MovementBounds, read: (from: number, to: number) => PromiseLike<{ data: ProductPriceHistory[] | null; error: unknown }>) {
  checkedPriceHistory([], bounds);
  const seen = new Set<string>();
  return readAllRows(async (from, to) => {
    const page = await read(from, to);
    if (page.error) throw page.error;
    const data = checkedPriceHistory(page.data!, bounds);
    for (const row of data) { if (seen.has(row.id)) throw Error('Price-history pages changed. Refresh the selected period.'); seen.add(row.id); }
    return { data, error: null };
  });
}
export function priceHistoryMatches(row: ProductPriceHistory, query: string) {
  const needle = query.trim().toLowerCase();
  return !needle || [row.product_name, row.product_id, row.profiles?.full_name, row.changed_by, row.id].some(value => typeof value === 'string' && value.toLowerCase().includes(needle));
}
export function priceHistoryTime(row: ProductPriceHistory, language: 'en' | 'ms') {
  timestamp(row.changed_at);
  return new Intl.DateTimeFormat(language === 'ms' ? 'ms-MY' : 'en-GB', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(row.changed_at));
}
