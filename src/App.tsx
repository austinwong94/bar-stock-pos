import { useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
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
  const [siteUnlocked, setSiteUnlocked] = useState(() => sessionStorage.getItem('lovely_paradise_access') === 'ok');
  const previewProfile = useMemo<Profile>(() => ({ ...demoProfile, full_name: 'Access Verified', role: 'admin' }), []);

  useEffect(() => {
    if (!hasSupabaseCredentials) {
      setPublicPreviewMode(true);
      loadSettings().then(setSettings).catch(() => setSettings(defaultSettings));
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event: string, nextSession: Session | null) => {
      setSession(nextSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    async function loadUserContext() {
      if (!session?.user) {
        setPublicPreviewMode(false);
        setProfile(previewProfile);
        setSettings(await loadSettings().catch(() => defaultSettings));
        setLoading(false);
        return;
      }
      setLoading(true);
      setPublicPreviewMode(false);
      const [{ data: profileData, error: profileError }, nextSettings] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', session.user.id).single(),
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
    return (
      <LanguageProvider>
      <ToastProvider>
        <Routes>
          <Route element={<Layout profile={demoProfile} settings={settings} publicPreview />}>
            <Route index element={<Dashboard settings={settings} />} />
            <Route path="/pos" element={<POS settings={settings} />} />
            <Route path="/stock-in" element={<StockOutReport settings={settings} />} />
            <Route path="/inventory" element={<Inventory settings={settings} />} />
            <Route path="/products" element={<Products settings={settings} />} />
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

  if (loading) {
    return <div className="grid min-h-screen place-items-center bg-paper font-bold">Loading bar app...</div>;
  }

  return (
    <LanguageProvider>
    <ToastProvider>
      <Routes>
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route
          element={
            context.profile ? (
              <Layout profile={context.profile} settings={context.settings} publicPreview={!session} />
            ) : (
              <Navigate to="/" replace />
            )
          }
        >
          <Route index element={<Dashboard settings={settings} />} />
          <Route path="/pos" element={<POS settings={settings} />} />
          <Route path="/stock-in" element={<StockOutReport settings={settings} />} />
          <Route path="/inventory" element={<Inventory settings={settings} />} />
          <Route path="/products" element={<Products settings={settings} />} />
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
