import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  CalendarCheck2,
  LayoutDashboard,
  LogOut,
  PackageMinus,
  Settings,
  ShoppingCart,
  Waves,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Profile, SettingsMap } from '../lib/types';
import { roleAtLeast } from '../lib/data';
import { useLanguage } from '../lib/language';

const links = [
  { to: '/', label: 'Dashboard', ms: 'Jualan', icon: LayoutDashboard, min: 'cashier' },
  { to: '/pos', label: 'POS', icon: ShoppingCart, min: 'cashier' },
  { to: '/stock-out-report', label: 'Stock Activity', ms: 'Aktiviti Stok', icon: PackageMinus, min: 'manager' },
  { to: '/daily-closing', label: 'Closing', ms: 'Tutup Harian', icon: CalendarCheck2, min: 'manager' },
  { to: '/daily-report', label: 'Reports', ms: 'Laporan', icon: BarChart3, min: 'manager' },
  { to: '/products', label: 'Admin', ms: 'Pentadbir', icon: Settings, min: 'admin' },
] as const;

export function Layout({
  profile,
  settings,
  publicPreview = false,
}: {
  profile: Profile;
  settings: SettingsMap;
  publicPreview?: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { language, setLanguage, text } = useLanguage();
  const visibleLinks = links.filter((link) => roleAtLeast(profile.role, link.min));
  const activePath =
    visibleLinks.find((link) => (link.to === '/' ? location.pathname === '/' : location.pathname.startsWith(link.to)))?.to ?? '/';

  async function exitApp() {
    if (publicPreview) {
      sessionStorage.removeItem('lovely_paradise_access');
      window.location.reload();
      return;
    }
    await supabase.auth.signOut();
    sessionStorage.removeItem('lovely_paradise_access');
    navigate('/');
    window.location.reload();
  }

  return (
    <div className="min-h-screen">
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-72 p-5 xl:block">
        <div className="island-panel mb-5 rounded-[2rem] p-5">
          <div className="mb-4 grid h-14 w-14 place-items-center rounded-3xl bg-coral text-white shadow-soft">
            <Waves className="h-7 w-7" />
          </div>
          <p className="text-xs font-black uppercase tracking-widest text-accent">Island Bar POS</p>
          <h1 className="mt-1 text-3xl font-black">{String(settings.business_name)}</h1>
          <p className="mt-2 text-sm font-bold text-neutral-600">
            {publicPreview ? text('Access verified', 'Akses disahkan') : `${profile.full_name ?? profile.role} · ${profile.role}`}
          </p>
          <p className="mt-3 rounded-2xl bg-shell px-3 py-2 text-xs font-bold text-neutral-600">
            {text('English', 'Bahasa Melayu')} · MYR / RMB
          </p>
          <div className="mt-3 grid grid-cols-2 rounded-2xl bg-white/80 p-1 text-xs font-black">
            <button onClick={() => setLanguage('en')} className={`rounded-xl px-3 py-2 ${language === 'en' ? 'bg-accent text-white' : ''}`}>EN</button>
            <button onClick={() => setLanguage('ms')} className={`rounded-xl px-3 py-2 ${language === 'ms' ? 'bg-accent text-white' : ''}`}>BM</button>
          </div>
        </div>
        <nav className="island-panel grid gap-2 rounded-[2rem] p-3">
          {visibleLinks
            .map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-2xl px-4 py-4 text-sm font-black transition ${
                    isActive ? 'bg-accent text-white shadow-glow' : 'text-ink hover:bg-shell'
                  }`
                }
              >
                <link.icon className="h-5 w-5" />
                <span>
                  <span className="block">{link.label}</span>
                  {'ms' in link ? <span className="block text-xs opacity-75">{link.ms}</span> : null}
                </span>
              </NavLink>
            ))}
        </nav>
        <button
          type="button"
          onClick={exitApp}
          className="absolute bottom-5 left-5 right-5 flex items-center justify-center gap-2 rounded-2xl border border-line bg-white/80 px-3 py-3 font-bold shadow-soft"
        >
          <LogOut className="h-5 w-5" />
          {publicPreview ? 'Lock app' : 'Sign out'}
        </button>
      </aside>
      <div className="xl:pl-72">
        <header className="no-print sticky top-0 z-20 border-b border-line bg-white/90 px-3 py-2 backdrop-blur sm:px-4 xl:hidden">
          <div className="mx-auto max-w-[1500px]">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-accent bg-accent text-white shadow-soft">
                  <Waves className="h-5 w-5" />
                </span>
                <strong className="min-w-0 truncate text-base font-black sm:text-lg">{String(settings.business_name)}</strong>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <div className="grid grid-cols-2 rounded-2xl bg-white/80 p-1 text-xs font-black">
                  <button onClick={() => setLanguage('en')} className={`rounded-xl px-2 py-2 ${language === 'en' ? 'bg-accent text-white' : ''}`}>EN</button>
                  <button onClick={() => setLanguage('ms')} className={`rounded-xl px-2 py-2 ${language === 'ms' ? 'bg-accent text-white' : ''}`}>BM</button>
                </div>
                <button type="button" onClick={exitApp} className="rounded-2xl border border-line px-2 py-2 text-xs font-black sm:px-3 sm:text-sm">
                  {publicPreview ? 'Lock app' : 'Sign out'}
                </button>
              </div>
            </div>
            <select
              className="mt-2 h-10 w-full rounded-2xl border border-line bg-white px-3 text-sm font-black text-ink outline-none focus:border-accent focus:ring-4 focus:ring-teal-100"
              value={activePath}
              onChange={(event) => navigate(event.target.value)}
              aria-label="Current page"
            >
              {visibleLinks.map((link) => (
                <option key={link.to} value={link.to}>
                  {link.label}
                </option>
              ))}
            </select>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1500px] min-w-0 px-3 py-5 sm:px-4 lg:px-6 xl:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
