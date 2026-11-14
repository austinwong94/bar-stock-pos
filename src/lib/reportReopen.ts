import { z } from 'zod';
import { checkedClosingSnapshot } from './barClosing';
import { barPeriodRange } from './barReportPeriod';
import type { DailyReport } from './types';

const stamp = z.string().refine(value => Number.isFinite(Date.parse(value)));
const day = z.string().refine(value => !!barPeriodRange('day', value).range);
const cents = z.number().finite().refine(value => Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6);
const money = cents.refine(value => value >= 0);
const summary = z.object({closedAt: stamp, totalCash: money, totalQr: money, totalFoc: money, totalSales: money,
  actualCash: money.nullable(), expectedCash: money.nullable(), variance: cents.nullable(), notes: z.string().nullable()}).strict();
const schema = z.object({version: z.literal(1), attempted: z.boolean(), createdAt: stamp, summary,
  args: z.object({p_business_date: day, p_report_id: z.string().uuid(), p_expected_version: z.string().trim().min(1),
    p_reason: z.string().trim().min(1), p_request_id: z.string().uuid(), p_expected_actor_id: z.string().uuid()}).strict(),
}).strict();
export type ReportReopen = z.infer<typeof schema>;
export const reportReopenKey = (project: string, actor: string) => `bar-report-reopen:${project}:${actor}`;
export function createReportReopen(report: DailyReport, version: string, actor: string): ReportReopen {
  if (report.status !== 'closed') throw Error('Reload and review the closed report first.');
  checkedClosingSnapshot({business_date: report.business_date, report, version, sales: [], cash_session: null}, report.business_date);
  return schema.parse({version: 1, attempted: false, createdAt: new Date().toISOString(),
    summary: {closedAt: report.closed_at, totalCash: report.total_cash, totalQr: report.total_qr, totalFoc: report.total_complimentary_value,
      totalSales: report.total_sales, actualCash: report.actual_cash_counted, expectedCash: report.expected_cash, variance: report.cash_variance, notes: report.notes},
    args: {p_business_date: report.business_date, p_report_id: report.id, p_expected_version: version, p_reason: 'Admin correction from Reports', p_request_id: crypto.randomUUID(), p_expected_actor_id: actor}});
}
export function readReportReopen(raw: string | null, actor?: string): ReportReopen | null {
  if (raw === null) return null;
  try { const next = schema.parse(JSON.parse(raw)); if (actor && actor !== next.args.p_expected_actor_id) throw Error(); return next; }
  catch { throw Error('Pending report reopening could not be read. Keep this device and ask the owner to check it.'); }
}
export function writeReportReopen(store: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, key: string, next: ReportReopen | null, expected: string | null) {
  if (store.getItem(key) !== expected) throw Error('Report reopening changed in another tab. Reopen this page.');
  const raw = next ? JSON.stringify(schema.parse(next)) : null;
  if (raw === null) store.removeItem(key); else store.setItem(key, raw);
  if (store.getItem(key) !== raw) throw Error('Report reopening could not be retained on this device.');
  return raw;
}
export function reportReopenConfirmed(input: unknown, pending: ReportReopen) {
  try {
    const value = z.object({request_id: z.string().uuid(), actor_id: z.string().uuid(), report: z.unknown()}).parse(input);
    const args = pending.args, original = pending.summary;
    const report = checkedClosingSnapshot({business_date: args.p_business_date, version: 'proof', sales: [], cash_session: null, report: value.report}, args.p_business_date).report!;
    return value.request_id === args.p_request_id && value.actor_id === args.p_expected_actor_id && report.id === args.p_report_id
      && report.status === 'reopened' && report.reopened_by === args.p_expected_actor_id && stamp.safeParse(report.reopened_at).success
      && report.closed_at === original.closedAt && report.notes === original.notes
      && report.total_cash === original.totalCash && report.total_qr === original.totalQr && report.total_complimentary_value === original.totalFoc && report.total_sales === original.totalSales
      && report.actual_cash_counted === original.actualCash && report.expected_cash === original.expectedCash && report.cash_variance === original.variance;
  } catch { return false; }
}
