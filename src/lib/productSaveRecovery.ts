import { z } from 'zod';

const stamp = z.string().refine(value => Number.isFinite(Date.parse(value)));
const money = z.number().finite().min(0).max(99999999.99).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6);
const payload = z.object({
  name: z.string().min(1).refine(value => value.trim() === value), category_id: z.string().uuid(),
  price_per_unit: money, cost_per_unit: money.nullable(),
  carton_size: z.number().int().min(1).max(2147483647),
  low_stock_threshold: z.number().int().min(0).max(2147483647),
  image_url: z.string().nullable(), active: z.boolean(),
}).strict();
const args = z.object({
  p_product_id: z.string().uuid().nullable(), p_payload: payload,
  p_source_updated_at: stamp.nullable(), p_request_id: z.string().uuid(), p_expected_actor_id: z.string().uuid(),
}).strict().refine(value => !value.p_product_id || value.p_source_updated_at !== null);
const schema = z.object({version: z.literal(1), args, attempted: z.boolean(), createdAt: stamp}).strict();
export type ProductSaveRecovery = z.infer<typeof schema>;
export const productRecoveryKey = (project: string, actor: string) => `product-save:${project}:${actor}`;

export function readProductRecovery(raw: string | null, actor?: string): ProductSaveRecovery | null {
  if (raw === null) return null;
  try { const result = schema.parse(JSON.parse(raw)); if (actor && result.args.p_expected_actor_id !== actor) throw Error(); return result; }
  catch { throw Error('Pending product details could not be read. Keep this device and ask the owner to check it.'); }
}

export function writeProductRecovery(store: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, key: string, next: ProductSaveRecovery | null, expected: string | null) {
  if (store.getItem(key) !== expected) throw Error('Product details changed in another tab. Reopen Bar Admin before continuing.');
  const raw = next ? JSON.stringify(schema.parse(next)) : null;
  if (raw === null) store.removeItem(key); else store.setItem(key, raw);
  if (store.getItem(key) !== raw) throw Error('Pending product details could not be retained on this device. Check browser storage before saving.');
  return raw;
}

export function productSaveConfirmed(value: unknown, operation: ProductSaveRecovery) {
  const result = payload.extend({id: z.string().uuid(), updated_at: stamp}).passthrough().safeParse(value);
  if (!result.success || (operation.args.p_product_id && result.data.id !== operation.args.p_product_id)) return false;
  return Object.entries(operation.args.p_payload).every(([key, expected]) => result.data[key] === expected);
}

// Hold the lock through the reply: another tab must not race an initial rejection.
export async function withProductSaveLock<T>(locks: Pick<LockManager, 'request'> | undefined, key: string, save: () => Promise<T>) {
  if (!locks) throw Object.assign(Error('An updated browser is required to save products safely.'), {code: 'PRODUCT_LOCK_UNAVAILABLE'});
  return locks.request(key, {ifAvailable: true}, lock => {
    if (!lock) throw Object.assign(Error('Another tab is saving a product. Wait for it to finish, then check the saved product.'), {code: 'PRODUCT_LOCKED'});
    return save();
  });
}

export async function productSaveDeadline<T>(task: PromiseLike<T>, milliseconds = 20000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Object.assign(Error('The response could not be verified. Check your connection before continuing.'), {code: 'PRODUCT_SAVE_UNCERTAIN'})), milliseconds); });
  try { return await Promise.race([task, timeout]); }
  finally { clearTimeout(timer!); }
}
