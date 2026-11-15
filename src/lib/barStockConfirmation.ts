import type { StockInDraftRecord } from './types';
import { z } from 'zod';

const whole = z.number().int().min(1).max(2147483647);
const entry = z.object({product_id: z.string().uuid(), product_name: z.string().min(1), quantity: whole,
  unit: z.enum(['can', 'carton']), carton_size: whole, cans: whole, cost_per_unit: z.number().finite().min(0).nullable()}).passthrough();
const draftSchema = z.object({id: z.string().uuid(), draft_number: z.string().min(1), status: z.literal('draft'),
  entered_by: z.string().nullable(), supplier: z.string().nullable(), reference: z.string().nullable(), notes: z.string().nullable(),
  entries: z.array(entry).min(1), total_units: whole, created_by: z.string().uuid().nullable(), confirmed_by: z.string().uuid().nullable(),
  created_at: z.string().refine(value => Number.isFinite(Date.parse(value))), confirmed_at: z.null(),
}).passthrough().refine(draft => draft.entries.every(row => row.cans === row.quantity * (row.unit === 'carton' ? row.carton_size : 1)) && draft.entries.reduce((sum, row) => sum + row.cans, 0) === draft.total_units);
const recoverySchema = z.object({version: z.literal(1), actor: z.string().uuid(), attempted: z.boolean(), draft: draftSchema}).strict();
export type StockConfirmationAttempt = {version: 1; actor: string; attempted: boolean; draft: StockInDraftRecord};
export const stockConfirmationKey = (project: string, actor: string) => `stock-confirmation:${project}:${actor}`;

export function readStockConfirmation(raw: string | null, actor: string): StockConfirmationAttempt | null {
  if (raw === null) return null;
  try { const value = recoverySchema.parse(JSON.parse(raw)); if (value.actor !== actor) throw Error(); return value as StockConfirmationAttempt; }
  catch { throw Error('Pending stock confirmation could not be read. Keep this device and ask the owner to check it.'); }
}

export function writeStockConfirmation(store: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, key: string, next: StockConfirmationAttempt | null, expected: string | null) {
  if (store.getItem(key) !== expected) throw Error('Stock confirmation changed in another tab. Reopen Stock In before continuing.');
  const raw = next ? JSON.stringify(recoverySchema.parse(next)) : null;
  if (raw === null) store.removeItem(key); else store.setItem(key, raw);
  if (store.getItem(key) !== raw) throw Error('Pending stock confirmation could not be retained. Check browser storage.');
  return raw;
}

export async function withStockConfirmationLock<T>(locks: Pick<LockManager, 'request'> | undefined, key: string, save: () => Promise<T>) {
  if (!locks) throw Error('An updated browser is required to confirm stock safely.');
  return locks.request(key, {ifAvailable: true}, lock => {
    if (!lock) throw Error('Another tab is confirming stock. Wait for it to finish, then check this draft.');
    return save();
  });
}

export function stockConfirmationMatches(value: unknown, draft: StockInDraftRecord): boolean {
  const saved = (value as {draft?: Partial<StockInDraftRecord>} | null)?.draft;
  if (!saved || saved.id !== draft.id || saved.status !== 'confirmed' || saved.total_units !== draft.total_units || !Array.isArray(saved.entries)) return false;
  const fields = ['product_id', 'product_name', 'quantity', 'unit', 'carton_size', 'cans', 'cost_per_unit'] as const;
  return saved.entries.length === draft.entries.length && draft.entries.every((entry, index) => fields.every(field => saved.entries![index]?.[field] === entry[field]));
}

export async function stockConfirmationDeadline<T>(task: PromiseLike<T>, milliseconds = 20000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Error('Stock confirmation could not be verified.')), milliseconds);
  });
  try { return await Promise.race([task, timeout]); }
  finally { clearTimeout(timer!); }
}
