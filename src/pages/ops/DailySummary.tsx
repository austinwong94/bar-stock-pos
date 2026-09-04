import { useCallback, useEffect, useState } from 'react';
import { Printer, RefreshCw, Ship } from 'lucide-react';
import { PageHeader, Stat, Panel, Badge, EmptyState } from '../../components/Page';
import { Field, inputClass, secondaryButtonClass } from '../../components/Form';
import { useToast } from '../../components/Toast';
import { supabase } from '../../lib/supabase';
import { useAccess } from '../../lib/access';
import { readErrorMessage, sourceLabels, todayIso } from '../../lib/opsData';
import { money } from '../../lib/format';
import type { AttendanceLogRow } from '../../lib/platformTypes';
import type { SettingsMap } from '../../lib/types';

type Summary = {
  guests?: { bookings: number; pax: number; adults: number; children: number; elderly: number; by_source: Record<string, number> };
  boats?: Array<{ code: string; name: string | null; capacity: number; captain: string | null; guide: string | null; departure: string | null; assigned: number; boarded: number; no_show: number; returned: number }>;
  activities?: Array<{ code: string; name: string; chosen: number; joined: number; back: number }>;
  headcount?: { assigned: number; boarded: number; no_show: number; not_checked: number; activity_chosen: number; back_on_boat: number };
  trips?: Array<{ boat: string; type: string; pax: number; departure: string | null; purpose: string | null }>;
  fuel?: { litres_bought: number; cost: number | null };
  supplies?: { requests: number; items: number; items_bought: number; pax_catered: number; spend: number | null };
  missing_items?: Array<{ item: string; quantity: number; status: string; remarks: string | null }>;
  bar?: { sales: number; total: number; cash: number; qr: number; complimentary: number };
  incidents?: Array<{ event: string; subject: string | null; detail: string | null; at: string }>;
};

const actionLabels: Record<string, string> = {
  boarding: 'Boarding',
  activity_choice: 'Activity chosen',
  activity_roll_call: 'Activity roll call',
  back_on_boat: 'Back on boat',
};

export default function DailySummary({ settings }: { settings: SettingsMap }) {
  const toast = useToast();
  const { can } = useAccess();
  const currency = String(settings.currency_symbol ?? 'MYR');

  const [date, setDate] = useState(todayIso);
  const [summary, setSummary] = useState<Summary>({});
  const [log, setLog] = useState<AttendanceLogRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryResult, logResult] = await Promise.all([
        supabase.rpc('operations_summary', { p_service_date: date }),
        supabase
          .from('attendance_log')
          .select('*')
          .eq('service_date', date)
          .order('created_at', { ascending: false })
          .limit(400),
      ]);
      if (summaryResult.error) throw summaryResult.error;
      setSummary((summaryResult.data ?? {}) as Summary);
      setLog((logResult.data ?? []) as AttendanceLogRow[]);
    } catch (error) {
      toast.error(readErrorMessage(error, 'Could not load the daily summary.'));
    }
    setLoading(false);
  }, [date, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const guests = summary.guests;
  const head = summary.headcount;
  const readable = new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <>
      <PageHeader
        title="Daily Summary"
        subtitle={`Everything that happened on ${readable}, in one place.`}
        actions={
          <>
            <button type="button" className={secondaryButtonClass} onClick={() => void refresh()}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
            <button type="button" className={secondaryButtonClass} onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Print
            </button>
          </>
        }
      />

      <div className="no-print mb-4 flex flex-wrap items-end gap-2">
        <Field label="Date">
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>

      {loading ? <p className="py-6 text-center text-sm font-medium text-muted">Loading…</p> : null}

      <div className="mb-4 grid grid-cols-2 gap-2.5 xl:grid-cols-4">
        <Stat
          label="Guests today"
          value={String(guests?.pax ?? 0)}
          hint={`${guests?.bookings ?? 0} bookings · ${guests?.adults ?? 0} adult, ${guests?.children ?? 0} child, ${guests?.elderly ?? 0} elderly`}
        />
        <Stat label="Boats used" value={String(summary.boats?.length ?? 0)} hint={`${summary.trips?.length ?? 0} trips logged`} />
        <Stat
          label="Checked in"
          value={`${head?.boarded ?? 0} / ${head?.assigned ?? 0}`}
          tone={head && head.not_checked > 0 ? 'warn' : 'good'}
          hint={head?.no_show ? `${head.no_show} no-show` : undefined}
        />
        <Stat
          label="Back on the boat"
          value={`${head?.back_on_boat ?? 0} / ${head?.boarded ?? 0}`}
          tone={head && head.boarded > 0 && head.back_on_boat < head.boarded ? 'bad' : 'good'}
        />
      </div>

      {summary.incidents && summary.incidents.length > 0 ? (
        <Panel title="Incidents and alerts" className="mb-4">
          <ul className="divide-y divide-line">
            {summary.incidents.map((incident, index) => (
              <li key={index} className="flex flex-wrap items-center gap-2 px-3.5 py-2.5 text-sm">
                <span className="w-12 shrink-0 tabular font-semibold text-danger">{incident.at}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-semibold text-ink">{incident.subject ?? incident.event}</span>
                  {incident.detail ? <span className="ml-2 text-muted">{incident.detail}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Boats and crew">
          {summary.boats && summary.boats.length > 0 ? (
            <ul className="divide-y divide-line">
              {summary.boats.map((boat) => (
                <li key={boat.code} className="px-3.5 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                      <Ship className="h-4 w-4 text-accent" />
                      {boat.code}
                      {boat.name ? <span className="font-medium text-muted">{boat.name}</span> : null}
                      {boat.departure ? <Badge>{boat.departure}</Badge> : null}
                    </p>
                    <span className="tabular text-sm font-semibold">
                      {boat.boarded}/{boat.assigned} boarded
                      {boat.no_show > 0 ? <span className="ml-2 text-danger">{boat.no_show} no-show</span> : null}
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-medium text-muted">
                    Captain: {boat.captain ?? 'not set'} · Guide: {boat.guide ?? 'not set'} · Capacity {boat.capacity}
                    {' · '}
                    {boat.returned}/{boat.boarded} back on board
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-4"><EmptyState>No boats carried guests on this date.</EmptyState></div>
          )}
        </Panel>

        <Panel title="Activities">
          {summary.activities && summary.activities.length > 0 ? (
            <ul className="divide-y divide-line">
              {summary.activities.map((activity) => (
                <li key={activity.code} className="flex items-center justify-between gap-2 px-3.5 py-3">
                  <span className="text-sm font-semibold text-ink">{activity.name}</span>
                  <span className="tabular text-sm text-muted">
                    <span className="font-semibold text-ink">{activity.chosen}</span> chose ·{' '}
                    {activity.joined} joined · {activity.back} back
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-4"><EmptyState>No activities recorded.</EmptyState></div>
          )}
          {head ? (
            <p className="border-t border-line px-3.5 py-2.5 text-xs font-medium text-muted">
              {head.activity_chosen} of {head.boarded} guests on the island had an activity chosen.
            </p>
          ) : null}
        </Panel>
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Where guests came from">
          {guests && Object.keys(guests.by_source ?? {}).length > 0 ? (
            <ul className="divide-y divide-line">
              {Object.entries(guests.by_source).map(([source, pax]) => (
                <li key={source} className="flex items-center justify-between px-3.5 py-2.5 text-sm">
                  <span className="font-medium">{sourceLabels[source] ?? source}</span>
                  <span className="tabular font-semibold">{pax} pax</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-4"><EmptyState>No bookings.</EmptyState></div>
          )}
        </Panel>

        {summary.supplies ? (
          <Panel title="Food and supplies">
            <ul className="divide-y divide-line text-sm">
              <Row label="Kitchen requests" value={String(summary.supplies.requests)} />
              <Row label="Pax catered for" value={String(summary.supplies.pax_catered)} />
              <Row label="Items bought" value={`${summary.supplies.items_bought} / ${summary.supplies.items}`} />
              {summary.supplies.spend !== null && summary.supplies.spend !== undefined ? (
                <Row label="Spend" value={money(summary.supplies.spend, currency)} />
              ) : null}
            </ul>
          </Panel>
        ) : null}

        {summary.bar ? (
          <Panel title="Bar takings">
            <ul className="divide-y divide-line text-sm">
              <Row label="Sales" value={String(summary.bar.sales)} />
              <Row label="Total" value={money(summary.bar.total, currency)} />
              <Row label="Cash" value={money(summary.bar.cash, currency)} />
              <Row label="QR" value={money(summary.bar.qr, currency)} />
              <Row label="Complimentary" value={money(summary.bar.complimentary, currency)} />
            </ul>
          </Panel>
        ) : null}
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Boat trips">
          {summary.trips && summary.trips.length > 0 ? (
            <ul className="divide-y divide-line">
              {summary.trips.map((trip, index) => (
                <li key={index} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-sm">
                  <span className="font-semibold text-ink">
                    {trip.boat}
                    {trip.departure ? <span className="ml-2 tabular font-medium text-muted">{trip.departure}</span> : null}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone={trip.type === 'emergency' ? 'bad' : 'neutral'}>{trip.type.replace('_', ' ')}</Badge>
                    <span className="tabular text-muted">{trip.pax} pax</span>
                  </span>
                  {trip.purpose ? <span className="w-full text-xs text-muted">{trip.purpose}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-4"><EmptyState>No trips logged.</EmptyState></div>
          )}
          {summary.fuel ? (
            <p className="border-t border-line px-3.5 py-2.5 text-xs font-medium text-muted">
              Fuel bought today: {Number(summary.fuel.litres_bought).toFixed(0)} L
              {summary.fuel.cost !== null ? ` · ${money(summary.fuel.cost, currency)}` : ''}
            </p>
          ) : null}
        </Panel>

        <Panel title="Items reported missing">
          {summary.missing_items && summary.missing_items.length > 0 ? (
            <ul className="divide-y divide-line">
              {summary.missing_items.map((item, index) => (
                <li key={index} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-sm">
                  <span className="font-semibold text-ink">{item.item} <span className="tabular text-muted">x{item.quantity}</span></span>
                  <Badge tone={item.status === 'found' ? 'good' : 'warn'}>{item.status}</Badge>
                  {item.remarks ? <span className="w-full text-xs text-muted">{item.remarks}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-4"><EmptyState>Nothing reported missing.</EmptyState></div>
          )}
        </Panel>
      </div>

      {can('ops.log.view') ? (
        <Panel title={`Who did what (${log.length})`}>
          <div className="table-scroll max-h-[26rem] overflow-y-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="sticky top-0 bg-paper">
                <tr className="eyebrow">
                  <th className="px-3.5 py-2">Time</th>
                  <th className="px-3.5 py-2">Action</th>
                  <th className="px-3.5 py-2">Guest</th>
                  <th className="px-3.5 py-2">Boat</th>
                  <th className="px-3.5 py-2">Set to</th>
                  <th className="px-3.5 py-2">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {log.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3.5 py-2 tabular text-muted">
                      {new Date(row.created_at).toLocaleTimeString('en-GB', {
                        hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur',
                      })}
                    </td>
                    <td className="px-3.5 py-2">{actionLabels[row.action] ?? row.action}</td>
                    <td className="px-3.5 py-2 font-medium text-ink">{row.tourist_name ?? '—'}</td>
                    <td className="px-3.5 py-2 text-muted">{row.boat_code ?? '—'}</td>
                    <td className="px-3.5 py-2"><Badge>{row.to_value ?? '—'}</Badge></td>
                    <td className="px-3.5 py-2 font-medium">{row.actor_name ?? 'unknown'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {log.length === 0 ? <div className="p-4"><EmptyState>Nothing recorded yet today.</EmptyState></div> : null}
        </Panel>
      ) : null}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-center justify-between px-3.5 py-2.5">
      <span className="font-medium text-muted">{label}</span>
      <span className="tabular font-semibold text-ink">{value}</span>
    </li>
  );
}
