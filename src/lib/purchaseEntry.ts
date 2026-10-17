export type PurchaseEntry = { quantity: string; cost: string };
export const hasPurchaseEntry = (entry?: PurchaseEntry) => !!(entry?.quantity.trim() || entry?.cost.trim());
export const validPurchaseDecimal = (value: string, positive: boolean) => /^\d+(\.\d{1,2})?$/.test(value.trim())
  && Number.isFinite(Number(value)) && (positive ? Number(value) > 0 : Number(value) >= 0);

export function purchaseEntryIssues(entry: PurchaseEntry, remaining: number) {
  if (!hasPurchaseEntry(entry)) return { quantity: null, cost: false };
  return {
    quantity: !validPurchaseDecimal(entry.quantity, true) ? 'invalid' : Number(entry.quantity) > remaining ? 'exceeds' : null,
    cost: entry.cost.trim() !== '' && !validPurchaseDecimal(entry.cost, false),
  };
}
