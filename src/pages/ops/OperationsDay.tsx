import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, RefreshCw } from 'lucide-react';
import { PageHeader, Stat } from '../../components/Page';
import { Field, buttonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { useToast } from '../../components/Toast';
import { supabase } from '../../lib/supabase';
import { useAccess } from '../../lib/access';
import { readErrorMessage, todayIso } from '../../lib/opsData';
import type { DayStatusRow, OperationsCheckpoint, OperationsEvent } from '../../lib/platformTypes';

function clockTime(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kuala_Lumpur',
  });
}

export default function OperationsDay() {
  const toast = useToast();
  const { can, reloadBadges } = useAccess();
  const [date, setDate] = useState(todayIso);
  const [status, setStatus] = useState<DayStatusRow[]>([]);
  const [events, setEvents] = useState<OperationsEvent[]>([]);
  const [checkpoints, setCheckpoints] = useState<OperationsCheckpoint[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(true);

  const canManage = can('ops.log.manage');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [statusResult, eventResult, checkpointResult] = await Promise.all([
        supabase.rpc('operations_day_status', { p_service_date: date }),
        supabase.from('operations_events').select('*').eq('service_date', date).order('occurred_at'),
        supabase.from('operations_checkpoints').select('*').order('sort_order'),
      ]);
      if (statusResult.error) throw statusResult.error;
      setStatus((statusResult.data ?? []) as DayStatusRow[]);
      setEvents((eventResult.data ?? []) as OperationsEvent[]);
      setCheckpoints((checkpointResult.data ?? []) as OperationsCheckpoint[]);
    } catch (error) {
      toast.error(readErrorMessage(error, 'Could not load the operations log.'));
    }
    setLoading(false);
  }, [date, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Checking for late steps on open is what makes the timers work without a
  // scheduler; it is safe to run repeatedly.
  useEffect(() => {
    if (!can('ops.log.view')) return;
    void supabase.rpc('raise_overdue_alerts', { p_service_date: date }).then(({ data }: { data: number | null }) => {
      if (data && data > 0) void refresh();
    });
  }, [can, date, refresh]);

  async function saveCheckpoint(checkpoint: OperationsCheckpoint, dueTime: string, enabled: boolean) {
    const { error } = await supabase.rpc('set_operations_checkpoint', {
      p_code: checkpoint.code,
      p_due_time: dueTime,
      p_enabled: enabled,
    });
    if (error) { toast.error(error.message); return; }
    void refresh();
    void reloadBadges();
  }

  const done = status.filter((row) => row.done).length;
  const late = status.filter((row) => row.overdue).length;

  return (
    <>
      <PageHeader
        title="Daily Operations"
        subtitle="Every step of the day, when it was finished, and what is running late."
        actions={
          <>
            <button type="button" className={secondaryButtonClass} onClick={() => void refresh()}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
            {canManage ? (
              <button type="button" className={secondaryButtonClass} onClick={() => setShowSettings((value) => !value)}>
                <Clock className="h-4 w-4" /> Times
              </button>
            ) : null}
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-white/85 p-3 shadow-soft">
        <Field label="Date">
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Steps finished" value={`${done} / ${status.length}`} tone={done === status.length && status.length > 0 ? 'good' : 'default'} />
        <Stat label="Running late" value={String(late)} tone={late > 0 ? 'bad' : 'good'} />
        <Stat label="Things logged today" value={String(events.length)} />
      </div>

      {showSettings && canManage ? (
        <section className="mb-3 rounded-2xl border border-line bg-white/85 p-3 shadow-soft">
          <h2 className="mb-2 text-sm font-black">When each step should be done by</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {checkpoints.map((checkpoint) => (
              <div key={checkpoint.code} className="flex flex-wrap items-center gap-2 rounded-xl border border-line px-2.5 py-2">
                <span className="min-w-[9rem] flex-1 text-sm font-black">{checkpoint.name}</span>
                <input
                  type="time"
                  className="h-10 w-28 rounded-xl border border-line bg-white px-2 text-sm font-black"
                  defaultValue={checkpoint.due_time.slice(0, 5)}
                  onBlur={(e) => saveCheckpoint(checkpoint, e.target.value, checkpoint.enabled)}
                  aria-label={`${checkpoint.name} time`}
                />
                <label className="flex items-center gap-1.5 text-xs font-black">
                  <input
                    type="checkbox"
                    checked={checkpoint.enabled}
                    onChange={(e) => saveCheckpoint(checkpoint, checkpoint.due_time.slice(0, 5), e.target.checked)}
                  />
                  On
                </label>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {loading ? <p className="p-4 font-bold">Loading...</p> : null}

      <section className="mb-3 overflow-hidden rounded-2xl border border-line bg-white/85 shadow-soft">
        <h2 className="border-b border-line px-3 py-2 text-sm font-black">Progress</h2>
        <ul className="divide-y divide-line">
          {status.map((row) => (
            <li
              key={`${row.checkpoint_code}-${row.subject ?? 'day'}`}
              className={`flex flex-wrap items-center gap-2 px-3 py-2.5 ${row.overdue ? 'bg-red-50' : ''}`}
            >
              <span className="shrink-0">
                {row.done ? (
                  <CheckCircle2 className="h-5 w-5 text-accent" />
                ) : row.overdue ? (
                  <AlertTriangle className="h-5 w-5 text-danger" />
                ) : (
                  <Clock className="h-5 w-5 text-neutral-400" />
                )}
              </span>
              <div className="min-w-[10rem] flex-1">
                <p className="text-sm font-black">
                  {row.checkpoint_name}
                  {row.subject ? <span className="ml-2 rounded bg-shell px-1.5 py-0.5 text-xs">{row.subject}</span> : null}
                </p>
                {row.detail ? <p className="text-xs font-semibold text-neutral-600">{row.detail}</p> : null}
              </div>
              <span className="shrink-0 text-right text-sm font-black">
                {row.done ? (
                  <span className="text-accent">Done {clockTime(row.done_at)}</span>
                ) : row.overdue ? (
                  <span className="text-danger">Late — due {row.due_time.slice(0, 5)}</span>
                ) : (
                  <span className="text-neutral-500">Due {row.due_time.slice(0, 5)}</span>
                )}
              </span>
            </li>
          ))}
          {!loading && status.length === 0 ? (
            <li className="px-3 py-4 text-sm font-bold text-neutral-500">
              Nothing scheduled for this date yet.
            </li>
          ) : null}
        </ul>
      </section>

      <section className="overflow-hidden rounded-2xl border border-line bg-white/85 shadow-soft">
        <h2 className="border-b border-line px-3 py-2 text-sm font-black">What happened, in order</h2>
        <ol className="divide-y divide-line">
          {events.map((event) => (
            <li key={event.id} className="flex flex-wrap items-start gap-2 px-3 py-2.5">
              <span className="w-14 shrink-0 text-sm font-black tabular-nums text-accent">{clockTime(event.occurred_at)}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black">
                  {readableEvent(event.event_code)}
                  {event.subject ? <span className="ml-2 rounded bg-shell px-1.5 py-0.5 text-xs">{event.subject}</span> : null}
                </p>
                {event.detail ? <p className="text-xs font-semibold text-neutral-600">{event.detail}</p> : null}
              </div>
              {event.severity !== 'info' ? (
                <span className="shrink-0 rounded-lg bg-red-50 px-2 py-1 text-xs font-black text-danger">Alert</span>
              ) : null}
            </li>
          ))}
          {events.length === 0 ? (
            <li className="px-3 py-4 text-sm font-bold text-neutral-500">Nothing has happened yet today.</li>
          ) : null}
        </ol>
      </section>
    </>
  );
}

const eventLabels: Record<string, string> = {
  'boarding.completed': 'Boarding attendance completed',
  'activities.selected': 'All activities chosen',
  'activities.completed': 'Activity roll call completed',
  'activities.all_returned': 'Everyone back on board',
  'fleet.assignment_completed': 'Boat assignment finished',
  'purchase.requested': 'Kitchen request sent to purchasing',
  'ops.overdue': 'Running late',
};

function readableEvent(code: string) {
  return eventLabels[code] ?? code.replace(/[._]/g, ' ');
}
