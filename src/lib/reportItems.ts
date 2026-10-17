import { malaysiaBusinessDateInputValue } from './format';
import type { Sale, SaleItem } from './types';

export type ItemSalesBreakdown = {
  product: string;
  quantity: number;
  cash: number;
  qr: number;
  focCost: number;
  discount: number;
};

type ReportTotals = {
  cash: number;
  qr: number;
  focCost: number;
  discount: number;
};

function distributeAmount(total: number, weights: number[]) {
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

export type SaleWithItems = Sale & { sale_items?: SaleItem[] };

export function actualItemSales(sales: SaleWithItems[], dates?: string[], businessCloseTime: string | number | boolean | null | undefined = '00:00'): ItemSalesBreakdown[] {
  const dateSet = dates ? new Set(dates) : null;
  const rows = new Map<string, ItemSalesBreakdown>();

  sales
    .filter((sale) => {
      if (sale.status !== 'completed') return false;
      if (!dateSet) return true;
      const saleDate = sale.business_date || (sale.created_at ? malaysiaBusinessDateInputValue(sale.created_at, businessCloseTime) : '');
      return dateSet.has(saleDate);
    })
    .forEach((sale) => {
      const items = sale.sale_items ?? [];
      const lineTotals = items.map((item) => Number(item.line_total));
      const saleValue = Number(sale.total_amount);
      const netLines = distributeAmount(saleValue, lineTotals);
      const discounts = distributeAmount(Number(sale.discount_amount ?? 0), lineTotals);

      items.forEach((item, index) => {
        const product = item.products?.name ?? item.custom_item_name ?? item.product_id ?? 'Custom Order';
        const existing = rows.get(product) ?? { product, quantity: 0, cash: 0, qr: 0, focCost: 0, discount: 0 };
        const value = netLines[index] ?? 0;
        existing.quantity += Number(item.quantity);
        if (sale.payment_method === 'cash') existing.cash += value;
        if (sale.payment_method === 'qr') existing.qr += value;
        if (sale.payment_method === 'complimentary') existing.focCost += value;
        existing.discount += discounts[index] ?? 0;
        rows.set(product, existing);
      });
    });

  return Array.from(rows.values());
}
