import { FormEvent, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { Field, buttonClass, inputClass, secondaryButtonClass } from '../components/Form';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/Page';
import { useToast } from '../components/Toast';
import { loadProducts } from '../lib/data';
import { supabase } from '../lib/supabase';
import { isSupabaseConfigured } from '../lib/supabase';
import type { ProductWithStock, SettingsMap } from '../lib/types';

const stockInSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.coerce.number().int().positive(),
  unit: z.enum(['can', 'carton']),
  cost: z.coerce.number().nonnegative().optional().or(z.literal('')),
});

function staffNames(settings: SettingsMap) {
  return String(settings.staff_names || 'Chloe, Happy, Elle, NekoMiao')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

export default function StockIn({ settings, embedded = false }: { settings: SettingsMap; embedded?: boolean }) {
  const toast = useToast();
  const workers = useMemo(() => staffNames(settings), [settings]);
  const [products, setProducts] = useState<ProductWithStock[]>([]);
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [unit, setUnit] = useState<'can' | 'carton'>('can');
  const [supplier, setSupplier] = useState('');
  const [reference, setReference] = useState('');
  const [cost, setCost] = useState('');
  const [notes, setNotes] = useState('');
  const [enteredBy, setEnteredBy] = useState(workers[0] ?? 'Chloe');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    const loaded = await loadProducts(true);
    setProducts(loaded);
    if (!productId && loaded[0]) setProductId(loaded[0].id);
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (workers.length > 0 && !workers.includes(enteredBy)) {
      setEnteredBy(workers[0]);
    }
  }, [enteredBy, workers]);

  const product = useMemo(() => products.find((item) => item.id === productId), [products, productId]);
  const defaultCartonUnits = Number(settings.default_carton_size || 24);
  const cans = product ? quantity * (unit === 'carton' ? product.carton_size : 1) : 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = stockInSchema.safeParse({ productId, quantity, unit, cost });
    if (!parsed.success) {
      toast.error('Choose a product and enter a positive quantity.');
      return;
    }
    setConfirming(true);
  }

  async function confirm() {
    if (!product) return;
    setSaving(true);
    if (!isSupabaseConfigured) {
      setSaving(false);
      setConfirming(false);
      toast.success(`Demo stock-in saved by ${enteredBy}: ${cans} unit(s) added to ${product.name}.`);
      return;
    }
    const { data, error } = await supabase.rpc('stock_in_product', {
      p_product_id: product.id,
      p_quantity: quantity,
      p_unit: unit,
      p_cost_per_unit: cost ? Number(cost) : null,
      p_supplier: supplier || null,
      p_reference: reference || null,
      p_notes: notes || null,
      p_entered_by: enteredBy,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!data) {
      toast.error('Stock-in did not return an updated balance.');
      return;
    }
    setConfirming(false);
    await refresh();
    toast.success(`Stock updated by ${enteredBy}: ${data.quantity_on_hand} unit(s) now on hand.`);
  }

  return (
    <>
      {embedded ? null : <PageHeader title="Stock In" subtitle="Cartons are converted by each product carton size." />}
      <form onSubmit={submit} className="island-panel grid gap-6 rounded-[2rem] p-5 shadow-soft">
        <div>
          <p className="mb-2 text-sm font-black">Entered by / Diisi oleh</p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {workers.map((worker) => (
              <button
                key={worker}
                type="button"
                onClick={() => setEnteredBy(worker)}
                className={`rounded-xl border px-3 py-2.5 text-sm font-black shadow-soft sm:text-base ${
                  enteredBy === worker ? 'border-accent bg-accent text-white' : 'border-line bg-white text-ink'
                }`}
              >
                {worker}
              </button>
            ))}
          </div>
        </div>
        <Field label="Product">
          <select className={inputClass} value={productId} onChange={(e) => setProductId(e.target.value)}>
            {products.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.categories?.name === 'Other' ? 'Others' : item.categories?.name ?? 'Others'})
              </option>
            ))}
          </select>
        </Field>
        <div className="grid gap-4 md:grid-cols-[minmax(150px,0.72fr)_1.8fr] md:items-end">
          <Field label="Quantity">
            <input className={inputClass} type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
          </Field>
          <div>
            <p className="mb-2 text-sm font-semibold">Unit type</p>
            <div className="grid grid-cols-2 gap-3">
              {(['can', 'carton'] as const).map((nextUnit) => (
                <button
                  key={nextUnit}
                  type="button"
                  onClick={() => setUnit(nextUnit)}
                  className={`flex h-[52px] flex-col items-center justify-center rounded-2xl border px-4 py-0 text-base font-black leading-tight shadow-soft transition ${
                    unit === nextUnit ? 'border-accent bg-teal-50 text-accent ring-2 ring-teal-100' : 'border-line bg-white text-ink'
                  }`}
                >
                  <span className="block">{nextUnit === 'can' ? 'UNIT(S)' : 'CARTON(S)'}</span>
                  {nextUnit === 'carton' ? (
                    <span className="block text-[11px] font-black leading-tight text-neutral-600">
                      1 carton = {defaultCartonUnits} units
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Supplier">
            <input className={inputClass} value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </Field>
          <Field label="Invoice / reference">
            <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label={`Cost per unit (${String(settings.currency_symbol)})`}>
            <input className={inputClass} type="number" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
          </Field>
          <Field label="Notes">
            <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <button className={`${buttonClass} justify-center`}>Review stock-in</button>
      </form>
      {confirming && product ? (
        <Modal
          title="Confirm Stock-In"
          onClose={() => setConfirming(false)}
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <button className={secondaryButtonClass} onClick={() => setConfirming(false)}>Cancel</button>
              <button className={buttonClass} disabled={saving} onClick={confirm}>
                {saving ? 'Saving...' : `Yes, confirm ${unit === 'can' ? 'UNIT(S)' : 'CARTON(S)'}`}
              </button>
            </div>
          }
        >
          <p className="text-2xl font-black leading-tight sm:text-3xl">
            {unit === 'can'
              ? `Confirm Stock-In: ${quantity} UNIT(S)?`
              : `Confirm Stock-In: ${quantity} CARTON(S) x ${product.carton_size} unit(s) = ${cans} unit(s)?`}
          </p>
          <p className="mt-3 text-neutral-700">{product.name} will be increased by {cans} unit(s).</p>
          <p className="mt-2 rounded-2xl bg-shell p-3 text-sm font-black">Entered by / Diisi oleh: {enteredBy}</p>
        </Modal>
      ) : null}
    </>
  );
}
