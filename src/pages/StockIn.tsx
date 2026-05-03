import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { Field, buttonClass, inputClass, secondaryButtonClass } from '../components/Form';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/Page';
import { useToast } from '../components/Toast';
import { loadProducts } from '../lib/data';
import { supabase } from '../lib/supabase';
import { isSupabaseConfigured } from '../lib/supabase';
import { adjustLocalStock } from '../lib/localStore';
import { useLanguage } from '../lib/language';
import type { ProductWithStock, SettingsMap } from '../lib/types';

type StockInLine = {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unit: 'can' | 'carton';
  cartonSize: number;
  cans: number;
  costPerUnit: number | null;
};

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
  const { text } = useLanguage();
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
  const [lines, setLines] = useState<StockInLine[]>([]);
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
  const totalBatchUnits = lines.reduce((sum, line) => sum + line.cans, 0);

  function addLine(event?: FormEvent) {
    event?.preventDefault();
    const parsed = stockInSchema.safeParse({ productId, quantity, unit, cost });
    if (!parsed.success) {
      toast.error(text('Choose a product and enter a positive quantity.', 'Pilih produk dan masukkan kuantiti yang betul.'));
      return;
    }
    if (!product) {
      toast.error(text('Choose a product.', 'Pilih produk.'));
      return;
    }
    const costPerUnit = cost === '' ? null : Number(cost);
    const nextCans = quantity * (unit === 'carton' ? product.carton_size : 1);
    setLines((current) => {
      const sameIndex = current.findIndex(
        (line) => line.productId === product.id && line.unit === unit && line.costPerUnit === costPerUnit,
      );
      if (sameIndex === -1) {
        return [
          ...current,
          {
            id: crypto.randomUUID(),
            productId: product.id,
            productName: product.name,
            quantity,
            unit,
            cartonSize: product.carton_size,
            cans: nextCans,
            costPerUnit,
          },
        ];
      }
      return current.map((line, index) =>
        index === sameIndex
          ? {
              ...line,
              quantity: line.quantity + quantity,
              cans: line.cans + nextCans,
              costPerUnit,
            }
          : line,
      );
    });
    setQuantity(1);
    setCost('');
    toast.success(`${product.name} ${text('added to stock-in list.', 'ditambah ke senarai stok masuk.')}`);
  }

  function reviewBatch() {
    if (lines.length === 0) {
      toast.error(text('Add at least one product to the stock-in list.', 'Tambah sekurang-kurangnya satu produk ke senarai stok masuk.'));
      return;
    }
    setConfirming(true);
  }

  async function confirm() {
    if (lines.length === 0) return;
    setSaving(true);
    if (!isSupabaseConfigured) {
      lines.forEach((line) => adjustLocalStock(line.productId, line.cans));
      setSaving(false);
      setConfirming(false);
      await refresh();
      setLines([]);
      toast.success(`${text('Stock updated by', 'Stok dikemas kini oleh')} ${enteredBy}: ${totalBatchUnits} ${text('unit(s) added.', 'unit ditambah.')}`);
      return;
    }
    const entries = lines.map((line) => ({
      product_id: line.productId,
      quantity: line.quantity,
      unit: line.unit,
      cost_per_unit: line.costPerUnit,
      supplier: supplier || null,
      reference: reference || null,
      notes: notes || null,
      entered_by: enteredBy,
    }));
    const { data, error } = await supabase.rpc('stock_in_products', { p_entries: entries });
    setSaving(false);
    if (error) {
      if (!error.message.toLowerCase().includes('stock_in_products')) {
        toast.error(error.message);
        return;
      }
      for (const entry of entries) {
        const fallback = await supabase.rpc('stock_in_product', {
          p_product_id: entry.product_id,
          p_quantity: entry.quantity,
          p_unit: entry.unit,
          p_cost_per_unit: entry.cost_per_unit,
          p_supplier: entry.supplier,
          p_reference: entry.reference,
          p_notes: entry.notes,
          p_entered_by: entry.entered_by,
        });
        if (fallback.error) {
          toast.error(fallback.error.message);
          return;
        }
      }
    } else if (!data) {
      toast.error(text('Stock-in did not return updated balances.', 'Stok masuk tidak mengembalikan baki terkini.'));
      return;
    }
    setConfirming(false);
    await refresh();
    setLines([]);
    toast.success(`${text('Stock updated by', 'Stok dikemas kini oleh')} ${enteredBy}: ${totalBatchUnits} ${text('unit(s) added.', 'unit ditambah.')}`);
  }

  return (
    <>
      {embedded ? null : <PageHeader title={text('Stock In', 'Stok Masuk')} />}
      <form onSubmit={addLine} className="island-panel grid gap-4 rounded-2xl p-3 shadow-soft sm:rounded-[2rem] sm:p-5">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-2xl border border-line bg-white/75 p-2">
          <p className="text-xs font-black leading-tight sm:text-sm">{text('Entered by', 'Diisi oleh')}</p>
          <div className="grid min-w-0 grid-cols-4 gap-1.5">
            {workers.map((worker) => (
              <button
                key={worker}
                type="button"
                onClick={() => setEnteredBy(worker)}
                className={`min-w-0 truncate rounded-xl border px-1.5 py-2 text-xs font-black shadow-soft sm:px-3 sm:text-sm ${
                  enteredBy === worker ? 'border-accent bg-accent text-white' : 'border-line bg-white text-ink'
                }`}
              >
                {worker}
              </button>
            ))}
          </div>
        </div>
        <Field label={text('Product', 'Produk')}>
          <select className={inputClass} value={productId} onChange={(e) => setProductId(e.target.value)}>
            {products.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.categories?.name === 'Other' ? 'Others' : item.categories?.name ?? 'Others'})
              </option>
            ))}
          </select>
        </Field>
        <div className="grid gap-3 md:grid-cols-[minmax(150px,0.72fr)_1.8fr] md:items-end">
          <Field label={text('Quantity', 'Kuantiti')}>
            <input className={inputClass} type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
          </Field>
          <div>
            <p className="mb-2 text-sm font-semibold">{text('Unit type', 'Jenis unit')}</p>
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              {(['can', 'carton'] as const).map((nextUnit) => (
                <button
                  key={nextUnit}
                  type="button"
                  onClick={() => setUnit(nextUnit)}
                  className={`flex h-11 flex-col items-center justify-center rounded-xl border px-3 py-0 text-sm font-black leading-tight shadow-soft transition sm:h-[52px] sm:rounded-2xl sm:px-4 sm:text-base ${
                    unit === nextUnit ? 'border-accent bg-teal-50 text-accent ring-2 ring-teal-100' : 'border-line bg-white text-ink'
                  }`}
                >
                  <span className="block">{nextUnit === 'can' ? 'UNIT(S)' : 'CARTON(S)'}</span>
                  {nextUnit === 'carton' ? (
                    <span className="block text-[10px] font-black leading-tight text-neutral-600 sm:text-[11px]">
                      {text('1 carton =', '1 karton =')} {defaultCartonUnits} {text('units', 'unit')}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={text('Supplier', 'Pembekal')}>
            <input className={inputClass} value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </Field>
          <Field label={text('Invoice or reference', 'Invois atau rujukan')}>
            <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label={`${text('Cost per unit', 'Kos seunit')} (${String(settings.currency_symbol)})`}>
            <input className={inputClass} type="number" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
          </Field>
          <Field label={text('Notes', 'Nota')}>
            <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="submit" className={`${secondaryButtonClass} justify-center`}>
            <Plus className="h-4 w-4" />
            {text('Add to stock-in list', 'Tambah ke senarai stok masuk')}
          </button>
          <button type="button" className={`${buttonClass} justify-center`} disabled={lines.length === 0} onClick={reviewBatch}>
            {text('Review', 'Semak')} {lines.length} {text(lines.length === 1 ? 'item' : 'items', 'item')}
          </button>
        </div>
      </form>
      <section className="island-panel mt-4 rounded-2xl p-3 shadow-soft sm:rounded-[2rem] sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-black">{text('Stock-in list', 'Senarai stok masuk')}</h2>
          </div>
          <p className="rounded-xl bg-teal-50 px-3 py-2 text-sm font-black text-accent">{totalBatchUnits} unit(s)</p>
        </div>
        {lines.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-line bg-white/80 p-3 text-sm font-bold text-neutral-600">
            {text('No products added yet.', 'Belum ada produk ditambah.')}
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead className="text-sm">
                <tr>
                  <th className="p-3">{text('Product', 'Produk')}</th>
                  <th className="p-3">{text('Quantity', 'Kuantiti')}</th>
                  <th className="p-3">{text('Unit type', 'Jenis unit')}</th>
                  <th className="p-3">{text('Units added', 'Unit ditambah')}</th>
                  <th className="p-3">{text('Cost', 'Kos')}</th>
                  <th className="p-3">{text('Action', 'Tindakan')}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id} className="border-t border-line">
                    <td className="p-3 font-black">{line.productName}</td>
                    <td className="p-3">{line.quantity}</td>
                    <td className="p-3">{line.unit === 'can' ? 'UNIT(S)' : `CARTON(S) - ${text('1 carton =', '1 karton =')} ${line.cartonSize} ${text('units', 'unit')}`}</td>
                    <td className="p-3 font-black">{line.cans}</td>
                    <td className="p-3">{line.costPerUnit == null ? '-' : `${String(settings.currency_symbol)} ${line.costPerUnit.toFixed(2)}`}</td>
                    <td className="p-3">
                      <button
                        type="button"
                        className={`${secondaryButtonClass} min-h-9 rounded-xl px-3 py-1.5 text-xs`}
                        onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))}
                      >
                        <Trash2 className="h-4 w-4" />
                        {text('Remove', 'Buang')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {confirming ? (
        <Modal
          title={text('Confirm Stock-In Batch', 'Sahkan stok masuk berkumpulan')}
          onClose={() => setConfirming(false)}
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <button className={secondaryButtonClass} onClick={() => setConfirming(false)}>{text('Cancel', 'Batal')}</button>
              <button className={buttonClass} disabled={saving} onClick={confirm}>
                {saving ? text('Saving...', 'Menyimpan...') : `${text('Yes, confirm', 'Ya, sahkan')} ${lines.length} ${text(lines.length === 1 ? 'item' : 'items', 'item')}`}
              </button>
            </div>
          }
        >
          <p className="text-xl font-black leading-tight sm:text-2xl">{text('Confirm Stock-In', 'Sahkan Stok Masuk')}: {totalBatchUnits} {text('unit(s)', 'unit')}?</p>
          <div className="mt-3 max-h-[45vh] overflow-auto rounded-2xl border border-line bg-white/80">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-shell">
                <tr>
                  <th className="p-3">{text('Product', 'Produk')}</th>
                  <th className="p-3">{text('Input', 'Input')}</th>
                  <th className="p-3">{text('Units added', 'Unit ditambah')}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id} className="border-t border-line">
                    <td className="p-3 font-black">{line.productName}</td>
                    <td className="p-3">{line.quantity} {line.unit === 'can' ? 'UNIT(S)' : `CARTON(S) x ${line.cartonSize}`}</td>
                    <td className="p-3 font-black">{line.cans}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 rounded-2xl bg-shell p-3 text-sm font-black">{text('Entered by', 'Diisi oleh')}: {enteredBy}</p>
        </Modal>
      ) : null}
    </>
  );
}
