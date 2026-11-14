import { malaysiaBusinessDateInputValue } from './format';
import type { Sale, SaleItem } from './types';
import { allocateSaleItems } from './moneyAllocation';

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
      if (!items.length) throw new Error('Sale items are missing. Reload the source records.');
      const lineTotals = items.map((item) => item.line_total);
      const { netLines, discounts } = allocateSaleItems(sale.total_amount, sale.discount_amount ?? 0, lineTotals);

      items.forEach((item, index) => {
        if (!Number.isSafeInteger(Number(item.quantity)) || Number(item.quantity) <= 0) throw new Error('Sale quantities are incomplete. Reload the source records.');
        const product = item.products?.name ?? item.custom_item_name ?? item.product_id ?? 'Custom Order';
        const existing = rows.get(product) ?? { product, quantity: 0, cash: 0, qr: 0, focCost: 0, discount: 0 };
        const value = netLines[index] ?? 0;
        existing.quantity += Number(item.quantity);
        if (sale.payment_method === 'cash') existing.cash = (Math.round(existing.cash * 100) + Math.round(value * 100)) / 100;
        if (sale.payment_method === 'qr') existing.qr = (Math.round(existing.qr * 100) + Math.round(value * 100)) / 100;
        if (sale.payment_method === 'complimentary') existing.focCost = (Math.round(existing.focCost * 100) + Math.round(value * 100)) / 100;
        existing.discount = (Math.round(existing.discount * 100) + Math.round((discounts[index] ?? 0) * 100)) / 100;
        rows.set(product, existing);
      });
    });

  return Array.from(rows.values());
}
