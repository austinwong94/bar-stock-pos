export function moneyCents(value: string): number | null {
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(value.trim())) return null;
  return Math.round(Number(value) * 100);
}
