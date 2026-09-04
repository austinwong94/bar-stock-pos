import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, RefreshCw, Ship, UserX, Users } from 'lucide-react';
import { PageHeader, Stat } from '../../components/Page';
import { Field, buttonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { useToast } from '../../components/Toast';
import { supabase } from '../../lib/supabase';
import { useAccess } from '../../lib/access';
import { readErrorMessage, todayIso } from '../../lib/opsData';
import type { BoardingStatus, ManifestRow } from '../../lib/platformTypes';

export default function Boarding() {
  const toast = useToast();
  const { can } = useAccess();
  const [date, setDate] = useState(todayIso);
  const [rows, setRows] = useState<ManifestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const canMark = can('boarding.mark');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('trip_manifest')
        .select('*')
        .eq('service_date', date)
        .order('boat_code')
        .order('booking_ref')
        .order('full_name');
      if (error) throw error;
      setRows((data ?? []) as ManifestRow[]);
    } catch (error) {
      toast.error(readErrorMessage(error, 'Could not load the boarding list.'));
    }
    setLoading(false);
  }, [date, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const boats = useMemo(() => {
    const map = new Map<string, { code: string; name: string | null; rows: ManifestRow[] }>();
    rows.forEach((row) => {
      const entry = map.get(row.assignment_id) ?? { code: row.boat_code, name: row.boat_name, rows: [] };
      entry.rows.push(row);
      map.set(row.assignment_id, entry);
    });
    return [...map.entries()].sort((a, b) => a[1].code.localeCompare(b[1].code));
  }, [rows]);

  async function mark(ids: string[], status: BoardingStatus) {
    if (ids.length === 0) return;
    setBusy(true);
    const { error } = await supabase.rpc('mark_boarding', { p_passenger_ids: ids, p_status: status });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    void refresh();
  }

  const arrived = rows.filter((row) => row.boarding_status === 'arrived').length;
  const missing = rows.filter((row) => row.boarding_status === 'pending').length;

  return (
    <>
      <PageHeader
        title="Boarding Attendance"
        subtitle="Tick every guest off before the boat leaves. Guests who booked together are shown together so their group can help find them."
        actions={
          <button type="button" className={secondaryButtonClass} onClick={() => void refresh()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        }
      />

      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-white/85 p-3 shadow-soft">
        <Field label="Service date">
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="On the list" value={String(rows.length)} />
        <Stat label="Checked in" value={String(arrived)} tone="good" />
        <Stat label="Still waiting" value={String(missing)} tone={missing > 0 ? 'warn' : 'good'} />
      </div>

      {loading ? <p className="p-4 font-bold">Loading...</p> : null}
      {!loading && rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm font-bold text-neutral-500">
          No boat has been assigned to you for this date.
        </p>
      ) : null}

      <div className="grid gap-3">
        {boats.map(([assignmentId, boat]) => {
          const groups = groupByBooking(boat.rows);
          const boatArrived = boat.rows.filter((row) => row.boarding_status === 'arrived').length;
          return (
            <section key={assignmentId} className="rounded-2xl border border-line bg-white/85 p-3 shadow-soft">
              <header className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
                <p className="flex items-center gap-2 text-base font-black">
                  <Ship className="h-5 w-5 text-accent" /> {boat.code}
                  {boat.name ? <span className="text-sm font-semibold text-neutral-600">{boat.name}</span> : null}
                </p>
                <div className="flex items-center gap-2">
                  <span className={`rounded-xl px-3 py-1.5 text-sm font-black ${boatArrived === boat.rows.length ? 'bg-shell text-accent' : 'bg-amber-50 text-amber-800'}`}>
                    {boatArrived} / {boat.rows.length} on board
                  </span>
                  {canMark ? (
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={busy}
                      onClick={() => mark(boat.rows.map((row) => row.passenger_id), 'arrived')}
                    >
                      All arrived
                    </button>
                  ) : null}
                </div>
              </header>

              <div className="grid gap-2">
                {groups.map((group) => (
                  <div key={group.bookingRef} className="rounded-xl border border-line bg-shell/40 p-2.5">
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-sm font-black">
                        <Users className="h-4 w-4 text-coral" />
                        {group.leadName}
                        <span className="rounded-lg bg-white px-2 py-0.5 text-xs font-black text-neutral-600">
                          {group.rows.length} together · {group.bookingRef}
                        </span>
                      </p>
                      {canMark ? (
                        <button
                          type="button"
                          className={secondaryButtonClass}
                          disabled={busy}
                          onClick={() => mark(group.rows.map((row) => row.passenger_id), 'arrived')}
                        >
                          Whole group arrived
                        </button>
                      ) : null}
                    </div>
                    <ul className="grid gap-1.5 sm:grid-cols-2">
                      {group.rows.map((row) => (
                        <li
                          key={row.passenger_id}
                          className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 ${
                            row.boarding_status === 'arrived'
                              ? 'border-accent bg-shell'
                              : row.boarding_status === 'no_show'
                                ? 'border-danger bg-red-50'
                                : 'border-line bg-white'
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-ink">
                              {row.full_name}
                              {row.needs_assistance ? (
                                <span className="ml-1.5 rounded bg-coral/12 px-1.5 py-0.5 text-[0.625rem] font-semibold text-coral">
                                  needs help
                                </span>
                              ) : null}
                            </p>
                            <p className="truncate text-xs font-medium text-muted">
                              {row.phone ?? 'No number'}
                              {row.age_band !== 'adult' ? ` · ${row.age_band}` : ''}
                              {row.assistance_note ? ` · ${row.assistance_note}` : ''}
                            </p>
                          </div>
                          {canMark ? (
                            <div className="flex shrink-0 gap-1">
                              <button
                                type="button"
                                aria-label="Mark arrived"
                                disabled={busy}
                                onClick={() => mark([row.passenger_id], row.boarding_status === 'arrived' ? 'pending' : 'arrived')}
                                className={`grid h-9 w-9 place-items-center rounded-lg border ${
                                  row.boarding_status === 'arrived' ? 'border-accent bg-accent text-white' : 'border-line bg-white text-accent'
                                }`}
                              >
                                {row.boarding_status === 'arrived' ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
                              </button>
                              <button
                                type="button"
                                aria-label="Mark no show"
                                disabled={busy}
                                onClick={() => mark([row.passenger_id], row.boarding_status === 'no_show' ? 'pending' : 'no_show')}
                                className={`grid h-9 w-9 place-items-center rounded-lg border ${
                                  row.boarding_status === 'no_show' ? 'border-danger bg-danger text-white' : 'border-line bg-white text-danger'
                                }`}
                              >
                                <UserX className="h-4 w-4" />
                              </button>
                            </div>
                          ) : (
                            <span className="shrink-0 text-xs font-black capitalize">{row.boarding_status.replace('_', ' ')}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

export function groupByBooking(rows: ManifestRow[]) {
  const map = new Map<string, { bookingRef: string; leadName: string; rows: ManifestRow[] }>();
  rows.forEach((row) => {
    const entry = map.get(row.booking_id) ?? { bookingRef: row.booking_ref, leadName: row.lead_name, rows: [] };
    entry.rows.push(row);
    map.set(row.booking_id, entry);
  });
  return [...map.values()].sort((a, b) => a.bookingRef.localeCompare(b.bookingRef));
}
