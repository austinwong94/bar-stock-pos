import type { InventoryBaseUnit } from './types';

export function fixedDeliveryUnit(unit: string): { baseUnit: InventoryBaseUnit; size: number } | null {
  switch (unit.trim().toLowerCase()) {
    case 'kg': return { baseUnit: 'g', size: 1000 };
    case 'g': return { baseUnit: 'g', size: 1 };
    case 'l': return { baseUnit: 'ml', size: 1000 };
    case 'ml': return { baseUnit: 'ml', size: 1 };
    case 'pcs': case 'pc': case 'unit': case 'units': case 'biji': case 'ekor': return { baseUnit: 'unit', size: 1 };
    default: return null;
  }
}

export const measuredPieceDelivery = (unit: string, baseUnit: string) => ['kg', 'g'].includes(unit.trim().toLowerCase()) && baseUnit === 'unit';
export const deliveredStockQuantity = (line: { quantity: number; base_per_unit: number | null; measured_pieces?: number | null }) => line.measured_pieces ?? Math.round(line.quantity * Number(line.base_per_unit) * 100) / 100;

export function deliveryLineError(unit: string, baseUnit: InventoryBaseUnit, quantity: number, size: number | null, remaining: number, fractional = false, quantityDecimals = 2, pieces?: number | null) {
  const scale = 10 ** quantityDecimals;
  if (!Number.isFinite(quantity) || quantity <= 0 || Math.abs(quantity * scale - Math.round(quantity * scale)) > 1e-8) return quantityDecimals === 4 ? 'quantity4' : 'quantity';
  if (quantity > remaining) return 'exceeds';
  if (measuredPieceDelivery(unit, baseUnit)) return Number.isSafeInteger(pieces) && Number(pieces) > 0 && Number(pieces) < 1e12 && size == null ? null : 'pieces';
  if (pieces != null) return 'unit';
  if (size == null || !Number.isFinite(size) || size <= 0 || Math.abs(size * 10000 - Math.round(size * 10000)) > 1e-8) return 'size';
  const fixed = fixedDeliveryUnit(unit);
  if (fixed && (fixed.baseUnit !== baseUnit || size !== fixed.size)) return 'unit';
  const base = quantity * size;
  if (!Number.isFinite(base) || base <= 0 || base >= 1e12 || Math.abs(base * 100 - Math.round(base * 100)) > 1e-7) return 'precision';
  if (baseUnit === 'unit' && !fractional && Math.abs(base - Math.round(base)) > 1e-8) return 'whole';
  return null;
}

export const deliveryErrorLabels: Record<string, [string, string]> = {
  pieces: ['Count and enter the actual pieces received.', 'Kira dan masukkan bilangan sebenar yang diterima.'],
  quantity4: ['Enter a positive delivered quantity, with up to four decimal places.', 'Masukkan kuantiti dihantar yang positif, sehingga empat tempat perpuluhan.'],
  quantity: ['Enter a positive delivered quantity, with up to two decimal places.', 'Masukkan kuantiti dihantar yang positif, sehingga dua tempat perpuluhan.'],
  exceeds: ['Quantity exceeds what is still outstanding.', 'Kuantiti melebihi baki yang belum diterima.'],
  size: ['Enter the actual pack size, with up to four decimal places.', 'Masukkan saiz pek sebenar, sehingga empat tempat perpuluhan.'],
  unit: ['The inventory unit does not match the purchase unit.', 'Unit inventori tidak sepadan dengan unit pembelian.'],
  precision: ['Stock added must be positive and exact to two decimal places.', 'Stok masuk mesti positif dan tepat sehingga dua tempat perpuluhan.'],
  whole: ['Individual stock must add up to whole units.', 'Stok individu mesti berjumlah unit penuh.'],
  ingredient: ['Choose an active inventory item.', 'Pilih item inventori yang aktif.'],
};
