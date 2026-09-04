import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { PackageSearch, Plus, Search } from 'lucide-react';
import { PageHeader, Stat, Panel, Badge, EmptyState } from '../../components/Page';
import { Field, buttonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { supabase } from '../../lib/supabase';
import { useAccess } from '../../lib/access';
import { loadBoats, readErrorMessage, todayIso } from '../../lib/opsData';
import { money } from '../../lib/format';
import type { Boat, MissingItem } from '../../lib/platformTypes';
import type { SettingsMap } from '../../lib/types';

const categories: Array<[string, string]> = [
  ['snorkel_gear', 'Snorkel gear'],
  ['safety_gear', 'Safety gear'],
  ['clothing', 'Clothing'],
  ['kitchen', 'Kitchen'],
  ['boat_part', 'Boat part'],
  ['electronics', 'Electronics'],
  ['equipment', 'Equipment'],
  ['other', 'Other'],
];

const categoryLabel = (code: string) => categories.find(([value]) => value === code)?.[1] ?? code;

export default function MissingItems({ settings }: { settings: SettingsMap }) {
  const toast = useToast();
  const { can } = useAccess();
  const currency = String(settings.currency_symbol ?? 'MYR');

  const [items, setItems] = useState<MissingItem[]>([]);
  const [boats, setBoats] = useState<Boat[]>([]);
  const [filter, setFilter] = useState<'missing' | 'all'>('missing');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<MissingItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [resolving, setResolving] = useState<MissingItem | null>(null);
  const [loading, setLoading] = useState(true);

  const canReport = can('items.report');
  const canManage = can('items.manage');
  const showValue = can('items.cost.view');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [itemResult, boatRows] = await Promise.all([
        supabase.from('missing_items').select('*, boats(code)').order('missing_on', { ascending: false }).limit(400),
        loadBoats(true).catch(() => []),
      ]);
      if (itemResult.error) throw itemResult.error;
      setItems((itemResult.data ?? []) as MissingItem[]);
      setBoats(boatRows);
    } catch (error) {
      toast.error(readErrorMessage(error, 'Could not load the missing items register.'));
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items
      .filter((item) => (filter === 'missing' ? item.status === 'missing' : true))
      .filter((item) =>
        needle
          ? [item.item_name, item.remarks, item.noticed_location, categoryLabel(item.category)]
              .filter(Boolean)
              .some((value) => String(value).toLowerCase().includes(needle))
          : true,
      );
  }, [filter, items, search]);

  const totals = useMemo(() => {
    const outstanding = items.filter((item) => item.status === 'missing');
    return {
      outstanding: outstanding.reduce((sum, item) => sum + item.quantity, 0),
      recovered: items.filter((item) => item.status === 'found').reduce((sum, item) => sum + item.quantity, 0),
      writtenOff: items.filter((item) => item.status === 'written_off').reduce((sum, item) => sum + item.quantity, 0),
      value: outstanding.reduce((sum, item) => sum + Number(item.estimated_value ?? 0), 0),
    };
  }, [items]);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    items
      .filter((item) => item.status === 'missing')
      .forEach((item) => map.set(item.category, (map.get(item.category) ?? 0) + item.quantity));
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);

  return (
    <>
      <PageHeader
        title="Island Items"
        subtitle="Equipment that has gone missing, when it went missing, and whether it turned up again."
        actions={
          canReport ? (
            <button type="button" className={buttonClass} onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus className="h-4 w-4" /> Report missing item
            </button>
          ) : null
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 xl:grid-cols-4">
        <Stat label="Still missing" value={String(totals.outstanding)} tone={totals.outstanding ? 'warn' : 'good'} />
        <Stat label="Found again" value={String(totals.recovered)} />
        <Stat label="Written off" value={String(totals.writtenOff)} />
        {showValue ? <Stat label="Value outstanding" value={money(totals.value, currency)} /> : null}
      </div>

      {byCategory.length > 0 ? (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {byCategory.map(([category, count]) => (
            <span key={category} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold">
              {categoryLabel(category)} <span className="ml-1 tabular text-alert">{count}</span>
            </span>
          ))}
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="min-w-[12rem] flex-1">
          <Field label="Search">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input className={`${inputClass} pl-9`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Item, place or remark" />
            </div>
          </Field>
        </div>
        <div className="flex gap-0.5 rounded-lg bg-shell p-0.5 text-sm font-semibold">
          <button type="button" onClick={() => setFilter('missing')} className={`rounded px-3.5 py-1.5 transition ${filter === 'missing' ? 'bg-surface text-ink' : 'text-muted'}`}>
            Still missing
          </button>
          <button type="button" onClick={() => setFilter('all')} className={`rounded px-3.5 py-1.5 transition ${filter === 'all' ? 'bg-surface text-ink' : 'text-muted'}`}>
            Everything
          </button>
        </div>
      </div>

      {loading ? <p className="py-6 text-center text-sm font-medium text-muted">Loading…</p> : null}

      <Panel title={`Register (${visible.length})`}>
        <div className="table-scroll">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead className="bg-paper">
              <tr className="eyebrow">
                <th className="px-3.5 py-2">Item</th>
                <th className="px-3.5 py-2">Qty</th>
                <th className="px-3.5 py-2">Category</th>
                <th className="px-3.5 py-2">Missing since</th>
                <th className="px-3.5 py-2">Where</th>
                <th className="px-3.5 py-2">Status</th>
                {showValue ? <th className="px-3.5 py-2">Value</th> : null}
                <th className="px-3.5 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visible.map((item) => (
                <tr key={item.id}>
                  <td className="px-3.5 py-2.5">
                    <span className="font-semibold text-ink">{item.item_name}</span>
                    {item.remarks ? <p className="mt-0.5 max-w-sm text-xs text-muted">{item.remarks}</p> : null}
                    {item.found_remarks ? (
                      <p className="mt-0.5 max-w-sm text-xs text-accent">Found: {item.found_remarks}</p>
                    ) : null}
                  </td>
                  <td className="px-3.5 py-2.5 tabular font-semibold">{item.quantity}</td>
                  <td className="px-3.5 py-2.5 text-muted">{categoryLabel(item.category)}</td>
                  <td className="px-3.5 py-2.5 tabular">{item.missing_on}</td>
                  <td className="px-3.5 py-2.5 text-muted">
                    {item.noticed_location ?? '—'}
                    {item.boats?.code ? <span className="ml-1">({item.boats.code})</span> : null}
                  </td>
                  <td className="px-3.5 py-2.5">
                    <Badge tone={item.status === 'found' ? 'good' : item.status === 'written_off' ? 'neutral' : 'warn'}>
                      {item.status === 'written_off' ? 'written off' : item.status}
                    </Badge>
                    {item.found_on ? <p className="mt-0.5 text-xs tabular text-muted">{item.found_on}</p> : null}
                  </td>
                  {showValue ? (
                    <td className="px-3.5 py-2.5 tabular">{item.estimated_value ? money(item.estimated_value, currency) : '—'}</td>
                  ) : null}
                  <td className="px-3.5 py-2.5">
                    <div className="flex gap-1.5">
                      {canReport ? (
                        <button type="button" className={secondaryButtonClass} onClick={() => { setEditing(item); setFormOpen(true); }}>
                          Edit
                        </button>
                      ) : null}
                      {canManage && item.status === 'missing' ? (
                        <button type="button" className={buttonClass} onClick={() => setResolving(item)}>
                          Close
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && visible.length === 0 ? (
          <div className="p-4"><EmptyState>Nothing to show. That is the good outcome.</EmptyState></div>
        ) : null}
      </Panel>

      {formOpen ? (
        <ItemForm
          item={editing}
          boats={boats}
          showValue={showValue}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); void refresh(); }}
        />
      ) : null}

      {resolving ? (
        <ResolveForm
          item={resolving}
          onClose={() => setResolving(null)}
          onSaved={() => { setResolving(null); void refresh(); }}
        />
      ) : null}
    </>
  );
}

function ItemForm({
  item,
  boats,
  showValue,
  onClose,
  onSaved,
}: {
  item: MissingItem | null;
  boats: Boat[];
  showValue: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(item?.item_name ?? '');
  const [category, setCategory] = useState(item?.category ?? 'snorkel_gear');
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 1));
  const [missingOn, setMissingOn] = useState(item?.missing_on ?? todayIso());
  const [location, setLocation] = useState(item?.noticed_location ?? '');
  const [boatId, setBoatId] = useState(item?.boat_id ?? '');
  const [remarks, setRemarks] = useState(item?.remarks ?? '');
  const [value, setValue] = useState(item?.estimated_value ? String(item.estimated_value) : '');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc('save_missing_item', {
      p_id: item?.id ?? null,
      p_item_name: name,
      p_category: category,
      p_quantity: Number(quantity) || 1,
      p_missing_on: missingOn,
      p_noticed_location: location,
      p_boat_id: boatId || null,
      p_remarks: remarks,
      p_estimated_value: value === '' ? null : Number(value),
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(item ? 'Item updated.' : 'Missing item recorded.');
    onSaved();
  }

  return (
    <Modal
      title={item ? 'Edit item' : 'Report a missing item'}
      onClose={onClose}
      footer={
        <button type="submit" form="item-form" className={`${buttonClass} w-full`} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      }
    >
      <form id="item-form" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="What is missing">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required placeholder="Snorkel goggles" />
          </Field>
        </div>
        <Field label="Category">
          <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field label="How many">
          <input type="number" min="1" className={inputClass} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </Field>
        <Field label="Missing since">
          <input type="date" className={inputClass} value={missingOn} onChange={(e) => setMissingOn(e.target.value)} />
        </Field>
        <Field label="Last seen where">
          <input className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Island jetty" />
        </Field>
        <Field label="On a boat?">
          <select className={inputClass} value={boatId} onChange={(e) => setBoatId(e.target.value)}>
            <option value="">Not on a boat</option>
            {boats.map((boat) => <option key={boat.id} value={boat.id}>{boat.code}</option>)}
          </select>
        </Field>
        {showValue ? (
          <Field label="Roughly worth">
            <input className={inputClass} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
        ) : null}
        <div className="sm:col-span-2">
          <Field label="Remarks">
            <textarea className={inputClass} rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
        </div>
      </form>
    </Modal>
  );
}

function ResolveForm({
  item,
  onClose,
  onSaved,
}: {
  item: MissingItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [status, setStatus] = useState<'found' | 'written_off'>('found');
  const [foundOn, setFoundOn] = useState(todayIso());
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc('resolve_missing_item', {
      p_id: item.id,
      p_status: status,
      p_found_on: status === 'found' ? foundOn : null,
      p_remarks: remarks,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(status === 'found' ? 'Marked as found.' : 'Written off.');
    onSaved();
  }

  return (
    <Modal
      title={`Close: ${item.item_name}`}
      onClose={onClose}
      footer={
        <button type="submit" form="resolve-form" className={`${buttonClass} w-full`} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      }
    >
      <form id="resolve-form" onSubmit={submit} className="grid gap-3">
        <div className="grid grid-cols-2 gap-0.5 rounded-lg bg-shell p-0.5 text-sm font-semibold">
          <button type="button" onClick={() => setStatus('found')} className={`rounded px-3 py-2 transition ${status === 'found' ? 'bg-surface text-ink' : 'text-muted'}`}>
            <PackageSearch className="mr-1.5 inline h-4 w-4" /> Found it
          </button>
          <button type="button" onClick={() => setStatus('written_off')} className={`rounded px-3 py-2 transition ${status === 'written_off' ? 'bg-surface text-ink' : 'text-muted'}`}>
            Write it off
          </button>
        </div>

        {status === 'found' ? (
          <Field label="Found on">
            <input type="date" className={inputClass} value={foundOn} onChange={(e) => setFoundOn(e.target.value)} />
          </Field>
        ) : null}

        <Field
          label={status === 'found' ? 'Where was it found' : 'Why is it being written off'}
          hint={status === 'written_off' ? 'Required — this goes in the audit trail.' : undefined}
        >
          <textarea className={inputClass} rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} required={status === 'written_off'} />
        </Field>
      </form>
    </Modal>
  );
}
