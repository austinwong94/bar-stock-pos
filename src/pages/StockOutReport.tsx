import { useEffect, useMemo, useRef, useState } from 'react';
import { addDays, addMonths, addWeeks, format, parseISO, startOfWeek } from 'date-fns';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { inputClass } from '../components/Form';
import { PageHeader } from '../components/Page';
import { WorkflowHelp } from '../components/WorkflowHelp';
import { ViewChoices } from '../components/ViewChoices';
import { StaffSummary } from '../components/StaffWorkspace';
import { BarPeriodControl } from '../components/BarPeriodControl';
import { malaysiaBusinessDateInputValue, money } from '../lib/format';
import { loadLocalSaleItems, loadLocalSales, loadLocalStockInDrafts, loadLocalStockMovements } from '../lib/localStore';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { useLanguage } from '../lib/language';
import type { Sale, SaleItem, SettingsMap, StockInDraftRecord, StockMovement } from '../lib/types';
import StockIn from './StockIn';
import { useSharedRefresh } from '../lib/useSharedRefresh';
import { readAllRows } from '../lib/readAllRows';

type Period = 'day' | 'week' | 'month' | 'custom';
type Mode = 'in' | 'out';
type StockOutRow = {
  date: string;
  sale: string;
  item: string;
  qty: number;
  method: string;
  total: number;
  worker: string;
  status: Sale['status'];
};
type StockInRow = {
  date: string;
  reference: string;
  item: string;
  qty: number;
  unit: string;
  worker: string;
  notes: string;
};

function methodLabel(method: string, translate: (en: string, ms: string) => string) {
  if (method === 'cash') return translate('Cash Payment', 'Bayaran Tunai');
  if (method === 'qr') return translate('QR Payment', 'Bayaran QR');
  if (method === 'complimentary') return 'FOC';
  return '-';
}

function statusLabel(status: Sale['status'], translate: (en: string, ms: string) => string) {
  return status === 'completed' ? translate('Completed', 'Selesai') : translate('Voided', 'Dibatalkan');
}

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function stockInputLabel(movement: StockMovement) {
  const quantity = Number(movement.input_quantity ?? Math.abs(Number(movement.quantity_change)));
  if (movement.unit_input === 'carton') return countLabel(quantity, 'Carton', 'Cartons');
  return countLabel(quantity, 'Unit', 'Units');
}

function allocateSaleAmounts(total: number, lineTotals: number[]) {
  const cents = Math.round(total * 100);
  const weightTotal = lineTotals.reduce((sum, value) => sum + value, 0);
  const fallbackWeight = weightTotal > 0 ? 0 : 1 / Math.max(lineTotals.length, 1);
  let used = 0;
  return lineTotals.map((lineTotal, index) => {
    if (index === lineTotals.length - 1) return (cents - used) / 100;
    const share = weightTotal > 0 ? lineTotal / weightTotal : fallbackWeight;
    const value = Math.round(cents * share);
    used += value;
    return value / 100;
  });
}

function rowsFromSale(sale: Sale & { sale_items?: SaleItem[] }, closeTime: SettingsMap[keyof SettingsMap]): StockOutRow[] {
  const items = sale.sale_items ?? [];
  const allocatedValues = allocateSaleAmounts(Number(sale.total_amount), items.map((item) => Number(item.line_total)));
  return items.map((item, index) => ({
    date: sale.business_date || (sale.created_at ? malaysiaBusinessDateInputValue(sale.created_at, closeTime) : '-'),
    sale: sale.sale_number,
    item: item.products?.name ?? item.custom_item_name ?? item.product_id ?? 'Custom Order',
    qty: item.quantity,
    method: sale.payment_method,
    total: allocatedValues[index] ?? 0,
    worker: sale.order_taken_by ?? '-',
    status: sale.status,
  }));
}

function weekStartFromInput(value: string) {
  const [yearText, weekText] = value.split('-W');
  const year = Number(yearText);
  const week = Number(weekText);
  const weekOne = startOfWeek(new Date(year, 0, 4), { weekStartsOn: 1 });
  return addWeeks(weekOne, Math.max(week - 1, 0));
}

function inRange(date: string, period: Period, selectedDate: string, selectedWeek: string, selectedMonth: string, customStart: string, customEnd: string) {
  if (date === '-') return false;
  if (period === 'day') return date === selectedDate;
  if (period === 'month') return date.startsWith(selectedMonth);
  if (period === 'custom') return date >= customStart && date <= customEnd;
  const weekStart = weekStartFromInput(selectedWeek);
  const weekEnd = addDays(weekStart, 6);
  const parsed = parseISO(date);
  return parsed >= weekStart && parsed <= weekEnd;
}

export default function StockOutReport({ settings }: { settings: SettingsMap }) {
  const { text } = useLanguage();
  const [mode, setMode] = useState<Mode>('in');
  const [period, setPeriod] = useState<Period>('day');
  const today = malaysiaBusinessDateInputValue(new Date(), settings.business_day_close_time);
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedWeek, setSelectedWeek] = useState(() => format(parseISO(today), "RRRR-'W'II"));
  const [selectedMonth, setSelectedMonth] = useState(today.slice(0, 7));
  const [customStart, setCustomStart] = useState(today);
  const [customEnd, setCustomEnd] = useState(today);
  const [stockOutRows, setStockOutRows] = useState<StockOutRow[]>([]);
  const [stockInRows, setStockInRows] = useState<StockInRow[]>([]);
  const [pendingStockInDrafts, setPendingStockInDrafts] = useState<StockInDraftRecord[]>([]);
  const [loadError, setLoadError] = useState('');
  const generation = useRef(0);

  async function loadRows() {
    const ticket = ++generation.current;
    try {
      setLoadError('');
      if (!isSupabaseConfigured) {
        setPendingStockInDrafts(loadLocalStockInDrafts().filter((draft) => draft.status === 'draft'));
        const localSaleItems = loadLocalSaleItems();
        setStockOutRows(
          loadLocalSales().flatMap((sale) =>
            rowsFromSale(
              { ...sale, sale_items: localSaleItems.filter((item) => item.sale_id === sale.id) },
              settings.business_day_close_time,
            ),
          ),
        );
        setStockInRows(
          loadLocalStockMovements()
            .filter((movement) => movement.movement_type === 'stock_in')
            .map((movement) => ({
              date: malaysiaBusinessDateInputValue(movement.created_at, settings.business_day_close_time),
              reference: movement.reason ?? movement.reference_type ?? '-',
              item: movement.products?.name ?? movement.product_id ?? '-',
              qty: Math.abs(movement.quantity_change),
              unit: stockInputLabel(movement),
              worker: movement.entered_by ?? '-',
              notes: movement.notes ?? '-',
            })),
        );
        return;
      }

      const [salesData, movementData, draftData] = await Promise.all([
        readAllRows<Sale & { sale_items?: SaleItem[] }>((from,to) => supabase.from('sales').select('*, sale_items(*, products(name))').order('created_at', { ascending: false }).order('id').range(from,to)),
        readAllRows<StockMovement>((from,to) => supabase.from('stock_movements').select('*, products(name)').eq('movement_type', 'stock_in').order('created_at', { ascending: false }).order('id').range(from,to)),
        readAllRows<StockInDraftRecord>((from,to) => supabase.from('stock_in_drafts').select('*').eq('status', 'draft').order('created_at', { ascending: false }).order('id').range(from,to)),
      ]);
      if (ticket !== generation.current) return;

      const sales = (salesData ?? []) as Array<Sale & { sale_items?: SaleItem[] }>;
      setStockOutRows(
        sales.flatMap((sale) => rowsFromSale(sale, settings.business_day_close_time)),
      );

      setStockInRows(
        ((movementData ?? []) as StockMovement[]).map((movement) => ({
          date: malaysiaBusinessDateInputValue(movement.created_at, settings.business_day_close_time),
          reference: movement.reason ?? movement.reference_type ?? '-',
          item: movement.products?.name ?? movement.product_id ?? '-',
          qty: Math.abs(movement.quantity_change),
          unit: stockInputLabel(movement),
          worker: movement.entered_by ?? '-',
          notes: movement.notes ?? '-',
        })),
      );
      setPendingStockInDrafts((draftData ?? []) as StockInDraftRecord[]);
    } catch {
      if (ticket !== generation.current) return;
      setLoadError(text('Stock records could not refresh. Previously loaded figures may be out of date.', 'Rekod stok gagal dikemas kini. Angka yang dimuatkan sebelum ini mungkin tidak terkini.'));
    }
  }

  useEffect(() => {
    void loadRows();
  }, [settings.business_day_close_time, text]);

  useSharedRefresh(loadRows, {
    tables: ['sales', 'sale_items', 'stock_movements', 'stock_in_drafts', 'products', 'inventory_balances'],
    intervalMs: 15000,
  });

  const filteredOutRows = stockOutRows.filter((row) => inRange(row.date, period, selectedDate, selectedWeek, selectedMonth, customStart, customEnd));
  const filteredInRows = stockInRows.filter((row) => inRange(row.date, period, selectedDate, selectedWeek, selectedMonth, customStart, customEnd));
  const activeOutRows = filteredOutRows.filter((row) => row.status === 'completed');

  function shiftPeriod(direction: -1 | 1) {
    if (period === 'day') {
      setSelectedDate(format(addDays(parseISO(selectedDate), direction), 'yyyy-MM-dd'));
      return;
    }
    if (period === 'week') {
      setSelectedWeek(format(addWeeks(weekStartFromInput(selectedWeek), direction), "RRRR-'W'II"));
      return;
    }
    if (period === 'month') {
      setSelectedMonth(format(addMonths(new Date(`${selectedMonth}-01T00:00:00`), direction), 'yyyy-MM'));
    }
  }

  return (
    <>
      <PageHeader title={text('Stock Activity', 'Aktiviti Stok')} actions={<WorkflowHelp area="bar" />} />
      {loadError ? <p role="alert" className="mb-3 text-sm text-danger">{loadError} <button className="underline" onClick={() => void loadRows()}>{text('Retry', 'Cuba Lagi')}</button></p> : null}
      <ViewChoices label={text('Stock Direction', 'Arah Stok')} className="bar-stock-mode" value={mode} onChange={value => setMode(value as 'in' | 'out')} items={[
        { value: 'in', label: text('Stock In', 'Stok Masuk') },
        { value: 'out', label: text('Stock Out', 'Stok Keluar') },
      ]} />

      {mode === 'out' && pendingStockInDrafts.length > 0 ? (
        <section className="mb-3 grid gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 shadow-none sm:mb-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:rounded-xl sm:p-4">
          <AlertTriangle className="hidden h-5 w-5 text-amber-700 sm:block" />
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight text-amber-800 sm:text-base">
              {pendingStockInDrafts.length} {pendingStockInDrafts.length === 1 ? text('Stock In Draft Waiting', 'Draf Stok Masuk Menunggu') : text('Stock In Drafts Waiting', 'Draf Stok Masuk Menunggu')}
            </p>
            <p className="mt-1 text-xs font-bold leading-snug text-amber-700 sm:text-sm">
              {pendingStockInDrafts[0]?.draft_number} · {pendingStockInDrafts[0]?.entered_by ?? '-'} · +{pendingStockInDrafts[0]?.total_units ?? 0} {text('Units', 'Unit')} · {text('Stock not added yet.', 'Stok belum ditambah.')}
            </p>
          </div>
          <button
            type="button"
            className="min-h-10 rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm font-semibold text-amber-800 shadow-none sm:rounded-lg"
            onClick={() => setMode('in')}
          >
            {text('Confirm Stock In', 'Sahkan Stok Masuk')}
          </button>
        </section>
      ) : null}

      {mode === 'in' ? <div className="mb-5 sm:mb-8"><StockIn settings={settings} embedded onSaved={loadRows} /></div> : null}
      <BarPeriodControl period={period} onPeriod={setPeriod}
        value={period === 'day' ? selectedDate : period === 'week' ? selectedWeek : selectedMonth}
        onValue={value => { if (period === 'day') setSelectedDate(value); else if (period === 'week') setSelectedWeek(value); else setSelectedMonth(value); }}
        onShift={shiftPeriod} custom={{ start: customStart, end: customEnd, onStart: setCustomStart, onEnd: setCustomEnd }} />
      {mode === 'out' ? <StaffSummary items={[
        { label: text('Units Out', 'Unit Keluar'), value: activeOutRows.reduce((sum, row) => sum + row.qty, 0) },
        { label: text('Revenue', 'Hasil'), value: money(activeOutRows.filter(row => row.method !== 'complimentary').reduce((sum, row) => sum + row.total, 0), String(settings.currency_symbol)) },
        { label: text('FOC Value', 'Nilai FOC'), value: money(activeOutRows.filter(row => row.method === 'complimentary').reduce((sum, row) => sum + row.total, 0), String(settings.currency_symbol)) },
      ]} /> : null}

      {mode === 'in' ? (
        <>
          <StaffSummary items={[
            { label: text('Units Added', 'Unit Ditambah'), value: filteredInRows.reduce((sum, row) => sum + row.qty, 0) },
            { label: text('Entries', 'Rekod'), value: filteredInRows.length },
          ]} />
          <section className="island-panel mt-3 rounded-lg p-2.5 sm:mt-5 sm:rounded-xl sm:p-5">
            <h2 className="text-base font-semibold sm:text-xl">{text('Stock In Records', 'Rekod Stok Masuk')}</h2>
            <div className="mt-3 sm:hidden">
              {filteredInRows.map((row, index) => <div className="bar-record-row" key={`${row.date}-${row.item}-${index}`}>
                <div><p className="font-semibold">{row.item}</p><p className="bar-caption">{row.date} · {row.worker}</p></div>
                <strong className="text-accent">+{row.qty} {text('units', 'unit')}</strong>
                <p className="bar-record-meta">{row.unit} · {row.reference}{row.notes !== '-' ? ' · ' + row.notes : ''}</p>
              </div>)}
              {!loadError&&!filteredInRows.length ? <p className="bar-caption py-4">{text('No records for this period.', 'Tiada rekod untuk tempoh ini.')}</p> : null}
            </div>
            <div className="clean-scroll mt-3 hidden overflow-x-auto rounded-lg border border-line bg-white/75 sm:block">
              <table className="dense-table w-full min-w-[680px] text-left text-xs sm:text-sm">
                <thead className="text-sm">
                  <tr>
                    <th className="p-3 whitespace-nowrap">{text('Date', 'Tarikh')}</th>
                    <th className="p-3 whitespace-nowrap">{text('Item', 'Item')}</th>
                    <th className="p-3 whitespace-nowrap">{text('Worker', 'Pekerja')}</th>
                    <th className="p-3 whitespace-nowrap">{text('Input', 'Input')}</th>
                    <th className="p-3 whitespace-nowrap">{text('Units Added', 'Unit Ditambah')}</th>
                    <th className="p-3 whitespace-nowrap">{text('Reference', 'Rujukan')}</th>
                    <th className="p-3 whitespace-nowrap">{text('Notes', 'Nota')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInRows.map((row, index) => (
                    <tr key={`${row.date}-${row.item}-${index}`} className={`border-t border-line hover:bg-shell ${index === 0 ? 'bg-shell' : ''}`}>
                      <td className="p-3 font-semibold whitespace-nowrap">{row.date}</td>
                      <td className="p-3 font-semibold whitespace-nowrap">{row.item}</td>
                      <td className="p-3 whitespace-nowrap">{row.worker}</td>
                      <td className="p-3 whitespace-nowrap">{row.unit}</td>
                      <td className="p-3 whitespace-nowrap">{row.qty}</td>
                      <td className="p-3 whitespace-nowrap">{row.reference}</td>
                      <td className="p-3">{row.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!loadError&&filteredInRows.length === 0 ? (
                <div className="border-t border-line p-4 text-center text-sm font-bold text-neutral-600">{text('No records for this period.', 'Tiada rekod untuk tempoh ini.')}</div>
              ) : null}
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="island-panel rounded-lg p-3 sm:rounded-xl sm:p-5">
            <div className="sm:hidden">
              {filteredOutRows.map((row, index) => <div className="bar-record-row" key={`${row.sale}-${row.item}-${index}`}>
                <div><p className="font-semibold">{row.item} <span className="text-muted">x {row.status === 'voided' ? 0 : row.qty}</span></p><p className="bar-caption">{row.date} · {row.worker}</p></div>
                <div className="text-right"><strong>{row.status === 'voided' ? statusLabel(row.status, text) : money(row.total, String(settings.currency_symbol))}</strong><p className="bar-caption">{methodLabel(row.method, text)}</p></div>
                <p className="bar-record-meta">{row.sale}</p>
              </div>)}
              {!loadError&&!filteredOutRows.length ? <p className="bar-caption py-4">{text('No records for this period.', 'Tiada rekod untuk tempoh ini.')}</p> : null}
            </div>
            <div className="clean-scroll hidden overflow-x-auto rounded-lg border border-line bg-white/75 sm:block">
              <table className="dense-table w-full min-w-[680px] text-left text-xs sm:text-sm">
                <thead className="text-sm">
                  <tr>
                    <th className="p-3 whitespace-nowrap">{text('Date', 'Tarikh')}</th>
                    <th className="p-3 whitespace-nowrap">{text('Sale', 'Jualan')}</th>
                    <th className="p-3 whitespace-nowrap">{text('Worker', 'Pekerja')}</th>
                    <th className="p-3 whitespace-nowrap">{text('Item', 'Item')}</th>
                    <th className="p-3 whitespace-nowrap">{text('Quantity Out', 'Kuantiti Keluar')}</th>
                    <th className="p-3 whitespace-nowrap">{text('Method', 'Kaedah')}</th>
                    <th className="p-3 whitespace-nowrap">{text('Status', 'Status')}</th>
                    <th className="p-3 whitespace-nowrap">{text('Value', 'Nilai')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOutRows.map((row, index) => (
                    <tr key={`${row.sale}-${row.item}-${index}`} className={`border-t border-line hover:bg-shell ${index === 0 ? 'bg-shell' : ''}`}>
                      <td className="p-3 font-semibold whitespace-nowrap">{row.date}</td>
                      <td className="p-3 whitespace-nowrap">{row.sale}</td>
                      <td className="p-3 whitespace-nowrap">{row.worker}</td>
                      <td className="p-3 font-semibold whitespace-nowrap">{row.item}</td>
                      <td className="p-3 whitespace-nowrap">{row.status === 'voided' ? 0 : row.qty}</td>
                      <td className="p-3 whitespace-nowrap">{methodLabel(row.method, text)}</td>
                      <td className="p-3 whitespace-nowrap">
                        <span className={`rounded-xl px-3 py-1 text-xs font-semibold ${row.status === 'completed' ? 'bg-shell text-accent' : 'bg-red-50 text-danger'}`}>
                          {statusLabel(row.status, text)}
                        </span>
                      </td>
                      <td className={`p-3 whitespace-nowrap ${row.method === 'complimentary' || row.status === 'voided' ? 'text-coral' : ''}`}>
                        {row.status === 'voided' ? statusLabel(row.status, text) : row.method === 'complimentary' ? '- ' : ''}{row.status === 'voided' ? '' : money(row.total, String(settings.currency_symbol))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!loadError&&filteredOutRows.length === 0 ? (
                <div className="border-t border-line p-4 text-center text-sm font-bold text-neutral-600">{text('No records for this period.', 'Tiada rekod untuk tempoh ini.')}</div>
              ) : null}
            </div>
          </section>
        </>
      )}
    </>
  );
}
