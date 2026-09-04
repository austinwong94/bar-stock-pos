import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ChefHat, Copy, Plus, Search, Send, Trash2 } from 'lucide-react';
import { PageHeader, Stat } from '../../components/Page';
import { Field, buttonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { supabase } from '../../lib/supabase';
import { useAccess } from '../../lib/access';
import { readErrorMessage, todayIso } from '../../lib/opsData';
import type { CatalogueItem, PurchaseRequest, PurchaseRequestItem } from '../../lib/platformTypes';

type ItemRow = { id?: string; item_name: string; quantity: string; unit: string; note: string };

const units = ['kg', 'g', 'L', 'ml', 'pcs', 'pack', 'box', 'bag', 'tray', 'bottle'];
const emptyItem = (): ItemRow => ({ item_name: '', quantity: '', unit: 'kg', note: '' });

export const requestStatusLabels: Record<string, string> = {
  draft: 'Not sent yet',
  submitted: 'Sent to purchasing',
  buying: 'Being bought',
  completed: 'Done',
  cancelled: 'Cancelled',
};

export default function Kitchen() {
  const toast = useToast();
  const { can, reloadBadges } = useAccess();
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [editing, setEditing] = useState<PurchaseRequest | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const canCreate = can('kitchen.request.create');
  const canSubmit = can('kitchen.request.submit');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('purchase_requests')
        .select('*, purchase_request_items(*)')
        .order('needed_for_date', { ascending: false })
        .limit(200);
      if (error) throw error;
      setRequests((data ?? []) as PurchaseRequest[]);
    } catch (error) {
      toast.error(readErrorMessage(error, 'Could not load kitchen requests.'));
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function submitRequest(request: PurchaseRequest) {
    if (!window.confirm(`Send ${request.request_no} to Things to Purchase? This also posts the list to the WhatsApp group if that is switched on.`)) return;
    const { error } = await supabase.rpc('submit_purchase_request', { p_request_id: request.id });
    if (error) { toast.error(error.message); return; }
    toast.success('Request sent to purchasing.');
    void refresh();
    void reloadBadges();
  }

  async function copyRequest(request: PurchaseRequest) {
    const when = window.prompt('Copy this order to which date?', todayIso());
    if (!when) return;
    const { error } = await supabase.rpc('copy_purchase_request', {
      p_source_id: request.id,
      p_needed_for_date: when,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Copied as a new draft. Adjust the quantities and send it.');
    void refresh();
    void reloadBadges();
  }

  async function cancelRequest(request: PurchaseRequest) {
    const reason = window.prompt(`Why is ${request.request_no} being cancelled?`);
    if (!reason?.trim()) return;
    const { error } = await supabase.rpc('cancel_purchase_request', { p_request_id: request.id, p_reason: reason.trim() });
    if (error) { toast.error(error.message); return; }
    toast.success('Request cancelled.');
    void refresh();
  }

  const drafts = requests.filter((request) => request.status === 'draft');
  const open = requests.filter((request) => request.status === 'submitted' || request.status === 'buying');

  return (
    <>
      <PageHeader
        title="Kitchen Requests"
        subtitle="What the kitchen needs, for which date and for how many pax. Sending a request puts it on the buying list."
        actions={
          canCreate ? (
            <button type="button" className={buttonClass} onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus className="h-4 w-4" /> New request
            </button>
          ) : null
        }
      />

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Not sent yet" value={String(drafts.length)} tone={drafts.length ? 'warn' : 'good'} />
        <Stat label="With purchasing" value={String(open.length)} />
        <Stat label="All requests" value={String(requests.length)} />
      </div>

      {loading ? <p className="p-4 font-bold">Loading...</p> : null}

      <div className="grid gap-2">
        {requests.map((request) => {
          const items = request.purchase_request_items ?? [];
          return (
            <article key={request.id} className="rounded-2xl border border-line bg-white/85 p-3 shadow-soft">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-black">
                    <ChefHat className="h-4 w-4 text-accent" />
                    {request.request_no}
                    <span
                      className={`rounded-lg px-2 py-0.5 text-xs ${
                        request.status === 'draft'
                          ? 'bg-amber-50 text-amber-800'
                          : request.status === 'completed'
                            ? 'bg-shell text-accent'
                            : request.status === 'cancelled'
                              ? 'bg-neutral-100 text-neutral-600'
                              : 'bg-shell text-alert'
                      }`}
                    >
                      {requestStatusLabels[request.status]}
                    </span>
                  </p>
                  <p className="mt-1 text-sm font-semibold text-neutral-700">
                    For {request.needed_for_date} · {request.pax_count} pax
                    {request.purpose ? ` · ${request.purpose}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {request.status === 'draft' && canCreate ? (
                    <button type="button" className={secondaryButtonClass} onClick={() => { setEditing(request); setFormOpen(true); }}>
                      Edit
                    </button>
                  ) : null}
                  {request.status === 'draft' && canSubmit ? (
                    <button type="button" className={buttonClass} onClick={() => submitRequest(request)}>
                      <Send className="h-4 w-4" /> Confirm &amp; send
                    </button>
                  ) : null}
                  {canCreate ? (
                    <button type="button" className={secondaryButtonClass} onClick={() => copyRequest(request)}>
                      <Copy className="h-4 w-4" /> Copy
                    </button>
                  ) : null}
                  {request.status !== 'cancelled' && request.status !== 'completed' ? (
                    <button type="button" className={secondaryButtonClass} onClick={() => cancelRequest(request)}>
                      Cancel
                    </button>
                  ) : null}
                </div>
              </div>

              <ul className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                {items
                  .slice()
                  .sort((a, b) => a.sort_order - b.sort_order)
                  .map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-2 rounded-lg bg-shell/60 px-2.5 py-1.5 text-sm">
                      <span className="min-w-0 truncate font-semibold">{item.item_name}</span>
                      <span className="shrink-0 font-black">
                        {Number(item.quantity)} {item.unit}
                      </span>
                    </li>
                  ))}
              </ul>

              {request.cancelled_reason ? (
                <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-danger">
                  Cancelled: {request.cancelled_reason}
                </p>
              ) : null}
            </article>
          );
        })}
        {!loading && requests.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm font-bold text-neutral-500">
            No kitchen requests yet.
          </p>
        ) : null}
      </div>

      {formOpen ? (
        <RequestForm
          request={editing}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); void refresh(); void reloadBadges(); }}
        />
      ) : null}
    </>
  );
}

function RequestForm({
  request,
  onClose,
  onSaved,
}: {
  request: PurchaseRequest | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [neededFor, setNeededFor] = useState(request?.needed_for_date ?? todayIso());
  const [pax, setPax] = useState(String(request?.pax_count ?? ''));
  const [purpose, setPurpose] = useState(request?.purpose ?? '');
  const [notes, setNotes] = useState(request?.notes ?? '');
  const [items, setItems] = useState<ItemRow[]>(() => initialItems(request));
  const [busy, setBusy] = useState(false);

  function update(index: number, patch: Partial<ItemRow>) {
    setItems((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  // A tap fills the first empty row, so the common case is: tap, tap, tap, send.
  function addFromCatalogue(entry: CatalogueItem) {
    setItems((rows) => {
      const already = rows.findIndex((row) => row.item_name.toLowerCase() === entry.name.toLowerCase());
      if (already >= 0) {
        const next = [...rows];
        const current = Number(next[already].quantity) || 0;
        const step = Number(entry.default_quantity) || 1;
        next[already] = { ...next[already], quantity: String(current + step) };
        return next;
      }
      const blank = rows.findIndex((row) => !row.item_name.trim());
      const filled: ItemRow = {
        item_name: entry.name,
        quantity: entry.default_quantity ? String(entry.default_quantity) : '',
        unit: entry.unit,
        note: '',
      };
      if (blank >= 0) {
        const next = [...rows];
        next[blank] = filled;
        return next;
      }
      return [...rows, filled];
    });
  }

  function handlePaste(event: React.ClipboardEvent, start: number) {
    const text = event.clipboardData.getData('text/plain');
    if (!text.includes('\t') && !text.includes('\n')) return;
    event.preventDefault();
    const lines = text.replace(/\r/g, '').split('\n').filter((line) => line.trim());
    setItems((rows) => {
      const next = [...rows];
      lines.forEach((line, offset) => {
        const cells = line.split('\t');
        const base = next[start + offset] ?? emptyItem();
        next[start + offset] = {
          ...base,
          item_name: (cells[0] ?? base.item_name).trim(),
          quantity: (cells[1] ?? base.quantity).trim(),
          unit: (cells[2] ?? base.unit).trim() || base.unit,
          note: (cells[3] ?? base.note).trim(),
        };
      });
      return next;
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const filled = items.filter((item) => item.item_name.trim());
    if (filled.length === 0) { toast.error('Add at least one item.'); return; }
    setBusy(true);
    const { error } = await supabase.rpc('save_purchase_request', {
      p_request: {
        id: request?.id ?? '',
        needed_for_date: neededFor,
        pax_count: Number(pax) || 0,
        purpose,
        notes,
        origin: 'kitchen',
      },
      p_items: filled.map((item) => ({
        id: item.id ?? '',
        item_name: item.item_name.trim(),
        quantity: Number(item.quantity) || 0,
        unit: item.unit,
        note: item.note,
      })),
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Request saved as a draft. Confirm it to send it to purchasing.');
    onSaved();
  }

  return (
    <Modal
      title={request ? `Edit ${request.request_no}` : 'New kitchen request'}
      onClose={onClose}
      footer={
        <button type="submit" form="kitchen-form" className={`${buttonClass} w-full`} disabled={busy}>
          {busy ? 'Saving...' : 'Save draft'}
        </button>
      }
    >
      <form id="kitchen-form" onSubmit={submit} className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Needed for date">
            <input type="date" className={inputClass} value={neededFor} onChange={(e) => setNeededFor(e.target.value)} required />
          </Field>
          <Field label="How many pax">
            <input type="number" min="0" inputMode="numeric" className={inputClass} value={pax} onChange={(e) => setPax(e.target.value)} required />
          </Field>
          <Field label="What for">
            <input className={inputClass} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Island lunch" />
          </Field>
        </div>

        <ItemPicker onPick={addFromCatalogue} chosen={items.map((item) => item.item_name.toLowerCase())} />

        <div className="rounded-lg border border-line bg-paper p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-ink">What is on the order</p>
              <p className="text-xs font-medium text-muted">
                Tap items above, or paste from Excel: Item, Quantity, Unit, Note.
              </p>
            </div>
            <button type="button" className={secondaryButtonClass} onClick={() => setItems((rows) => [...rows, emptyItem()])}>
              <Plus className="h-4 w-4" /> Blank row
            </button>
          </div>

          <div className="grid gap-1.5">
            {items.map((item, index) => (
              <div key={item.id ?? index} className="grid grid-cols-[1fr_5rem_5.5rem_2.25rem] gap-1.5 sm:grid-cols-[1fr_6rem_6rem_1fr_2.5rem]">
                <input
                  className={inputClass}
                  value={item.item_name}
                  onChange={(e) => update(index, { item_name: e.target.value })}
                  onPaste={(e) => handlePaste(e, index)}
                  placeholder="Item"
                  aria-label="Item name"
                />
                <input
                  className={inputClass}
                  inputMode="decimal"
                  value={item.quantity}
                  onChange={(e) => update(index, { quantity: e.target.value })}
                  placeholder="Qty"
                  aria-label="Quantity"
                />
                <select className={inputClass} value={item.unit} onChange={(e) => update(index, { unit: e.target.value })} aria-label="Unit">
                  {units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                </select>
                <input
                  className={`${inputClass} col-span-3 sm:col-span-1`}
                  value={item.note}
                  onChange={(e) => update(index, { note: e.target.value })}
                  placeholder="Note"
                  aria-label="Note"
                />
                <button
                  type="button"
                  onClick={() => setItems((rows) => (rows.length === 1 ? [emptyItem()] : rows.filter((_, i) => i !== index)))}
                  className="grid h-10 w-full place-items-center rounded-xl border border-line bg-white text-danger sm:h-11"
                  aria-label="Remove item"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <Field label="Note for purchasing">
          <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

function initialItems(request: PurchaseRequest | null): ItemRow[] {
  const rows = [...(request?.purchase_request_items ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  if (rows.length === 0) return [emptyItem(), emptyItem(), emptyItem()];
  return rows.map((item: PurchaseRequestItem) => ({
    id: item.id,
    item_name: item.item_name,
    quantity: String(item.quantity),
    unit: item.unit,
    note: item.note ?? '',
  }));
}

/**
 * Most of a weekly order is the same every week, so the catalogue is the
 * primary way in and typing is the fallback. Items sort by how often they
 * are actually used, and anything typed joins the list for next time.
 */
function ItemPicker({ onPick, chosen }: { onPick: (item: CatalogueItem) => void; chosen: string[] }) {
  const [catalogue, setCatalogue] = useState<CatalogueItem[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('catalogue_items')
        .select('*')
        .eq('kind', 'ingredient')
        .eq('active', true)
        .order('times_used', { ascending: false })
        .order('name');
      setCatalogue((data ?? []) as CatalogueItem[]);
    })();
  }, []);

  const categories = useMemo(
    () => ['All', ...Array.from(new Set(catalogue.map((item) => item.category ?? 'Other')))],
    [catalogue],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return catalogue
      .filter((item) => (category === 'All' ? true : (item.category ?? 'Other') === category))
      .filter((item) => (needle ? item.name.toLowerCase().includes(needle) : true))
      .slice(0, 40);
  }, [catalogue, category, search]);

  if (catalogue.length === 0) return null;

  return (
    <div className="rounded-lg border border-accent/25 bg-accent/[0.03] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">Tap what you need</p>
        <div className="relative w-40">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input
            className="h-8 w-full rounded border border-line bg-surface pl-8 pr-2 text-sm outline-none focus:border-accent"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search"
            aria-label="Search items"
          />
        </div>
      </div>

      <div className="mb-2 flex flex-wrap gap-1">
        {categories.map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setCategory(entry)}
            className={`rounded px-2 py-1 text-xs font-semibold transition ${
              category === entry ? 'bg-accent text-white' : 'bg-surface text-muted hover:text-ink'
            }`}
          >
            {entry}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {visible.map((item) => {
          const picked = chosen.includes(item.name.toLowerCase());
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onPick(item)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition ${
                picked
                  ? 'border-accent bg-accent text-white'
                  : 'border-line bg-surface text-ink hover:border-accent hover:bg-shell'
              }`}
            >
              {item.name}
              <span className={`text-xs tabular ${picked ? 'text-white/70' : 'text-muted'}`}>
                {item.default_quantity ? `${Number(item.default_quantity)}${item.unit}` : item.unit}
              </span>
            </button>
          );
        })}
        {visible.length === 0 ? (
          <p className="text-xs font-medium text-muted">Nothing matches. Type it into a blank row and it joins the list.</p>
        ) : null}
      </div>
    </div>
  );
}
