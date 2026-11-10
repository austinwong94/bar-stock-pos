import { moneyCents } from './purchaseReceiptMath';

export type ProductForm = {
  id?: string;
  name: string;
  category_id: string;
  price_per_unit: string;
  cost_per_unit: string;
  carton_size: string;
  low_stock_threshold: string;
  image_url: string;
  active: boolean;
  source_updated_at?: string;
};

export const blankProductForm = (): ProductForm => ({
  name: '', category_id: '', price_per_unit: '', cost_per_unit: '',
  carton_size: '', low_stock_threshold: '0', image_url: '', active: true,
});

function wholeNumber(raw: string, minimum: number): number | null {
  const value = raw.trim();
  if (!/^\d{1,10}$/.test(value)) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= 2147483647 ? number : null;
}

export function parseProductForm(form: ProductForm) {
  const price = moneyCents(form.price_per_unit);
  const cost = form.cost_per_unit.trim() ? moneyCents(form.cost_per_unit) : null;
  const carton = wholeNumber(form.carton_size, 1);
  const threshold = wholeNumber(form.low_stock_threshold, 0);
  if (!form.name.trim()) return { error: 'Enter a product name.' } as const;
  if (!form.category_id) return { error: 'Choose a category before saving.' } as const;
  if (price === null) return { error: 'Enter the selling price in RM, with no more than 2 decimal places.' } as const;
  if (form.cost_per_unit.trim() && cost === null) return { error: 'Enter a valid cost in RM, with no more than 2 decimal places.' } as const;
  if (carton === null) return { error: 'Enter a whole number of units per carton, or choose No Carton.' } as const;
  if (threshold === null) return { error: 'Enter a whole-number stock alert. Use 0 for no alert.' } as const;
  return { payload: {
    name: form.name.trim(), category_id: form.category_id,
    price_per_unit: price / 100, cost_per_unit: cost === null ? null : cost / 100,
    carton_size: carton, low_stock_threshold: threshold,
    image_url: form.image_url.trim() || null, active: form.active,
  } } as const;
}
