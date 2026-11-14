import { addDays, format, parseISO } from 'date-fns';
import { barPeriodRange, type BarRange } from './barReportPeriod';
import { stockReceivedLabel } from './barStockHistory';
import { malaysiaBusinessDateInputValue, malaysiaDateInputValue } from './format';
import { readAllRows } from './readAllRows';
import type { StockMovement } from './types';

export const movementTypes = ['stock_in', 'sale', 'complimentary', 'void_sale', 'adjustment'] as const;
export type MovementBounds = { startIso: string; endIso: string };
type Translate = (en: string, ms: string) => string;

export function movementBounds(range: BarRange, closeTime: unknown): MovementBounds {
  if (!barPeriodRange('custom', range.from, range.to).range || typeof closeTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(:00)?$/.test(closeTime)) throw new Error('Movement period or business settings are unavailable.');
  const next = addDays(parseISO(range.to), 1);
  if (next.getFullYear() > 9999) throw new Error('Movement period is outside the supported calendar.');
  // Construct both Malaysian boundaries explicitly; the device's DST must not change a business day.
  const at = (day: string) => new Date(`${day}T${closeTime.slice(0, 5)}:00+08:00`).toISOString();
  return { startIso: at(range.from), endIso: at(format(next, 'yyyy-MM-dd')) };
}

function timestamp(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(value) || !barPeriodRange('day', value.slice(0, 10)).range || !Number.isFinite(Date.parse(value))) throw new Error('Movement timestamps are incomplete.');
  return Date.parse(value);
}

export function checkedMovements(rows: StockMovement[], bounds: MovementBounds): StockMovement[] {
  if (!Array.isArray(rows)) throw new Error('Movement records are unavailable.');
  const start = timestamp(bounds.startIso), end = timestamp(bounds.endIso);
  if (end <= start) throw new Error('Movement boundaries are invalid.');
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || !row.id.trim() || seen.has(row.id) || !movementTypes.includes(row.movement_type)) throw new Error('Movement references are inconsistent.');
    seen.add(row.id);
    for (const quantity of [row.quantity_change, row.quantity_before, row.quantity_after]) if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < -2147483648 || quantity > 2147483647) throw new Error('Movement balances are incomplete.');
    if (row.quantity_before + row.quantity_change !== row.quantity_after) throw new Error('Movement balances do not reconcile.');
    if ((row.movement_type === 'stock_in' || row.movement_type === 'void_sale') && row.quantity_change <= 0 || (row.movement_type === 'sale' || row.movement_type === 'complimentary') && row.quantity_change >= 0) throw new Error('Movement direction is inconsistent.');
    for (const value of [row.product_id, row.entered_by, row.reason, row.notes, row.reference_type, row.reference_id]) if (value != null && typeof value !== 'string') throw new Error('Movement details are incomplete.');
    if (row.products != null && (typeof row.products !== 'object' || Array.isArray(row.products) || row.products.name != null && typeof row.products.name !== 'string')) throw new Error('Movement product details are incomplete.');
    if (row.unit_input != null && !['can', 'carton', 'system'].includes(row.unit_input)) throw new Error('Movement input units are invalid.');
    const created = timestamp(row.created_at);
    if (created < start || created >= end) throw new Error('Movement records do not match the selected period.');
  }
  return rows;
}

export async function readBarMovements(bounds: MovementBounds, read: (from: number, to: number) => PromiseLike<{ data: StockMovement[] | null; error: unknown }>) {
  checkedMovements([], bounds);
  const seen = new Set<string>();
  return readAllRows(async (from, to) => {
    const page = await read(from, to);
    if (page.error) return page;
    checkedMovements(page.data!, bounds);
    for (const row of page.data!) {
      if (seen.has(row.id)) throw new Error('Movement pages changed. Refresh the selected period.');
      seen.add(row.id);
    }
    return page;
  });
}

export function movementLabel(type: StockMovement['movement_type'], text: Translate) {
  const labels: Record<StockMovement['movement_type'], [string, string]> = { stock_in: ['Stock In', 'Stok Masuk'], sale: ['Sale', 'Jualan'], complimentary: ['FOC', 'FOC'], void_sale: ['Void Return', 'Pulangan Batal'], adjustment: ['Adjustment', 'Pelarasan'] };
  return text(...labels[type]);
}

export function movementInputLabel(row: StockMovement, text: Translate) {
  if (row.unit_input === 'carton') {
    if (row.movement_type === 'stock_in') return stockReceivedLabel(row, text);
    const quantity = row.input_quantity;
    return typeof quantity === 'number' && Number.isSafeInteger(quantity) && quantity >= 0 ? `${quantity} ${quantity === 1 ? text('Carton', 'Karton') : text('Cartons', 'Karton')}` : text('Carton Count Unavailable', 'Bilangan Karton Tidak Tersedia');
  }
  if (row.unit_input === 'can') {
    const quantity = row.input_quantity;
    return typeof quantity === 'number' && Number.isSafeInteger(quantity) && quantity >= 0 ? `${quantity} ${quantity === 1 ? text('Unit', 'Unit') : text('Units', 'Unit')}` : text('Input Not Recorded', 'Input Tidak Direkod');
  }
  return '-';
}

export function movementNotes(row: StockMovement) {
  return [...new Set([row.reason, row.notes].filter((s): s is string => typeof s === 'string' && !!s.trim()).map(s => s.trim()))];
}

export function movementMatches(row: StockMovement, query: string) {
  const needle = query.trim().toLocaleLowerCase();
  return !needle || [row.products?.name, row.product_id, row.entered_by, row.reference_type, row.reference_id, row.id, ...movementNotes(row)].some(value => typeof value === 'string' && value.toLocaleLowerCase().includes(needle));
}

export function movementTime(row: StockMovement, language: 'en' | 'ms') {
  timestamp(row.created_at);
  return new Intl.DateTimeFormat(language === 'ms' ? 'ms-MY' : 'en-GB', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(row.created_at));
}

export function movementBusinessDate(row: StockMovement, closeTime: string) {
  const date = malaysiaBusinessDateInputValue(row.created_at, closeTime);
  return { date, crossesMidnight: date !== malaysiaDateInputValue(row.created_at) };
}
