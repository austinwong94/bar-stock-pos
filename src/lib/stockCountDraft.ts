import { validMeasure } from './kitchenMeasure';
import type { CountLine } from './stockCount';

export type CountEntry = { input: string; snapshot: CountLine; packs?: string; loose?: string; packSize?: number; measure?: string; looseMeasure?: string };
export type CountDraft = { entries: Record<string, CountEntry>; notes: string; packMode: boolean; updatedAt: string };
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function readCountDraft(raw: string | null): CountDraft | null {
  if (!raw) return null;
  const d = JSON.parse(raw);
  if (!d || !d.entries || Array.isArray(d.entries) || typeof d.entries !== 'object'
    || Object.keys(d.entries).length > 200 || typeof d.notes !== 'string' || d.notes.length > 2000
    || typeof d.packMode !== 'boolean' || typeof d.updatedAt !== 'string' || !Number.isFinite(Date.parse(d.updatedAt))
    || !Object.entries(d.entries).every(([id, value]) => {
      const e = value as CountEntry, s = e?.snapshot;
      return e && typeof e.input === 'string' && e.input.length <= 60 && s && s.ingredient_id === id
        && validMeasure(e.measure,s.expected_base_unit) && validMeasure(e.looseMeasure,s.expected_base_unit)
        && typeof s.name === 'string' && ['g', 'ml', 'unit'].includes(s.expected_base_unit)
        && Number.isFinite(s.expected_balance) && (s.expected_version === null || typeof s.expected_version === 'string')
        && (s.display_factor === undefined || Number.isFinite(s.display_factor) && s.display_factor > 0)
        && (s.display_unit === undefined || typeof s.display_unit === 'string')
        && (e.packs === undefined || typeof e.packs === 'string' && e.packs.length <= 60)
        && (e.loose === undefined || typeof e.loose === 'string' && e.loose.length <= 60)
        && (e.packSize === undefined || Number.isFinite(e.packSize) && e.packSize > 0);
    })) throw new Error('The saved count draft could not be read. Keep this device open and ask a manager to check it.');
  return d;
}

// Keep the editing draft separate from immutable submission attempts.
export function writeCountDraft(storage: Store, key: string, draft: CountDraft | null, expected: string | null) {
  if (storage.getItem(key) !== expected) throw new Error('This count changed in another tab. Reload the count before editing.');
  const next = draft ? JSON.stringify(draft) : null;
  if (next === null) storage.removeItem(key);
  else {
    readCountDraft(next);
    storage.setItem(key, next);
  }
  if (storage.getItem(key) !== next) throw new Error('Draft not saved on this device. Check browser storage and retry.');
  return next;
}
