import type { DailyUsage } from './supplyWorkflow';
import { validMeasure } from './kitchenMeasure';

export type UsageEntry = { guest: string; staff: string; name?: string; baseUnit?: 'g'|'ml'|'unit'; unit?: string; factor?: number; version?: string; measure?: string };

export type UsageDraft = {
  date: string;
  entries: Record<string, UsageEntry>;
  guests: string;
  staff: string;
  notes: string;
  selected: string[];
  all: boolean;
  expected: string | null;
  updatedAt: string;
  ingredientList?: {date:string;ids:string[]};
};
export type PendingUsage = {
  id: string;
  record: Omit<DailyUsage, 'id' | 'updated_at' | 'created_by' | 'created_by_name' | 'revision'>;
  expected: string | null;
  attempted: boolean;
};
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const short = (v: unknown, max = 60): v is string => typeof v === 'string' && v.length <= max;
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 500 && v.every(s => short(s, 200));
const version = (v: unknown) => v === null || short(v, 100);
const quantity = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
export function usageDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
    && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
}

export function readUsageDraft(raw: string | null, date: string): UsageDraft | null {
  if (!raw) return null;
  const d = JSON.parse(raw);
  if (!d || d.date !== date || !usageDate(d.date) || !short(d.guests) || !short(d.staff)
    || !short(d.notes, 2000) || !strings(d.selected) || typeof d.all !== 'boolean' || !version(d.expected)
    || typeof d.updatedAt !== 'string' || !Number.isFinite(Date.parse(d.updatedAt))
    || (d.ingredientList!==undefined&&(!usageDate(d.ingredientList?.date)||d.ingredientList.date>=d.date||!strings(d.ingredientList.ids)||new Set(d.ingredientList.ids).size!==d.ingredientList.ids.length))
    || !d.entries || typeof d.entries !== 'object' || Array.isArray(d.entries)
    || Object.keys(d.entries).length > 1000 || !Object.values(d.entries).every(value => {
      const e = value as UsageEntry;
      return e && short(e.guest) && short(e.staff)
        && (e.name === undefined || short(e.name, 500))
        && (e.baseUnit === undefined || ['g','ml','unit'].includes(e.baseUnit))
        && (e.measure === undefined || ['kg','g','L','ml'].includes(e.measure))
        && (e.unit === undefined || short(e.unit))
        && (e.factor === undefined || Number.isFinite(e.factor) && e.factor > 0)
        && (e.version === undefined || short(e.version, 100));
    })) throw new Error('This usage draft could not be read. Ask a manager to check it on this device.');
  return d;
}

export function readPendingUsage(raw: string | null): PendingUsage | null {
  if (!raw) return null;
  const p = JSON.parse(raw), r = p?.record;
  if (!p || !short(p.id, 200) || !p.id || !version(p.expected) || typeof p.attempted !== 'boolean'
    || !r || !usageDate(r.business_date) || !strings(r.template_ids) || !short(r.notes, 2000)
    || ![r.guest_meals, r.staff_meals].every(v => Number.isSafeInteger(v) && v >= 0 && v <= 100000)
    || !Array.isArray(r.lines) || r.lines.length > 1000 || !r.lines.every((l: Record<string, unknown>) =>
      l && short(l.ingredient_id, 200) && short(l.name, 500) && ['g', 'ml', 'unit'].includes(String(l.unit))
      && quantity(l.guest_quantity) && quantity(l.staff_quantity)
      && (l.display_factor === undefined || typeof l.display_factor === 'number' && Number.isFinite(l.display_factor) && l.display_factor > 0)
      && (l.display_unit === undefined || short(l.display_unit))
      && (l.expected_item_version === undefined || short(l.expected_item_version, 100))))
    throw new Error('A pending usage confirmation could not be read. Ask a manager to check it on this device.');
  return p;
}

// Exact-value checks prevent an older open tab from overwriting newer typing or a submission.
export function writeUsageStorage(storage: Store, key: string, value: UsageDraft | PendingUsage | null, expected: string | null) {
  if (storage.getItem(key) !== expected) throw new Error('This usage changed in another tab. Reload the day before editing.');
  const next = value === null ? null : JSON.stringify(value);
  if (value && 'record' in value) readPendingUsage(next);
  else if (value) readUsageDraft(next, value.date);
  if (next === null) storage.removeItem(key);
  else storage.setItem(key, next);
  if (storage.getItem(key) !== next) throw new Error('Not saved on this device. Check browser storage and retry.');
  return next;
}

export function usageDraftDays(storage: Pick<Storage, 'length' | 'key'>, prefix: string) {
  const days: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(prefix) && usageDate(key.slice(prefix.length))) days.push(key.slice(prefix.length));
  }
  return days.sort().reverse();
}
