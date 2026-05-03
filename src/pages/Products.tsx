import { FormEvent, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { PackagePlus, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Field, buttonClass, inputClass, secondaryButtonClass } from '../components/Form';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/Page';
import { useToast } from '../components/Toast';
import { categoryRank, groupByCategory, normalizeCategoryName } from '../lib/data';
import { supabase } from '../lib/supabase';
import { isSupabaseConfigured } from '../lib/supabase';
import { loadLocalCategories, loadLocalProducts, saveLocalProduct, saveLocalSettings } from '../lib/localStore';
import { money } from '../lib/format';
import type { AppSettingKey, Category, ProductPriceHistory, ProductWithStock, SettingsMap } from '../lib/types';
import { assetPath } from '../lib/assets';
import { useLanguage } from '../lib/language';

type ProductForm = {
  id?: string;
  name: string;
  category_id: string;
  price_per_unit: string;
  cost_per_unit: string;
  carton_size: string;
  low_stock_threshold: string;
  image_url: string;
  active: boolean;
};

const blank = (defaultCartonSize: number): ProductForm => ({
  name: '',
  category_id: '',
  price_per_unit: '0',
  cost_per_unit: '',
  carton_size: String(defaultCartonSize),
  low_stock_threshold: '0',
  image_url: '',
  active: true,
});

const defaultCategories = [
  { name: 'Beer', sort_order: 10 },
  { name: 'Soft Drink', sort_order: 20 },
  { name: 'Food', sort_order: 30 },
  { name: 'Cocktail', sort_order: 40 },
  { name: 'Others', sort_order: 50 },
];

type BundleForm = {
  beer_bundle_enabled: boolean;
  beer_bundle_name: string;
  beer_bundle_units_per_set: string;
  beer_bundle_price: string;
};

const bundleKeys: AppSettingKey[] = ['beer_bundle_enabled', 'beer_bundle_name', 'beer_bundle_units_per_set', 'beer_bundle_price'];

function bundleFormFromSettings(settings: SettingsMap): BundleForm {
  return {
    beer_bundle_enabled: settings.beer_bundle_enabled === true || settings.beer_bundle_enabled === 'true',
    beer_bundle_name: String(settings.beer_bundle_name || 'Beer Bundle'),
    beer_bundle_units_per_set: String(settings.beer_bundle_units_per_set || 4),
    beer_bundle_price: String(settings.beer_bundle_price || 40),
  };
}

export default function Products({ settings, onSettingsSaved }: { settings: SettingsMap; onSettingsSaved: (settings: SettingsMap) => void }) {
  const toast = useToast();
  const { text } = useLanguage();
  const [products, setProducts] = useState<ProductWithStock[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [priceHistory, setPriceHistory] = useState<ProductPriceHistory[]>([]);
  const [form, setForm] = useState<ProductForm | null>(null);
  const [bundleForm, setBundleForm] = useState<BundleForm>(() => bundleFormFromSettings(settings));
  const [bundleSaving, setBundleSaving] = useState(false);
  const [adminPin, setAdminPin] = useState('');
  const [demoAdminUnlocked, setDemoAdminUnlocked] = useState(() => sessionStorage.getItem('lovely_paradise_admin_access') === 'ok');
  const [adminSection, setAdminSection] = useState<'products' | 'priceHistory'>('products');
  const defaultCartonSize = Number(settings.default_carton_size || 24);

  async function refresh() {
    if (!isSupabaseConfigured) {
      setProducts(loadLocalProducts(true));
      setCategories(loadLocalCategories());
      setPriceHistory([]);
      return;
    }
    const [{ data: productData }, { data: categoryData }, { data: priceHistoryData, error: priceHistoryError }] = await Promise.all([
      supabase.from('products').select('*, categories(id,name,sort_order), inventory_balances(quantity_on_hand)').order('name'),
      supabase.from('categories').select('*').order('sort_order'),
      supabase.from('product_price_history').select('*, products(name), profiles(full_name)').order('changed_at', { ascending: false }).limit(200),
    ]);
    setProducts((productData ?? []) as ProductWithStock[]);
    if (!priceHistoryError) setPriceHistory((priceHistoryData ?? []) as ProductPriceHistory[]);
    else setPriceHistory([]);
    const currentCategories = (categoryData ?? []) as Category[];
    const missingCategories = defaultCategories.filter(
      (category) => !currentCategories.some((item) => normalizeCategoryName(item.name) === category.name),
    );
    if (missingCategories.length > 0) {
      const { error } = await supabase.from('categories').upsert(defaultCategories, { onConflict: 'name' });
      if (error) {
        toast.error(error.message);
        setCategories(currentCategories);
        return;
      }
      const { data: nextCategories } = await supabase.from('categories').select('*').order('sort_order');
      setCategories((nextCategories ?? currentCategories) as Category[]);
      return;
    }
    setCategories(currentCategories);
  }

  function unlockAdmin() {
    if (adminPin !== '200000') {
      toast.error('Wrong admin password.');
      return;
    }
    sessionStorage.setItem('lovely_paradise_admin_access', 'ok');
    setDemoAdminUnlocked(true);
    setAdminPin('');
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    setBundleForm(bundleFormFromSettings(settings));
  }, [settings]);

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => categoryRank(a.name) - categoryRank(b.name) || a.name.localeCompare(b.name)),
    [categories],
  );
  const sortedProducts = useMemo(() => Object.values(groupByCategory(products)).flat(), [products]);
  const effectiveForm = useMemo(() => {
    if (!form) return null;
    return { ...form, category_id: form.category_id || sortedCategories[0]?.id || '' };
  }, [form, sortedCategories]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!effectiveForm) return;
    if (!effectiveForm.category_id) {
      toast.error('Choose a category before saving.');
      return;
    }
    if (!isSupabaseConfigured) {
      saveLocalProduct({
        id: effectiveForm.id,
        name: effectiveForm.name,
        category_id: effectiveForm.category_id,
        price_per_unit: Number(effectiveForm.price_per_unit),
        cost_per_unit: effectiveForm.cost_per_unit ? Number(effectiveForm.cost_per_unit) : null,
        carton_size: Number(effectiveForm.carton_size),
        low_stock_threshold: Number(effectiveForm.low_stock_threshold),
        image_url: effectiveForm.image_url.trim() || null,
        active: effectiveForm.active,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        inventory_balances: { quantity_on_hand: products.find((item) => item.id === effectiveForm.id)?.inventory_balances?.quantity_on_hand ?? 0 },
      });
      setForm(null);
      await refresh();
      toast.success('Product saved.');
      return;
    }
    const payload = {
      name: effectiveForm.name,
      category_id: effectiveForm.category_id,
      price_per_unit: Number(effectiveForm.price_per_unit),
      cost_per_unit: effectiveForm.cost_per_unit ? Number(effectiveForm.cost_per_unit) : null,
      carton_size: Number(effectiveForm.carton_size),
      low_stock_threshold: Number(effectiveForm.low_stock_threshold),
      image_url: effectiveForm.image_url.trim() || null,
      active: effectiveForm.active,
    };
    const result = effectiveForm.id
      ? await supabase.from('products').update(payload).eq('id', effectiveForm.id)
      : await supabase.from('products').insert(payload);
    if (result.error) {
      toast.error(result.error.message);
      return;
    }
    setForm(null);
    await refresh();
    toast.success('Product saved.');
  }

  async function saveBundle(event: FormEvent) {
    event.preventDefault();
    const units = Math.max(1, Math.floor(Number(bundleForm.beer_bundle_units_per_set || 4)));
    const price = Number(bundleForm.beer_bundle_price);
    if (!Number.isFinite(price) || price <= 0) {
      toast.error('Enter a valid bundle price.');
      return;
    }
    const nextSettings: SettingsMap = {
      ...settings,
      beer_bundle_enabled: bundleForm.beer_bundle_enabled,
      beer_bundle_name: bundleForm.beer_bundle_name.trim() || 'Beer Bundle',
      beer_bundle_units_per_set: units,
      beer_bundle_price: Number(price.toFixed(2)),
    };
    setBundleSaving(true);
    if (!isSupabaseConfigured) {
      saveLocalSettings(nextSettings);
      onSettingsSaved(nextSettings);
      setBundleSaving(false);
      toast.success('Beer bundle saved.');
      return;
    }
    const rows = bundleKeys.map((key) => ({ key, value: nextSettings[key] }));
    const { error } = await supabase.from('app_settings').upsert(rows);
    setBundleSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    onSettingsSaved(nextSettings);
    toast.success('Beer bundle saved.');
  }

  function attachImage(file: File | undefined) {
    if (!file || !effectiveForm) return;
    const reader = new FileReader();
    reader.onload = () => {
      setForm({ ...effectiveForm, image_url: String(reader.result ?? '') });
    };
    reader.readAsDataURL(file);
  }

  return (
    <>
      <PageHeader
        title={text('Admin', 'Pentadbir')}
        actions={
          demoAdminUnlocked ? (
            <>
            <button className={buttonClass} onClick={() => setForm(blank(defaultCartonSize))}>
              <Plus className="h-4 w-4" />
              {text('Add product', 'Tambah produk')}
            </button>
            <Link className={secondaryButtonClass} to="/settings">{text('Settings', 'Tetapan')}</Link>
            <Link className={secondaryButtonClass} to="/users">{text('Users', 'Pengguna')}</Link>
            </>
          ) : null
        }
      />
      {!demoAdminUnlocked ? (
        <div className="island-panel mb-4 max-w-xl rounded-2xl p-3 sm:mb-5 sm:rounded-[2rem] sm:p-5">
          <h2 className="text-xl font-black sm:text-2xl">{text('Admin Access', 'Akses Pentadbir')}</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
            <input className={inputClass} type="password" value={adminPin} onChange={(e) => setAdminPin(e.target.value)} placeholder="Admin password" />
            <button className={buttonClass} onClick={unlockAdmin}>Unlock</button>
          </div>
        </div>
      ) : null}
      {!demoAdminUnlocked ? null : (
      <>
      <section className="island-panel mb-4 rounded-2xl p-1.5 sm:mb-5 sm:rounded-[2rem] sm:p-2">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className={`min-h-10 rounded-xl px-3 py-2 text-sm font-black sm:min-h-12 sm:rounded-2xl ${adminSection === 'products' ? 'bg-accent text-white shadow-glow' : 'bg-white/80 text-ink'}`}
            onClick={() => setAdminSection('products')}
          >
            Products
          </button>
          <button
            type="button"
            className={`min-h-10 rounded-xl px-3 py-2 text-sm font-black sm:min-h-12 sm:rounded-2xl ${adminSection === 'priceHistory' ? 'bg-accent text-white shadow-glow' : 'bg-white/80 text-ink'}`}
            onClick={() => setAdminSection('priceHistory')}
          >
            Price History
          </button>
        </div>
      </section>
      {adminSection === 'products' ? (
      <>
      <section className="island-panel mb-4 rounded-2xl p-3 sm:mb-5 sm:rounded-[2rem] sm:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-black sm:text-xl">{text('Product Categories', 'Kategori Produk')}</h2>
          </div>
          <button className={secondaryButtonClass} onClick={() => setForm(blank(defaultCartonSize))}>
            <Plus className="h-4 w-4" />
            {text('Add product', 'Tambah produk')}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 sm:mt-4">
          {sortedCategories.map((category) => (
            <span key={category.id} className="rounded-xl border border-line bg-white px-3 py-1.5 text-sm font-black shadow-soft sm:rounded-2xl sm:px-4 sm:py-2">
              {normalizeCategoryName(category.name)}
            </span>
          ))}
        </div>
      </section>
      <form onSubmit={saveBundle} className="island-panel mb-4 rounded-2xl p-3 sm:mb-5 sm:rounded-[2rem] sm:p-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-accent text-white shadow-glow">
              <PackagePlus className="h-6 w-6" />
            </span>
            <div>
              <h2 className="text-lg font-black sm:text-xl">{text('Beer Bundle', 'Set Bir')}</h2>
              <p className="text-sm font-bold text-neutral-600">
                {bundleForm.beer_bundle_units_per_set || 4} {text('beer unit(s)', 'unit bir')} · {money(Number(bundleForm.beer_bundle_price || 0), String(settings.currency_symbol))}
              </p>
            </div>
          </div>
          <button className={`${buttonClass} w-full lg:w-auto`} disabled={bundleSaving}>
            {bundleSaving ? 'Saving...' : text('Save bundle', 'Simpan set')}
          </button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1.4fr_1fr_1fr]">
          <Field label={text('Status', 'Status')}>
            <label className="flex min-h-12 items-center gap-3 rounded-2xl border border-line bg-paper px-3 text-sm font-bold">
              <input
                type="checkbox"
                checked={bundleForm.beer_bundle_enabled}
                onChange={(event) => setBundleForm({ ...bundleForm, beer_bundle_enabled: event.target.checked })}
              />
              {bundleForm.beer_bundle_enabled ? text('Enabled', 'Aktif') : text('Disabled', 'Tidak aktif')}
            </label>
          </Field>
          <Field label={text('Bundle name', 'Nama set')}>
            <input
              className={inputClass}
              value={bundleForm.beer_bundle_name}
              onChange={(event) => setBundleForm({ ...bundleForm, beer_bundle_name: event.target.value })}
            />
          </Field>
          <Field label={text('Units per set', 'Unit setiap set')}>
            <input
              className={inputClass}
              type="number"
              min={1}
              value={bundleForm.beer_bundle_units_per_set}
              onChange={(event) => setBundleForm({ ...bundleForm, beer_bundle_units_per_set: event.target.value })}
            />
          </Field>
          <Field label={text('Price per set', 'Harga setiap set')}>
            <input
              className={inputClass}
              type="number"
              min={0}
              step="0.01"
              value={bundleForm.beer_bundle_price}
              onChange={(event) => setBundleForm({ ...bundleForm, beer_bundle_price: event.target.value })}
            />
          </Field>
        </div>
      </form>
      <div className="hidden">
        {sortedProducts.map((product) => (
          <article key={product.id} className="rounded-2xl border border-line bg-white/85 p-3 shadow-soft sm:rounded-[1.5rem] sm:p-4">
            <div className="grid grid-cols-[72px_1fr] gap-3 sm:grid-cols-[88px_1fr]">
              <img
                src={product.image_url ?? assetPath('assets/custom-order.svg')}
                data-fallback={assetPath('assets/custom-order.svg')}
                alt=""
                className="h-16 w-16 rounded-xl object-cover sm:h-20 sm:w-20"
                onError={(event) => {
                  const fallback = event.currentTarget.dataset.fallback;
                  if (fallback && !event.currentTarget.src.endsWith(fallback)) event.currentTarget.src = fallback;
                }}
              />
              <div className="min-w-0">
                <p className="truncate text-base font-black sm:text-lg">{product.name}</p>
                <p className="text-sm font-bold text-neutral-600">{normalizeCategoryName(product.categories?.name)} · {product.active ? 'Active' : 'Inactive'}</p>
                <p className="mt-1 text-sm font-black">{String(settings.currency_symbol)} {Number(product.price_per_unit).toFixed(2)}</p>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1.5 text-center text-xs font-bold sm:mt-3 sm:gap-2 sm:text-sm">
              <div className="rounded-xl bg-shell p-2 sm:rounded-2xl"><p className="text-neutral-500">Cost</p><p>{product.cost_per_unit ?? '-'}</p></div>
              <div className="rounded-xl bg-shell p-2 sm:rounded-2xl"><p className="text-neutral-500">Carton</p><p>{product.carton_size}</p></div>
              <div className="rounded-xl bg-shell p-2 sm:rounded-2xl"><p className="text-neutral-500">Low</p><p>{product.low_stock_threshold}</p></div>
            </div>
            <button
              className={`${secondaryButtonClass} mt-3 w-full`}
              onClick={() =>
                setForm({
                  id: product.id,
                  name: product.name,
                  category_id: product.category_id ?? '',
                  price_per_unit: String(product.price_per_unit),
                  cost_per_unit: product.cost_per_unit == null ? '' : String(product.cost_per_unit),
                  carton_size: String(product.carton_size),
                  low_stock_threshold: String(product.low_stock_threshold),
                  image_url: product.image_url ?? '',
                  active: product.active,
                })
              }
            >
              Edit
            </button>
          </article>
        ))}
      </div>
      <div className="overflow-x-auto rounded-2xl border border-line bg-white/80 shadow-soft sm:rounded-[2rem]">
        <table className="w-full min-w-[820px] text-left">
          <thead className="bg-paper text-sm">
            <tr>
              <th className="p-3">Name</th>
              <th className="p-3">Image</th>
              <th className="p-3">Category</th>
              <th className="p-3">Price</th>
              <th className="p-3">Cost</th>
              <th className="p-3">Carton</th>
              <th className="p-3">Low alert at</th>
              <th className="p-3">Status</th>
              <th className="p-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {sortedProducts.map((product) => (
              <tr key={product.id} className="border-t border-line">
                <td className="p-3 font-bold">{product.name}</td>
                <td className="p-3">
                  <img
                    src={product.image_url ?? assetPath('assets/custom-order.svg')}
                    data-fallback={assetPath('assets/custom-order.svg')}
                    alt=""
                    className="h-14 w-20 rounded-xl object-cover"
                    onError={(event) => {
                      const fallback = event.currentTarget.dataset.fallback;
                      if (fallback && !event.currentTarget.src.endsWith(fallback)) event.currentTarget.src = fallback;
                    }}
                  />
                </td>
                <td className="p-3">{normalizeCategoryName(product.categories?.name)}</td>
                <td className="p-3">{product.price_per_unit}</td>
                <td className="p-3">{product.cost_per_unit ?? '-'}</td>
                <td className="p-3">{product.carton_size}</td>
                <td className="p-3">{product.low_stock_threshold}</td>
                <td className="p-3">{product.active ? 'Active' : 'Inactive'}</td>
                <td className="p-3">
                  <button
                    className={secondaryButtonClass}
                    onClick={() =>
                      setForm({
                        id: product.id,
                        name: product.name,
                        category_id: product.category_id ?? '',
                        price_per_unit: String(product.price_per_unit),
                        cost_per_unit: product.cost_per_unit == null ? '' : String(product.cost_per_unit),
                        carton_size: String(product.carton_size),
                        low_stock_threshold: String(product.low_stock_threshold),
                        image_url: product.image_url ?? '',
                        active: product.active,
                      })
                    }
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </>
      ) : (
        <section className="island-panel rounded-2xl p-3 sm:rounded-[2rem] sm:p-5">
          <h2 className="text-lg font-black sm:text-xl">Price History</h2>
          <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-white/75">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-paper">
                <tr>
                  <th className="p-3">Time</th>
                  <th className="p-3">Product</th>
                  <th className="p-3">Old price</th>
                  <th className="p-3">New price</th>
                  <th className="p-3">Old cost</th>
                  <th className="p-3">New cost</th>
                  <th className="p-3">Changed by</th>
                </tr>
              </thead>
              <tbody>
                {priceHistory.map((item) => (
                  <tr key={item.id} className="border-t border-line">
                    <td className="p-3 whitespace-nowrap">{format(new Date(item.changed_at), 'dd MMM yyyy, h:mm a')}</td>
                    <td className="p-3 font-black">{item.products?.name ?? item.product_name}</td>
                    <td className="p-3 whitespace-nowrap">{item.old_price_per_unit == null ? '-' : money(item.old_price_per_unit, String(settings.currency_symbol))}</td>
                    <td className="p-3 whitespace-nowrap font-black">{item.new_price_per_unit == null ? '-' : money(item.new_price_per_unit, String(settings.currency_symbol))}</td>
                    <td className="p-3 whitespace-nowrap">{item.old_cost_per_unit == null ? '-' : money(item.old_cost_per_unit, String(settings.currency_symbol))}</td>
                    <td className="p-3 whitespace-nowrap">{item.new_cost_per_unit == null ? '-' : money(item.new_cost_per_unit, String(settings.currency_symbol))}</td>
                    <td className="p-3 whitespace-nowrap">{item.profiles?.full_name ?? 'Admin'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {priceHistory.length === 0 ? (
              <div className="p-5 text-center text-sm font-bold text-neutral-600">No price changes recorded yet.</div>
            ) : null}
          </div>
        </section>
      )}
      </>
      )}
      {effectiveForm ? (
        <Modal title={effectiveForm.id ? text('Edit product', 'Edit produk') : text('Add product', 'Tambah produk')} onClose={() => setForm(null)}>
          <form onSubmit={save} className="grid gap-4">
            <Field label="Product name">
              <input className={inputClass} value={effectiveForm.name} onChange={(e) => setForm({ ...effectiveForm, name: e.target.value })} required />
            </Field>
            <Field label="Category">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {sortedCategories.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => setForm({ ...effectiveForm, category_id: category.id })}
                    className={`min-h-10 rounded-xl border px-3 py-2 text-sm font-black shadow-soft ${
                      effectiveForm.category_id === category.id
                        ? 'border-accent bg-accent text-white'
                        : 'border-line bg-white text-ink'
                    }`}
                  >
                    {normalizeCategoryName(category.name)}
                  </button>
                ))}
              </div>
              {sortedCategories.length === 0 ? (
                <p className="rounded-xl border border-warning bg-amber-50 p-3 text-sm font-black text-warning">
                  Categories are missing. Close this window, reopen Admin, then Add product again.
                </p>
              ) : null}
            </Field>
            <Field label="Product image URL">
              <input className={inputClass} value={effectiveForm.image_url} onChange={(e) => setForm({ ...effectiveForm, image_url: e.target.value })} placeholder="https://..." />
            </Field>
            <Field label="Attach product image">
              <div className="grid gap-3 rounded-xl border border-line bg-shell p-3 sm:grid-cols-[140px_1fr] sm:items-center sm:rounded-2xl">
                <img src={effectiveForm.image_url || assetPath('assets/custom-order.svg')} alt="" className="h-20 w-full rounded-xl object-cover sm:h-24" />
                <input className={inputClass} type="file" accept="image/*" onChange={(event) => attachImage(event.target.files?.[0])} />
              </div>
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Price per unit"><input className={inputClass} type="number" min={0} step="0.01" value={effectiveForm.price_per_unit} onChange={(e) => setForm({ ...effectiveForm, price_per_unit: e.target.value })} /></Field>
              <Field label="Cost per unit"><input className={inputClass} type="number" min={0} step="0.01" value={effectiveForm.cost_per_unit} onChange={(e) => setForm({ ...effectiveForm, cost_per_unit: e.target.value })} /></Field>
              <Field label="Carton size"><input className={inputClass} type="number" min={1} value={effectiveForm.carton_size} onChange={(e) => setForm({ ...effectiveForm, carton_size: e.target.value })} /></Field>
              <Field label="Low stock alert at"><input className={inputClass} type="number" min={0} value={effectiveForm.low_stock_threshold} onChange={(e) => setForm({ ...effectiveForm, low_stock_threshold: e.target.value })} /></Field>
            </div>
            <label className="flex items-center gap-3 font-bold">
              <input type="checkbox" checked={effectiveForm.active} onChange={(e) => setForm({ ...effectiveForm, active: e.target.checked })} />
              Active
            </label>
            <button className={`${buttonClass} w-full sm:w-auto`}>Save product</button>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
