import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Field, buttonClass, inputClass, secondaryButtonClass } from '../components/Form';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/Page';
import { useToast } from '../components/Toast';
import { categoryRank, groupByCategory, normalizeCategoryName } from '../lib/data';
import { supabase } from '../lib/supabase';
import { isSupabaseConfigured } from '../lib/supabase';
import { demoCategories, demoProducts } from '../lib/demo';
import type { Category, ProductWithStock, SettingsMap } from '../lib/types';
import { assetPath } from '../lib/assets';

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

export default function Products({ settings }: { settings: SettingsMap }) {
  const toast = useToast();
  const [products, setProducts] = useState<ProductWithStock[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState<ProductForm | null>(null);
  const [adminPin, setAdminPin] = useState('');
  const [demoAdminUnlocked, setDemoAdminUnlocked] = useState(isSupabaseConfigured);
  const defaultCartonSize = Number(settings.default_carton_size || 24);

  async function refresh() {
    if (!isSupabaseConfigured) {
      setProducts(demoProducts);
      setCategories(demoCategories);
      return;
    }
    const [{ data: productData }, { data: categoryData }] = await Promise.all([
      supabase.from('products').select('*, categories(id,name,sort_order), inventory_balances(quantity_on_hand)').order('name'),
      supabase.from('categories').select('*').order('sort_order'),
    ]);
    setProducts((productData ?? []) as ProductWithStock[]);
    setCategories((categoryData ?? []) as Category[]);
  }

  useEffect(() => {
    void refresh();
  }, []);

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
    if (!isSupabaseConfigured) {
      toast.error('Demo mode: connect Supabase to save products.');
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
        title="Admin / Pentadbir"
        subtitle="Admin-only product management. Use inactive instead of physical delete so old records stay intact."
        actions={
          demoAdminUnlocked ? (
            <>
            <button className={buttonClass} onClick={() => setForm(blank(defaultCartonSize))}>
              <Plus className="h-4 w-4" />
              Add product
            </button>
            <a className={secondaryButtonClass} href="/settings">Settings</a>
            <a className={secondaryButtonClass} href="/users">Users</a>
            </>
          ) : null
        }
      />
      {!demoAdminUnlocked ? (
        <div className="island-panel mb-5 max-w-xl rounded-[2rem] p-5">
          <h2 className="text-2xl font-black">Admin Access / Akses Pentadbir</h2>
          <p className="mt-2 text-sm font-bold text-neutral-600">Enter admin password to manage products and records.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
            <input className={inputClass} type="password" value={adminPin} onChange={(e) => setAdminPin(e.target.value)} placeholder="Admin password" />
            <button className={buttonClass} onClick={() => setDemoAdminUnlocked(adminPin === '200000')}>Unlock</button>
          </div>
        </div>
      ) : null}
      {!demoAdminUnlocked ? null : (
      <>
      <section className="island-panel mb-5 rounded-[2rem] p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-black">Product Categories</h2>
            <p className="mt-1 text-sm font-bold text-neutral-600">Choose one of these categories when adding or editing products.</p>
          </div>
          <button className={secondaryButtonClass} onClick={() => setForm(blank(defaultCartonSize))}>
            <Plus className="h-4 w-4" />
            Add product
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {sortedCategories.map((category) => (
            <span key={category.id} className="rounded-2xl border border-line bg-white px-4 py-2 text-sm font-black shadow-soft">
              {normalizeCategoryName(category.name)}
            </span>
          ))}
        </div>
      </section>
      <div className="grid gap-3 lg:hidden">
        {sortedProducts.map((product) => (
          <article key={product.id} className="rounded-[1.5rem] border border-line bg-white/85 p-4 shadow-soft">
            <div className="grid grid-cols-[88px_1fr] gap-3">
              <img
                src={product.image_url ?? assetPath('assets/custom-order.svg')}
                data-fallback={assetPath('assets/custom-order.svg')}
                alt=""
                className="h-20 w-20 rounded-xl object-cover"
                onError={(event) => {
                  const fallback = event.currentTarget.dataset.fallback;
                  if (fallback && !event.currentTarget.src.endsWith(fallback)) event.currentTarget.src = fallback;
                }}
              />
              <div className="min-w-0">
                <p className="truncate text-lg font-black">{product.name}</p>
                <p className="text-sm font-bold text-neutral-600">{normalizeCategoryName(product.categories?.name)} · {product.active ? 'Active' : 'Inactive'}</p>
                <p className="mt-1 text-sm font-black">{String(settings.currency_symbol)} {Number(product.price_per_unit).toFixed(2)}</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm font-bold">
              <div className="rounded-2xl bg-shell p-2"><p className="text-neutral-500">Cost</p><p>{product.cost_per_unit ?? '-'}</p></div>
              <div className="rounded-2xl bg-shell p-2"><p className="text-neutral-500">Carton</p><p>{product.carton_size}</p></div>
              <div className="rounded-2xl bg-shell p-2"><p className="text-neutral-500">Low</p><p>{product.low_stock_threshold}</p></div>
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
      <div className="hidden overflow-x-auto rounded-[2rem] border border-line bg-white/80 shadow-soft lg:block">
        <table className="w-full min-w-[880px] text-left">
          <thead className="bg-paper text-sm">
            <tr>
              <th className="p-3">Name</th>
              <th className="p-3">Image</th>
              <th className="p-3">Category</th>
              <th className="p-3">Price</th>
              <th className="p-3">Cost</th>
              <th className="p-3">Carton</th>
              <th className="p-3">Low stock</th>
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
      )}
      {effectiveForm ? (
        <Modal title={effectiveForm.id ? 'Edit product' : 'Add product'} onClose={() => setForm(null)}>
          <form onSubmit={save} className="grid gap-4">
            <Field label="Product name">
              <input className={inputClass} value={effectiveForm.name} onChange={(e) => setForm({ ...effectiveForm, name: e.target.value })} required />
            </Field>
            <Field label="Product image URL">
              <input className={inputClass} value={effectiveForm.image_url} onChange={(e) => setForm({ ...effectiveForm, image_url: e.target.value })} placeholder="https://..." />
            </Field>
            <Field label="Attach product image">
              <div className="grid gap-3 rounded-2xl border border-line bg-shell p-3 sm:grid-cols-[140px_1fr] sm:items-center">
                <img src={effectiveForm.image_url || assetPath('assets/custom-order.svg')} alt="" className="h-24 w-full rounded-xl object-cover" />
                <input className={inputClass} type="file" accept="image/*" onChange={(event) => attachImage(event.target.files?.[0])} />
              </div>
            </Field>
            <Field label="Category">
              <select className={inputClass} value={effectiveForm.category_id} onChange={(e) => setForm({ ...effectiveForm, category_id: e.target.value })}>
                {sortedCategories.map((category) => <option key={category.id} value={category.id}>{normalizeCategoryName(category.name)}</option>)}
              </select>
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Price per unit"><input className={inputClass} type="number" min={0} step="0.01" value={effectiveForm.price_per_unit} onChange={(e) => setForm({ ...effectiveForm, price_per_unit: e.target.value })} /></Field>
              <Field label="Cost per unit"><input className={inputClass} type="number" min={0} step="0.01" value={effectiveForm.cost_per_unit} onChange={(e) => setForm({ ...effectiveForm, cost_per_unit: e.target.value })} /></Field>
              <Field label="Carton size"><input className={inputClass} type="number" min={1} value={effectiveForm.carton_size} onChange={(e) => setForm({ ...effectiveForm, carton_size: e.target.value })} /></Field>
              <Field label="Low stock threshold"><input className={inputClass} type="number" min={0} value={effectiveForm.low_stock_threshold} onChange={(e) => setForm({ ...effectiveForm, low_stock_threshold: e.target.value })} /></Field>
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
