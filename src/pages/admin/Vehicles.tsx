import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Bus, Plus } from 'lucide-react';
import { PageHeader, Stat, Panel, Badge, EmptyState } from '../../components/Page';
import { Field, buttonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { supabase } from '../../lib/supabase';
import { loadEmployees, readErrorMessage } from '../../lib/opsData';
import type { Employee, TransportVehicle } from '../../lib/platformTypes';

const types: Array<[TransportVehicle['vehicle_type'], string]> = [
  ['van', 'Van'],
  ['minibus', 'Minibus'],
  ['bus', 'Bus'],
  ['car', 'Car'],
  ['pickup_truck', 'Pickup truck'],
  ['other', 'Other'],
];

export default function Vehicles() {
  const toast = useToast();
  const [vehicles, setVehicles] = useState<TransportVehicle[]>([]);
  const [drivers, setDrivers] = useState<Employee[]>([]);
  const [editing, setEditing] = useState<Partial<TransportVehicle> | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [vehicleResult, driverRows] = await Promise.all([
        supabase.from('transport_vehicles').select('*').order('sort_order').order('code'),
        loadEmployees(['driver', 'crew']).catch(() => []),
      ]);
      if (vehicleResult.error) throw vehicleResult.error;
      setVehicles((vehicleResult.data ?? []) as TransportVehicle[]);
      setDrivers(driverRows);
    } catch (error) {
      toast.error(readErrorMessage(error, 'Could not load vehicles.'));
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const active = vehicles.filter((vehicle) => vehicle.active);
  const seats = active.reduce((sum, vehicle) => sum + vehicle.capacity_pax, 0);

  return (
    <>
      <PageHeader
        title="Vehicles"
        subtitle="The vans and cars that collect guests from their hotels. Capacity here is what stops a run being overloaded."
        actions={
          <button
            type="button"
            className={buttonClass}
            onClick={() => setEditing({ code: `Van ${vehicles.length + 1}`, vehicle_type: 'van', capacity_pax: 12, active: true, sort_order: vehicles.length + 1 })}
          >
            <Plus className="h-4 w-4" /> Add vehicle
          </button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <Stat label="Vehicles" value={String(vehicles.length)} />
        <Stat label="In service" value={String(active.length)} />
        <Stat label="Total seats" value={String(seats)} hint="across every active vehicle" />
      </div>

      {loading ? <p className="py-6 text-center text-sm font-medium text-muted">Loading…</p> : null}

      <Panel title="Fleet">
        <div className="table-scroll">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-paper">
              <tr className="eyebrow">
                <th className="px-3.5 py-2">Vehicle</th>
                <th className="px-3.5 py-2">Type</th>
                <th className="px-3.5 py-2">Seats</th>
                <th className="px-3.5 py-2">Plate</th>
                <th className="px-3.5 py-2">Usual driver</th>
                <th className="px-3.5 py-2">Status</th>
                <th className="px-3.5 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {vehicles.map((vehicle) => (
                <tr key={vehicle.id}>
                  <td className="px-3.5 py-2.5">
                    <span className="flex items-center gap-2 font-semibold text-ink">
                      <Bus className="h-4 w-4 text-accent" /> {vehicle.code}
                    </span>
                    {vehicle.name ? <p className="text-xs text-muted">{vehicle.name}</p> : null}
                  </td>
                  <td className="px-3.5 py-2.5 capitalize text-muted">{vehicle.vehicle_type.replace('_', ' ')}</td>
                  <td className="px-3.5 py-2.5 tabular font-semibold">{vehicle.capacity_pax}</td>
                  <td className="px-3.5 py-2.5 tabular text-muted">{vehicle.plate_no ?? '—'}</td>
                  <td className="px-3.5 py-2.5 text-muted">
                    {drivers.find((driver) => driver.id === vehicle.default_driver_employee_id)?.full_name ?? '—'}
                  </td>
                  <td className="px-3.5 py-2.5">
                    <Badge tone={vehicle.active ? 'good' : 'neutral'}>{vehicle.active ? 'in service' : 'off the road'}</Badge>
                  </td>
                  <td className="px-3.5 py-2.5">
                    <button type="button" className={secondaryButtonClass} onClick={() => setEditing(vehicle)}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && vehicles.length === 0 ? (
          <div className="p-4"><EmptyState>No vehicles yet. Add the vans you use for hotel pickups.</EmptyState></div>
        ) : null}
      </Panel>

      {editing ? (
        <VehicleForm
          vehicle={editing}
          drivers={drivers}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void refresh(); }}
        />
      ) : null}
    </>
  );
}

function VehicleForm({
  vehicle,
  drivers,
  onClose,
  onSaved,
}: {
  vehicle: Partial<TransportVehicle>;
  drivers: Employee[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<Partial<TransportVehicle>>(vehicle);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof TransportVehicle>(key: K, value: TransportVehicle[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.code?.trim()) { toast.error('Give the vehicle a name or number.'); return; }
    setBusy(true);
    const payload = {
      code: form.code.trim(),
      name: form.name || null,
      vehicle_type: form.vehicle_type ?? 'van',
      capacity_pax: Number(form.capacity_pax) || 0,
      plate_no: form.plate_no || null,
      default_driver_employee_id: form.default_driver_employee_id || null,
      active: form.active !== false,
      notes: form.notes || null,
      sort_order: Number(form.sort_order) || 0,
    };
    const { error } = form.id
      ? await supabase.from('transport_vehicles').update(payload).eq('id', form.id)
      : await supabase.from('transport_vehicles').insert(payload);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Vehicle saved.');
    onSaved();
  }

  return (
    <Modal
      title={form.id ? `Edit ${form.code}` : 'Add vehicle'}
      onClose={onClose}
      footer={
        <button type="submit" form="vehicle-form" className={`${buttonClass} w-full`} disabled={busy}>
          {busy ? 'Saving…' : 'Save vehicle'}
        </button>
      }
    >
      <form id="vehicle-form" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Name or number">
          <input className={inputClass} value={form.code ?? ''} onChange={(e) => set('code', e.target.value)} required placeholder="Van 1" />
        </Field>
        <Field label="Model">
          <input className={inputClass} value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="Toyota Hiace" />
        </Field>
        <Field label="Type">
          <select className={inputClass} value={form.vehicle_type ?? 'van'} onChange={(e) => set('vehicle_type', e.target.value as TransportVehicle['vehicle_type'])}>
            {types.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field label="How many guests fit">
          <input type="number" min="0" className={inputClass} value={form.capacity_pax ?? 0} onChange={(e) => set('capacity_pax', Number(e.target.value))} required />
        </Field>
        <Field label="Plate number">
          <input className={inputClass} value={form.plate_no ?? ''} onChange={(e) => set('plate_no', e.target.value)} />
        </Field>
        <Field label="Usual driver">
          <select className={inputClass} value={form.default_driver_employee_id ?? ''} onChange={(e) => set('default_driver_employee_id', e.target.value)}>
            <option value="">Not set</option>
            {drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.full_name}</option>)}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Notes">
            <input className={inputClass} value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>
        <label className="flex items-center gap-2 rounded-lg bg-shell px-3 py-2.5 text-sm font-semibold sm:col-span-2">
          <input type="checkbox" checked={form.active !== false} onChange={(e) => set('active', e.target.checked)} />
          In service
        </label>
      </form>
    </Modal>
  );
}
