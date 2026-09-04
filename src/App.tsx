import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
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

import Home from './pages/Home';
import PendingApproval from './pages/PendingApproval';
import Dashboard from './pages/Dashboard';
import POS from './pages/POS';
import Inventory from './pages/Inventory';
import Products from './pages/Products';
import DailyReport from './pages/DailyReport';
import DailyClosing from './pages/DailyClosing';
import SalesHistory from './pages/SalesHistory';
import StockMovements from './pages/StockMovements';
import StockOutReport from './pages/StockOutReport';
import Settings from './pages/Settings';
import BoatMaintenance from './pages/ops/BoatMaintenance';
import Boarding from './pages/ops/Boarding';
import Activities from './pages/ops/Activities';
import Bookings from './pages/guests/Bookings';
import PickupCoordination from './pages/guests/PickupCoordination';
import BoatBoard from './pages/fleet/BoatBoard';
import BoatRegister from './pages/fleet/BoatRegister';
import AccessControl from './pages/admin/AccessControl';
import Directory from './pages/admin/Directory';
import PlatformSettings from './pages/admin/PlatformSettings';

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

  useEffect(() => {
    if (!session?.user) return;
    setPublicPreviewMode(false);
    loadSettings()
      .then(setSettings)
      .catch(() => setSettings(defaultSettings));
  }, [session]);

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
          <PlatformRoutes settings={settings} onSettingsSaved={setSettings} />
          <DemoBar />
        </AccessProvider>
      </ToastProvider>
    </LanguageProvider>
  );
}

function PlatformRoutes({
  settings,
  onSettingsSaved,
}: {
  settings: SettingsMap;
  onSettingsSaved: (next: SettingsMap) => void;
}) {
  const { profile, loading, visibleDepartments, canAny } = useAccess();

  // A single-department account (a bar tablet, a captain) skips the hub and
  // lands straight on its own screen.
  const soleDepartmentPath = useMemo(() => {
    if (visibleDepartments.length !== 1) return null;
    const group = departmentNav.find((item) => item.code === visibleDepartments[0].code);
    return group?.links.find((link) => canAny(...link.permissions))?.to ?? null;
  }, [canAny, visibleDepartments]);

  if (loading) {
    return <div className="grid min-h-screen place-items-center bg-paper font-bold">Checking your access...</div>;
  }

  if (!profile || profile.status !== 'active') {
    return <PendingApproval name={profile?.full_name ?? 'there'} status={profile?.status ?? 'pending'} />;
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<Layout settings={settings} />}>
        <Route
          index
          element={soleDepartmentPath ? <Navigate to={soleDepartmentPath} replace /> : <Home settings={settings} />}
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

        {/* Boat maintenance */}
        <Route
          path="/maintenance"
          element={
            <Guard need={['maintenance.view', 'maintenance.fuel.record', 'maintenance.repair.record']}>
              <BoatMaintenance settings={settings} />
            </Guard>
          }
        />

        {/* Tourist bookings */}
        <Route
          path="/guests"
          element={
            <Guard need={['guests.booking.create', 'guests.booking.view_own', 'guests.booking.view_all']}>
              <Bookings />
            </Guard>
          }
        />
        <Route
          path="/guests/pickup"
          element={<Guard need={['guests.pickup.manage']}><PickupCoordination settings={settings} /></Guard>}
        />

        {/* Boat assignment */}
        <Route path="/fleet" element={<Guard need={['fleet.view', 'fleet.assign']}><BoatBoard /></Guard>} />
        <Route path="/fleet/boats" element={<Guard need={['fleet.view', 'fleet.boats.manage']}><BoatRegister /></Guard>} />

        {/* Boarding and activities */}
        <Route path="/boarding" element={<Guard need={['boarding.view', 'boarding.view_all', 'boarding.mark']}><Boarding /></Guard>} />
        <Route path="/activities" element={<Guard need={['activities.view', 'activities.select', 'activities.mark']}><Activities /></Guard>} />

        {/* Master admin */}
        <Route path="/admin/access" element={<Guard need={['platform.users.manage', 'platform.roles.manage']}><AccessControl /></Guard>} />
        <Route path="/admin/directory" element={<Guard need={['platform.directory.manage']}><Directory /></Guard>} />
        <Route
          path="/admin/settings"
          element={<Guard need={['platform.settings.manage']}><PlatformSettings settings={settings} onSaved={onSettingsSaved} /></Guard>}
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
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
      <section className="w-full max-w-lg rounded-2xl border border-pink-200 bg-white/95 p-5 shadow-soft sm:rounded-[2rem] sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-pink-50 text-coral">
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
