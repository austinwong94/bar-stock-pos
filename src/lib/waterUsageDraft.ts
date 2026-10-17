import { usageDate, usageDraftDays } from './dailyUsageDraft';

export type WaterDay = { id: string; water_key?: string; business_date: string; bottles: number; closed: boolean; notes: string; updated_at: string; created_by_name: string; revision: number };
export type WaterDraft = { date: string; waterKey: string; bottles: string; closed: boolean; notes: string; expected: string | null; updatedAt: string };
export type PendingWater = { id: string; record: Pick<WaterDay, 'business_date' | 'water_key' | 'bottles' | 'closed' | 'notes'>; expected: string | null; attempted: boolean };
export const waterKeys = ['snorkelling-mineral-water-500ml', 'snorkelling-mineral-water-230ml', 'snorkelling-mineral-water'];
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const short = (v: unknown, max = 100): v is string => typeof v === 'string' && v.length <= max;
const version = (v: unknown) => v === null || short(v);
export { usageDate as waterDate, usageDraftDays as waterDraftDays };
export function waterBottles(value: string, closed = false): number | null {
  if (closed) return 0;
  const n = /^\d+$/.test(value.trim()) ? Number(value) : NaN;
  return Number.isSafeInteger(n) && n >= 0 && n <= 100000 ? n : null;
}
export function waterBalanceAfter(balance: number | null, used: number | null, previous = 0) {
  return balance === null || used === null ? null : balance + previous - used;
}
export function readWaterDraft(raw: string | null, date: string, waterKey: string): WaterDraft | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    if (!d || !usageDate(d.date) || d.date !== date || d.waterKey !== waterKey || !waterKeys.includes(d.waterKey)
      || !short(d.bottles, 60) || typeof d.closed !== 'boolean' || !short(d.notes, 2000) || !version(d.expected)
      || !short(d.updatedAt) || !Number.isFinite(Date.parse(d.updatedAt))) throw Error();
    return d;
  } catch { throw new Error('This water draft could not be read. Ask a manager to check this device.'); }
}
export function readPendingWater(raw: string | null, waterKey: string): PendingWater | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw), r = p?.record;
    if (!p || !short(p.id, 200) || !p.id || !version(p.expected) || typeof p.attempted !== 'boolean'
      || !r || !usageDate(r.business_date) || (r.water_key ?? 'snorkelling-mineral-water') !== waterKey || !waterKeys.includes(waterKey)
      || !Number.isSafeInteger(r.bottles) || r.bottles < 0 || r.bottles > 100000 || typeof r.closed !== 'boolean'
      || (r.closed && r.bottles !== 0) || !short(r.notes, 2000)) throw Error();
    // Do not insert water_key into a legacy payload: a retry must keep the original request unchanged.
    return p;
  } catch { throw new Error('This pending water record could not be read. Ask a manager to check this device.'); }
}
export function waterDraftFromPending(p: PendingWater, waterKey: string): WaterDraft {
  return { date: p.record.business_date, waterKey, bottles: String(p.record.bottles), closed: p.record.closed, notes: p.record.notes, expected: p.expected, updatedAt: new Date().toISOString() };
}
export function writeWaterStorage(storage: Store, key: string, value: WaterDraft | PendingWater | null, expected: string | null, waterKey: string) {
  if (storage.getItem(key) !== expected) throw new Error('This water record changed in another tab. Reload the day before editing.');
  const next = value === null ? null : JSON.stringify(value);
  if (value && 'record' in value) readPendingWater(next, waterKey);
  else if (value) readWaterDraft(next, value.date, waterKey);
  if (next === null) storage.removeItem(key); else storage.setItem(key, next);
  if (storage.getItem(key) !== next) throw new Error('Draft not saved on this device. Check browser storage and retry.');
  return next;
}
