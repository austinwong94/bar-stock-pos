import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { CalendarClock, Home, LayoutGrid, LogOut, Menu, PanelLeftClose, PanelLeftOpen, ShieldCheck, Waves } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { SettingsMap } from '../lib/types';
import { useLanguage } from '../lib/language';
import { useAccess } from '../lib/access';
import { departmentForPath, departmentNav, navGroups } from '../lib/navigation';
import { AppUpdateNotice } from './AppUpdateNotice';
import { Modal } from './Modal';
import { SectionBoundary } from './SectionBoundary';
import '../bar-workspace.css';

export function Layout({ settings }: { settings: SettingsMap }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { language, setLanguage, text } = useLanguage();
  const { profile, canAny, visibleDepartments, badges } = useAccess();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarPreference,setSidebarPreference]=useState<'auto'|'open'|'closed'>(()=>{try{const v=localStorage.getItem('lovely-paradise:sidebar-hidden');return v==='true'?'closed':v==='false'?'open':'auto';}catch{return 'auto';}});
  const [screenWidth,setScreenWidth]=useState(()=>window.innerWidth);
  const sidebarVisible=screenWidth>=768&&(sidebarPreference==='open'||(sidebarPreference==='auto'&&screenWidth>=1024));
  const sidebarHidden=!sidebarVisible;
  const headerRef=useRef<HTMLElement>(null);
  const [headerHeight,setHeaderHeight]=useState(0);
  function showSidebar(hidden:boolean){setSidebarPreference(hidden?'closed':'open');try{localStorage.setItem('lovely-paradise:sidebar-hidden',String(hidden));}catch{/* This preference is optional. */}}
  useEffect(()=>{const update=()=>setScreenWidth(window.innerWidth);window.addEventListener('resize',update);return()=>window.removeEventListener('resize',update);},[]);
  useEffect(()=>{const header=headerRef.current;if(!header)return;const update=()=>setHeaderHeight(header.getBoundingClientRect().height);const observer=new ResizeObserver(update);observer.observe(header);update();return()=>observer.disconnect();},[]);

  const activeDepartment = departmentForPath(location.pathname);
  const departmentMeta = visibleDepartments.find((item) => item.code === activeDepartment);
  const mobileTitles: Record<string, [string, string]> = {
    '/boarding': ['Boarding Attendance', 'Kehadiran Menaiki Bot'],
    '/activities': ['Island Activities', 'Aktiviti Pulau'],
    '/guests/meal-needs': ['Meals & Allergies', 'Makanan & Alahan'],
    '/kitchen': ['Kitchen', 'Dapur'],
    '/purchasing': ['Kitchen', 'Dapur'],
    '/kitchen/purchases': ['Kitchen', 'Dapur'],
    '/kitchen/finance': ['Kitchen', 'Dapur'],
    '/kitchen/meal-needs': ['Kitchen', 'Dapur'],
    '/kitchen/preparation': ['Kitchen', 'Dapur'],
    '/kitchen/stock': ['Kitchen', 'Dapur'],
  };
  const mobileTitle = mobileTitles[location.pathname];

  // Only a real department gets a sub-menu. On the hub there is none.
  const links = useMemo(() => {
    if (!activeDepartment) return [];
    if (['fleet','boarding','activities'].includes(activeDepartment)) {
      return departmentNav.filter(group => ['fleet','boarding','activities'].includes(group.code))
        .flatMap(group => group.links).filter(link => canAny(...link.permissions));
    }
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

  const showHub = false;
  const totalBadges = ['kitchen', 'purchasing', 'bar'].reduce((sum, code) => sum + (badges[code]?.count ?? 0), 0);

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
                    <span className="min-w-0 flex-1 truncate">{department.code==='kitchen'?text('Kitchen','Dapur'):text('Bar POS','POS Bar')}</span>
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
  const staffAllowed=canAny('staff.self','staff.team.view','staff.leave.approve','staff.attendance.manage');
  const staffLink=staffAllowed?<NavLink to="/staff" onClick={()=>setMenuOpen(false)} className={({isActive})=>`mt-2 flex min-h-11 items-center gap-2.5 rounded-lg px-2.5 text-sm ${isActive?'bg-accent font-semibold text-white':'font-medium text-ink hover:bg-shell'}`}><CalendarClock size={16}/>{text('Attendance & Leave','Kehadiran & Cuti')}</NavLink>:null;

  return (
    <div className="min-h-screen" data-sidebar-hidden={sidebarHidden} style={{'--workspace-header-height':`${sidebarHidden?headerHeight:0}px`} as React.CSSProperties}>
      {/* Desktop rail */}
      <aside id="desktop-sidebar" style={{bottom:'var(--preview-toolbar-height, 0px)'}} className={`no-print fixed inset-y-0 left-0 z-30 w-60 flex-col overflow-y-auto border-r border-line bg-surface px-3 py-4 ${sidebarHidden?'hidden':'flex'}`}>
        <div className="mb-4 flex items-center gap-2.5 px-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent text-white">
            <Waves className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold leading-tight text-ink">
              {String(settings.platform_name ?? 'Lovely Paradise').replace(/\s+Operations?$/i, '')}
            </p>
            <p className="truncate text-xs font-medium text-muted">{profile?.full_name ?? 'Signed in'}</p>
          </div>
          <button type="button" className="grid min-h-11 w-8 shrink-0 place-items-center text-muted" title="Hide Sidebar" aria-label="Hide Sidebar" aria-controls="desktop-sidebar" onClick={()=>showSidebar(true)}><PanelLeftClose size={18}/></button>
        </div>

        {departmentList}
        {staffLink}
        {pageList}

        <div className="mt-auto grid gap-2 border-t border-line pt-4">
          {canAny('platform.users.manage','platform.roles.manage') ? <NavLink to="/admin/access" className="flex min-h-11 items-center gap-2.5 px-2.5 text-sm text-muted"><ShieldCheck size={16}/>{text('Staff Access','Akses Staf')}</NavLink> : null}
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

      <div className={sidebarHidden?'':'pl-60'}>
        {/* Mobile bar */}
        <header ref={headerRef} className={`no-print sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur ${sidebarHidden?'':'hidden'}`}>
          <div className="flex items-center justify-between gap-2 px-3 py-2.5">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="relative grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-line text-ink md:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-4.5 w-4.5" />
              {totalBadges > 0 ? (
                <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-alert px-1 text-[0.625rem] font-bold text-white">
                  {totalBadges > 9 ? '9+' : totalBadges}
                </span>
              ) : null}
            </button>
            <button type="button" className="hidden h-11 w-11 shrink-0 place-items-center rounded-lg border border-line text-muted md:grid" title={text('Show Sidebar','Tunjukkan Bar Sisi')} aria-label="Show Sidebar" aria-controls="desktop-sidebar" onClick={()=>showSidebar(false)}><PanelLeftOpen size={18}/></button>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent text-white"><Waves className="h-4 w-4" /></span>
            <p className="min-w-0 flex-1 text-sm font-bold leading-tight text-ink">{location.pathname==='/staff'?text('Staff','Staf'):mobileTitle?text(...mobileTitle):location.pathname==='/guests/sheet'?text('Booking Sheet','Helaian Tempahan'):departmentMeta?.name ?? String(settings.platform_name ?? 'Lovely Paradise')}</p>
            {staffAllowed?<NavLink to="/staff" className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-line text-muted" aria-label={text('Attendance & Leave','Kehadiran & Cuti')} title={text('Attendance & Leave','Kehadiran & Cuti')}><CalendarClock size={18}/></NavLink>:null}
            <button
              type="button"
              onClick={() => navigate('/')}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-line text-muted"
              aria-label="Home"
              title={text('Home','Utama')}
            >
              <Home className="h-4 w-4" />
            </button>
          </div>
          {links.length>1&&activeDepartment!=='kitchen'?<nav aria-label="Section Navigation" className={`workspace-sections ${activeDepartment === 'bar' ? 'bar-navigation' : ''}`}>{links.map(link=>{
            const short:Record<string,[string,string]>={'/guests/sheet':['Booking Sheet','Tempahan'],'/guests':['Passengers','Penumpang'],'/guests/meal-needs':['Meal Needs','Hidangan'],'/guests/pickup':['Pickup','Pengambilan'],'/fleet':['Boats','Bot'],'/boarding':['Boarding','Menaiki'],'/activities':['Activities','Aktiviti'],'/stock-out-report':['Stock','Stok'],'/daily-closing':['Closing','Penutupan'],'/daily-report':['Reports','Laporan'],'/bar':['Overview','Ringkasan'],'/products':['Admin','Admin']};
            const labels=short[link.to]??[link.label,link.ms??link.label];
            return <NavLink key={link.to} to={link.to} end={link.exact} className={activePath===link.to?'current':''}>{text(labels[0],labels[1])}</NavLink>;
          })}</nav>:null}
        </header>

        {menuOpen ? (
          <Modal title={text('Menu', 'Menu')} onClose={() => setMenuOpen(false)}>
            <div
              className="mobile-menu w-full min-w-0 bg-surface"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between gap-2 px-2.5">
                <p className="truncate text-sm font-bold text-ink">{profile?.full_name ?? 'Signed in'}</p>
              </div>
              {departmentList}
              {staffLink}
              {canAny('platform.users.manage','platform.roles.manage') ? <NavLink to="/admin/access" className="flex min-h-11 items-center gap-2 px-2.5 text-sm text-muted"><ShieldCheck size={16}/>{text('Staff Access','Akses Staf')}</NavLink> : null}
              {pageList}
              <div className="mt-4 grid grid-cols-2 gap-0.5 rounded-lg bg-shell p-0.5 text-xs font-semibold">
                <button onClick={() => setLanguage('en')} className={`rounded px-2 py-1.5 ${language === 'en' ? 'bg-surface text-ink' : 'text-muted'}`}>EN</button>
                <button onClick={() => setLanguage('ms')} className={`rounded px-2 py-1.5 ${language === 'ms' ? 'bg-surface text-ink' : 'text-muted'}`}>BM</button>
              </div>
              <button type="button" onClick={exitApp} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-line text-sm font-semibold"><LogOut className="h-4 w-4" />{text('Sign out','Log keluar')}</button>
            </div>
          </Modal>
        ) : null}

        <main data-mobile-title={!!mobileTitle} className={`${activeDepartment === 'bar' ? 'bar-workspace' : ''} mx-auto w-full ${location.pathname==='/guests/sheet'?'max-w-none':'max-w-[1240px]'} min-w-0 px-3 py-2 sm:px-5 sm:py-4 xl:mx-0 xl:px-8`} style={{paddingBottom:'calc(2rem + var(--preview-toolbar-height, 0px))'}}>
          <AppUpdateNotice />
          <SectionBoundary key={location.pathname}><Outlet /></SectionBoundary>
        </main>
      </div>
    </div>
  );
}

function BadgeDot({ count, inverted = false }: { count: number; inverted?: boolean }) {
  return (
    <span
      className={`grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-[0.6875rem] font-bold tabular ${
        inverted ? 'bg-white/25 text-white' : 'bg-alert text-white'
      }`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
