import { FormEvent, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { PackagePlus, Pencil, Plus, Save } from 'lucide-react';
import { Field, buttonClass, inputClass, secondaryButtonClass } from './Form';
import { useToast } from './Toast';
import { categoryRank, normalizeCategoryName } from '../lib/data';
import { money } from '../lib/format';
import {
  adjustLocalIngredientStock,
  loadLocalIngredientItems,
  loadLocalIngredientMovements,
  loadLocalRecipeIngredients,
  saveLocalIngredientItem,
  saveLocalProductRecipe,
  stockInLocalIngredient,
} from '../lib/localStore';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type { IngredientCategory, IngredientMovement, IngredientWithBalance, ProductWithStock, RecipeIngredient, SettingsMap } from '../lib/types';
import { useLanguage } from '../lib/language';
import { useSharedRefresh } from '../lib/useSharedRefresh';

type IngredientBaseUnit = 'ml' | 'g' | 'unit';
type MovementView = 'all' | 'stock_in' | 'cocktail' | 'kitchen' | 'other';
type AdjustmentMode = 'count' | 'waste' | 'adjustment';
type IngredientForm = {
  id?: string;
  name: string;
  category: IngredientCategory;
  base_unit: IngredientBaseUnit;
  default_pack_size: string;
  pack_label: string;
  cost_per_base_unit: string;
  low_stock_threshold: string;
  active: boolean;
};

type RecipeLineForm = {
  ingredient_id: string;
  quantity_per_unit: string;
};

type ReceiveForm = {
  ingredient_id: string;
  input_quantity: string;
  unit_type: 'base' | 'pack';
  pack_size: string;
  entered_by: string;
  notes: string;
};

type AdjustmentForm = {
  ingredient_id: string;
  movement_type: AdjustmentMode;
  quantity: string;
  entered_by: string;
  reason: string;
  notes: string;
};

const ingredientCategories: IngredientCategory[] = ['Liquor', 'Mixer', 'Seafood', 'Condiment', 'Food', 'Other'];
const baseUnits: IngredientBaseUnit[] = ['ml', 'g', 'unit'];

function staffNames(settings: SettingsMap) {
  return String(settings.staff_names || 'Chloe, Happy, Elle, NekoMiao')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

function blankIngredient(): IngredientForm {
  return {
    name: '',
    category: 'Liquor',
    base_unit: 'ml',
    default_pack_size: '1000',
    pack_label: 'Bottle',
    cost_per_base_unit: '',
    low_stock_threshold: '0',
    active: true,
  };
}

function ingredientBalance(item: IngredientWithBalance) {
  const balance = item.ingredient_balances;
  if (Array.isArray(balance)) return Number(balance[0]?.quantity_on_hand ?? 0);
  return Number(balance?.quantity_on_hand ?? 0);
}

function ingredientError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes('relation') || lower.includes('function') || lower.includes('column')) {
    return 'Cloud database needs the cocktail/ingredient SQL update. Run the latest supabase/live_cloud_fix.sql in Supabase.';
  }
  if (lower.includes('permission') || lower.includes('policy') || lower.includes('row-level')) {
    return 'Admin permission is not active. Unlock Admin again, then retry.';
  }
  return message;
}

function lineIngredient(lines: RecipeLineForm[], index: number, ingredients: IngredientWithBalance[]) {
  return ingredients.find((item) => item.id === lines[index]?.ingredient_id);
}


function movementView(type: IngredientMovement['movement_type']): MovementView {
  if (type === 'stock_in') return 'stock_in';
  if (type === 'sale' || type === 'complimentary' || type === 'void_sale') return 'cocktail';
  if (type === 'kitchen_production') return 'kitchen';
  return 'other';
}

function movementLabel(type: IngredientMovement['movement_type'], text: (english: string, malay: string) => string) {
  if (type === 'stock_in') return text('Stock In', 'Stok Masuk');
  if (type === 'sale') return text('Cocktail Sale', 'Jualan Koktel');
  if (type === 'complimentary') return text('FOC Cocktail', 'Koktel FOC');
  if (type === 'void_sale') return text('Void Return', 'Pulangan Batal');
  if (type === 'kitchen_production') return text('Kitchen Use', 'Gunaan Dapur');
  if (type === 'waste') return text('Waste', 'Rosak');
  if (type === 'count') return text('Stock Count', 'Kiraan Stok');
  if (type === 'adjustment') return text('Adjustment', 'Pelarasan');
  return String(type).replace(/_/g, ' ');
}

function movementTone(type: IngredientMovement['movement_type']) {
  if (type === 'stock_in' || type === 'void_sale') return 'bg-teal-50 text-accent';
  if (type === 'sale' || type === 'complimentary' || type === 'kitchen_production') return 'bg-pink-50 text-coral';
  if (type === 'waste') return 'bg-amber-50 text-warning';
  return 'bg-shell text-neutral-700';
}

function movementDateTime(value: string) {
  try {
    return format(new Date(value), 'dd MMM, h:mm a');
  } catch {
    return value;
  }
}

function movementQuantity(value: number, unit: IngredientBaseUnit | string | undefined) {
  const cleanUnit = unit || 'unit';
  const digits = cleanUnit === 'unit' ? 0 : 2;
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${Math.abs(Number(value || 0)).toFixed(digits)} ${cleanUnit}`;
}


function adjustmentModeLabel(mode: AdjustmentMode, text: (english: string, malay: string) => string) {
  if (mode === 'count') return text('Set actual count', 'Tetap kiraan sebenar');
  if (mode === 'waste') return text('Waste / missing (-)', 'Rosak / hilang (-)');
  return text('Correction (+/-)', 'Pembetulan (+/-)');
}

function adjustmentChange(mode: AdjustmentMode, quantity: number, currentBalance: number) {
  if (!Number.isFinite(quantity)) return 0;
  if (mode === 'count') return quantity - currentBalance;
  if (mode === 'waste') return -Math.abs(quantity);
  return quantity;
}

export function CocktailRecipePanel({
  products,
  settings,
  onAddCocktailProduct,
}: {
  products: ProductWithStock[];
  settings: SettingsMap;
  onAddCocktailProduct: () => void;
}) {
  const { text } = useLanguage();
  const toast = useToast();
  const staff = useMemo(() => staffNames(settings), [settings]);
  const [ingredients, setIngredients] = useState<IngredientWithBalance[]>([]);
  const [movements, setMovements] = useState<IngredientMovement[]>([]);
  const [recipes, setRecipes] = useState<RecipeIngredient[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [recipeLines, setRecipeLines] = useState<RecipeLineForm[]>([{ ingredient_id: '', quantity_per_unit: '' }]);
  const [ingredientForm, setIngredientForm] = useState<IngredientForm>(() => blankIngredient());
  const [receiveForm, setReceiveForm] = useState<ReceiveForm>({
    ingredient_id: '',
    input_quantity: '1',
    unit_type: 'pack',
    pack_size: '1000',
    entered_by: staff[0] ?? 'Chloe',
    notes: '',
  });
  const [adjustmentForm, setAdjustmentForm] = useState<AdjustmentForm>({
    ingredient_id: '',
    movement_type: 'count',
    quantity: '',
    entered_by: staff[0] ?? 'Chloe',
    reason: '',
    notes: '',
  });
  const [savingRecipe, setSavingRecipe] = useState(false);
  const [savingIngredient, setSavingIngredient] = useState(false);
  const [receivingStock, setReceivingStock] = useState(false);
  const [adjustingStock, setAdjustingStock] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [movementFilter, setMovementFilter] = useState<MovementView>('all');

  const cocktailProducts = useMemo(
    () =>
      products
        .filter((product) => normalizeCategoryName(product.categories?.name) === 'Cocktail')
        .sort((a, b) => categoryRank(a.categories?.name) - categoryRank(b.categories?.name) || a.name.localeCompare(b.name)),
    [products],
  );

  const activeIngredients = useMemo(() => ingredients.filter((item) => item.active), [ingredients]);
  const ingredientById = useMemo(() => new Map(ingredients.map((item) => [item.id, item])), [ingredients]);
  const selectedProduct = cocktailProducts.find((product) => product.id === selectedProductId) ?? null;
  const selectedRecipe = recipes.filter((item) => item.product_id === selectedProductId);
  const selectedIngredientForReceive = ingredients.find((item) => item.id === receiveForm.ingredient_id) ?? null;
  const receivePackSize = Number(receiveForm.pack_size || selectedIngredientForReceive?.default_pack_size || 1);
  const receiveInputQuantity = Number(receiveForm.input_quantity || 0);
  const receiveBaseQuantity =
    receiveForm.unit_type === 'pack' ? receiveInputQuantity * (Number.isFinite(receivePackSize) ? receivePackSize : 0) : receiveInputQuantity;
  const selectedIngredientForAdjustment = ingredients.find((item) => item.id === adjustmentForm.ingredient_id) ?? null;
  const adjustmentInputQuantity = Number(adjustmentForm.quantity || 0);
  const adjustmentCurrentBalance = selectedIngredientForAdjustment ? ingredientBalance(selectedIngredientForAdjustment) : 0;
  const adjustmentQuantityChange = adjustmentChange(adjustmentForm.movement_type, adjustmentInputQuantity, adjustmentCurrentBalance);
  const adjustmentBalanceAfter = adjustmentCurrentBalance + adjustmentQuantityChange;
  const movementCounts = useMemo(() => {
    const counts: Record<MovementView, number> = { all: movements.length, stock_in: 0, cocktail: 0, kitchen: 0, other: 0 };
    movements.forEach((movement) => {
      counts[movementView(movement.movement_type)] += 1;
    });
    return counts;
  }, [movements]);
  const visibleMovements = useMemo(
    () =>
      movements
        .filter((movement) => movementFilter === 'all' || movementView(movement.movement_type) === movementFilter)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 120),
    [movementFilter, movements],
  );

  async function refresh() {
    setLoadError('');
    if (!isSupabaseConfigured) {
      const localIngredients = loadLocalIngredientItems(true);
      setIngredients(localIngredients);
      setMovements(loadLocalIngredientMovements());
      setRecipes(loadLocalRecipeIngredients());
      if (!receiveForm.ingredient_id && localIngredients[0]) {
        setReceiveForm((current) => ({
          ...current,
          ingredient_id: localIngredients[0].id,
          pack_size: String(localIngredients[0].default_pack_size || 1),
        }));
      }
      if (!adjustmentForm.ingredient_id && localIngredients[0]) {
        setAdjustmentForm((current) => ({ ...current, ingredient_id: localIngredients[0].id }));
      }
      return;
    }

    const [ingredientResult, recipeResult, movementResult] = await Promise.all([
      supabase.from('ingredient_items').select('*, ingredient_balances(quantity_on_hand)').order('name'),
      supabase.from('recipe_ingredients').select('*, ingredient_items(id,name,category,base_unit)').order('created_at'),
      supabase.from('ingredient_movements').select('*, ingredient_items(name,base_unit)').order('created_at', { ascending: false }).limit(200),
    ]);
    if (ingredientResult.error || recipeResult.error || movementResult.error) {
      setLoadError(ingredientError((ingredientResult.error ?? recipeResult.error ?? movementResult.error)?.message ?? 'Could not load cocktail inventory.'));
      setIngredients([]);
      setMovements([]);
      setRecipes([]);
      return;
    }
    const nextIngredients = (ingredientResult.data ?? []) as IngredientWithBalance[];
    setIngredients(nextIngredients);
    setMovements((movementResult.data ?? []) as IngredientMovement[]);
    setRecipes((recipeResult.data ?? []) as RecipeIngredient[]);
    if (!receiveForm.ingredient_id && nextIngredients[0]) {
      setReceiveForm((current) => ({
        ...current,
        ingredient_id: nextIngredients[0].id,
        pack_size: String(nextIngredients[0].default_pack_size || 1),
      }));
    }
    if (!adjustmentForm.ingredient_id && nextIngredients[0]) {
      setAdjustmentForm((current) => ({ ...current, ingredient_id: nextIngredients[0].id }));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useSharedRefresh(refresh, {
    tables: ['ingredient_items', 'ingredient_balances', 'recipe_ingredients', 'ingredient_movements'],
    intervalMs: 15000,
  });

  useEffect(() => {
    if (staff.length > 0 && !staff.includes(receiveForm.entered_by)) {
      setReceiveForm((current) => ({ ...current, entered_by: staff[0] }));
    }
    if (staff.length > 0 && !staff.includes(adjustmentForm.entered_by)) {
      setAdjustmentForm((current) => ({ ...current, entered_by: staff[0] }));
    }
  }, [adjustmentForm.entered_by, receiveForm.entered_by, staff]);

  useEffect(() => {
    if (!selectedProductId && cocktailProducts[0]) {
      setSelectedProductId(cocktailProducts[0].id);
    }
  }, [cocktailProducts, selectedProductId]);

  useEffect(() => {
    if (!selectedProductId) return;
    const currentRecipe = recipes.filter((item) => item.product_id === selectedProductId);
    setRecipeLines(
      currentRecipe.length > 0
        ? currentRecipe.map((item) => ({ ingredient_id: item.ingredient_id, quantity_per_unit: String(item.quantity_per_unit) }))
        : [{ ingredient_id: activeIngredients[0]?.id ?? '', quantity_per_unit: '' }],
    );
  }, [activeIngredients, recipes, selectedProductId]);

  function editIngredient(item: IngredientWithBalance) {
    setIngredientForm({
      id: item.id,
      name: item.name,
      category: item.category,
      base_unit: item.base_unit,
      default_pack_size: String(item.default_pack_size || 1),
      pack_label: item.pack_label || 'Pack',
      cost_per_base_unit: item.cost_per_base_unit == null ? '' : String(item.cost_per_base_unit),
      low_stock_threshold: String(item.low_stock_threshold || 0),
      active: item.active,
    });
    setReceiveForm((current) => ({
      ...current,
      ingredient_id: item.id,
      pack_size: String(item.default_pack_size || 1),
    }));
    setAdjustmentForm((current) => ({ ...current, ingredient_id: item.id }));
  }

  async function saveIngredient(event: FormEvent) {
    event.preventDefault();
    const name = ingredientForm.name.trim();
    const defaultPackSize = Number(ingredientForm.default_pack_size);
    const lowStock = Number(ingredientForm.low_stock_threshold || 0);
    const cost = ingredientForm.cost_per_base_unit.trim() ? Number(ingredientForm.cost_per_base_unit) : null;
    if (!name) {
      toast.error(text('Enter an ingredient name.', 'Masukkan nama bahan.'));
      return;
    }
    if (!Number.isFinite(defaultPackSize) || defaultPackSize <= 0) {
      toast.error(text('Enter a valid bottle/pack size.', 'Masukkan saiz botol/pek yang betul.'));
      return;
    }
    if (!Number.isFinite(lowStock) || lowStock < 0 || (cost != null && (!Number.isFinite(cost) || cost < 0))) {
      toast.error(text('Check ingredient numbers.', 'Semak nombor bahan.'));
      return;
    }

    setSavingIngredient(true);
    const payload = {
      name,
      category: ingredientForm.category,
      base_unit: ingredientForm.base_unit,
      default_pack_size: defaultPackSize,
      pack_label: ingredientForm.pack_label.trim() || 'Pack',
      cost_per_base_unit: cost,
      low_stock_threshold: lowStock,
      active: ingredientForm.active,
    };

    try {
      if (!isSupabaseConfigured) {
        const saved = saveLocalIngredientItem({ id: ingredientForm.id, ...payload });
        setIngredientForm(blankIngredient());
        setReceiveForm((current) => ({ ...current, ingredient_id: saved.id, pack_size: String(saved.default_pack_size || 1) }));
        await refresh();
        toast.success(text('Ingredient saved.', 'Bahan disimpan.'));
        return;
      }
      if (ingredientForm.id) {
        const { error } = await supabase.from('ingredient_items').update(payload).eq('id', ingredientForm.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('ingredient_items').insert(payload).select('id,default_pack_size').single();
        if (error) throw error;
        if (data?.id) {
          await supabase.from('ingredient_balances').insert({ ingredient_id: data.id, quantity_on_hand: 0 });
          setReceiveForm((current) => ({ ...current, ingredient_id: data.id, pack_size: String(data.default_pack_size || 1) }));
        }
      }
      setIngredientForm(blankIngredient());
      await refresh();
      toast.success(text('Ingredient saved.', 'Bahan disimpan.'));
    } catch (error) {
      toast.error(ingredientError(error instanceof Error ? error.message : 'Could not save ingredient.'));
    } finally {
      setSavingIngredient(false);
    }
  }

  async function saveRecipe(event: FormEvent) {
    event.preventDefault();
    if (!selectedProductId) {
      toast.error(text('Choose a cocktail product first.', 'Pilih produk koktel dahulu.'));
      return;
    }
    const lines = recipeLines
      .map((line) => ({ ingredient_id: line.ingredient_id, quantity_per_unit: Number(line.quantity_per_unit) }))
      .filter((line) => line.ingredient_id && Number.isFinite(line.quantity_per_unit) && line.quantity_per_unit > 0);
    if (lines.length === 0) {
      toast.error(text('Add at least one ingredient amount.', 'Tambah sekurang-kurangnya satu kuantiti bahan.'));
      return;
    }
    setSavingRecipe(true);
    try {
      if (!isSupabaseConfigured) {
        saveLocalProductRecipe(selectedProductId, lines);
        await refresh();
        toast.success(text('Cocktail recipe saved.', 'Resipi koktel disimpan.'));
        return;
      }
      const { error } = await supabase.rpc('save_product_recipe', {
        p_product_id: selectedProductId,
        p_items: lines,
      });
      if (error) throw error;
      await refresh();
      toast.success(text('Cocktail recipe saved.', 'Resipi koktel disimpan.'));
    } catch (error) {
      toast.error(ingredientError(error instanceof Error ? error.message : 'Could not save recipe.'));
    } finally {
      setSavingRecipe(false);
    }
  }

  async function receiveStock(event: FormEvent) {
    event.preventDefault();
    if (!receiveForm.ingredient_id || !selectedIngredientForReceive) {
      toast.error(text('Choose an ingredient.', 'Pilih bahan.'));
      return;
    }
    if (!Number.isFinite(receiveInputQuantity) || receiveInputQuantity <= 0 || !Number.isFinite(receiveBaseQuantity) || receiveBaseQuantity <= 0) {
      toast.error(text('Enter a valid received quantity.', 'Masukkan kuantiti terima yang betul.'));
      return;
    }
    setReceivingStock(true);
    try {
      if (!isSupabaseConfigured) {
        stockInLocalIngredient({
          ingredientId: receiveForm.ingredient_id,
          inputQuantity: receiveInputQuantity,
          unitType: receiveForm.unit_type,
          packSize: receivePackSize,
          notes: receiveForm.notes || null,
          enteredBy: receiveForm.entered_by,
        });
        await refresh();
        toast.success(text('Ingredient stock received.', 'Stok bahan diterima.'));
        return;
      }
      const { error } = await supabase.rpc('stock_in_ingredient', {
        p_ingredient_id: receiveForm.ingredient_id,
        p_input_quantity: receiveInputQuantity,
        p_unit_type: receiveForm.unit_type,
        p_pack_size: receiveForm.unit_type === 'pack' ? receivePackSize : null,
        p_supplier: null,
        p_reference: null,
        p_notes: receiveForm.notes || null,
        p_entered_by: receiveForm.entered_by || null,
      });
      if (error) throw error;
      await refresh();
      toast.success(text('Ingredient stock received.', 'Stok bahan diterima.'));
    } catch (error) {
      toast.error(ingredientError(error instanceof Error ? error.message : 'Could not receive ingredient stock.'));
    } finally {
      setReceivingStock(false);
    }
  }

  async function saveAdjustment(event: FormEvent) {
    event.preventDefault();
    if (!adjustmentForm.ingredient_id || !selectedIngredientForAdjustment) {
      toast.error(text('Choose an ingredient.', 'Pilih bahan.'));
      return;
    }
    if (!Number.isFinite(adjustmentInputQuantity)) {
      toast.error(text('Enter a valid quantity.', 'Masukkan kuantiti yang betul.'));
      return;
    }
    if (adjustmentForm.movement_type === 'count' && adjustmentInputQuantity < 0) {
      toast.error(text('Actual count must be 0 or more.', 'Kiraan sebenar mesti 0 atau lebih.'));
      return;
    }
    if (adjustmentForm.movement_type === 'waste' && adjustmentInputQuantity <= 0) {
      toast.error(text('Waste or missing quantity must be more than 0.', 'Kuantiti rosak atau hilang mesti lebih daripada 0.'));
      return;
    }
    if (adjustmentForm.movement_type === 'adjustment' && adjustmentInputQuantity === 0) {
      toast.error(text('Correction quantity cannot be 0.', 'Kuantiti pembetulan tidak boleh 0.'));
      return;
    }
    if (adjustmentBalanceAfter < 0) {
      toast.error(text('Balance after cannot be below 0.', 'Baki selepas tidak boleh kurang daripada 0.'));
      return;
    }
    if (!adjustmentForm.reason.trim()) {
      toast.error(text('Reason is required for stock correction.', 'Sebab diperlukan untuk pembetulan stok.'));
      return;
    }
    setAdjustingStock(true);
    try {
      if (!isSupabaseConfigured) {
        adjustLocalIngredientStock({
          ingredientId: adjustmentForm.ingredient_id,
          movementType: adjustmentForm.movement_type,
          quantity: adjustmentInputQuantity,
          reason: adjustmentForm.reason.trim(),
          notes: adjustmentForm.notes.trim() || null,
          enteredBy: adjustmentForm.entered_by,
        });
      } else {
        const { error } = await supabase.rpc('adjust_ingredient_stock', {
          p_ingredient_id: adjustmentForm.ingredient_id,
          p_movement_type: adjustmentForm.movement_type,
          p_quantity: adjustmentInputQuantity,
          p_reason: adjustmentForm.reason.trim(),
          p_notes: adjustmentForm.notes.trim() || null,
          p_entered_by: adjustmentForm.entered_by || null,
        });
        if (error) throw error;
      }
      setAdjustmentForm((current) => ({ ...current, quantity: '', reason: '', notes: '' }));
      await refresh();
      toast.success(text('Ingredient stock correction saved.', 'Pembetulan stok bahan disimpan.'));
    } catch (error) {
      toast.error(ingredientError(error instanceof Error ? error.message : 'Could not save stock correction.'));
    } finally {
      setAdjustingStock(false);
    }
  }

  function setLine(index: number, patch: Partial<RecipeLineForm>) {
    setRecipeLines((lines) => lines.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)));
  }

  return (
    <section className="grid gap-4">
      {loadError ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-black text-warning">{loadError}</div>
      ) : null}

      <div className="island-panel rounded-2xl p-3 sm:rounded-xl sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-black sm:text-xl">{text('Cocktail Recipes', 'Resipi Koktel')}</h2>
          <button type="button" className={secondaryButtonClass} onClick={onAddCocktailProduct}>
            <Plus className="h-4 w-4" />
            {text('Add cocktail product', 'Tambah produk koktel')}
          </button>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {cocktailProducts.map((product) => (
            <button
              key={product.id}
              type="button"
              onClick={() => setSelectedProductId(product.id)}
              className={`min-h-12 rounded-xl border px-3 py-2 text-left text-sm font-black shadow-soft transition sm:rounded-2xl ${selectedProductId === product.id ? 'border-accent bg-accent text-white' : 'border-line bg-white/90 text-ink'}`}
            >
              <span className="block truncate">{product.name}</span>
              <span className="block text-xs opacity-80">{money(product.price_per_unit, String(settings.currency_symbol))}</span>
            </button>
          ))}
          {cocktailProducts.length === 0 ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-warning">
              {text('No cocktail product yet. Add one first, then define its recipe.', 'Belum ada produk koktel. Tambah dahulu, kemudian tetapkan resipinya.')}
            </div>
          ) : null}
        </div>

        <form onSubmit={saveRecipe} className="mt-4 grid gap-3">
          <div className="grid gap-2 sm:hidden">
            {recipeLines.map((line, index) => {
              const ingredient = lineIngredient(recipeLines, index, ingredients);
              return (
                <article key={`mobile-recipe-${index}`} className="rounded-2xl border border-line bg-white/85 p-3 shadow-soft">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black">{selectedProduct?.name ?? '-'}</p>
                      <p className="mt-0.5 text-xs font-bold text-neutral-600">{text('Recipe line', 'Baris resipi')} {index + 1}</p>
                    </div>
                    <button type="button" className={`${secondaryButtonClass} dense-action justify-center`} onClick={() => setRecipeLines((lines) => lines.filter((_, lineIndex) => lineIndex !== index))}>
                      {text('Remove', 'Buang')}
                    </button>
                  </div>
                  <div className="mt-2 grid gap-2">
                    <label className="grid gap-1 text-xs font-black">
                      {text('Ingredient', 'Bahan')}
                      <select className={inputClass + ' min-h-10'} value={line.ingredient_id} onChange={(event) => setLine(index, { ingredient_id: event.target.value })}>
                        <option value="">{text('Choose ingredient', 'Pilih bahan')}</option>
                        {activeIngredients.map((item) => (
                          <option key={item.id} value={item.id}>{item.name}</option>
                        ))}
                      </select>
                    </label>
                    <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-2">
                      <label className="grid gap-1 text-xs font-black">
                        {text('Amount per sale', 'Jumlah setiap jualan')}
                        <input className={inputClass + ' min-h-10'} type="number" min={0} step="0.01" value={line.quantity_per_unit} onChange={(event) => setLine(index, { quantity_per_unit: event.target.value })} />
                      </label>
                      <div className="rounded-xl bg-shell p-2 text-xs font-bold">
                        <p className="text-[10px] text-neutral-500">{text('Base unit', 'Unit asas')}</p>
                        <p className="mt-2 font-black">{ingredient?.base_unit ?? '-'}</p>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="clean-scroll hidden overflow-x-auto rounded-2xl border border-line bg-white/80 sm:block">
            <table className="dense-table w-full min-w-[720px] text-left text-xs sm:text-sm">
              <thead className="bg-paper">
                <tr>
                  <th className="p-3">{text('Cocktail', 'Koktel')}</th>
                  <th className="p-3">{text('Ingredient', 'Bahan')}</th>
                  <th className="p-3">{text('Amount per sale', 'Jumlah setiap jualan')}</th>
                  <th className="p-3">{text('Base unit', 'Unit asas')}</th>
                  <th className="p-3">{text('Action', 'Tindakan')}</th>
                </tr>
              </thead>
              <tbody>
                {recipeLines.map((line, index) => {
                  const ingredient = lineIngredient(recipeLines, index, ingredients);
                  return (
                    <tr key={index} className="border-t border-line">
                      <td className="p-3 font-black">{selectedProduct?.name ?? '-'}</td>
                      <td className="p-3">
                        <select className={inputClass + ' min-h-10'} value={line.ingredient_id} onChange={(event) => setLine(index, { ingredient_id: event.target.value })}>
                          <option value="">{text('Choose ingredient', 'Pilih bahan')}</option>
                          {activeIngredients.map((item) => (
                            <option key={item.id} value={item.id}>{item.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="p-3">
                        <input className={inputClass + ' min-h-10'} type="number" min={0} step="0.01" value={line.quantity_per_unit} onChange={(event) => setLine(index, { quantity_per_unit: event.target.value })} />
                      </td>
                      <td className="p-3 font-black">{ingredient?.base_unit ?? '-'}</td>
                      <td className="p-3">
                        <button type="button" className={secondaryButtonClass} onClick={() => setRecipeLines((lines) => lines.filter((_, lineIndex) => lineIndex !== index))}>
                          {text('Remove', 'Buang')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" className={secondaryButtonClass} onClick={() => setRecipeLines((lines) => [...lines, { ingredient_id: activeIngredients[0]?.id ?? '', quantity_per_unit: '' }])}>
              <Plus className="h-4 w-4" />
              {text('Add ingredient line', 'Tambah baris bahan')}
            </button>
            <button className={buttonClass} disabled={savingRecipe || !selectedProductId}>
              <Save className="h-4 w-4" />
              {savingRecipe ? text('Saving...', 'Menyimpan...') : text('Save recipe', 'Simpan resipi')}
            </button>
          </div>
          {selectedRecipe.length > 0 ? (
            <div className="rounded-2xl border border-teal-200 bg-teal-50 p-3 text-sm font-black text-accent">
              {text('Current recipe', 'Resipi semasa')}: {selectedRecipe.map((item) => `${item.ingredient_items?.name ?? item.ingredient_id} ${item.quantity_per_unit}${item.unit}`).join(', ')}
            </div>
          ) : null}
        </form>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="grid min-w-0 gap-4">
          <div className="island-panel rounded-2xl p-3 sm:rounded-xl sm:p-5">
            <h2 className="text-lg font-black sm:text-xl">{text('Ingredient Inventory', 'Inventori Bahan')}</h2>
            <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-white/80 sm:hidden">
              <table className="dense-table w-full table-fixed text-left text-[11px]">
                <thead className="bg-paper">
                  <tr>
                    <th className="w-[38%] p-2">{text('Ingredient', 'Bahan')}</th>
                    <th className="w-[24%] p-2">{text('Balance', 'Baki')}</th>
                    <th className="w-[24%] p-2">{text('Low alert', 'Amaran rendah')}</th>
                    <th className="w-[14%] p-2 text-right">{text('Edit', 'Edit')}</th>
                  </tr>
                </thead>
                <tbody>
                  {ingredients.map((item) => {
                    const balance = ingredientBalance(item);
                    const low = balance <= item.low_stock_threshold;
                    return (
                      <tr key={item.id} className="border-t border-line">
                        <td className="p-2 align-top">
                          <p className="truncate font-black">{item.name}</p>
                          <p className="mt-0.5 truncate text-[10px] font-bold text-neutral-500">{item.category}</p>
                          <p className="mt-0.5 truncate text-[10px] font-bold text-neutral-500">{item.default_pack_size} {item.base_unit} / {item.pack_label}</p>
                        </td>
                        <td className={`p-2 align-top font-black tabular-nums ${low ? 'text-warning' : 'text-ink'}`}>
                          {balance.toFixed(item.base_unit === 'unit' ? 0 : 2)}
                          <span className="block text-[10px] font-bold text-neutral-600">{item.base_unit}</span>
                        </td>
                        <td className="p-2 align-top font-black tabular-nums">
                          {item.low_stock_threshold}
                          <span className="block text-[10px] font-bold text-neutral-600">{item.base_unit}</span>
                          {low ? <span className="mt-1 inline-flex rounded-lg bg-amber-100 px-1.5 py-0.5 text-[9px] font-black text-warning">{text('Low', 'Rendah')}</span> : null}
                        </td>
                        <td className="p-2 text-right align-top">
                          <button type="button" className="inline-grid h-8 w-8 place-items-center rounded-lg border border-line bg-white text-ink" onClick={() => editIngredient(item)} aria-label={text('Edit ingredient', 'Edit bahan')} title={text('Edit ingredient', 'Edit bahan')}>
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {ingredients.length === 0 ? (
                <div className="p-4 text-center text-sm font-bold text-neutral-600">{text('No ingredients yet.', 'Belum ada bahan.')}</div>
              ) : null}
            </div>
            <div className="clean-scroll mt-3 hidden overflow-x-auto rounded-2xl border border-line bg-white/80 sm:block">
              <table className="dense-table w-full min-w-[760px] text-left text-xs sm:text-sm">
                <thead className="bg-paper">
                  <tr>
                    <th className="p-3">{text('Ingredient', 'Bahan')}</th>
                    <th className="p-3">{text('Type', 'Jenis')}</th>
                    <th className="p-3">{text('Balance', 'Baki')}</th>
                    <th className="p-3">{text('Low alert at base unit', 'Amaran rendah pada unit asas')}</th>
                    <th className="p-3">{text('Bottle/pack size', 'Saiz botol/pek')}</th>
                    <th className="p-3">{text('Action', 'Tindakan')}</th>
                  </tr>
                </thead>
                <tbody>
                  {ingredients.map((item) => {
                    const balance = ingredientBalance(item);
                    const low = balance <= item.low_stock_threshold;
                    return (
                      <tr key={item.id} className="border-t border-line">
                        <td className="p-3 font-black">{item.name}</td>
                        <td className="p-3">{item.category}</td>
                        <td className={`p-3 font-black ${low ? 'text-warning' : 'text-ink'}`}>{balance.toFixed(item.base_unit === 'unit' ? 0 : 2)} {item.base_unit}</td>
                        <td className="p-3">{item.low_stock_threshold} {item.base_unit}</td>
                        <td className="p-3">{item.default_pack_size} {item.base_unit} / {item.pack_label}</td>
                        <td className="p-3"><button type="button" className={secondaryButtonClass} onClick={() => editIngredient(item)}>{text('Edit', 'Edit')}</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {ingredients.length === 0 ? (
                <div className="p-5 text-center text-sm font-bold text-neutral-600">{text('No ingredients yet.', 'Belum ada bahan.')}</div>
              ) : null}
            </div>
          </div>

          <div className="island-panel rounded-2xl p-3 sm:rounded-xl sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-lg font-black sm:text-xl">{text('Ingredient Activity Ledger', 'Lejar Aktiviti Bahan')}</h2>
              <span className="rounded-xl bg-shell px-3 py-2 text-xs font-black text-neutral-600">{visibleMovements.length} / {movements.length}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-1 rounded-2xl bg-white/80 p-1 text-xs font-black sm:grid-cols-5 sm:text-sm">
              {([
                ['all', text('All', 'Semua')],
                ['stock_in', text('Stock In', 'Stok Masuk')],
                ['cocktail', text('Cocktail', 'Koktel')],
                ['kitchen', text('Kitchen', 'Dapur')],
                ['other', text('Other', 'Lain')],
              ] as Array<[MovementView, string]>).map(([key, label]) => (
                <button key={key} type="button" className={`min-h-9 rounded-xl px-2 ${movementFilter === key ? 'bg-accent text-white' : ''}`} onClick={() => setMovementFilter(key)}>
                  <span className="block truncate">{label}</span>
                  <span className={`block text-[0.65rem] ${movementFilter === key ? 'text-white/80' : 'text-neutral-500'}`}>{movementCounts[key]}</span>
                </button>
              ))}
            </div>
            <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-white/80 sm:hidden">
              <table className="dense-table w-full table-fixed text-left text-[11px]">
                <thead className="bg-paper">
                  <tr>
                    <th className="w-[38%] p-2">{text('Ingredient', 'Bahan')}</th>
                    <th className="w-[24%] p-2">{text('Source', 'Sumber')}</th>
                    <th className="w-[19%] p-2">{text('Change', 'Perubahan')}</th>
                    <th className="w-[19%] p-2">{text('After', 'Selepas')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleMovements.map((movement) => {
                    const ingredient = ingredientById.get(movement.ingredient_id);
                    const unit = movement.ingredient_items?.base_unit ?? ingredient?.base_unit ?? 'unit';
                    const isNegative = Number(movement.quantity_change) < 0;
                    return (
                      <tr key={movement.id} className="border-t border-line">
                        <td className="p-2 align-top">
                          <p className="truncate font-black">{movement.ingredient_items?.name ?? ingredient?.name ?? text('Ingredient', 'Bahan')}</p>
                          <p className="mt-0.5 truncate text-[10px] font-bold text-neutral-500">{movementDateTime(movement.created_at)}</p>
                          <p className="mt-0.5 truncate text-[10px] font-bold text-neutral-500">{movement.entered_by || '-'}</p>
                        </td>
                        <td className="p-2 align-top">
                          <span className={`inline-flex max-w-full rounded-lg px-1.5 py-0.5 text-[9px] font-black ${movementTone(movement.movement_type)}`}>{movementLabel(movement.movement_type, text)}</span>
                          <p className="mt-1 line-clamp-2 text-[10px] font-bold text-neutral-600">{movement.reason || movement.notes || movement.reference_type || '-'}</p>
                        </td>
                        <td className={`p-2 align-top font-black tabular-nums ${isNegative ? 'text-coral' : 'text-accent'}`}>{movementQuantity(Number(movement.quantity_change), unit)}</td>
                        <td className="p-2 align-top font-black tabular-nums">{movementQuantity(Number(movement.quantity_after), unit).replace(/^\+/, '')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {visibleMovements.length === 0 ? (
                <div className="p-4 text-center text-sm font-bold text-neutral-600">{text('No ingredient activity found.', 'Tiada aktiviti bahan ditemui.')}</div>
              ) : null}
            </div>
            <div className="clean-scroll mt-3 hidden overflow-x-auto rounded-2xl border border-line bg-white/80 sm:block">
              <table className="dense-table w-full min-w-[920px] text-left text-xs sm:text-sm">
                <thead className="bg-paper">
                  <tr>
                    <th className="p-3">{text('Time', 'Masa')}</th>
                    <th className="p-3">{text('Ingredient', 'Bahan')}</th>
                    <th className="p-3">{text('Source', 'Sumber')}</th>
                    <th className="p-3">{text('Change', 'Perubahan')}</th>
                    <th className="p-3">{text('Balance after', 'Baki selepas')}</th>
                    <th className="p-3">{text('Entered By', 'Diisi Oleh')}</th>
                    <th className="p-3">{text('Reason / notes', 'Sebab / nota')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleMovements.map((movement) => {
                    const ingredient = ingredientById.get(movement.ingredient_id);
                    const unit = movement.ingredient_items?.base_unit ?? ingredient?.base_unit ?? 'unit';
                    const isNegative = Number(movement.quantity_change) < 0;
                    return (
                      <tr key={movement.id} className="border-t border-line hover:bg-shell">
                        <td className="p-3 whitespace-nowrap font-bold tabular-nums">{movementDateTime(movement.created_at)}</td>
                        <td className="p-3 font-black whitespace-nowrap">{movement.ingredient_items?.name ?? ingredient?.name ?? text('Ingredient', 'Bahan')}</td>
                        <td className="p-3 whitespace-nowrap"><span className={`rounded-xl px-2.5 py-1 text-xs font-black ${movementTone(movement.movement_type)}`}>{movementLabel(movement.movement_type, text)}</span></td>
                        <td className={`p-3 whitespace-nowrap font-black ${isNegative ? 'text-coral' : 'text-accent'}`}>{movementQuantity(Number(movement.quantity_change), unit)}</td>
                        <td className="p-3 whitespace-nowrap font-bold">{movementQuantity(Number(movement.quantity_after), unit).replace(/^\+/, '')}</td>
                        <td className="p-3 whitespace-nowrap">{movement.entered_by || '-'}</td>
                        <td className="p-3 min-w-[220px]">{movement.reason || movement.notes || movement.reference_type || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {visibleMovements.length === 0 ? (
                <div className="border-t border-line p-5 text-center text-sm font-bold text-neutral-600">{text('No ingredient activity found.', 'Tiada aktiviti bahan ditemui.')}</div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="grid gap-4">
          <form onSubmit={saveIngredient} className="island-panel rounded-2xl p-3 sm:rounded-xl sm:p-5">
            <h2 className="text-lg font-black sm:text-xl">{ingredientForm.id ? text('Edit Ingredient', 'Edit Bahan') : text('Add Ingredient', 'Tambah Bahan')}</h2>
            <div className="mt-3 grid gap-3">
              <Field label={text('Ingredient name', 'Nama bahan')}>
                <input className={inputClass} value={ingredientForm.name} onChange={(event) => setIngredientForm({ ...ingredientForm, name: event.target.value })} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={text('Type', 'Jenis')}>
                  <select className={inputClass} value={ingredientForm.category} onChange={(event) => setIngredientForm({ ...ingredientForm, category: event.target.value as IngredientCategory })}>
                    {ingredientCategories.map((category) => <option key={category}>{category}</option>)}
                  </select>
                </Field>
                <Field label={text('Base unit', 'Unit asas')}>
                  <select className={inputClass} value={ingredientForm.base_unit} onChange={(event) => setIngredientForm({ ...ingredientForm, base_unit: event.target.value as IngredientBaseUnit })}>
                    {baseUnits.map((unit) => <option key={unit}>{unit}</option>)}
                  </select>
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={text('Bottle/pack size', 'Saiz botol/pek')}>
                  <input className={inputClass} type="number" min={0.01} step="0.01" value={ingredientForm.default_pack_size} onChange={(event) => setIngredientForm({ ...ingredientForm, default_pack_size: event.target.value })} />
                </Field>
                <Field label={text('Bottle/pack label', 'Label botol/pek')}>
                  <input className={inputClass} value={ingredientForm.pack_label} onChange={(event) => setIngredientForm({ ...ingredientForm, pack_label: event.target.value })} />
                </Field>
                <Field label={text('Cost per base unit', 'Kos setiap unit asas')}>
                  <input className={inputClass} type="number" min={0} step="0.0001" value={ingredientForm.cost_per_base_unit} onChange={(event) => setIngredientForm({ ...ingredientForm, cost_per_base_unit: event.target.value })} />
                </Field>
                <Field label={text('Low alert at base unit', 'Amaran rendah pada unit asas')}>
                  <input className={inputClass} type="number" min={0} step="0.01" value={ingredientForm.low_stock_threshold} onChange={(event) => setIngredientForm({ ...ingredientForm, low_stock_threshold: event.target.value })} />
                </Field>
              </div>
              <label className="flex items-center gap-3 text-sm font-black">
                <input type="checkbox" checked={ingredientForm.active} onChange={(event) => setIngredientForm({ ...ingredientForm, active: event.target.checked })} />
                {text('Active', 'Aktif')}
              </label>
              <button className={buttonClass} disabled={savingIngredient}>{savingIngredient ? text('Saving...', 'Menyimpan...') : text('Save ingredient', 'Simpan bahan')}</button>
            </div>
          </form>

          <form onSubmit={receiveStock} className="island-panel rounded-2xl p-3 sm:rounded-xl sm:p-5">
            <h2 className="text-lg font-black sm:text-xl">{text('Receive Ingredient Stock', 'Terima Stok Bahan')}</h2>
            <div className="mt-3 grid gap-3">
              <Field label={text('Entered By', 'Diisi Oleh')}>
                <div className="grid grid-cols-2 gap-2">
                  {staff.map((person) => (
                    <button key={person} type="button" onClick={() => setReceiveForm({ ...receiveForm, entered_by: person })} className={`min-h-10 rounded-xl border px-2 py-2 text-sm font-black ${receiveForm.entered_by === person ? 'border-accent bg-accent text-white' : 'border-line bg-white text-ink'}`}>
                      {person}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label={text('Ingredient', 'Bahan')}>
                <select className={inputClass} value={receiveForm.ingredient_id} onChange={(event) => {
                  const item = ingredients.find((ingredient) => ingredient.id === event.target.value);
                  setReceiveForm({ ...receiveForm, ingredient_id: event.target.value, pack_size: String(item?.default_pack_size || 1) });
                }}>
                  <option value="">{text('Choose ingredient', 'Pilih bahan')}</option>
                  {ingredients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={text('Quantity received', 'Kuantiti diterima')}>
                  <input className={inputClass} type="number" min={0.01} step="0.01" value={receiveForm.input_quantity} onChange={(event) => setReceiveForm({ ...receiveForm, input_quantity: event.target.value })} />
                </Field>
                <Field label={text('Unit Type', 'Jenis Unit')}>
                  <div className="grid grid-cols-2 gap-2">
                    {(['pack', 'base'] as const).map((type) => (
                      <button key={type} type="button" className={`min-h-11 rounded-xl border px-2 py-2 text-sm font-black ${receiveForm.unit_type === type ? 'border-accent bg-accent text-white' : 'border-line bg-white text-ink'}`} onClick={() => setReceiveForm({ ...receiveForm, unit_type: type })}>
                        {type === 'pack' ? selectedIngredientForReceive?.pack_label || text('Pack/Bottle', 'Pek/Botol') : selectedIngredientForReceive?.base_unit || text('Base', 'Asas')}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
              {receiveForm.unit_type === 'pack' ? (
                <Field label={text('Size per bottle/pack', 'Saiz setiap botol/pek')}>
                  <input className={inputClass} type="number" min={0.01} step="0.01" value={receiveForm.pack_size} onChange={(event) => setReceiveForm({ ...receiveForm, pack_size: event.target.value })} />
                </Field>
              ) : null}
              <div className="rounded-2xl border border-teal-200 bg-teal-50 p-3 text-sm font-black text-accent">
                {Number.isFinite(receiveBaseQuantity) ? receiveBaseQuantity.toFixed(selectedIngredientForReceive?.base_unit === 'unit' ? 0 : 2) : '0'} {selectedIngredientForReceive?.base_unit ?? text('base units', 'unit asas')} {text('will be added to inventory.', 'akan ditambah ke inventori.')}
              </div>
              <Field label={text('Notes', 'Nota')}>
                <input className={inputClass} value={receiveForm.notes} onChange={(event) => setReceiveForm({ ...receiveForm, notes: event.target.value })} />
              </Field>
              <button className={buttonClass} disabled={receivingStock}>
                <PackagePlus className="h-4 w-4" />
                {receivingStock ? text('Saving...', 'Menyimpan...') : text('Receive stock', 'Terima stok')}
              </button>
            </div>
          </form>


          <form onSubmit={saveAdjustment} className="island-panel rounded-2xl p-3 sm:rounded-xl sm:p-5">
            <h2 className="text-lg font-black sm:text-xl">{text('Count / Waste / Correction', 'Kiraan / Rosak / Pembetulan')}</h2>
            <div className="mt-3 grid gap-3">
              <Field label={text('Entered By', 'Diisi Oleh')}>
                <div className="grid grid-cols-2 gap-2">
                  {staff.map((person) => (
                    <button key={person} type="button" onClick={() => setAdjustmentForm({ ...adjustmentForm, entered_by: person })} className={`min-h-10 rounded-xl border px-2 py-2 text-sm font-black ${adjustmentForm.entered_by === person ? 'border-accent bg-accent text-white' : 'border-line bg-white text-ink'}`}>
                      {person}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label={text('Ingredient', 'Bahan')}>
                <select className={inputClass} value={adjustmentForm.ingredient_id} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, ingredient_id: event.target.value })}>
                  <option value="">{text('Choose ingredient', 'Pilih bahan')}</option>
                  {ingredients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </Field>
              <div>
                <p className="mb-2 text-sm font-black">{text('Correction type', 'Jenis pembetulan')}</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {(['count', 'waste', 'adjustment'] as const).map((mode) => (
                    <button key={mode} type="button" className={`min-h-11 rounded-xl border px-2 py-2 text-sm font-black leading-tight ${adjustmentForm.movement_type === mode ? 'border-accent bg-accent text-white' : 'border-line bg-white text-ink'}`} onClick={() => setAdjustmentForm({ ...adjustmentForm, movement_type: mode, quantity: '' })}>
                      {adjustmentModeLabel(mode, text)}
                    </button>
                  ))}
                </div>
              </div>
              <Field label={adjustmentForm.movement_type === 'count' ? text('Actual balance now', 'Baki sebenar sekarang') : adjustmentForm.movement_type === 'waste' ? text('Quantity to deduct', 'Kuantiti untuk ditolak') : text('Correction quantity (+/-)', 'Kuantiti pembetulan (+/-)')}>
                <input
                  className={inputClass}
                  type="number"
                  min={adjustmentForm.movement_type === 'adjustment' ? undefined : 0}
                  step="0.01"
                  value={adjustmentForm.quantity}
                  onChange={(event) => setAdjustmentForm({ ...adjustmentForm, quantity: event.target.value })}
                  placeholder={adjustmentForm.movement_type === 'adjustment' ? '+50 or -50' : '0'}
                />
              </Field>
              <div className={`rounded-2xl border p-3 text-sm font-black ${adjustmentBalanceAfter < 0 ? 'border-amber-200 bg-amber-50 text-warning' : 'border-teal-200 bg-teal-50 text-accent'}`}>
                {text('Current', 'Semasa')}: {movementQuantity(adjustmentCurrentBalance, selectedIngredientForAdjustment?.base_unit)} · {text('Change', 'Perubahan')}: {movementQuantity(adjustmentQuantityChange, selectedIngredientForAdjustment?.base_unit)} · {text('Balance after', 'Baki selepas')}: {movementQuantity(adjustmentBalanceAfter, selectedIngredientForAdjustment?.base_unit).replace(/^\+/, '')}
              </div>
              <Field label={text('Reason', 'Sebab')}>
                <input className={inputClass} value={adjustmentForm.reason} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, reason: event.target.value })} placeholder={text('Example: stock count, broken bottle, missing item', 'Contoh: kiraan stok, botol pecah, barang hilang')} />
              </Field>
              <Field label={text('Notes', 'Nota')}>
                <input className={inputClass} value={adjustmentForm.notes} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, notes: event.target.value })} placeholder={text('Optional', 'Pilihan')} />
              </Field>
              <button className={buttonClass} disabled={adjustingStock || adjustmentBalanceAfter < 0}>
                <Save className="h-4 w-4" />
                {adjustingStock ? text('Saving...', 'Menyimpan...') : text('Save correction', 'Simpan pembetulan')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
