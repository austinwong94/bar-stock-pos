import { demoCategories, demoIngredientItems, demoIngredientMovements, demoMovements, demoProducts, demoRecipeIngredients, demoSaleItems, demoSales, demoSettings } from './demo';
import { malaysiaBusinessDateInputValue } from './format';
import type { Category, DailyReport, IngredientItem, IngredientMovement, IngredientWithBalance, KitchenDailyPax, KitchenProductionItem, KitchenProductionReport, PaymentMethod, ProductPriceHistory, ProductWithStock, QrStatus, RecipeIngredient, Sale, SaleItem, SettingsMap, StockInDraftEntry, StockInDraftRecord, StockMovement } from './types';

const productsKey = 'lovely_paradise_products';
const categoriesKey = 'lovely_paradise_categories';
const settingsKey = 'lovely_paradise_settings';
const salesKey = 'lovely_paradise_sales';
const saleItemsKey = 'lovely_paradise_sale_items';
const stockMovementsKey = 'lovely_paradise_stock_movements';
const stockInDraftsKey = 'lovely_paradise_stock_in_drafts';
const dailyReportsKey = 'lovely_paradise_daily_reports';
const productPriceHistoryKey = 'lovely_paradise_product_price_history';
const ingredientItemsKey = 'lovely_paradise_ingredient_items';
const recipeIngredientsKey = 'lovely_paradise_recipe_ingredients';
const ingredientMovementsKey = 'lovely_paradise_ingredient_movements';
const kitchenPaxKey = 'lovely_paradise_kitchen_daily_pax';
const kitchenProductionReportsKey = 'lovely_paradise_kitchen_production_reports';
const kitchenProductionItemsKey = 'lovely_paradise_kitchen_production_items';

const removedSampleHistoryKey = 'lovely_paradise_removed_builtin_sample_history_v1';

function removeBuiltInSampleHistory() {
  if (localStorage.getItem(removedSampleHistoryKey) === 'ok') return;
  const demoSaleIds = new Set(demoSales.map((sale) => sale.id));
  const demoSaleItemIds = new Set(demoSaleItems.map((item) => item.id));
  const demoMovementIds = new Set(demoMovements.map((movement) => movement.id));

  const savedSales = read<Sale[] | null>(salesKey, null);
  if (Array.isArray(savedSales)) write(salesKey, savedSales.filter((sale) => !demoSaleIds.has(sale.id)));

  const savedSaleItems = read<SaleItem[] | null>(saleItemsKey, null);
  if (Array.isArray(savedSaleItems)) {
    write(saleItemsKey, savedSaleItems.filter((item) => !demoSaleItemIds.has(item.id) && !demoSaleIds.has(item.sale_id)));
  }

  const savedMovements = read<StockMovement[] | null>(stockMovementsKey, null);
  if (Array.isArray(savedMovements)) write(stockMovementsKey, savedMovements.filter((movement) => !demoMovementIds.has(movement.id)));

  localStorage.setItem(removedSampleHistoryKey, 'ok');
}

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

const localCategoryOrder: Record<string, number> = {
  Beer: 10,
  'Soft Drink': 20,
  Food: 30,
  Cocktail: 40,
  Others: 50,
};

function normalizeLocalCategoryName(name: string | null | undefined) {
  return name === 'Other' || !name ? 'Others' : name;
}

function normalizeLocalCategories(categories: Category[]) {
  const seen = new Set<string>();
  const normalized: Category[] = [];
  for (const category of categories) {
    const name = normalizeLocalCategoryName(category.name);
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      ...category,
      name,
      sort_order: localCategoryOrder[name] ?? category.sort_order,
    });
  }
  return normalized.sort((a, b) => (localCategoryOrder[a.name] ?? a.sort_order) - (localCategoryOrder[b.name] ?? b.sort_order) || a.name.localeCompare(b.name));
}

export function clearLocalTransactionHistory() {
  write(salesKey, [] as Sale[]);
  write(saleItemsKey, [] as SaleItem[]);
  write(stockMovementsKey, [] as StockMovement[]);
  write(stockInDraftsKey, [] as StockInDraftRecord[]);
  write(dailyReportsKey, [] as DailyReport[]);
  write(ingredientMovementsKey, [] as IngredientMovement[]);
  write(kitchenPaxKey, [] as KitchenDailyPax[]);
  write(kitchenProductionReportsKey, [] as KitchenProductionReport[]);
  write(kitchenProductionItemsKey, [] as KitchenProductionItem[]);
}

export function resetLocalStarterData() {
  localStorage.setItem(removedSampleHistoryKey, 'ok');
  write(productsKey, demoProducts);
  write(categoriesKey, demoCategories);
  write(settingsKey, demoSettings);
  write(salesKey, demoSales);
  write(saleItemsKey, demoSaleItems);
  write(stockMovementsKey, demoMovements);
  write(stockInDraftsKey, [] as StockInDraftRecord[]);
  write(dailyReportsKey, [] as DailyReport[]);
  write(productPriceHistoryKey, [] as ProductPriceHistory[]);
  write(ingredientItemsKey, demoIngredientItems);
  write(recipeIngredientsKey, demoRecipeIngredients);
  write(ingredientMovementsKey, demoIngredientMovements);
  write(kitchenPaxKey, [] as KitchenDailyPax[]);
  write(kitchenProductionReportsKey, [] as KitchenProductionReport[]);
  write(kitchenProductionItemsKey, [] as KitchenProductionItem[]);
}


export function loadLocalSettings(): SettingsMap {
  const settings = { ...demoSettings, ...read(settingsKey, demoSettings) };
  const closeTimeMigrationKey = 'lovely_paradise_close_time_migrated_to_calendar_day';
  if (settings.business_day_close_time === '05:00' && localStorage.getItem(closeTimeMigrationKey) !== 'ok') {
    settings.business_day_close_time = '00:00';
    write(settingsKey, settings);
    localStorage.setItem(closeTimeMigrationKey, 'ok');
  }
  return settings;
}

export function saveLocalSettings(settings: SettingsMap) {
  write(settingsKey, settings);
}

export function loadLocalCategories(): Category[] {
  const categories = normalizeLocalCategories(read(categoriesKey, demoCategories));
  if (!localStorage.getItem(categoriesKey) || JSON.stringify(categories) !== localStorage.getItem(categoriesKey)) {
    write(categoriesKey, categories);
  }
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

function nullableMoneyValue(value: number | null | undefined) {
  return value == null ? null : Number(value);
}

export function loadLocalProductPriceHistory(): ProductPriceHistory[] {
  return read(productPriceHistoryKey, [] as ProductPriceHistory[]);
}

export function saveLocalProduct(product: LocalProductPayload): ProductWithStock {
  const products = loadLocalProducts(true);
  const now = new Date().toISOString();
  const existing = product.id ? products.find((item) => item.id === product.id) ?? null : null;
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
  const oldPrice = nullableMoneyValue(existing?.price_per_unit);
  const newPrice = nullableMoneyValue(nextProduct.price_per_unit);
  const oldCost = nullableMoneyValue(existing?.cost_per_unit);
  const newCost = nullableMoneyValue(nextProduct.cost_per_unit);
  if (existing && (oldPrice !== newPrice || oldCost !== newCost)) {
    const row: ProductPriceHistory = {
      id: crypto.randomUUID(),
      product_id: nextProduct.id,
      product_name: nextProduct.name,
      old_price_per_unit: oldPrice,
      new_price_per_unit: newPrice,
      old_cost_per_unit: oldCost,
      new_cost_per_unit: newCost,
      changed_by: null,
      changed_at: now,
      products: { name: nextProduct.name },
      profiles: { full_name: 'Admin' },
    };
    write(productPriceHistoryKey, [row, ...loadLocalProductPriceHistory()].slice(0, 200));
  }
  return nextProduct;
}

export function adjustLocalStock(productId: string, quantityChange: number): { product: ProductWithStock; quantityBefore: number; quantityAfter: number } | null {
  const products = loadLocalProducts(true);
  let quantityBefore = 0;
  let quantityAfter = 0;
  let adjustedProduct: ProductWithStock | null = null;
  const nextProducts = products.map((product) => {
    if (product.id !== productId) return product;
    quantityBefore = product.inventory_balances?.quantity_on_hand ?? 0;
    quantityAfter = quantityBefore + quantityChange;
    adjustedProduct = {
      ...product,
      inventory_balances: { quantity_on_hand: quantityAfter },
      updated_at: new Date().toISOString(),
    };
    return adjustedProduct;
  });
  write(productsKey, nextProducts);
  return adjustedProduct ? { product: adjustedProduct, quantityBefore, quantityAfter } : null;
}

export function loadLocalStockMovements(): StockMovement[] {
  removeBuiltInSampleHistory();
  const movements = read(stockMovementsKey, [] as StockMovement[]);
  if (!localStorage.getItem(stockMovementsKey)) write(stockMovementsKey, movements);
  return movements;
}

export function recordLocalStockMovement(input: Omit<StockMovement, 'id' | 'created_at'> & { created_at?: string }) {
  const movement: StockMovement = {
    ...input,
    id: crypto.randomUUID(),
    created_at: input.created_at ?? new Date().toISOString(),
  };
  write(stockMovementsKey, [movement, ...loadLocalStockMovements()]);
  return movement;
}

export function loadLocalStockInDrafts(): StockInDraftRecord[] {
  return read(stockInDraftsKey, [] as StockInDraftRecord[]);
}

function nextLocalStockInDraftNumber() {
  const today = malaysiaBusinessDateInputValue(new Date(), '00:00').replace(/-/g, '');
  const sequence = loadLocalStockInDrafts().filter((draft) => draft.draft_number.includes(today)).length + 1;
  return `SI-DRAFT-${today}-${String(sequence).padStart(3, '0')}`;
}

export function createLocalStockInDraft(input: {
  entries: StockInDraftEntry[];
  enteredBy: string;
  supplier?: string | null;
  reference?: string | null;
  notes?: string | null;
}) {
  const draft: StockInDraftRecord = {
    id: crypto.randomUUID(),
    draft_number: nextLocalStockInDraftNumber(),
    status: 'draft',
    entered_by: input.enteredBy,
    supplier: input.supplier || null,
    reference: input.reference || null,
    notes: input.notes || null,
    entries: input.entries,
    total_units: input.entries.reduce((sum, entry) => sum + Number(entry.cans || 0), 0),
    created_by: null,
    confirmed_by: null,
    cancelled_by: null,
    created_at: new Date().toISOString(),
    confirmed_at: null,
    cancelled_at: null,
    cancel_reason: null,
  };
  write(stockInDraftsKey, [draft, ...loadLocalStockInDrafts()].slice(0, 200));
  return draft;
}

export function confirmLocalStockInDraft(draftId: string) {
  const now = new Date().toISOString();
  const drafts = loadLocalStockInDrafts();
  let confirmed: StockInDraftRecord | null = null;
  const nextDrafts = drafts.map((draft) => {
    if (draft.id !== draftId) return draft;
    if (draft.status !== 'draft') return draft;
    confirmed = { ...draft, status: 'confirmed', confirmed_at: now, confirmed_by: null };
    return confirmed;
  });
  write(stockInDraftsKey, nextDrafts);
  return confirmed;
}

export function cancelLocalStockInDraft(draftId: string, reason: string) {
  const now = new Date().toISOString();
  const cleanReason = reason.trim();
  const drafts = loadLocalStockInDrafts();
  let cancelled: StockInDraftRecord | null = null;
  const nextDrafts = drafts.map((draft) => {
    if (draft.id !== draftId) return draft;
    if (draft.status !== 'draft') return draft;
    cancelled = {
      ...draft,
      status: 'cancelled',
      cancelled_at: now,
      cancelled_by: null,
      cancel_reason: cleanReason,
    };
    return cancelled;
  });
  write(stockInDraftsKey, nextDrafts);
  return cancelled;
}

export function loadLocalSales(): Sale[] {
  removeBuiltInSampleHistory();
  return read(salesKey, [] as Sale[]);
}

export function loadLocalSaleItems(): SaleItem[] {
  removeBuiltInSampleHistory();
  return read(saleItemsKey, [] as SaleItem[]);
}

export function loadLocalDailyReports(): DailyReport[] {
  removeBuiltInSampleHistory();
  return read(dailyReportsKey, [] as DailyReport[]);
}

export function saveLocalDailyReport(report: DailyReport) {
  const reports = loadLocalDailyReports();
  const nextReports = [report, ...reports.filter((item) => item.business_date !== report.business_date)];
  write(dailyReportsKey, nextReports);
  return report;
}

function ingredientBalanceValue(item: IngredientWithBalance) {
  const balance = item.ingredient_balances;
  if (Array.isArray(balance)) return Number(balance[0]?.quantity_on_hand ?? 0);
  return Number(balance?.quantity_on_hand ?? 0);
}

function attachIngredientBalance(item: IngredientWithBalance): IngredientWithBalance {
  return {
    ...item,
    ingredient_balances: item.ingredient_balances ?? { quantity_on_hand: 0 },
  };
}

export function loadLocalIngredientItems(includeInactive = false): IngredientWithBalance[] {
  const items = read(ingredientItemsKey, demoIngredientItems);
  if (!localStorage.getItem(ingredientItemsKey)) write(ingredientItemsKey, items);
  return items.map(attachIngredientBalance).filter((item) => includeInactive || item.active);
}

export function saveLocalIngredientItem(payload: Partial<IngredientItem> & { id?: string; name: string }): IngredientWithBalance {
  const items = loadLocalIngredientItems(true);
  const now = new Date().toISOString();
  const existing = payload.id ? items.find((item) => item.id === payload.id) : null;
  const nextItem: IngredientWithBalance = attachIngredientBalance({
    kitchen_key: payload.kitchen_key ?? existing?.kitchen_key,
    kitchen_label: payload.kitchen_label ?? existing?.kitchen_label,
    kitchen_group: payload.kitchen_group ?? existing?.kitchen_group,
    kitchen_unit: payload.kitchen_unit ?? existing?.kitchen_unit,
    kitchen_factor: payload.kitchen_factor !== undefined ? payload.kitchen_factor : existing?.kitchen_factor,
    kitchen_scopes: payload.kitchen_scopes ?? existing?.kitchen_scopes,
    kitchen_order: payload.kitchen_order ?? existing?.kitchen_order,
    id: payload.id || crypto.randomUUID(),
    name: payload.name,
    category: payload.category ?? 'Other',
    base_unit: payload.base_unit ?? 'unit',
    default_pack_size: Number(payload.default_pack_size ?? existing?.default_pack_size ?? 1),
    pack_label: payload.pack_label || existing?.pack_label || 'Pack',
    cost_per_base_unit: payload.cost_per_base_unit == null ? null : Number(payload.cost_per_base_unit),
    low_stock_threshold: Number(payload.low_stock_threshold ?? existing?.low_stock_threshold ?? 0),
    active: payload.active ?? existing?.active ?? true,
    created_at: existing?.created_at ?? now,
    updated_at: now,
    ingredient_balances: existing?.ingredient_balances ?? { quantity_on_hand: 0 },
  });
  write(ingredientItemsKey, items.some((item) => item.id === nextItem.id) ? items.map((item) => (item.id === nextItem.id ? nextItem : item)) : [...items, nextItem]);
  return nextItem;
}

function writeLocalIngredientItems(items: IngredientWithBalance[]) {
  write(ingredientItemsKey, items);
}

export function withLocalIngredientRollback<T>(apply: () => T): T {
  const snapshot = [ingredientItemsKey,ingredientMovementsKey,kitchenProductionItemsKey,kitchenProductionReportsKey].map(key=>[key,localStorage.getItem(key)] as const);
  try { return apply(); }
  catch (failure) {
    for (const [key, value] of snapshot) {
      if (value == null) localStorage.removeItem(key!); else localStorage.setItem(key!, value);
    }
    throw failure;
  }
}

export function stockInLocalIngredient(input: {
  ingredientId: string;
  inputQuantity: number;
  unitType: 'base' | 'pack';
  packSize?: number | null;
  notes?: string | null;
  enteredBy?: string | null;
}) {
  const items = loadLocalIngredientItems(true);
  const now = new Date().toISOString();
  let movement: IngredientMovement | null = null;
  const nextItems = items.map((item) => {
    if (item.id !== input.ingredientId) return item;
    const beforeQty = ingredientBalanceValue(item);
    const packSize = Number(input.packSize || item.default_pack_size || 1);
    const quantityAdded = input.unitType === 'pack' ? input.inputQuantity * packSize : input.inputQuantity;
    const afterQty = beforeQty + quantityAdded;
    movement = {
      id: crypto.randomUUID(),
      ingredient_id: item.id,
      movement_type: 'stock_in',
      display_unit: item.kitchen_unit,
      display_factor: item.kitchen_factor,
      quantity_change: quantityAdded,
      quantity_before: beforeQty,
      quantity_after: afterQty,
      unit_input: input.unitType,
      input_quantity: input.inputQuantity,
      pack_size_at_time: packSize,
      reference_type: 'ingredient_stock_in',
      reference_id: null,
      reason: null,
      notes: input.notes ?? null,
      entered_by: input.enteredBy ?? null,
      created_by: null,
      created_at: now,
      ingredient_items: { name: item.name, base_unit: item.base_unit },
    };
    return { ...item, updated_at: now, ingredient_balances: { quantity_on_hand: afterQty } };
  });
  writeLocalIngredientItems(nextItems);
  if (movement) write(ingredientMovementsKey, [movement, ...loadLocalIngredientMovements()]);
  return movement;
}


export function adjustLocalIngredientStock(input: {
  ingredientId: string;
  movementType: 'count' | 'waste' | 'adjustment' | 'kitchen_production';
  quantity: number;
  reason: string;
  notes?: string | null;
  enteredBy?: string | null;
  referenceId?: string;
  createdBy?: string;
}) {
  const items = loadLocalIngredientItems(true);
  const now = new Date().toISOString();
  let movement: IngredientMovement | null = null;
  let found = false;
  const nextItems = items.map((item) => {
    if (item.id !== input.ingredientId) return item;
    found = true;
    const beforeQty = ingredientBalanceValue(item);
    let afterQty = beforeQty;
    let quantityChange = 0;
    if (input.movementType === 'count') {
      if (input.quantity < 0) throw new Error('Actual count must be 0 or more.');
      afterQty = input.quantity;
      quantityChange = afterQty - beforeQty;
    } else if (input.movementType === 'waste') {
      if (input.quantity <= 0) throw new Error('Waste or missing quantity must be more than 0.');
      quantityChange = -Math.abs(input.quantity);
      afterQty = beforeQty + quantityChange;
    } else {
      if (input.quantity === 0) throw new Error('Correction quantity cannot be 0.');
      quantityChange = input.quantity;
      afterQty = beforeQty + quantityChange;
    }
    if (afterQty < 0) throw new Error(`${item.name} cannot go below 0 ${item.base_unit}.`);
    movement = {
      id: crypto.randomUUID(),
      ingredient_id: item.id,
      movement_type: input.movementType,
      display_unit: item.kitchen_unit,
      display_factor: item.kitchen_factor,
      quantity_change: quantityChange,
      quantity_before: beforeQty,
      quantity_after: afterQty,
      unit_input: input.movementType,
      input_quantity: input.quantity,
      pack_size_at_time: null,
      reference_type: input.referenceId ? (input.movementType === 'count' ? 'kitchen_stock_count' : 'kitchen_stock_out') : `ingredient_${input.movementType}`,
      reference_id: input.referenceId ?? null,
      reason: input.reason,
      notes: input.notes ?? null,
      entered_by: input.enteredBy ?? null,
      created_by: input.createdBy ?? null,
      created_at: now,
      ingredient_items: { name: item.name, base_unit: item.base_unit },
    };
    return { ...item, updated_at: now, ingredient_balances: { quantity_on_hand: afterQty } };
  });
  if (!found) throw new Error('Ingredient not found.');
  writeLocalIngredientItems(nextItems);
  if (movement) write(ingredientMovementsKey, [movement, ...loadLocalIngredientMovements()]);
  return movement;
}

export function loadLocalIngredientMovements(): IngredientMovement[] {
  return read(ingredientMovementsKey, demoIngredientMovements);
}

export function loadLocalKitchenPax(): KitchenDailyPax[] {
  return read(kitchenPaxKey, [] as KitchenDailyPax[]);
}

export function saveLocalKitchenPax(input: {
  businessDate: string;
  paxCount: number;
  enteredBy?: string | null;
  notes?: string | null;
}): KitchenDailyPax {
  const rows = loadLocalKitchenPax();
  const now = new Date().toISOString();
  const existing = rows.find((row) => row.business_date === input.businessDate);
  const next: KitchenDailyPax = {
    id: existing?.id ?? crypto.randomUUID(),
    business_date: input.businessDate,
    pax_count: input.paxCount,
    entered_by: input.enteredBy ?? existing?.entered_by ?? null,
    notes: input.notes ?? existing?.notes ?? null,
    updated_by: null,
    updated_at: now,
  };
  write(kitchenPaxKey, [next, ...rows.filter((row) => row.business_date !== input.businessDate)]);
  return next;
}

export function loadLocalKitchenProductionItems(): KitchenProductionItem[] {
  return read(kitchenProductionItemsKey, [] as KitchenProductionItem[]);
}

export function loadLocalKitchenProductionReports(): KitchenProductionReport[] {
  const items = loadLocalKitchenProductionItems();
  return read(kitchenProductionReportsKey, [] as KitchenProductionReport[]).map((report) => ({
    ...report,
    kitchen_production_items: items.filter((item) => item.report_id === report.id),
  }));
}

export function submitLocalKitchenProduction(input: {
  createdBy?: string;
  mealPurpose?: 'guest_meals' | 'staff_meals';
  mealsPrepared?: number | null;
  businessDate: string;
  platterName: string;
  platterCount: number;
  servingBasis: 'pax' | 'table' | 'batch';
  submittedBy?: string | null;
  notes?: string | null;
  items: Array<{ ingredient_id: string; quantity_per_platter: number; notes?: string | null }>;
}): KitchenProductionReport {
  const ingredients = loadLocalIngredientItems(true);
  const ingredientById = new Map(ingredients.map((item) => [item.id, item]));
  const now = new Date().toISOString();
  const reportId = crypto.randomUUID();
  const cleanItems = input.items
    .map((item) => {
      const ingredient = ingredientById.get(item.ingredient_id);
      const quantityPerPlatter = Number(item.quantity_per_platter || 0);
      if (!ingredient || quantityPerPlatter <= 0) return null;
      return { ingredient, quantityPerPlatter, totalQuantity: quantityPerPlatter * input.platterCount, notes: item.notes ?? null };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  if (!input.businessDate) throw new Error('Business date is required.');
  if (!input.platterName.trim()) throw new Error('Platter name is required.');
  if (input.platterCount <= 0) throw new Error('Number prepared must be more than 0.');
  if (cleanItems.length === 0) throw new Error('Add at least one ingredient used by this platter.');

  for (const item of cleanItems) {
    const balance = ingredientBalanceValue(item.ingredient);
    const totalUsage = cleanItems.filter(row => row.ingredient.id === item.ingredient.id).reduce((sum, row) => sum + row.totalQuantity, 0);
    if (balance < totalUsage) {
      throw new Error(`${item.ingredient.name} is short by ${(totalUsage - balance).toFixed(item.ingredient.base_unit === 'unit' ? 0 : 2)} ${item.ingredient.base_unit}. Receive stock or check the usage.`);
    }
  }

  const movements: IngredientMovement[] = [];
  const nextIngredients = ingredients.map((ingredient) => {
    const usage = cleanItems
      .filter((item) => item.ingredient.id === ingredient.id)
      .reduce((sum, item) => sum + item.totalQuantity, 0);
    if (usage <= 0) return ingredient;
    const beforeQty = ingredientBalanceValue(ingredient);
    const afterQty = beforeQty - usage;
    movements.push({
      id: crypto.randomUUID(),
      ingredient_id: ingredient.id,
      movement_type: 'kitchen_production',
      quantity_change: -usage,
      quantity_before: beforeQty,
      quantity_after: afterQty,
      unit_input: 'kitchen',
      input_quantity: usage,
      pack_size_at_time: null,
      reference_type: 'kitchen_production',
      reference_id: reportId,
      reason: input.platterName.trim(),
      notes: input.notes ?? null,
      entered_by: input.submittedBy ?? null,
      created_by: input.createdBy ?? null,
      created_at: now,
      ingredient_items: { name: ingredient.name, base_unit: ingredient.base_unit },
    });
    return { ...ingredient, updated_at: now, ingredient_balances: { quantity_on_hand: afterQty } };
  });

  const reportItems: KitchenProductionItem[] = cleanItems.map(({ ingredient, quantityPerPlatter, totalQuantity, notes }) => ({
    id: crypto.randomUUID(),
    report_id: reportId,
    ingredient_id: ingredient.id,
    quantity_per_platter: quantityPerPlatter,
    total_quantity: totalQuantity,
    unit: ingredient.base_unit,
    notes,
    ingredient_items: { id: ingredient.id, name: ingredient.name, category: ingredient.category, base_unit: ingredient.base_unit },
  }));
  const report: KitchenProductionReport = {
    meal_purpose: input.mealPurpose ?? null,
    meals_prepared: input.mealsPrepared ?? null,
    id: reportId,
    business_date: input.businessDate,
    platter_name: input.platterName.trim(),
    platter_count: input.platterCount,
    serving_basis: input.servingBasis,
    submitted_by: input.submittedBy ?? null,
    notes: input.notes ?? null,
    created_by: input.createdBy ?? null,
    created_at: now,
    updated_at: now,
    kitchen_production_items: reportItems,
  };

  writeLocalIngredientItems(nextIngredients);
  write(ingredientMovementsKey, [...movements, ...loadLocalIngredientMovements()]);
  write(kitchenProductionItemsKey, [...reportItems, ...loadLocalKitchenProductionItems()]);
  write(kitchenProductionReportsKey, [report, ...loadLocalKitchenProductionReports().map(({ kitchen_production_items, ...row }) => row)]);
  return report;
}

export function loadLocalRecipeIngredients(productId?: string): RecipeIngredient[] {
  const recipes = read(recipeIngredientsKey, demoRecipeIngredients);
  if (!localStorage.getItem(recipeIngredientsKey)) write(recipeIngredientsKey, recipes);
  return productId ? recipes.filter((item) => item.product_id === productId) : recipes;
}

export function saveLocalProductRecipe(productId: string, lines: Array<{ ingredient_id: string; quantity_per_unit: number }>) {
  const ingredients = loadLocalIngredientItems(true);
  const otherRecipes = loadLocalRecipeIngredients().filter((item) => item.product_id !== productId);
  const now = new Date().toISOString();
  const nextRecipes: RecipeIngredient[] = lines.map((line) => {
    const ingredient = ingredients.find((item) => item.id === line.ingredient_id);
    return {
      id: crypto.randomUUID(),
      product_id: productId,
      ingredient_id: line.ingredient_id,
      quantity_per_unit: line.quantity_per_unit,
      unit: ingredient?.base_unit ?? 'unit',
      created_at: now,
      ingredient_items: ingredient ? { id: ingredient.id, name: ingredient.name, category: ingredient.category, base_unit: ingredient.base_unit } : null,
    };
  });
  write(recipeIngredientsKey, [...nextRecipes, ...otherRecipes]);
  return nextRecipes;
}

export function updateLocalQrPayment(saleId: string, status: Extract<QrStatus, 'verified' | 'mismatch'>) {
  const sales = loadLocalSales();
  let updatedSale: Sale | null = null;
  const nextSales = sales.map((sale) => {
    if (sale.id !== saleId) return sale;
    updatedSale = { ...sale, qr_status: status };
    return updatedSale;
  });
  write(salesKey, nextSales);
  return updatedSale;
}

function localProductHasRecipe(productId: string) {
  return loadLocalRecipeIngredients(productId).length > 0;
}

function adjustLocalRecipeUsage(input: {
  productId: string;
  saleQuantity: number;
  direction: -1 | 1;
  referenceId: string;
  paymentMethod: PaymentMethod | 'void_sale';
  enteredBy?: string | null;
  reason?: string | null;
}) {
  const recipes = loadLocalRecipeIngredients(input.productId);
  if (recipes.length === 0) return;
  const items = loadLocalIngredientItems(true);
  const ingredientById = new Map(items.map((item) => [item.id, item]));
  const requiredByIngredient = new Map<string, number>();
  recipes.forEach((recipe) => {
    requiredByIngredient.set(
      recipe.ingredient_id,
      (requiredByIngredient.get(recipe.ingredient_id) ?? 0) + recipe.quantity_per_unit * input.saleQuantity,
    );
  });

  if (input.direction === -1) {
    for (const [ingredientId, requiredQuantity] of requiredByIngredient.entries()) {
      const ingredient = ingredientById.get(ingredientId);
      const beforeQty = ingredient ? ingredientBalanceValue(ingredient) : 0;
      if (beforeQty < requiredQuantity) {
        const unit = ingredient?.base_unit ?? 'unit';
        const shortBy = requiredQuantity - beforeQty;
        const rounded = unit === 'unit' ? Math.ceil(shortBy).toString() : shortBy.toFixed(2);
        throw new Error(`${ingredient?.name ?? 'Ingredient'} is short by ${rounded} ${unit}. Receive ingredient stock or correct the recipe.`);
      }
    }
  }

  const now = new Date().toISOString();
  const movements: IngredientMovement[] = [];
  const nextItems = items.map((item) => {
    const recipeQuantity = requiredByIngredient.get(item.id) ?? 0;
    if (recipeQuantity <= 0) return item;
    const beforeQty = ingredientBalanceValue(item);
    const change = input.direction * recipeQuantity;
    const afterQty = beforeQty + change;
    movements.push({
      id: crypto.randomUUID(),
      ingredient_id: item.id,
      movement_type: input.paymentMethod === 'void_sale' ? 'void_sale' : input.paymentMethod === 'complimentary' ? 'complimentary' : 'sale',
      quantity_change: change,
      quantity_before: beforeQty,
      quantity_after: afterQty,
      unit_input: 'recipe',
      input_quantity: recipeQuantity,
      pack_size_at_time: null,
      reference_type: 'sale',
      reference_id: input.referenceId,
      reason: input.reason ?? null,
      notes: 'Recipe stock usage',
      entered_by: input.enteredBy ?? null,
      created_by: null,
      created_at: now,
      ingredient_items: { name: item.name, base_unit: item.base_unit },
    });
    return { ...item, updated_at: now, ingredient_balances: { quantity_on_hand: afterQty } };
  });
  writeLocalIngredientItems(nextItems);
  if (movements.length > 0) write(ingredientMovementsKey, [...movements, ...loadLocalIngredientMovements()]);
}

export function voidLocalSale(saleId: string, reason: string) {
  const sales = loadLocalSales();
  const sale = sales.find((item) => item.id === saleId);
  if (!sale || sale.status === 'voided') return null;
  const saleItems = loadLocalSaleItems().filter((item) => item.sale_id === saleId);
  const now = new Date().toISOString();
  saleItems.forEach((item) => {
    if (!item.product_id) return;
    if (localProductHasRecipe(item.product_id)) {
      adjustLocalRecipeUsage({
        productId: item.product_id,
        saleQuantity: item.quantity,
        direction: 1,
        referenceId: saleId,
        paymentMethod: 'void_sale',
        enteredBy: sale.order_taken_by ?? null,
        reason,
      });
      return;
    }
    const adjustment = adjustLocalStock(item.product_id, item.quantity);
    if (!adjustment) return;
    recordLocalStockMovement({
      product_id: item.product_id,
      movement_type: 'void_sale',
      quantity_change: item.quantity,
      quantity_before: adjustment.quantityBefore,
      quantity_after: adjustment.quantityAfter,
      unit_input: 'system',
      input_quantity: item.quantity,
      carton_size_at_time: adjustment.product.carton_size,
      reference_type: 'sale',
      reference_id: saleId,
      reason,
      notes: 'Void sale stock reversal',
      entered_by: sale.order_taken_by ?? null,
      created_by: null,
      products: { name: item.products?.name ?? adjustment.product.name },
      created_at: now,
    });
  });
  const updatedSale: Sale = { ...sale, status: 'voided', void_reason: reason, voided_at: now };
  write(salesKey, sales.map((item) => (item.id === saleId ? updatedSale : item)));
  return updatedSale;
}


export function saveLocalSale(input: {
  items: Array<{ product_id: string | null; name: string; quantity: number; unit_price: number; line_total: number }>;
  paymentMethod: PaymentMethod;
  totalAmount: number;
  paidAmount: number;
  discountAmount: number;
  orderTakenBy: string;
  tableNumber?: string | null;
  qrReference?: string | null;
  qrPaymentType?: string | null;
  qrReceiptName?: string | null;
  qrReceiptDataUrl?: string | null;
  complimentaryReason?: string | null;
  businessCloseTime?: string | number | boolean | null;
  idempotencyKey?: string | null;
}) {
  const now = new Date();
  const date = malaysiaBusinessDateInputValue(now, input.businessCloseTime);
  const sales = loadLocalSales();
  const existingSale = input.idempotencyKey ? sales.find((sale) => sale.idempotency_key === input.idempotencyKey) : null;
  if (existingSale) return existingSale;
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
    table_number: input.tableNumber ?? null,
    complimentary_reason: input.complimentaryReason ?? null,
    qr_reference: input.qrReference ?? null,
    qr_payment_type: input.qrPaymentType ?? null,
    qr_receipt_image_path: input.qrReceiptDataUrl ?? (input.qrReceiptName ? `local/${input.qrReceiptName}` : null),
    qr_status: input.paymentMethod === 'qr' ? 'pending' : 'not_applicable',
    cashier_id: null,
    voided_by: null,
    void_reason: null,
    voided_at: null,
    idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
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
    if (!item.product_id) return;
    if (localProductHasRecipe(item.product_id)) {
      adjustLocalRecipeUsage({
        productId: item.product_id,
        saleQuantity: item.quantity,
        direction: -1,
        referenceId: sale.id,
        paymentMethod: input.paymentMethod,
        enteredBy: input.orderTakenBy,
        reason: input.paymentMethod === 'complimentary' ? input.complimentaryReason ?? 'FOC' : null,
      });
      return;
    }
    const adjustment = adjustLocalStock(item.product_id, -item.quantity);
    if (!adjustment) return;
    recordLocalStockMovement({
      product_id: item.product_id,
      movement_type: input.paymentMethod === 'complimentary' ? 'complimentary' : 'sale',
      quantity_change: -item.quantity,
      quantity_before: adjustment.quantityBefore,
      quantity_after: adjustment.quantityAfter,
      unit_input: 'system',
      input_quantity: item.quantity,
      carton_size_at_time: adjustment.product.carton_size,
      reference_type: 'sale',
      reference_id: sale.id,
      reason: input.paymentMethod === 'complimentary' ? input.complimentaryReason ?? 'FOC' : null,
      notes: input.paymentMethod === 'qr' ? input.qrPaymentType ?? null : null,
      entered_by: input.orderTakenBy,
      created_by: null,
      products: { name: item.name },
    });
  });
  write(salesKey, [sale, ...sales]);
  write(saleItemsKey, [...nextItems, ...saleItems]);
  return sale;
}
