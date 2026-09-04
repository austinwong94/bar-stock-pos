import { useNavigate } from 'react-router-dom';
import { ArrowRight, LayoutGrid } from 'lucide-react';
import { PageHeader, EmptyState } from '../components/Page';
import { useAccess } from '../lib/access';
import { departmentNav } from '../lib/navigation';
import type { SettingsMap } from '../lib/types';

export default function Home({ settings }: { settings: SettingsMap }) {
  const navigate = useNavigate();
  const { profile, canAny, visibleDepartments, badges } = useAccess();

  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Asia/Kuala_Lumpur',
  });

  return (
    <>
      <PageHeader
        title={String(settings.platform_name ?? 'Lovely Paradise Operations')}
        subtitle={`${today} · signed in as ${profile?.full_name ?? 'staff'}. You only see the departments your access covers.`}
      />

      {visibleDepartments.length === 0 ? (
        <EmptyState>
          No department is open for this account yet. Ask a master admin to approve it and give it access.
        </EmptyState>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {visibleDepartments.map((department) => {
            const group = departmentNav.find((item) => item.code === department.code);
            const Icon = group?.icon ?? LayoutGrid;
            const target = group?.links.find((link) => canAny(...link.permissions))?.to ?? '/';
            const badge = badges[department.code];
            return (
              <button
                key={department.code}
                type="button"
                onClick={() => navigate(target)}
                className="group relative flex min-h-[8.5rem] flex-col justify-between rounded-lg border border-line bg-surface p-4 text-left transition hover:border-accent/40 hover:bg-shell/40"
              >
                {badge?.count ? (
                  <span
                    className="absolute right-3 top-3 grid h-6 min-w-6 place-items-center rounded-full bg-coral px-1.5 text-xs font-bold tabular text-white"
                    aria-label={`${badge.count} ${badge.label}`}
                  >
                    {badge.count > 99 ? '99+' : badge.count}
                  </span>
                ) : null}

                <div>
                  <span className="mb-3 grid h-9 w-9 place-items-center rounded-lg bg-accent/10 text-accent">
                    <Icon className="h-4.5 w-4.5" />
                  </span>
                  <p className="pr-8 text-base font-bold leading-tight text-ink">{department.name}</p>
                  <p className="mt-1 text-[0.8125rem] font-medium leading-relaxed text-muted">
                    {department.description}
                  </p>
                </div>

                <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-accent">
                  {badge?.count ? (
                    <span className="text-coral">{badge.count} {badge.label}</span>
                  ) : (
                    <>Open <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" /></>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
