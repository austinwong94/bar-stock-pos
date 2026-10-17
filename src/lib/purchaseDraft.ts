import { z } from 'zod';
import type { PurchaseRequest } from './platformTypes';
import { hasPurchaseEntry, validPurchaseDecimal } from './purchaseEntry';

const id = z.string().min(1).max(200);
const photo = z.object({ path: z.string().min(1).max(1000), hash: z.string().regex(/^[a-f0-9]{64}$/) }).nullable();
const item = z.object({
  id, item_name: z.string().max(500), unit: z.string().max(60), note: z.string().max(2000).nullable(),
  quantity: z.number().finite().nonnegative(), purchased_quantity: z.number().finite().nonnegative().nullable(),
  purchase_status: z.enum(['pending', 'bought', 'unavailable']), sort_order: z.number().finite(), updated_at: z.string().max(100).nullable(),
});
const request = z.object({ id, request_no: z.string().max(200), needed_for_date: z.string().max(10), purpose: z.string().max(500).nullable(),
  status: z.enum(['draft', 'submitted', 'buying', 'completed', 'cancelled']), purchase_request_items: z.array(item).max(1000) });
const schema = z.object({
  version: z.literal(1), actorId: id, request, operationId: z.string().uuid(), attempted: z.boolean(), updatedAt: z.string().datetime(),
  entries: z.record(z.object({ quantity: z.string().max(60), cost: z.string().max(60) })),
  supplier: z.string().max(160), purpose: z.enum(['', 'guest_meals', 'staff_meals', 'bar']), reference: z.string().max(120),
  purchaseDate: z.string().max(10), totalCost: z.string().max(60), receiptPhoto: photo, itemsPhoto: photo,
  photoFolder: z.string().uuid(), withCosts: z.boolean(),
  recheck: z.record(z.object({ name: z.string().max(500), unit: z.string().max(60) })),
});
export type PurchaseDraft = z.infer<typeof schema>;
export type PurchaseDraftRequest = PurchaseDraft['request'];
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const purchaseDraftEvent = 'purchase-draft-changed';

export class PurchaseDraftError extends Error {
  constructor(public code: 'unreadable' | 'conflict' | 'storage') { super(code); }
}
export function purchaseDraftPrefix(mode: 'preview' | 'cloud', project: string, actor: string) {
  return `purchase-entry-draft:v1:${mode}:${encodeURIComponent(project)}:${encodeURIComponent(actor)}:`;
}
export function purchaseRequestSnapshot(source: PurchaseRequest): PurchaseDraftRequest {
  return request.parse({ id: source.id, request_no: source.request_no, needed_for_date: source.needed_for_date, purpose: source.purpose ?? null, status: source.status,
    purchase_request_items: (source.purchase_request_items ?? []).map(i => ({ id: i.id, item_name: i.item_name, unit: i.unit, note: i.note ?? null,
      quantity: Number(i.quantity), purchased_quantity: i.purchased_quantity == null ? null : Number(i.purchased_quantity),
      purchase_status: i.purchase_status, sort_order: i.sort_order ?? 0, updated_at: i.updated_at ?? null })) });
}
export function createPurchaseDraft(source: PurchaseRequest, actor: string, date: string): PurchaseDraft {
  const purposes: Record<string, PurchaseDraft['purpose']> = { 'guest meals': 'guest_meals', 'staff meals': 'staff_meals', bar: 'bar', guest_meals: 'guest_meals', staff_meals: 'staff_meals' };
  const purpose = purposes[source.purpose?.trim().toLowerCase() ?? ''] ?? '';
  return { version: 1, actorId: actor, request: purchaseRequestSnapshot(source), operationId: crypto.randomUUID(), attempted: false, updatedAt: new Date().toISOString(),
    entries: {}, supplier: '', purpose, reference: '', purchaseDate: date, totalCost: '', receiptPhoto: null, itemsPhoto: null, photoFolder: crypto.randomUUID(), withCosts: false, recheck: {} };
}
export function readPurchaseDraft(raw: string | null, actor: string): PurchaseDraft | null {
  if (!raw) return null;
  try {
    if (raw.length > 2000000) throw Error();
    const d = schema.parse(JSON.parse(raw));
    const ids = new Set(d.request.purchase_request_items.map(i => i.id));
    if (d.actorId !== actor || ids.size !== d.request.purchase_request_items.length || Object.keys(d.entries).some(key => !ids.has(key))
      || Object.keys(d.recheck).some(key => !ids.has(key))
      || [d.receiptPhoto, d.itemsPhoto].some(p => p && !p.path.startsWith(actor + '/'))) throw Error();
    if (d.attempted) {
      const entered = d.request.purchase_request_items.filter(i => hasPurchaseEntry(d.entries[i.id]));
      if (!d.purpose || !d.supplier.trim() || !d.receiptPhoto || !d.itemsPhoto || !/^\d{1,8}(\.\d{1,2})?$/.test(d.totalCost.trim())
        || !/^\d{4}-\d{2}-\d{2}$/.test(d.purchaseDate) || !Number.isFinite(Date.parse(d.purchaseDate)) || new Date(d.purchaseDate).toISOString().slice(0, 10) !== d.purchaseDate
        || d.receiptPhoto.hash === d.itemsPhoto.hash || d.receiptPhoto.path === d.itemsPhoto.path || !entered.length || Object.keys(d.recheck).length
        || entered.some(i => !validPurchaseDecimal(d.entries[i.id].quantity, true) || d.withCosts && d.entries[i.id].cost.trim() && !validPurchaseDecimal(d.entries[i.id].cost, false))) throw Error();
    }
    return d;
  } catch { throw new PurchaseDraftError('unreadable'); }
}
export function writePurchaseDraft(storage: Store, key: string, value: PurchaseDraft | null, expected: string | null, actor: string) {
  try {
    if (storage.getItem(key) !== expected) throw new PurchaseDraftError('conflict');
    const next = value === null ? null : JSON.stringify(value);
    if (next !== null) { readPurchaseDraft(next, actor); storage.setItem(key, next); } else storage.removeItem(key);
    if (storage.getItem(key) !== next) throw new PurchaseDraftError('storage');
    return next;
  } catch (e) { if (e instanceof PurchaseDraftError) throw e; throw new PurchaseDraftError('storage'); }
}
export function purchaseDraftList(storage: Pick<Storage, 'length' | 'key' | 'getItem'>, prefix: string, actor: string) {
  const rows: { key: string; draft: PurchaseDraft | null }[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(prefix)) continue;
    let draft: PurchaseDraft | null = null;
    try { draft = readPurchaseDraft(storage.getItem(key), actor); } catch { /* An unreadable draft stays visible and cannot be overwritten. */ }
    rows.push({ key, draft });
  }
  return rows.sort((a, b) => (b.draft?.updatedAt ?? '').localeCompare(a.draft?.updatedAt ?? ''));
}

export function purchaseDraftPayload(d: PurchaseDraft) {
  return {
    p_request_id: d.request.id, p_operation_id: d.operationId, p_supplier: d.supplier.trim() || null, p_reference: d.reference.trim() || null,
    p_evidence: { purpose: d.purpose, purchase_date: d.purchaseDate, total_cost: Number(d.totalCost), receipt_path: d.receiptPhoto!.path,
      items_path: d.itemsPhoto!.path, receipt_hash: d.receiptPhoto!.hash, items_hash: d.itemsPhoto!.hash },
    p_items: d.request.purchase_request_items.filter(i => hasPurchaseEntry(d.entries[i.id])).sort((a, b) => a.sort_order - b.sort_order).map(i => ({
      id: i.id, expected_updated_at: i.updated_at, quantity: Number(d.entries[i.id].quantity),
      actual_cost: d.withCosts && d.entries[i.id].cost.trim() !== '' ? Number(d.entries[i.id].cost) : null,
    })),
  };
}

export function refreshPurchaseDraft(d: PurchaseDraft, latest: PurchaseRequest): PurchaseDraft {
  if (d.attempted || latest.id !== d.request.id) throw new PurchaseDraftError('conflict');
  const fresh = purchaseRequestSnapshot(latest), recheck = { ...d.recheck };
  for (const old of d.request.purchase_request_items) {
    if (!hasPurchaseEntry(d.entries[old.id])) continue;
    const next = fresh.purchase_request_items.find(i => i.id === old.id);
    if (!next) fresh.purchase_request_items.push({ ...old, purchase_status: 'unavailable' });
    if (!next || next.item_name !== old.item_name || next.unit !== old.unit) recheck[old.id] = { name: old.item_name, unit: old.unit };
  }
  return { ...d, request: fresh, recheck, entries: Object.fromEntries(Object.entries(d.entries).filter(([key]) => fresh.purchase_request_items.some(i => i.id === key))),
    operationId: crypto.randomUUID(), updatedAt: new Date().toISOString() };
}
