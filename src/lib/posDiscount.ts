import { moneyCents } from './purchaseReceiptMath';

export type DiscountIssue = 'subtotal' | 'precision' | 'excess' | 'rate';
export function posMoneyCents(raw: string) {
  const value = raw.trim();
  return moneyCents(value.startsWith('.') ? '0' + value : value);
}
export function cartDiscount(subtotal: number, rate: number | null, amount: string): {amount: number | null; issue: DiscountIssue | null} {
  const cents = Math.round(subtotal * 100);
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > 999999999999 || subtotal !== cents / 100) return {amount: null, issue: 'subtotal'};
  if (rate === null) {
    const entered = amount.trim() ? posMoneyCents(amount) : 0;
    if (entered === null) return {amount: null, issue: 'precision'};
    if (entered > cents) return {amount: null, issue: 'excess'};
    return {amount: entered / 100, issue: null};
  }
  const percent = Math.round(rate * 100);
  if (!Number.isInteger(percent) || percent < 0 || percent > 100 || rate !== percent / 100) return {amount: null, issue: 'rate'};
  return {amount: Math.floor((cents * percent + 50) / 100) / 100, issue: null};
}
