import { useCallback, useEffect, useRef, useState } from 'react';
import { History, RefreshCw, Search, X } from 'lucide-react';
import { BarPeriodControl } from '../../components/BarPeriodControl';
import { ViewChoices } from '../../components/ViewChoices';
import { inputClass, secondaryButtonClass } from '../../components/Form';
import { useLanguage } from '../../lib/language';
import { supabase } from '../../lib/supabase';
import { readErrorMessage } from '../../lib/opsData';
import { malaysiaDateInputValue } from '../../lib/format';
import { countOutcome, foodMovementName, movementAmount } from '../../lib/foodItemHistory';
import FoodItemHistory, { type ItemHistorySelection } from './FoodItemHistory';
import { useSharedRefresh } from '../../lib/useSharedRefresh';
import { countHistoryTotal, validCountSummary, historyPageSize, historyPeriodStart, historyPeriodValue, historyRange, type CountHistoryKind, type CountHistorySummary, type HistoryCursor, type HistoryKind, type HistoryPage, type HistoryPeriod } from '../../lib/foodStockHistory';
import type { IngredientMovement } from '../../lib/types';

export default function FoodStockHistory({ initialKind = 'all' }: { initialKind?: HistoryKind }) {
  const { text: t } = useLanguage();
  const [date, setDate] = useState(() => malaysiaDateInputValue(new Date()));
  const [period, setPeriod] = useState<HistoryPeriod>('day');
  const [kind, setKind] = useState<HistoryKind>(initialKind.startsWith('count') ? 'count' : initialKind);
  const [countKind, setCountKind] = useState<CountHistoryKind>(initialKind.startsWith('count') ? initialKind as CountHistoryKind : 'count');
  const [summary, setSummary] = useState<CountHistorySummary | null>(null);
  const [search, setSearch] = useState(''), [query, setQuery] = useState('');
  const [trace, setTrace] = useState<ItemHistorySelection | null>(null);
  const [rows, setRows] = useState<IngredientMovement[]>([]);
  const [next, setNext] = useState<HistoryCursor | null>(null);
  const [loading, setLoading] = useState(true), [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(''), [updateError, setUpdateError] = useState(false), [changed, setChanged] = useState(false);
  const generation = useRef(0), busy = useRef(false), firstPage = useRef<string | null>(null);
  const { start, end } = historyRange(date, period);
  const requestKind = kind === 'count' ? countKind : kind;

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const fetchPage = useCallback(async (cursor: HistoryCursor | null): Promise<HistoryPage> => {
    const result = await supabase.rpc('read_food_stock_history', {
      p_start: start, p_end: end, p_search: query, p_kind: requestKind, p_limit: historyPageSize,
      p_before_created_at: cursor?.created_at ?? null, p_before_id: cursor?.id ?? null,
    });
    if (result.error) throw result.error;
    if (!result.data || !Array.isArray(result.data.rows)) throw new Error('Could not read food stock history.');
    if (kind === 'count' && !validCountSummary(result.data.count_summary)) throw new Error(t('Stock-check filters need the latest database update.', 'Penapis kiraan stok memerlukan kemas kini pangkalan data terkini.'));
    return result.data;
  }, [start, end, query, requestKind, kind, t]);

  const load = useCallback(async (cursor: HistoryCursor | null = null) => {
    if (cursor && busy.current) return;
    const ticket = ++generation.current;
    busy.current = true;
    setError('');
    if (cursor) setLoadingMore(true);
    else {
      setLoading(true); setLoadingMore(false); setRows([]); setNext(null); setSummary(null);
      setChanged(false); setUpdateError(false); firstPage.current = null;
    }
    try {
      const page = await fetchPage(cursor);
      if (ticket !== generation.current) return;
      if (!cursor) { firstPage.current = JSON.stringify(page); setSummary(page.count_summary ?? null); }
      setRows(old => cursor ? [...old, ...page.rows.filter(row => !old.some(existing => existing.id === row.id))] : page.rows);
      setNext(page.next);
    } catch (e) {
      if (ticket === generation.current) setError(typeof e === 'object' && e !== null && 'code' in e && e.code === 'PGRST202'
        ? t('Food stock history needs the latest database update.', 'Sejarah stok makanan memerlukan kemas kini pangkalan data terkini.')
        : readErrorMessage(e, t('Could not load food stock history.', 'Sejarah stok makanan tidak dapat dimuatkan.')));
    } finally {
      if (ticket === generation.current) { busy.current = false; setLoading(false); setLoadingMore(false); }
    }
  }, [fetchPage, t]);

  useEffect(() => {
    void load();
    return () => { generation.current++; busy.current = false; };
  }, [load]);

  // Do not reorder or discard older rows while someone is reviewing them.
  const checkUpdates = useCallback(async () => {
    if (busy.current || firstPage.current === null) return;
    const ticket = generation.current;
    try {
      const page = await fetchPage(null);
      if (ticket === generation.current) { setChanged(JSON.stringify(page) !== firstPage.current); setUpdateError(false); }
    } catch { if (ticket === generation.current) setUpdateError(true); }
  }, [fetchPage]);
  useSharedRefresh(checkUpdates, { tables: ['ingredient_movements', 'ingredient_items'], intervalMs: 30000 });

  return <section className="food-stock-history mt-3" aria-label={t('Food Stock History', 'Sejarah Stok Makanan')}>
    <BarPeriodControl period={period} onPeriod={setPeriod} value={historyPeriodValue(date, period)}
      onValue={value => { const parsed = historyPeriodStart(value, period); if (parsed) setDate(parsed); }}
      onShift={direction => setDate(historyRange(date, period, direction).start)} />
    <div className="mb-2 flex items-center gap-2">
      <label className="relative block min-w-0 flex-1"><Search size={16} className="pointer-events-none absolute left-3 top-3.5 text-muted" />
        <input className={inputClass + ' pl-9 pr-10'} type="search" maxLength={160} aria-label={t('Search Food Stock History', 'Cari Sejarah Stok Makanan')}
          placeholder={t('Item, staff or note', 'Item, staf atau nota')} value={search} onChange={event => setSearch(event.target.value)} />
      </label>
      <button className={secondaryButtonClass + ' !h-11 !w-11 !p-0 shrink-0'} title={t('Refresh History', 'Muat Semula Sejarah')} aria-label={t('Refresh History', 'Muat Semula Sejarah')} disabled={loading || loadingMore} onClick={() => void load()}><RefreshCw size={16} /></button>
    </div>
    <ViewChoices label={t('Movement Type', 'Jenis Pergerakan')} value={kind} onChange={value => setKind(value as HistoryKind)} className="food-history-types"
      items={[{ value: 'all', label: t('All', 'Semua') }, { value: 'in', label: t('Stock In', 'Stok Masuk') }, { value: 'out', label: t('Stock Out', 'Stok Keluar') }, { value: 'preparation', label: t('Usage', 'Penggunaan'), ariaLabel: t('Meal Preparation', 'Penyediaan Makanan') }, { value: 'count', label: t('Counts', 'Kiraan') }]} />
    {kind === 'count' ? <div className="food-count-results">
      <span className="food-count-results-label">{t('Count Records', 'Rekod Kiraan')}{query ? t(' · Search Results', ' · Hasil Carian') : ''}</span>
      <ViewChoices label={t('Count Result', 'Hasil Kiraan')} value={countKind} onChange={value => setCountKind(value as CountHistoryKind)} className="food-count-filters"
        items={([
          ['count', t('All', 'Semua')], ['count_short', t('Short', 'Kurang')],
          ['count_extra', t('Extra', 'Lebih')], ['count_matched', t('Matched', 'Sepadan')],
        ] as [CountHistoryKind, string][]).map(([value, label]) => ({ value, ariaLabel: label,
          label: <><span>{label}</span><strong>{summary ? countHistoryTotal(summary, value).toLocaleString('en-MY') : '-'}</strong></>,
        }))} />
    </div> : null}
    {changed ? <button className="my-2 text-left text-sm font-semibold text-accent underline" onClick={() => void load()}>{t('New changes available. Refresh history.', 'Perubahan baharu tersedia. Muat semula sejarah.')}</button> : null}
    {updateError ? <p role="status" className="my-2 text-sm text-warning">{t('Could not check for updates. Refresh to try again.', 'Kemas kini tidak dapat disemak. Cuba muat semula.')}</p> : null}
    {error ? <p role="alert" className="my-3 text-sm text-danger">{error} <button className="underline" onClick={() => void load(next)}>{t('Retry', 'Cuba Lagi')}</button></p> : null}
    {loading ? <p role="status" className="py-5 text-sm text-muted">{t('Loading History...', 'Memuatkan Sejarah...')}</p> : <>
      {rows.length || !error ? <div className="my-3 flex items-center justify-between gap-2 text-xs text-muted"><span>{t('Recorded Time (Malaysia)', 'Masa Direkod (Malaysia)')}</span><span aria-live="polite" className="text-right">{rows.length}{summary && kind === 'count' ? ' / ' + countHistoryTotal(summary, countKind) : ''} {t(rows.length === 1 ? 'record shown' : 'records shown', 'rekod dipaparkan')}</span></div> : null}
      <ul aria-label={t('Stock Movements', 'Pergerakan Stok')} className="divide-y divide-line border-y border-line">{rows.map(row => {
        const name = row.ingredient_items?.kitchen_label ?? row.ingredient_items?.name ?? t('Food Item', 'Item Makanan');
        const amount = (n:number) => movementAmount(row,n);
        const counted = row.movement_type === 'count';
        const changeColor = counted ? (row.quantity_change < 0 ? 'text-danger' : row.quantity_change > 0 ? 'text-warning' : 'text-palm') : (row.quantity_change < 0 ? 'text-warning' : 'text-accent');
        return <li key={row.id} className="food-history-row py-3">
          <div className="min-w-0"><button type="button" className="food-history-item-link" aria-label={t('Item History: ', 'Sejarah Item: ')+name} onClick={()=>setTrace({itemId:row.ingredient_id,name,anchorId:row.id})}><History size={15}/><span>{name}</span></button>
            <p className="mt-0.5 text-xs text-muted">{foodMovementName(row,t)} · {new Date(row.created_at).toLocaleString(t('en-MY', 'ms-MY'), { timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'short' })}</p>
            <p className="mt-0.5 text-xs text-muted">{counted?t('Expected', 'Dijangka'):t('Before', 'Sebelum')} {amount(row.quantity_before)} · {counted?t('Counted', 'Dikira'):t('After', 'Selepas')} {amount(row.quantity_after)}</p>
          </div>
          <p className="food-history-note min-w-0 break-words text-xs text-muted"><span className="font-medium text-ink">{row.entered_by || t('Staff Not Recorded', 'Staf Tidak Direkod')}</span>{row.notes ? ' · ' + row.notes : ''}</p>
          <span className={'food-history-change text-right text-sm font-semibold tabular ' + changeColor}>{counted?<span className="block text-xs">{countOutcome(row,t)}</span>:null}{row.quantity_change > 0 ? '+' : ''}{amount(row.quantity_change)}</span>
        </li>;
      })}</ul>
      {!rows.length && !error ? <div className="py-6 text-center"><p className="text-sm text-muted">{kind === 'count' ? t('No Count Records Match These Filters', 'Tiada Rekod Kiraan Sepadan Dengan Penapis Ini') : t('No Matching Movements', 'Tiada Pergerakan Sepadan')}</p>{query || kind !== 'all' ? <button className={secondaryButtonClass + ' mt-3'} onClick={() => { setSearch(''); setQuery(''); if (kind === 'count') setCountKind('count'); else setKind('all'); }}><X size={15} />{t('Clear Filters', 'Kosongkan Penapis')}</button> : null}</div> : null}
      {next ? <div className="py-4 text-center"><button className={secondaryButtonClass} disabled={loadingMore} onClick={() => void load(next)}>{loadingMore ? t('Loading...', 'Memuatkan...') : t('Load Older Records', 'Muatkan Rekod Lebih Lama')}</button></div> : null}
    </>}
    {trace ? <FoodItemHistory selection={trace} onClose={()=>setTrace(null)}/> : null}
  </section>;
}
