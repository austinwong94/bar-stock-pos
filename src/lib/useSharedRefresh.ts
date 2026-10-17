import { useEffect, useRef } from 'react';
import { isSupabaseConfigured, supabase } from './supabase';

type SharedRefreshOptions = {
  tables?: string[];
  intervalMs?: number;
  enabled?: boolean;
};

export function useSharedRefresh(
  refresh: () => unknown | Promise<unknown>,
  { tables = [], intervalMs = 30000, enabled = true }: SharedRefreshOptions = {},
) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const tablesKey = tables.join(',');

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    let disposed = false;
    let refreshing = false;
    let queued = false;

    const run = (allowWhenHidden = false) => {
      if (disposed) return;
      if (!allowWhenHidden && document.visibilityState === 'hidden') return;
      if (refreshing) {
        queued = true;
        return;
      }
      refreshing = true;
      void Promise.resolve().then(() => refreshRef.current())
        .catch((error) => console.error('Shared refresh failed', error))
        .finally(() => {
          refreshing = false;
          if (queued && !disposed) {
            queued = false;
            run(allowWhenHidden);
          }
        });
    };

    const onFocus = () => run();
    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };
    const onOnline = () => run();
    const onStorage = (event: StorageEvent) => {
      if (event.key?.startsWith('lovely_paradise_')) run(true);
    };

    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisible);

    const timer = window.setInterval(() => run(), intervalMs);
    let channel: any = null;
    const tableList = tablesKey.split(',').map((table) => table.trim()).filter(Boolean);

    if (isSupabaseConfigured && tableList.length > 0) {
      channel = supabase.channel(`lovely-paradise-refresh-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      tableList.forEach((table) => {
        channel = channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table },
          () => run(),
        );
      });
      channel.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') run();
      });
    }

    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
      if (channel) void channel.unsubscribe();
    };
  }, [enabled, intervalMs, tablesKey]);
}
