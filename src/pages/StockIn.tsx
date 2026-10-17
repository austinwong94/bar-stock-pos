import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { AlertTriangle, CheckCircle2, Search, X } from 'lucide-react';
import { Field, buttonClass, dangerButtonClass, inputClass, secondaryButtonClass } from '../components/Form';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/Page';
import { useToast } from '../components/Toast';
import { loadProducts, normalizeCategoryName } from '../lib/data';
import { supabase } from '../lib/supabase';
import { isSupabaseConfigured } from '../lib/supabase';
import { adjustLocalStock, cancelLocalStockInDraft, confirmLocalStockInDraft, createLocalStockInDraft, loadLocalStockInDrafts, recordLocalStockMovement } from '../lib/localStore';
import { useLanguage } from '../lib/language';
import type { ProductWithStock, SettingsMap, StockInDraftEntry, StockInDraftRecord } from '../lib/types';
import { useSharedRefresh } from '../lib/useSharedRefresh';
import { useAccess } from '../lib/access';
import { definitiveInitialSaveFailure } from '../lib/saveAttempt';
import { readAllRows } from '../lib/readAllRows';
import { barStockEntryIssue, barStockQuantity, changeBarStockUnit, type BarStockEntry } from '../lib/barStockEntry';

type DraftAttempt={version:1;attempted:boolean;payload:{p_entries:StockInDraftEntry[];p_entered_by:string;p_supplier:string|null;p_reference:string|null;p_notes:string|null;p_request_id:string}};

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

type StockInDraft = BarStockEntry;

const defaultDraft: StockInDraft = {
  quantity: '',
  unit: 'can',
  cost: '',
};

const stockInCategoryOrder = ['Food', 'Beer', 'Soft Drink', 'Cocktail', 'Others'];

function stockInCategoryRank(name: string | null | undefined) {
  const normalized = normalizeCategoryName(name);
  const index = stockInCategoryOrder.indexOf(normalized);
  return index === -1 ? stockInCategoryOrder.length : index;
}

function compactLineInputLabel(line: StockInLine, text: (english: string, malay: string) => string) {
  if (line.unit === 'can') return `${line.quantity} ${text('units', 'unit')}`;
  return `${line.quantity} ${text('cartons', 'karton')} x ${line.cartonSize}`;
}

function itemCountLabel(count: number, text: (english: string, malay: string) => string) {
  return `${count} ${count === 1 ? text('Item', 'Item') : text('Items', 'Item')}`;
}

function staffNames(settings: SettingsMap) {
  return String(settings.staff_names || 'Chloe, Happy, Elle, NekoMiao')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

function categoryName(product: ProductWithStock) {
  return normalizeCategoryName(product.categories?.name);
}

function draftQuantity(draft: StockInDraft | undefined) {
  return barStockQuantity(draft?.quantity ?? '');
}

function lineToDraftEntry(line: StockInLine): StockInDraftEntry {
  return {
    product_id: line.productId,
    product_name: line.productName,
    quantity: line.quantity,
    unit: line.unit,
    carton_size: line.cartonSize,
    cans: line.cans,
    cost_per_unit: line.costPerUnit,
  };
}

function draftEntryToLine(entry: StockInDraftEntry): StockInLine {
  return {
    id: entry.product_id,
    productId: entry.product_id,
    productName: entry.product_name,
    quantity: Number(entry.quantity || 0),
    unit: entry.unit,
    cartonSize: Number(entry.carton_size || 1),
    cans: Number(entry.cans || 0),
    costPerUnit: entry.cost_per_unit == null ? null : Number(entry.cost_per_unit),
  };
}

function stockInDraftStatusLabel(status: StockInDraftRecord['status'], text: (english: string, malay: string) => string) {
  if (status === 'confirmed') return text('Confirmed - Stock Added', 'Disahkan - Stok Ditambah');
  if (status === 'cancelled') return text('Cancelled', 'Dibatalkan');
  return text('Draft Only - Stock Not Added', 'Draf Sahaja - Stok Belum Ditambah');
}

function stockInDraftStatusClass(status: StockInDraftRecord['status']) {
  if (status === 'confirmed') return 'bg-shell text-accent';
  if (status === 'cancelled') return 'bg-red-50 text-danger';
  return 'bg-amber-50 text-amber-700';
}

function shortTimestamp(value: string) {
  return new Intl.DateTimeFormat('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function hasCartonChoice(cartonSize: number) {
  return Number(cartonSize) > 1;
}

export default function StockIn({ settings, embedded = false, onSaved }: { settings: SettingsMap; embedded?: boolean; onSaved?: () => void | Promise<void> }) {
  const {profile}=useAccess();
  const attemptKey='lovely_paradise_bar_stock_draft:'+profile?.id;
  const [restored]=useState(()=>{try{const raw=localStorage.getItem(attemptKey);if(!raw)return {attempt:null,error:''};const a=JSON.parse(raw) as DraftAttempt;if(a.version!==1||!a.payload?.p_request_id||!Array.isArray(a.payload.p_entries))throw Error('Pending stock-in could not be read. Ask a manager to check this device.');return {attempt:a,error:''};}catch(e){return {attempt:null,error:(e as Error).message};}});
  const [pendingAttempt,setPendingAttempt]=useState<DraftAttempt|null>(restored.attempt);
  const draftBusy=useRef(false);
  const toast = useToast();
  const { text } = useLanguage();
  const workers = useMemo(() => staffNames(settings), [settings]);
  const [products, setProducts] = useState<ProductWithStock[]>([]);
  const [stockInDrafts, setStockInDrafts] = useState<StockInDraftRecord[]>([]);
  const [activeDraft, setActiveDraft] = useState<StockInDraftRecord | null>(null);
  const [draftRows, setDraftRows] = useState<Record<string, StockInDraft>>({});
  const [supplier, setSupplier] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [enteredBy, setEnteredBy] = useState(workers[0] ?? 'Chloe');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [confirming, setConfirming] = useState(false);
  const [cancelDraft, setCancelDraft] = useState<StockInDraftRecord | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [savingDraft, setSavingDraft] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const readGeneration = useRef(0);

  async function refresh() {
    const generation = ++readGeneration.current;
    setLoading(true);
    try {
    const loaded = await loadProducts(false);
    const drafts = !isSupabaseConfigured ? loadLocalStockInDrafts() : await readAllRows<StockInDraftRecord>((from, to) => supabase.from('stock_in_drafts').select('*').order('created_at', { ascending: false }).order('id').range(from, to));
    if (generation !== readGeneration.current) return;
    setProducts(
      [...loaded].sort(
        (a, b) =>
          stockInCategoryRank(a.categories?.name) - stockInCategoryRank(b.categories?.name) ||
          a.name.localeCompare(b.name),
      ),
    );
    setStockInDrafts(drafts);
    setLoadError('');
    } catch (failure) {
      if (generation === readGeneration.current) setLoadError((failure as Error).message || text('Stock could not be loaded. Retry before recording.', 'Stok tidak dapat dimuatkan. Cuba lagi sebelum merekod.'));
    } finally {
      if (generation === readGeneration.current) setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useSharedRefresh(refresh, {
    tables: ['products', 'inventory_balances', 'categories', 'stock_movements', 'stock_in_drafts'],
    intervalMs: 15000,
  });

  useEffect(() => {
    if (workers.length > 0 && !workers.includes(enteredBy)) {
      setEnteredBy(workers[0]);
    }
  }, [enteredBy, workers]);

  const categories = useMemo(() => {
    const seen = new Set<string>();
    return products
      .map(categoryName)
      .filter((name) => {
        if (seen.has(name)) return false;
        seen.add(name);
        return true;
      })
      .sort((a, b) => stockInCategoryRank(a) - stockInCategoryRank(b) || a.localeCompare(b));
  }, [products]);

  const lines = useMemo<StockInLine[]>(() => {
    return products.flatMap((product) => {
      const draft = draftRows[product.id];
      const quantity = draftQuantity(draft);
      if (!draft || quantity <= 0 || barStockEntryIssue(draft, product.carton_size || Number(settings.default_carton_size || 24))) return [];
      const unit = draft.unit;
      const cartonSize = product.carton_size || Number(settings.default_carton_size || 24);
      const costPerUnit = draft.cost.trim() === '' ? null : Number(draft.cost);
      if (costPerUnit !== null && (!Number.isFinite(costPerUnit) || costPerUnit < 0)) return [];
      return [
        {
          id: product.id,
          productId: product.id,
          productName: product.name,
          quantity,
          unit,
          cartonSize,
          cans: quantity * (unit === 'carton' ? cartonSize : 1),
          costPerUnit,
        },
      ];
    });
  }, [draftRows, products, settings.default_carton_size]);

  const selectedProductIds = new Set(Object.keys(draftRows).filter(id => draftRows[id].quantity.trim() || draftRows[id].cost.trim()));
  const unavailableIds = [...selectedProductIds].filter(id => !products.some(product => product.id === id));
  const invalidProducts = products.filter(product => !!barStockEntryIssue(draftRows[product.id] ?? defaultDraft, product.carton_size || Number(settings.default_carton_size || 24)));
  const issueCount = invalidProducts.length + unavailableIds.length;
  function entryError(product: ProductWithStock) {
    const problem = barStockEntryIssue(draftRows[product.id] ?? defaultDraft, product.carton_size || Number(settings.default_carton_size || 24));
    return problem === 'quantity' ? text('Enter a positive whole number.', 'Isi nombor bulat melebihi 0.') : problem === 'carton' ? text('Carton size changed. Clear and re-enter the quantity.', 'Saiz karton berubah. Kosongkan dan isi semula kuantiti.') : problem === 'cost' ? text('Enter a valid cost with up to 2 decimal places.', 'Isi kos sah dengan maksimum 2 tempat perpuluhan.') : '';
  }
  const totalBatchUnits = lines.reduce((sum, line) => sum + line.cans, 0);
  const pendingDrafts = useMemo(() => stockInDrafts.filter((draft) => draft.status === 'draft'), [stockInDrafts]);
  const defaultCartonUnits = Number(settings.default_carton_size || 24);
  const confirmationLines = useMemo(() => (activeDraft ? activeDraft.entries.map(draftEntryToLine) : lines), [activeDraft, lines]);
  const confirmationTotalUnits = activeDraft?.total_units ?? totalBatchUnits;
  const confirmationEnteredBy = activeDraft?.entered_by ?? enteredBy;
  const confirmationSupplier = activeDraft?.supplier ?? supplier;
  const confirmationReference = activeDraft?.reference ?? reference;
  const confirmationNotes = activeDraft?.notes ?? notes;

  const visibleProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((product) => {
      const matchesSearch = !query || product.name.toLowerCase().includes(query) || categoryName(product).toLowerCase().includes(query);
      const matchesFilter =
        filter === 'all' ||
        (filter === 'entered' && selectedProductIds.has(product.id)) ||
        categoryName(product) === filter;
      return matchesSearch && matchesFilter;
    });
  }, [filter, products, search, selectedProductIds]);
  const filterOptions = useMemo(
    () => [
      { value: 'all', label: text('All', 'Semua') },
      { value: 'entered', label: text('Entered', 'Diisi') },
      ...categories.map((category) => ({ value: category, label: category })),
    ],
    [categories, text],
  );

  function draftFor(productId: string) {
    return draftRows[productId] ?? defaultDraft;
  }

  function updateDraft(productId: string, patch: Partial<StockInDraft>) {
    if (draftBusy.current || pendingAttempt || saving) return;
    setDraftRows((current) => {
      const previous = current[productId] ?? defaultDraft;
      const next = { ...previous, ...patch };
      if (patch.quantity !== undefined && !previous.quantity.trim() && patch.quantity.trim()) {
        const product = products.find(p => p.id === productId);
        next.cartonSize = product?.carton_size || defaultCartonUnits; next.name = product?.name;
      }
      if (next.quantity === '' && next.cost === '' && next.unit === 'can') {
        const { [productId]: _unused, ...rest } = current;
        return rest;
      }
      return { ...current, [productId]: next };
    });
  }

  function changeUnit(productId: string, unit: StockInDraft['unit']) {
    updateDraft(productId, changeBarStockUnit(draftFor(productId), unit));
  }

  function clearRow(productId: string) {
    if (draftBusy.current || pendingAttempt || saving) return;
    setDraftRows((current) => {
      const { [productId]: _unused, ...rest } = current;
      return rest;
    });
  }

  async function openStockInConfirmation() {
    if(draftBusy.current||pendingAttempt||restored.error||loading||loadError)return;
    if (unavailableIds.length) {
      document.querySelector<HTMLButtonElement>('[data-unavailable-bar-entry]')?.focus();
      document.querySelector('[data-unavailable-bar-entry]')?.scrollIntoView({ block: 'center' });
      return;
    }
    if (invalidProducts.length) {
      const product = invalidProducts[0], issue = barStockEntryIssue(draftFor(product.id), product.carton_size || defaultCartonUnits);
      flushSync(() => { setSearch(''); setFilter('all'); });
      const control = [...document.querySelectorAll<HTMLInputElement>('input[data-bar-stock-product]')].find(el => el.dataset.barStockProduct === product.id && el.dataset.barStockField === (issue === 'cost' ? 'cost' : 'quantity') && el.getClientRects().length);
      control?.focus(); control?.select(); control?.scrollIntoView({ block: 'center' });
      return;
    }
    if (lines.length === 0) {
      toast.error(text('Enter quantity for at least one product.', 'Masukkan kuantiti untuk sekurang-kurangnya satu produk.'));
      return;
    }
    if (savingDraft) return;
    const entries = lines.map(lineToDraftEntry);
    setSavingDraft(true);
    if (!isSupabaseConfigured) {
      const draft = createLocalStockInDraft({
        entries,
        enteredBy,
        supplier: supplier.trim() || null,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
      });
      setActiveDraft(draft);
      setStockInDrafts(loadLocalStockInDrafts().slice(0, 10));
      setDraftRows({});
      setSupplier('');
      setReference('');
      setNotes('');
      setSavingDraft(false);
      setConfirming(true);
      toast.success(text('Draft saved. Final confirmation is still required.', 'Draf disimpan. Pengesahan akhir masih diperlukan.'));
      return;
    }
    await resolveDraft({version:1,attempted:false,payload:{p_entries:entries,p_entered_by:enteredBy,p_supplier:supplier.trim()||null,p_reference:reference.trim()||null,p_notes:notes.trim()||null,p_request_id:crypto.randomUUID()}});
  }

  async function resolveDraft(attempt:DraftAttempt) {
    if(draftBusy.current)return;draftBusy.current=true;setSavingDraft(true);
    let submitted=false;
    try{
      const retained={...attempt,attempted:true},old=localStorage.getItem(attemptKey);
      if(old&&JSON.stringify(JSON.parse(old).payload)!==JSON.stringify(attempt.payload))throw Error('Check the original pending stock-in first.');
      const encoded=JSON.stringify(retained);localStorage.setItem(attemptKey,encoded);
      if(localStorage.getItem(attemptKey)!==encoded)throw Error('Pending stock-in could not be retained.');
      setPendingAttempt(retained);submitted=true;
      const {data,error}=await supabase.rpc('create_stock_in_draft_checked',attempt.payload);if(error)throw error;
      if(!data?.id)throw Error('Draft confirmation is pending. Check the same draft.');
      localStorage.removeItem(attemptKey);setPendingAttempt(null);
    setActiveDraft(data as StockInDraftRecord);
    setDraftRows({});
    setSupplier('');
    setReference('');
    setNotes('');
    await refresh();
    setConfirming(true);
    toast.success(text('Draft saved. Final confirmation is still required.', 'Draf disimpan. Pengesahan akhir masih diperlukan.'));
    }catch(e){
      if(submitted&&definitiveInitialSaveFailure(attempt.attempted,e)){localStorage.removeItem(attemptKey);setPendingAttempt(null);}
      toast.error((e as Error).message||text('Check the pending stock-in.','Semak stok masuk tertunda.'));
    }finally{draftBusy.current=false;setSavingDraft(false);}
  }

  async function confirm() {
    if (!activeDraft && lines.length === 0) return;
    if (saving) return;
    setSaving(true);
    if (!isSupabaseConfigured) {
      const draftToConfirm = activeDraft;
      if (!draftToConfirm) {
        setSaving(false);
        toast.error(text('Save a draft before confirming.', 'Simpan draf sebelum mengesahkan.'));
        return;
      }
      draftToConfirm.entries.map(draftEntryToLine).forEach((line) => {
        const adjustment = adjustLocalStock(line.productId, line.cans);
        if (!adjustment) return;
        recordLocalStockMovement({
          product_id: line.productId,
          movement_type: 'stock_in',
          quantity_change: line.cans,
          quantity_before: adjustment.quantityBefore,
          quantity_after: adjustment.quantityAfter,
          unit_input: line.unit,
          input_quantity: line.quantity,
          carton_size_at_time: line.cartonSize,
          reference_type: 'stock_in_draft',
          reference_id: draftToConfirm.id,
          reason: [draftToConfirm.supplier, draftToConfirm.reference, draftToConfirm.draft_number].filter(Boolean).join(' / ') || null,
          notes: draftToConfirm.notes || null,
          entered_by: draftToConfirm.entered_by,
          created_by: null,
          products: { name: line.productName },
        });
      });
      confirmLocalStockInDraft(draftToConfirm.id);
      setSaving(false);
      setConfirming(false);
      setActiveDraft(null);
      setDraftRows({});
      setSupplier('');
      setReference('');
      setNotes('');
      await refresh();
      await onSaved?.();
      toast.success(`${text('Stock Updated By', 'Stok Dikemas Kini Oleh')} ${draftToConfirm.entered_by}: ${draftToConfirm.total_units} ${text('Units Added.', 'Unit Ditambah.')}`);
      return;
    }
    if (!activeDraft) {
      setSaving(false);
      toast.error(text('Save a draft before confirming.', 'Simpan draf sebelum mengesahkan.'));
      return;
    }
    const { data, error } = await supabase.rpc('confirm_stock_in_draft', { p_draft_id: activeDraft.id });
    setSaving(false);
    if (error) {
      if (error.message.toLowerCase().includes('confirm_stock_in_draft')) {
        toast.error(text('Cloud Stock In confirmation needs the latest Supabase migration.', 'Pengesahan Stok Masuk cloud perlukan migrasi Supabase terkini.'));
        return;
      }
      toast.error(error.message);
      return;
    } else if (!data) {
      toast.error(text('Stock In did not return updated balances.', 'Stok Masuk tidak mengembalikan baki terkini.'));
      return;
    }
    setConfirming(false);
    setActiveDraft(null);
    setDraftRows({});
    setSupplier('');
    setReference('');
    setNotes('');
    await refresh();
    await onSaved?.();
    toast.success(`${text('Stock Updated By', 'Stok Dikemas Kini Oleh')} ${confirmationEnteredBy}: ${confirmationTotalUnits} ${text('Units Added.', 'Unit Ditambah.')}`);
  }

  async function cancelDraftRecord() {
    if (!cancelDraft || saving) return;
    const reason = cancelReason.trim();
    if (!reason) {
      toast.error(text('Enter a reason before cancelling the draft.', 'Masukkan sebab sebelum membatalkan draf.'));
      return;
    }
    setSaving(true);
    if (!isSupabaseConfigured) {
      cancelLocalStockInDraft(cancelDraft.id, reason);
      if (activeDraft?.id === cancelDraft.id) {
        setActiveDraft(null);
        setConfirming(false);
      }
      setSaving(false);
      setCancelDraft(null);
      setCancelReason('');
      setStockInDrafts(loadLocalStockInDrafts().slice(0, 10));
      toast.success(text('Draft cancelled. Stock was not changed.', 'Draf dibatalkan. Stok tidak berubah.'));
      return;
    }

    const { error } = await supabase.rpc('cancel_stock_in_draft', {
      p_draft_id: cancelDraft.id,
      p_reason: reason,
    });
    setSaving(false);
    if (error) {
      if (error.message.toLowerCase().includes('cancel_stock_in_draft')) {
        toast.error(text('Cloud Stock In cancellation needs the latest Supabase migration.', 'Pembatalan Stok Masuk cloud perlukan migrasi Supabase terkini.'));
        return;
      }
      toast.error(error.message);
      return;
    }
    if (activeDraft?.id === cancelDraft.id) {
      setActiveDraft(null);
      setConfirming(false);
    }
    setCancelDraft(null);
    setCancelReason('');
    await refresh();
    toast.success(text('Draft cancelled. Stock was not changed.', 'Draf dibatalkan. Stok tidak berubah.'));
  }

  function unitButtonClass(active: boolean) {
    return `ui-control min-h-11 rounded-lg border px-2 py-1 text-xs font-semibold leading-tight transition ${
      active ? 'border-accent bg-shell text-accent ring-2 ring-accent/10' : 'border-line bg-white text-ink hover:border-accent'
    }`;
  }

  return (
    <>
      {embedded ? null : <PageHeader title={text('Stock In', 'Stok Masuk')} />}
      {restored.error?<p role="alert" className="mb-3 text-sm text-danger">{restored.error}</p>:null}
      {loadError ? <div role="alert" className="mb-3 grid gap-2 text-sm text-danger">{loadError}<button className={secondaryButtonClass} onClick={() => void refresh()}>{text('Retry', 'Cuba Lagi')}</button></div> : null}
      {loading ? <p role="status" className="mb-3 text-sm text-muted">{text('Loading Stock...', 'Memuatkan Stok...')}</p> : null}
      {pendingAttempt?<div role="status" className="mb-3 border-y border-line py-3"><p className="mb-2 text-sm font-semibold">{text('Stock-in Confirmation Pending','Pengesahan Stok Masuk Belum Diterima')}</p><button className={secondaryButtonClass} disabled={savingDraft} onClick={()=>void resolveDraft(pendingAttempt)}>{text('Check Saved Draft','Semak Draf Disimpan')}</button></div>:null}
      {unavailableIds.map(id => <div key={id} role="alert" className="my-3 grid gap-2 border-y border-line py-3 text-sm"><strong>{draftRows[id].name ?? text('Unavailable Product', 'Produk Tidak Tersedia')}</strong><span>{draftRows[id].quantity} {draftRows[id].unit === 'carton' ? text('cartons', 'karton') : text('units', 'unit')} · {text('No longer active. Remove this unfinished entry before reviewing.', 'Tidak lagi aktif. Buang catatan belum siap ini sebelum menyemak.')}</span><button data-unavailable-bar-entry={id} className={secondaryButtonClass} disabled={savingDraft || saving || !!pendingAttempt} onClick={() => clearRow(id)}>{text('Remove Entry', 'Buang Catatan')}</button></div>)}
      <section className="stock-in-workspace island-panel grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5 rounded-lg p-2.5 shadow-none sm:gap-3 sm:rounded-xl sm:p-4">
        <div className="bar-staff">
          <p className="text-xs font-semibold leading-tight sm:text-sm">{text('Staff', 'Staff')}</p>
          <div role="group" aria-label={text('Entered By', 'Diisi Oleh')}>
            {workers.map((worker) => (
              <button
                key={worker}
                type="button"
                onClick={() => setEnteredBy(worker)}
                aria-pressed={enteredBy === worker}
              >
                {worker}
              </button>
            ))}
          </div>
        </div>

        {activeDraft?.status === 'draft' ? (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2 sm:rounded-lg sm:p-3">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold leading-tight text-amber-800 sm:text-sm">
                {activeDraft.draft_number}
              </p>
              <span className={`mt-1 inline-flex rounded-lg px-2 py-1 text-xs font-semibold sm:text-xs ${stockInDraftStatusClass(activeDraft.status)}`}>
                {stockInDraftStatusLabel(activeDraft.status, text)}
              </span>
              <p className="mt-0.5 hidden text-xs font-bold text-amber-700 sm:block">
                {text('Stock is still unchanged until final confirmation.', 'Stok belum berubah sehingga pengesahan akhir.')}
              </p>
            </div>
            <button type="button" className={`${buttonClass} min-h-9 justify-center px-3 py-2 text-xs`} onClick={() => setConfirming(true)}>
              {text('Confirm Draft', 'Sahkan Draf')}
            </button>
          </div>
        ) : null}

        {!activeDraft && pendingDrafts.length > 0 ? (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:rounded-lg sm:p-3">
            <AlertTriangle className="hidden h-5 w-5 text-amber-700 sm:block" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-amber-800">
                {pendingDrafts.length} {pendingDrafts.length === 1 ? text('Draft Waiting', 'Draf Menunggu') : text('Drafts Waiting', 'Draf Menunggu')}
              </p>
              <p className="mt-0.5 text-xs font-bold text-amber-700 sm:text-xs">
                <span className="sm:hidden">{text('Stock not added yet.', 'Stok belum ditambah.')}</span>
                <span className="hidden sm:inline">{text('Not added yet. Confirm to update stock.', 'Belum ditambah. Sahkan untuk kemas kini stok.')}</span>
              </p>
            </div>
            <button
              type="button"
              className={`${secondaryButtonClass} min-h-9 justify-center px-3 py-2 text-xs`}
              onClick={() => {
                setActiveDraft(pendingDrafts[0]);
                setConfirming(true);
              }}
            >
              {text('Confirm Latest', 'Sahkan Terkini')}
            </button>
          </div>
        ) : null}

        <div className="grid gap-3 bar-stock-entry-head">
          <div className="bar-stock-entry-summary">
            <h2>{text('Receive Stock', 'Terima Stok')}</h2>
            <span><strong>{lines.length}</strong> {text('selected', 'dipilih')} · <strong>{totalBatchUnits}</strong> {text('units', 'unit')}</span>
          </div>
          <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <label className="relative min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
              <input
                className={`${inputClass} pl-9`}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={text('Search product', 'Cari produk')}
              />
            </label>
            <div className="bar-stock-filters" role="group" aria-label={text('Product Filter', 'Tapis Produk')}>
              {filterOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFilter(option.value)}
                  aria-pressed={filter === option.value}
                  className={`min-h-8 min-w-0 truncate rounded-lg border px-1 py-1.5 sm:min-w-[5.5rem] sm:px-2 ${
                    filter === option.value ? 'border-accent bg-accent text-white' : 'border-line bg-white/90 text-ink'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <details className="rounded-xl border border-line bg-white/60 p-2 sm:rounded-lg sm:p-3">
            <summary className="cursor-pointer text-sm font-semibold text-ink">{text('Batch Details', 'Butiran Kelompok')}</summary>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
              <Field label={text('Supplier', 'Pembekal')}>
                <input className={inputClass} value={supplier} onChange={(event) => setSupplier(event.target.value)} />
              </Field>
              <Field label={text('Invoice / Reference', 'Invois / Rujukan')}>
                <input className={inputClass} value={reference} onChange={(event) => setReference(event.target.value)} />
              </Field>
              <div className="col-span-2 sm:col-span-2">
                <Field label={text('Notes', 'Nota')}>
                  <input className={inputClass} value={notes} onChange={(event) => setNotes(event.target.value)} />
                </Field>
              </div>
            </div>
          </details>
        </div>

        <div className="clean-scroll max-h-[58vh] overflow-auto rounded-lg border border-line bg-white/80">
          <div className="stock-in-compact-rows">
            {visibleProducts.map((product, index) => {
              const draft = draftFor(product.id);
              const quantity = draftQuantity(draft);
              const cartonSize = product.carton_size || defaultCartonUnits;
              const allowCarton = hasCartonChoice(cartonSize);
              const addedUnits = quantity * (draft.unit === 'carton' ? cartonSize : 1);
              const selected = quantity > 0 && !entryError(product);
              return (
                <article data-bar-stock-row={product.id} key={product.id} className={`border-t border-line p-1.5 first:border-t-0 ${selected ? 'bg-shell/70' : index % 2 ? 'bg-white/70' : 'bg-shell/35'}`}>
                  <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.4rem] items-start gap-1.5">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold leading-tight">{product.name}</p>
                      <p className="mt-0.5 break-words text-xs font-bold text-neutral-600">
                        {text('Balance', 'Baki')}: {product.inventory_balances?.quantity_on_hand ?? 0} {text('Units', 'Unit')}
                      </p>
                    </div>
                    <input
                      className="ui-control min-h-11 w-full rounded-lg border border-line bg-white px-2 text-center text-sm font-semibold outline-none focus:border-accent focus:ring-2 focus:ring-accent/10"
                      inputMode="numeric"
                      min={0}
                      placeholder={text('Qty', 'Kuantiti')}
                      aria-label={`${product.name} - ${text('Quantity', 'Kuantiti')}`}
                      type="text"
                      data-bar-stock-product={product.id}
                      data-bar-stock-field="quantity"
                      aria-invalid={!!entryError(product) && barStockEntryIssue(draft, cartonSize) !== 'cost'}
                      aria-describedby={entryError(product) ? 'bar-stock-error-mobile-' + product.id : undefined}
                      disabled={savingDraft || saving || !!pendingAttempt}
                      maxLength={60}
                      value={draft.quantity}
                      onChange={(event) => updateDraft(product.id, { quantity: event.target.value })}
                    />
                    <p className={`grid min-h-8 place-items-center rounded-lg px-1 text-center font-semibold leading-tight ${selected ? 'bg-teal-100 text-accent' : 'bg-shell text-neutral-500'}`}>
                      <span className="block text-xs">{text('Adds', 'Tambah')}</span>
                      <span className="block text-xs">{selected ? `+${addedUnits}` : '-'}</span>
                    </p>
                  </div>
                  <div className={`mt-1 grid gap-1 ${allowCarton ? 'grid-cols-[1fr_1fr_4.5rem_2.75rem]' : 'grid-cols-[minmax(0,2fr)_4.5rem_2.75rem]'}`}>
                    <button type="button" aria-pressed={draft.unit === 'can'} className={unitButtonClass(draft.unit === 'can')} disabled={savingDraft || saving || !!pendingAttempt} onClick={() => changeUnit(product.id, 'can')}>
                      {text('Units', 'Unit')}
                    </button>
                    {allowCarton ? (
                      <button type="button" aria-pressed={draft.unit === 'carton'} className={unitButtonClass(draft.unit === 'carton')} disabled={savingDraft || saving || !!pendingAttempt} onClick={() => changeUnit(product.id, 'carton')}>
                        {text('Cartons', 'Karton')} ({cartonSize})
                      </button>
                    ) : null}
                    <input
                      className="ui-control min-h-11 rounded-lg border border-line bg-white px-1.5 text-center text-xs font-bold outline-none placeholder:text-neutral-400 focus:border-accent focus:ring-2 focus:ring-accent/10"
                      inputMode="decimal"
                      placeholder="RM/unit"
                      aria-label={product.name + ' - ' + text('Cost per unit', 'Kos seunit') + ' (' + settings.currency_symbol + ')'}
                      title={text('Optional cost per individual unit', 'Kos pilihan bagi setiap unit individu') + ' (' + settings.currency_symbol + ')'}
                      type="text"
                      data-bar-stock-product={product.id}
                      data-bar-stock-field="cost"
                      aria-invalid={barStockEntryIssue(draft, cartonSize) === 'cost'}
                      aria-describedby={entryError(product) ? 'bar-stock-error-mobile-' + product.id : undefined}
                      disabled={savingDraft || saving || !!pendingAttempt}
                      maxLength={60}
                      value={draft.cost}
                      onChange={(event) => updateDraft(product.id, { cost: event.target.value })}
                    />
                    <button
                      type="button"
                      className="grid min-h-11 place-items-center rounded-lg border border-line bg-white text-ink disabled:opacity-35"
                      disabled={savingDraft || saving || !!pendingAttempt || (!draft.quantity && !draft.cost && draft.unit === 'can')}
                      onClick={() => clearRow(product.id)}
                      aria-label={text('Clear row', 'Kosongkan baris')}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  {entryError(product) ? <p id={'bar-stock-error-mobile-' + product.id} role="alert" className="mt-2 break-words text-xs text-danger">{entryError(product)}</p> : null}
                </article>
              );
            })}
          </div>

          <table className="stock-in-wide-table w-full min-w-[780px] text-left text-sm">
            <thead className="sticky top-0 z-10 bg-shell text-xs font-semibold text-ink">
              <tr>
                <th className="p-3">{text('Product', 'Produk')}</th>
                <th className="p-3">{text('On Hand', 'Baki')}</th>
                <th className="p-3">{text('Quantity', 'Kuantiti')}</th>
                <th className="p-3">{text('Unit', 'Unit')}</th>
                <th className="p-3">{text('Adds', 'Tambah')}</th>
                <th className="p-3">{text('Cost / Unit', 'Kos / Unit')}</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {visibleProducts.map((product, index) => {
                const draft = draftFor(product.id);
                const quantity = draftQuantity(draft);
                const cartonSize = product.carton_size || defaultCartonUnits;
                const allowCarton = hasCartonChoice(cartonSize);
                const addedUnits = quantity * (draft.unit === 'carton' ? cartonSize : 1);
                const selected = quantity > 0 && !entryError(product);
                return (
                  <tr data-bar-stock-row={product.id} key={product.id} className={`border-t border-line ${selected ? 'bg-shell/70' : index % 2 ? 'bg-white/70' : 'bg-shell/35'}`}>
                    <td className="max-w-[18rem] p-3">
                      <p className="break-words font-semibold">{product.name}</p>
                      {entryError(product) ? <p id={'bar-stock-error-wide-' + product.id} role="alert" className="mt-2 break-words text-xs text-danger">{entryError(product)}</p> : null}
                      <p className="mt-0.5 text-xs font-bold text-neutral-500">
                        {categoryName(product)}{allowCarton ? ` · 1 ${text('Carton', 'Karton')} = ${cartonSize} ${text('Units', 'Unit')}` : ''}
                      </p>
                    </td>
                    <td className="p-3 font-semibold whitespace-nowrap">{product.inventory_balances?.quantity_on_hand ?? 0} {text('Units', 'Unit')}</td>
                    <td className="p-3">
                      <input
                        className="ui-control min-h-11 w-24 rounded-lg border border-line bg-white px-3 text-center font-semibold outline-none focus:border-accent focus:ring-2 focus:ring-accent/10"
                        inputMode="numeric"
                        min={0}
                        placeholder={text('Qty', 'Kuantiti')}
                        aria-label={`${product.name} - ${text('Quantity', 'Kuantiti')}`}
                        type="text"
                        data-bar-stock-product={product.id}
                      data-bar-stock-field="quantity"
                      aria-invalid={!!entryError(product) && barStockEntryIssue(draft, cartonSize) !== 'cost'}
                      aria-describedby={entryError(product) ? 'bar-stock-error-wide-' + product.id : undefined}
                      disabled={savingDraft || saving || !!pendingAttempt}
                      maxLength={60}
                      value={draft.quantity}
                        onChange={(event) => updateDraft(product.id, { quantity: event.target.value })}
                      />
                    </td>
                    <td className="p-3">
                      <div className={`grid gap-1 ${allowCarton ? 'w-44 grid-cols-2' : 'w-28 grid-cols-1'}`}>
                        <button type="button" aria-pressed={draft.unit === 'can'} className={unitButtonClass(draft.unit === 'can')} disabled={savingDraft || saving || !!pendingAttempt} onClick={() => changeUnit(product.id, 'can')}>
                          {text('Units', 'Unit')}
                        </button>
                        {allowCarton ? (
                          <button type="button" aria-pressed={draft.unit === 'carton'} className={unitButtonClass(draft.unit === 'carton')} disabled={savingDraft || saving || !!pendingAttempt} onClick={() => changeUnit(product.id, 'carton')}>
                            {text('Cartons', 'Karton')}
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td className={`p-3 font-semibold whitespace-nowrap ${selected ? 'text-accent' : 'text-neutral-400'}`}>
                      {selected ? `+${addedUnits} ${text('Units', 'Unit')}` : '-'}
                    </td>
                    <td className="p-3">
                      <input
                        className="ui-control min-h-11 w-28 rounded-lg border border-line bg-white px-3 text-sm font-bold outline-none focus:border-accent focus:ring-2 focus:ring-accent/10"
                        inputMode="decimal"
                        placeholder={String(settings.currency_symbol)}
                        type="text"
                        data-bar-stock-product={product.id}
                      data-bar-stock-field="cost"
                      aria-invalid={barStockEntryIssue(draft, cartonSize) === 'cost'}
                      disabled={savingDraft || saving || !!pendingAttempt}
                      maxLength={60}
                      value={draft.cost}
                        onChange={(event) => updateDraft(product.id, { cost: event.target.value })}
                      />
                    </td>
                    <td className="p-3">
                      <button type="button" className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-white text-ink disabled:opacity-40" disabled={savingDraft || saving || !!pendingAttempt || (!draft.quantity && !draft.cost && draft.unit === 'can')} onClick={() => clearRow(product.id)} aria-label={text('Clear row', 'Kosongkan baris')}>
                        <X className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {visibleProducts.length === 0 ? (
            <p className="p-4 text-center text-sm font-bold text-neutral-600">{text('No products found.', 'Tiada produk dijumpai.')}</p>
          ) : null}
        </div>

        {selectedProductIds.size > 0 ? (
          <div className="bar-stock-entry-footer grid gap-2 border-t border-line bg-white py-2 sm:flex sm:items-center sm:justify-between">
            <p className="min-w-0 text-sm font-semibold text-accent">
              {itemCountLabel(selectedProductIds.size, text)} {text('Entered', 'Diisi')}{!issueCount ? ` · ${totalBatchUnits} ${text('Units', 'Unit')}` : ''}
            </p>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-2 sm:flex">
              <button type="button" className={`${secondaryButtonClass} justify-center`} disabled={savingDraft || saving} onClick={() => setFilter('entered')}>
                {text('View Entered', 'Lihat Diisi')}
              </button>
              <button type="button" className={`${buttonClass} justify-center`} disabled={savingDraft || saving || loading || !!loadError || !!pendingAttempt || !!restored.error} onClick={openStockInConfirmation}>
                <CheckCircle2 className="h-4 w-4" />
                {savingDraft ? text('Saving Draft...', 'Menyimpan Draf...') : issueCount ? text(`Check ${issueCount} ${issueCount === 1 ? 'Item' : 'Items'}`, `Semak ${issueCount} Item`) : text('Save & Review', 'Simpan & Semak')}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {stockInDrafts.length > 0 ? (
        <section className="island-panel mt-3 rounded-lg p-2.5 shadow-none sm:mt-4 sm:rounded-xl sm:p-4">
          <div className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <h2 className="text-base font-semibold sm:text-lg">{text('Submission Proof', 'Bukti Penghantaran')}</h2>
          </div>
          <div className="mt-2 overflow-hidden rounded-lg border border-line bg-white/80">
            <table className="w-full table-fixed text-left text-xs sm:text-sm">
              <thead className="bg-shell text-ink">
                <tr>
                  <th className="w-[43%] p-2 font-semibold sm:w-[24%] sm:p-3">{text('Record', 'Rekod')}</th>
                  <th className="w-[21%] p-2 font-semibold sm:w-[22%] sm:p-3">{text('Staff', 'Staff')}</th>
                  <th className="w-[18%] p-2 text-right font-semibold sm:w-[18%] sm:p-3">{text('Units', 'Unit')}</th>
                  <th className="hidden p-3 font-semibold sm:table-cell">{text('Status', 'Status')}</th>
                  <th className="w-[18%] p-2 text-right font-semibold sm:w-[14%] sm:p-3">{text('Action', 'Tindakan')}</th>
                </tr>
              </thead>
              <tbody>
                {stockInDrafts.map((draft) => (
                  <tr key={draft.id} className="border-t border-line align-middle">
                    <td className="min-w-0 p-2 sm:p-3">
                      <p className="break-all text-xs font-semibold leading-tight sm:text-sm">{draft.draft_number}</p>
                      <p className="truncate text-xs font-bold text-neutral-500 sm:text-xs">{shortTimestamp(draft.created_at)}</p>
                      <span className={`mt-1 inline-flex rounded-lg px-1.5 py-0.5 text-xs font-semibold sm:hidden ${stockInDraftStatusClass(draft.status)}`}>
                        {stockInDraftStatusLabel(draft.status, text)}
                      </span>
                    </td>
                    <td className="p-2 font-bold sm:p-3">{draft.entered_by || '-'}</td>
                    <td className="p-2 text-right font-semibold text-accent sm:p-3">+{draft.total_units}</td>
                    <td className="hidden p-3 sm:table-cell">
                      <span className={`inline-flex rounded-xl px-3 py-1 text-xs font-semibold ${stockInDraftStatusClass(draft.status)}`}>
                        {stockInDraftStatusLabel(draft.status, text)}
                      </span>
                    </td>
                    <td className="p-2 text-right sm:p-3">
                      {draft.status === 'draft' ? (
                        <div className="grid gap-1 sm:flex sm:justify-end">
                          <button
                            type="button"
                            className="rounded-lg border border-line bg-white px-2 py-1 text-xs font-semibold text-ink sm:rounded-xl sm:px-3 sm:py-1.5 sm:text-xs"
                            onClick={() => {
                              setActiveDraft(draft);
                              setConfirming(true);
                            }}
                          >
                            {text('Confirm', 'Sahkan')}
                          </button>
                          <button
                            type="button"
                            className="rounded-lg border border-red-100 bg-red-50 px-2 py-1 text-xs font-semibold text-danger sm:rounded-xl sm:px-3 sm:py-1.5 sm:text-xs"
                            onClick={() => {
                              setCancelDraft(draft);
                              setCancelReason('');
                            }}
                          >
                            {text('Cancel', 'Batal')}
                          </button>
                        </div>
                      ) : (
                        <span className="text-neutral-400">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {confirming ? (
        <Modal
          title={text('Final Confirmation', 'Pengesahan Akhir')}
          onClose={() => { if (!saving) setConfirming(false); }}
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <button className={secondaryButtonClass} disabled={saving} onClick={() => setConfirming(false)}>{text('Close - Keep Draft', 'Tutup - Simpan Draf')}</button>
              <button className={buttonClass} disabled={saving} onClick={confirm}>
                {saving ? text('Saving...', 'Menyimpan...') : text('Final Confirm - Add Stock', 'Sahkan Akhir - Tambah Stok')}
              </button>
            </div>
          }
        >
          <div className="rounded-lg border border-accent bg-shell p-3">
            <p className="text-xl font-semibold leading-tight text-accent sm:text-2xl">{text('Confirm Stock In', 'Sahkan Stok Masuk')}: {confirmationTotalUnits} {text('Units', 'Unit')}</p>
            <p className="mt-1 text-sm font-bold text-neutral-700">{itemCountLabel(confirmationLines.length, text)} · {text('Staff', 'Staff')} {confirmationEnteredBy}</p>
            {activeDraft ? (
              <p className="mt-2 rounded-xl bg-white/75 px-3 py-2 text-xs font-semibold text-amber-700">
                {activeDraft.draft_number} · {text('Draft saved. Stock is not updated yet.', 'Draf disimpan. Stok belum dikemas kini.')}
              </p>
            ) : null}
          </div>
          <div className="mt-3 max-h-[52vh] overflow-auto rounded-lg border border-line bg-white/85 sm:hidden">
            <table className="w-full table-fixed text-left text-xs">
              <thead className="sticky top-0 z-10 bg-shell text-ink">
                <tr>
                  <th className="w-[43%] p-2 font-semibold">{text('Product', 'Produk')}</th>
                  <th className="w-[35%] p-2 font-semibold">{text('Input', 'Input')}</th>
                  <th className="w-[22%] p-2 text-right font-semibold">{text('Adds', 'Tambah')}</th>
                </tr>
              </thead>
              <tbody>
                {confirmationLines.map((line, index) => (
                  <tr key={`mobile-confirm-${line.id}`} className={`border-t border-line align-top ${index % 2 ? 'bg-white/75' : 'bg-shell/45'}`}>
                    <td className="p-2 font-semibold leading-tight">
                      <span className="block truncate">{line.productName}</span>
                      <span className="mt-0.5 block truncate text-xs font-bold text-neutral-500">
                        {line.costPerUnit == null ? text('No cost entered', 'Tiada kos') : `${String(settings.currency_symbol)} ${line.costPerUnit.toFixed(2)}`}
                      </span>
                    </td>
                    <td className="whitespace-nowrap p-2 text-xs font-bold leading-tight">{compactLineInputLabel(line, text)}</td>
                    <td className="p-2 text-right font-semibold text-accent">+{line.cans}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="clean-scroll mt-3 hidden max-h-[45vh] overflow-auto rounded-lg border border-line bg-white/80 sm:block">
            <table className="dense-table w-full min-w-[560px] text-left text-xs sm:text-sm">
              <thead className="bg-shell">
                <tr>
                  <th className="p-3">{text('Product', 'Produk')}</th>
                  <th className="p-3">{text('Input', 'Input')}</th>
                  <th className="p-3">{text('Units Added', 'Unit Ditambah')}</th>
                  <th className="p-3">{text('Cost', 'Kos')}</th>
                </tr>
              </thead>
              <tbody>
                {confirmationLines.map((line) => (
                  <tr key={line.id} className="border-t border-line">
                    <td className="p-3 font-semibold">{line.productName}</td>
                    <td className="p-3">{compactLineInputLabel(line, text)}</td>
                    <td className="p-3 font-semibold">{line.cans}</td>
                    <td className="p-3">{line.costPerUnit == null ? '-' : `${String(settings.currency_symbol)} ${line.costPerUnit.toFixed(2)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 rounded-lg bg-shell p-3 text-sm font-semibold">{text('Supplier / Reference', 'Pembekal / Rujukan')}: {[confirmationSupplier, confirmationReference].filter(Boolean).join(' / ') || '-'}</p>
          {confirmationNotes ? <p className="mt-2 rounded-lg bg-shell p-3 text-sm font-bold">{text('Notes', 'Nota')}: {confirmationNotes}</p> : null}
        </Modal>
      ) : null}

      {cancelDraft ? (
        <Modal
          title={text('Cancel Stock In Draft', 'Batalkan Draf Stok Masuk')}
          onClose={() => {
            if (!saving) {
              setCancelDraft(null);
              setCancelReason('');
            }
          }}
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <button className={secondaryButtonClass} disabled={saving} onClick={() => setCancelDraft(null)}>{text('Keep Draft', 'Simpan Draf')}</button>
              <button className={dangerButtonClass} disabled={saving || cancelReason.trim().length === 0} onClick={cancelDraftRecord}>
                {saving ? text('Cancelling...', 'Membatalkan...') : text('Cancel Draft', 'Batalkan Draf')}
              </button>
            </div>
          }
        >
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-base font-semibold text-amber-800">{cancelDraft.draft_number}</p>
            <p className="mt-1 text-sm font-bold text-amber-700">
              {text('Cancelling keeps proof, but stock will not be added.', 'Pembatalan simpan bukti, tetapi stok tidak akan ditambah.')}
            </p>
          </div>
          <Field label={text('Reason', 'Sebab')}>
            <textarea
              className={`${inputClass} mt-3 min-h-24 resize-none`}
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder={text('Example: wrong quantity entered', 'Contoh: kuantiti salah diisi')}
            />
          </Field>
        </Modal>
      ) : null}
    </>
  );
}
