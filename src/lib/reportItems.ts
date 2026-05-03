import { demoItemSales } from './demo';
import type { Sale, SaleItem } from './types';

export type ItemSalesBreakdown = {
  product: string;
  quantity: number;
  cash: number;
  qr: number;
  focCost: number;
};

type ReportTotals = {
  cash: number;
  qr: number;
  focCost: number;
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

export function scaledItemSales(totals: ReportTotals): ItemSalesBreakdown[] {
  const cashParts = distributeAmount(totals.cash, demoItemSales.map((item) => item.cash));
  const qrParts = distributeAmount(totals.qr, demoItemSales.map((item) => item.qr));
  const focParts = distributeAmount(totals.focCost, demoItemSales.map((item) => item.focCost));
  const baseValue = demoItemSales.reduce((sum, item) => sum + item.cash + item.qr + item.focCost, 0);
  const nextValue = totals.cash + totals.qr + totals.focCost;
  const quantityScale = baseValue > 0 ? nextValue / baseValue : 0;

  return demoItemSales
    .map((item, index) => {
      const rowValue = cashParts[index] + qrParts[index] + focParts[index];
      return {
        product: item.product,
        quantity: rowValue > 0 ? Math.max(1, Math.round(item.quantity * quantityScale)) : 0,
        cash: cashParts[index],
        qr: qrParts[index],
        focCost: focParts[index],
      };
    })
    .filter((item) => item.quantity > 0 || item.cash > 0 || item.qr > 0 || item.focCost > 0);
}

export type SaleWithItems = Sale & { sale_items?: SaleItem[] };

export function actualItemSales(sales: SaleWithItems[], dates?: string[]): ItemSalesBreakdown[] {
  const dateSet = dates ? new Set(dates) : null;
  const rows = new Map<string, ItemSalesBreakdown>();

  sales
    .filter((sale) => sale.status === 'completed' && (!dateSet || dateSet.has(sale.business_date)))
    .forEach((sale) => {
      const items = sale.sale_items ?? [];
      const lineTotals = items.map((item) => Number(item.line_total));
      const saleValue = Number(sale.total_amount);
      const netLines = distributeAmount(saleValue, lineTotals);

      items.forEach((item, index) => {
        const product = item.products?.name ?? item.custom_item_name ?? item.product_id ?? 'Custom Order';
        const existing = rows.get(product) ?? { product, quantity: 0, cash: 0, qr: 0, focCost: 0 };
        const value = netLines[index] ?? 0;
        existing.quantity += Number(item.quantity);
        if (sale.payment_method === 'cash') existing.cash += value;
        if (sale.payment_method === 'qr') existing.qr += value;
        if (sale.payment_method === 'complimentary') existing.focCost += value;
        rows.set(product, existing);
      });
    });

  return Array.from(rows.values());
}
