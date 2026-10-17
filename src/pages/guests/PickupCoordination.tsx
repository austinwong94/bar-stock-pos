import { useBusinessDate } from '../../lib/useBusinessDate';
import { BookingDateNavigation } from '../../components/BookingDateNavigation';
import { useSharedRefresh } from '../../lib/useSharedRefresh';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bus, GripVertical, Pencil, MapPin, Plus, Search, Sparkles, Trash2, UserX, Users } from 'lucide-react';
import { PageHeader, Panel, Badge, EmptyState } from '../../components/Page';
import { Field, buttonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { ChoiceButtons } from '../../components/ChoiceButtons';
import PassengerBreakdown from '../../components/PassengerBreakdown';
import { useToast } from '../../components/Toast';
import { supabase } from '../../lib/supabase';
import { useCardMover } from '../../lib/dragdrop';
import { loadEmployees, readErrorMessage } from '../../lib/opsData';
import type { Booking, Employee, PickupRun, TransportVehicle } from '../../lib/platformTypes';
import type { SettingsMap } from '../../lib/types';
import { pickupName, pickupPax, pickupStops, suggestPickups, type PickupBoard } from '../../lib/pickupPlanning';
import PickupPlanReview, { PickupPlace, PickupPointForm } from './PickupPlanReview';

const NO_RUN = 'no-run';

const time = (value: string | null | undefined) => (value ? value.slice(0, 5) : null);

// Auto named runs read "Van 2 · Sunset Beach Villa"; the code is already on the
// line above, so the card shows just the route.
function routeLabel(run: PickupRun) {
  const code = run.transport_vehicles?.code;
  if(code && [`${code.toLowerCase()} pickup`,`${code.toLowerCase()} route`].includes(run.name.toLowerCase())) return '';
  if (code && run.name.startsWith(`${code} · `)) return run.name.slice(code.length + 3);
  return run.name;
}

export default function PickupCoordination({ settings }: { settings: SettingsMap }) {
  const toast = useToast();
  const [date, setDate] = useBusinessDate('guests');
  const radius = Math.min(50, Math.max(0.1, Number(settings.pickup_group_radius_km) || 1.5));
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [runs, setRuns] = useState<PickupRun[]>([]);
  const [vehicles, setVehicles] = useState<TransportVehicle[]>([]);
  const [drivers, setDrivers] = useState<Employee[]>([]);
  const [editingRun, setEditingRun] = useState<PickupRun | null>(null);
  const [runFormOpen, setRunFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [board, setBoard] = useState<PickupBoard | null>(null);
  const [draft, setDraft] = useState<PickupBoard | null>(null);
  const [point, setPoint] = useState<Booking | null>(null);
  const [loadError, setLoadError] = useState('');
  const [view, setView] = useState<'vans' | 'waiting' | 'own'>('vans');
  const [search, setSearch] = useState('');
  const [feedback, setFeedback] = useState('');
  const writing = useRef(false);
  const request = useRef(0);

  const refresh = useCallback(async () => {
    const current = ++request.current;
    try {
      const [result, driverRows] = await Promise.all([
        supabase.rpc('read_pickup_board', {p_date: date}),
        loadEmployees(['driver', 'guide', 'crew']).catch(() => []),
      ]);
      if(current !== request.current) return;
      if (result.error) throw result.error;
      const next = result.data as PickupBoard;
      setBoard(next); setLoadError('');
      setBookings(next.bookings);
      setRuns(next.runs.filter(r => r.status !== 'cancelled'));
      setVehicles(next.vehicles);
      setDrivers(driverRows);
    } catch (error) {
      if(current !== request.current) return;
      setLoadError(readErrorMessage(error, 'Could not load the pickup board.'));
    }
    setLoading(false);
  }, [date]);

  useEffect(() => {
    setLoading(true);
    void refresh();
    return () => {request.current++;};
  }, [refresh]);

  useSharedRefresh(refresh, { tables: ["bookings","pickup_groups","transport_vehicles","pickup_locations"] });

  const move = useCallback(
    async (bookingId: string, targetId: string) => {
      const booking = bookings.find(b => b.id === bookingId);
      if(!booking || busy || writing.current || (booking.pickup_group_id ?? NO_RUN) === targetId) return;
      writing.current = true; setBusy(true);
      try { const { error } = await supabase.rpc('assign_pickup_run_checked', {
        p_booking_id: bookingId,
        p_run_id: targetId === NO_RUN ? null : targetId,
        p_expected_updated_at: booking.updated_at,
      });
      if (error) throw error;
      setFeedback(`${booking.pax_total} pax ${targetId === NO_RUN ? 'Returned to Waiting' : `Assigned to ${runs.find(r => r.id === targetId)?.transport_vehicles?.code ?? 'Van'}`}`);
      } catch (error) { toast.error(readErrorMessage(error, 'Could not save the assignment. Refresh before retrying.')); }
      finally { await refresh(); writing.current = false; setBusy(false); }
    },
    [refresh, toast, bookings, busy, runs],
  );

  const { held, release, dragProps, dropProps } = useCardMover(move);

  const needPickup = useMemo(() => bookings.filter((booking) => booking.pickup_required), [bookings]);
  const ownTransport = useMemo(() => bookings.filter((booking) => !booking.pickup_required), [bookings]);
  const waiting = needPickup.filter((booking) => !booking.pickup_group_id);
  const matches = (b: Booking) => `${b.lead_name} ${pickupName(b)} ${b.pickup_area ?? ''}`.toLowerCase().includes(search.trim().toLowerCase());
  const suggestion = useMemo(() => board ? suggestPickups(board, Number(radius) || 1.5, board.vehicles.map(v => v.id)) : null, [board, radius]);
  const suggestedGroups = suggestion?.groups.filter(g => g.bookings.length) ?? [];

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
    if(board && Number(radius)>0 && Number(radius)<=50) setDraft(structuredClone(board));
  }

  async function removeRun(run: PickupRun) {
    if (!window.confirm(`Delete "${run.name}"? Its bookings go back to the waiting list.`)) return;
    const { error } = await supabase.rpc('delete_pickup_run', { p_run_id: run.id });
    if (error) { toast.error(error.message); return; }
    void refresh();
  }

  async function togglePickup(booking: Booking, required: boolean) {
    if (writing.current || busy) return;
    writing.current = true; setBusy(true);
    try {
      const { error } = await supabase.rpc('set_booking_pickup', { p_booking_id: booking.id, p_required: required });
      if (error) throw error;
      setFeedback(`${booking.lead_name} · ${booking.pax_total} pax · ${required ? 'Returned to Waiting' : 'Own Transport'}`);
    } catch (error) {
      toast.error(readErrorMessage(error, 'Could not change pickup. Refresh before retrying.'));
    } finally {
      await refresh(); writing.current = false; setBusy(false);
    }
  }

  const paxWaiting = waiting.reduce((sum, booking) => sum + booking.pax_total, 0);
  const paxCollected = pickupPax(needPickup) - paxWaiting;
  const ownPax = pickupPax(ownTransport);

  return (
    <div className="pickup-workspace">
      <div className="hidden lg:block"><PageHeader title="Pickup & Transport" /></div>

      <BookingDateNavigation date={date} disabled={busy} onDate={value => {release();setSearch('');setBoard(null);setBookings([]);setRuns([]);setDate(value);}} />
      <div className="mb-3">
        <label className="relative block min-w-0"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted" /><input className={`${inputClass} pl-9`} aria-label="Find Guest or Location" placeholder="Find Guests" value={search} onChange={e => setSearch(e.target.value)} /></label>
      </div>

      <dl className="mb-4 grid grid-cols-4 divide-x divide-line border-y border-line py-3 text-center text-xs">
        {([['Pickup', pickupPax(needPickup)], ['Assigned', paxCollected], ['Waiting', paxWaiting], ['Own Transport', ownPax]] as const).map(([label,value]) => <div key={label} className="min-w-0 px-1"><dt className="flex min-h-8 items-center justify-center text-muted">{label}</dt><dd className="mt-1 text-base font-bold tabular">{value} <span className="text-xs font-medium text-muted">pax</span></dd></div>)}
      </dl>
      <section aria-label="Recommended Plan" className="mb-4 flex flex-wrap items-center justify-between gap-3 border-l-4 border-accent bg-shell px-3 py-3">
        <div className="min-w-0 text-sm"><h2 className="font-bold">Recommended Plan</h2><p className="mt-1 text-xs text-muted">{waiting.length ? `${pickupPax(suggestedGroups.flatMap(g => g.bookings))} of ${paxWaiting} waiting pax grouped · ${suggestedGroups.length} ${suggestedGroups.length===1?'van':'vans'}` : 'All Pickup Guests Assigned'}</p></div>
        <button type="button" className={`${buttonClass} w-full sm:w-auto`} onClick={autoPlan} disabled={busy || loading || !!loadError || !board || !waiting.length}><Sparkles className="h-4 w-4" />Review Recommended</button>
      </section>
      <div role="tablist" aria-label="Pickup Views" className="mb-4 grid grid-cols-3 gap-1 rounded-lg border border-line bg-surface p-1 text-sm">
        {([['vans','Vans',runs.length],['waiting','Waiting',paxWaiting],['own','Own Transport',ownPax]] as const).map(([id,label,count]) => <button role="tab" aria-selected={view===id} key={id} onClick={()=>{setView(id);release();}} className={`min-h-11 rounded-md px-1 py-2 text-xs font-semibold ${view===id?'bg-accent text-white':'text-muted'}`}>{label} <span className="tabular">{count}</span></button>)}
      </div>

      {loading ? <p className="py-6 text-center text-sm font-medium text-muted">Loading…</p> : null}
      {loadError ? <div role="alert" className="mb-4 text-sm text-danger">{loadError} <button className={secondaryButtonClass} onClick={() => void refresh()}>Retry</button></div> : null}
      <div role="status" className="mb-2 flex h-8 items-center justify-between gap-2 text-xs font-semibold text-accent">
        <span>{held ? 'Booking Selected' : feedback}</span>
        {held ? <button type="button" onClick={release} className="shrink-0 px-2 py-2 underline">Cancel</button> : null}
      </div>

      <div className={view === 'vans' && waiting.length ? 'pickup-workspace-grid' : 'grid gap-4'}>
        <div className={`${view==='vans'?(waiting.length?'hidden lg:grid lg:order-last':'hidden'):'grid'} min-w-0 content-start gap-4`}>
          <section
            {...dropProps(NO_RUN)}
            aria-label="Waiting Guests"
            className={`${view==='own'?'hidden ':''}rounded-lg border border-line bg-surface`}
          >
            <h2 className="flex items-center gap-2 border-b border-line px-3 py-3 text-sm font-semibold text-ink">
              <Users className="h-4 w-4 text-warning" /> Waiting · {paxWaiting} pax
            </h2>
            <div className={view==='vans'?'pickup-waiting-list':''}>
              {waiting.filter(matches).map((booking) => (
                <PickupCard key={booking.id} booking={booking} disabled={busy || loading || !!loadError} allBookings={needPickup} held={held === booking.id} dragProps={dragProps} onOptOut={() => togglePickup(booking, false)} onLocation={() => setPoint(booking)} runs={runs} onMove={id => void move(booking.id,id)} />
              ))}
              {waiting.length === 0 ? (
                <p className="rounded border border-dashed border-line px-3 py-4 text-center text-xs font-medium text-muted">
                  Everyone who needs collecting has a vehicle.
                </p>
              ) : null}
            </div>
          </section>

          {view==='own' ? <Panel title={`Own Transport · ${ownPax} pax`}>
            <ul className="divide-y divide-line">
              {ownTransport.filter(matches).map((booking) => (
                <li key={booking.id} data-pickup-booking={booking.id} className="min-w-0 px-3 py-3 text-sm">
                  <div className="flex items-start gap-2">
                    <UserX className="mt-1 h-3.5 w-3.5 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 [overflow-wrap:anywhere] font-semibold text-ink">{booking.lead_name}</span>
                    <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-xs font-bold tabular text-white">{booking.pax_total} pax</span>
                  </div>
                  <div className="mt-1"><PassengerBreakdown counts={booking} /></div>
                  <button
                    type="button"
                    disabled={busy || loading || !!loadError}
                    onClick={() => togglePickup(booking, true)}
                    className={`${secondaryButtonClass} mt-2 !text-xs`}
                  >
                    Add Pickup
                  </button>
                </li>
              ))}
              {ownTransport.length === 0 ? (
                <li className="px-3 py-4 text-center text-xs font-medium text-muted">Everyone is being collected.</li>
              ) : null}
            </ul>
          </Panel> : null}
        </div>

        <section aria-label="Pickup Vans" className={`${view!=='vans'?'hidden ':''}min-w-0`}>
          <header className="mb-3 flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-base font-bold"><Bus className="h-5 w-5 text-accent" />Pickup Vans</h2><button type="button" className={secondaryButtonClass} disabled={busy || loading || !!loadError} onClick={() => { setEditingRun(null); setRunFormOpen(true); }}><Plus className="h-4 w-4" />Add Van</button></header>
          <div className="min-w-0 space-y-3 gap-3 xl:columns-2">
          {runs.filter(r=>!search || (byRun.get(r.id)??[]).some(matches) || `${r.name} ${r.transport_vehicles?.code}`.toLowerCase().includes(search.toLowerCase())).map((run) => {
            const stops = byRun.get(run.id) ?? [];
            const pax = stops.reduce((sum, booking) => sum + booking.pax_total, 0);
            const seats = run.transport_vehicles?.capacity_pax ?? 0;
            const full = seats > 0 && pax > seats;
            return (
              <section
                key={run.id}
                data-pickup-van={run.id}
                {...dropProps(run.id)}
                className={`min-w-0 break-inside-avoid overflow-hidden rounded-lg border bg-surface ${full ? 'border-alert/50' : held ? 'border-accent ring-1 ring-accent/20' : 'border-line'}`}
              >
                <header className="border-b border-line px-3 py-2.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                        <Bus className="h-4 w-4 shrink-0 text-accent" />
                        {/* The vehicle code is what a driver is called by, so it
                            never truncates; the model gives way instead. */}
                        <span className="shrink-0 whitespace-nowrap">{run.transport_vehicles?.code ?? 'No vehicle'}</span>
                        {run.transport_vehicles?.name ? (
                          <span className="truncate text-xs font-medium text-muted">{run.transport_vehicles.name}</span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-xs font-medium text-muted">{routeLabel(run)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className={`text-sm font-bold tabular ${full ? 'text-alert' : 'text-accent'}`}>
                        {pax}/{seats || '—'} pax
                      </span>
                    </div>
                  </div>
                  <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                    <Badge tone="accent">{time(run.depart_time) ? `Starts ${time(run.depart_time)}` : 'Time Not Set'}</Badge>
                    <Badge>{drivers.find((d) => d.id === run.driver_employee_id)?.full_name ?? 'Driver Not Set'}</Badge>
                    <Badge>{pickupStops(stops).length} {pickupStops(stops).length === 1 ? 'location' : 'locations'} · {stops.length} {stops.length === 1 ? 'booking' : 'bookings'}</Badge>
                    <Badge>{Math.max(0,seats-pax)} {Math.max(0,seats-pax) === 1 ? 'seat' : 'seats'} left</Badge>
                  </p>
                  {runs.some(other=>other.id!==run.id && other.vehicle_id && other.vehicle_id===run.vehicle_id) ? <p role="alert" className="mt-2 text-xs font-semibold text-danger">Duplicate Van: Reassign Guests and Remove the Extra Entry.</p> : null}
                  <div className="mt-2 flex items-center gap-2"><button type="button" disabled={busy} onClick={e=>{e.stopPropagation();setEditingRun(run);setRunFormOpen(true);}} className={`${secondaryButtonClass} flex-1 !text-xs`}><Pencil className="h-4 w-4" />Driver & Time</button><button type="button" disabled={busy || run.status!=='planned'} title="Remove Van" aria-label={`Remove ${run.transport_vehicles?.code ?? run.name}`} onClick={e=>{e.stopPropagation();void removeRun(run);}} className={`${secondaryButtonClass} !px-3`}><Trash2 className="h-4 w-4" /></button></div>
                </header>

                <ol>
                  {pickupStops(stops).map((group, index, groups) => <li key={group[0].id} className="min-w-0 border-b border-line last:border-0">
                    <div className="flex items-start gap-2 border-b border-line bg-paper px-3 py-2"><span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-shell text-xs font-bold">{index+1}</span><PickupPlace booking={group[0]} previous={groups[index-1]?.[0]} /></div>
                    <div>{group.map(booking => <PickupCard key={booking.id} booking={booking} disabled={busy || !!loadError || run.status!=='planned'} allBookings={needPickup} held={held === booking.id} dragProps={dragProps} onOptOut={()=>togglePickup(booking,false)} onLocation={()=>setPoint(booking)} runs={runs} onMove={id=>void move(booking.id,id)} compact />)}</div>
                  </li>)}
                  {stops.length === 0 ? (
                    <li className="rounded border border-dashed border-line px-3 py-5 text-center text-xs font-medium text-muted">
                      No Guests Assigned
                    </li>
                  ) : null}
                </ol>
                <button type="button" className={`${secondaryButtonClass} m-2 lg:hidden`} onClick={e=>{e.stopPropagation();setView('waiting');}}><Plus className="h-4 w-4" />Assign Guests</button>
              </section>
            );
          })}
          {runs.length === 0 && !loading ? (
            <div className="xl:col-span-2">
              <EmptyState>
                No Vans Added
              </EmptyState>
            </div>
          ) : null}
          </div>
        </section>
      </div>

      <div className="mt-4 flex flex-wrap justify-between gap-2 text-xs text-muted"><span>Total Expected: <strong className="text-ink">{pickupPax(bookings)} pax</strong></span><span>Distances are straight-line estimates, not driving distances.</span></div>

      {runFormOpen ? (
        <RunForm
          run={editingRun}
          date={date}
          vehicles={vehicles}
          drivers={drivers}
          board={board!}
          onClose={() => setRunFormOpen(false)}
          onSaved={() => { setRunFormOpen(false); void refresh(); }}
        />
      ) : null}
      {draft ? <PickupPlanReview board={draft} date={date} radius={Number(radius)} onClose={() => setDraft(null)} onSaved={() => {setDraft(null);setSearch('');setView('vans');toast.success('Pickup Plan Confirmed');void refresh();}} /> : null}
      {point && board ? <PickupPointForm booking={point} board={board} onClose={() => setPoint(null)} onSaved={() => {setPoint(null);void refresh();}} /> : null}
    </div>
  );
}

function PickupCard({
  booking,
  held,
  dragProps,
  onOptOut,
  compact = false,
  onLocation, runs, onMove, previous,
  disabled, allBookings,
}: {
  booking: Booking;
  held: boolean;
  dragProps: (id: string) => Record<string, unknown>;
  onOptOut: () => void;
  compact?: boolean;
  onLocation: () => void;
  runs: PickupRun[];
  onMove: (id: string) => void;
  previous?: Booking;
  disabled: boolean;
  allBookings: Booking[];
}) {
  return (
    <article
      data-pickup-booking={booking.id}
      onClick={e=>{e.stopPropagation();if(!disabled)(dragProps(booking.id).onClick as () => void)();}}
      className={`min-w-0 border-b border-line px-3 py-2.5 text-left last:border-b-0 ${
        held ? 'bg-shell ring-1 ring-inset ring-accent' : 'bg-surface'
      }`}
    >
      <p className="flex items-center justify-between gap-2 text-sm font-semibold text-ink">
        <button type="button" {...(!disabled ? dragProps(booking.id) : {})} disabled={disabled} aria-label={`Drag ${booking.lead_name}`} title="Drag to a Van" onClick={e=>{e.stopPropagation();if(!disabled)(dragProps(booking.id).onClick as () => void)();}} className="hidden h-8 w-6 shrink-0 cursor-grab items-center justify-center rounded text-muted hover:bg-shell active:cursor-grabbing lg:flex"><GripVertical className="h-4 w-4" /></button>
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{booking.lead_name}</span>
        <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-xs font-bold tabular text-white">
          {booking.pax_total} pax
        </span>
      </p>
      <div className="mt-1"><PassengerBreakdown counts={booking} /></div>
      {!compact ? <PickupPlace booking={booking} previous={previous} /> : null}
      <div className="mt-1 grid grid-cols-[1fr_auto] items-center gap-1" onClick={e=>e.stopPropagation()}>
        <select disabled={disabled} aria-label={`Move ${booking.lead_name}`} className={inputClass} value={booking.pickup_group_id ?? NO_RUN} onChange={e=>onMove(e.target.value)}><option value={NO_RUN}>{booking.pickup_group_id?'Return to Waiting':'Assign to Van...'}</option>{runs.map(r=>{const seats=(r.transport_vehicles?.capacity_pax ?? 0)-pickupPax(allBookings.filter(b=>b.pickup_group_id===r.id && b.id!==booking.id));return <option key={r.id} value={r.id} disabled={r.status !== 'planned' || seats<booking.pax_total}>{r.transport_vehicles?.code ?? r.name} · {r.id===booking.pickup_group_id?'Assigned':`${Math.max(0,seats)} Seats`}</option>;})}</select>
        <button disabled={disabled} className="grid h-11 w-11 place-items-center rounded-lg border border-line text-accent hover:bg-shell" title="Edit Pickup Location" aria-label={`Edit Location for ${booking.lead_name}`} onClick={onLocation}><MapPin className="h-4 w-4" /></button>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {!compact ? (
          <button
            type="button"
            disabled={disabled}
            onClick={(event) => { event.stopPropagation(); onOptOut(); }}
            className="ml-auto min-h-11 rounded px-2 text-xs font-semibold text-muted transition hover:bg-shell hover:text-ink"
          >
            Own Transport
          </button>
        ) : null}
      </div>
    </article>
  );
}


function RunForm({
  run,
  date,
  vehicles,
  drivers,
  board,
  onClose,
  onSaved,
}: {
  run: PickupRun | null;
  date: string;
  vehicles: TransportVehicle[];
  drivers: Employee[];
  board: PickupBoard;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(run?.name ?? '');
  const [vehicleId, setVehicleId] = useState(run?.vehicle_id ?? '');
  const [driverId, setDriverId] = useState(run?.driver_employee_id ?? '');
  const [departTime, setDepartTime] = useState(time(run?.depart_time) ?? '');
  const [status, setStatus] = useState(run?.status ?? 'planned');
  const [notes, setNotes] = useState(run?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const version = useRef(board.version);
  const pending = useRef<Record<string, any> | null>(null);
  const submitting = useRef(false);
  const taken = new Set(board.runs.filter(r=>r.id!==run?.id && r.status!=='cancelled').map(r=>r.vehicle_id));
  const pax = pickupPax(board.bookings.filter(b=>!!run && b.pickup_group_id===run.id));
  const valid = vehicles.some(v=>v.id===vehicleId && v.active && v.capacity_pax>=pax && !taken.has(v.id));

  async function submit() {
    if (submitting.current || (!pending.current && !valid)) return;
    const vehicle = vehicles.find((item) => item.id === vehicleId);
    submitting.current = true; setBusy(true); setError('');
    pending.current ??= {
      p_id: run?.id ?? null,
      p_service_date: date,
      p_name: name.trim() || `${vehicle?.code ?? 'Van'} Pickup`,
      p_version: version.current,
      p_request_id: crypto.randomUUID(),
      p_vehicle_id: vehicleId || null,
      p_driver_employee_id: driverId || null,
      p_depart_time: departTime,
      p_status: status,
      p_notes: notes,
    };
    try {
      const { error: failure } = await supabase.rpc('save_pickup_van_checked', pending.current);
      if (failure) { if(failure.code) pending.current=null; throw failure; }
      toast.success(run ? 'Van Updated' : 'Van Added'); onSaved();
    } catch (e) {setUncertain(!!pending.current);setError(readErrorMessage(e,'Save not confirmed. Retry to check the same van.'));}
    finally { submitting.current=false;setBusy(false); }
  }

  return (
    <Modal
      title={run ? 'Edit Van' : 'Add Van'}
      onClose={()=>{if(!busy)onClose();}}
      footer={
        <div className="grid gap-2">{error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}<button type="button" className={`${buttonClass} w-full`} disabled={busy || (!uncertain && !valid)} onClick={submit}><Bus className="h-4 w-4" />{busy ? 'Saving...' : uncertain ? 'Retry Saving' : run ? 'Save Changes' : 'Add Van'}</button></div>
      }
    >
      <fieldset disabled={busy || uncertain} className="grid min-w-0 gap-3 sm:grid-cols-2">
        <fieldset className="grid min-w-0 gap-2 sm:col-span-2"><legend className="mb-2 text-sm font-semibold">Choose Van</legend>
          {vehicles.map(v=>{const disabled=taken.has(v.id)||v.capacity_pax<pax||!v.active;return <label key={v.id} className={`flex min-w-0 items-center gap-3 rounded-lg border p-3 ${disabled?'border-line bg-paper text-muted':vehicleId===v.id?'border-accent bg-shell':'border-line bg-surface'}`}><input type="radio" name="pickup-van" value={v.id} checked={vehicleId===v.id} disabled={disabled} onChange={()=>{setVehicleId(v.id);if(!run)setDriverId(v.default_driver_employee_id??'');}} /><Bus className="h-5 w-5 shrink-0" /><span className="min-w-0 flex-1 text-sm"><strong className="block">{v.code}</strong><span className="text-xs text-muted">{v.name}</span></span><span className="text-right text-xs"><strong className="block">{v.capacity_pax} Seats</strong>{taken.has(v.id)?'Already Added':v.capacity_pax<pax?'Not Enough Seats':'Available'}</span></label>;})}
          {!vehicles.length?<p className="text-sm text-muted">No vans are registered. Add a vehicle in Admin & Access, Vehicles.</p>:null}
        </fieldset>
        <Field label="Driver">
          <select className={inputClass} value={driverId} onChange={(e) => setDriverId(e.target.value)}>
            <option value="">Assign Later</option>
            {drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.full_name}</option>)}
          </select>
        </Field>
        <Field label="Pickup Start Time">
          <input type="time" className={inputClass} value={departTime} onChange={(e) => setDepartTime(e.target.value)} />
        </Field>
        {run ? <fieldset className="min-w-0 sm:col-span-2"><legend className="mb-1.5 text-sm font-semibold text-muted">Status</legend>
          <ChoiceButtons label="Pickup Status" value={status} options={[[ 'planned', 'Planned' ], ['on_the_road', 'On the Road'], ['completed', 'Completed']]} onChange={setStatus} className="!grid-cols-3" />
        </fieldset> : null}
        <div className="sm:col-span-2"><Field label="Route Name (Optional)"><input className={inputClass} value={name} onChange={e=>setName(e.target.value)} placeholder="Marina Area" /></Field></div>
        <div className="sm:col-span-2">
          <Field label="Driver Notes (Optional)">
            <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      </fieldset>
    </Modal>
  );
}
