import type { ProductWithStock } from './types';

export type StockStatus = 'available' | 'low' | 'inactive' | 'unavailable' | 'alert-unset' | 'recipe' | 'recipe-needed';
export type StockViewRow = { product: ProductWithStock; balance: number | null; threshold: number | null; recipe: boolean; status: StockStatus };
function stockInteger(value: unknown): number | null {
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^-?\d+$/.test(String(value).trim())) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= -2147483648 && number <= 2147483647 ? number : null;
}
export function barStockRows(products: ProductWithStock[], recipes: Set<string>): StockViewRow[] {
  if (!Array.isArray(products)) throw new Error('Product records are unavailable.');
  const seen = new Set<string>();
  return products.map(product => {
    if (!product || typeof product.id !== 'string' || !product.id || seen.has(product.id) || typeof product.name !== 'string' || !product.name.trim() || typeof product.active !== 'boolean') throw new Error('Product records are incomplete.');
    seen.add(product.id);
    const hasRecipe = recipes.has(product.id), recipe = hasRecipe || product.categories?.name === 'Cocktail';
    const balance = recipe ? null : stockInteger(product.inventory_balances?.quantity_on_hand);
    const thresholdValue = stockInteger(product.low_stock_threshold);
    const threshold = recipe || thresholdValue === null || thresholdValue < 0 ? null : thresholdValue;
    const status: StockStatus = !product.active ? 'inactive' : recipe ? hasRecipe ? 'recipe' : 'recipe-needed' : balance === null ? 'unavailable' : threshold === null ? 'alert-unset' : balance <= threshold ? 'low' : 'available';
    return { product, balance, threshold, recipe, status };
  });
}
export function stockViewSummary(rows: StockViewRow[]) {
  const active = rows.filter(row => row.product.active), physical = active.filter(row => !row.recipe);
  const unknown = physical.filter(row => row.balance === null || row.threshold === null).length;
  return { products: active.length, units: physical.some(row => row.balance === null) ? null : physical.reduce((sum, row) => sum + row.balance!, 0), low: unknown ? null : physical.filter(row => row.status === 'low').length, unknown };
}
export function stockStatusLabel(status: StockStatus, text: (en: string, ms: string) => string) {
  const labels: Record<StockStatus, [string, string]> = { available: ['Available', 'Tersedia'], low: ['Low', 'Rendah'], inactive: ['Inactive', 'Tidak Aktif'], unavailable: ['Unverified', 'Belum Disahkan'], 'alert-unset': ['Alert Not Set', 'Amaran Belum Ditetapkan'], recipe: ['Recipe', 'Resipi'], 'recipe-needed': ['Recipe Needed', 'Perlu Resipi'] };
  return text(...labels[status]);
}
export function barCategoryLabel(name: string | null | undefined, text: (en: string, ms: string) => string) {
  const category = name === 'Other' || !name ? 'Others' : name;
  const labels: Record<string, string> = { Beer: 'Bir', 'Soft Drink': 'Minuman Ringan', Food: 'Makanan', Cocktail: 'Koktel', Others: 'Lain-Lain' };
  return text(category, labels[category] ?? category);
}
export function overviewMoneyCents(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).length > 32 || !/^\d+(\.\d{1,2})?$/.test(String(value).trim())) throw new Error('Overview amounts are incomplete.');
  const number = Number(value), cents = Math.round(number * 100);
  if (!Number.isSafeInteger(cents) || number !== cents / 100) throw new Error('Overview amounts are invalid.');
  return cents;
}
export type OverviewTotals = { cash: number; qr: number; focCost: number; tx: number; paidRevenue: number };
export function readBarOverview(value: unknown): { totals: OverviewTotals; soldToday: Record<string, number> } {
  const record = value as { totals?: Record<string, unknown>; soldToday?: Record<string, unknown> } | null;
  if (!record || !record.totals || typeof record.totals !== 'object' || Array.isArray(record.totals) || !record.soldToday || typeof record.soldToday !== 'object' || Array.isArray(record.soldToday)) throw new Error('Overview response is incomplete.');
  const totals = record.totals, cash = overviewMoneyCents(totals.cash), qr = overviewMoneyCents(totals.qr), focCost = overviewMoneyCents(totals.focCost), paidRevenue = overviewMoneyCents(totals.paidRevenue);
  if (!Number.isSafeInteger(totals.tx) || Number(totals.tx) < 0 || cash + qr !== paidRevenue) throw new Error('Overview totals do not reconcile.');
  const sold = Object.entries(record.soldToday).map(([id, count]) => {
    if (!id || !Number.isSafeInteger(count) || Number(count) < 0) throw new Error('Sold quantities are incomplete.');
    return [id, Number(count)] as const;
  });
  return { totals: { cash: cash / 100, qr: qr / 100, focCost: focCost / 100, paidRevenue: paidRevenue / 100, tx: Number(totals.tx) }, soldToday: Object.fromEntries(sold) };
}
