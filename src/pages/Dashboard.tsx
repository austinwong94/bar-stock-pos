import { useEffect, useState } from 'react';
import { addDays, addMonths, addWeeks, format, startOfWeek } from 'date-fns';
import { AlertTriangle, ChevronLeft, ChevronRight, PackageCheck, Sparkles } from 'lucide-react';
import { PageHeader } from '../components/Page';
import { loadProducts } from '../lib/data';
import { loadLocalSaleItems, loadLocalSales } from '../lib/localStore';
import { cansAndCartons, dualMoney, malaysiaDateInputValue, money } from '../lib/format';
import { supabase } from '../lib/supabase';
import { isSupabaseConfigured } from '../lib/supabase';
import type { ProductWithStock, SettingsMap } from '../lib/types';
import { useLanguage } from '../lib/language';

type DashboardSale = {
  payment_method: string;
  total_amount: number;
  paid_amount: number;
  business_date?: string;
  created_at?: string;
  sale_items?: Array<{ product_id: string | null; quantity: number }>;
};

export default function Dashboard({ settings }: { settings: SettingsMap }) {
  const [products, setProducts] = useState<ProductWithStock[]>([]);
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day');
  const [selectedDate, setSelectedDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [selectedWeek, setSelectedWeek] = useState(() => format(new Date(), "RRRR-'W'II"));
  const [selectedMonth, setSelectedMonth] = useState(() => format(new Date(), 'yyyy-MM'));
  const [totals, setTotals] = useState({ cash: 0, qr: 0, focCost: 0, tx: 0, paidRevenue: 0 });
  const [soldTodayByProduct, setSoldTodayByProduct] = useState<Record<string, number>>({});
  const { text } = useLanguage();

  useEffect(() => {
    async function load() {
      const loadedProducts = await loadProducts(true);
      const sales = isSupabaseConfigured
        ? (((await supabase
            .from('sales')
            .select('payment_method,total_amount,paid_amount,business_date,created_at,sale_items(product_id,quantity)')
            .eq('status', 'completed')).data ?? []) as DashboardSale[])
        : loadLocalSales()
            .filter((sale) => sale.status === 'completed')
            .map((sale) => ({
              ...sale,
              sale_items: loadLocalSaleItems().filter((item) => item.sale_id === sale.id),
            }));
      const filteredSales = sales.filter((sale) => {
        const saleDate = sale.created_at ? malaysiaDateInputValue(sale.created_at) : sale.business_date;
        if (period === 'day') return saleDate === selectedDate;
        if (period === 'month') return saleDate?.startsWith(selectedMonth);
        return saleDate ? format(new Date(`${saleDate}T00:00:00`), "RRRR-'W'II") === selectedWeek : false;
      });
      const today = malaysiaDateInputValue(new Date());
      const nextSoldToday = sales
        .filter((sale) => sale.payment_method !== 'complimentary' && (sale.created_at ? malaysiaDateInputValue(sale.created_at) : sale.business_date) === today)
        .flatMap((sale) => sale.sale_items ?? [])
        .reduce<Record<string, number>>((sum, item) => {
          if (!item.product_id) return sum;
          sum[item.product_id] = (sum[item.product_id] ?? 0) + Number(item.quantity);
          return sum;
        }, {});
      setProducts(loadedProducts);
      setSoldTodayByProduct(nextSoldToday);
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
    }
    void load();
  }, [period, selectedDate, selectedWeek, selectedMonth]);

  const lowStock = products.filter(
    (product) =>
      product.active &&
      (product.inventory_balances?.quantity_on_hand ?? 0) <= product.low_stock_threshold,
  );
  const activeProducts = products.filter((product) => product.active);
  const totalCans = activeProducts.reduce((sum, product) => sum + (product.inventory_balances?.quantity_on_hand ?? 0), 0);
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
    <>
      <PageHeader
        title={
          <>
            <span className="lg:hidden">{text('Dashboard', 'Dashboard')}</span>
            <span className="hidden lg:inline">{text('Island Sales Dashboard', 'Papan Jualan Island')}</span>
          </>
        }
      />
      <section className="island-panel mb-4 rounded-[1.5rem] p-2 sm:p-3">
        <div className="grid min-w-0 grid-cols-[minmax(132px,0.82fr)_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[minmax(220px,360px)_minmax(0,1fr)]">
          <div className="grid grid-cols-3 gap-1 rounded-2xl bg-white/80 p-1 font-black">
            {(['day', 'week', 'month'] as const).map((item) => (
              <button key={item} className={`min-h-9 whitespace-nowrap rounded-xl px-1.5 py-1.5 text-[0.72rem] sm:min-h-10 sm:px-2 sm:py-2 sm:text-sm ${period === item ? 'bg-accent text-white' : ''}`} onClick={() => setPeriod(item)}>
                {item === 'day' ? text('Day', 'Hari') : item === 'week' ? text('Week', 'Minggu') : text('Month', 'Bulan')}
              </button>
            ))}
          </div>
          <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] gap-1.5 sm:gap-2">
            <button type="button" className="grid h-9 w-8 place-items-center rounded-xl border border-line bg-white font-black shadow-soft sm:h-10 sm:w-10 sm:rounded-2xl" onClick={() => shiftPeriod(-1)} aria-label="Previous period">
              <ChevronLeft className="h-4 w-4 sm:h-5 sm:w-5" />
            </button>
            {period === 'day' ? <input className="min-h-9 min-w-0 w-full rounded-xl border border-line bg-white px-2 py-1.5 text-xs font-bold sm:min-h-10 sm:rounded-2xl sm:px-3 sm:py-2 sm:text-sm" type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} /> : null}
            {period === 'week' ? <input className="min-h-9 min-w-0 w-full rounded-xl border border-line bg-white px-2 py-1.5 text-xs font-bold sm:min-h-10 sm:rounded-2xl sm:px-3 sm:py-2 sm:text-sm" type="week" value={selectedWeek} onChange={(e) => setSelectedWeek(e.target.value)} /> : null}
            {period === 'month' ? <input className="min-h-9 min-w-0 w-full rounded-xl border border-line bg-white px-2 py-1.5 text-xs font-bold sm:min-h-10 sm:rounded-2xl sm:px-3 sm:py-2 sm:text-sm" type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} /> : null}
            <button type="button" className="grid h-9 w-8 place-items-center rounded-xl border border-line bg-white font-black shadow-soft sm:h-10 sm:w-10 sm:rounded-2xl" onClick={() => shiftPeriod(1)} aria-label="Next period">
              <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5" />
            </button>
          </div>
        </div>
      </section>
      <section className="mb-4 rounded-2xl border border-line bg-gradient-to-br from-pink-100 via-rose-200 to-teal-100 p-3 text-ink shadow-glow sm:rounded-[1.5rem] sm:p-4">
        <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,380px)] lg:items-end">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-accent sm:text-sm"><Sparkles className="h-4 w-4" /> {period.toUpperCase()}</p>
            <p className="mt-1.5 text-lg font-black text-ink sm:text-xl">{periodTitle}</p>
            <h2 className="mt-2 break-words text-2xl font-black leading-tight sm:text-3xl lg:text-4xl">{money(totals.paidRevenue, String(settings.currency_symbol))}</h2>
            <p className="mt-1.5 text-xs font-bold text-neutral-700 sm:text-sm">{text('Total Revenue excludes FOC. FOC Cost is tracked separately.', 'Total Revenue tidak termasuk FOC. FOC Cost direkod berasingan.')}</p>
            <p className="mt-1 text-xs font-bold text-neutral-700 sm:text-sm">{dualMoney(totals.paidRevenue, String(settings.currency_symbol))}</p>
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-1 min-[1450px]:grid-cols-2">
            <div className="min-w-0 rounded-2xl bg-white/70 p-3 shadow-soft backdrop-blur">
              <p className="text-xs font-bold text-neutral-600 sm:text-sm">Total Revenue</p>
              <p className="break-words text-lg font-black sm:text-xl">{money(totals.paidRevenue, String(settings.currency_symbol))}</p>
            </div>
            <div className="min-w-0 rounded-2xl bg-white/70 p-3 shadow-soft backdrop-blur">
              <p className="text-xs font-bold text-neutral-600 sm:text-sm">FOC Cost 🎁</p>
              <p className="break-words text-lg font-black text-coral sm:text-xl">- {money(totals.focCost, String(settings.currency_symbol))}</p>
            </div>
          </div>
        </div>
      </section>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 min-[1450px]:grid-cols-5">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 shadow-soft sm:p-4"><p className="text-xs font-black text-emerald-700 sm:text-sm">{text('Cash Payment', 'Bayaran tunai')} 💵</p><p className="mt-1.5 text-lg font-black sm:text-xl">{money(totals.cash, String(settings.currency_symbol))}</p></div>
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3 shadow-soft sm:p-4"><p className="text-xs font-black text-sky-700 sm:text-sm">{text('QR Payment', 'Bayaran QR')} 📱</p><p className="mt-1.5 text-lg font-black sm:text-xl">{money(totals.qr, String(settings.currency_symbol))}</p></div>
        <div className="rounded-2xl border border-pink-200 bg-pink-50 p-3 shadow-soft sm:p-4"><p className="text-xs font-black text-pink-700 sm:text-sm">FOC Cost 🎁</p><p className="mt-1.5 text-lg font-black text-coral sm:text-xl">- {money(totals.focCost, String(settings.currency_symbol))}</p></div>
        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-3 shadow-soft sm:p-4"><p className="text-xs font-black text-violet-700 sm:text-sm">Total Revenue</p><p className="mt-1.5 text-lg font-black sm:text-xl">{money(totals.paidRevenue, String(settings.currency_symbol))}</p></div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 shadow-soft sm:p-4"><p className="text-xs font-black text-amber-700 sm:text-sm">{text('Transactions', 'Transaksi')}</p><p className="mt-1.5 text-lg font-black sm:text-xl">{totals.tx}</p></div>
      </div>
      <section className="island-panel mt-4 rounded-2xl p-3 sm:mt-5 sm:rounded-[2rem] sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-black"><PackageCheck className="h-5 w-5 text-accent" /> {text('Stock Hub', 'Hab Stok')}</h2>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-sm font-black">
            <div className="rounded-2xl border border-line bg-white/80 px-3 py-2">
              <p className="text-neutral-500">Items</p>
              <p className="text-xl text-ink">{activeProducts.length}</p>
            </div>
            <div className="rounded-2xl border border-line bg-white/80 px-3 py-2">
              <p className="text-neutral-500">Balance</p>
              <p className="text-xl text-ink">{totalCans}</p>
            </div>
            <div className="rounded-2xl border border-warning bg-amber-50 px-3 py-2">
              <p className="text-warning">Low</p>
              <p className="text-xl text-ink">{lowStock.length}</p>
            </div>
          </div>
        </div>
        <div className="hidden">
          {activeProducts.map((product) => {
            const stock = product.inventory_balances?.quantity_on_hand ?? 0;
            const low = stock <= product.low_stock_threshold;
            const soldToday = soldTodayByProduct[product.id] ?? 0;
            return (
              <article key={product.id} className="rounded-[1.5rem] border border-line bg-white/85 p-4 shadow-soft">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-black">{product.name}</p>
                    <p className="text-sm font-bold text-neutral-600">{product.categories?.name === 'Other' ? 'Others' : product.categories?.name ?? 'Others'}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${low ? 'bg-amber-100 text-warning' : 'bg-teal-50 text-accent'}`}>
                    {low ? 'Low' : 'OK'}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm font-bold">
                  <div className="rounded-2xl bg-shell p-3"><p className="text-neutral-500">Sold Today</p><p>{soldToday} units</p></div>
                  <div className="rounded-2xl bg-shell p-3"><p className="text-neutral-500">Balance</p><p className={low ? 'text-warning' : 'text-ink'}>{cansAndCartons(stock, product.carton_size)}</p></div>
                </div>
              </article>
            );
          })}
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[680px] text-left">
            <thead className="bg-shell text-sm">
              <tr>
                <th className="p-3">Product</th>
                <th className="p-3">Category</th>
                <th className="p-3">Sold Today</th>
                <th className="p-3">Balance</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {activeProducts.map((product) => {
                const stock = product.inventory_balances?.quantity_on_hand ?? 0;
                const low = stock <= product.low_stock_threshold;
                const soldToday = soldTodayByProduct[product.id] ?? 0;
                return (
                  <tr key={product.id} className="border-t border-line">
                    <td className="p-3 font-black">{product.name}</td>
                    <td className="p-3">{product.categories?.name === 'Other' ? 'Others' : product.categories?.name ?? 'Others'}</td>
                    <td className="p-3 font-bold">{soldToday} units</td>
                    <td className={`p-3 font-bold ${low ? 'text-warning' : ''}`}>{cansAndCartons(stock, product.carton_size)}</td>
                    <td className="p-3">
                      <span className={`rounded-full px-3 py-1 text-xs font-black ${low ? 'bg-amber-100 text-warning' : 'bg-teal-50 text-accent'}`}>
                        {low ? 'Low stock' : 'OK'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-4 rounded-2xl border border-line bg-white/80 p-4">
          <h3 className="flex items-center gap-2 text-sm font-black text-warning"><AlertTriangle className="h-4 w-4" /> Low stock warnings</h3>
          <div className="mt-2 grid gap-2">
            {lowStock.length === 0 ? (
              <p className="text-sm font-bold text-neutral-600">No low stock warnings.</p>
            ) : (
              lowStock.map((product) => (
                <div key={product.id} className="flex justify-between gap-3 text-sm">
                  <span className="font-bold">{product.name}</span>
                  <span>{product.inventory_balances?.quantity_on_hand ?? 0} cans</span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </>
  );
}

function weekStartFromInput(value: string) {
  const [yearText, weekText] = value.split('-W');
  const year = Number(yearText);
  const week = Number(weekText);
  const weekOne = startOfWeek(new Date(year, 0, 4), { weekStartsOn: 1 });
  return addWeeks(weekOne, Math.max(week - 1, 0));
}
