export type ConnectionArea = 'account' | 'database' | 'products' | 'photos';
export type ConnectionState = 'unchecked' | 'passed' | 'failed' | 'empty' | 'found' | 'configured';
export type ConnectionCheck = {checkedAt: string; states: Record<ConnectionArea, ConnectionState>; activeProducts: number | null};
type Reply = {data?: unknown; error?: unknown; count?: unknown};
export type ConnectionReaders = {
  user: () => PromiseLike<Reply>;
  profile: (id: string) => PromiseLike<Reply>;
  schema: () => PromiseLike<Reply>;
  products: () => PromiseLike<Reply>;
};
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const features = ['measured_piece_receiving', 'sale_action_recovery', 'report_reopen_recovery', 'retired_writes_private'];

async function bounded(read: () => PromiseLike<Reply>, timeout: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([Promise.resolve().then(read), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('Connection check timed out.')), timeout); })]); }
  finally { clearTimeout(timer); }
}

export async function checkCloudConnection(read: ConnectionReaders, actor: string, current = () => true, timeout = 10000): Promise<ConnectionCheck | null> {
  const result: ConnectionCheck = {checkedAt: new Date().toISOString(), states: {account: 'unchecked', database: 'unchecked', products: 'unchecked', photos: 'unchecked'}, activeProducts: null};
  let area: ConnectionArea = 'account';
  try {
    const auth = await bounded(read.user, timeout);
    if (!current()) return null;
    if (auth.error || !object(auth.data) || !object(auth.data.user) || auth.data.user.id !== actor || auth.data.user.is_anonymous !== false) throw Error('Named account not verified.');
    const profile = await bounded(() => read.profile(actor), timeout);
    if (!current()) return null;
    if (profile.error || !object(profile.data) || profile.data.id !== actor || profile.data.status !== 'active' || profile.data.is_anonymous !== false || profile.data.app_access_granted !== true) throw Error('Active staff account not verified.');
    result.states.account = 'passed';
    area = 'database';
    const schema = await bounded(read.schema, timeout);
    if (!current()) return null;
    if (schema.error || !object(schema.data) || schema.data.schema_version !== '202610140073' || features.some(key => schema.data && (schema.data as Record<string, unknown>)[key] !== true)) throw Error('Database contract not verified.');
    result.states.database = 'passed';
    result.states.photos = schema.data.private_payment_receipts === true && schema.data.private_purchase_evidence === true ? 'configured' : 'failed';
    area = 'products';
    const products = await bounded(read.products, timeout);
    if (!current()) return null;
    if (products.error || !Number.isSafeInteger(products.count) || Number(products.count) < 0) throw Error('Product count not verified.');
    result.activeProducts = Number(products.count);
    result.states.products = result.activeProducts === 0 ? 'empty' : 'found';
  } catch {
    if (!current()) return null;
    result.states[area] = 'failed';
  }
  result.checkedAt = new Date().toISOString();
  return result;
}
