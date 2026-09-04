import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LayoutGrid, LogOut, Menu, Waves, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { SettingsMap } from '../lib/types';
import { useLanguage } from '../lib/language';
import { useAccess } from '../lib/access';
import { departmentForPath, departmentNav, navGroups } from '../lib/navigation';

export function Layout({ settings }: { settings: SettingsMap }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { language, setLanguage, text } = useLanguage();
  const { profile, canAny, visibleDepartments, badges } = useAccess();
  const [menuOpen, setMenuOpen] = useState(false);

  const activeDepartment = departmentForPath(location.pathname);
  const departmentMeta = visibleDepartments.find((item) => item.code === activeDepartment);

  // Only a real department gets a sub-menu. On the hub there is none.
  const links = useMemo(() => {
    if (!activeDepartment) return [];
    const group = departmentNav.find((item) => item.code === activeDepartment);
    if (!group) return [];
    return group.links.filter((link) => canAny(...link.permissions));
  }, [activeDepartment, canAny]);

  const activePath =
    links.find((link) => (link.exact ? location.pathname === link.to : location.pathname.startsWith(link.to)))?.to ??
    links[0]?.to ??
    '/';

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
    setMenuOpen(false);
  }, [location.pathname]);

  async function exitApp() {
    await supabase.auth.signOut();
    sessionStorage.removeItem('lovely_paradise_access');
    navigate('/');
    window.location.reload();
  }

  const showHub = visibleDepartments.length > 1;
  const totalBadges = Object.values(badges).reduce((sum, badge) => sum + badge.count, 0);

  // Departments are shown under the moment of the day you reach for them,
  // and the active one expands to its pages inline. Nothing hides at the
  // bottom of a flat list of eleven.
  const departmentList = (
    <nav className="grid gap-3">
      {showHub ? (
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-semibold transition ${
              isActive ? 'bg-accent text-white' : 'text-ink hover:bg-shell'
            }`
          }
        >
          <LayoutGrid className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{text('Today at a glance', 'Hari ini')}</span>
          {totalBadges > 0 ? <BadgeDot count={totalBadges} /> : null}
        </NavLink>
      ) : null}

      {navGroups.map((group) => {
        const members = visibleDepartments.filter((department) => group.departments.includes(department.code));
        if (members.length === 0) return null;
        return (
          <div key={group.code} className="grid gap-0.5">
            <p className="eyebrow px-2.5 pb-0.5">{text(group.label, group.ms)}</p>
            {members.map((department) => {
              const nav = departmentNav.find((item) => item.code === department.code);
              const Icon = nav?.icon ?? LayoutGrid;
              const pages = (nav?.links ?? []).filter((link) => canAny(...link.permissions));
              const target = pages[0]?.to ?? '/';
              const active = department.code === activeDepartment;
              const badge = badges[department.code];
              return (
                <div key={department.code}>
                  <button
                    type="button"
                    onClick={() => navigate(target)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition ${
                      active ? 'bg-accent font-semibold text-white' : 'font-medium text-ink hover:bg-shell'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{department.name}</span>
                    {badge?.count ? <BadgeDot count={badge.count} inverted={active} /> : null}
                  </button>

                  {active && pages.length > 1 ? (
                    <div className="mb-1 ml-[1.4rem] grid gap-0.5 border-l border-line pl-2 pt-0.5">
                      {pages.map((link) => (
                        <NavLink
                          key={link.to}
                          to={link.to}
                          end={link.exact}
                          className={({ isActive }) =>
                            `truncate rounded-lg px-2.5 py-1.5 text-[0.8125rem] transition ${
                              isActive ? 'bg-shell font-semibold text-accent' : 'font-medium text-muted hover:bg-shell hover:text-ink'
                            }`
                          }
                        >
                          {text(link.label, link.ms ?? link.label)}
                        </NavLink>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        );
      })}
    </nav>
  );

  const pageList = null;

  return (
    <div className="min-h-screen">
      {/* Desktop rail */}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 flex-col overflow-y-auto border-r border-line bg-surface px-3 py-4 xl:flex">
        <div className="mb-4 flex items-center gap-2.5 px-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent text-white">
            <Waves className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold leading-tight text-ink">
              {String(settings.platform_name ?? 'Lovely Paradise').replace(/\s+Operations?$/i, '')}
            </p>
            <p className="truncate text-xs font-medium text-muted">{profile?.full_name ?? 'Signed in'}</p>
          </div>
        </div>

        {departmentList}
        {pageList}

        <div className="mt-auto grid gap-2 border-t border-line pt-4">
          <div className="grid grid-cols-2 gap-0.5 rounded-lg bg-shell p-0.5 text-xs font-semibold">
            <button onClick={() => setLanguage('en')} className={`rounded px-2 py-1.5 transition ${language === 'en' ? 'bg-surface text-ink' : 'text-muted'}`}>EN</button>
            <button onClick={() => setLanguage('ms')} className={`rounded px-2 py-1.5 transition ${language === 'ms' ? 'bg-surface text-ink' : 'text-muted'}`}>BM</button>
          </div>
          <button
            type="button"
            onClick={exitApp}
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-semibold text-muted transition hover:bg-shell hover:text-ink"
          >
            <LogOut className="h-4 w-4" />
            {text('Sign out', 'Log keluar')}
          </button>
        </div>
      </aside>

      <div className="xl:pl-64">
        {/* Mobile bar */}
        <header className="no-print sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur xl:hidden">
          <div className="flex items-center justify-between gap-2 px-3 py-2.5">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="relative grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-ink"
              aria-label="Open menu"
            >
              <Menu className="h-4.5 w-4.5" />
              {totalBadges > 0 ? (
                <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-coral px-1 text-[0.625rem] font-bold text-white">
                  {totalBadges > 9 ? '9+' : totalBadges}
                </span>
              ) : null}
            </button>
            <p className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
              {departmentMeta?.name ?? String(settings.platform_name ?? 'Lovely Paradise')}
            </p>
            <button
              type="button"
              onClick={exitApp}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-muted"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>

          {links.length > 1 ? (
            <div className="table-scroll flex gap-1 border-t border-line px-3 py-1.5">
              {links.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.exact}
                  className={({ isActive }) =>
                    `shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                      isActive ? 'bg-accent text-white' : 'bg-shell text-muted'
                    }`
                  }
                >
                  {text(link.label, link.ms ?? link.label)}
                </NavLink>
              ))}
            </div>
          ) : null}
        </header>

        {menuOpen ? (
          <div className="no-print fixed inset-0 z-40 bg-ink/35 xl:hidden" onClick={() => setMenuOpen(false)}>
            <div
              className="h-full w-[17rem] overflow-y-auto border-r border-line bg-surface px-3 py-4"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between gap-2 px-2.5">
                <p className="truncate text-sm font-bold text-ink">{profile?.full_name ?? 'Signed in'}</p>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted"
                  aria-label="Close menu"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {departmentList}
              {pageList}
              <div className="mt-4 grid grid-cols-2 gap-0.5 rounded-lg bg-shell p-0.5 text-xs font-semibold">
                <button onClick={() => setLanguage('en')} className={`rounded px-2 py-1.5 ${language === 'en' ? 'bg-surface text-ink' : 'text-muted'}`}>EN</button>
                <button onClick={() => setLanguage('ms')} className={`rounded px-2 py-1.5 ${language === 'ms' ? 'bg-surface text-ink' : 'text-muted'}`}>BM</button>
              </div>
            </div>
          </div>
        ) : null}

        <main className="mx-auto w-full max-w-[1240px] min-w-0 px-3 py-4 sm:px-5 sm:py-6 xl:mx-0 xl:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function BadgeDot({ count, inverted = false }: { count: number; inverted?: boolean }) {
  return (
    <span
      className={`grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-[0.6875rem] font-bold tabular ${
        inverted ? 'bg-white/25 text-white' : 'bg-coral text-white'
      }`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
