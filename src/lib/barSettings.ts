import { z } from 'zod';

const stamp = z.string().refine(value => Number.isFinite(Date.parse(value)));
const values = z.object({
  business_name: z.string().refine(value => !!value.trim()),
  currency_symbol: z.string().refine(value => !!value.trim()),
  secondary_currency_symbol: z.string().refine(value => !!value.trim()),
  rmb_exchange_rate: z.number().finite().positive(),
  business_day_close_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  default_carton_size: z.number().int().min(1).max(2147483647),
  allow_negative_stock: z.boolean(),
  require_qr_reference: z.boolean(),
  require_manager_approval_for_complimentary: z.boolean(),
  staff_names: z.string(),
  receipt_footer_text: z.string(),
}).strict();
export const barSettingKeys = values.keyof().options;
export type BarSettingsValues = z.infer<typeof values>;
export type BarSettingKey = keyof BarSettingsValues;
const row = z.object({key: z.enum(barSettingKeys), value: z.union([z.string(), z.number().finite(), z.boolean()])}).strict();
const rows = z.array(row).length(barSettingKeys.length).refine(list => new Set(list.map(item => item.key)).size === barSettingKeys.length);
const nullableStamp = stamp.nullable();
const versionMap = z.object(Object.fromEntries(barSettingKeys.map(key => [key, nullableStamp])) as Record<BarSettingKey, typeof nullableStamp>).strict();
export type BarSettingsVersions = z.infer<typeof versionMap>;

export function parseBarSettings(input: unknown): BarSettingsValues {
  const parsed = values.safeParse(input);
  if (!parsed.success) throw Error('Check the settings. Enter a business name, valid currencies, a positive exchange rate, a whole carton size and a valid closing time.');
  return parsed.data;
}

export function barSettingsSnapshot(input: unknown) {
  const parsed = z.array(row.extend({updated_at: stamp})).max(barSettingKeys.length).safeParse(input);
  if (!parsed.success || new Set(parsed.data.map(item => item.key)).size !== parsed.data.length) throw Error('Settings could not be verified. Reload before editing.');
  const next = values.partial().safeParse(Object.fromEntries(parsed.data.map(item => [item.key, item.value])));
  if (!next.success) throw Error('Settings could not be verified. Reload before editing.');
  const blank = Object.fromEntries(barSettingKeys.map(key => [key, ['allow_negative_stock','require_qr_reference','require_manager_approval_for_complimentary'].includes(key) ? null : ''])) as Record<BarSettingKey, string | number | boolean | null>;
  return {values: next.data, form: {...blank, ...next.data}, versions: versionMap.parse(Object.fromEntries(barSettingKeys.map(key => [key, parsed.data.find(item => item.key === key)?.updated_at ?? null])))};
}

const schema = z.object({version: z.literal(1), createdAt: stamp, attempted: z.boolean(), args: z.object({
  p_rows: rows, p_versions: versionMap, p_request_id: z.string().uuid(), p_expected_actor_id: z.string().uuid(),
}).strict()}).strict();
export type BarSettingsRecovery = z.infer<typeof schema>;
export const barSettingsRecoveryKey = (project: string, actor: string) => `bar-settings-save:${project}:${actor}`;

export function readBarSettingsRecovery(raw: string | null, actor?: string): BarSettingsRecovery | null {
  if (raw === null) return null;
  try {
    const next = schema.parse(JSON.parse(raw));
    const parsed = parseBarSettings(Object.fromEntries(next.args.p_rows.map(item => [item.key, item.value])));
    if ((actor && actor !== next.args.p_expected_actor_id) || next.args.p_rows.some(item => item.value !== parsed[item.key])) throw Error();
    return next;
  } catch { throw Error('Pending settings could not be read. Keep this device and ask the owner to check it.'); }
}

export function writeBarSettingsRecovery(store: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, key: string, next: BarSettingsRecovery | null, expected: string | null) {
  if (store.getItem(key) !== expected) throw Error('Settings changed in another tab. Reopen Settings before continuing.');
  const raw = next ? JSON.stringify(schema.parse(next)) : null;
  if (raw !== null) { readBarSettingsRecovery(raw); store.setItem(key, raw); } else store.removeItem(key);
  if (store.getItem(key) !== raw) throw Error('Pending settings could not be retained on this device. Check browser storage before saving.');
  return raw;
}

export function barSettingsSaveConfirmed(input: unknown, operation: BarSettingsRecovery) {
  try {
    const result = z.object({settings: z.unknown()}).parse(input);
    const snapshot = barSettingsSnapshot(result.settings);
    return operation.args.p_rows.every(item => item.value === snapshot.values[item.key]);
  } catch { return false; }
}
