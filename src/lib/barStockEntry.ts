export type BarStockEntry = { quantity: string; unit: 'can' | 'carton'; cost: string; cartonSize?: number; name?: string };

export function barStockQuantity(value: string) {
  const quantity = Number(value);
  return /^\d+$/.test(value.trim()) && Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 0;
}

export function barStockEntryIssue(entry: BarStockEntry, cartonSize: number): 'quantity' | 'carton' | 'cost' | null {
  if (!entry.quantity.trim() && !entry.cost.trim()) return null;
  const quantity = barStockQuantity(entry.quantity);
  if (!quantity || quantity > 2147483647) return 'quantity';
  if (entry.unit === 'carton' && (entry.cartonSize !== cartonSize || !Number.isSafeInteger(cartonSize) || cartonSize < 2)) return 'carton';
  if (quantity * (entry.unit === 'carton' ? cartonSize : 1) > 2147483647) return 'quantity';
  if (entry.cost.trim() && (!/^\d+(\.\d{1,2})?$/.test(entry.cost.trim()) || !Number.isSafeInteger(Math.round(Number(entry.cost) * 100)))) return 'cost';
  return null;
}

export function changeBarStockUnit(entry: BarStockEntry, unit: BarStockEntry['unit']): BarStockEntry {
  return unit === entry.unit ? entry : { ...entry, unit, quantity: '', cartonSize: undefined };
}
