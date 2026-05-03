import { supabase } from './supabase';
import { isSupabaseConfigured } from './supabase';
import { loadLocalProducts, loadLocalSettings } from './localStore';
import type { ProductWithStock, SettingsMap } from './types';

const categoryOrder = ['Beer', 'Soft Drink', 'Food', 'Cocktail', 'Others'];
const productOrder = ['1602 Lager', '1602 Pale Ale', '1602 Extra Dark', 'Coke', '7Up', 'Fanta'];

export function normalizeCategoryName(name: string | null | undefined) {
  return name === 'Other' || !name ? 'Others' : name;
}

export function categoryRank(name: string | null | undefined) {
  const normalized = normalizeCategoryName(name);
  const index = categoryOrder.indexOf(normalized);
  return index === -1 ? categoryOrder.length : index;
}

function productRank(name: string) {
  const index = productOrder.indexOf(name);
  return index === -1 ? productOrder.length : index;
}

export const defaultSettings: SettingsMap = {
  business_name: 'Lovely Paradise Bar',
  currency_symbol: 'MYR',
  secondary_currency_symbol: 'RMB',
  rmb_exchange_rate: 1.52,
  business_day_close_time: '00:00',
  default_carton_size: 24,
  allow_negative_stock: false,
  require_qr_reference: false,
  require_manager_approval_for_complimentary: false,
  staff_names: 'Chloe, Happy, Elle, NekoMiao',
  receipt_footer_text: '',
};

export async function loadSettings(): Promise<SettingsMap> {
  if (!isSupabaseConfigured) return loadLocalSettings();
  const { data, error } = await supabase.from('app_settings').select('key,value');
  if (error) throw error;
  const rows = (data ?? []) as Array<{ key: keyof SettingsMap; value: SettingsMap[keyof SettingsMap] }>;
  return rows.reduce(
    (settings: SettingsMap, row) => ({ ...settings, [row.key]: row.value }),
    { ...defaultSettings },
  );
}

export async function loadProducts(includeInactive = false): Promise<ProductWithStock[]> {
  if (!isSupabaseConfigured) {
    return loadLocalProducts(includeInactive);
  }
  let query = supabase
    .from('products')
    .select(
      '*, categories(id,name,sort_order), inventory_balances(quantity_on_hand)',
    )
    .order('name');

  if (!includeInactive) query = query.eq('active', true);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ProductWithStock[];
}

export function roleAtLeast(
  role: string | null | undefined,
  minimum: 'cashier' | 'manager' | 'admin',
) {
  const ranks = { cashier: 1, manager: 2, admin: 3 };
  return Boolean(role && ranks[role as keyof typeof ranks] >= ranks[minimum]);
}

export function groupByCategory(products: ProductWithStock[]) {
  return [...products]
    .sort((a, b) => {
      return categoryRank(a.categories?.name) - categoryRank(b.categories?.name) || productRank(a.name) - productRank(b.name) || a.name.localeCompare(b.name);
    })
    .reduce<Record<string, ProductWithStock[]>>((groups, product) => {
      const category = normalizeCategoryName(product.categories?.name);
      groups[category] = groups[category] ?? [];
      groups[category].push(product);
      return groups;
    }, {});
}
