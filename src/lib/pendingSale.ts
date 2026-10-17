export type PendingSale = {
  version: 1;
  createdAt: string;
  payload: Record<string, unknown> & { p_idempotency_key: string };
  summary: { items: string[]; total: number; staff: string; method: string; table: string };
};

export function readPendingSale(storage: Pick<Storage, 'getItem' | 'key' | 'length'>, key: string): PendingSale | null {
  const rows: PendingSale[] = [];
  for (let index=0;index<storage.length;index++) {
    const entry=storage.key(index);
    if (!entry?.startsWith(key+'/')) continue;
    const raw=storage.getItem(entry);
    if (!raw) continue;
    const saved=JSON.parse(raw);
    if (saved?.version !== 1 || !saved.payload?.p_idempotency_key || !Array.isArray(saved.payload.p_items) || !Array.isArray(saved.summary?.items)) {
      throw new Error('The pending payment record could not be read. Ask a manager to check Sales before taking another payment on this device.');
    }
    rows.push(saved);
  }
  return rows.sort((a,b)=>a.createdAt.localeCompare(b.createdAt))[0]??null;
}

export function persistPendingSale(storage: Pick<Storage, 'setItem' | 'getItem'>, key: string, sale: PendingSale) {
  const encoded = JSON.stringify(sale);
  const entry = key+'/'+sale.payload.p_idempotency_key;
  const prior=storage.getItem(entry);
  if (prior && prior!==encoded) throw new Error('This payment already has different saved details. Check the pending payment first.');
  storage.setItem(entry, encoded);
  if (storage.getItem(entry) !== encoded) throw new Error('This browser cannot safely retain the payment. Enable browser storage before confirming.');
}

export function clearPendingSale(storage: Pick<Storage,'removeItem'>, key: string, sale: PendingSale) {
  storage.removeItem(key+'/'+sale.payload.p_idempotency_key);
}

// Keep the original request until the server confirms success or a definite rejection.
export async function submitPendingSale(client: { from?: (table: string) => any; rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{data: any; error: any}> }, sale: PendingSale) {
  const result = await client.rpc('complete_sale_with_qr_type', sale.payload);
  // Losing permission does not prove that an earlier request failed to commit.
  if (result.error?.code === '42501') throw new Error(result.error.message || 'Ask a manager to check the original payment.');
  if (result.error) throw result.error;
  if (!result.data?.sale_number) throw new Error('Payment confirmation has not arrived. Check the same payment again.');
  return result.data;
}
