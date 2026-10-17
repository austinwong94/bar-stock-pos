import { useEffect, useMemo, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { AlertTriangle, Banknote, Gift, Camera, Minus, PackagePlus, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { Field, buttonClass, dangerButtonClass, inputClass, secondaryButtonClass } from '../components/Form';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/Page';
import { WorkflowHelp } from '../components/WorkflowHelp';
import { useToast } from '../components/Toast';
import { groupByCategory, loadProducts } from '../lib/data';
import { malaysiaBusinessDateInputValue, money } from '../lib/format';
import { cartDiscount } from '../lib/posDiscount';
import { supabase, isDemoMode } from '../lib/supabase';
import { isSupabaseConfigured } from '../lib/supabase';
import { loadLocalIngredientItems, loadLocalRecipeIngredients, saveLocalSale } from '../lib/localStore';
import type { IngredientWithBalance, PaymentMethod, ProductWithStock, RecipeIngredient, SettingsMap } from '../lib/types';
import { useLanguage } from '../lib/language';
import { assetPath } from '../lib/assets';
import { hasAdminAccess, unlockAdminAccess } from '../lib/adminAccess';
import { useSharedRefresh } from '../lib/useSharedRefresh';
import { useAccess } from '../lib/access';
import { definitiveSaveFailure } from '../lib/saveAttempt';
import { clearPendingSale, persistPendingSale, readPendingSale, submitPendingSale, type PendingSale } from '../lib/pendingSale';
import { readAllRows } from '../lib/readAllRows';

type BundleComponent = { product: ProductWithStock; quantity: number };
type CartItem = {
  product: ProductWithStock;
  quantity: number;
  customPrice?: number;
  kind: 'product' | 'custom' | 'bundle';
  components?: BundleComponent[];
  bundleUnits?: number;
};
const qrPaymentTypes = ['WeChat Pay', 'AliPay', 'TnGo', 'Grab', 'Others'] as const;
type QrPaymentType = (typeof qrPaymentTypes)[number];

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function safeStorageFileName(name: string) {
  const clean = name.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').slice(0, 90);
  return clean || 'qr-payment-receipt.jpg';
}

function friendlySaleError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes('complete_sale_with_qr_type') || lower.includes('function') || lower.includes('column')) {
    return 'Ask the administrator to apply the latest database migrations, then reload this device.';
  }
  if (lower.includes('payment-receipts') || lower.includes('bucket')) {
    return 'QR receipt storage is not ready. Create or repair the private Supabase Storage bucket named payment-receipts.';
  }
  if (lower.includes('row-level security') || lower.includes('permission denied') || lower.includes('policy')) {
    return 'Your account cannot complete this payment. Ask a manager to check your access.';
  }
  return message;
}

function shouldRefreshProductsAfterSaleError(message: string) {
  const lower = message.toLowerCase();
  return lower.includes('stock') || lower.includes('ingredient') || lower.includes('insufficient') || lower.includes('short') || lower.includes('price') || lower.includes('bundle');
}

function parseStaffNames(settings: SettingsMap) {
  return String(settings.staff_names || 'Chloe, Happy, Elle, NekoMiao')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

function settingEnabled(value: SettingsMap[keyof SettingsMap]) {
  return value === true || value === 'true';
}

function settingNumber(value: SettingsMap[keyof SettingsMap], fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ingredientOnHand(item: IngredientWithBalance) {
  const balance = item.ingredient_balances;
  if (Array.isArray(balance)) return Number(balance[0]?.quantity_on_hand ?? 0);
  return Number(balance?.quantity_on_hand ?? 0);
}

function formatIngredientAmount(value: number, unit: string) {
  const rounded = unit === 'unit' ? Math.ceil(value).toString() : value.toFixed(value % 1 === 0 ? 0 : 2);
  return `${rounded} ${unit}`;
}

function positiveInt(value: number, fallback = 1) {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback;
}

function localDrinkFallback(product: ProductWithStock) {
  const name = product.name.toLowerCase();
  if (name.includes('pale')) return assetPath('assets/beer-pale-ale.svg');
  if (name.includes('dark')) return assetPath('assets/beer-dark.svg');
  if (name.includes('lager')) return assetPath('assets/beer-lager.svg');
  if (name.includes('coke')) return assetPath('assets/coke.svg');
  if (name.includes('7up')) return assetPath('assets/7up.svg');
  if (name.includes('fanta')) return assetPath('assets/fanta.svg');
  return assetPath('assets/custom-order.svg');
}

function cartKindLabel(item: CartItem, text: (english: string, malay: string) => string) {
  if (item.kind === 'bundle') return text('Beer Set', 'Set Bir');
  if (item.kind === 'custom') return text('Custom Order', 'Pesanan Khas');
  if (item.product.categories?.name === 'Beer') return text('Single Beer', 'Bir Individu');
  if (item.product.categories?.name === 'Cocktail') return text('Cocktail', 'Koktel');
  return text('Single Drink', 'Minuman Individu');
}

function cartUnitCount(item: CartItem) {
  if (item.kind === 'bundle') {
    return (item.components ?? []).reduce((sum, component) => sum + component.quantity, 0);
  }
  return item.quantity;
}

function cartPreviewLabel(item: CartItem, text: (english: string, malay: string) => string) {
  if (item.kind === 'bundle') return item.product.name + ' x ' + item.quantity + ' ' + text('bundle set', 'set bundle');
  if (item.kind === 'custom') return item.product.name + ' x ' + item.quantity + ' ' + text('custom order', 'pesanan khas');
  if (item.product.categories?.name === 'Beer') return item.product.name + ' x ' + item.quantity + ' ' + text('single beer', 'bir individu');
  return item.product.name + ' x ' + item.quantity + ' ' + text('single unit', 'unit individu');
}

function cartQuantityLine(item: CartItem, currency: string, text: (english: string, malay: string) => string) {
  const price = money(item.customPrice ?? item.product.price_per_unit, currency);
  if (item.kind === 'bundle') {
    return countLabel(item.quantity, text('Bundle Set', 'Set Bundle'), text('Bundle Sets', 'Set Bundle')) + ' x ' + price + ' · ' + countLabel(cartUnitCount(item), text('Beer Unit', 'Unit Bir'), text('Beer Units', 'Unit Bir'));
  }
  if (item.kind === 'custom') return countLabel(item.quantity, text('Custom Order', 'Pesanan Khas'), text('Custom Orders', 'Pesanan Khas')) + ' x ' + price;
  if (item.product.categories?.name === 'Beer') return countLabel(item.quantity, text('Beer Unit', 'Unit Bir'), text('Beer Units', 'Unit Bir')) + ' x ' + price;
  return countLabel(item.quantity, text('Unit', 'Unit'), text('Units', 'Unit')) + ' x ' + price;
}

function cartKindBadgeClass(kind: CartItem['kind']) {
  if (kind === 'bundle') return 'border-accent bg-accent/5 text-accent';
  if (kind === 'custom') return 'border-accent bg-shell text-accent';
  return 'border-line bg-white text-neutral-700';
}

const confirmationSchema = z.object({
  method: z.enum(['cash', 'qr', 'complimentary']),
  qrReference: z.string().optional(),
  qrPaymentType: z.string().optional(),
  complimentaryReason: z.string().optional(),
  tableNumber: z.string().optional(),
});

export default function POS({ settings }: { settings: SettingsMap }) {
  const { profile } = useAccess();
  return <POSTerminal key={profile?.id ?? 'signed-out'} settings={settings} />;
}

function POSTerminal({ settings }: { settings: SettingsMap }) {
  const toast = useToast();
  const { text } = useLanguage();
  const { profile,can } = useAccess();
  const pendingKey = `pos-pending:${import.meta.env.VITE_SUPABASE_URL ?? 'preview'}:${profile?.id}`;
  const [recovery] = useState(() => {
    try { return { sale: readPendingSale(localStorage, pendingKey), error: '' }; }
    catch (e) { return { sale: null, error: (e as Error).message }; }
  });
  const [pendingSale, setPendingSale] = useState<PendingSale | null>(recovery.sale);
  const [paymentError, setPaymentError] = useState(recovery.error);
  const paymentBusy = useRef(false);
  const [products, setProducts] = useState<ProductWithStock[]>([]);
  const [recipeProductIds, setRecipeProductIds] = useState<Set<string>>(() => new Set());
  const [recipeIngredients, setRecipeIngredients] = useState<RecipeIngredient[]>([]);
  const [ingredientBalances, setIngredientBalances] = useState<IngredientWithBalance[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [catalogView, setCatalogView] = useState('all');
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [qrReference, setQrReference] = useState('');
  const [qrPaymentType, setQrPaymentType] = useState<QrPaymentType | ''>('');
  const [qrReceipt, setQrReceipt] = useState<File | null>(null);
  const [tableNumber, setTableNumber] = useState('');
  const [complimentaryReason, setComplimentaryReason] = useState('');
  const [focApprovalPin, setFocApprovalPin] = useState('');
  const [focApproved, setFocApproved] = useState(false);
  const [focApprovalBusy, setFocApprovalBusy] = useState(false);
  const [orderTakenBy, setOrderTakenBy] = useState(parseStaffNames(settings)[0] ?? 'Chloe');
  const [catalogueError,setCatalogueError]=useState('');
  const catalogueGeneration=useRef(0);
  const [discountRate, setDiscountRate] = useState<number | null>(0);
  const [customName, setCustomName] = useState('Custom Order');
  const [customPrice, setCustomPrice] = useState('');
  const [customDiscount, setCustomDiscount] = useState('');
  useEffect(() => {
    if (!cart.length && !pendingSale) { setDiscountRate(0); setCustomDiscount(''); }
  }, [cart.length, pendingSale]);
  const [bundleModalOpen, setBundleModalOpen] = useState(false);
  const [bundleSets, setBundleSets] = useState(1);
  const [bundleSelections, setBundleSelections] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [saleIdempotencyKey, setSaleIdempotencyKey] = useState('');
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);
  const cameraInputId = 'qr-receipt-camera';
  const staffUsers = useMemo(() => parseStaffNames(settings), [settings]);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setClock(new Date()), 30000); return () => clearInterval(timer); }, []);
  const todayLabel = format(parseISO(malaysiaBusinessDateInputValue(clock, settings.business_day_close_time)), 'EEE, d MMM yyyy');
  const bundleEnabled = settingEnabled(settings.beer_bundle_enabled);
  const allowNegativeStock = settingEnabled(settings.allow_negative_stock);
  const bundleName = String(settings.beer_bundle_name || 'Beer Bundle');
  const bundleUnits = positiveInt(settingNumber(settings.beer_bundle_units_per_set, 4), 4);
  const bundlePrice = Math.max(0, settingNumber(settings.beer_bundle_price, 40));
  const requireFocApproval = settingEnabled(settings.require_manager_approval_for_complimentary);

  async function refreshProducts(updateOrderPrices = false) {
    const generation=++catalogueGeneration.current;
    try {
    const nextProducts = await loadProducts(false);
    if (!isSupabaseConfigured) {
      setProducts(nextProducts);setCatalogueError('');
      const localRecipes = loadLocalRecipeIngredients();
      setRecipeIngredients(localRecipes);
      setIngredientBalances(loadLocalIngredientItems(true));
      setRecipeProductIds(new Set(localRecipes.map((item) => item.product_id)));
      return;
    }
    const [recipes,ingredients] = await Promise.all([
      readAllRows<RecipeIngredient>((from,to)=>supabase
        .from('recipe_ingredients')
        .select('id, product_id, ingredient_id, quantity_per_unit, unit, created_at, ingredient_items(id, name, category, base_unit)')
        .order('id').range(from,to)),
      readAllRows<IngredientWithBalance>((from,to)=>supabase
        .from('ingredient_items')
        .select('*, ingredient_balances(quantity_on_hand)')
        .eq('active', true)
        .order('name').order('id').range(from,to)),
    ]);
    if(generation!==catalogueGeneration.current)return;
    setProducts(nextProducts);setCatalogueError('');
    setRecipeIngredients(recipes);
    setIngredientBalances(ingredients);
    setRecipeProductIds(new Set(recipes.map((item) => item.product_id)));
    if(updateOrderPrices){
      setCart(current=>current.filter(item=>item.kind!=='bundle').map(item=>item.kind==='product'?{...item,product:nextProducts.find(p=>p.id===item.product.id)??item.product}:item));
      window.dispatchEvent(new Event('business-settings-refresh'));
    }
    } catch(e){if(generation===catalogueGeneration.current)setCatalogueError((e as Error).message||text('Stock could not be updated. Retry before taking payment.','Stok tidak dapat dikemas kini. Cuba lagi sebelum menerima bayaran.'));throw e;}
  }

  useEffect(() => {
    void refreshProducts().catch(()=>{});
    return()=>{catalogueGeneration.current++;};
  }, []);

  useSharedRefresh(refreshProducts, {
    tables: ['products', 'inventory_balances', 'categories', 'app_settings', 'recipe_ingredients', 'ingredient_items', 'ingredient_balances'],
    intervalMs: 12000,
  });

  useEffect(() => {
    if (staffUsers.length > 0 && !staffUsers.includes(orderTakenBy)) {
      setOrderTakenBy(staffUsers[0]);
    }
  }, [orderTakenBy, staffUsers]);

  const groups = useMemo(() => groupByCategory(products), [products]);
  const beerProducts = groups.Beer ?? [];
  const subtotal = cart.reduce((sum, item) => sum + item.quantity * Number(item.customPrice ?? item.product.price_per_unit), 0);
  const discount = cartDiscount(subtotal, discountRate, customDiscount);
  const total = Math.max(0, subtotal - discount);
  const cartQuantity = cart.reduce((sum, item) => sum + cartUnitCount(item), 0);
  const hasBundleInCart = cart.some((item) => item.kind === 'bundle');
  const regularGroups = Object.entries(groups).filter(([category]) => category !== 'Others');

  function categoryDomId(category: string) {
    return `pos-category-${category.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  }


  function isRecipeProduct(productId: string) {
    return recipeProductIds.has(productId);
  }

  function productNeedsRecipe(product: ProductWithStock) {
    return product.categories?.name === 'Cocktail' && !isRecipeProduct(product.id);
  }

  const ingredientById = useMemo(() => new Map(ingredientBalances.map((item) => [item.id, item])), [ingredientBalances]);

  function recipeAvailability(productId: string, quantity = 1) {
    const recipeLines = recipeIngredients.filter((recipe) => recipe.product_id === productId);
    const grouped = new Map<string, { name: string; unit: string; perUnit: number; required: number; balance: number }>();
    recipeLines.forEach((recipe) => {
      const ingredient = ingredientById.get(recipe.ingredient_id);
      const unit = ingredient?.base_unit ?? recipe.ingredient_items?.base_unit ?? recipe.unit ?? 'unit';
      const current = grouped.get(recipe.ingredient_id) ?? {
        name: ingredient?.name ?? recipe.ingredient_items?.name ?? 'Ingredient',
        unit,
        perUnit: 0,
        required: 0,
        balance: ingredient ? ingredientOnHand(ingredient) : 0,
      };
      current.perUnit += Number(recipe.quantity_per_unit || 0);
      current.required += Number(recipe.quantity_per_unit || 0) * quantity;
      grouped.set(recipe.ingredient_id, current);
    });
    const lines = Array.from(grouped.values()).filter((line) => line.perUnit > 0);
    const shortages = lines
      .filter((line) => line.balance + 0.0001 < line.required)
      .map((line) => ({ ...line, shortage: line.required - line.balance }));
    const maxMake = lines.length > 0 ? Math.min(...lines.map((line) => Math.floor(line.balance / line.perUnit))) : 0;
    return {
      hasRecipe: recipeLines.length > 0,
      canMake: recipeLines.length > 0 && shortages.length === 0,
      maxMake: Number.isFinite(maxMake) ? Math.max(0, maxMake) : 0,
      shortages,
    };
  }

  function recipeCartIngredientShortages(items = cart) {
    const required = new Map<string, { name: string; unit: string; required: number; balance: number }>();
    items.forEach((item) => {
      if (item.kind !== 'product' || !isRecipeProduct(item.product.id)) return;
      recipeIngredients
        .filter((recipe) => recipe.product_id === item.product.id)
        .forEach((recipe) => {
          const ingredient = ingredientById.get(recipe.ingredient_id);
          const unit = ingredient?.base_unit ?? recipe.ingredient_items?.base_unit ?? recipe.unit ?? 'unit';
          const current = required.get(recipe.ingredient_id) ?? {
            name: ingredient?.name ?? recipe.ingredient_items?.name ?? 'Ingredient',
            unit,
            required: 0,
            balance: ingredient ? ingredientOnHand(ingredient) : 0,
          };
          current.required += Number(recipe.quantity_per_unit || 0) * item.quantity;
          required.set(recipe.ingredient_id, current);
        });
    });
    return Array.from(required.values())
      .filter((line) => line.balance + 0.0001 < line.required)
      .map((line) => ({ ...line, shortage: line.required - line.balance }));
  }

  function recipeShortageMessage(shortages: ReturnType<typeof recipeCartIngredientShortages>) {
    const first = shortages[0];
    if (!first) return '';
    return `${first.name} ${text('is short by', 'kurang')} ${formatIngredientAmount(first.shortage, first.unit)}.`;
  }

  const bundleRequiredUnits = bundleUnits * bundleSets;
  const bundleSelectedUnits = Object.values(bundleSelections).reduce((sum, quantity) => sum + quantity, 0);
  const bundleMissingUnits = Math.max(0, bundleRequiredUnits - bundleSelectedUnits);
  const bundleUnitProgress = bundleRequiredUnits > 0 ? Math.min(100, (bundleSelectedUnits / bundleRequiredUnits) * 100) : 0;

  function updateBundleSets(nextValue: number) {
    setBundleSets(positiveInt(nextValue, 1));
    setBundleSelections({});
  }

  function cartSingleProductQuantity(productId: string) {
    return cart.reduce((sum, item) => sum + (item.kind === 'product' && item.product.id === productId ? item.quantity : 0), 0);
  }

  function cartBundleProductQuantity(productId: string) {
    return cart.reduce((sum, item) => {
      if (item.kind !== 'bundle') return sum;
      return sum + (item.components ?? []).reduce((unitSum, component) => unitSum + (component.product.id === productId ? component.quantity : 0), 0);
    }, 0);
  }

  function cartProductQuantity(productId: string) {
    return cartSingleProductQuantity(productId) + cartBundleProductQuantity(productId);
  }

  function linePrice(item: CartItem) {
    return item.quantity * Number(item.customPrice ?? item.product.price_per_unit);
  }

  function nextCartWithProduct(product: ProductWithStock) {
    const found = cart.find((item) => item.kind === 'product' && item.product.id === product.id);
    if (found) {
      return cart.map((item) =>
        item.kind === 'product' && item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item,
      );
    }
    return [...cart, { product, quantity: 1, kind: 'product' } as CartItem];
  }

  function add(product: ProductWithStock) {
    const nextItems = nextCartWithProduct(product);
    if (!validateCartStock(nextItems)) return;
    setCart(nextItems);
  }

  function addCustomOrder() {
    if(!can('bar.pos.custom'))return;
    const price = Number(customPrice);
    if (!Number.isFinite(price) || price <= 0) {
      toast.error('Enter a custom price first.');
      return;
    }
    const customProduct: ProductWithStock = {
      id: `custom-${crypto.randomUUID()}`,
      name: customName.trim() || 'Custom Order',
      category_id: null,
      price_per_unit: price,
      cost_per_unit: null,
      carton_size: 1,
      low_stock_threshold: 0,
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      categories: { id: 'custom', name: 'Others', sort_order: 99 },
      inventory_balances: { quantity_on_hand: 9999 },
    };
    setCart((items) => [...items, { product: customProduct, quantity: 1, customPrice: price, kind: 'custom' }]);
    setCustomPrice('');
  }

  function openBundleModal() {
    if (!bundleEnabled) {
      toast.error('Beer bundle is disabled in Admin > Products.');
      return;
    }
    if (bundlePrice <= 0) {
      toast.error('Set the beer bundle price in Admin > Products first.');
      return;
    }
    if (beerProducts.length === 0) {
      toast.error('No active beer products found.');
      return;
    }
    setBundleSets(1);
    setBundleSelections({});
    setBundleModalOpen(true);
  }

  function changeBundleSelection(product: ProductWithStock, delta: number) {
    setBundleSelections((current) => {
      const currentQuantity = current[product.id] ?? 0;
      const nextQuantity = Math.max(0, currentQuantity + delta);
      const nextTotal = Object.entries(current).reduce((sum, [productId, quantity]) => sum + (productId === product.id ? nextQuantity : quantity), 0);
      if (delta > 0 && nextTotal > bundleRequiredUnits) {
        toast.error(text('Select exactly', 'Pilih tepat') + ` ${bundleRequiredUnits} ` + text('beer units for this bundle.', 'unit bir untuk set ini.'));
        return current;
      }
      const stock = product.inventory_balances?.quantity_on_hand ?? 0;
      const alreadyInCart = cartProductQuantity(product.id);
      if (!allowNegativeStock && alreadyInCart + nextQuantity > stock) {
        toast.error(`${product.name} ${text('does not have enough individual units left.', 'tidak mempunyai unit individu yang cukup.')}`);
        return current;
      }
      const next = { ...current, [product.id]: nextQuantity };
      if (nextQuantity === 0) delete next[product.id];
      return next;
    });
  }

  function addBundleToCart() {
    if (bundleSelectedUnits !== bundleRequiredUnits) {
      toast.error(text('Select exactly', 'Pilih tepat') + ` ${bundleRequiredUnits} ` + text('beer units.', 'unit bir.'));
      return;
    }
    const components = beerProducts
      .map((product) => ({ product, quantity: bundleSelections[product.id] ?? 0 }))
      .filter((component) => component.quantity > 0);
    if (components.length === 0) {
      toast.error('Choose the beer types for this bundle.');
      return;
    }
    const bundleProduct: ProductWithStock = {
      id: `bundle-${crypto.randomUUID()}`,
      name: bundleName,
      category_id: null,
      price_per_unit: bundlePrice,
      cost_per_unit: null,
      carton_size: bundleUnits,
      low_stock_threshold: 0,
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      categories: { id: 'bundle', name: 'Beer', sort_order: 0 },
      inventory_balances: { quantity_on_hand: 9999 },
    };
    setCart((items) => [...items, { product: bundleProduct, quantity: bundleSets, customPrice: bundlePrice, kind: 'bundle', components, bundleUnits }]);
    setBundleModalOpen(false);
    toast.success(`${bundleName} added: ${components.map((component) => `${component.product.name} x ${component.quantity}`).join(', ')}.`);
  }

  function choosePayment(nextMethod: PaymentMethod) {
    if (!validateCartStock()) return;
    setCartDrawerOpen(false);
    setMethod(nextMethod);
    setQrReference('');
    setQrPaymentType('');
    setTableNumber('');
    setQrReceipt(null);
    setComplimentaryReason('');
    setFocApprovalPin('');
    setFocApproved(nextMethod === 'complimentary' ? !requireFocApproval || hasAdminAccess() : false);
    setSaleIdempotencyKey(crypto.randomUUID());
    if (nextMethod === 'qr') {
      window.setTimeout(() => document.getElementById(cameraInputId)?.click(), 50);
    }
  }

  async function approveFoc() {
    if (focApprovalBusy) return;
    setFocApprovalBusy(true);
    try {
      const result = await unlockAdminAccess(focApprovalPin);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setFocApproved(true);
      setFocApprovalPin('');
      toast.success(text('FOC approval accepted.', 'Kelulusan FOC diterima.'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text('Could not approve FOC.', 'Tidak dapat luluskan FOC.'));
    } finally {
      setFocApprovalBusy(false);
    }
  }

  function applyDiscountPercent(percent: number) {
    setCustomDiscount('');
    setDiscountRate(percent);
  }

  function cartStockIssue(items = cart) {
    if (allowNegativeStock) return null;
    const missingRecipe = items.find((item) => item.kind === 'product' && productNeedsRecipe(item.product));
    if (missingRecipe) {
      return `${missingRecipe.product.name} ${text('needs a cocktail recipe before it can be sold.', 'memerlukan resipi koktel sebelum boleh dijual.')}`;
    }
    const ingredientShortages = recipeCartIngredientShortages(items);
    if (ingredientShortages.length > 0) {
      return recipeShortageMessage(ingredientShortages) || text('Cocktail ingredient stock is insufficient.', 'Stok bahan koktel tidak mencukupi.');
    }

    const stockNeeded = new Map<string, { product: ProductWithStock; quantity: number }>();
    items.forEach((item) => {
      if (item.kind === 'custom') return;
      if (item.kind === 'bundle') {
        (item.components ?? []).forEach((component) => {
          const current = stockNeeded.get(component.product.id) ?? { product: component.product, quantity: 0 };
          current.quantity += component.quantity;
          stockNeeded.set(component.product.id, current);
        });
        return;
      }
      if (isRecipeProduct(item.product.id)) return;
      const current = stockNeeded.get(item.product.id) ?? { product: item.product, quantity: 0 };
      current.quantity += item.quantity;
      stockNeeded.set(item.product.id, current);
    });

    for (const { product, quantity } of stockNeeded.values()) {
      const stock = product.inventory_balances?.quantity_on_hand ?? 0;
      if (quantity > stock) {
        return `${product.name} ${text('only has', 'hanya ada')} ${countLabel(stock, text('unit available.', 'unit tersedia.'), text('units available.', 'unit tersedia.'))}`;
      }
    }
    return null;
  }

  function validateCartStock(items = cart) {
    const issue = cartStockIssue(items);
    if (issue) {
      toast.error(issue);
      return false;
    }
    return true;
  }

  function change(productId: string, delta: number) {
    const nextItems = cart
      .map((item) =>
        item.kind !== 'bundle' && item.product.id === productId ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item,
      )
      .filter((item) => item.quantity > 0);
    if (delta > 0 && !validateCartStock(nextItems)) return;
    setCart(nextItems);
  }

  function removeCartItem(productId: string) {
    setCart((items) => items.filter((item) => item.product.id !== productId));
  }

  function bundleComponentLineItems(item: CartItem) {
    const components = item.components ?? [];
    const unitValue = components.length > 0 ? linePrice(item) / components.reduce((sum, component) => sum + component.quantity, 0) : 0;
    return components.map((component) => ({
      product_id: component.product.id,
      name: component.product.name,
      quantity: component.quantity,
      unit_price: Number(unitValue.toFixed(2)),
      line_total: Number((unitValue * component.quantity).toFixed(2)),
    }));
  }

  function localSaleItems() {
    return cart.flatMap((item) => {
      if (item.kind === 'bundle') return bundleComponentLineItems(item);
      return [{
        product_id: item.product.id.startsWith('custom-') ? null : item.product.id,
        name: item.product.name,
        quantity: item.quantity,
        unit_price: Number(item.customPrice ?? item.product.price_per_unit),
        line_total: linePrice(item),
      }];
    });
  }

  function fileToDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error ?? new Error('Could not read QR Payment receipt image.'));
      reader.readAsDataURL(file);
    });
  }


  function rpcSaleItems() {
    return cart.map((item) => {
      if (item.kind === 'bundle') {
        return {
          product_id: null,
          bundle: true,
          name: item.product.name,
          quantity: item.quantity,
          custom_price: null,
          expected_bundle_price: Number(item.product.price_per_unit),
          expected_bundle_units: item.bundleUnits,
          components: (item.components ?? []).map((component) => ({
            product_id: component.product.id,
            quantity: component.quantity,
          })),
        };
      }
      return {
        product_id: item.product.id.startsWith('custom-') ? null : item.product.id,
        name: item.product.name,
        quantity: item.quantity,
        custom_price: item.kind === 'custom' ? item.customPrice ?? null : null,
        expected_unit_price: item.kind === 'custom' ? null : Number(item.product.price_per_unit),
      };
    });
  }

  async function confirmSale() {
    if (!method || saving || paymentBusy.current || pendingSale || catalogueError) return;
    if (!validateCartStock()) return;
    if (discount > subtotal) {
      toast.error('Discount cannot be more than subtotal.');
      return;
    }
    if (method === 'qr') {
      if (!qrPaymentType) {
        toast.error(text('Select a QR Payment type before confirming.', 'Pilih jenis Bayaran QR sebelum sahkan.'));
        return;
      }
      if (settingEnabled(settings.require_qr_reference) && qrReference.trim().length === 0) {
        toast.error(text('Enter the QR Payment reference before confirming.', 'Masukkan rujukan Bayaran QR sebelum sahkan.'));
        return;
      }
      if (!qrReceipt) {
        toast.error(text('Take a QR Payment receipt photo before confirming.', 'Ambil gambar resit Bayaran QR sebelum sahkan.'));
        window.setTimeout(() => document.getElementById(cameraInputId)?.click(), 50);
        return;
      }
    }
    if (method === 'complimentary' && complimentaryReason.trim().length === 0) {
      toast.error(text('Enter the Complimentary (FOC) reason before confirming.', 'Masukkan sebab Percuma (FOC) sebelum sahkan.'));
      return;
    }
    if (method === 'complimentary' && requireFocApproval && !focApproved) {
      toast.error(text('Manager approval is required before confirming FOC.', 'Kelulusan pengurus diperlukan sebelum sahkan FOC.'));
      return;
    }
    const idempotencyKey = saleIdempotencyKey || crypto.randomUUID();
    if (!saleIdempotencyKey) setSaleIdempotencyKey(idempotencyKey);
    const parsed = confirmationSchema.safeParse({ method, qrReference, qrPaymentType, complimentaryReason, tableNumber });
    if (!parsed.success) {
      toast.error('Check the confirmation fields.');
      return;
    }
    setSaving(true);
    paymentBusy.current = true;
    try {
    if (!isSupabaseConfigured) {
      let qrReceiptDataUrl: string | null = null;
      if (method === 'qr' && qrReceipt) {
        try {
          qrReceiptDataUrl = await fileToDataUrl(qrReceipt);
        } catch (error) {
          setSaving(false);
          toast.error(error instanceof Error ? error.message : text('Could not save QR Payment receipt image locally.', 'Tidak dapat simpan gambar resit Bayaran QR pada peranti ini.'));
          return;
        }
      }
      const savedSale = saveLocalSale({
        items: localSaleItems(),
        paymentMethod: method,
        totalAmount: total,
        paidAmount: method === 'complimentary' ? 0 : total,
        discountAmount: discount,
        orderTakenBy,
        tableNumber: tableNumber.trim() || null,
        qrReference: qrReference || null,
        qrPaymentType: method === 'qr' ? qrPaymentType : null,
        qrReceiptName: qrReceipt?.name ?? null,
        qrReceiptDataUrl,
        complimentaryReason: complimentaryReason || null,
        businessCloseTime: settings.business_day_close_time,
        idempotencyKey,
      });
      setSaving(false);
      setCart([]);
      setDiscountRate(0);
      setCustomDiscount('');
      setMethod(null);
      setQrReference('');
      setQrPaymentType('');
      setTableNumber('');
      setQrReceipt(null);
      setComplimentaryReason('');
      setFocApprovalPin('');
      setFocApproved(false);
      setSaleIdempotencyKey('');
      await refreshProducts();
      toast.success(`Sale ${savedSale.sale_number} saved by ${orderTakenBy}. Total ${money(total, String(settings.currency_symbol))}.`);
      return;
    }
    let qrReceiptPath: string | null = null;
    if (method === 'qr' && qrReceipt) {
      const path = `qr-receipts/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safeStorageFileName(qrReceipt.name)}`;
      const upload = await supabase.storage.from('payment-receipts').upload(path, qrReceipt);
      if (upload.error) {
        setSaving(false);
        toast.error(friendlySaleError(upload.error.message));
        return;
      }
      qrReceiptPath = upload.data.path;
    }
    const attempt: PendingSale = { version: 1, createdAt: new Date().toISOString(), summary: {
      items: cart.map(item => cartPreviewLabel(item, text)), total, staff: orderTakenBy, method, table: tableNumber.trim(),
    }, payload: {
      p_items: rpcSaleItems(),
      p_payment_method: method,
      p_qr_reference: qrReference || null,
      p_qr_receipt_image_path: qrReceiptPath,
      p_qr_payment_type: method === 'qr' ? qrPaymentType : null,
      p_complimentary_reason: complimentaryReason || null,
      p_discount_amount: discount,
      p_order_taken_by: orderTakenBy,
      p_table_number: tableNumber.trim() || null,
      p_idempotency_key: idempotencyKey,
    }};
    persistPendingSale(localStorage, pendingKey, attempt);
    setPendingSale(attempt);
    setMethod(null);
    setCartDrawerOpen(false);
    await resolvePayment(attempt);
    } catch (error) {
      toast.error(friendlySaleError((error as Error).message || 'Could not prepare payment.'));
    } finally { paymentBusy.current = false; setSaving(false); }
  }

  async function resolvePayment(attempt: PendingSale) {
    setPaymentError('');
    let confirmed = false;
    try {
      // The same immutable request recovers a committed sale when its response was lost.
      const data = await submitPendingSale(supabase, attempt);
      confirmed = true;
      clearPendingSale(localStorage, pendingKey, attempt);
      setPendingSale(readPendingSale(localStorage, pendingKey));
      setCart([]); setMethod(null); setDiscountRate(0); setCustomDiscount(''); setTableNumber('');
      setQrReference(''); setQrPaymentType(''); setQrReceipt(null);
      setComplimentaryReason(''); setFocApprovalPin(''); setFocApproved(false); setSaleIdempotencyKey('');
      if (data.status === 'voided') toast.error(text(`Sale ${data.sale_number} was recorded and later voided. It has not been charged again. Check Sales.`, `Jualan ${data.sale_number} telah direkod dan kemudian dibatalkan. Tiada caj semula. Semak Jualan.`));
      else toast.success(`Sale ${data.sale_number} saved. Total ${money(data.total_amount, String(settings.currency_symbol))}.`);
      try { await refreshProducts(); } catch { toast.error(text('Payment saved. Stock refresh failed; refresh before the next order.', 'Bayaran disimpan. Muat semula stok sebelum pesanan seterusnya.')); }
    } catch (error) {
      if (!confirmed && definitiveSaveFailure(error)) {
        clearPendingSale(localStorage, pendingKey, attempt);
        setPendingSale(readPendingSale(localStorage, pendingKey));
        setSaleIdempotencyKey('');
        toast.error(text('Payment not completed. ', 'Bayaran tidak diselesaikan. ') + friendlySaleError((error as Error).message));
        // Receipts are retained: a lost earlier response is not proof that a file is unused.
        if (shouldRefreshProductsAfterSaleError((error as Error).message)) void refreshProducts((error as Error).message.toLowerCase().includes('price')).catch(() => {});
      } else setPaymentError((error as { code?: string }).code === 'LP001'
        ? (error as Error).message
        : text('Confirmation pending. Do not take payment again. Check this payment to retrieve the saved result or safely finish the original request.', 'Pengesahan belum diterima. Jangan ambil bayaran lagi. Semak bayaran ini untuk mendapatkan hasil atau menyelesaikan permintaan asal.'));
    }
  }

  async function checkPayment() {
    if (!pendingSale || paymentBusy.current) return;
    paymentBusy.current = true; setSaving(true);
    try { await resolvePayment(pendingSale); }
    finally { paymentBusy.current = false; setSaving(false); }
  }

  const cartIngredientShortages = useMemo(() => (!allowNegativeStock ? recipeCartIngredientShortages(cart) : []), [allowNegativeStock, cart, ingredientById, recipeIngredients]);

  const confirmDisabled =
    !!catalogueError ||
    saving ||
    cart.length === 0 ||
    !orderTakenBy ||
    discount > subtotal ||
    cartStockIssue() !== null ||
    (method === 'qr' && !qrPaymentType) ||
    (method === 'qr' && !qrReceipt) ||
    (method === 'qr' && settingEnabled(settings.require_qr_reference) && qrReference.trim().length === 0) ||
    (method === 'complimentary' && complimentaryReason.trim().length === 0) ||
    (method === 'complimentary' && requireFocApproval && !focApproved);

  function renderCartPanel(inDrawer = false) {
    return (
      <>
        {!inDrawer ? <h2 className="text-base font-semibold">{text('Order Cart', 'Bakul')}</h2> : null}
        <p className="mt-1 text-sm font-bold text-accent">{text('Accepted by', 'Diterima oleh')} {orderTakenBy}</p>
        <div className="bar-cart-lines">
          {cart.length === 0 ? <p className="text-muted">{text('No items selected.', 'Tiada item dipilih.')}</p> : null}
          {cartIngredientShortages.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs font-bold text-warning sm:rounded-lg sm:p-3 sm:text-sm">
              <p className="font-semibold">{text('Cocktail ingredient shortage', 'Bahan koktel tidak cukup')}</p>
              <p>{recipeShortageMessage(cartIngredientShortages)} {text('Receive ingredient stock or reduce the cocktail quantity.', 'Masukkan stok bahan atau kurangkan kuantiti koktel.')}</p>
            </div>
          ) : null}
          {cart.map((item) => (
            <div key={item.product.id} className="bar-cart-line">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <strong className="block break-words">{item.product.name}</strong>
                  <span className="bar-cart-kind">
                    {cartKindLabel(item, text)}
                  </span>
                </div>
                <span className="shrink-0 text-right">{money(linePrice(item), String(settings.currency_symbol))}</span>
              </div>
              <p className="mt-1 text-sm text-muted">
                {cartQuantityLine(item, String(settings.currency_symbol), text)}
              </p>
              {item.kind === 'bundle' ? (
                <p className="mt-1 text-xs font-bold text-muted">
                  {text('Beer stock reduced as', 'Stok bir ditolak sebagai')}: {(item.components ?? []).map((component) => `${component.product.name} x ${component.quantity}`).join(', ')}
                </p>
              ) : null}
              <div className="mt-2 flex gap-2 sm:mt-3">
                {item.kind !== 'bundle' ? (
                  <>
                    <button className={`${secondaryButtonClass} w-10 !p-0 sm:w-12`} onClick={() => change(item.product.id, -1)} aria-label="Decrease">
                      <Minus className="h-4 w-4" />
                    </button>
                    <button className={`${secondaryButtonClass} w-10 !p-0 sm:w-12`} onClick={() => change(item.product.id, 1)} aria-label="Increase">
                      <Plus className="h-4 w-4" />
                    </button>
                  </>
                ) : null}
                <button className={`${dangerButtonClass} w-10 !p-0 sm:w-12`} onClick={() => removeCartItem(item.product.id)} aria-label="Remove">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="bar-cart-summary">
          <Field label={text('Discount', 'Diskaun')}>
            <div className="bar-discounts">
              <button type="button" aria-label="0%" aria-pressed={discountRate === 0} className={`${secondaryButtonClass} px-2`} onClick={() => { setCustomDiscount(''); setDiscountRate(0); }}>
                0%
              </button>
              {[0.05, 0.1, 0.15, 0.2].map((rate) => (
                <button key={rate} type="button" aria-pressed={discountRate === rate} className={`${secondaryButtonClass} px-2`} onClick={() => applyDiscountPercent(rate)}>
                  {Math.round(rate * 100)}%
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-sm font-semibold text-accent">RM</span>
              <input
                className={inputClass}
                type="number"
                min={0}
                step="0.01"
                value={customDiscount}
                onChange={(e) => {
                  setCustomDiscount(e.target.value);
                  setDiscountRate(null);
                }}
                aria-label={text('Discount Amount (RM)', 'Jumlah Diskaun (RM)')}
                placeholder={text('Discount Amount (RM)', 'Jumlah Diskaun (RM)')}
              />
            </div>
          </Field>
          <div className="mt-3 flex justify-between gap-3 font-bold sm:mt-4">
            <span>{text('Subtotal', 'Subtotal')}</span>
            <span>{money(subtotal, String(settings.currency_symbol))}</span>
          </div>
          <div className="mt-2 flex justify-between gap-3 font-bold text-accent">
            <span>{text('Discount amount', 'Jumlah diskaun')}</span>
            <span>- {money(discount, String(settings.currency_symbol))}</span>
          </div>
          <div className="mt-2 flex justify-between gap-3 text-xl font-semibold sm:text-2xl">
            <span>{text('Total', 'Jumlah')}</span>
            <span>{money(total, String(settings.currency_symbol))}</span>
          </div>
          <div className="bar-payment-actions">
            <button className={buttonClass} aria-label={text('Cash Payment', 'Bayaran Tunai')} disabled={cart.length === 0} onClick={() => choosePayment('cash')}>
              <Banknote className="h-4 w-4" />{text('Cash', 'Tunai')}
            </button>
            <button className={buttonClass} aria-label={text('QR Payment', 'Bayaran QR')} disabled={cart.length === 0} onClick={() => choosePayment('qr')}>
              <Camera className="h-5 w-5" />
              QR
            </button>
            <button className={secondaryButtonClass} disabled={cart.length === 0} onClick={() => choosePayment('complimentary')}>
              <Gift className="h-4 w-4" />{text('Complimentary (FOC)', 'Percuma (FOC)')}
            </button>
          </div>
        </div>
      </>
    );
  }

  function renderLiveCartPanel() {
    if (cart.length === 0) return null;
    return (
      <section className="bar-live-cart" aria-label={text('Selected Order', 'Pesanan Dipilih')}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">{text('Selected Order', 'Pesanan Dipilih')}</h2>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted">{countLabel(cartQuantity, text('Unit', 'Unit'), text('Units', 'Unit'))}</p>
            <p className="text-base font-semibold">{money(total, String(settings.currency_symbol))}</p>
          </div>
        </div>
        {cartIngredientShortages.length > 0 ? (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs font-semibold text-warning">
            {recipeShortageMessage(cartIngredientShortages)}
          </p>
        ) : null}
        <div className="bar-live-cart-list mt-2">
          {cart.map((item) => (
            <div key={item.product.id} className="bar-live-cart-row">
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-1">
                  <p className="break-words text-sm font-semibold">{item.product.name}</p>
                  <span className="bar-cart-kind">
                  {cartKindLabel(item, text)}
                  </span>
                </div>
                <p className="text-xs font-bold text-muted">
                  {item.kind === 'bundle'
                    ? countLabel(item.quantity, text('Bundle Set', 'Set Bundle'), text('Bundle Sets', 'Set Bundle')) + ' · ' + text('stock mix', 'campuran stok') + ': ' + (item.components ?? []).map((component) => component.product.name + ' x ' + component.quantity).join(', ')
                    : cartQuantityLine(item, String(settings.currency_symbol), text)}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {item.kind !== 'bundle' ? (
                  <>
                    <button className={`${secondaryButtonClass} h-9 min-h-9 w-9 !p-0`} onClick={() => change(item.product.id, -1)} aria-label="Decrease">
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="grid h-9 min-w-9 place-items-center rounded-lg bg-accent/5 px-2 text-sm font-semibold text-accent">{item.quantity}</span>
                    <button className={`${secondaryButtonClass} h-9 min-h-9 w-9 !p-0`} onClick={() => change(item.product.id, 1)} aria-label="Increase">
                      <Plus className="h-4 w-4" />
                    </button>
                  </>
                ) : (
                  <button className={`${dangerButtonClass} h-9 min-h-9 w-9 !p-0`} onClick={() => removeCartItem(item.product.id)} aria-label="Remove">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (pendingSale || recovery.error) return <div className="space-y-4">
    <PageHeader title={text('Payment Confirmation', 'Pengesahan Bayaran')} actions={<WorkflowHelp area="bar" />} />
    <section className="border-y border-line py-4" aria-live="polite">
      <h2 className="text-base font-semibold">{saving ? text('Checking Payment...', 'Menyemak Bayaran...') : text('Confirmation Pending', 'Menunggu Pengesahan')}</h2>
      <p className="mt-2 text-sm">{paymentError || text('Keep this order until its payment is confirmed. Do not collect payment again.', 'Simpan pesanan ini sehingga bayaran disahkan. Jangan kutip bayaran lagi.')}</p>
      {pendingSale ? <>
        <p className="my-3 text-sm">{pendingSale.summary.staff} · {pendingSale.summary.method.toUpperCase()}{pendingSale.summary.table ? ` · ${text('Table', 'Meja')} ${pendingSale.summary.table}` : ''}</p>
        <ul className="divide-y divide-line">{pendingSale.summary.items.map((item, index) => <li key={index} className="py-2 text-sm">{item}</li>)}</ul>
        <p className="my-3 font-semibold">{money(pendingSale.summary.total, String(settings.currency_symbol))}</p>
        <button type="button" className={buttonClass} disabled={saving} onClick={() => void checkPayment()}>{saving ? text('Checking...', 'Menyemak...') : text('Check Payment', 'Semak Bayaran')}</button>
      </> : null}
    </section>
  </div>;

  return (
    <>
      <PageHeader
        title={text('POS', 'Jualan')}
        actions={<><span className="text-sm font-medium text-muted">{todayLabel}</span><WorkflowHelp area="bar" /></>}
      />
      {catalogueError?<p role="alert" className="mb-3 text-sm text-danger">{catalogueError} <button className={secondaryButtonClass} onClick={()=>void refreshProducts().catch(()=>{})}>{text('Retry','Cuba Lagi')}</button></p>:null}
      <input
        id={cameraInputId}
        className="hidden"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(event) => setQrReceipt(event.target.files?.[0] ?? null)}
      />
      <div className={`bar-pos-layout ${cart.length ? 'pb-24' : ''}`}>
        <section className="bar-pos-catalog">
          <div className="bar-staff">
            <p>{text('Staff', 'Staf')}</p>
            <div role="group" aria-label={text('Order Taken By', 'Diterima Oleh')}>
              {staffUsers.map(user => <button key={user} type="button" aria-pressed={orderTakenBy === user} onClick={() => setOrderTakenBy(user)}>{user}</button>)}
            </div>
          </div>
          <div className="bar-categories" role="group" aria-label={text('Product Categories', 'Kategori Produk')}>
            {[
              { value: 'all', label: text('All', 'Semua') },
              ...(bundleEnabled && beerProducts.length ? [{ value: 'bundle', label: text('Beer Sets', 'Set Bir') }] : []),
              ...regularGroups.map(([category]) => ({ value: category, label: category === 'Beer' ? text('Single Beers', 'Bir Satu') : category === 'Cocktail' ? text('Cocktails', 'Koktel') : category === 'Soft Drink' ? text('Soft Drinks', 'Minuman') : category })),
              ...(can('bar.pos.custom')?[{ value: 'custom', label: text('Custom', 'Khas') }]:[]),
            ].map(item => <button type="button" key={item.value} aria-pressed={catalogView === item.value} onClick={() => setCatalogView(item.value)}>{item.label}</button>)}
          </div>
          {renderLiveCartPanel()}
          {bundleEnabled && beerProducts.length > 0 && ['all', 'bundle'].includes(catalogView) ? (
            <section className="bar-bundle" aria-label={text('Beer Sets', 'Set Bir')}>
              <PackagePlus size={24} />
              <div><h2>{bundleName}</h2><p className="bar-caption">{bundleUnits} {text('beers per set', 'bir setiap set')}</p><p className="bar-bundle-price">{money(bundlePrice, String(settings.currency_symbol))}</p></div>
              <button type="button" className={buttonClass} onClick={openBundleModal}><Plus size={16} />{text('Choose Beers', 'Pilih Bir')}</button>
            </section>
          ) : null}
          {regularGroups.filter(([category]) => catalogView === 'all' || catalogView === category).map(([category, items]) => (
            <div key={category} id={categoryDomId(category)}>
              <div className="bar-catalog-heading">
                <h2>{category === 'Beer' ? text('Single Beers', 'Bir Satu') : category === 'Cocktail' ? text('Cocktails', 'Koktel') : text(category, category === 'Soft Drink' ? 'Minuman Ringan' : category)}</h2>
                <span className="bar-caption">{text('Price per drink', 'Harga setiap minuman')}</span>
              </div>
              <div className="bar-product-grid">
                {items.map((product) => {
                  const stock = product.inventory_balances?.quantity_on_hand ?? 0;
                  const recipeTracked = isRecipeProduct(product.id);
                  const needsRecipe = productNeedsRecipe(product);
                  const recipeInfo = recipeTracked ? recipeAvailability(product.id, 1) : null;
                  const low = !recipeTracked && stock <= product.low_stock_threshold;
                  const singleSelected = cartSingleProductQuantity(product.id);
                  const bundleSelected = cartBundleProductQuantity(product.id);
                  const selectedQuantity = singleSelected + bundleSelected;
                  const availableAfterCart = Math.max(0, stock - selectedQuantity);
                  const addIssue = cartStockIssue(nextCartWithProduct(product));
                  const disabled = Boolean(addIssue);
                  return (
                    <button
                      key={product.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => add(product)}
                      className="bar-product"
                      data-selected={singleSelected > 0}
                      aria-label={`${product.name} · ${money(product.price_per_unit, String(settings.currency_symbol))} · ${category === 'Beer' ? text('1 beer', '1 bir') : text('1 drink', '1 minuman')}`}
                    >
                      {singleSelected > 0 ? <span className="bar-product-quantity">x {singleSelected}</span> : null}
                      <img
                        src={isDemoMode ? localDrinkFallback(product) : product.image_url ?? localDrinkFallback(product)}
                        data-fallback={localDrinkFallback(product)}
                        alt=""
                        className="bar-product-image"
                        onError={(event) => {
                          const fallback = event.currentTarget.dataset.fallback;
                          if (fallback && !event.currentTarget.src.endsWith(fallback)) {
                            event.currentTarget.src = fallback;
                          }
                        }}
                      />
                      <span className="bar-product-name">{product.name}</span>
                      <span className="bar-product-price">{money(product.price_per_unit, String(settings.currency_symbol))}</span>
                      <span className={`bar-product-stock ${low ? 'text-warning' : ''}`}>
                        {needsRecipe ? text('Recipe needed', 'Perlu resipi') : recipeTracked
                          ? `${text('Can make', 'Boleh buat')} ${recipeInfo?.maxMake ?? 0}`
                          : `${selectedQuantity ? availableAfterCart : stock} ${text('units left', 'unit berbaki')}${low ? ' · ' + text('Low', 'Rendah') : ''}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {can('bar.pos.custom')&&['all', 'custom'].includes(catalogView) ? <div id="pos-category-custom">
            <h2 className="mb-2 text-lg font-semibold sm:mb-3 sm:text-xl">{text('Custom Order', 'Pesanan Khas')}</h2>
            <div className="bar-custom-form">
              <Field label={text('Product name', 'Nama produk')}>
                <input className={inputClass} value={customName} onChange={(e) => setCustomName(e.target.value)} />
              </Field>
              <Field label={text('Custom price', 'Harga khas')}>
                <input className={inputClass} type="number" min={0} step="0.01" value={customPrice} onChange={(e) => setCustomPrice(e.target.value)} placeholder="38.00" />
              </Field>
              <button type="button" className={`${buttonClass} w-full md:w-auto`} onClick={addCustomOrder}>
                <Plus className="h-4 w-4" />
                {text('Add', 'Tambah')}
              </button>
            </div>
          </div> : null}
        </section>
        <aside className="bar-pos-cart">
          {renderCartPanel()}
        </aside>
      </div>
      {cart.length > 0 ? (
        <div className="bar-checkout-dock no-print">
          <div className="bar-checkout-total">
            <button type="button" className="min-w-0 text-left" onClick={() => setCartDrawerOpen(true)} aria-label={text('Cart Details', 'Butiran Bakul')}>
              <span className="bar-caption">{countLabel(cartQuantity, text('unit', 'unit'), text('units', 'unit'))}</span>
              <strong className="block text-sm tabular">{money(total, String(settings.currency_symbol))}</strong>
            </button>
            <button type="button" className="text-xs text-muted min-h-8" onClick={() => setCartDrawerOpen(true)}>{text('Discount / Details', 'Diskaun / Butiran')}</button>
          </div>
          <div className="bar-checkout-payments">
            <button className={buttonClass} aria-label={text('Cash Payment', 'Bayaran Tunai')} onClick={() => choosePayment('cash')}><Banknote size={16} />{text('Cash', 'Tunai')}</button>
            <button className={buttonClass} aria-label={text('QR Payment', 'Bayaran QR')} onClick={() => choosePayment('qr')}><Camera size={16} />QR</button>
            <button className={secondaryButtonClass} onClick={() => choosePayment('complimentary')}><Gift size={16} />FOC</button>
          </div>
        </div>
      ) : null}
      {cartDrawerOpen ? (
        <Modal title={text('Order Cart', 'Bakul')} onClose={() => setCartDrawerOpen(false)}>
          {renderCartPanel(true)}
        </Modal>
      ) : null}
      {bundleModalOpen ? (
        <Modal
          title={bundleName}
          onClose={() => setBundleModalOpen(false)}
          footer={
            <div className="grid w-full gap-2 sm:flex sm:justify-end">
              <button className={secondaryButtonClass} onClick={() => setBundleModalOpen(false)}>{text('Cancel', 'Batal')}</button>
              <button className={buttonClass} disabled={bundleSelectedUnits !== bundleRequiredUnits} onClick={addBundleToCart}>
                {bundleSelectedUnits === bundleRequiredUnits
                  ? text('Add Beer Set', 'Tambah Set Bir')
                  : text('Select', 'Pilih') + ' ' + countLabel(bundleMissingUnits, text('more beer unit', 'unit bir lagi'), text('more beer units', 'unit bir lagi'))}
              </button>
            </div>
          }
        >
          <div className="grid gap-4">
            <div className="grid gap-3 border-b border-line pb-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <p className="text-xs font-bold text-muted sm:text-sm">
                  {countLabel(bundleUnits, text('beer', 'bir'), text('beers', 'bir'))} {text('per set', 'setiap set')} · {money(bundlePrice, String(settings.currency_symbol))}
                </p>
              </div>
              <div className="flex items-center justify-end gap-2">
                <span className="mr-auto text-sm font-medium">{text('Sets', 'Set')}</span>
                <button aria-label="Decrease Bundle Sets" className={`${secondaryButtonClass} h-10 min-h-10 w-10 !p-0`} onClick={() => updateBundleSets(bundleSets - 1)}>
                  <Minus className="h-4 w-4" />
                </button>
                <input
                  aria-label="Bundle Sets"
                  className={`${inputClass} h-10 min-h-10 w-20 text-center`}
                  type="number"
                  min={1}
                  value={bundleSets}
                  onChange={(event) => updateBundleSets(Number(event.target.value || 1))}
                />
                <button aria-label="Increase Bundle Sets" className={`${secondaryButtonClass} h-10 min-h-10 w-10 !p-0`} onClick={() => updateBundleSets(bundleSets + 1)}>
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{text('Choose Beers', 'Pilih Bir')}</p>
                </div>
                <p className={`shrink-0 rounded-lg px-3 py-2 font-semibold ${bundleSelectedUnits === bundleRequiredUnits ? 'bg-accent/5 text-accent' : 'bg-white text-accent'}`}>
                  {bundleSelectedUnits} / {bundleRequiredUnits}
                </p>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                <div
                  className={`h-full rounded-full ${bundleSelectedUnits === bundleRequiredUnits ? 'bg-accent' : 'bg-accent'}`}
                  style={{ width: `${bundleUnitProgress}%` }}
                />
              </div>
            </div>
            <div className="grid gap-2">
              {beerProducts.map((product) => {
                const selected = bundleSelections[product.id] ?? 0;
                const stock = product.inventory_balances?.quantity_on_hand ?? 0;
                const availableAfterCart = stock - cartProductQuantity(product.id);
                return (
                  <div key={product.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-line bg-white/90 p-3">
                    <div className="min-w-0">
                      <p className="break-words font-semibold">{product.name}</p>
                      <p className="text-xs text-muted">{countLabel(Math.max(0, availableAfterCart), text('unit available', 'unit tersedia'), text('units available', 'unit tersedia'))}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button aria-label={`Remove ${product.name} from bundle`} className={`${secondaryButtonClass} h-10 min-h-10 w-10 !p-0`} onClick={() => changeBundleSelection(product, -1)}>
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="grid h-10 min-w-10 place-items-center rounded-lg bg-accent/5 px-3 font-semibold text-accent">{selected}</span>
                      <button aria-label={`Add ${product.name} to bundle`} className={`${secondaryButtonClass} h-10 min-h-10 w-10 !p-0`} onClick={() => changeBundleSelection(product, 1)}>
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Modal>
      ) : null}
      {cart.length > 0 ? <div className="h-64 sm:h-72 xl:hidden" /> : null}
      {method ? (
        <Modal
          title={`${text('Confirm', 'Sahkan')} ${method === 'qr' ? text('QR Payment', 'Bayaran QR') : method === 'cash' ? text('Cash Payment', 'Bayaran Tunai') : text('Complimentary (FOC)', 'Percuma (FOC)')}`}
          onClose={() => setMethod(null)}
          footer={
            <div className="grid w-full gap-2 sm:flex sm:justify-end">
              <button className={secondaryButtonClass} onClick={() => setMethod(null)}>{text('Cancel', 'Batal')}</button>
              <button className={buttonClass} disabled={confirmDisabled} onClick={confirmSale}>
                {saving ? text('Saving...', 'Menyimpan...') : `${text('Confirm', 'Sahkan')} ${method === 'complimentary' ? 'FOC' : method === 'cash' ? text('Cash Payment', 'Bayaran Tunai') : text('QR Payment', 'Bayaran QR')}`}
              </button>
            </div>
          }
        >
          <div className="grid gap-3">
            {hasBundleInCart ? (
              <p className="rounded-lg border-2 border-accent bg-accent/5 p-3 text-sm font-semibold text-accent">
                {text('Bundle reminder: bundle price is charged as a set. Beer mix only controls which individual beer stock is deducted.', 'Peringatan set: harga set dicaj sebagai set. Campuran bir hanya tentukan stok bir individu mana ditolak.')}
              </p>
            ) : null}
            {cart.map((item) => (
              <div key={item.product.id} className="border-b border-line py-2">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block font-bold">{cartPreviewLabel(item, text)}</span>
                    <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[0.62rem] font-semibold tracking-wide ${cartKindBadgeClass(item.kind)}`}>
                      {cartKindLabel(item, text)}
                    </span>
                  </span>
                  <strong className="shrink-0 text-right">{money(linePrice(item), String(settings.currency_symbol))}</strong>
                </div>
                {item.kind === 'bundle' ? (
                  <p className="mt-1 text-xs font-bold text-muted">
                    {text('Beer stock reduced as', 'Stok bir ditolak sebagai')}: {(item.components ?? []).map((component) => `${component.product.name} x ${component.quantity}`).join(', ')}
                  </p>
                ) : null}
              </div>
            ))}
            <div className="rounded-lg bg-shell p-3">
              <div className="flex justify-between text-sm font-bold">
                <span>{text('Subtotal', 'Subtotal')}</span>
                <span>{money(subtotal, String(settings.currency_symbol))}</span>
              </div>
              <div className="mt-2 flex justify-between text-sm font-bold text-accent">
                <span>{text('Discount amount', 'Jumlah diskaun')}</span>
                <span>- {money(discount, String(settings.currency_symbol))}</span>
              </div>
            </div>
            <div className="flex justify-between text-lg font-semibold sm:text-xl">
              <span>{text('Total', 'Jumlah')}</span>
              <span>{money(total, String(settings.currency_symbol))}</span>
            </div>
            {method === 'complimentary' ? (
              <p className="rounded-lg bg-shell p-3 text-sm font-semibold text-accent">{text('Paid amount', 'Jumlah dibayar')}: {money(0, String(settings.currency_symbol))}. {text('FOC is recorded as cost, not sales.', 'FOC direkod sebagai kos, bukan jualan.')}</p>
            ) : null}
            <p className="rounded-lg bg-shell p-3 text-sm font-bold">{text('Order accepted by', 'Diterima oleh')}: {orderTakenBy}</p>
            <Field label={text('Table number (optional)', 'Nombor meja (pilihan)')}>
              <input className={inputClass} value={tableNumber} onChange={(event) => setTableNumber(event.target.value)} placeholder={text('Example: Table 8', 'Contoh: Meja 8')} />
            </Field>
            {method === 'qr' ? (
              <>
                <div>
                  <p className="mb-2 text-sm font-semibold">{text('QR Payment type', 'Jenis Bayaran QR')}</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {qrPaymentTypes.map((type) => (
                      <button
                        key={type}
                        type="button"
                        className={`min-h-11 rounded-lg border px-2 py-2 text-center text-sm font-semibold leading-tight shadow-none transition sm:min-h-12 sm:rounded-lg ${
                          qrPaymentType === type
                            ? 'border-accent bg-accent text-white'
                            : 'border-line bg-white/90 text-ink hover:border-accent'
                        }`}
                        onClick={() => setQrPaymentType(type)}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>
                <Field label={text('QR Payment reference or transaction ID', 'Rujukan Bayaran QR atau ID transaksi')}>
                  <input className={inputClass} value={qrReference} onChange={(e) => setQrReference(e.target.value)} />
                </Field>
                <div className="rounded-lg border border-line bg-shell p-3">
                  <p className="font-semibold">{text('QR Payment receipt photo', 'Gambar resit Bayaran QR')}</p>
                  <p className="mt-1 text-sm text-muted">{qrReceipt ? qrReceipt.name : text('Camera should open automatically. Take a receipt photo before confirming.', 'Kamera akan dibuka secara automatik. Ambil gambar resit sebelum sahkan.')}</p>
                  <button className={`${secondaryButtonClass} mt-3`} onClick={() => document.getElementById(cameraInputId)?.click()}>
                    <Camera className="h-4 w-4" />
                    {text('Snap again', 'Ambil semula')}
                  </button>
                </div>
              </>
            ) : null}
            {method === 'complimentary' ? (
              <>
                <Field label={text('Complimentary (FOC) reason', 'Sebab FOC')}>
                  <textarea className={inputClass} value={complimentaryReason} onChange={(e) => setComplimentaryReason(e.target.value)} />
                </Field>
                {requireFocApproval ? (
                  <div className={`rounded-lg border p-3 ${focApproved ? 'border-teal-200 bg-accent/5' : 'border-amber-200 bg-amber-50'}`}>
                    <p className={`text-sm font-semibold ${focApproved ? 'text-accent' : 'text-warning'}`}>
                      {focApproved ? text('Manager approval accepted', 'Kelulusan pengurus diterima') : text('Manager approval required', 'Kelulusan pengurus diperlukan')}
                    </p>
                    {!focApproved ? (
                      <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                        <input
                          className={inputClass}
                          type="password"
                          value={focApprovalPin}
                          onChange={(event) => setFocApprovalPin(event.target.value)}
                          placeholder={text('Approval password', 'Kata laluan kelulusan')}
                        />
                        <button type="button" className={buttonClass} disabled={!focApprovalPin || focApprovalBusy} onClick={() => void approveFoc()}>
                          {focApprovalBusy ? text('Checking...', 'Menyemak...') : text('Approve FOC', 'Luluskan FOC')}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
