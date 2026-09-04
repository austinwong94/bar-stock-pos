import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bus, Clock, MapPin, Plus, Route, Sparkles, Trash2, UserX, Users } from 'lucide-react';
import { PageHeader, Stat, Panel, Badge, EmptyState } from '../../components/Page';
import { Field, buttonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { supabase } from '../../lib/supabase';
import { useCardMover } from '../../lib/dragdrop';
import { loadEmployees, readErrorMessage, todayIso } from '../../lib/opsData';
import type { Booking, Employee, PickupRun, TransportVehicle } from '../../lib/platformTypes';
import type { SettingsMap } from '../../lib/types';

const NO_RUN = 'no-run';

const time = (value: string | null | undefined) => (value ? value.slice(0, 5) : null);

export default function PickupCoordination({ settings }: { settings: SettingsMap }) {
  const toast = useToast();
  const [date, setDate] = useState(todayIso);
  const [radius, setRadius] = useState(String(settings.pickup_group_radius_km ?? 1.5));
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [runs, setRuns] = useState<PickupRun[]>([]);
  const [vehicles, setVehicles] = useState<TransportVehicle[]>([]);
  const [drivers, setDrivers] = useState<Employee[]>([]);
  const [editingRun, setEditingRun] = useState<PickupRun | null>(null);
  const [runFormOpen, setRunFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [bookingResult, runResult, vehicleResult, driverRows] = await Promise.all([
        supabase
          .from('bookings')
          .select('*, agencies(id,name,source_type)')
          .eq('service_date', date)
          .neq('status', 'cancelled')
          .order('pickup_stop_order', { ascending: true }),
        supabase
          .from('pickup_groups')
          .select('*, transport_vehicles(code,name,capacity_pax)')
          .eq('service_date', date)
          .order('sort_order'),
        supabase.from('transport_vehicles').select('*').eq('active', true).order('sort_order'),
        loadEmployees(['driver', 'guide', 'crew']).catch(() => []),
      ]);
      if (bookingResult.error) throw bookingResult.error;
      setBookings((bookingResult.data ?? []) as Booking[]);
      setRuns((runResult.data ?? []) as PickupRun[]);
      setVehicles((vehicleResult.data ?? []) as TransportVehicle[]);
      setDrivers(driverRows);
    } catch (error) {
      toast.error(readErrorMessage(error, 'Could not load the pickup board.'));
    }
    setLoading(false);
  }, [date, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const move = useCallback(
    async (bookingId: string, targetId: string) => {
      const { error } = await supabase.rpc('assign_pickup_run', {
        p_booking_id: bookingId,
        p_run_id: targetId === NO_RUN ? null : targetId,
        p_allow_overload: false,
      });
      if (error) { toast.error(error.message); return; }
      void refresh();
    },
    [refresh, toast],
  );

  const { held, dragProps, dropProps } = useCardMover(move);

  const needPickup = useMemo(() => bookings.filter((booking) => booking.pickup_required), [bookings]);
  const ownTransport = useMemo(() => bookings.filter((booking) => !booking.pickup_required), [bookings]);
  const waiting = needPickup.filter((booking) => !booking.pickup_group_id);

  const byRun = useMemo(() => {
    const map = new Map<string, Booking[]>();
    runs.forEach((run) => map.set(run.id, []));
    needPickup.forEach((booking) => {
      if (booking.pickup_group_id && map.has(booking.pickup_group_id)) {
        map.get(booking.pickup_group_id)!.push(booking);
      }
    });
    map.forEach((list) =>
      list.sort((a, b) => (a.pickup_stop_order ?? 99) - (b.pickup_stop_order ?? 99) || a.lead_name.localeCompare(b.lead_name)),
    );
    return map;
  }, [needPickup, runs]);

  async function autoPlan() {
    setBusy(true);
    const { data, error } = await supabase.rpc('auto_plan_pickups', {
      p_service_date: date,
      p_radius_km: Number(radius) || 1.5,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(data ? `${data} booking(s) placed on a vehicle and the routes ordered.` : 'Everyone is already on a run.');
    void refresh();
  }

  async function reorder(run: PickupRun) {
    const { error } = await supabase.rpc('order_pickup_run', { p_run_id: run.id });
    if (error) { toast.error(error.message); return; }
    toast.success('Route reordered from the furthest hotel inwards.');
    void refresh();
  }

  async function removeRun(run: PickupRun) {
    if (!window.confirm(`Delete "${run.name}"? Its bookings go back to the waiting list.`)) return;
    const { error } = await supabase.rpc('delete_pickup_run', { p_run_id: run.id });
    if (error) { toast.error(error.message); return; }
    void refresh();
  }

  async function togglePickup(booking: Booking, required: boolean) {
    const { error } = await supabase.rpc('set_booking_pickup', { p_booking_id: booking.id, p_required: required });
    if (error) { toast.error(error.message); return; }
    void refresh();
  }

  const paxWaiting = waiting.reduce((sum, booking) => sum + booking.pax_total, 0);
  const paxCollected = needPickup.length - waiting.length;

  return (
    <>
      <PageHeader
        title="Pickup & Transport"
        subtitle="Only guests who asked to be collected appear here. Plan fills the vans by area and orders each route from the furthest hotel inwards."
        actions={
          <>
            <button type="button" className={buttonClass} onClick={autoPlan} disabled={busy}>
              <Sparkles className="h-4 w-4" /> {busy ? 'Planning…' : 'Plan the runs'}
            </button>
            <button type="button" className={secondaryButtonClass} onClick={() => { setEditingRun(null); setRunFormOpen(true); }}>
              <Plus className="h-4 w-4" /> New run
            </button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Field label="Service date">
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Group hotels within (km)" hint="Hotels closer than this share a vehicle.">
          <input type="number" step="0.1" min="0.1" className={inputClass} value={radius} onChange={(e) => setRadius(e.target.value)} />
        </Field>
        {held ? (
          <p className="ml-auto rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-white">
            Picked up. Tap a run to drop it there.
          </p>
        ) : null}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2.5 xl:grid-cols-4">
        <Stat label="Need collecting" value={String(needPickup.length)} hint={`${needPickup.reduce((s, b) => s + b.pax_total, 0)} pax`} />
        <Stat label="On a run" value={`${paxCollected} / ${needPickup.length}`} tone={waiting.length === 0 ? 'good' : 'default'} />
        <Stat label="Still waiting" value={String(paxWaiting)} tone={paxWaiting > 0 ? 'warn' : 'good'} hint="pax with no vehicle" />
        <Stat label="Making own way" value={String(ownTransport.length)} hint="no pickup needed" />
      </div>

      {loading ? <p className="py-6 text-center text-sm font-medium text-muted">Loading…</p> : null}

      <div className="grid gap-4 lg:grid-cols-[19rem_1fr]">
        <div className="grid gap-4">
          <section
            {...dropProps(NO_RUN)}
            className="rounded-lg border-2 border-dashed border-warning/40 bg-warning/[0.04] p-3"
          >
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
              <Users className="h-4 w-4 text-warning" /> Waiting for a vehicle ({paxWaiting} pax)
            </h2>
            <div className="grid gap-2">
              {waiting.map((booking) => (
                <PickupCard key={booking.id} booking={booking} held={held === booking.id} dragProps={dragProps} onOptOut={() => togglePickup(booking, false)} />
              ))}
              {waiting.length === 0 ? (
                <p className="rounded border border-dashed border-line px-3 py-4 text-center text-xs font-medium text-muted">
                  Everyone who needs collecting has a vehicle.
                </p>
              ) : null}
            </div>
          </section>

          <Panel title={`Making their own way (${ownTransport.length})`}>
            <ul className="divide-y divide-line">
              {ownTransport.map((booking) => (
                <li key={booking.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <UserX className="h-3.5 w-3.5 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{booking.lead_name}</span>
                  <span className="tabular text-xs text-muted">{booking.pax_total}</span>
                  <button
                    type="button"
                    onClick={() => togglePickup(booking, true)}
                    className="shrink-0 rounded px-1.5 py-1 text-xs font-semibold text-accent transition hover:bg-shell"
                  >
                    Needs pickup
                  </button>
                </li>
              ))}
              {ownTransport.length === 0 ? (
                <li className="px-3 py-4 text-center text-xs font-medium text-muted">Everyone is being collected.</li>
              ) : null}
            </ul>
          </Panel>
        </div>

        <div className="grid gap-3 xl:grid-cols-2">
          {runs.map((run) => {
            const stops = byRun.get(run.id) ?? [];
            const pax = stops.reduce((sum, booking) => sum + booking.pax_total, 0);
            const seats = run.transport_vehicles?.capacity_pax ?? 0;
            const full = seats > 0 && pax >= seats;
            return (
              <section
                key={run.id}
                {...dropProps(run.id)}
                className={`flex flex-col rounded-lg border-2 bg-surface ${full ? 'border-coral/50' : 'border-line'}`}
              >
                <header className="border-b border-line px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                        <Bus className="h-4 w-4 shrink-0 text-accent" />
                        <span className="truncate">{run.transport_vehicles?.code ?? 'No vehicle'}</span>
                        {run.transport_vehicles?.name ? (
                          <span className="truncate text-xs font-medium text-muted">{run.transport_vehicles.name}</span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 truncate text-xs font-medium text-muted">{run.name}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className={`text-sm font-bold tabular ${full ? 'text-coral' : 'text-accent'}`}>
                        {pax}/{seats || '—'}
                      </span>
                      <button type="button" onClick={() => reorder(run)} aria-label="Reorder route" className="grid h-7 w-7 place-items-center rounded text-muted transition hover:bg-shell hover:text-accent">
                        <Route className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => { setEditingRun(run); setRunFormOpen(true); }} aria-label="Edit run" className="grid h-7 w-7 place-items-center rounded text-muted transition hover:bg-shell hover:text-ink">
                        <Clock className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => removeRun(run)} aria-label="Delete run" className="grid h-7 w-7 place-items-center rounded text-muted transition hover:bg-shell hover:text-danger">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                    {time(run.depart_time) ? <Badge tone="accent">Leaves {time(run.depart_time)}</Badge> : null}
                    <Badge>{drivers.find((d) => d.id === run.driver_employee_id)?.full_name ?? 'No driver'}</Badge>
                    <Badge>{stops.length} stop{stops.length === 1 ? '' : 's'}</Badge>
                  </p>
                </header>

                <ol className="grid gap-1.5 p-2.5">
                  {stops.map((booking, index) => (
                    <li key={booking.id} className="flex items-start gap-2">
                      <span className="mt-2 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-shell text-[0.625rem] font-bold tabular text-muted">
                        {booking.pickup_stop_order ?? index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <PickupCard
                          booking={booking}
                          held={held === booking.id}
                          dragProps={dragProps}
                          onOptOut={() => togglePickup(booking, false)}
                          compact
                        />
                      </div>
                    </li>
                  ))}
                  {stops.length === 0 ? (
                    <li className="rounded border border-dashed border-line px-3 py-5 text-center text-xs font-medium text-muted">
                      Drop bookings here
                    </li>
                  ) : null}
                </ol>
              </section>
            );
          })}
          {runs.length === 0 && !loading ? (
            <div className="xl:col-span-2">
              <EmptyState>
                No runs planned yet. Press <strong>Plan the runs</strong> and the vans fill themselves by area.
              </EmptyState>
            </div>
          ) : null}
        </div>
      </div>

      {runFormOpen ? (
        <RunForm
          run={editingRun}
          date={date}
          vehicles={vehicles}
          drivers={drivers}
          onClose={() => setRunFormOpen(false)}
          onSaved={() => { setRunFormOpen(false); void refresh(); }}
        />
      ) : null}
    </>
  );
}

function PickupCard({
  booking,
  held,
  dragProps,
  onOptOut,
  compact = false,
}: {
  booking: Booking;
  held: boolean;
  dragProps: (id: string) => Record<string, unknown>;
  onOptOut: () => void;
  compact?: boolean;
}) {
  return (
    <article
      {...dragProps(booking.id)}
      className={`cursor-grab rounded border p-2 text-left transition active:cursor-grabbing ${
        held ? 'border-accent bg-accent/8 ring-1 ring-accent' : 'border-line bg-surface hover:border-accent/40'
      }`}
    >
      <p className="flex items-center justify-between gap-2 text-sm font-semibold text-ink">
        <span className="min-w-0 truncate">{booking.lead_name}</span>
        <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-xs font-bold tabular text-white">
          {booking.pax_total}
        </span>
      </p>
      <p className="mt-0.5 flex items-center gap-1 truncate text-xs font-medium text-muted">
        <MapPin className="h-3 w-3 shrink-0" />
        {booking.pickup_hotel_name ?? 'No hotel recorded'}
        {booking.pickup_eta ? <span className="ml-1 tabular text-accent">{booking.pickup_eta.slice(0, 5)}</span> : null}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <PaxChip label="adult" count={booking.pax_adults} />
        <PaxChip label="child" count={booking.pax_children} tone="warn" />
        <PaxChip label="elderly" count={booking.pax_elderly} tone="warn" />
        <PaxChip label="needs help" count={booking.pax_assisted} tone="alert" />
        {!compact ? (
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); onOptOut(); }}
            className="ml-auto rounded px-1.5 py-0.5 text-[0.6875rem] font-semibold text-muted transition hover:bg-shell hover:text-ink"
          >
            No pickup
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function PaxChip({
  label,
  count,
  tone = 'default',
}: {
  label: string;
  count: number;
  tone?: 'default' | 'warn' | 'alert';
}) {
  if (!count) return null;
  const tones = {
    default: 'bg-shell text-muted',
    warn: 'bg-warning/12 text-warning',
    alert: 'bg-coral/12 text-coral',
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-[0.6875rem] font-semibold tabular ${tones[tone]}`}>
      {count} {label}
    </span>
  );
}

function RunForm({
  run,
  date,
  vehicles,
  drivers,
  onClose,
  onSaved,
}: {
  run: PickupRun | null;
  date: string;
  vehicles: TransportVehicle[];
  drivers: Employee[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(run?.name ?? '');
  const [vehicleId, setVehicleId] = useState(run?.vehicle_id ?? vehicles[0]?.id ?? '');
  const [driverId, setDriverId] = useState(run?.driver_employee_id ?? '');
  const [departTime, setDepartTime] = useState(time(run?.depart_time) ?? '');
  const [status, setStatus] = useState(run?.status ?? 'planned');
  const [notes, setNotes] = useState(run?.notes ?? '');
  const [busy, setBusy] = useState(false);

  async function submit() {
    const vehicle = vehicles.find((item) => item.id === vehicleId);
    setBusy(true);
    const { error } = await supabase.rpc('save_pickup_run', {
      p_id: run?.id ?? null,
      p_service_date: date,
      p_name: name.trim() || `${vehicle?.code ?? 'Run'} route`,
      p_vehicle_id: vehicleId || null,
      p_driver_employee_id: driverId || null,
      p_depart_time: departTime,
      p_status: status,
      p_notes: notes,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Run saved.');
    onSaved();
  }

  return (
    <Modal
      title={run ? `Edit ${run.name}` : 'New pickup run'}
      onClose={onClose}
      footer={
        <button type="button" className={`${buttonClass} w-full`} disabled={busy} onClick={submit}>
          {busy ? 'Saving…' : 'Save run'}
        </button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Run name" hint="Something the driver will recognise, like “Marina area”.">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Marina area" />
          </Field>
        </div>
        <Field label="Vehicle">
          <select className={inputClass} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">No vehicle yet</option>
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.code} · {vehicle.capacity_pax} seats
              </option>
            ))}
          </select>
        </Field>
        <Field label="Driver">
          <select className={inputClass} value={driverId} onChange={(e) => setDriverId(e.target.value)}>
            <option value="">Not set</option>
            {drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.full_name}</option>)}
          </select>
        </Field>
        <Field label="Leaves at" hint="Left blank, the route ordering works it out.">
          <input type="time" className={inputClass} value={departTime} onChange={(e) => setDepartTime(e.target.value)} />
        </Field>
        <Field label="Status">
          <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as PickupRun['status'])}>
            <option value="planned">Planned</option>
            <option value="on_the_road">On the road</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Notes for the driver">
            <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
