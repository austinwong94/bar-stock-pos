import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useLanguage } from '../lib/language';

declare const __APP_BUILD_ID__: string;

// An open tab retains its JavaScript after publication. Never reload a worker's
// unfinished entry silently; offer an explicit update after checking the build.
export function AppUpdateNotice() {
  const { text: t } = useLanguage();
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (import.meta.env.DEV) return;
    let active = true;
    let checking = false;
    const check = async () => {
      if (checking || document.hidden) return;
      checking = true;
      try {
        const url = new URL(import.meta.env.BASE_URL + 'version.json', location.origin);
        url.searchParams.set('check', String(Date.now()));
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) return;
        const version = await response.json();
        if (active && typeof version.id === 'string') setAvailable(version.id !== __APP_BUILD_ID__);
      } catch { /* Offline tabs keep their current screen and drafts. */ }
      finally { checking = false; }
    };
    void check();
    const timer = window.setInterval(check, 60000);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  if (!available) return null;
  return <div role="status" className="mb-3 flex items-center justify-between gap-3 rounded-md border border-accent/30 bg-white p-3 text-sm">
    <span>{t('An updated version is ready. Save your entries before reloading.', 'Versi baharu tersedia. Simpan catatan sebelum memuat semula.')}</span>
    <button type="button" className="flex min-h-11 shrink-0 items-center gap-2 rounded-md bg-accent px-3 font-semibold text-white" onClick={() => {
      if (window.confirm(t('Reload now? Any unsaved entries on this page will be lost.', 'Muat semula sekarang? Catatan yang belum disimpan akan hilang.'))) window.location.reload();
    }}><RefreshCw size={16}/>{t('Update', 'Kemas Kini')}</button>
  </div>;
}
