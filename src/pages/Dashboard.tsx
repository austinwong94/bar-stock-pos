import { useEffect, useRef, useState } from 'react';
import { addDays, addMonths, addWeeks, endOfMonth, format, startOfWeek } from 'date-fns';
import { AlertTriangle, PackageCheck, RefreshCw } from 'lucide-react';
import { Badge, PageHeader } from '../components/Page';
import { WorkflowHelp } from '../components/WorkflowHelp';
import { loadProducts } from '../lib/data';
import { loadLocalRecipeIngredients, loadLocalSaleItems, loadLocalSales } from '../lib/localStore';
import { malaysiaBusinessDateInputValue, money } from '../lib/format';
import { supabase } from '../lib/supabase';
import { isSupabaseConfigured } from '../lib/supabase';
import type { ProductWithStock, SettingsMap } from '../lib/types';
import { useLanguage } from '../lib/language';
import { useSharedRefresh } from '../lib/useSharedRefresh';
import { BarPeriodControl } from '../components/BarPeriodControl';
import { iconButtonClass } from '../components/Form';

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
  const [products, setProducts] = useState<ProductWithStock[]>([]);
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day');
  const [selectedDate, setSelectedDate] = useState(() => businessToday);
  const [selectedWeek, setSelectedWeek] = useState(() => format(new Date(businessToday + 'T00:00:00'), "RRRR-'W'II"));
  const [selectedMonth, setSelectedMonth] = useState(() => businessToday.slice(0, 7));
  const [totals, setTotals] = useState({ cash: 0, qr: 0, focCost: 0, tx: 0, paidRevenue: 0 });
  const [stockOutTodayByProduct, setStockOutTodayByProduct] = useState<Record<string, number>>({});
  const { text } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [recipeIds, setRecipeIds] = useState<Set<string>>(new Set());
  const generation = useRef(0);

  async function refreshDashboard() {
    const ticket = ++generation.current;
    try {
      const loadedProducts = await loadProducts(true);
      const recipes = isSupabaseConfigured
        ? await supabase.from('recipe_ingredients').select('product_id')
        : { data: loadLocalRecipeIngredients(), error: null };
      if (recipes.error) throw recipes.error;
      if (isSupabaseConfigured) {
        const from = period === 'day' ? selectedDate : period === 'week' ? format(weekStartFromInput(selectedWeek), 'yyyy-MM-dd') : `${selectedMonth}-01`;
        const to = period === 'day' ? from : period === 'week' ? format(addDays(weekStartFromInput(selectedWeek), 6), 'yyyy-MM-dd') : format(endOfMonth(new Date(`${from}T00:00:00`)), 'yyyy-MM-dd');
        const { data, error: readError } = await supabase.rpc('read_bar_overview', { p_from: from, p_to: to, p_today: businessToday });
        if (readError) throw readError;
        if (!data?.totals || !data.soldToday) throw new Error('Overview response was incomplete.');
        if (ticket !== generation.current) return;
        setProducts(loadedProducts);
        setRecipeIds(new Set((recipes.data ?? []).map((row: { product_id: string }) => row.product_id)));
        setTotals(data.totals);
        setStockOutTodayByProduct(data.soldToday);
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
      setProducts(loadedProducts);
      setRecipeIds(new Set((recipes.data ?? []).map((row: { product_id: string }) => row.product_id)));
      setStockOutTodayByProduct(nextStockOutToday);
      setTotals(
        filteredSales.reduce(
          (sum: { cash: number; qr: number; focCost: number; tx: number; paidRevenue: number }, sale) => ({
            cash: sum.cash + (sale.payment_method === 'cash' ? Number(sale.paid_amount) : 0),
            qr: sum.qr + (sale.payment_method === 'qr' ? Number(sale.paid_amount) : 0),
            focCost: sum.focCost + (sale.payment_method === 'complimentary' ? Number(sale.total_amount) : 0),
            paidRevenue: sum.paidRevenue + (sale.payment_method === 'complimentary' ? 0 : Number(sale.paid_amount)),
            tx: sum.tx + 1,
          }),
          { cash: 0, qr: 0, focCost: 0, tx: 0, paidRevenue: 0 },
        ),
      );
      setError('');
    } catch {
      if (ticket === generation.current) setError(text('Could not refresh sales. Do not use these figures until refresh succeeds.', 'Jualan tidak dapat dikemas kini. Jangan guna angka ini sehingga muat semula berjaya.'));
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    void refreshDashboard();
    return () => { generation.current++; };
  }, [period, selectedDate, selectedWeek, selectedMonth, businessToday, settings.business_day_close_time]);

  useSharedRefresh(refreshDashboard, {
    tables: ['sales', 'sale_items', 'products', 'inventory_balances', 'daily_reports', 'stock_movements'],
    intervalMs: 15000,
  });

  const lowStock = products.filter(
    (product) =>
      product.active && !recipeIds.has(product.id) && product.categories?.name !== 'Cocktail' &&
      (product.inventory_balances?.quantity_on_hand ?? 0) <= product.low_stock_threshold,
  );
  const activeProducts = products.filter((product) => product.active);
  const totalUnits = activeProducts.filter(product => !recipeIds.has(product.id) && product.categories?.name !== 'Cocktail').reduce((sum, product) => sum + (product.inventory_balances?.quantity_on_hand ?? 0), 0);
  const selectedDateObject = new Date(`${selectedDate}T00:00:00`);
  const selectedDayLabel = format(selectedDateObject, 'EEE, d MMM yyyy');
  const selectedWeekStart = weekStartFromInput(selectedWeek);
  const selectedWeekEnd = addDays(selectedWeekStart, 6);
  const selectedWeekLabel = `${format(selectedWeekStart, 'd MMM yyyy')} - ${format(selectedWeekEnd, 'd MMM yyyy')}`;
  const periodTitle = period === 'day' ? selectedDayLabel : period === 'week' ? selectedWeekLabel : format(new Date(`${selectedMonth}-01T00:00:00`), 'MMMM yyyy');

  function shiftPeriod(direction: -1 | 1) {
    if (period === 'day') {
      setSelectedDate(format(addDays(selectedDateObject, direction), 'yyyy-MM-dd'));
      return;
    }
    if (period === 'week') {
      setSelectedWeek(format(addWeeks(selectedWeekStart, direction), "RRRR-'W'II"));
      return;
    }
    setSelectedMonth(format(addMonths(new Date(`${selectedMonth}-01T00:00:00`), direction), 'yyyy-MM'));
  }

  return (
    <div className="bar-dashboard">
      <PageHeader title={text('Bar Overview', 'Ringkasan Bar')}
        actions={<><button type="button" className={iconButtonClass} aria-label={text('Refresh Overview', 'Muat Semula Ringkasan')} title={text('Refresh', 'Muat Semula')} onClick={() => void refreshDashboard()}><RefreshCw size={16} /></button><WorkflowHelp area="bar" /></>} />
      <BarPeriodControl period={period} onPeriod={setPeriod}
        value={period === 'day' ? selectedDate : period === 'week' ? selectedWeek : selectedMonth}
        onValue={value => { if (period === 'day') setSelectedDate(value); else if (period === 'week') setSelectedWeek(value); else setSelectedMonth(value); }}
        onShift={shiftPeriod} />
      {error ? <p role="alert" className="bar-notice">{error}</p> : null}
      <section className="bar-revenue" aria-busy={loading}>
        <div>
          <p className="bar-caption">{periodTitle}</p>
          <p className="bar-revenue-label">{text('Total Revenue', 'Jumlah Hasil')}</p>
          <p className="bar-revenue-value">{loading ? '...' : money(totals.paidRevenue, String(settings.currency_symbol))}</p>
        </div>
        <dl className="bar-revenue-breakdown">
          {[
            [text('Cash', 'Tunai'), money(totals.cash, String(settings.currency_symbol))],
            [text('QR Payment', 'Bayaran QR'), money(totals.qr, String(settings.currency_symbol))],
            [text('FOC Value', 'Nilai FOC'), money(totals.focCost, String(settings.currency_symbol))],
            [text('Transactions', 'Transaksi'), totals.tx],
          ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{loading ? '...' : value}</dd></div>)}
        </dl>
      </section>
      <section className="bar-stock-section" aria-label={text('Stock Hub', 'Hab Stok')}>
        <header className="bar-section-heading">
          <h2><PackageCheck size={18} />{text('Stock Hub', 'Hab Stok')}</h2>
          <dl className="bar-inline-stats">
            <div><dt>{text('Products', 'Produk')}</dt><dd>{activeProducts.length}</dd></div>
            <div><dt>{text('Units', 'Unit')}</dt><dd>{totalUnits}</dd></div>
            <div><dt>{text('Low Stock', 'Stok Rendah')}</dt><dd className={lowStock.length ? 'text-warning' : ''}>{lowStock.length}</dd></div>
          </dl>
        </header>
        <table className="bar-stock-table">
          <thead><tr>
            <th>{text('Product', 'Produk')}</th>
            <th>{text('Sold Today', 'Jual Hari Ini')}</th>
            <th>{text('Balance', 'Baki')}</th>
            <th>{text('Status', 'Status')}</th>
          </tr></thead>
          <tbody>
            {activeProducts.map(product => {
              const recipe = recipeIds.has(product.id) || product.categories?.name === 'Cocktail';
              const stock = product.inventory_balances?.quantity_on_hand ?? 0;
              const low = !recipe && stock <= product.low_stock_threshold;
              return <tr key={product.id}>
                <td><strong>{product.name}</strong><span className="bar-caption">{product.categories?.name ?? text('Other', 'Lain')}</span></td>
                <td>{stockOutTodayByProduct[product.id] ?? 0}</td>
                <td>{recipe ? <span className="bar-caption">{text('Ingredients', 'Bahan')}</span> : <>{stock}<span className="bar-unit"> {text('units', 'unit')}</span></>}</td>
                <td><Badge tone={low ? 'warn' : 'neutral'}>{recipe ? text('Recipe', 'Resipi') : low ? text('Low', 'Rendah') : 'OK'}</Badge></td>
              </tr>;
            })}
            {!activeProducts.length ? <tr><td colSpan={4}>{loading ? text('Loading stock...', 'Memuatkan stok...') : text('No products yet.', 'Belum ada produk.')}</td></tr> : null}
          </tbody>
        </table>
        {lowStock.length > 0 ? <p className="bar-stock-warning"><AlertTriangle size={16} /><span>{lowStock.map(product => product.name).join(', ')} · {text('Low Stock', 'Stok Rendah')}</span></p> : null}
      </section>
    </div>
  );
}

function weekStartFromInput(value: string) {
  const [yearText, weekText] = value.split('-W');
  const year = Number(yearText);
  const week = Number(weekText);
  const weekOne = startOfWeek(new Date(year, 0, 4), { weekStartsOn: 1 });
  return addWeeks(weekOne, Math.max(week - 1, 0));
}
