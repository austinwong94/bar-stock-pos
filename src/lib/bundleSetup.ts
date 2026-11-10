import { z } from 'zod';
import { moneyCents } from './purchaseReceiptMath';
import type { SettingsMap } from './types';

export const bundleKeys = ['beer_bundle_enabled', 'beer_bundle_name', 'beer_bundle_units_per_set', 'beer_bundle_price'] as const;
export type BundleKey = typeof bundleKeys[number];
export type BundleForm = {beer_bundle_enabled: boolean; beer_bundle_name: string; beer_bundle_units_per_set: string; beer_bundle_price: string};
export type BundleRow = {key: BundleKey; value: string | number | boolean; updated_at: string};
export type BundleVersions = Record<BundleKey, string | null>;

export function bundleFormFromSettings(settings: Partial<SettingsMap>): BundleForm {
  return {beer_bundle_enabled: settings.beer_bundle_enabled === true || settings.beer_bundle_enabled === 'true',
    beer_bundle_name: String(settings.beer_bundle_name ?? ''), beer_bundle_units_per_set: String(settings.beer_bundle_units_per_set ?? ''), beer_bundle_price: String(settings.beer_bundle_price ?? '')};
}
export function parseBundleForm(form: BundleForm) {
  const name = form.beer_bundle_name.trim(), raw = form.beer_bundle_units_per_set.trim();
  const price = moneyCents(form.beer_bundle_price), units = Number(raw);
  if (!name) return {error: 'Enter a bundle name.'} as const;
  if (!/^\d{1,10}$/.test(raw) || !Number.isInteger(units) || units < 1 || units > 2147483647) return {error: 'Enter a whole number of beers per set.'} as const;
  if (price === null || price <= 0) return {error: 'Enter a bundle price above RM 0, with no more than 2 decimal places.'} as const;
  return {values: {beer_bundle_enabled: form.beer_bundle_enabled, beer_bundle_name: name, beer_bundle_units_per_set: units, beer_bundle_price: price / 100}} as const;
}
export function bundleConfig(settings: Partial<SettingsMap>) {
  const parsed = parseBundleForm(bundleFormFromSettings(settings));
  return 'values' in parsed ? parsed.values : null;
}
export function bundleSnapshot(rows: BundleRow[]) {
  if (new Set(rows.map(row => row.key)).size !== rows.length || rows.some(row => !bundleKeys.includes(row.key) || !Number.isFinite(Date.parse(row.updated_at)))) throw Error('Bundle settings could not be verified. Reload before editing.');
  return {form: bundleFormFromSettings(Object.fromEntries(rows.map(row => [row.key, row.value]))),
    versions: Object.fromEntries(bundleKeys.map(key => [key, rows.find(row => row.key === key)?.updated_at ?? null])) as BundleVersions};
}
const stamp = z.string().refine(value => Number.isFinite(Date.parse(value)));
const row = z.object({key: z.enum(bundleKeys), value: z.union([z.string(), z.number().finite(), z.boolean()])}).strict();
const versions = z.object(Object.fromEntries(bundleKeys.map(key => [key, stamp.nullable()])) as Record<BundleKey, z.ZodNullable<typeof stamp>>).strict();
const schema = z.object({version: z.literal(1), createdAt: stamp, attempted: z.boolean(), args: z.object({
  p_rows: z.array(row).length(4), p_versions: versions, p_request_id: z.string().uuid(), p_expected_actor_id: z.string().uuid(),
}).strict()}).strict();
export type BundleRecovery = z.infer<typeof schema>;
export const bundleRecoveryKey = (project: string, actor: string) => `bundle-save:${project}:${actor}`;
export function readBundleRecovery(raw: string | null, actor?: string): BundleRecovery | null {
  if (raw === null) return null;
  try {
    const value = schema.parse(JSON.parse(raw));
    const parsed = parseBundleForm(bundleFormFromSettings(Object.fromEntries(value.args.p_rows.map(row => [row.key, row.value]))));
    const values = parsed.values;
    if (new Set(value.args.p_rows.map(row => row.key)).size !== 4 || (actor && actor !== value.args.p_expected_actor_id) || !values || value.args.p_rows.some(row => row.value !== values[row.key])) throw Error();
    return value;
  } catch { throw Error('Pending bundle details could not be read. Keep this device and ask the owner to check it.'); }
}
export function writeBundleRecovery(store: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, key: string, next: BundleRecovery | null, expected: string | null) {
  if (store.getItem(key) !== expected) throw Error('Bundle details changed in another tab. Reopen Bar Admin before continuing.');
  const raw = next ? JSON.stringify(schema.parse(next)) : null;
  if (next) { readBundleRecovery(raw); store.setItem(key, raw!); } else store.removeItem(key);
  if (store.getItem(key) !== raw) throw Error('Pending bundle details could not be retained on this device. Check browser storage before saving.');
  return raw;
}
export function bundleSaveConfirmed(value: unknown, operation: BundleRecovery) {
  const result = z.object({settings: z.array(row.extend({updated_at: stamp})).length(4)}).safeParse(value);
  return result.success && new Set(result.data.settings.map(row => row.key)).size === 4 && operation.args.p_rows.every(expected => result.data.settings.some(row => row.key === expected.key && row.value === expected.value));
}
