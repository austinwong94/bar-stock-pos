import { useNavigate } from 'react-router-dom';
import { ArrowRight, Home as HomeIcon } from 'lucide-react';
import { PageHeader } from '../components/Page';
import { useAccess } from '../lib/access';
import { departmentNav } from '../lib/navigation';
import type { SettingsMap } from '../lib/types';

export default function Home({ settings }: { settings: SettingsMap }) {
  const navigate = useNavigate();
  const { profile, canAny, visibleDepartments } = useAccess();

  return (
    <>
      <PageHeader
        title={String(settings.platform_name ?? 'Lovely Paradise Operations')}
        subtitle={`Signed in as ${profile?.full_name ?? 'staff'}. You see only the departments your access covers.`}
      />

      {visibleDepartments.length === 0 ? (
        <div className="rounded-2xl border border-line bg-white/85 p-6 text-center shadow-soft">
          <p className="font-black">No department is open for this account yet.</p>
          <p className="mt-2 text-sm font-semibold text-neutral-600">
            Ask a master admin to approve your account and give it access.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visibleDepartments.map((department) => {
            const group = departmentNav.find((item) => item.code === department.code);
            const Icon = group?.icon ?? HomeIcon;
            const target = group?.links.find((link) => canAny(...link.permissions))?.to ?? '/';
            return (
              <button
                key={department.code}
                type="button"
                onClick={() => navigate(target)}
                className="island-card group flex min-h-[9rem] flex-col justify-between rounded-[1.5rem] p-4 text-left transition hover:-translate-y-0.5 hover:shadow-soft sm:p-5"
              >
                <div className="flex items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-accent text-white shadow-glow">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-base font-black leading-tight sm:text-lg">{department.name}</p>
                    <p className="mt-1 text-xs font-semibold leading-relaxed text-neutral-600 sm:text-sm">
                      {department.description}
                    </p>
                  </div>
                </div>
                <span className="mt-4 inline-flex items-center gap-1 text-xs font-black uppercase tracking-wide text-accent">
                  Open <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
