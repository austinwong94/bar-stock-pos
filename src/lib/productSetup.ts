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

export type ProductField = 'name' | 'category_id' | 'price_per_unit' | 'cost_per_unit' | 'carton_size' | 'low_stock_threshold';
export type ProductIssue = {field: ProductField; message: string};

export function productIssueLabel(issue: ProductIssue, text: (en: string, ms: string) => string) {
  const malay: Record<ProductField, string> = {
    name: 'Masukkan nama produk.', category_id: 'Pilih kategori sebelum simpan.',
    price_per_unit: 'Isi harga jualan dalam RM, maksimum 2 tempat perpuluhan.',
    cost_per_unit: 'Isi kos yang sah dalam RM, maksimum 2 tempat perpuluhan.',
    carton_size: 'Isi unit setiap karton dalam nombor bulat, atau pilih Tiada Karton.',
    low_stock_threshold: 'Isi amaran stok dalam nombor bulat. Gunakan 0 untuk tiada amaran.',
  };
  return text(issue.message, malay[issue.field]);
}

function wholeNumber(raw: string, minimum: number): number | null {
  const value = raw.trim();
  if (!/^\d{1,10}$/.test(value)) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= 2147483647 ? number : null;
}

export function productFormIssues(form: ProductForm): ProductIssue[] {
  const price = moneyCents(form.price_per_unit);
  const cost = form.cost_per_unit.trim() ? moneyCents(form.cost_per_unit) : null;
  const carton = wholeNumber(form.carton_size, 1);
  const threshold = wholeNumber(form.low_stock_threshold, 0);
  const issues: ProductIssue[] = [];
  if (!form.name.trim()) issues.push({field: 'name', message: 'Enter a product name.'});
  if (!form.category_id) issues.push({field: 'category_id', message: 'Choose a category before saving.'});
  if (price === null) issues.push({field: 'price_per_unit', message: 'Enter the selling price in RM, with no more than 2 decimal places.'});
  if (carton === null) issues.push({field: 'carton_size', message: 'Enter a whole number of units per carton, or choose No Carton.'});
  if (form.cost_per_unit.trim() && cost === null) issues.push({field: 'cost_per_unit', message: 'Enter a valid cost in RM, with no more than 2 decimal places.'});
  if (threshold === null) issues.push({field: 'low_stock_threshold', message: 'Enter a whole-number stock alert. Use 0 for no alert.'});
  return issues;
}

export function parseProductForm(form: ProductForm) {
  const issues = productFormIssues(form);
  if (issues.length) return {error: issues[0].message} as const;
  return { payload: {
    name: form.name.trim(), category_id: form.category_id,
    price_per_unit: moneyCents(form.price_per_unit)! / 100, cost_per_unit: form.cost_per_unit.trim() ? moneyCents(form.cost_per_unit)! / 100 : null,
    carton_size: wholeNumber(form.carton_size, 1)!, low_stock_threshold: wholeNumber(form.low_stock_threshold, 0)!,
    image_url: form.image_url.trim() || null, active: form.active,
  } } as const;
}
