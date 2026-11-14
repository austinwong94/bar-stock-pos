import { useEffect, useRef, useState } from 'react';
import { useToast } from '../components/Toast';
import { useAccess } from './access';
import { useLanguage } from './language';
import { isSupabaseConfigured, supabase } from './supabase';
import { createReportReopen, readReportReopen, reportReopenConfirmed, reportReopenKey, writeReportReopen, type ReportReopen } from './reportReopen';
import { productSaveDeadline, withProductSaveLock } from './productSaveRecovery';
import { definitiveInitialSaveFailure } from './saveAttempt';
import { readErrorMessage } from './opsData';
import type { DailyReport } from './types';

export function useReportReopen(actor: string | null, onResolved: () => Promise<unknown>) {
  const {text} = useLanguage(), toast = useToast(), {can} = useAccess();
  const key = isSupabaseConfigured && actor ? reportReopenKey(import.meta.env?.VITE_SUPABASE_URL ?? 'cloud', actor) : null;
  const alive = useRef(true), busyRef = useRef(false), resolved = useRef(onResolved); resolved.current = onResolved;
  function read() {
    let raw: string | null = null;
    try { raw = key ? localStorage.getItem(key) : null; return {raw, operation: readReportReopen(raw, actor ?? undefined), error: ''}; }
    catch (error) { return {raw, operation: null, error: readErrorMessage(error)}; }
  }
  const [recovery, setRecovery] = useState(read), [busy, setBusy] = useState(false);
  const pending = recovery.operation, blocked = busy || !!pending || !!recovery.error;
  function retain(next: ReportReopen | null, expected: string | null) {
    if (!key) throw Error('Sign in again before reopening a report.');
    const raw = writeReportReopen(localStorage, key, next, expected); setRecovery({raw, operation: next, error: ''}); return raw;
  }
  useEffect(() => {
    alive.current = true;
    const changed = (event: StorageEvent) => { if (event.key === key || event.key === null) { const next = read(); setRecovery(next); if (!next.raw && !next.error) void resolved.current(); } };
    window.addEventListener('storage', changed);
    return () => { alive.current = false; window.removeEventListener('storage', changed); };
  }, [key]);
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);
  async function submit(operation: ReportReopen, original: string | null) {
    const attempted = retain({...operation, attempted: true}, original);
    let confirmed = false;
    try {
      const result = await productSaveDeadline<{data: unknown; error: unknown}>(supabase.rpc('reopen_daily_report_checked', operation.args));
      if (!alive.current) return false;
      if (result.error) throw result.error;
      if (!reportReopenConfirmed(result.data, operation)) throw Error('The reopening reply could not be verified.');
      confirmed = true; retain(null, attempted);
      // The proof may be historical. Only a fresh read can determine whether the report is still open.
      await resolved.current();
      if (alive.current) toast.success(text('Report reopening confirmed.', 'Pembukaan semula laporan disahkan.'));
      return true;
    } catch (error) {
      if (!alive.current) return false;
      if (!confirmed && definitiveInitialSaveFailure(operation.attempted, error)) retain(null, attempted);
      throw error;
    }
  }
  async function execute(report?: DailyReport, version?: string) {
    if (busyRef.current || recovery.error || (report && pending) || !can('bar.closing.manage')) return false;
    busyRef.current = true; setBusy(true);
    try {
      if (!key || !actor) throw Error('Sign in again before reopening a report.');
      return await withProductSaveLock(navigator.locks, key, async () => {
        if (!alive.current) return false;
        const operation = pending ?? createReportReopen(report!, version!, actor);
        return submit(operation, pending ? recovery.raw : retain(operation, null));
      });
    } catch (error) {
      if (alive.current) {
        const next = read(); setRecovery(next);
        const code = (error as {code?: string})?.code;
        toast.error(code === 'PRODUCT_LOCKED' ? text('Another tab is reopening a report. Wait, then check it.', 'Tab lain sedang membuka semula laporan. Tunggu, kemudian semaknya.')
          : code === 'PRODUCT_LOCK_UNAVAILABLE' ? text('Use an updated browser to reopen reports safely.', 'Gunakan pelayar terkini untuk membuka semula laporan dengan selamat.')
          : next.raw && code === '42501' ? text('Unlock editing from Reports, then return to check this original reopening.', 'Buka kunci sunting daripada Laporan, kemudian kembali untuk menyemak pembukaan semula asal ini.')
          : next.raw ? text('Result not confirmed. Check the original reopening before another change.', 'Keputusan belum disahkan. Semak pembukaan semula asal sebelum perubahan lain.')
          : code === '40001' ? text('This report changed. Reload and review it from Reports.', 'Laporan ini berubah. Muat semula dan semak daripada Laporan.')
          : code === '42501' ? text('Open edit from Reports and enter the admin password first.', 'Buka sunting daripada Laporan dan masukkan kata laluan admin dahulu.')
          : text('Report could not be reopened. Return to Reports and try again.', 'Laporan tidak dapat dibuka semula. Kembali ke Laporan dan cuba lagi.'));
      }
      return false;
    } finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }
  return {pending, error: recovery.error, busy, blocked, canRetry: !!pending && can('bar.closing.manage'), run: execute, retry: () => execute()};
}
