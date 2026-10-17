import type { DailyReport, Sale, SaleItem } from './types';

export type ClosingSnapshot = {
  business_date: string; sales: Array<Sale & { sale_items?: SaleItem[] }>;
  report: DailyReport | null; cash_session: { opening_float: number } | null; version: string;
};
export type ClosingAttempt = {
  version: 1; attempted: boolean; createdAt: string;
  payload: { p_business_date: string; p_actual_cash_counted: number; p_notes: string | null; p_expected_version: string; p_request_id: string };
};
type Client = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{data: any; error: any}> };

export async function readClosingSnapshot(client: Client, date: string): Promise<ClosingSnapshot> {
  const result = await client.rpc('read_bar_closing', { p_business_date: date });
  if (result.error) throw result.error;
  if (result.data?.business_date !== date || !Array.isArray(result.data.sales) || typeof result.data.version !== 'string') {
    throw new Error('Closing data is incomplete. Reload before closing.');
  }
  return result.data;
}
export function readClosingAttempt(storage: Pick<Storage, 'getItem'>, key: string): ClosingAttempt | null {
  const raw = storage.getItem(key);
  if (!raw) return null;
  const saved = JSON.parse(raw) as ClosingAttempt;
  if (saved?.version !== 1 || !saved.payload?.p_request_id || !saved.payload?.p_expected_version ||
    !/^\d{4}-\d{2}-\d{2}$/.test(saved.payload.p_business_date) || !Number.isFinite(saved.payload.p_actual_cash_counted)) {
    throw new Error('The pending closing could not be read. Ask a manager to check this device before closing again.');
  }
  return saved;
}
export function storeClosingAttempt(storage: Pick<Storage, 'getItem' | 'setItem'>, key: string, attempt: ClosingAttempt) {
  const previous = readClosingAttempt(storage,key);
  if (previous && JSON.stringify(previous.payload) !== JSON.stringify(attempt.payload)) throw new Error('Check the original pending closing first.');
  const encoded=JSON.stringify(attempt);
  storage.setItem(key,encoded);
  if(storage.getItem(key)!==encoded)throw new Error('This browser cannot retain the closing safely.');
}
export async function submitClosing(client: Client, attempt: ClosingAttempt): Promise<DailyReport> {
  const result=await client.rpc('close_daily_report_checked',attempt.payload);
  if(result.error)throw result.error;
  if(!result.data?.id || result.data.business_date!==attempt.payload.p_business_date || result.data.status!=='closed') {
    throw new Error('Closing confirmation is incomplete. Check the same closing again.');
  }
  return result.data;
}
