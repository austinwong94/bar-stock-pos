import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Lock, LockOpen, RefreshCw, Ship, Users } from 'lucide-react';
import { PageHeader, Stat } from '../../components/Page';
import { Field, buttonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { useToast } from '../../components/Toast';
import { supabase } from '../../lib/supabase';
import { useAccess } from '../../lib/access';
import { useCardMover } from '../../lib/dragdrop';
import { loadBoats, loadEmployees, readErrorMessage, sourceLabels, todayIso } from '../../lib/opsData';
import type { Boat, BoatAssignment, Booking, Employee, TripBooking } from '../../lib/platformTypes';

const UNASSIGNED = 'unassigned';

export default function BoatBoard() {
  const toast = useToast();
  const { can } = useAccess();
  const [date, setDate] = useState(todayIso);
  const [boats, setBoats] = useState<Boat[]>([]);
  const [assignments, setAssignments] = useState<BoatAssignment[]>([]);
  const [tripBookings, setTripBookings] = useState<TripBooking[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [captains, setCaptains] = useState<Employee[]>([]);
  const [guides, setGuides] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  const canAssign = can('fleet.assign');
  const canCrew = can('fleet.crew.assign');
  const canLock = can('fleet.finalize');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const assignmentResult = canAssign
        ? await supabase.rpc('ensure_boat_assignments', { p_service_date: date })
        : await supabase.from('boat_assignments').select('*').eq('service_date', date).order('trip_no');
      if (assignmentResult.error) throw assignmentResult.error;
      const rows = (assignmentResult.data ?? []) as BoatAssignment[];
      const ids = rows.map((row) => row.id);

      const [boatRows, tripResult, bookingResult, captainRows, guideRows] = await Promise.all([
        loadBoats(true),
        ids.length
          ? supabase.from('trip_bookings').select('*').in('assignment_id', ids)
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from('bookings')
          .select('*, agencies(id,name,source_type)')
          .eq('service_date', date)
          .neq('status', 'cancelled')
          .order('lead_name'),
        loadEmployees(['captain']).catch(() => []),
        loadEmployees(['guide']).catch(() => []),
      ]);

      setAssignments(rows);
      setBoats(boatRows);
      setTripBookings((tripResult.data ?? []) as TripBooking[]);
      setBookings((bookingResult.data ?? []) as Booking[]);
      setCaptains(captainRows);
      setGuides(guideRows);
    } catch (error) {
      toast.error(readErrorMessage(error, 'Could not load the boat board.'));
    }
    setLoading(false);
  }, [canAssign, date, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const boatById = useMemo(() => new Map(boats.map((boat) => [boat.id, boat])), [boats]);
  const bookingById = useMemo(() => new Map(bookings.map((booking) => [booking.id, booking])), [bookings]);
  const assignmentOfBooking = useMemo(() => {
    const map = new Map<string, string>();
    tripBookings.forEach((row) => map.set(row.booking_id, row.assignment_id));
    return map;
  }, [tripBookings]);

  const move = useCallback(
    async (bookingId: string, targetId: string) => {
      if (targetId === UNASSIGNED) {
        const { error } = await supabase.rpc('unassign_booking', { p_booking_id: bookingId });
        if (error) { toast.error(error.message); return; }
        void refresh();
        return;
      }
      const { error } = await supabase.rpc('assign_booking_to_boat', {
        p_booking_id: bookingId,
        p_assignment_id: targetId,
      });
      if (error) { toast.error(error.message); return; }
      void refresh();
    },
    [refresh, toast],
  );

  const { held, dragProps, dropProps } = useCardMover(move);

  const groupedBookings = useMemo(() => {
    const map = new Map<string, Booking[]>();
    map.set(UNASSIGNED, []);
    assignments.forEach((assignment) => map.set(assignment.id, []));
    bookings.forEach((booking) => {
      const assignmentId = assignmentOfBooking.get(booking.id);
      const key = assignmentId && map.has(assignmentId) ? assignmentId : UNASSIGNED;
      map.get(key)!.push(booking);
    });
    return map;
  }, [assignmentOfBooking, assignments, bookings]);

  const unassigned = groupedBookings.get(UNASSIGNED) ?? [];
  const unassignedPax = unassigned.reduce((sum, booking) => sum + booking.pax_total, 0);
  const totalPax = bookings.reduce((sum, booking) => sum + booking.pax_total, 0);
  const seatedPax = totalPax - unassignedPax;
  const capacity = assignments.reduce((sum, assignment) => sum + (boatById.get(assignment.boat_id)?.capacity_pax ?? 0), 0);
  const locked = assignments.some((assignment) => assignment.locked);
  const maintenanceBoats = boats.filter((boat) => boat.status === 'maintenance');

  async function setCrew(assignment: BoatAssignment, patch: { captain?: string; guide?: string; departure?: string }) {
    const { error } = await supabase.rpc('set_trip_crew', {
      p_assignment_id: assignment.id,
      p_captain_employee_id: patch.captain === undefined ? null : patch.captain || null,
      p_guide_employee_id: patch.guide === undefined ? null : patch.guide || null,
      p_departure_time: patch.departure ?? null,
      p_status: null,
      p_clear_captain: patch.captain === '',
      p_clear_guide: patch.guide === '',
    });
    if (error) { toast.error(error.message); return; }
    void refresh();
  }

  async function toggleLock() {
    const { error } = await supabase.rpc('set_day_locked', { p_service_date: date, p_locked: !locked });
    if (error) { toast.error(error.message); return; }
    toast.success(locked ? 'Day unlocked.' : 'Day locked. The manifest is frozen.');
    void refresh();
  }

  return (
    <>
      <PageHeader
        title="Boat Board"
        subtitle="Drag a booking onto a boat and the whole group moves together. Tap a card then tap a boat on a tablet."
        actions={
          <>
            <button type="button" className={secondaryButtonClass} onClick={() => void refresh()}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
            {canLock ? (
              <button type="button" className={buttonClass} onClick={toggleLock}>
                {locked ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                {locked ? 'Unlock day' : 'Lock day'}
              </button>
            ) : null}
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-white/85 p-3 shadow-soft">
        <Field label="Service date">
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {held ? (
          <p className="ml-auto rounded-2xl bg-accent px-4 py-2 text-sm font-black text-white">
            Group picked up. Tap a boat to seat them.
          </p>
        ) : null}
      </div>

      <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Boats in service" value={String(assignments.length)} />
        <Stat label="Seats available" value={String(capacity)} />
        <Stat label="Assigned pax" value={`${seatedPax} / ${totalPax}`} tone={seatedPax === totalPax ? 'good' : 'default'} />
        <Stat label="Waiting for a boat" value={String(unassignedPax)} tone={unassignedPax > 0 ? 'warn' : 'good'} />
      </div>

      {maintenanceBoats.length > 0 ? (
        <p className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-warning bg-amber-50 px-3 py-2 text-sm font-black text-amber-900">
          <AlertTriangle className="h-4 w-4" />
          Out of service today: {maintenanceBoats.map((boat) => boat.code).join(', ')}
        </p>
      ) : null}

      {locked ? (
        <p className="mb-3 rounded-2xl border border-line bg-shell px-3 py-2 text-sm font-black">
          This day is locked. Unlock it to change boats.
        </p>
      ) : null}

      {loading ? <p className="p-4 font-bold">Loading...</p> : null}

      <div className="grid gap-3 lg:grid-cols-[20rem_1fr]">
        <section
          {...dropProps(UNASSIGNED)}
          className="rounded-2xl border-2 border-dashed border-coral bg-white/70 p-3 shadow-soft"
        >
          <h2 className="mb-2 flex items-center gap-2 text-sm font-black">
            <Users className="h-4 w-4 text-coral" /> Not on a boat ({unassignedPax} pax)
          </h2>
          <div className="grid gap-2">
            {unassigned.map((booking) => (
              <GroupCard key={booking.id} booking={booking} held={held === booking.id} dragProps={dragProps} />
            ))}
            {unassigned.length === 0 ? (
              <p className="rounded-xl bg-teal-50 px-3 py-4 text-center text-sm font-bold text-accent">
                Everyone has a boat.
              </p>
            ) : null}
          </div>
        </section>

        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {assignments.map((assignment) => {
            const boat = boatById.get(assignment.boat_id);
            const items = groupedBookings.get(assignment.id) ?? [];
            const pax = items.reduce((sum, booking) => sum + booking.pax_total, 0);
            const seats = boat?.capacity_pax ?? 0;
            const left = Math.max(seats - pax, 0);
            const full = seats > 0 && pax >= seats;
            return (
              <section
                key={assignment.id}
                {...dropProps(assignment.id)}
                className={`flex flex-col rounded-2xl border-2 bg-white/90 p-3 shadow-soft ${
                  full ? 'border-coral' : 'border-line'
                }`}
              >
                <header className="mb-2 border-b border-line pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-base font-black">
                        <Ship className="h-4 w-4 shrink-0 text-accent" />
                        {boat?.code ?? 'Boat'}
                      </p>
                      <p className="truncate text-xs font-semibold text-neutral-600">
                        {boat?.name ? `${boat.name} · ` : ''}{boat?.boat_type}
                        {boat?.ownership !== 'owned' ? ` · ${boat?.ownership}` : ''}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`text-lg font-black leading-none ${full ? 'text-coral' : 'text-accent'}`}>
                        {pax}/{seats}
                      </p>
                      <p className="text-[11px] font-bold uppercase text-neutral-500">{left} seat(s) left</p>
                    </div>
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-1">
                    <select
                      className={inputClass}
                      value={assignment.captain_employee_id ?? ''}
                      disabled={!canCrew}
                      onChange={(e) => setCrew(assignment, { captain: e.target.value })}
                      aria-label="Captain"
                    >
                      <option value="">Captain…</option>
                      {captains.map((employee) => (
                        <option key={employee.id} value={employee.id}>{employee.full_name}</option>
                      ))}
                    </select>
                    <select
                      className={inputClass}
                      value={assignment.guide_employee_id ?? ''}
                      disabled={!canCrew}
                      onChange={(e) => setCrew(assignment, { guide: e.target.value })}
                      aria-label="Tour guide"
                    >
                      <option value="">Guide…</option>
                      {guides.map((employee) => (
                        <option key={employee.id} value={employee.id}>{employee.full_name}</option>
                      ))}
                    </select>
                  </div>
                  <input
                    type="time"
                    className={`${inputClass} mt-1`}
                    defaultValue={assignment.departure_time?.slice(0, 5) ?? ''}
                    disabled={!canCrew}
                    onBlur={(e) => {
                      if ((assignment.departure_time?.slice(0, 5) ?? '') !== e.target.value) {
                        void setCrew(assignment, {
                          captain: assignment.captain_employee_id ?? undefined,
                          guide: assignment.guide_employee_id ?? undefined,
                          departure: e.target.value,
                        });
                      }
                    }}
                    aria-label="Departure time"
                  />
                </header>

                <div className="grid gap-2">
                  {items.map((booking) => (
                    <GroupCard
                      key={booking.id}
                      booking={booking}
                      held={held === booking.id}
                      dragProps={dragProps}
                      onboard
                    />
                  ))}
                  {items.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-line px-3 py-5 text-center text-xs font-bold text-neutral-500">
                      Drop a group here
                    </p>
                  ) : null}
                </div>
              </section>
            );
          })}
          {assignments.length === 0 && !loading ? (
            <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm font-bold text-neutral-500">
              No boats are active. Add boats in the Boat Register first.
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
}

function GroupCard({
  booking,
  held,
  dragProps,
  onboard = false,
}: {
  booking: Booking;
  held: boolean;
  dragProps: (id: string) => Record<string, unknown>;
  onboard?: boolean;
}) {
  return (
    <article
      {...dragProps(booking.id)}
      className={`cursor-grab rounded-xl border p-2.5 shadow-sm transition active:cursor-grabbing ${
        held ? 'border-accent bg-teal-50 ring-2 ring-accent' : onboard ? 'border-line bg-shell/70' : 'border-line bg-white'
      }`}
    >
      <p className="flex items-center justify-between gap-2 text-sm font-black">
        <span className="min-w-0 truncate">{booking.lead_name}</span>
        <span className="shrink-0 rounded-lg bg-accent px-2 py-0.5 text-xs text-white">{booking.pax_total} pax</span>
      </p>
      <p className="mt-0.5 truncate text-xs font-semibold text-neutral-600">
        {booking.booking_ref} · {sourceLabels[booking.source_type] ?? booking.source_type}
        {booking.pax_children > 0 ? ` · ${booking.pax_children} child` : ''}
      </p>
      {booking.pickup_hotel_name ? (
        <p className="truncate text-[11px] font-semibold text-neutral-500">{booking.pickup_hotel_name}</p>
      ) : null}
    </article>
  );
}
