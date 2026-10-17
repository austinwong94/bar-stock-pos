import { isDemoMode, supabase } from './supabase';
import { moneyCents } from './purchaseReceiptMath';
export { moneyCents } from './purchaseReceiptMath';

export type PurchaseEvidence = {
  purpose?: string;
  purchase_date: string; total_cost: number; receipt_path: string; items_path: string;
  receipt_hash: string; items_hash: string;
};
export type PurchasePhoto = { path: string; hash: string };
export type ReceiptScan = {
  supplier: string | null; date: string | null; receipt_no: string | null; currency: string | null;
  subtotal: number | null; tax: number | null; discount: number | null; total: number | null;
  items: { description: string; quantity: number | null; unit: string | null; unit_price: number | null; amount: number | null }[];
  warnings: string[];
};
export function receiptDifference(manual: string, scan: ReceiptScan): number | null {
  const cents = moneyCents(manual);
  return cents === null || scan.total === null ? null : (cents - Math.round(scan.total * 100)) / 100;
}

async function photoStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('lp-purchase-photos', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('photos');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('photos', mode);
      const request = action(tx.objectStore('photos'));
      tx.oncomplete = () => { db.close(); resolve(request.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Photo not saved.')); };
    };
  });
}
export async function savePurchasePhoto(file: File, actor: string, folder: string, kind: 'receipt' | 'items'): Promise<PurchasePhoto> {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size <= 0 || file.size > 10 * 1024 * 1024)
    throw new Error('Choose a JPG, PNG or WebP photo up to 10 MB.');
  const bytes = await file.arrayBuffer();
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
  const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${actor}/${folder}/${kind}-${crypto.randomUUID()}.${extension}`;
  if (isDemoMode) await photoStore('readwrite', store => store.put(file, path));
  else {
    const result = await supabase.storage.from('purchase-evidence').upload(path, file, { contentType: file.type, upsert: false });
    if (result.error) throw result.error;
  }
  return { path, hash };
}
export async function purchasePhotoUrl(path: string): Promise<string> {
  if (isDemoMode) {
    const file = await photoStore<Blob | undefined>('readonly', store => store.get(path));
    if (!file) throw new Error('This preview photo is stored only on the device that uploaded it.');
    return URL.createObjectURL(file);
  }
  const result = await supabase.storage.from('purchase-evidence').createSignedUrl(path, 300);
  if (result.error) throw result.error;
  return result.data.signedUrl;
}
