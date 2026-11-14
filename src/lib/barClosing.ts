import type { DailyReport, Sale, SaleItem } from './types';
import { barPeriodRange } from './barReportPeriod';
import { checkedHistorySales } from './barSalesHistory';
import { reportMoneyCents } from './moneyAllocation';

export type ClosingSnapshot = {
  business_date: string; sales: Array<Sale & { sale_items?: SaleItem[] }>;
  report: DailyReport | null; cash_session: { business_date: string; opening_float: number } | null; version: string;
};
export type ClosingAttempt = {
  version: 1; attempted: boolean; createdAt: string;
  payload: { p_business_date: string; p_actual_cash_counted: number; p_notes: string | null; p_expected_version: string; p_request_id: string };
};
type Client = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{data: any; error: any}> };

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function count(value: unknown) {
  if (!['number', 'string'].includes(typeof value) || !/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new Error('Closing counts are incomplete.');
}
function signedCents(value: unknown) {
  const negative = typeof value === 'string' && value.startsWith('-') || typeof value === 'number' && value < 0;
  return reportMoneyCents(negative ? String(value).slice(1) : value) * (negative ? -1 : 1);
}
export function checkedClosingSnapshot(value: unknown, date: string): ClosingSnapshot {
  if (!barPeriodRange('day', date).range || !record(value) || value.business_date !== date || !Array.isArray(value.sales) || typeof value.version !== 'string' || !value.version.trim() || !('report' in value) || !('cash_session' in value)) throw new Error('Closing data is incomplete. Reload before closing.');
  const sales = checkedHistorySales(value.sales, date);
  let session: ClosingSnapshot['cash_session'] = null;
  if (value.cash_session !== null) {
    if (!record(value.cash_session) || value.cash_session.business_date !== date) throw new Error('Cash session does not match this closing date.');
    session = { ...value.cash_session, business_date: date, opening_float: reportMoneyCents(value.cash_session.opening_float) / 100 };
  }
  let report: DailyReport | null = null;
  if (value.report !== null) {
    const row = value.report;
    if (!record(row) || typeof row.id !== 'string' || !row.id.trim() || row.business_date !== date || !['closed', 'reopened'].includes(String(row.status)) || !record(row.report_json)) throw new Error('Saved closing does not match this date.');
    const cash = reportMoneyCents(row.total_cash), qr = reportMoneyCents(row.total_qr), revenue = reportMoneyCents(row.total_sales), foc = reportMoneyCents(row.total_complimentary_value);
    if (cash + qr !== revenue) throw new Error('Saved closing amounts do not reconcile.');
    for (const key of ['actual_cash_counted', 'expected_cash', 'cash_variance']) if (!(key in row) || row[key] !== null && (key === 'cash_variance' ? !Number.isSafeInteger(signedCents(row[key])) : !Number.isSafeInteger(reportMoneyCents(row[key])))) throw new Error('Saved closing cash amounts are incomplete.');
    if (row.actual_cash_counted !== null && row.expected_cash !== null && row.cash_variance !== null && reportMoneyCents(row.actual_cash_counted) - reportMoneyCents(row.expected_cash) !== signedCents(row.cash_variance)) throw new Error('Saved cash variance does not reconcile.');
    const json = row.report_json;
    if ('business_date' in json && json.business_date !== date) throw new Error('Saved closing snapshot has a different date.');
    if ('number_of_transactions' in json) count(json.number_of_transactions);
    for (const key of ['focCost', 'qrPending', 'qrVerified', 'qrMismatch', 'qr_pending_total', 'qr_verified_total', 'qr_mismatch_total']) if (key in json) reportMoneyCents(json[key]);
    for (const key of ['itemSales', 'sales_by_product']) if (json[key] != null) {
      if (!Array.isArray(json[key])) throw new Error('Saved closing items are incomplete.');
      for (const item of json[key]) {
        if (!record(item) || typeof (item.product ?? item.name) !== 'string' || !String(item.product ?? item.name).trim()) throw new Error('Saved closing item is incomplete.');
        count(item.quantity); reportMoneyCents(item.cash); reportMoneyCents(item.qr); reportMoneyCents(item.focCost ?? item.foc_cost);
        if ('discount' in item) reportMoneyCents(item.discount);
      }
    }
    report = { ...row, total_cash: cash / 100, total_qr: qr / 100, total_sales: revenue / 100, total_complimentary_value: foc / 100,
      actual_cash_counted: row.actual_cash_counted === null ? null : reportMoneyCents(row.actual_cash_counted) / 100,
      expected_cash: row.expected_cash === null ? null : reportMoneyCents(row.expected_cash) / 100,
      cash_variance: row.cash_variance === null ? null : signedCents(row.cash_variance) / 100,
    } as DailyReport;
  }
  return { business_date: date, version: value.version, sales, report, cash_session: session };
}
export async function readClosingSnapshot(client: Client, date: string): Promise<ClosingSnapshot> {
  if (!barPeriodRange('day', date).range) throw new Error('Enter a valid business date.');
  const result = await client.rpc('read_bar_closing', { p_business_date: date });
  if (result.error) throw result.error;
  return checkedClosingSnapshot(result.data, date);
}
export function readClosingAttempt(storage: Pick<Storage, 'getItem'>, key: string): ClosingAttempt | null {
  const raw = storage.getItem(key);
  if (!raw) return null;
  const saved = JSON.parse(raw) as ClosingAttempt;
  if (saved?.version !== 1 || !saved.payload?.p_request_id || !saved.payload?.p_expected_version ||
    !barPeriodRange('day', saved.payload.p_business_date).range || !Number.isFinite(saved.payload.p_actual_cash_counted)) {
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
