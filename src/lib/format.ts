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

export function unitsAndCartons(units: number, cartonSize: number) {
  const cartons = cartonSize > 0 ? units / cartonSize : 0;
  const cleanCartons = Number.isInteger(cartons) ? cartons.toFixed(0) : cartons.toFixed(2);
  return `${units} unit(s) / ${cleanCartons} carton(s)`;
}

export const cansAndCartons = unitsAndCartons;

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

function closeTimeMinutes(closeTime: string | number | boolean | null | undefined) {
  const [hourText, minuteText] = String(closeTime || '00:00').split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0;
  return Math.max(0, Math.min(1439, hour * 60 + minute));
}

export function malaysiaBusinessDateInputValue(value: string | Date = new Date(), closeTime: string | number | boolean | null | undefined = '00:00') {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(value));
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value ?? 0);
  const year = part('year');
  const month = part('month');
  const day = part('day');
  const minutes = part('hour') * 60 + part('minute');
  const date = new Date(Date.UTC(year, month - 1, day));
  if (minutes < closeTimeMinutes(closeTime)) date.setUTCDate(date.getUTCDate() - 1);
  return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + '-' + String(date.getUTCDate()).padStart(2, '0');
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
