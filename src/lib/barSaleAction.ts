import { z } from 'zod';
import type { Sale } from './types';
import { barPeriodRange } from './barReportPeriod';

const stamp = z.string().refine(value => Number.isFinite(Date.parse(value)));
const version = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const day = z.string().refine(value => !!barPeriodRange('day', value).range);
const action = z.enum(['void', 'verified', 'mismatch']);
const money = z.number().finite().nonnegative().refine(value => Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6);
const schema = z.object({version: z.literal(1), attempted: z.boolean(), createdAt: stamp,
  summary: z.object({saleNumber: z.string().min(1), businessDate: day, amount: money, paidAmount: money}).strict(),
  args: z.object({p_sale_id: z.string().uuid(), p_action: action, p_reason: z.string().nullable(), p_expected_version: version, p_request_id: z.string().uuid(), p_expected_actor_id: z.string().uuid()}).strict(),
}).strict().refine(value => value.args.p_action === 'void' ? !!value.args.p_reason?.trim() : value.args.p_reason === null);
export type SaleAction = z.infer<typeof action>;
export type SaleActionRecovery = z.infer<typeof schema>;
export const saleActionKey = (project: string, actor: string) => `bar-sale-action:${project}:${actor}`;

export function createSaleAction(sale: Sale, kind: SaleAction, reason: string | null, actor: string): SaleActionRecovery {
  if (sale.status !== 'completed' || kind !== 'void' && (sale.payment_method !== 'qr' || sale.qr_status === kind)) throw Error('Reload and review this sale before continuing.');
  return schema.parse({version: 1, attempted: false, createdAt: new Date().toISOString(),
    summary: {saleNumber: sale.sale_number, businessDate: sale.business_date, amount: sale.total_amount, paidAmount: sale.paid_amount},
    args: {p_sale_id: sale.id, p_action: kind, p_reason: kind === 'void' ? reason?.trim() ?? null : null, p_expected_version: sale.review_version, p_request_id: crypto.randomUUID(), p_expected_actor_id: actor},
  });
}

export function readSaleAction(raw: string | null, actor?: string): SaleActionRecovery | null {
  if (raw === null) return null;
  try { const next = schema.parse(JSON.parse(raw)); if (actor && actor !== next.args.p_expected_actor_id) throw Error(); return next; }
  catch { throw Error('Pending sale action could not be read. Keep this device and ask the owner to check it.'); }
}

export function writeSaleAction(store: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, key: string, next: SaleActionRecovery | null, expected: string | null) {
  if (store.getItem(key) !== expected) throw Error('A sale action changed in another tab. Reopen this page.');
  const raw = next ? JSON.stringify(schema.parse(next)) : null;
  if (raw !== null) store.setItem(key, raw); else store.removeItem(key);
  if (store.getItem(key) !== raw) throw Error('The sale action could not be retained on this device. Check browser storage before continuing.');
  return raw;
}

export function saleActionConfirmed(input: unknown, pending: SaleActionRecovery) {
  const parsed = z.object({request_id: z.string().uuid(), actor_id: z.string().uuid(), action, sale: z.object({
    id: z.string().uuid(), sale_number: z.string(), business_date: day, total_amount: money, paid_amount: money, status: z.enum(['completed','voided']),
    qr_status: z.string(), void_reason: z.string().nullable(), voided_by: z.string().nullable(), review_version: version,
  }).passthrough()}).safeParse(input);
  if (!parsed.success) return false;
  const {sale, ...result} = parsed.data, args = pending.args;
  return result.request_id === args.p_request_id && result.actor_id === args.p_expected_actor_id && result.action === args.p_action
    && sale.id === args.p_sale_id && sale.sale_number === pending.summary.saleNumber && sale.business_date === pending.summary.businessDate
    && sale.total_amount === pending.summary.amount && sale.paid_amount === pending.summary.paidAmount && sale.review_version === args.p_expected_version + 1
    && (args.p_action === 'void' ? sale.status === 'voided' && sale.void_reason === args.p_reason && sale.voided_by === args.p_expected_actor_id : sale.status === 'completed' && sale.qr_status === args.p_action);
}
