import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CheckCircle2, LayoutGrid } from 'lucide-react';
import { Panel } from '../components/Page';
import { secondaryButtonClass } from '../components/Form';
import { supabase } from '../lib/supabase';
import { useAccess } from '../lib/access';
import { departmentNav, navGroups } from '../lib/navigation';
import { todayIso } from '../lib/opsData';
import type { SettingsMap } from '../lib/types';
import { useBusinessDate } from '../lib/useBusinessDate';
import { useSharedRefresh } from '../lib/useSharedRefresh';

type Summary = {
  guests?: { bookings: number; pax: number; adults: number; children: number; elderly: number; infants?: number; tour_leaders?: number; tour_guides?: number; assisted?: number };
  boats?: Array<{ code: string; captain: string | null; guide: string | null; assigned: number; boarded: number }>;
  headcount?: { assigned: number; boarded: number; not_checked: number; activity_chosen: number; back_on_boat: number };
};

export default function Home({ settings }: { settings: SettingsMap }) {
  const navigate = useNavigate();
  const { profile, can, canAny, visibleDepartments, badges, badgesError } = useAccess();
  const [summary, setSummary] = useState<Summary>({});
  const [date] = useBusinessDate();
  const [loadError, setLoadError] = useState('');
  const [updated, setUpdated] = useState<Date | null>(null);

  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kuala_Lumpur',
  });

  const load = useCallback(async () => {
    if (!can('ops.log.view')) return;
    const { data, error } = await supabase.rpc('operations_summary', { p_service_date: date });
    if (error) { setLoadError(error.message); return; }
    setSummary((data ?? {}) as Summary);
    setLoadError('');
    setUpdated(new Date());
  }, [can, date]);
  useSharedRefresh(load, { tables: ['bookings', 'boat_assignments', 'trip_bookings', 'trip_passengers'] });

  useEffect(() => {
    void load();
  }, [load]);

  // Anything with a badge is something a person has to deal with today.
  const attention = Object.entries(badges)
    .map(([code, badge]) => {
      const department = visibleDepartments.find((item) => item.code === code);
      const nav = departmentNav.find((item) => item.code === code);
      const target = nav?.links.find((link) => canAny(...link.permissions))?.to;
      return department && target ? { code, name: department.name, target, ...badge } : null;
    })
    .filter((row): row is NonNullable<typeof row> => row !== null && row.count > 0)
    .sort((a, b) => {
      const priority: Record<string, number> = { boarding: 0, activities: 1, fleet: 2, guests: 3 };
      return (priority[a.code] ?? 4) - (priority[b.code] ?? 4) || b.count - a.count;
    });

  const guests = summary.guests;
  const head = summary.headcount;
  const unassigned = Math.max(0, Number(guests?.pax ?? 0) - Number(head?.assigned ?? 0));

  return (
    <>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
        <div>
        <p className="eyebrow">{today}</p>
        <h1 className="mt-1 text-xl font-bold text-ink sm:text-2xl">
          Today at a Glance
        </h1>
        </div>
        {updated ? <span className="text-xs text-muted">Updated {updated.toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kuala_Lumpur'})}</span> : null}
      </header>
      {loadError || badgesError ? <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-amber-50 p-3 text-sm"><span>Updates unavailable. Previously loaded figures may be out of date.</span><button className={secondaryButtonClass} onClick={() => void load()}>Retry</button></div> : null}

      {guests && guests.pax > 0 ? (
        <div className="mb-6 overflow-hidden rounded-xl border border-accent/25 bg-accent/[0.04]">
          <div className="grid grid-cols-3 divide-x divide-accent/15">
            <div className="p-4">
              <p className="eyebrow text-accent/80">Guests today</p>
              <p className="mt-1 text-2xl font-bold tabular leading-none text-accent">{guests.pax}</p>
            </div>
            <div className="p-4">
              <p className="eyebrow text-accent/80">Boats running</p>
              <p className="mt-1 text-2xl font-bold tabular leading-none text-accent">{summary.boats?.length ?? 0}</p>
              <p className="mt-2 truncate text-xs font-medium text-muted">
                {summary.boats?.map((boat) => `${boat.code}${boat.captain ? ` — ${boat.captain}` : ' — no captain'}`).join(', ') || 'Nothing assigned yet'}
              </p>
            </div>
            <div className="p-4">
              <p className="eyebrow text-accent/80">Checked in</p>
              <p className="mt-1 text-2xl font-bold tabular leading-none text-accent">
                {head?.boarded ?? 0}<span className="text-base text-muted">/{guests.pax}</span>
              </p>
              <p className="mt-2 text-xs font-medium text-muted">
                {unassigned > 0 ? `${unassigned} not assigned to a boat` : head && head.assigned > 0 && head.not_checked === 0 ? 'Assigned guests checked in' : `${head?.not_checked ?? 0} awaiting check-in`}
              </p>
            </div>
          </div>
          <p className="flex flex-wrap gap-1.5 border-t border-accent/15 p-3 text-xs font-semibold">
            <Chip>{guests.adults + (guests.elderly || 0)} {guests.adults + (guests.elderly || 0) === 1 ? 'Adult' : 'Adults'}</Chip>
            {guests.children > 0 ? <Chip tone="warn">{guests.children} {guests.children === 1 ? 'Child' : 'Children'}</Chip> : null}
            {guests.infants ? <Chip>{guests.infants} {guests.infants === 1 ? 'Infant' : 'Infants'}</Chip> : null}
            {guests.tour_leaders ? <Chip>{guests.tour_leaders} TL (Local)</Chip> : null}
            {guests.tour_guides ? <Chip>{guests.tour_guides} TG (China)</Chip> : null}
            {guests.assisted ? <Chip tone="alert">{guests.assisted} Needs Help</Chip> : null}
          </p>
        </div>
      ) : null}

      {attention.length > 0 ? (
        <Panel title="Needs your attention" className="mb-6">
          <ul className="divide-y divide-line">
            {attention.map((row) => (
              <li key={row.code}>
                <button
                  type="button"
                  onClick={() => navigate(row.target)}
                  className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition hover:bg-shell"
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-alert/12 text-xs font-bold tabular text-alert">
                    {row.count}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink">{row.name}</span>
                    <span className="block text-xs font-medium text-muted">{row.label}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted" />
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : !badgesError && updated ? (
        <div className="mb-6 flex items-center gap-2.5 rounded-lg border border-palm/30 bg-palm/[0.06] px-3.5 py-3">
          <CheckCircle2 className="h-4.5 w-4.5 shrink-0 text-palm" />
          <p className="text-sm font-medium text-ink">Nothing is waiting on you right now.</p>
        </div>
      ) : null}

      {visibleDepartments.length === 0 ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/[0.06] px-3.5 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="text-sm font-medium text-ink">
            No department is open for this account yet. Ask a master admin to approve it.
          </p>
        </div>
      ) : (
        <div className="grid gap-5">
          {navGroups.map((group) => {
            const members = visibleDepartments.filter((department) => group.departments.includes(department.code));
            if (members.length === 0) return null;
            return (
              <section key={group.code}>
                <h2 className="eyebrow mb-2">{group.label}</h2>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {members.flatMap((department) => {
                    const nav = departmentNav.find((item) => item.code === department.code);
                    const Icon = nav?.icon ?? LayoutGrid;
                    const badge = badges[department.code];
                    return (nav?.links ?? [])
                      .filter((link) => canAny(...link.permissions))
                      .map((link, index) => (
                        <button
                          key={link.to}
                          type="button"
                          onClick={() => navigate(link.to)}
                          className="group relative flex items-start gap-3 rounded-lg border border-line bg-surface p-3.5 text-left transition hover:border-accent/40 hover:shadow-soft"
                        >
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
                            <link.icon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-sm font-semibold text-ink">{link.label}</span>
                              {index === 0 && badge?.count ? (
                                <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-alert px-1.5 text-[0.6875rem] font-bold tabular text-white">
                                  {badge.count}
                                </span>
                              ) : null}
                            </span>
                          </span>
                          <Icon className="h-3.5 w-3.5 shrink-0 text-line transition group-hover:text-accent/40" />
                        </button>
                      ));
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

function Chip({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'warn' | 'alert' }) {
  const tones = {
    default: 'bg-surface text-muted border-line',
    warn: 'bg-warning/10 text-warning border-warning/25',
    alert: 'bg-alert/10 text-alert border-alert/25',
  };
  return <span className={`rounded border px-1.5 py-0.5 tabular ${tones[tone]}`}>{children}</span>;
}
