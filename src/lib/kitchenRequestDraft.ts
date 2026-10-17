import { kitchenCatalogue, kitchenGroups } from './kitchenCatalogue';
import type { CatalogueItem, PurchaseRequest } from './platformTypes';

export type RequestItemEntry = { key: string; id?: string; item_name: string; quantity: string; unit: string; note: string; category?: string };
export type KitchenRequestDraft = {
  version: 1;
  requestId: string;
  requestNo: string;
  expected: string | null;
  operationId: string;
  neededFor: string;
  pax: string;
  purpose: string;
  notes: string;
  items: RequestItemEntry[];
  attempted: boolean;
  updatedAt: string;
};
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const requestUnits = ['kg', 'g', 'L', 'ml', 'biji', 'ekor', 'pack', 'bag', 'gelen', 'tin', 'botol', 'carton', 'pcs', 'box', 'tray', 'bottle', 'unit', 'cylinder'];
export const blankRequestItem = (): RequestItemEntry => ({ key: crypto.randomUUID(), item_name: '', quantity: '', unit: 'kg', note: '' });
const definition = (name: string) => kitchenCatalogue.find(d => d.aliases.some(a => a.toLowerCase() === name.trim().toLowerCase()));
export const requestItemGroup = (row: Pick<RequestItemEntry, 'item_name' | 'category'>) => definition(row.item_name)?.group ?? row.category ?? 'Other';
export const requestItemMatches = (row: Pick<RequestItemEntry, 'item_name'>, query: string) => [row.item_name, ...(definition(row.item_name)?.aliases ?? [])].join(' ').toLowerCase().includes(query.trim().toLowerCase());
export function mergeRequestCatalogue(rows: RequestItemEntry[], catalogue: RequestItemEntry[]) {
  const key = (r: RequestItemEntry) => (definition(r.item_name)?.key ?? r.item_name.trim().toLowerCase()) + '|' + r.unit;
  const chosen = new Set(rows.map(key));
  const rank = (r: RequestItemEntry) => { const d = definition(r.item_name); return d ? kitchenGroups.indexOf(d.group) * 100 + kitchenCatalogue.indexOf(d) : 999; };
  return [...rows, ...catalogue.filter(r => !chosen.has(key(r)))].sort((a, b) => rank(a) - rank(b) || a.item_name.localeCompare(b.item_name));
}

export function requestCatalogueRows(items: CatalogueItem[]): RequestItemEntry[] {
  const seen = new Set<string>();
  return [...items].sort((a, b) => {
    const rank = (name: string) => { const d = definition(name); return d ? kitchenGroups.indexOf(d.group) * 100 + kitchenCatalogue.indexOf(d) : 999; };
    return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name);
  }).filter(i => {
    const key = (definition(i.name)?.key ?? i.name.trim().toLowerCase()) + '|' + i.unit;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).map(i => ({ key: crypto.randomUUID(), item_name: i.name, quantity: '', unit: i.unit, note: '', category: i.category ?? undefined }));
}

export function requestRows(request: PurchaseRequest, repeat = false): RequestItemEntry[] {
  return [...(request.purchase_request_items ?? [])].sort((a, b) => a.sort_order - b.sort_order)
    .map(i => ({ key: crypto.randomUUID(), id: repeat ? undefined : i.id, item_name: i.item_name, quantity: repeat ? '' : String(i.quantity), unit: i.unit, note: repeat ? '' : i.note ?? '' }));
}

export function latestRequestList(requests: PurchaseRequest[]) {
  return requests.filter(r => ['submitted', 'buying', 'completed'].includes(r.status) && r.purchase_request_items?.length)
    .sort((a, b) => (b.submitted_at ?? b.created_at).localeCompare(a.submitted_at ?? a.created_at))[0] ?? null;
}

export function readRequestDraft(raw: string | null): KitchenRequestDraft | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw), short = (v: unknown, n = 200) => typeof v === 'string' && v.length <= n;
    if (d?.version !== 1 || !short(d.requestId) || !short(d.requestNo) || !(d.expected === null || short(d.expected))
      || !short(d.operationId) || !d.operationId || !short(d.neededFor, 10) || !short(d.pax, 60)
      || !short(d.purpose, 500) || !short(d.notes, 2000) || typeof d.attempted !== 'boolean'
      || !short(d.updatedAt) || !Number.isFinite(Date.parse(d.updatedAt)) || !Array.isArray(d.items) || d.items.length > 1000
      || !d.items.every((r: RequestItemEntry) => r && short(r.key) && r.key && (r.id === undefined || short(r.id))
        && short(r.item_name, 500) && short(r.quantity, 60) && short(r.unit, 60) && short(r.note, 2000)
        && (r.category === undefined || short(r.category))) || new Set(d.items.map((r: RequestItemEntry) => r.key)).size !== d.items.length) throw Error();
    return d;
  } catch { throw new Error('This request draft could not be read. Ask a manager to check this device.'); }
}

export function writeRequestDraft(storage: Store, key: string, value: KitchenRequestDraft | null, expected: string | null) {
  if (storage.getItem(key) !== expected) throw new Error('This draft changed in another tab. Reload the draft before editing.');
  const next = value ? JSON.stringify(value) : null;
  if (next) { readRequestDraft(next); storage.setItem(key, next); } else storage.removeItem(key);
  if (storage.getItem(key) !== next) throw new Error('Draft not saved on this device. Check browser storage and retry.');
  return next;
}

export function requestDraftList(storage: Pick<Storage, 'key' | 'length' | 'getItem'>, prefix: string) {
  const result: { key: string; draft: KitchenRequestDraft | null }[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(prefix)) continue;
    let draft: KitchenRequestDraft | null = null;
    try { draft = readRequestDraft(storage.getItem(key)); } catch { /* Keep an unreadable draft visible instead of overwriting it. */ }
    result.push({ key, draft });
  }
  return result.sort((a, b) => (b.draft?.updatedAt ?? '').localeCompare(a.draft?.updatedAt ?? ''));
}

// The persisted form is frozen after a save attempt so a lost reply replays identical arguments.
export function requestDraftPayload(d: KitchenRequestDraft) {
  return {
    p_request: { id: d.requestId, _request_id: d.operationId, _expected_updated_at: d.expected, needed_for_date: d.neededFor, pax_count: Number(d.pax) || 0, purpose: d.purpose, notes: d.notes, origin: 'kitchen' },
    p_items: d.items.filter(i => i.item_name.trim() && i.quantity.trim() && Number(i.quantity) !== 0)
      .map(i => ({ id: i.id ?? '', item_name: i.item_name.trim(), quantity: Number(i.quantity), unit: i.unit, note: i.note })),
  };
}
