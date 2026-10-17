import { validMeasure } from './kitchenMeasure';
export type ArrivalLine = { ingredient_id: string; name: string; quantity: number; entered_quantity: number; display_unit: string; unit: string; expected_version: string; setup_unit?:string; setup_factor?:number };
export type KitchenArrival = { id: string; date: string; supplier: string; reference: string; created_by_name: string; created_at: string; lines: ArrivalLine[] };
export type ArrivalEntry = { value: string; name: string; unit: string; baseUnit: string; factor: number; version: string; measure?: string };
export type ArrivalDraft = { date: string; supplier: string; reference: string; entries: Record<string, ArrivalEntry>; updatedAt: string };
export type PendingArrival = { id: string; record: Omit<KitchenArrival, 'id' | 'created_by_name' | 'created_at'>; attempted: boolean };
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const short = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;
export function arrivalDate(v: unknown): v is string { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v; }
export function readArrivalDraft(raw: string | null): ArrivalDraft | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    if (!d || !short(d.date, 10) || !short(d.supplier, 160) || !short(d.reference, 120) || !short(d.updatedAt) || !Number.isFinite(Date.parse(d.updatedAt))
      || !d.entries || typeof d.entries !== 'object' || Array.isArray(d.entries) || Object.keys(d.entries).length > 200
      || !Object.values(d.entries).every((v: unknown) => { const e = v as ArrivalEntry; return e && short(e.value, 60) && short(e.name, 500) && short(e.unit, 60) && ['g', 'ml', 'unit'].includes(e.baseUnit) && Number.isFinite(e.factor) && e.factor > 0 && short(e.version) && validMeasure(e.measure,e.baseUnit); })) throw Error();
    return d;
  } catch { throw new Error('This delivery draft could not be read. Ask a manager to check this device.'); }
}
export function readPendingArrival(raw: string | null): PendingArrival | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw), r = p?.record;
    if (!p || !short(p.id) || !p.id || typeof p.attempted !== 'boolean' || !r || !arrivalDate(r.date) || !short(r.supplier, 160) || !r.supplier.trim() || !short(r.reference, 120)
      || !Array.isArray(r.lines) || !r.lines.length || r.lines.length > 200 || new Set(r.lines.map((l: ArrivalLine) => l.ingredient_id)).size !== r.lines.length
      || !r.lines.every((l: ArrivalLine) => l && short(l.ingredient_id) && l.ingredient_id && short(l.name, 500) && [l.quantity, l.entered_quantity].every(n => Number.isFinite(n) && n > 0)
        && short(l.display_unit, 60) && ['g', 'ml', 'unit'].includes(l.unit) && short(l.expected_version))) throw Error();
    return p;
  } catch { throw new Error('This pending delivery could not be read. Ask a manager to check this device.'); }
}
export function arrivalDraftFromPending(p: PendingArrival): ArrivalDraft {
  return { date: p.record.date, supplier: p.record.supplier, reference: p.record.reference, updatedAt: new Date().toISOString(), entries: Object.fromEntries(p.record.lines.map(l => [l.ingredient_id, { value: String(l.entered_quantity), name: l.name, unit: l.setup_unit??l.display_unit, measure:l.setup_unit&&l.display_unit!==l.setup_unit?l.display_unit:undefined, baseUnit: l.unit, factor: l.setup_factor??l.quantity / l.entered_quantity, version: l.expected_version }])) };
}
export function writeArrivalStorage(storage: Store, key: string, value: ArrivalDraft | PendingArrival | null, expected: string | null) {
  if (storage.getItem(key) !== expected) throw new Error('This delivery changed in another tab. Reload the draft before editing.');
  const next = value ? JSON.stringify(value) : null;
  if (value && 'record' in value) readPendingArrival(next); else if (value) readArrivalDraft(next);
  if (next === null) storage.removeItem(key); else storage.setItem(key, next);
  if (storage.getItem(key) !== next) throw new Error('Draft not saved on this device. Check browser storage and retry.');
  return next;
}
