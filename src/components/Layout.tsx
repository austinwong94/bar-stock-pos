import { useEffect, useMemo } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Home, LogOut, Waves } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { SettingsMap } from '../lib/types';
import { useLanguage } from '../lib/language';
import { useAccess } from '../lib/access';
import { departmentForPath, departmentNav } from '../lib/navigation';

export function Layout({ settings }: { settings: SettingsMap }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { language, setLanguage, text } = useLanguage();
  const { profile, canAny, visibleDepartments } = useAccess();

  const activeDepartment = departmentForPath(location.pathname);
  const departmentMeta = visibleDepartments.find((item) => item.code === activeDepartment);

  const links = useMemo(() => {
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
  }, [location.pathname]);

  async function exitApp() {
    await supabase.auth.signOut();
    sessionStorage.removeItem('lovely_paradise_access');
    navigate('/');
    window.location.reload();
  }

  const showHub = visibleDepartments.length > 1;

  return (
    <div className="min-h-screen">
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-72 overflow-y-auto p-5 xl:block">
        <div className="island-panel mb-4 rounded-[2rem] p-5">
          <div className="mb-4 grid h-14 w-14 place-items-center rounded-3xl bg-coral text-white shadow-soft">
            <Waves className="h-7 w-7" />
          </div>
          <p className="text-xs font-black uppercase tracking-widest text-accent">
            {String(settings.platform_name ?? 'Lovely Paradise Operations')}
          </p>
          <h1 className="mt-1 text-2xl font-black leading-tight">{departmentMeta?.name ?? String(settings.business_name)}</h1>
          <p className="mt-2 text-sm font-bold text-neutral-600">{profile?.full_name ?? 'Signed in'}</p>
          <div className="mt-3 grid grid-cols-2 rounded-2xl bg-white/80 p-1 text-xs font-black">
            <button onClick={() => setLanguage('en')} className={`rounded-xl px-3 py-2 ${language === 'en' ? 'bg-accent text-white' : ''}`}>EN</button>
            <button onClick={() => setLanguage('ms')} className={`rounded-xl px-3 py-2 ${language === 'ms' ? 'bg-accent text-white' : ''}`}>BM</button>
          </div>
        </div>

        {showHub ? (
          <nav className="island-panel mb-4 grid gap-1 rounded-[2rem] p-3">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-black ${isActive ? 'bg-accent text-white' : 'text-ink hover:bg-shell'}`
              }
            >
              <Home className="h-4 w-4" />
              {text('All departments', 'Semua jabatan')}
            </NavLink>
            {visibleDepartments.map((department) => {
              const group = departmentNav.find((item) => item.code === department.code);
              const Icon = group?.icon ?? Home;
              const target = group?.links.find((link) => canAny(...link.permissions))?.to ?? '/';
              return (
                <button
                  key={department.code}
                  type="button"
                  onClick={() => navigate(target)}
                  className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-black transition ${
                    department.code === activeDepartment ? 'bg-shell text-accent' : 'text-ink hover:bg-shell'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="min-w-0 truncate">{department.name}</span>
                </button>
              );
            })}
          </nav>
        ) : null}

        {links.length > 1 ? (
          <nav className="island-panel grid gap-2 rounded-[2rem] p-3">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.exact}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-2xl px-4 py-3.5 text-sm font-black transition ${
                    isActive ? 'bg-accent text-white shadow-glow' : 'text-ink hover:bg-shell'
                  }`
                }
              >
                <link.icon className="h-5 w-5" />
                <span>{text(link.label, link.ms ?? link.label)}</span>
              </NavLink>
            ))}
          </nav>
        ) : null}

        <button
          type="button"
          onClick={exitApp}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-line bg-white/80 px-3 py-3 font-bold shadow-soft"
        >
          <LogOut className="h-5 w-5" />
          {text('Sign out', 'Log keluar')}
        </button>
      </aside>

      <div className="xl:pl-72">
        <header className="no-print sticky top-0 z-20 border-b border-line bg-white/90 px-2.5 py-2 backdrop-blur sm:px-4 xl:hidden">
          <div className="mx-auto max-w-[1500px]">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => navigate('/')}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-accent bg-accent text-white shadow-soft"
                  aria-label="All departments"
                >
                  <Waves className="h-5 w-5" />
                </button>
                <strong className="min-w-0 truncate text-sm font-black sm:text-lg">
                  {departmentMeta?.name ?? String(settings.business_name)}
                </strong>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <div className="grid grid-cols-2 rounded-2xl bg-white/80 p-1 text-xs font-black">
                  <button onClick={() => setLanguage('en')} className={`rounded-xl px-2 py-2 ${language === 'en' ? 'bg-accent text-white' : ''}`}>EN</button>
                  <button onClick={() => setLanguage('ms')} className={`rounded-xl px-2 py-2 ${language === 'ms' ? 'bg-accent text-white' : ''}`}>BM</button>
                </div>
                <button type="button" onClick={exitApp} className="rounded-2xl border border-line px-2 py-2 text-xs font-black sm:px-3 sm:text-sm">
                  {text('Sign out', 'Keluar')}
                </button>
              </div>
            </div>
            {links.length > 1 ? (
              <select
                className="mt-2 h-9 w-full rounded-xl border border-line bg-white px-3 text-sm font-black text-ink outline-none focus:border-accent focus:ring-4 focus:ring-teal-100 sm:h-10 sm:rounded-2xl"
                value={activePath}
                onChange={(event) => navigate(event.target.value)}
                aria-label="Current page"
              >
                {links.map((link) => (
                  <option key={link.to} value={link.to}>
                    {link.label}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1320px] min-w-0 px-2.5 py-3 sm:px-4 sm:py-4 lg:px-5 xl:mx-0 xl:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
