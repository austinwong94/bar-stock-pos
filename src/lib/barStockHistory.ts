import type { Sale, SaleItem, StockMovement } from './types';
import { readAllRows } from './readAllRows';

export function stockReceivedLabel(movement: StockMovement, text: (en: string, ms: string) => string) {
  const units = Number(movement.quantity_change);
  if (!Number.isSafeInteger(units) || units <= 0) throw new Error('Stock quantities are incomplete. Reload the source records.');
  if (movement.unit_input !== 'carton') return `${units} ${units === 1 ? text('Unit', 'Unit') : text('Units', 'Unit')}`;
  let cartons = movement.input_quantity == null ? null : Number(movement.input_quantity);
  const size = Number(movement.carton_size_at_time);
  if (cartons === null && Number.isSafeInteger(size) && size > 0 && Number.isSafeInteger(units / size)) cartons = units / size;
  return cartons !== null && Number.isSafeInteger(cartons) && cartons > 0 && (!(size > 0) || cartons * size === units)
    ? `${cartons} ${cartons === 1 ? text('Carton', 'Karton') : text('Cartons', 'Karton')}`
    : text('Carton Count Unavailable', 'Bilangan Karton Tidak Tersedia');
}

type ItemReader = (saleIds: string[], from: number, to: number) => PromiseLike<{ data: SaleItem[] | null; error: unknown }>;
export async function attachStockSaleItems(sales: Sale[], read: ItemReader): Promise<Array<Sale & { sale_items: SaleItem[] }>> {
  const grouped = new Map<string, SaleItem[]>();
  for (const sale of sales) {
    if (!sale.id || grouped.has(sale.id)) throw new Error('Sale references are incomplete. Reload the source records.');
    grouped.set(sale.id, []);
  }
  const seen = new Set<string>();
  for (let start = 0; start < sales.length; start += 150) {
    const ids = sales.slice(start, start + 150).map(sale => sale.id);
    const allowed = new Set(ids);
    const items = await readAllRows((from, to) => read(ids, from, to));
    for (const item of items) {
      if (!item.id || seen.has(item.id) || !allowed.has(item.sale_id)) throw new Error('Sale item records are inconsistent. Reload the source records.');
      seen.add(item.id);
      grouped.get(item.sale_id)!.push(item);
    }
  }
  return sales.map(sale => {
    const sale_items = grouped.get(sale.id)!;
    if (sale.status === 'completed' && !sale_items.length) throw new Error('Sale items are missing. Reload the source records.');
    return { ...sale, sale_items };
  });
}
