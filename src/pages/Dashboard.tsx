import { useEffect, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { AlertTriangle, PackageCheck, RefreshCw } from 'lucide-react';
import { PageHeader } from '../components/Page';
import { WorkflowHelp } from '../components/WorkflowHelp';
import { loadProducts, loadRecipeProductIds } from '../lib/data';
import { loadLocalSaleItems, loadLocalSales } from '../lib/localStore';
import { malaysiaBusinessDateInputValue, money } from '../lib/format';
import { supabase } from '../lib/supabase';
import { isSupabaseConfigured } from '../lib/supabase';
import type { SettingsMap } from '../lib/types';
import { useLanguage } from '../lib/language';
import { useSharedRefresh } from '../lib/useSharedRefresh';
import { BarPeriodControl } from '../components/BarPeriodControl';
import { iconButtonClass, secondaryButtonClass } from '../components/Form';
import { barCategoryLabel, barStockRows, overviewMoneyCents, readBarOverview, stockStatusLabel, stockViewSummary, type StockViewRow } from '../lib/barStockView';
import { barPeriodRange, periodProblemLabel, shiftBarPeriod } from '../lib/barReportPeriod';

type DashboardSale = {
  payment_method: string;
  total_amount: number;
  paid_amount: number;
  business_date?: string;
  created_at?: string;
  sale_items?: Array<{ product_id: string | null; quantity: number }>;
};

export default function Dashboard({ settings }: { settings: SettingsMap }) {
  const businessToday = malaysiaBusinessDateInputValue(new Date(), settings.business_day_close_time);
  const [stockRows, setStockRows] = useState<StockViewRow[]>([]);
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day');
  const [selectedDate, setSelectedDate] = useState(() => businessToday);
  const [selectedWeek, setSelectedWeek] = useState(() => format(new Date(businessToday + 'T00:00:00'), "RRRR-'W'II"));
  const [selectedMonth, setSelectedMonth] = useState(() => businessToday.slice(0, 7));
  const [totals, setTotals] = useState({ cash: 0, qr: 0, focCost: 0, tx: 0, paidRevenue: 0 });
  const [stockOutTodayByProduct, setStockOutTodayByProduct] = useState<Record<string, number>>({});
  const { text, language } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const scope = JSON.stringify([period, selectedDate, selectedWeek, selectedMonth, businessToday, settings.business_day_close_time]);
  const [verifiedScope, setVerifiedScope] = useState<string | null>(null);
  const generation = useRef(0);
  const periodValue = period === 'day' ? selectedDate : period === 'week' ? selectedWeek : selectedMonth;
  const selection = barPeriodRange(period, periodValue);

  async function refreshDashboard(background = false) {
    const ticket = ++generation.current;
    if (!selection.range) { setLoading(false); return; }
    if (!background) setLoading(true);
    try {
      const [loadedProducts, recipes] = await Promise.all([loadProducts(true), loadRecipeProductIds()]);
      const nextRows = barStockRows(loadedProducts, recipes);
      if (isSupabaseConfigured) {
        const { from, to } = selection.range;
        const { data, error: readError } = await supabase.rpc('read_bar_overview', { p_from: from, p_to: to, p_today: businessToday });
        if (readError) throw readError;
        const overview = readBarOverview(data);
        if (ticket !== generation.current) return;
        setStockRows(nextRows);
        setTotals(overview.totals);
        setStockOutTodayByProduct(overview.soldToday);
        setVerifiedScope(scope);
        setError('');
        return;
      }
      const sales: DashboardSale[] = loadLocalSales()
            .filter((sale) => sale.status === 'completed')
            .map((sale) => ({
              ...sale,
              sale_items: loadLocalSaleItems().filter((item) => item.sale_id === sale.id),
            }));
      const filteredSales = sales.filter((sale) => {
        const saleDate = sale.business_date ?? (sale.created_at ? malaysiaBusinessDateInputValue(sale.created_at, settings.business_day_close_time) : undefined);
        if (period === 'day') return saleDate === selectedDate;
        if (period === 'month') return saleDate?.startsWith(selectedMonth);
        return saleDate ? format(new Date(`${saleDate}T00:00:00`), "RRRR-'W'II") === selectedWeek : false;
      });
      const today = businessToday;
      const nextStockOutToday = sales
        .filter((sale) => (sale.business_date ?? (sale.created_at ? malaysiaBusinessDateInputValue(sale.created_at, settings.business_day_close_time) : undefined)) === today)
        .flatMap((sale) => sale.sale_items ?? [])
        .reduce<Record<string, number>>((sum, item) => {
          if (!item.product_id) return sum;
          sum[item.product_id] = (sum[item.product_id] ?? 0) + Number(item.quantity);
          return sum;
        }, {});
      if (ticket !== generation.current) return;
      const cents = filteredSales.reduce(
          (sum: { cash: number; qr: number; focCost: number; tx: number; paidRevenue: number }, sale) => ({
            cash: sum.cash + (sale.payment_method === 'cash' ? overviewMoneyCents(sale.paid_amount) : 0),
            qr: sum.qr + (sale.payment_method === 'qr' ? overviewMoneyCents(sale.paid_amount) : 0),
            focCost: sum.focCost + (sale.payment_method === 'complimentary' ? overviewMoneyCents(sale.total_amount) : 0),
            paidRevenue: sum.paidRevenue + (sale.payment_method === 'complimentary' ? 0 : overviewMoneyCents(sale.paid_amount)),
            tx: sum.tx + 1,
          }),
          { cash: 0, qr: 0, focCost: 0, tx: 0, paidRevenue: 0 },
        );
      const overview = readBarOverview({ totals: { cash: cents.cash / 100, qr: cents.qr / 100, focCost: cents.focCost / 100, paidRevenue: cents.paidRevenue / 100, tx: cents.tx }, soldToday: nextStockOutToday });
      setStockRows(nextRows); setTotals(overview.totals); setStockOutTodayByProduct(overview.soldToday); setVerifiedScope(scope);
      setError('');
    } catch {
      if (ticket === generation.current) setError(text('Overview could not be verified. Totals are hidden until refreshed.', 'Ringkasan tidak dapat disahkan. Jumlah disembunyikan sehingga dimuat semula.'));
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    void refreshDashboard();
    return () => { generation.current++; };
  }, [period, selectedDate, selectedWeek, selectedMonth, businessToday, settings.business_day_close_time]);

  useSharedRefresh(() => refreshDashboard(true), {
    tables: ['sales', 'sale_items', 'products', 'inventory_balances', 'daily_reports', 'stock_movements', 'recipe_ingredients'],
    intervalMs: 15000,
  });

  const readable = !!selection.range && !loading && !error && verifiedScope === scope;
  const lowStock = stockRows.filter(row => row.status === 'low');
  const activeRows = stockRows.filter(row => row.product.active);
  const stockSummary = stockViewSummary(stockRows);
  const placeholder = selection.range && (loading || verifiedScope !== scope) ? '...' : '-';
  const dateLabel = (value: string, monthOnly = false) => new Intl.DateTimeFormat(language === 'ms' ? 'ms-MY' : 'en-GB', monthOnly ? { month: 'long', year: 'numeric' } : { day: 'numeric', month: 'short', year: 'numeric', ...(period === 'day' ? { weekday: 'short' as const } : {}) }).format(parseISO(value));
  const periodTitle = !selection.range ? '-' : period === 'month' ? dateLabel(selection.range.from, true) : period === 'week' ? `${dateLabel(selection.range.from)} - ${dateLabel(selection.range.to)}` : dateLabel(selection.range.from);

  function shiftPeriod(direction: -1 | 1) {
    const next = shiftBarPeriod(period, periodValue, direction);
    if (!next) return;
    if (period === 'day') setSelectedDate(next);
    else if (period === 'week') setSelectedWeek(next);
    else setSelectedMonth(next);
  }

  return (
    <div className="bar-dashboard">
      <PageHeader title={text('Bar Overview', 'Ringkasan Bar')}
        actions={<><button type="button" className={iconButtonClass} disabled={loading} aria-label={text('Refresh Overview', 'Muat Semula Ringkasan')} title={text('Refresh', 'Muat Semula')} onClick={() => void refreshDashboard()}><RefreshCw size={16} /></button><WorkflowHelp area="bar" /></>} />
      <BarPeriodControl period={period} onPeriod={setPeriod}
        value={periodValue} error={periodProblemLabel(selection.problem, text)}
        previousDisabled={!shiftBarPeriod(period, periodValue, -1)} nextDisabled={!shiftBarPeriod(period, periodValue, 1)}
        onValue={value => { if (period === 'day') setSelectedDate(value); else if (period === 'week') setSelectedWeek(value); else setSelectedMonth(value); }}
        onShift={shiftPeriod} />
      {selection.range && error && !loading ? <div role="alert" className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-danger/30 p-3 text-sm text-danger"><span>{error}</span><button className={secondaryButtonClass} onClick={() => void refreshDashboard()}><RefreshCw size={16} />{text('Retry', 'Cuba Lagi')}</button></div> : null}
      <section className="bar-revenue" aria-busy={loading}>
        <div>
          <p className="bar-caption">{periodTitle}</p>
          <p className="bar-revenue-label">{text('Total Revenue', 'Jumlah Hasil')}</p>
          <p className="bar-revenue-value">{readable ? money(totals.paidRevenue, String(settings.currency_symbol)) : placeholder}</p>
        </div>
        <dl className="bar-revenue-breakdown">
          {[
            [text('Cash', 'Tunai'), money(totals.cash, String(settings.currency_symbol))],
            [text('QR Payment', 'Bayaran QR'), money(totals.qr, String(settings.currency_symbol))],
            [text('FOC Value', 'Nilai FOC'), money(totals.focCost, String(settings.currency_symbol))],
            [text('Transactions', 'Transaksi'), totals.tx],
          ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{readable ? value : placeholder}</dd></div>)}
        </dl>
      </section>
      <section className="bar-stock-section" aria-label={text('Stock Hub', 'Hab Stok')}>
        <header className="bar-section-heading">
          <h2><PackageCheck size={18} />{text('Stock Hub', 'Hab Stok')}</h2>
          <dl className="bar-inline-stats">
            <div><dt>{text('Products', 'Produk')}</dt><dd>{readable ? stockSummary.products : placeholder}</dd></div>
            <div><dt>{text('Units', 'Unit')}</dt><dd>{readable ? stockSummary.units ?? '-' : placeholder}</dd></div>
            <div><dt>{text('Low Stock', 'Stok Rendah')}</dt><dd className={readable && lowStock.length ? 'text-warning' : ''}>{readable ? stockSummary.low ?? '-' : placeholder}</dd></div>
          </dl>
        </header>
        <table className="bar-stock-table">
          <thead><tr>
            <th>{text('Product', 'Produk')}</th>
            <th>{text('Sold Today', 'Jual Hari Ini')}</th>
            <th>{text('Balance (Units)', 'Baki (Unit)')}</th>
            <th className="bar-stock-status-column">{text('Status', 'Status')}</th>
          </tr></thead>
          <tbody>
            {readable ? activeRows.map(row => {
              const product = row.product;
              return <tr key={product.id} data-overview-product={product.id}>
                <td><strong>{product.name}</strong><span className="bar-caption [overflow-wrap:anywhere]">{barCategoryLabel(product.categories?.name, text)}</span><span className={`bar-stock-mobile-status mt-1 rounded px-1 py-0.5 text-xs font-semibold leading-snug ${['low', 'unavailable', 'alert-unset', 'recipe-needed'].includes(row.status) ? 'bg-amber-100 text-warning' : 'bg-shell text-muted'}`}>{stockStatusLabel(row.status, text)}</span></td>
                <td>{stockOutTodayByProduct[product.id] ?? 0}</td>
                <td className="[overflow-wrap:anywhere]">{row.recipe ? <span className="bar-caption">{text('By Recipe', 'Ikut Resipi')}</span> : row.balance === null ? text('Not Available', 'Tidak Tersedia') : row.balance}</td>
                <td className="bar-stock-status-column"><span className={`inline-block max-w-full break-words rounded px-1 py-0.5 text-xs font-semibold leading-snug ${['low', 'unavailable', 'alert-unset', 'recipe-needed'].includes(row.status) ? 'bg-amber-100 text-warning' : 'bg-shell text-muted'}`}>{stockStatusLabel(row.status, text)}</span></td>
              </tr>;
            }) : null}
            {!readable || !activeRows.length ? <tr><td colSpan={4}>{!readable ? loading ? text('Checking Overview...', 'Menyemak Ringkasan...') : text('Stock figures unavailable.', 'Angka stok tidak tersedia.') : text('No products yet.', 'Belum ada produk.')}</td></tr> : null}
          </tbody>
        </table>
        {readable && stockSummary.unknown > 0 ? <p role="status" className="bar-notice">{text('Some stock balances or alerts are unavailable. Stock totals are not complete.', 'Sesetengah baki atau amaran stok tidak tersedia. Jumlah stok belum lengkap.')}</p> : null}
        {readable && lowStock.length > 0 ? <p className="bar-stock-warning"><AlertTriangle size={16} /><span className="min-w-0 [overflow-wrap:anywhere]">{lowStock.map(row => row.product.name).join(', ')} · {text('Low Stock', 'Stok Rendah')}</span></p> : null}
      </section>
    </div>
  );
}

