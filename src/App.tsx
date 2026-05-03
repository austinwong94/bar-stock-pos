import { useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { AlertTriangle } from 'lucide-react';
import { AccessGate } from './components/AccessGate';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/Toast';
import { defaultSettings, loadSettings } from './lib/data';
import { demoProfile } from './lib/demo';
import { hasSupabaseCredentials, setPublicPreviewMode, supabase } from './lib/supabase';
import type { Profile, SettingsMap } from './lib/types';
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
import Users from './pages/Users';
import { LanguageProvider } from './lib/language';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<SettingsMap>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [cloudError, setCloudError] = useState('');
  const [siteUnlocked, setSiteUnlocked] = useState(() => sessionStorage.getItem('lovely_paradise_access') === 'ok');
  const previewProfile = useMemo<Profile>(() => ({ ...demoProfile, full_name: 'Access Verified', role: 'admin' }), []);

  useEffect(() => {
    if (!hasSupabaseCredentials) {
      setPublicPreviewMode(true);
      loadSettings().then(setSettings).catch(() => setSettings(defaultSettings));
      setLoading(false);
      return;
    }

    supabase.auth
      .getSession()
      .then(async ({ data }: { data: { session: Session | null } }) => {
        if (data.session) {
          setSession(data.session);
          return;
        }
        if (sessionStorage.getItem('lovely_paradise_access') === 'ok') {
          const { data: authData, error } = await supabase.auth.signInAnonymously({
            options: { data: { full_name: 'Lovely Paradise Staff', role: 'admin' } },
          });
          if (error) {
            setCloudError('Cloud login is not enabled yet. In Supabase, turn on Anonymous sign-ins.');
            setLoading(false);
            return;
          }
          setSession(authData.session);
        } else {
          setLoading(false);
        }
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
    async function loadUserContext() {
      if (!session?.user) {
        if (hasSupabaseCredentials) return;
        setPublicPreviewMode(false);
        setProfile(previewProfile);
        setSettings(await loadSettings().catch(() => defaultSettings));
        setLoading(false);
        return;
      }
      setLoading(true);
      setPublicPreviewMode(false);
      const [{ data: profileData, error: profileError }, nextSettings] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle(),
        loadSettings().catch(() => defaultSettings),
      ]);
      if (profileError) {
        console.error(profileError);
      }
      setProfile((profileData as Profile | null) ?? previewProfile);
      setSettings(nextSettings);
      setLoading(false);
    }
    void loadUserContext();
  }, [previewProfile, session]);

  const context = useMemo(() => ({ profile, settings }), [profile, settings]);

  if (!siteUnlocked) {
    return <AccessGate onUnlock={() => setSiteUnlocked(true)} />;
  }

  if (!hasSupabaseCredentials) {
    return <CloudRequired message="Cloud database is not connected in this build. Add the Supabase URL and public anon key, rebuild, and reload the site." />;
  }

  if (cloudError) {
    return <CloudRequired message={cloudError} />;
  }

  if (loading) {
    return <div className="grid min-h-screen place-items-center bg-paper font-bold">Loading bar app...</div>;
  }

  if (!session) {
    return <CloudRequired message="Cloud session is not ready. Lock the app, enter the access code again, and make sure Supabase Anonymous sign-ins are enabled." />;
  }

  return (
    <LanguageProvider>
    <ToastProvider>
      <Routes>
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route
          element={
            context.profile ? (
              <Layout profile={context.profile} settings={context.settings} />
            ) : (
              <Navigate to="/" replace />
            )
          }
        >
          <Route index element={<Dashboard settings={settings} />} />
          <Route path="/pos" element={<POS settings={settings} />} />
          <Route path="/stock-in" element={<StockOutReport settings={settings} />} />
          <Route path="/inventory" element={<Inventory settings={settings} />} />
          <Route path="/products" element={<Products settings={settings} onSettingsSaved={setSettings} />} />
          <Route path="/daily-closing" element={<DailyClosing settings={settings} />} />
          <Route path="/daily-report" element={<DailyReport settings={settings} />} />
          <Route path="/stock-out-report" element={<StockOutReport settings={settings} />} />
          <Route path="/sales" element={<SalesHistory settings={settings} />} />
          <Route path="/movements" element={<StockMovements />} />
          <Route path="/settings" element={<Settings settings={settings} onSaved={setSettings} />} />
          <Route path="/users" element={<Users />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ToastProvider>
    </LanguageProvider>
  );
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
          Lock app and retry
        </button>
      </section>
    </main>
  );
}
