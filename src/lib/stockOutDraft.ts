import { validMeasure } from './kitchenMeasure';
import { stockOutReasons, type StockOutLine } from './stockOut';

export type StockOutEntry = { input: string; snapshot: StockOutLine; measure?: string };
export type StockOutDraft = { version: 1; entries: Record<string, StockOutEntry>; reason: string; notes: string; createdAt: string; updatedAt: string };
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function readStockOutDraft(raw: string | null): StockOutDraft | null {
  if (raw === null) return null;
  let d;
  try { d = JSON.parse(raw); }
  catch { throw Error('The waste draft could not be read. Keep it on this device and ask a manager to check it.'); }
  if (!d || d.version !== 1 || !d.entries || typeof d.entries !== 'object' || Array.isArray(d.entries)
    || Object.keys(d.entries).length > 200 || typeof d.reason !== 'string' || d.reason !== '' && !stockOutReasons.some(([r]) => r === d.reason)
    || typeof d.notes !== 'string' || d.notes.length > 2000
    || ![d.createdAt, d.updatedAt].every(v => typeof v === 'string' && Number.isFinite(Date.parse(v)))
    || !Object.entries(d.entries).every(([id, value]) => {
      const e = value as StockOutEntry, s = e?.snapshot;
      return e && typeof e.input === 'string' && e.input.length <= 60 && s && s.ingredient_id === id
        && typeof s.name === 'string' && ['g', 'ml', 'unit'].includes(s.expected_base_unit)
        && validMeasure(e.measure, s.expected_base_unit) && Number.isFinite(s.expected_balance) && s.expected_balance >= 0
        && (s.expected_version === null || typeof s.expected_version === 'string')
        && (s.expected_item_version === undefined || typeof s.expected_item_version === 'string')
        && (s.display_unit === undefined || typeof s.display_unit === 'string')
        && (s.display_factor === undefined || Number.isFinite(s.display_factor) && s.display_factor > 0)
        && Number.isFinite(s.quantity) && s.quantity >= 0;
    })) throw Error('The waste draft could not be read. Keep it on this device and ask a manager to check it.');
  return d;
}

// Typing is separate from the frozen confirmation operation; never replace that operation.
export function writeStockOutDraft(storage: Store, key: string, draft: StockOutDraft | null, expected: string | null) {
  if (storage.getItem(key) !== expected) throw Error('This waste record changed in another tab. Reload before editing.');
  const next = draft ? JSON.stringify(draft) : null;
  if (next === null) storage.removeItem(key);
  else { readStockOutDraft(next); storage.setItem(key, next); }
  if (storage.getItem(key) !== next) throw Error('Waste draft not saved on this device. Check browser storage and retry.');
  return next;
}
