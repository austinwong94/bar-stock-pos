import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Plus, Ship } from 'lucide-react';
import { PageHeader, Stat } from '../../components/Page';
import { Field, buttonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { supabase } from '../../lib/supabase';
import { useAccess } from '../../lib/access';
import { loadBoats, readErrorMessage } from '../../lib/opsData';
import type { Boat } from '../../lib/platformTypes';

const emptyBoat = (sortOrder: number): Partial<Boat> => ({
  code: `Boat ${sortOrder}`,
  name: '',
  boat_type: 'speedboat',
  capacity_pax: 12,
  ownership: 'owned',
  status: 'active',
  sort_order: sortOrder,
});

export default function BoatRegister() {
  const toast = useToast();
  const { can } = useAccess();
  const [boats, setBoats] = useState<Boat[]>([]);
  const [editing, setEditing] = useState<Partial<Boat> | null>(null);
  const [loading, setLoading] = useState(true);

  const canManage = can('fleet.boats.manage');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setBoats(await loadBoats(true));
    } catch (error) {
      toast.error(readErrorMessage(error, 'Could not load the boat register.'));
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeBoats = boats.filter((boat) => boat.status === 'active');
  const totalSeats = activeBoats.reduce((sum, boat) => sum + boat.capacity_pax, 0);

  return (
    <>
      <PageHeader
        title="Boat Register"
        subtitle="Fix the fleet: how many boats, what type, how many pax fit, who owns them, and which are under repair."
        actions={
          canManage ? (
            <button type="button" className={buttonClass} onClick={() => setEditing(emptyBoat(boats.length + 1))}>
              <Plus className="h-4 w-4" /> Add boat
            </button>
          ) : null
        }
      />

      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <Stat label="Boats in the fleet" value={String(boats.length)} />
        <Stat label="Active today" value={String(activeBoats.length)} tone="good" />
        <Stat label="Total seats" value={String(totalSeats)} />
      </div>

      {loading ? <p className="p-4 font-bold">Loading...</p> : null}

      <div className="overflow-x-auto rounded-2xl border border-line bg-white/85 shadow-soft">
        <table className="w-full min-w-[820px] text-left">
          <thead className="bg-paper text-sm">
            <tr>
              <th className="p-3">Boat</th>
              <th className="p-3">Type</th>
              <th className="p-3">Capacity</th>
              <th className="p-3">Ownership</th>
              <th className="p-3">Fuel baseline</th>
              <th className="p-3">Status</th>
              {canManage ? <th className="p-3"></th> : null}
            </tr>
          </thead>
          <tbody>
            {boats.map((boat) => (
              <tr key={boat.id} className="border-t border-line text-sm font-semibold">
                <td className="p-3">
                  <span className="flex items-center gap-2 font-black">
                    <Ship className="h-4 w-4 text-accent" /> {boat.code}
                  </span>
                  {boat.name ? <p className="text-xs font-medium text-neutral-600">{boat.name}</p> : null}
                </td>
                <td className="p-3 capitalize">{boat.boat_type}</td>
                <td className="p-3 font-black">{boat.capacity_pax} pax</td>
                <td className="p-3 capitalize">
                  {boat.ownership}
                  {boat.owner_name ? <p className="text-xs font-medium text-neutral-600">{boat.owner_name}</p> : null}
                </td>
                <td className="p-3">{boat.expected_litres_per_trip ? `${boat.expected_litres_per_trip} L / trip` : '—'}</td>
                <td className="p-3">
                  <span
                    className={`rounded-xl px-2 py-1 text-xs font-black ${
                      boat.status === 'active'
                        ? 'bg-teal-50 text-accent'
                        : boat.status === 'maintenance'
                          ? 'bg-amber-50 text-amber-800'
                          : 'bg-neutral-100 text-neutral-600'
                    }`}
                  >
                    {boat.status}
                  </span>
                  {boat.status_note ? <p className="text-xs font-medium text-neutral-600">{boat.status_note}</p> : null}
                </td>
                {canManage ? (
                  <td className="p-3">
                    <button type="button" className={secondaryButtonClass} onClick={() => setEditing(boat)}>Edit</button>
                  </td>
                ) : null}
              </tr>
            ))}
            {!loading && boats.length === 0 ? (
              <tr>
                <td className="p-4 font-bold text-neutral-500" colSpan={7}>No boats yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {editing ? (
        <BoatForm boat={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void refresh(); }} />
      ) : null}
    </>
  );
}

function BoatForm({
  boat,
  onClose,
  onSaved,
}: {
  boat: Partial<Boat>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<Partial<Boat>>(boat);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof Boat>(key: K, value: Boat[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.code?.trim()) { toast.error('A boat name or number is required.'); return; }
    setBusy(true);
    const payload = {
      code: form.code.trim(),
      name: form.name || null,
      boat_type: form.boat_type || 'speedboat',
      capacity_pax: Number(form.capacity_pax) || 0,
      ownership: form.ownership ?? 'owned',
      owner_name: form.owner_name || null,
      registration_no: form.registration_no || null,
      engine_info: form.engine_info || null,
      expected_litres_per_trip: form.expected_litres_per_trip ? Number(form.expected_litres_per_trip) : null,
      status: form.status ?? 'active',
      status_note: form.status_note || null,
      sort_order: Number(form.sort_order) || 0,
      notes: form.notes || null,
    };
    const { error } = form.id
      ? await supabase.from('boats').update(payload).eq('id', form.id)
      : await supabase.from('boats').insert(payload);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Boat saved.');
    onSaved();
  }

  return (
    <Modal
      title={form.id ? `Edit ${form.code}` : 'Add boat'}
      onClose={onClose}
      footer={
        <button type="submit" form="boat-form" className={`${buttonClass} w-full`} disabled={busy}>
          {busy ? 'Saving...' : 'Save boat'}
        </button>
      }
    >
      <form id="boat-form" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Boat number / name">
          <input className={inputClass} value={form.code ?? ''} onChange={(e) => set('code', e.target.value)} required />
        </Field>
        <Field label="Nickname">
          <input className={inputClass} value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Type of boat">
          <input className={inputClass} value={form.boat_type ?? ''} onChange={(e) => set('boat_type', e.target.value)} placeholder="speedboat / ferry / longboat" />
        </Field>
        <Field label="How many pax fit">
          <input type="number" min="0" className={inputClass} value={form.capacity_pax ?? 0} onChange={(e) => set('capacity_pax', Number(e.target.value))} required />
        </Field>
        <Field label="Ownership">
          <select className={inputClass} value={form.ownership ?? 'owned'} onChange={(e) => set('ownership', e.target.value as Boat['ownership'])}>
            <option value="owned">Ours</option>
            <option value="partner">Partner boat</option>
            <option value="charter">Chartered</option>
          </select>
        </Field>
        <Field label="Owner (if not ours)">
          <input className={inputClass} value={form.owner_name ?? ''} onChange={(e) => set('owner_name', e.target.value)} />
        </Field>
        <Field label="Registration number">
          <input className={inputClass} value={form.registration_no ?? ''} onChange={(e) => set('registration_no', e.target.value)} />
        </Field>
        <Field label="Normal litres per island trip">
          <input
            type="number"
            step="0.1"
            min="0"
            className={inputClass}
            value={form.expected_litres_per_trip ?? ''}
            onChange={(e) => set('expected_litres_per_trip', e.target.value === '' ? null : Number(e.target.value))}
          />
        </Field>
        <Field label="Status">
          <select className={inputClass} value={form.status ?? 'active'} onChange={(e) => set('status', e.target.value as Boat['status'])}>
            <option value="active">Active</option>
            <option value="maintenance">Under repair</option>
            <option value="inactive">Retired / not in use</option>
          </select>
        </Field>
        <Field label="Display order">
          <input type="number" className={inputClass} value={form.sort_order ?? 0} onChange={(e) => set('sort_order', Number(e.target.value))} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Notes">
            <input className={inputClass} value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>
      </form>
    </Modal>
  );
}
