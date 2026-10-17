import type { IngredientMovement } from './types';
import type { HistoryCursor, HistoryPage } from './foodStockHistory';
import { countDisplay, countUnit } from './stockCount';
import { stockOutReasons } from './stockOut';

type Text = (en: string, ms: string) => string;
export type FoodHistoryItem = { id: string; name: string; kitchen_label?: string | null; base_unit: string };
export type FoodItemHistoryPage = HistoryPage & { item: FoodHistoryItem; anchor: IngredientMovement | null };
export type FoodItemHistoryArgs = {
  p_ingredient_id: string; p_anchor_id?: string | null;
  p_before_created_at?: string | null; p_before_id?: string | null; p_limit?: number;
};

export function movementAmount(row: IngredientMovement, quantity: number) {
  return row.display_factor && row.display_factor > 0 && row.display_unit
    ? (Number(quantity) / row.display_factor).toLocaleString('en-MY', { maximumFractionDigits: 5 }) + ' ' + row.display_unit
    : `${countDisplay(Number(quantity), row.ingredient_items?.base_unit ?? '')} ${countUnit(row.ingredient_items?.base_unit ?? '')}`;
}

export function countOutcome(row: IngredientMovement, t: Text) {
  return Number(row.quantity_change) < 0 ? t('Short', 'Kurang')
    : Number(row.quantity_change) > 0 ? t('Extra', 'Lebih') : t('Matched', 'Sepadan');
}

export function foodMovementName(row: IngredientMovement, t: Text) {
  if (row.movement_type === 'count') return t('Stock Count', 'Kiraan Stok');
  if (row.movement_type === 'kitchen_production') {
    if (row.reason === 'Snorkelling Mineral Water') return t('Snorkelling Water', 'Air Snorkelling');
    if (row.reason === 'Daily Kitchen Usage') return t('Daily Food Stock Out', 'Stok Keluar Makanan Harian');
    const purpose = row.reason?.match(/^(Guest Meals|Staff Meals)(?: \/ (.*))?$/);
    if (purpose) return (purpose[1] === 'Guest Meals' ? t('Guest Meals', 'Makanan Tetamu') : t('Staff Meals', 'Makanan Staf')) + (purpose[2] ? ' / ' + purpose[2] : '');
    return t('Meal Preparation', 'Penyediaan Makanan') + (row.reason ? ' / ' + row.reason : '');
  }
  if (row.movement_type === 'stock_in') return t('Stock In', 'Stok Masuk');
  const reason = stockOutReasons.find(([value]) => value === row.reason);
  if (reason) return t(reason[0], reason[1]);
  const labels: Record<string, string> = {
    sale: t('Sale', 'Jualan'), complimentary: 'FOC', void_sale: t('Voided Sale', 'Jualan Dibatalkan'),
    waste: t('Wastage', 'Pembaziran'), adjustment: t('Adjustment', 'Pelarasan'),
  };
  return row.reason || labels[row.movement_type] || row.movement_type;
}

const compare = (a: HistoryCursor, b: HistoryCursor) => Date.parse(a.created_at) - Date.parse(b.created_at) || (a.id === b.id ? 0 : a.id < b.id ? -1 : 1);
// Mirror the cloud's exact-item filter and stable cursor, including identical timestamps.
export function localFoodItemHistory(rows: IngredientMovement[], item: FoodHistoryItem, args: FoodItemHistoryArgs): FoodItemHistoryPage {
  const limit = args.p_limit ?? 50;
  if (item.id !== args.p_ingredient_id || !Number.isInteger(limit) || limit < 1 || limit > 100
    || !!args.p_before_created_at !== !!args.p_before_id
    || (args.p_before_created_at && !Number.isFinite(Date.parse(args.p_before_created_at)))) throw new Error('Check the item history filters.');
  const own = rows.filter(row => row.ingredient_id === item.id);
  const anchor = args.p_anchor_id ? own.find(row => row.id === args.p_anchor_id) : null;
  if (args.p_anchor_id && !anchor) throw new Error('This stock record is unavailable. Refresh the history.');
  const cursor = args.p_before_created_at && args.p_before_id ? { created_at: args.p_before_created_at, id: args.p_before_id } : null;
  const filtered = own.filter(row => (!anchor || compare(row, anchor) <= 0) && (!cursor || compare(row, cursor) < 0)).sort((a, b) => compare(b, a));
  const page = filtered.slice(0, limit), last = page[page.length - 1];
  return { item, anchor: anchor ?? null, rows: page, next: filtered.length > limit && last ? { id: last.id, created_at: last.created_at } : null };
}
