import { useEffect, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ChevronDown, RefreshCw, Search, X } from 'lucide-react';
import { BarPeriodControl } from './BarPeriodControl';
import { ViewChoices } from './ViewChoices';
import { iconButtonClass, inputClass, secondaryButtonClass } from './Form';
import { useLanguage } from '../lib/language';
import { useAccess } from '../lib/access';
import { useSharedRefresh } from '../lib/useSharedRefresh';
import { loadLocalProductPriceHistory } from '../lib/localStore';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { malaysiaDateInputValue, money } from '../lib/format';
import { barPeriodRange, periodProblemLabel, shiftBarPeriod, type BarPeriod } from '../lib/barReportPeriod';
import { checkedPriceHistory, priceChanges, priceHistoryBounds, priceHistoryMatches, priceHistoryTime, readPriceHistory } from '../lib/barPriceHistory';
import type { ProductPriceHistory, SettingsMap } from '../lib/types';

export function PriceHistory({ settings }: { settings: SettingsMap }) {
  const { text, language } = useLanguage(), { profile } = useAccess();
  const today = malaysiaDateInputValue(new Date());
  const [period, setPeriod] = useState<BarPeriod>('month');
  const [day, setDay] = useState(today), [week, setWeek] = useState(() => format(parseISO(today), "RRRR-'W'II")), [month, setMonth] = useState(today.slice(0, 7));
  const [start, setStart] = useState(today), [end, setEnd] = useState(today);
  const [type, setType] = useState<'all' | 'price' | 'cost'>('all'), [query, setQuery] = useState('');
  const [rows, setRows] = useState<ProductPriceHistory[]>([]), [loading, setLoading] = useState(true);
  const [verifiedScope, setVerifiedScope] = useState(''), [failedScope, setFailedScope] = useState<string | null>(null);
  const generation = useRef(0);
  const value = period === 'day' ? day : period === 'week' ? week : period === 'month' ? month : start;
  const selected = barPeriodRange(period, value, end);
  let bounds: ReturnType<typeof priceHistoryBounds> | null = null;
  if (selected.range) { try { bounds = priceHistoryBounds(selected.range); } catch { /* Invalid calendar edges cannot be queried. */ } }
  const error = periodProblemLabel(selected.problem, text) || (selected.range && !bounds ? text('Choose a supported calendar date.', 'Pilih tarikh kalendar yang disokong.') : '');
  const scope = JSON.stringify([profile?.id, bounds?.startIso, bounds?.endIso]);
  const currentScope = useRef(scope); currentScope.current = scope;
  const failed = failedScope === scope, readable = !!bounds && !loading && !failed && verifiedScope === scope;
  async function refresh(background = false) {
    const ticket = ++generation.current;
    if (!bounds) { setLoading(false); return; }
    if (!background) setLoading(true);
    try {
      const current = bounds;
      const data = isSupabaseConfigured ? await readPriceHistory(current, (from, to) => supabase.from('product_price_history').select('*, profiles(full_name)')
        .gte('changed_at', current.startIso).lt('changed_at', current.endIso).order('changed_at', { ascending: false }).order('id', { ascending: false }).range(from, to))
        : checkedPriceHistory(loadLocalProductPriceHistory().filter(row => { const stamp = Date.parse(row.changed_at); return !Number.isFinite(stamp) || stamp >= Date.parse(current.startIso) && stamp < Date.parse(current.endIso); }), current)
          .sort((a, b) => Date.parse(b.changed_at) - Date.parse(a.changed_at) || b.id.localeCompare(a.id));
      if (ticket !== generation.current || currentScope.current !== scope) return;
      setRows(data); setVerifiedScope(scope); setFailedScope(null);
    } catch { if (ticket === generation.current && currentScope.current === scope) setFailedScope(scope); }
    finally { if (ticket === generation.current && currentScope.current === scope) setLoading(false); }
  }
  useEffect(() => { void refresh(); return () => { generation.current++; }; }, [scope]);
  useSharedRefresh(() => refresh(true), { tables: ['product_price_history'], intervalMs: 20000, enabled: !!bounds });
  const filtered = readable ? rows.filter(row => (type === 'all' || priceChanges(row)[type]) && priceHistoryMatches(row, query)) : [];
  const filterScope = JSON.stringify([scope, type, query]);
  const [windowState, setWindowState] = useState({ key: '', count: 50 });
  const limit = windowState.key === filterScope ? windowState.count : 50, visible = filtered.slice(0, limit);
  function change(action: () => void) { setWindowState({ key: '', count: 50 }); action(); }
  function shift(direction: -1 | 1) {
    if (period === 'custom') return;
    const next = shiftBarPeriod(period, value, direction);
    if (next) change(() => { if (period === 'day') setDay(next); else if (period === 'week') setWeek(next); else setMonth(next); });
  }
  const price = (amount: number | null) => amount === null ? text('Not Recorded', 'Tidak Direkod') : money(amount, String(settings.currency_symbol));
  const name = (row: ProductPriceHistory) => row.product_name.trim() || text('Product Name Not Recorded', 'Nama Produk Tidak Direkod');
  const actor = (row: ProductPriceHistory) => <div className="text-xs text-muted [overflow-wrap:anywhere]">{text('Changed By', 'Diubah Oleh')}: {row.changed_by ? row.profiles?.full_name?.trim() || text('Name Unavailable', 'Nama Tidak Tersedia') : text('Not Recorded', 'Tidak Direkod')}{row.changed_by && !row.profiles?.full_name?.trim() ? <span className="block">{text('Account', 'Akaun')}: {row.changed_by}</span> : null}</div>;
  const values = (row: ProductPriceHistory) => <div role="table" aria-label={text('Per Unit', 'Setiap Unit')} className="bar-price-values text-sm"><div role="row" className="contents"><span role="columnheader" className="text-xs text-muted">{text('Per Unit', 'Setiap Unit')}</span><span role="columnheader" className="text-right text-xs text-muted">{text('Before', 'Sebelum')}</span><span role="columnheader" className="text-right text-xs text-muted">{text('After', 'Selepas')}</span></div>
    {(['price', 'cost'] as const).filter(kind => priceChanges(row)[kind]).map(kind => <div key={kind} role="row" className="contents"><span role="rowheader" className="text-muted">{kind === 'price' ? text('Selling Price', 'Harga Jualan') : text('Cost', 'Kos')}</span><span role="cell" className="text-right tabular-nums">{price(kind === 'price' ? row.old_price_per_unit : row.old_cost_per_unit)}</span><span role="cell" className="text-right font-semibold tabular-nums">{price(kind === 'price' ? row.new_price_per_unit : row.new_cost_per_unit)}</span></div>)}
  </div>;
  return <section className="bar-price-history" aria-label={text('Price History', 'Sejarah Harga')}>
    <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-base font-semibold">{text('Price History', 'Sejarah Harga')}</h2><button className={iconButtonClass} disabled={loading || !bounds} aria-label={text('Refresh Price History', 'Muat Semula Sejarah Harga')} title={text('Refresh Price History', 'Muat Semula Sejarah Harga')} onClick={() => void refresh()}><RefreshCw size={16} /></button></div>
    <p className="mb-1 text-xs text-muted">{text('Change Date', 'Tarikh Perubahan')} · MYT</p>
    <BarPeriodControl period={period} value={value} onPeriod={next => change(() => setPeriod(next))} onValue={next => change(() => { if (period === 'day') setDay(next); else if (period === 'week') setWeek(next); else setMonth(next); })} onShift={shift} error={error}
      previousDisabled={period !== 'custom' && !shiftBarPeriod(period, value, -1)} nextDisabled={period !== 'custom' && !shiftBarPeriod(period, value, 1)}
      custom={{ start, end, onStart: next => change(() => setStart(next)), onEnd: next => change(() => setEnd(next)) }} />
    <div className="bar-price-toolbar mb-3"><ViewChoices className="bar-price-types" label={text('Change Type', 'Jenis Perubahan')} value={type} onChange={next => change(() => setType(next as typeof type))} items={[{ value: 'all', label: text('All', 'Semua') }, { value: 'price', label: text('Selling Price', 'Harga Jualan') }, { value: 'cost', label: text('Cost', 'Kos') }]} />
      <div className="relative min-w-0"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input type="search" className={inputClass + ' pl-9 pr-11'} aria-label={text('Search Price History', 'Cari Sejarah Harga')} placeholder={text('Product, editor or reference', 'Produk, penyunting atau rujukan')} value={query} onChange={event => change(() => setQuery(event.target.value))} />{query ? <button className="ui-icon absolute right-0 top-1/2 -translate-y-1/2 text-muted" aria-label={text('Clear Search', 'Padam Carian')} title={text('Clear Search', 'Padam Carian')} onClick={() => change(() => setQuery(''))}><X size={16} /></button> : null}</div>
    </div>
    {!error && failed && !loading ? <div role="alert" className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-danger/30 p-3 text-sm text-danger"><span>{text('Price changes could not be verified. Refresh before using these figures.', 'Perubahan harga tidak dapat disahkan. Muat semula sebelum menggunakan angka ini.')}</span><button className={secondaryButtonClass} onClick={() => void refresh()}><RefreshCw size={16} />{text('Retry', 'Cuba Lagi')}</button></div> : null}
    {!error && !readable && (loading || !failed) ? <p role="status" className="py-4 text-sm text-muted">{text('Checking Price Changes...', 'Menyemak Perubahan Harga...')}</p> : null}
    {readable ? <>
      <p role="status" className="mb-2 text-xs text-muted">{text('Showing', 'Memaparkan')} {visible.length} {text('of', 'daripada')} {filtered.length} {text('Changes', 'Perubahan')}</p>
      <div className="bar-price-mobile">{visible.map(row => <article key={row.id} data-price-change={row.id} className="min-w-0 border-b border-line py-3 first:pt-1"><p className="text-sm font-semibold [overflow-wrap:anywhere]">{name(row)}</p><time className="mt-1 block text-xs text-muted" dateTime={row.changed_at}>{priceHistoryTime(row, language)} MYT</time><div className="mt-1">{actor(row)}</div><div className="mt-3">{values(row)}</div></article>)}</div>
      <div className="bar-price-desktop clean-scroll overflow-x-auto rounded-lg border border-line"><table className="dense-table w-full min-w-[800px] table-fixed text-left text-sm"><thead className="bg-shell text-xs text-muted"><tr><th className="w-[25%] p-3">{text('Time (MYT)', 'Masa (MYT)')}</th><th className="w-[30%] p-3">{text('Recorded Product Name', 'Nama Produk Direkod')}</th><th className="w-[45%] p-3">{text('Changes', 'Perubahan')}</th></tr></thead><tbody>{visible.map(row => <tr key={row.id} data-price-change={row.id} className="border-t border-line align-top"><td className="p-3"><time className="text-xs text-muted" dateTime={row.changed_at}>{priceHistoryTime(row, language)} MYT</time><div className="mt-2">{actor(row)}</div></td><td className="p-3 font-semibold [overflow-wrap:anywhere]">{name(row)}</td><td className="p-3">{values(row)}</td></tr>)}</tbody></table></div>
      {!filtered.length ? <p className="py-5 text-sm text-muted">{rows.length ? text('No matching price changes.', 'Tiada perubahan harga sepadan.') : text('No price changes for this period.', 'Tiada perubahan harga untuk tempoh ini.')}</p> : null}
      {visible.length < filtered.length ? <button className={secondaryButtonClass + ' mt-3 w-full sm:w-auto'} onClick={() => setWindowState({ key: filterScope, count: limit + 50 })}><ChevronDown size={16} />{text('Show More', 'Lihat Lagi')}</button> : null}
    </> : null}
  </section>;
}
