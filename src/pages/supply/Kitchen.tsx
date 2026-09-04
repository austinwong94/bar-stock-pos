import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ChefHat, Plus, Send, Trash2 } from 'lucide-react';
import { PageHeader, Stat } from '../../components/Page';
import { Field, buttonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { supabase } from '../../lib/supabase';
import { useAccess } from '../../lib/access';
import { readErrorMessage, todayIso } from '../../lib/opsData';
import type { PurchaseRequest, PurchaseRequestItem } from '../../lib/platformTypes';

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

      <div className="mb-3 grid gap-2 sm:grid-cols-3">
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
                              : 'bg-shell text-coral'
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

        <div className="rounded-2xl border border-line bg-shell/60 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-black">Ingredients and materials</p>
              <p className="text-xs font-semibold text-neutral-600">
                Paste from Excel: Item, Quantity, Unit, Note.
              </p>
            </div>
            <button type="button" className={secondaryButtonClass} onClick={() => setItems((rows) => [...rows, emptyItem()])}>
              <Plus className="h-4 w-4" /> Row
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
