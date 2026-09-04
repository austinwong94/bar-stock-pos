import { useCallback, useEffect, useMemo, useState } from 'react';
import { MapPinned, Plus, Sparkles, Trash2, Users } from 'lucide-react';
import { PageHeader, Stat } from '../../components/Page';
import { Field, buttonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { useToast } from '../../components/Toast';
import { supabase } from '../../lib/supabase';
import { useCardMover } from '../../lib/dragdrop';
import { loadEmployees, readErrorMessage, sourceLabels, todayIso } from '../../lib/opsData';
import type { Booking, Employee, PickupGroup } from '../../lib/platformTypes';
import type { SettingsMap } from '../../lib/types';

const UNGROUPED = 'ungrouped';

export default function PickupCoordination({ settings }: { settings: SettingsMap }) {
  const toast = useToast();
  const [date, setDate] = useState(todayIso);
  const [radius, setRadius] = useState(String(settings.pickup_group_radius_km ?? 1.5));
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [groups, setGroups] = useState<PickupGroup[]>([]);
  const [drivers, setDrivers] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [bookingResult, groupResult, driverRows] = await Promise.all([
        supabase
          .from('bookings')
          .select('*, agencies(id,name,source_type)')
          .eq('service_date', date)
          .neq('status', 'cancelled')
          .order('pickup_hotel_name'),
        supabase.from('pickup_groups').select('*').eq('service_date', date).order('name'),
        loadEmployees(['driver', 'guide', 'crew']).catch(() => []),
      ]);
      if (bookingResult.error) throw bookingResult.error;
      setBookings((bookingResult.data ?? []) as Booking[]);
      setGroups((groupResult.data ?? []) as PickupGroup[]);
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
      const groupId = targetId === UNGROUPED ? null : targetId;
      setBookings((rows) => rows.map((row) => (row.id === bookingId ? { ...row, pickup_group_id: groupId } : row)));
      const { error } = await supabase.rpc('set_pickup_group', { p_booking_id: bookingId, p_group_id: groupId });
      if (error) {
        toast.error(error.message);
        void refresh();
      }
    },
    [refresh, toast],
  );

  const { held, dragProps, dropProps } = useCardMover(move);

  const byGroup = useMemo(() => {
    const map = new Map<string, Booking[]>();
    map.set(UNGROUPED, []);
    groups.forEach((group) => map.set(group.id, []));
    bookings.forEach((booking) => {
      const key = booking.pickup_group_id && map.has(booking.pickup_group_id) ? booking.pickup_group_id : UNGROUPED;
      map.get(key)!.push(booking);
    });
    return map;
  }, [bookings, groups]);

  async function autoGroup() {
    setBusy(true);
    const { data, error } = await supabase.rpc('auto_group_pickups', {
      p_service_date: date,
      p_radius_km: Number(radius) || 1.5,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${data ?? 0} booking(s) grouped by hotel and area.`);
    void refresh();
  }

  async function addGroup() {
    const name = window.prompt('Pickup run name (hotel or area)');
    if (!name?.trim()) return;
    const { error } = await supabase.rpc('save_pickup_group', {
      p_id: null,
      p_service_date: date,
      p_name: name.trim(),
    });
    if (error) { toast.error(error.message); return; }
    void refresh();
  }

  async function updateGroup(group: PickupGroup, patch: Partial<PickupGroup>) {
    const { error } = await supabase.rpc('save_pickup_group', {
      p_id: group.id,
      p_service_date: group.service_date,
      p_name: patch.name ?? group.name,
      p_area_label: patch.area_label ?? group.area_label,
      p_pickup_time: patch.pickup_time ?? group.pickup_time ?? '',
      p_vehicle: patch.vehicle ?? group.vehicle,
      p_driver_employee_id: patch.driver_employee_id ?? group.driver_employee_id,
      p_notes: group.notes,
    });
    if (error) { toast.error(error.message); return; }
    void refresh();
  }

  async function removeGroup(group: PickupGroup) {
    if (!window.confirm(`Delete pickup run "${group.name}"? Its bookings go back to the unassigned list.`)) return;
    const { error } = await supabase.rpc('delete_pickup_group', { p_group_id: group.id });
    if (error) { toast.error(error.message); return; }
    void refresh();
  }

  const ungrouped = byGroup.get(UNGROUPED) ?? [];
  const totalPax = bookings.reduce((sum, booking) => sum + booking.pax_total, 0);

  return (
    <>
      <PageHeader
        title="Pickup Runs"
        subtitle="Group bookings staying at the same hotel or nearby into one pickup. Drag a card, or tap a card then tap a run."
        actions={
          <>
            <button type="button" className={buttonClass} onClick={autoGroup} disabled={busy}>
              <Sparkles className="h-4 w-4" /> {busy ? 'Grouping...' : 'Auto group'}
            </button>
            <button type="button" className={secondaryButtonClass} onClick={addGroup}>
              <Plus className="h-4 w-4" /> New run
            </button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-white/85 p-3 shadow-soft">
        <Field label="Service date">
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Group radius (km)">
          <input type="number" step="0.1" min="0.1" className={inputClass} value={radius} onChange={(e) => setRadius(e.target.value)} />
        </Field>
        {held ? (
          <p className="ml-auto rounded-2xl bg-accent px-4 py-2 text-sm font-black text-white">
            Card picked up. Tap a run to drop it there.
          </p>
        ) : null}
      </div>

      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <Stat label="Bookings today" value={String(bookings.length)} />
        <Stat label="Total pax" value={String(totalPax)} tone="good" />
        <Stat label="Not grouped yet" value={String(ungrouped.length)} tone={ungrouped.length ? 'warn' : 'good'} />
      </div>

      {loading ? <p className="p-4 font-bold">Loading...</p> : null}

      <div className="grid gap-3 lg:grid-cols-[20rem_1fr]">
        <section
          {...dropProps(UNGROUPED)}
          className="rounded-2xl border-2 border-dashed border-line bg-white/70 p-3 shadow-soft"
        >
          <h2 className="mb-2 flex items-center gap-2 text-sm font-black">
            <Users className="h-4 w-4 text-coral" /> Not grouped ({ungrouped.length})
          </h2>
          <div className="grid gap-2">
            {ungrouped.map((booking) => (
              <BookingCard key={booking.id} booking={booking} held={held === booking.id} dragProps={dragProps} />
            ))}
            {ungrouped.length === 0 ? (
              <p className="rounded-xl bg-shell px-3 py-4 text-center text-sm font-bold text-accent">
                Everyone is in a pickup run.
              </p>
            ) : null}
          </div>
        </section>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => {
            const items = byGroup.get(group.id) ?? [];
            const pax = items.reduce((sum, booking) => sum + booking.pax_total, 0);
            return (
              <section
                key={group.id}
                {...dropProps(group.id)}
                className="flex flex-col rounded-2xl border border-line bg-white/85 p-3 shadow-soft"
              >
                <header className="mb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1 truncate text-sm font-black">
                        <MapPinned className="h-4 w-4 shrink-0 text-accent" /> {group.name}
                      </p>
                      <p className="text-xs font-semibold text-neutral-600">
                        {items.length} booking(s) · {pax} pax{group.area_label ? ` · ${group.area_label}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeGroup(group)}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-line text-danger"
                      aria-label="Delete run"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1">
                    <input
                      type="time"
                      className={inputClass}
                      defaultValue={group.pickup_time?.slice(0, 5) ?? ''}
                      onBlur={(e) => {
                        if ((group.pickup_time?.slice(0, 5) ?? '') !== e.target.value) {
                          void updateGroup(group, { pickup_time: e.target.value });
                        }
                      }}
                      aria-label="Pickup time"
                    />
                    <select
                      className={inputClass}
                      value={group.driver_employee_id ?? ''}
                      onChange={(e) => updateGroup(group, { driver_employee_id: e.target.value || null })}
                      aria-label="Driver"
                    >
                      <option value="">Driver</option>
                      {drivers.map((driver) => (
                        <option key={driver.id} value={driver.id}>{driver.full_name}</option>
                      ))}
                    </select>
                  </div>
                </header>
                <div className="grid gap-2">
                  {items.map((booking) => (
                    <BookingCard key={booking.id} booking={booking} held={held === booking.id} dragProps={dragProps} />
                  ))}
                  {items.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs font-bold text-neutral-500">
                      Drop bookings here
                    </p>
                  ) : null}
                </div>
              </section>
            );
          })}
          {groups.length === 0 && !loading ? (
            <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm font-bold text-neutral-500">
              No pickup runs yet. Use Auto group, or create one by hand.
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
}

function BookingCard({
  booking,
  held,
  dragProps,
}: {
  booking: Booking;
  held: boolean;
  dragProps: (id: string) => Record<string, unknown>;
}) {
  return (
    <article
      {...dragProps(booking.id)}
      className={`cursor-grab rounded-xl border p-2.5 text-left shadow-sm transition active:cursor-grabbing ${
        held ? 'border-accent bg-shell ring-2 ring-accent' : 'border-line bg-white'
      }`}
    >
      <p className="flex items-center justify-between gap-2 text-sm font-black">
        <span className="min-w-0 truncate">{booking.lead_name}</span>
        <span className="shrink-0 rounded-lg bg-accent px-2 py-0.5 text-xs text-white">{booking.pax_total} pax</span>
      </p>
      <p className="mt-0.5 truncate text-xs font-semibold text-neutral-600">
        {booking.pickup_hotel_name ?? 'No hotel recorded'}
      </p>
      <p className="mt-0.5 text-[11px] font-bold uppercase tracking-wide text-neutral-500">
        {booking.booking_ref} · {sourceLabels[booking.source_type] ?? booking.source_type}
      </p>
    </article>
  );
}
