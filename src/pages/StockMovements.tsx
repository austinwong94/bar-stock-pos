import { useEffect, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ArrowLeft, ChevronDown, RefreshCw, Search, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/Page';
import { BarPeriodControl } from '../components/BarPeriodControl';
import { ViewChoices } from '../components/ViewChoices';
import { iconButtonClass, inputClass, secondaryButtonClass } from '../components/Form';
import { malaysiaBusinessDateInputValue } from '../lib/format';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { loadLocalStockMovements } from '../lib/localStore';
import { useLanguage } from '../lib/language';
import { useSharedRefresh } from '../lib/useSharedRefresh';
import { barPeriodRange, periodProblemLabel, shiftBarPeriod, type BarPeriod } from '../lib/barReportPeriod';
import { checkedMovements, movementBounds, movementBusinessDate, movementInputLabel, movementLabel, movementMatches, movementNotes, movementTime, movementTypes, readBarMovements, type MovementBounds } from '../lib/barMovementHistory';
import type { SettingsMap, StockMovement } from '../lib/types';

export default function StockMovements({ settings }: { settings: SettingsMap }) {
  const { text, language } = useLanguage();
  const today = malaysiaBusinessDateInputValue(new Date(), settings.business_day_close_time);
  const closeTime = String(settings.business_day_close_time);
  const [period, setPeriod] = useState<BarPeriod>('day');
  const [day, setDay] = useState(today), [week, setWeek] = useState(() => format(parseISO(today), "RRRR-'W'II"));
  const [month, setMonth] = useState(today.slice(0, 7)), [start, setStart] = useState(today), [end, setEnd] = useState(today);
  const [type, setType] = useState<'all' | StockMovement['movement_type']>('all');
  const [query, setQuery] = useState('');
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true), [failedScope, setFailedScope] = useState<string | null>(null);
  const [verifiedScope, setVerifiedScope] = useState('');
  const generation = useRef(0);
  const value = period === 'day' ? day : period === 'week' ? week : period === 'month' ? month : start;
  const selection = barPeriodRange(period, value, end);
  let bounds: MovementBounds | null = null;
  if (selection.range) { try { bounds = movementBounds(selection.range, closeTime); } catch { /* Keep unverified settings out of the query. */ } }
  const dateError = periodProblemLabel(selection.problem, text) || (selection.range && !bounds ? text('Business-day settings could not be verified.', 'Tetapan hari perniagaan tidak dapat disahkan.') : '');
  const scope = JSON.stringify([selection.range?.from, selection.range?.to, closeTime]);
  const failed = failedScope === scope;

  async function refresh(background = false) {
    const ticket = ++generation.current;
    if (!bounds) { setLoading(false); return; }
    if (!background) setLoading(true);
    try {
      let rows: StockMovement[];
      if (isSupabaseConfigured) {
        const current = bounds;
        rows = await readBarMovements(current, (from, to) => supabase.from('stock_movements').select('*, products(name)')
          .gte('created_at', current.startIso).lt('created_at', current.endIso)
          .order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, to));
      } else {
        const from = Date.parse(bounds.startIso), to = Date.parse(bounds.endIso);
        rows = checkedMovements(loadLocalStockMovements().filter(row => {
          const stamp = Date.parse(row.created_at); return !Number.isFinite(stamp) || (stamp >= from && stamp < to);
        }), bounds).slice().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id));
      }
      if (ticket !== generation.current) return;
      setMovements(rows); setVerifiedScope(scope); setFailedScope(null);
    } catch { if (ticket === generation.current) setFailedScope(scope); }
    finally { if (ticket === generation.current) setLoading(false); }
  }

  useEffect(() => { void refresh(); return () => { generation.current++; }; }, [scope]);
  useSharedRefresh(() => refresh(true), { tables: ['stock_movements', 'products'], intervalMs: 15000, enabled: !!bounds });
  const readable = !!bounds && !failed && !loading && verifiedScope === scope;
  const filtered = readable ? movements.filter(row => (type === 'all' || row.movement_type === type) && movementMatches(row, query)) : [];
  const filterScope = JSON.stringify([scope, type, query.trim().toLocaleLowerCase()]);
  const [windowState, setWindowState] = useState({ key: '', count: 50 });
  const limit = windowState.key === filterScope ? windowState.count : 50;
  const visible = filtered.slice(0, limit);
  const resetWindow = () => setWindowState({ key: '', count: 50 });

  function shift(direction: -1 | 1) {
    if (period === 'custom') return;
    const next = shiftBarPeriod(period, value, direction);
    if (!next) return;
    resetWindow();
    if (period === 'day') setDay(next); else if (period === 'week') setWeek(next); else setMonth(next);
  }
  const kind = (row: StockMovement) => <span className="inline-block max-w-full rounded bg-shell px-1.5 py-0.5 text-xs font-semibold">{movementLabel(row.movement_type, text)}</span>;
  const change = (row: StockMovement) => <span className={row.quantity_change === 0 ? 'font-semibold' : row.quantity_change < 0 ? 'font-semibold text-coral' : 'font-semibold text-accent'}>{row.quantity_change > 0 ? '+' : ''}{row.quantity_change}</span>;
  const name = (row: StockMovement) => row.products?.name?.trim() || text('Product Unavailable', 'Produk Tidak Tersedia');
  const actor = (row: StockMovement) => row.entered_by?.trim() || text('Not Recorded', 'Tidak Direkod');
  const inputCaption = (row: StockMovement) => row.movement_type === 'stock_in' ? text('Received As', 'Diterima Sebagai') : text('Input', 'Input');
  const notes = (row: StockMovement) => <>{movementNotes(row).map(note => <p className="mt-1 [overflow-wrap:anywhere]" key={note}>{note}</p>)}{row.reference_id ? <p className="mt-1 text-xs text-muted [overflow-wrap:anywhere]">{text('Reference', 'Rujukan')}: {row.reference_id}</p> : null}</>;
  const stamp = (row: StockMovement) => {
    const business = movementBusinessDate(row, closeTime);
    return <><time dateTime={row.created_at}>{movementTime(row, language)} MYT</time>{business.crossesMidnight ? <span className="mt-0.5 block text-xs text-muted">{text('Business Date', 'Tarikh Perniagaan')}: {business.date}</span> : null}</>;
  };

  return <div className="bar-movement-history">
    <PageHeader title={text('Movement History', 'Sejarah Pergerakan')} actions={<><Link className={secondaryButtonClass} to="/inventory"><ArrowLeft size={16} />{text('Stock Hub', 'Hab Stok')}</Link><button className={iconButtonClass} disabled={loading} aria-label={text('Refresh History', 'Muat Semula Sejarah')} title={text('Refresh History', 'Muat Semula Sejarah')} onClick={() => void refresh()}><RefreshCw size={16} /></button></>} />
    <p className="mb-1 text-xs text-muted">{text('Business Date', 'Tarikh Perniagaan')} · MYT</p>
    <BarPeriodControl period={period} onPeriod={next => { setPeriod(next); resetWindow(); }} value={value}
      onValue={next => { if (period === 'day') setDay(next); else if (period === 'week') setWeek(next); else setMonth(next); resetWindow(); }}
      onShift={shift} error={dateError}
      previousDisabled={period !== 'custom' && !shiftBarPeriod(period, value, -1)} nextDisabled={period !== 'custom' && !shiftBarPeriod(period, value, 1)}
      custom={{ start, end, onStart: next => { setStart(next); resetWindow(); }, onEnd: next => { setEnd(next); resetWindow(); } }} />
    <div className="bar-movement-toolbar mb-3">
      <ViewChoices className="bar-movement-types" label={text('Movement Type', 'Jenis Pergerakan')} value={type} onChange={next => { setType(next as typeof type); resetWindow(); }}
        items={[{ value: 'all', label: text('All', 'Semua') }, ...movementTypes.map(value => ({ value, label: movementLabel(value, text) }))]} />
      <div className="relative min-w-0"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input className={inputClass + ' pl-9 pr-11'} type="search" aria-label={text('Search History', 'Cari Sejarah')} placeholder={text('Product, name or reference', 'Produk, nama atau rujukan')} value={query} onChange={event => { setQuery(event.target.value); resetWindow(); }} />{query ? <button type="button" className="ui-icon absolute right-0 top-1/2 -translate-y-1/2 text-muted" aria-label={text('Clear Search', 'Padam Carian')} title={text('Clear Search', 'Padam Carian')} onClick={() => { setQuery(''); resetWindow(); }}><X size={16} /></button> : null}</div>
    </div>
    {!dateError && failed && !loading ? <div role="alert" className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-danger/30 p-3 text-sm text-danger"><span>{text('Movement records could not be verified. Refresh before using these balances.', 'Rekod pergerakan tidak dapat disahkan. Muat semula sebelum menggunakan baki ini.')}</span><button className={secondaryButtonClass} onClick={() => void refresh()}><RefreshCw size={16} />{text('Retry', 'Cuba Lagi')}</button></div> : null}
    {!dateError && !readable && (loading || !failed) ? <p role="status" className="py-4 text-sm text-muted">{text('Checking Movements...', 'Menyemak Pergerakan...')}</p> : null}
    {readable ? <>
      <p className="mb-2 text-xs text-muted" role="status">{text('Showing', 'Memaparkan')} {visible.length} {text('of', 'daripada')} {filtered.length} {text('Records', 'Rekod')}</p>
      <div className="bar-movement-mobile">
        {visible.map(row => <article key={row.id} data-movement-id={row.id} className="min-w-0 border-b border-line py-3 first:pt-1">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2"><div className="min-w-0"><p className="text-sm font-semibold [overflow-wrap:anywhere]">{name(row)}</p><p className="mt-1 text-xs text-muted">{stamp(row)}</p></div>{kind(row)}</div>
          <dl className="my-3 grid grid-cols-3 gap-2 text-sm"><div><dt className="text-xs text-muted">{text('Before (Units)', 'Sebelum (Unit)')}</dt><dd className="mt-1 font-semibold">{row.quantity_before}</dd></div><div><dt className="text-xs text-muted">{text('Change (Units)', 'Perubahan (Unit)')}</dt><dd className="mt-1">{change(row)}</dd></div><div><dt className="text-xs text-muted">{text('After (Units)', 'Selepas (Unit)')}</dt><dd className="mt-1 font-semibold">{row.quantity_after}</dd></div></dl>
          <div className="text-xs text-muted [overflow-wrap:anywhere]"><p>{text('Entered By', 'Diisi Oleh')}: {actor(row)}</p>{movementInputLabel(row, text) !== '-' ? <p className="mt-1">{inputCaption(row)}: {movementInputLabel(row, text)}</p> : null}</div>
          <div className="mt-2 text-sm">{notes(row)}</div>
        </article>)}
      </div>
      <div className="bar-movement-desktop clean-scroll overflow-x-auto rounded-lg border border-line">
        <table className="dense-table w-full min-w-[1000px] table-fixed text-left text-sm"><thead className="bg-shell text-xs text-muted"><tr>
          <th className="w-[17%] p-3">{text('Time (MYT)', 'Masa (MYT)')}</th><th className="w-[17%] p-3">{text('Product', 'Produk')}</th><th className="w-[10%] p-3">{text('Type', 'Jenis')}</th><th className="w-[8%] p-3">{text('Change (Units)', 'Perubahan (Unit)')}</th><th className="w-[8%] p-3">{text('Before (Units)', 'Sebelum (Unit)')}</th><th className="w-[8%] p-3">{text('After (Units)', 'Selepas (Unit)')}</th><th className="w-[12%] p-3">{text('Entered By', 'Diisi Oleh')}</th><th className="w-[20%] p-3">{text('Details', 'Butiran')}</th>
        </tr></thead><tbody>{visible.map(row => <tr key={row.id} data-movement-id={row.id} className="border-t border-line align-top"><td className="p-3 text-xs">{stamp(row)}</td><td className="p-3 font-semibold [overflow-wrap:anywhere]">{name(row)}</td><td className="p-3">{kind(row)}</td><td className="p-3">{change(row)}</td><td className="p-3">{row.quantity_before}</td><td className="p-3">{row.quantity_after}</td><td className="p-3 [overflow-wrap:anywhere]">{actor(row)}</td><td className="p-3 text-xs">{movementInputLabel(row, text) !== '-' ? <p>{inputCaption(row)}: {movementInputLabel(row, text)}</p> : null}{notes(row)}</td></tr>)}</tbody></table>
      </div>
      {!filtered.length ? <p className="py-5 text-sm text-muted">{movements.length ? text('No matching movements.', 'Tiada pergerakan sepadan.') : text('No movements for this period.', 'Tiada pergerakan untuk tempoh ini.')}</p> : null}
      {visible.length < filtered.length ? <button className={secondaryButtonClass + ' mt-3 w-full sm:w-auto'} onClick={() => setWindowState({ key: filterScope, count: limit + 50 })}><ChevronDown size={16} />{text('Show More', 'Lihat Lagi')}</button> : null}
    </> : null}
  </div>;
}
