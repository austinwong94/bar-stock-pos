import { useEffect, useRef, useState } from 'react';
import { useToast } from '../components/Toast';
import { useAccess } from './access';
import { useLanguage } from './language';
import { isSupabaseConfigured, supabase } from './supabase';
import { updateLocalQrPayment, voidLocalSale } from './localStore';
import { createSaleAction, readSaleAction, saleActionConfirmed, saleActionKey, writeSaleAction, type SaleAction, type SaleActionRecovery } from './barSaleAction';
import { productSaveDeadline, withProductSaveLock } from './productSaveRecovery';
import { definitiveInitialSaveFailure } from './saveAttempt';
import { readErrorMessage } from './opsData';
import type { Sale } from './types';

export function useSaleAction(actorId: string | null, onResolved: () => Promise<unknown>) {
  const { text } = useLanguage(), toast = useToast(), { can } = useAccess();
  const key = isSupabaseConfigured && actorId ? saleActionKey(import.meta.env?.VITE_SUPABASE_URL ?? 'cloud', actorId) : null;
  const alive = useRef(true), busyRef = useRef(false), resolved = useRef(onResolved); resolved.current = onResolved;
  function read() {
    let raw: string | null = null;
    try { raw = key ? localStorage.getItem(key) : null; return {raw, operation: readSaleAction(raw, actorId ?? undefined), error: ''}; }
    catch (error) { return {raw, operation: null, error: readErrorMessage(error)}; }
  }
  const [recovery, setRecovery] = useState(read), [busy, setBusy] = useState(false);
  const pending = recovery.operation;
  const blocked = busy || !!pending || !!recovery.error;
  const allowed = (kind: SaleAction) => can(kind === 'void' ? 'bar.pos.void' : 'bar.closing.manage');
  function retain(next: SaleActionRecovery | null, expected: string | null) {
    if (!key) throw Error(text('Sign in again before changing a sale.', 'Log masuk semula sebelum mengubah jualan.'));
    const raw = writeSaleAction(localStorage, key, next, expected); setRecovery({raw, operation: next, error: ''}); return raw;
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

  async function submit(operation: SaleActionRecovery, original: string | null) {
    const attempted = retain({...operation, attempted: true}, original);
    let confirmed = false;
    try {
      const result = await productSaveDeadline<{data: unknown; error: unknown}>(supabase.rpc('review_bar_sale_action', operation.args));
      if (!alive.current) return false;
      if (result.error) throw result.error;
      if (!saleActionConfirmed(result.data, operation)) throw Error(text('The reply could not be verified. Check the original sale action.', 'Jawapan tidak dapat disahkan. Semak tindakan jualan asal.'));
      confirmed = true;
      retain(null, attempted);
      await resolved.current();
      if (alive.current) toast.success(operation.args.p_action === 'void' ? text('Sale voided and stock returned.', 'Jualan dibatalkan dan stok dipulangkan.') : text('QR status saved.', 'Status QR disimpan.'));
      return true;
    } catch (error) {
      if (!alive.current) return false;
      if (!confirmed && definitiveInitialSaveFailure(operation.attempted, error)) retain(null, attempted);
      throw error;
    }
  }

  async function execute(sale?: Sale, kind?: SaleAction, reason: string | null = null) {
    if (busyRef.current || recovery.error || (sale && pending)) return false;
    const action = pending?.args.p_action ?? kind;
    if (!action || !allowed(action)) return false;
    busyRef.current = true; setBusy(true);
    try {
      if (!isSupabaseConfigured && sale && kind) {
        if (kind === 'void') { if (!voidLocalSale(sale.id, reason?.trim() ?? '')) throw Error('Sale could not be voided.'); }
        else updateLocalQrPayment(sale.id, kind);
        await resolved.current(); return true;
      }
      if (!key || !actorId) throw Error(text('Sign in again before changing a sale.', 'Log masuk semula sebelum mengubah jualan.'));
      return await withProductSaveLock(navigator.locks, key, async () => {
        if (!alive.current) return false;
        let operation = pending;
        if (!operation) {
          try { operation = createSaleAction(sale!, kind!, reason, actorId); }
          catch { throw Error(text('Reload and review this sale before changing it.', 'Muat semula dan semak jualan ini sebelum mengubahnya.')); }
        }
        return submit(operation, pending ? recovery.raw : retain(operation, null));
      });
    } catch (error) {
      if (alive.current) {
        const next = read(); setRecovery(next);
        const code = (error as {code?: string})?.code;
        toast.error(code === 'PRODUCT_LOCKED' ? text('Another tab is saving a sale action. Wait, then check it.', 'Tab lain sedang menyimpan tindakan jualan. Tunggu, kemudian semaknya.')
          : code === 'PRODUCT_LOCK_UNAVAILABLE' ? text('An updated browser is required to change sales safely.', 'Pelayar terkini diperlukan untuk mengubah jualan dengan selamat.')
          : next.raw ? text('Result not confirmed. Check the original action before trying another.', 'Keputusan belum disahkan. Semak tindakan asal sebelum mencuba yang lain.')
          : code === '40001' ? text('This sale changed on another device. Reload and review it again.', 'Jualan ini berubah pada peranti lain. Muat semula dan semak semula.')
          : code === 'PGRST202' ? text('Sale-action setup is unavailable. Ask the owner to check the deployment.', 'Persediaan tindakan jualan tidak tersedia. Minta pemilik menyemak pelaksanaan.')
          : readErrorMessage(error, text('Sale action could not be saved.', 'Tindakan jualan tidak dapat disimpan.')));
      }
      return false;
    } finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }
  return {pending, error: recovery.error, busy, blocked, canRetry: !!pending && allowed(pending.args.p_action), run: execute, retry: () => execute()};
}
