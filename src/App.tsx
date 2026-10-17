import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { AlertTriangle } from 'lucide-react';
import { SignIn } from './components/SignIn';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/Toast';
import { defaultSettings, loadSettings } from './lib/data';
import { hasSupabaseCredentials, isDemoMode, setPublicPreviewMode, supabase } from './lib/supabase';
import { AccessProvider, useAccess } from './lib/access';
import { departmentNav } from './lib/navigation';
import type { SettingsMap } from './lib/types';
import { LanguageProvider } from './lib/language';
import { useSharedRefresh } from './lib/useSharedRefresh';
import './supply-workspace.css';

import PendingApproval from './pages/PendingApproval';
const Dashboard = lazy(() => import('./pages/Dashboard'));
const POS = lazy(() => import('./pages/POS'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Products = lazy(() => import('./pages/Products'));
const DailyReport = lazy(() => import('./pages/DailyReport'));
const DailyClosing = lazy(() => import('./pages/DailyClosing'));
const SalesHistory = lazy(() => import('./pages/SalesHistory'));
const StockMovements = lazy(() => import('./pages/StockMovements'));
const StockOutReport = lazy(() => import('./pages/StockOutReport'));
const Settings = lazy(() => import('./pages/Settings'));
const Kitchen = lazy(() => import('./pages/supply/Kitchen'));
const KitchenStock = lazy(() => import('./pages/supply/KitchenStock'));
const Purchasing = lazy(() => import('./pages/supply/PurchasingWorkspace'));
const Finance = lazy(() => import('./pages/supply/FinanceWorkspace'));
const AccessControl = lazy(() => import('./pages/admin/AccessControl'));
const StaffWork = lazy(() => import('./pages/staff/StaffWork'));

const LazyDemoBar = lazy(() =>
  import('./components/DemoBar').then((module) => ({ default: module.DemoBar })),
);

function DemoBar() {
  if (!isDemoMode) return null;
  return (
    <Suspense fallback={null}>
      <LazyDemoBar />
    </Suspense>
  );
}

export default function App() {
  useEffect(() => {
    if (!isDemoMode) document.documentElement.style.setProperty('--preview-toolbar-height', '0px');
  }, []);
  const [session, setSession] = useState<Session | null>(null);
  const [settings, setSettings] = useState<SettingsMap>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [cloudError, setCloudError] = useState('');

  useEffect(() => {
    if (!hasSupabaseCredentials) {
      setPublicPreviewMode(true);
      setLoading(false);
      return;
    }

    supabase.auth
      .getSession()
      .then(({ data }: { data: { session: Session | null } }) => {
        setSession(data.session);
        setLoading(false);
      })
      .catch(() => {
        setCloudError('The cloud database could not be reached. Check the Supabase URL and public anon key.');
        setLoading(false);
      });

    const { data: listener } = supabase.auth.onAuthStateChange((_event: string, nextSession: Session | null) => {
      setSession(nextSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (!hasSupabaseCredentials) {
    return <CloudRequired message="Cloud database is not connected in this build. Add the Supabase URL and public anon key, rebuild, and reload the site." />;
  }

  if (cloudError) {
    return <CloudRequired message={cloudError} />;
  }

  if (loading) {
    return <div className="grid min-h-screen place-items-center bg-paper font-bold">Loading Lovely Paradise...</div>;
  }

  if (!session) {
    return (
      <>
        <SignIn />
        <DemoBar />
      </>
    );
  }

  return (
    <LanguageProvider>
      <ToastProvider>
        <AccessProvider userId={session.user.id}>
          <SessionSettings key={session.user.id} settings={settings} onSettingsSaved={setSettings} />
          <DemoBar />
        </AccessProvider>
      </ToastProvider>
    </LanguageProvider>
  );
}

function SessionSettings({settings,onSettingsSaved}:{settings:SettingsMap;onSettingsSaved:(next:SettingsMap)=>void}) {
  const [ready,setReady]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{const refresh=()=>setRetry(n=>n+1);window.addEventListener('business-settings-refresh',refresh);return()=>window.removeEventListener('business-settings-refresh',refresh);},[]);
  useEffect(()=>{
    let active=true;setPublicPreviewMode(false);setError('');
    void loadSettings().then(next=>{if(active){onSettingsSaved(next);setReady(true);}})
      .catch(()=>{if(active)setError('Business settings could not be loaded. Retry before recording.');});
    return()=>{active=false;};
  },[retry,onSettingsSaved]);
  if(error)return <div className="p-4"><p role="alert">{error}</p><button className="mt-3 rounded-lg border border-line px-4 py-2" onClick={()=>setRetry(n=>n+1)}>Retry</button></div>;
  if(!ready)return <p className="p-4" role="status">Loading business settings...</p>;
  return <PlatformRoutes settings={settings} onSettingsSaved={onSettingsSaved}/>;
}

function PlatformRoutes({
  settings,
  onSettingsSaved,
}: {
  settings: SettingsMap;
  onSettingsSaved: (next: SettingsMap) => void;
}) {
  const { profile, loading, error, reload, visibleDepartments, canAny } = useAccess();

  useSharedRefresh(async () => {
    const next = await loadSettings();
    onSettingsSaved(next);
  }, { tables: ['app_settings'], enabled: Boolean(profile), intervalMs: 60000 });

  // A single-department account (a bar tablet, a captain) skips the hub and
  // lands straight on its own screen.
  const soleDepartmentPath = useMemo(() => {
    if(canAny('purchasing.cost.manage','platform.settings.manage')&&canAny('purchasing.cost.view'))return '/kitchen/finance';
    if(canAny('purchasing.fulfil'))return '/kitchen/purchases';
    if (!visibleDepartments.length) return canAny('staff.self','staff.team.view','staff.leave.approve','staff.attendance.manage')?'/staff':null;
    const group = departmentNav.find((item) => item.code === visibleDepartments[0].code);
    return group?.links.find((link) => canAny(...link.permissions))?.to ?? null;
  }, [canAny, visibleDepartments]);

  if (loading) {
    return <div className="grid min-h-screen place-items-center bg-paper font-bold">Checking your access...</div>;
  }

  if (!profile || profile.status !== 'active') {
    if (error) return <div className="p-4"><p role="alert">{error}</p><button type="button" className="mt-3 rounded-lg border border-line px-4 py-2" onClick={() => void reload()}>Retry</button></div>;
    return <PendingApproval name={profile?.full_name ?? 'there'} status={profile?.status ?? 'pending'} />;
  }

  return (
    <>
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<Layout settings={settings} />}>
        <Route
          index
          element={soleDepartmentPath ? <Navigate to={soleDepartmentPath} replace /> : <UnavailableSection />}
        />

        {/* Bar POS department - the original app, now one department */}
        <Route path="/bar" element={<Guard need={['bar.pos.use', 'bar.stock.view']}><Dashboard settings={settings} /></Guard>} />
        <Route path="/pos" element={<Guard need={['bar.pos.use']}><POS settings={settings} /></Guard>} />
        <Route path="/stock-in" element={<Guard need={['bar.stock.view', 'bar.stock.manage']}><StockOutReport settings={settings} /></Guard>} />
        <Route path="/stock-out-report" element={<Guard need={['bar.stock.view', 'bar.stock.manage']}><StockOutReport settings={settings} /></Guard>} />
        <Route path="/inventory" element={<Guard need={['bar.stock.view']}><Inventory settings={settings} /></Guard>} />
        <Route path="/products" element={<Guard need={['bar.products.manage']}><Products settings={settings} onSettingsSaved={onSettingsSaved} /></Guard>} />
        <Route path="/daily-closing" element={<Guard need={['bar.closing.manage']}><DailyClosing settings={settings} /></Guard>} />
        <Route path="/daily-report" element={<Guard need={['bar.reports.view']}><DailyReport settings={settings} /></Guard>} />
        <Route path="/sales" element={<Guard need={['bar.reports.view']}><SalesHistory settings={settings} /></Guard>} />
        <Route path="/movements" element={<Guard need={['bar.stock.view']}><StockMovements /></Guard>} />
        <Route path="/settings" element={<Guard need={['bar.settings.manage']}><Settings settings={settings} onSaved={onSettingsSaved} /></Guard>} />
        <Route path="/users" element={<Navigate to="/admin/access" replace />} />

        {/* Kitchen is one workspace, including purchases. Retired links never mount old pages. */}
        <Route path="/kitchen" element={<Guard need={['kitchen.request.view', 'kitchen.request.create']}><Kitchen /></Guard>} />
        <Route path="/kitchen/stock" element={<Guard need={['kitchen.production.manage', 'purchasing.receive', 'kitchen.stock.count']}><KitchenStock /></Guard>} />
        <Route path="/kitchen/purchases" element={<Guard need={['purchasing.view', 'purchasing.fulfil']}><Purchasing settings={settings} /></Guard>} />
        <Route path="/kitchen/finance" element={<Guard need={['purchasing.cost.view']}><Finance /></Guard>} />
        <Route path="/purchasing" element={<PurchaseRedirect />} />
        <Route path="/kitchen/meal-needs" element={<Navigate to="/kitchen/stock?view=usage" replace />} />
        <Route path="/kitchen/preparation" element={<Navigate to="/kitchen/stock?view=usage" replace />} />
        <Route path="/admin/access" element={<Guard need={['platform.users.manage', 'platform.roles.manage']}><AccessControl /></Guard>} />
        <Route path="/staff" element={<Guard need={['staff.self','staff.team.view','staff.leave.approve','staff.attendance.manage']}><StaffWork /></Guard>} />

        <Route path="*" element={<UnavailableSection />} />
      </Route>
    </Routes>
    </>
  );
}

function PurchaseRedirect() {
  const { search } = useLocation();
  return <Navigate to={'/kitchen/purchases' + search} replace />;
}

function UnavailableSection() {
  const { canAny } = useAccess();
  return <section className="py-6">
    <h1 className="text-xl font-bold">Section Not Available</h1>
    <p className="mt-2 text-sm text-muted">Kitchen, Bar POS and Staff Attendance & Leave are open at this stage.</p>
    <div className="mt-4 flex flex-wrap gap-3">
      {canAny('kitchen.production.manage','purchasing.receive','kitchen.stock.count') ? <Link className="rounded-md border border-line px-4 py-3 text-sm font-semibold" to="/kitchen/stock">Kitchen</Link> : null}
      {canAny('bar.pos.use') ? <Link className="rounded-md border border-line px-4 py-3 text-sm font-semibold" to="/pos">Bar POS</Link> : null}
    </div>
  </section>;
}

// Belt and braces on top of RLS: a page never renders for someone whose
// permissions do not cover it, even if they type the URL.
function Guard({ need, children }: { need: string[]; children: React.ReactNode }) {
  const { canAny } = useAccess();
  if (!canAny(...need)) {
    return (
      <div className="rounded-2xl border border-line bg-white/85 p-6 text-center shadow-soft">
        <p className="text-lg font-black">This section is not part of your access.</p>
        <p className="mt-2 text-sm font-semibold text-neutral-600">
          Ask a master admin if you need it opened for your account.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

function CloudRequired({ message }: { message: string }) {
  function lockApp() {
    sessionStorage.removeItem('lovely_paradise_access');
    window.location.reload();
  }

  return (
    <main className="grid min-h-screen place-items-center bg-paper px-4 py-8">
      <section className="w-full max-w-lg rounded-2xl border border-line bg-white/95 p-5 shadow-soft sm:rounded-2xl sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-shell text-alert">
            <AlertTriangle className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-xl font-black">Cloud database required</h1>
            <p className="mt-2 text-sm font-bold text-neutral-700">{message}</p>
          </div>
        </div>
        <button type="button" className="mt-5 h-11 w-full rounded-xl bg-accent px-4 text-sm font-black text-white" onClick={lockApp}>
          Reload
        </button>
      </section>
    </main>
  );
}
