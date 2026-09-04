import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Circle, RefreshCw, Ship, Undo2, Users } from 'lucide-react';
import { PageHeader, Stat } from '../../components/Page';
import { Field, buttonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { useToast } from '../../components/Toast';
import { supabase } from '../../lib/supabase';
import { useAccess } from '../../lib/access';
import { loadActivityTypes, readErrorMessage, todayIso } from '../../lib/opsData';
import { groupByBooking } from './Boarding';
import type { ActivityType, ManifestRow } from '../../lib/platformTypes';

export default function Activities() {
  const toast = useToast();
  const { can } = useAccess();
  const [date, setDate] = useState(todayIso);
  const [rows, setRows] = useState<ManifestRow[]>([]);
  const [types, setTypes] = useState<ActivityType[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const canSelect = can('activities.select');
  const canMark = can('activities.mark');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [manifest, activityTypes] = await Promise.all([
        supabase
          .from('trip_manifest')
          .select('*')
          .eq('service_date', date)
          .eq('boarding_status', 'arrived')
          .order('boat_code')
          .order('booking_ref'),
        loadActivityTypes(),
      ]);
      if (manifest.error) throw manifest.error;
      setRows((manifest.data ?? []) as ManifestRow[]);
      setTypes(activityTypes);
    } catch (error) {
      toast.error(readErrorMessage(error, 'Could not load the activity list.'));
    }
    setLoading(false);
  }, [date, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const counts = useMemo(() => {
    const perActivity = new Map<string, { chosen: number; joined: number; back: number }>();
    types.forEach((type) => perActivity.set(type.code, { chosen: 0, joined: 0, back: 0 }));
    let unchosen = 0;
    rows.forEach((row) => {
      if (!row.activity_code) { unchosen += 1; return; }
      const entry = perActivity.get(row.activity_code) ?? { chosen: 0, joined: 0, back: 0 };
      entry.chosen += 1;
      if (row.activity_status === 'joined') entry.joined += 1;
      if (row.returned) entry.back += 1;
      perActivity.set(row.activity_code, entry);
    });
    return { perActivity, unchosen };
  }, [rows, types]);

  const onIsland = rows.length;
  const backOnBoat = rows.filter((row) => row.returned).length;
  const stillOut = onIsland - backOnBoat;

  async function setActivity(ids: string[], code: string | null) {
    if (!ids.length) return;
    setBusy(true);
    const { error } = await supabase.rpc('set_passenger_activity', { p_passenger_ids: ids, p_activity_code: code });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    void refresh();
  }

  async function markAttendance(ids: string[], status: string | null, returned: boolean | null) {
    if (!ids.length) return;
    setBusy(true);
    const { error } = await supabase.rpc('mark_activity_attendance', {
      p_passenger_ids: ids,
      p_status: status,
      p_returned: returned,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    void refresh();
  }

  const boats = useMemo(() => {
    const map = new Map<string, { code: string; rows: ManifestRow[] }>();
    rows.forEach((row) => {
      const entry = map.get(row.assignment_id) ?? { code: row.boat_code, rows: [] };
      entry.rows.push(row);
      map.set(row.assignment_id, entry);
    });
    return [...map.entries()].sort((a, b) => a[1].code.localeCompare(b[1].code));
  }, [rows]);

  return (
    <>
      <PageHeader
        title="Island Activities"
        subtitle="Pick the activity for each guest, then take the roll call so nobody is left on the island."
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

      <div className="mb-3 grid grid-cols-2 gap-2 xl:grid-cols-4">
        <Stat label="Guests on the island" value={String(onIsland)} />
        <Stat label="Back on the boat" value={String(backOnBoat)} tone="good" />
        <Stat label="Still on the island" value={String(stillOut)} tone={stillOut > 0 ? 'warn' : 'good'} />
        <Stat label="No activity chosen" value={String(counts.unchosen)} tone={counts.unchosen > 0 ? 'warn' : 'good'} />
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {types.map((type) => {
          const entry = counts.perActivity.get(type.code) ?? { chosen: 0, joined: 0, back: 0 };
          return (
            <div key={type.code} className="rounded-2xl border border-line bg-white/85 p-3 shadow-soft">
              <p className="text-sm font-black">{type.name}</p>
              <p className="mt-1 text-2xl font-black text-accent">{entry.chosen} pax</p>
              <p className="text-xs font-semibold text-neutral-600">
                {entry.joined} joined · {entry.back} back on the boat
              </p>
            </div>
          );
        })}
      </div>

      {stillOut > 0 && backOnBoat > 0 ? (
        <p className="mb-3 flex items-center gap-2 rounded-2xl border border-warning bg-amber-50 px-3 py-2 text-sm font-black text-amber-900">
          <AlertTriangle className="h-4 w-4" /> {stillOut} guest(s) have not been checked back onto a boat yet.
        </p>
      ) : null}

      {loading ? <p className="p-4 font-bold">Loading...</p> : null}
      {!loading && rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm font-bold text-neutral-500">
          Nobody has been checked in for this date yet. Boarding happens first.
        </p>
      ) : null}

      <div className="grid gap-3">
        {boats.map(([assignmentId, boat]) => (
          <section key={assignmentId} className="rounded-2xl border border-line bg-white/85 p-3 shadow-soft">
            <header className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
              <p className="flex items-center gap-2 text-base font-black">
                <Ship className="h-5 w-5 text-accent" /> {boat.code}
              </p>
              <span className="rounded-xl bg-shell px-3 py-1.5 text-sm font-black">
                {boat.rows.filter((row) => row.returned).length} / {boat.rows.length} back on board
              </span>
            </header>

            <div className="grid gap-2">
              {groupByBooking(boat.rows).map((group) => (
                <div key={group.bookingRef} className="rounded-xl border border-line bg-shell/40 p-2.5">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-sm font-black">
                      <Users className="h-4 w-4 text-coral" /> {group.leadName}
                      <span className="rounded-lg bg-white px-2 py-0.5 text-xs font-black text-neutral-600">
                        {group.rows.length} together
                      </span>
                    </p>
                    {canSelect ? (
                      <div className="flex flex-wrap gap-1">
                        {types.map((type) => (
                          <button
                            key={type.code}
                            type="button"
                            disabled={busy}
                            className={secondaryButtonClass}
                            onClick={() => setActivity(group.rows.map((row) => row.passenger_id), type.code)}
                          >
                            All: {type.name}
                          </button>
                        ))}
                        <button
                          type="button"
                          disabled={busy}
                          className={secondaryButtonClass}
                          onClick={() => setActivity(group.rows.map((row) => row.passenger_id), null)}
                        >
                          <Undo2 className="h-3.5 w-3.5" /> Clear group
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <ul className="grid gap-1.5">
                    {group.rows.map((row) => (
                      <li
                        key={row.passenger_id}
                        className={`flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-2 ${
                          row.activity_code ? 'border-line bg-surface' : 'border-warning/40 bg-warning/[0.05]'
                        }`}
                      >
                        <span className="min-w-[8rem] flex-1 truncate text-sm font-semibold text-ink">
                          {row.full_name}
                          {!row.activity_code ? (
                            <span className="ml-2 text-xs font-medium text-warning">not decided</span>
                          ) : null}
                        </span>

                        <div className="flex flex-wrap gap-1">
                          {types.map((type) => (
                            <button
                              key={type.code}
                              type="button"
                              disabled={!canSelect || busy}
                              onClick={() =>
                                setActivity([row.passenger_id], row.activity_code === type.code ? null : type.code)
                              }
                              aria-pressed={row.activity_code === type.code}
                              className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
                                row.activity_code === type.code
                                  ? 'border-accent bg-accent text-white'
                                  : 'border-line bg-surface text-ink hover:bg-shell'
                              } disabled:opacity-45`}
                            >
                              {type.name}
                            </button>
                          ))}
                          {row.activity_code && canSelect ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setActivity([row.passenger_id], null)}
                              title="Not decided yet"
                              aria-label={`Clear activity for ${row.full_name}`}
                              className="rounded-lg border border-line bg-surface px-2 py-1.5 text-muted transition hover:border-coral hover:text-coral disabled:opacity-45"
                            >
                              <Undo2 className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                        </div>

                        {canMark ? (
                          <div className="ml-auto flex gap-1">
                            <button
                              type="button"
                              disabled={busy || !row.activity_code}
                              onClick={() => markAttendance([row.passenger_id], row.activity_status === 'joined' ? 'pending' : 'joined', null)}
                              className={`rounded-lg border px-2.5 py-1.5 text-xs font-black ${
                                row.activity_status === 'joined' ? 'border-accent bg-shell text-accent' : 'border-line bg-white'
                              } disabled:opacity-50`}
                            >
                              Joined
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => markAttendance([row.passenger_id], null, !row.returned)}
                              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-black ${
                                row.returned ? 'border-accent bg-accent text-white' : 'border-line bg-white text-accent'
                              }`}
                            >
                              {row.returned ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
                              Back on boat
                            </button>
                          </div>
                        ) : (
                          <span className="ml-auto text-xs font-black capitalize">{row.activity_status}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            {canMark ? (
              <button
                type="button"
                className={`${buttonClass} mt-3 w-full`}
                disabled={busy}
                onClick={() => markAttendance(boat.rows.map((row) => row.passenger_id), null, true)}
              >
                Everyone on {boat.code} is back on board
              </button>
            ) : null}
          </section>
        ))}
      </div>
    </>
  );
}
