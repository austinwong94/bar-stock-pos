import { demoCategories, demoProducts, demoSaleItems, demoSales, demoSettings } from './demo';
import type { Category, PaymentMethod, ProductWithStock, Sale, SaleItem, SettingsMap } from './types';

const productsKey = 'lovely_paradise_products';
const categoriesKey = 'lovely_paradise_categories';
const settingsKey = 'lovely_paradise_settings';
const salesKey = 'lovely_paradise_sales';
const saleItemsKey = 'lovely_paradise_sale_items';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

function localDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function loadLocalSettings(): SettingsMap {
  return read(settingsKey, demoSettings);
}

export function saveLocalSettings(settings: SettingsMap) {
  write(settingsKey, settings);
}

export function loadLocalCategories(): Category[] {
  const categories = read(categoriesKey, demoCategories);
  if (!localStorage.getItem(categoriesKey)) write(categoriesKey, categories);
  return categories;
}

function attachCategory(product: ProductWithStock, categories = loadLocalCategories()): ProductWithStock {
  return {
    ...product,
    categories: categories.find((category) => category.id === product.category_id) ?? product.categories ?? null,
    inventory_balances: product.inventory_balances ?? { quantity_on_hand: 0 },
  };
}

export function loadLocalProducts(includeInactive = false): ProductWithStock[] {
  const products = read(productsKey, demoProducts);
  if (!localStorage.getItem(productsKey)) write(productsKey, products);
  return products.map((product) => attachCategory(product)).filter((product) => includeInactive || product.active);
}

type LocalProductPayload = Omit<ProductWithStock, 'id' | 'categories'> & { id?: string };

export function saveLocalProduct(product: LocalProductPayload): ProductWithStock {
  const products = loadLocalProducts(true);
  const now = new Date().toISOString();
  const nextProduct: ProductWithStock = attachCategory({
    ...product,
    id: product.id || crypto.randomUUID(),
    created_at: product.created_at || now,
    updated_at: now,
    inventory_balances: product.inventory_balances ?? { quantity_on_hand: 0 },
    categories: null,
  });
  const nextProducts = products.some((item) => item.id === nextProduct.id)
    ? products.map((item) => (item.id === nextProduct.id ? nextProduct : item))
    : [...products, nextProduct];
  write(productsKey, nextProducts);
  return nextProduct;
}

export function adjustLocalStock(productId: string, quantityChange: number) {
  const products = loadLocalProducts(true);
  const nextProducts = products.map((product) => {
    if (product.id !== productId) return product;
    const current = product.inventory_balances?.quantity_on_hand ?? 0;
    return {
      ...product,
      inventory_balances: { quantity_on_hand: Math.max(0, current + quantityChange) },
      updated_at: new Date().toISOString(),
    };
  });
  write(productsKey, nextProducts);
  return nextProducts.find((product) => product.id === productId) ?? null;
}

export function loadLocalSales(): Sale[] {
  return read(salesKey, demoSales);
}

export function loadLocalSaleItems(): SaleItem[] {
  return read(saleItemsKey, demoSaleItems);
}

export function saveLocalSale(input: {
  items: Array<{ product_id: string | null; name: string; quantity: number; unit_price: number; line_total: number }>;
  paymentMethod: PaymentMethod;
  totalAmount: number;
  paidAmount: number;
  discountAmount: number;
  orderTakenBy: string;
  qrReference?: string | null;
  qrReceiptName?: string | null;
  complimentaryReason?: string | null;
}) {
  const now = new Date();
  const date = localDateString(now);
  const sales = loadLocalSales();
  const saleItems = loadLocalSaleItems();
  const sequence = sales.filter((sale) => sale.business_date === date).length + 1;
  const sale: Sale = {
    id: crypto.randomUUID(),
    sale_number: `S-${date.replace(/-/g, '')}-${String(sequence).padStart(4, '0')}`,
    business_date: date,
    payment_method: input.paymentMethod,
    status: 'completed',
    total_amount: input.totalAmount,
    paid_amount: input.paidAmount,
    discount_amount: input.discountAmount,
    order_taken_by: input.orderTakenBy,
    complimentary_reason: input.complimentaryReason ?? null,
    qr_reference: input.qrReference ?? null,
    qr_receipt_image_path: input.qrReceiptName ? `local/${input.qrReceiptName}` : null,
    qr_status: input.paymentMethod === 'qr' ? 'pending' : 'not_applicable',
    cashier_id: null,
    voided_by: null,
    void_reason: null,
    voided_at: null,
    idempotency_key: crypto.randomUUID(),
    created_at: now.toISOString(),
  };
  const nextItems = input.items.map<SaleItem>((item) => ({
    id: crypto.randomUUID(),
    sale_id: sale.id,
    product_id: item.product_id,
    custom_item_name: item.product_id ? null : item.name,
    quantity: item.quantity,
    unit_price: item.unit_price,
    line_total: item.line_total,
    created_at: now.toISOString(),
    products: { name: item.name },
  }));
  input.items.forEach((item) => {
    if (item.product_id) adjustLocalStock(item.product_id, -item.quantity);
  });
  write(salesKey, [sale, ...sales]);
  write(saleItemsKey, [...nextItems, ...saleItems]);
  return sale;
}
