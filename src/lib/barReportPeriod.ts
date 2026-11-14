import { addDays, addMonths, addWeeks, differenceInCalendarDays, endOfMonth, format, isValid, parseISO, startOfISOWeek } from 'date-fns';

export type BarPeriod = 'day' | 'week' | 'month' | 'custom';
export type PeriodProblem = 'missing' | 'invalid' | 'reversed' | 'too-long';
export type BarRange = { from: string; to: string };
type Result = { range: BarRange; problem: null } | { range: null; problem: PeriodProblem };

function calendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return null;
  const date = parseISO(value);
  return isValid(date) && format(date, 'yyyy-MM-dd') === value ? date : null;
}

export function barPeriodRange(period: BarPeriod, value: string, end = ''): Result {
  if (!value || (period === 'custom' && !end)) return { range: null, problem: 'missing' };
  let from = value, to = value;
  if (period === 'week') {
    if (!/^\d{4}-W\d{2}$/.test(value)) return { range: null, problem: 'invalid' };
    const january = calendarDate(value.slice(0, 4) + '-01-04');
    if (!january) return { range: null, problem: 'invalid' };
    const start = addWeeks(startOfISOWeek(january), Number(value.slice(6)) - 1);
    if (format(start, "RRRR-'W'II") !== value) return { range: null, problem: 'invalid' };
    from = format(start, 'yyyy-MM-dd'); to = format(addDays(start, 6), 'yyyy-MM-dd');
  } else if (period === 'month') {
    if (!/^\d{4}-\d{2}$/.test(value)) return { range: null, problem: 'invalid' };
    const start = calendarDate(value + '-01');
    if (!start) return { range: null, problem: 'invalid' };
    from = value + '-01'; to = format(endOfMonth(start), 'yyyy-MM-dd');
  } else if (period === 'custom') to = end;
  const start = calendarDate(from), finish = calendarDate(to);
  if (!start || !finish) return { range: null, problem: 'invalid' };
  const days = differenceInCalendarDays(finish, start);
  if (days < 0) return { range: null, problem: 'reversed' };
  if (days >= 366) return { range: null, problem: 'too-long' };
  return { range: { from, to }, problem: null };
}

export function shiftBarPeriod(period: Exclude<BarPeriod, 'custom'>, value: string, direction: -1 | 1): string | null {
  const result = barPeriodRange(period, value);
  if (!result.range) return null;
  const start = parseISO(result.range.from);
  const date = period === 'day' ? addDays(start, direction) : period === 'week' ? addWeeks(start, direction) : addMonths(start, direction);
  if (date.getFullYear() < 1 || date.getFullYear() > 9999) return null;
  const next = format(date, period === 'day' ? 'yyyy-MM-dd' : period === 'week' ? "RRRR-'W'II" : 'yyyy-MM');
  return barPeriodRange(period, next).range ? next : null;
}

export function periodProblemLabel(problem: PeriodProblem | null, text: (en: string, ms: string) => string) {
  if (problem === 'missing') return text('Enter the report dates.', 'Masukkan tarikh laporan.');
  if (problem === 'reversed') return text('End date must be on or after start date.', 'Tarikh akhir mesti pada atau selepas tarikh mula.');
  if (problem === 'too-long') return text('Choose a range of up to 366 days.', 'Pilih julat sehingga 366 hari.');
  return problem ? text('Enter a valid report date.', 'Masukkan tarikh laporan yang sah.') : '';
}
