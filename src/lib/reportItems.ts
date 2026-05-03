import { demoItemSales } from './demo';

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
