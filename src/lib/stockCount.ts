import type { IngredientWithBalance } from './types';

export type CountItem = IngredientWithBalance & { balance_version: string | null };
export type CountLine = { display_unit?: string; display_factor?: number; expected_item_version?: string; ingredient_id: string; name: string; expected_base_unit: string; expected_balance: number; expected_version: string | null; counted_quantity: number };
export type CountAttempt = { id: string; lines: CountLine[]; notes: string; attempted: boolean; createdAt: string };
export const countBalance = (item: IngredientWithBalance) => Number((Array.isArray(item.ingredient_balances) ? item.ingredient_balances[0] : item.ingredient_balances)?.quantity_on_hand ?? 0);
export const countUnit = (unit: string) => unit === 'g' ? 'kg' : unit === 'unit' ? 'pcs' : unit;
export const countDisplay = (amount: number, unit: string) => (unit === 'g' ? amount / 1000 : amount).toLocaleString('en-MY', { maximumFractionDigits: unit === 'g' ? 5 : 2 });

export function countQuantity(input: string, unit: string): number | null {
  const digits = unit === 'g' ? 3 : unit === 'unit' ? 0 : 2;
  if (!(digits ? new RegExp(`^\\d+(\\.\\d{1,${digits}})?$`) : /^\d+$/).test(input.trim())) return null;
  const result = Number(input) * (unit === 'g' ? 1000 : 1);
  return Number.isFinite(result) && result <= 1e9 ? Math.round(result * 100) / 100 : null;
}

export function countChanged(line: CountLine, item?: CountItem) {
  return !item || !item.active || item.base_unit !== line.expected_base_unit || countBalance(item) !== line.expected_balance || item.balance_version !== line.expected_version || (!!line.expected_item_version && item.updated_at !== line.expected_item_version);
}

export function readCountAttempt(storage: Pick<Storage, 'length' | 'key' | 'getItem'>, prefix: string): CountAttempt | null {
  const attempts: CountAttempt[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(prefix + '/')) continue;
    const attempt = JSON.parse(storage.getItem(key) || 'null');
    if (typeof attempt?.id !== 'string' || key !== prefix + '/' + attempt.id || !Array.isArray(attempt.lines) || !attempt.lines.length || attempt.lines.length > 200 || typeof attempt.notes !== 'string' || typeof attempt.createdAt !== 'string' || typeof attempt.attempted !== 'boolean'
      || !attempt.lines.every((line: CountLine) => line && typeof line.ingredient_id === 'string' && typeof line.name === 'string' && ['g','ml','unit'].includes(line.expected_base_unit) && Number.isFinite(line.expected_balance) && Number.isFinite(line.counted_quantity) && line.counted_quantity >= 0 && (line.expected_version === null || typeof line.expected_version === 'string')))
      throw new Error('A pending count could not be read. Ask a manager to check stock history before counting again.');
    attempts.push(attempt);
  }
  return attempts.sort((a,b)=>a.createdAt.localeCompare(b.createdAt))[0] ?? null;
}

export function storeCountAttempt(storage: Pick<Storage, 'setItem' | 'getItem'>, prefix: string, attempt: CountAttempt) {
  const key = prefix + '/' + attempt.id;
  const previous = storage.getItem(key);
  if (previous) {
    const saved: CountAttempt = JSON.parse(previous);
    if (JSON.stringify([saved.lines,saved.notes]) !== JSON.stringify([attempt.lines,attempt.notes])) throw new Error('The pending count has different details. Check the original count first.');
  }
  const value = JSON.stringify(attempt);
  storage.setItem(key, value);
  if (storage.getItem(key) !== value) throw new Error('Browser storage is unavailable. The count has not been submitted.');
}
