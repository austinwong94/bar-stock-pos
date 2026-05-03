import { format } from 'date-fns';

export function money(value: number | string | null | undefined, symbol = 'RM') {
  const amount = typeof value === 'string' ? Number(value) : value;
  return `${symbol} ${(amount ?? 0).toFixed(2)}`;
}

export function dualMoney(value: number | string | null | undefined, symbol = 'RM') {
  const amount = typeof value === 'string' ? Number(value) : value ?? 0;
  const rmbRate = 1.52;
  if (symbol === 'RMB' || symbol === '¥') return `RMB ${(amount / rmbRate).toFixed(2)} / MYR ${amount.toFixed(2)}`;
  return `MYR ${amount.toFixed(2)} / RMB ${(amount / rmbRate).toFixed(2)}`;
}

export function cansAndCartons(cans: number, cartonSize: number) {
  const cartons = cartonSize > 0 ? cans / cartonSize : 0;
  const cleanCartons = Number.isInteger(cartons) ? cartons.toFixed(0) : cartons.toFixed(2);
  return `${cans} cans / ${cleanCartons} cartons`;
}

export function displayDate(value: string | Date) {
  return format(new Date(value), 'dd MMM yyyy');
}

export function todayInputValue() {
  return format(new Date(), 'yyyy-MM-dd');
}

export function dateInputValue(value: string | Date) {
  return format(new Date(value), 'yyyy-MM-dd');
}

export function malaysiaDateInputValue(value: string | Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

export function malaysiaDateBounds(value: string) {
  const start = new Date(`${value}T00:00:00+08:00`);
  const end = new Date(`${value}T00:00:00+08:00`);
  end.setDate(end.getDate() + 1);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export function csvEscape(value: unknown) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}
