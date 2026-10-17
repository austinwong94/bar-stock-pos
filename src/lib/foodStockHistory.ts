import { addDays, addMonths, addWeeks, format, isValid, parseISO, startOfISOWeek, startOfMonth } from 'date-fns';
import type { IngredientMovement } from './types';

export type HistoryPeriod = 'day' | 'week' | 'month';
export type CountHistoryKind = 'count' | 'count_short' | 'count_extra' | 'count_matched';
export type HistoryKind = 'all' | 'in' | 'out' | 'preparation' | CountHistoryKind;
export type CountHistorySummary = { total: number; short: number; extra: number; matched: number };
export type HistoryCursor = { created_at: string; id: string };
export type HistoryPage = { rows: IngredientMovement[]; next: HistoryCursor | null; count_summary?: CountHistorySummary | null };
export const historyPageSize = 50;

export function historyPeriodValue(date: string, period: HistoryPeriod) {
  return format(parseISO(date), period === 'day' ? 'yyyy-MM-dd' : period === 'week' ? "RRRR-'W'II" : 'yyyy-MM');
}

export function historyPeriodStart(value: string, period: HistoryPeriod) {
  const parsed = parseISO(period === 'week' ? value + '-1' : period === 'month' ? value + '-01' : value);
  if (!isValid(parsed) || historyPeriodValue(format(parsed, 'yyyy-MM-dd'), period) !== value) return null;
  return format(parsed, 'yyyy-MM-dd');
}

export function historyRange(date: string, period: HistoryPeriod, direction = 0) {
  const day = parseISO(date);
  const start = period === 'week' ? addWeeks(startOfISOWeek(day), direction)
    : period === 'month' ? addMonths(startOfMonth(day), direction) : addDays(day, direction);
  const end = period === 'week' ? addWeeks(start, 1) : period === 'month' ? addMonths(start, 1) : addDays(start, 1);
  return { start: format(start, 'yyyy-MM-dd'), end: format(end, 'yyyy-MM-dd') };
}

export function historyKindMatches(row: IngredientMovement, kind: HistoryKind) {
  return kind === 'all' || (kind === 'in' && row.movement_type === 'stock_in')
    || (kind === 'out' && ['waste', 'adjustment'].includes(row.movement_type))
    || (kind === 'preparation' && row.movement_type === 'kitchen_production')
    || (row.movement_type === 'count' && (kind === 'count'
      || (kind === 'count_short' && Number(row.quantity_change) < 0)
      || (kind === 'count_extra' && Number(row.quantity_change) > 0)
      || (kind === 'count_matched' && Number(row.quantity_change) === 0)));
}

export function validCountSummary(value: unknown): value is CountHistorySummary {
  if (!value || typeof value !== 'object') return false;
  const s = value as CountHistorySummary;
  return [s.total, s.short, s.extra, s.matched].every(n => Number.isSafeInteger(n) && n >= 0)
    && s.total === s.short + s.extra + s.matched;
}

export function countHistoryTotal(summary: CountHistorySummary, kind: CountHistoryKind) {
  return kind === 'count_short' ? summary.short : kind === 'count_extra' ? summary.extra
    : kind === 'count_matched' ? summary.matched : summary.total;
}

// Local review follows the same filters and cursor order as the cloud RPC.
export function localFoodHistory(rows: IngredientMovement[], args: {
  p_start: string; p_end: string; p_search?: string; p_kind?: HistoryKind;
  p_before_created_at?: string | null; p_before_id?: string | null; p_limit?: number;
}): HistoryPage {
  const start = Date.parse(args.p_start + 'T00:00:00+08:00');
  const end = Date.parse(args.p_end + 'T00:00:00+08:00');
  const query = (args.p_search ?? '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(100, args.p_limit ?? historyPageSize));
  const before = args.p_before_created_at ? Date.parse(args.p_before_created_at) : null;
  const matching = rows.filter(row => {
    const time = Date.parse(row.created_at);
    return time >= start && time < end
      && [row.ingredient_items?.name,row.ingredient_items?.kitchen_label, row.entered_by, row.reason, row.notes, row.reference_id].join(' ').toLowerCase().includes(query);
  });
  const summary = args.p_kind?.startsWith('count') ? matching.filter(row => row.movement_type === 'count').reduce<CountHistorySummary>((s, row) => {
    s.total++;
    if (Number(row.quantity_change) < 0) s.short++;
    else if (Number(row.quantity_change) > 0) s.extra++;
    else s.matched++;
    return s;
  }, { total: 0, short: 0, extra: 0, matched: 0 }) : null;
  const filtered = matching.filter(row => historyKindMatches(row, args.p_kind ?? 'all')
    && (before === null || Date.parse(row.created_at) < before || (Date.parse(row.created_at) === before && row.id < (args.p_before_id ?? ''))))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || (a.id === b.id ? 0 : a.id < b.id ? 1 : -1));
  const page = filtered.slice(0, limit), last = page[page.length - 1];
  return { rows: page, next: filtered.length > limit && last ? { created_at: last.created_at, id: last.id } : null, count_summary: summary };
}
