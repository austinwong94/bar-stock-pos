import { useMemo, useState } from 'react';
import { addDays, addWeeks, parseISO, startOfWeek } from 'date-fns';
import { inputClass } from '../components/Form';
import { PageHeader } from '../components/Page';
import { demoMovements } from '../lib/demo';
import { loadLocalSaleItems, loadLocalSales } from '../lib/localStore';
import { money } from '../lib/format';
import type { SettingsMap } from '../lib/types';
import StockIn from './StockIn';

type Period = 'day' | 'week' | 'month' | 'custom';
type Mode = 'in' | 'out';

function methodLabel(method: string) {
  if (method === 'cash') return 'Cash Payment';
  if (method === 'qr') return 'QR Payment';
  if (method === 'complimentary') return 'FOC';
  return '-';
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
  const [mode, setMode] = useState<Mode>('in');
  const [period, setPeriod] = useState<Period>('day');
  const [selectedDate, setSelectedDate] = useState('2026-05-03');
  const [selectedWeek, setSelectedWeek] = useState('2026-W18');
  const [selectedMonth, setSelectedMonth] = useState('2026-05');
  const [customStart, setCustomStart] = useState('2026-04-30');
  const [customEnd, setCustomEnd] = useState('2026-05-03');

  const stockOutRows = useMemo(() => loadLocalSaleItems().map((item) => {
    const sale = loadLocalSales().find((entry) => entry.id === item.sale_id);
    return {
      date: sale?.business_date ?? '-',
      sale: sale?.sale_number ?? '-',
      staff: sale?.order_taken_by ?? '-',
      item: item.products?.name ?? item.custom_item_name ?? item.product_id ?? 'Custom Order',
      qty: item.quantity,
      method: sale?.payment_method ?? '-',
      total: item.line_total,
      worker: sale?.order_taken_by ?? '-',
    };
  }), []);

  const stockInRows = demoMovements
    .filter((movement) => movement.movement_type === 'stock_in')
    .map((movement) => ({
      date: movement.created_at.slice(0, 10),
      reference: movement.reason ?? movement.reference_type ?? '-',
      item: movement.products?.name ?? movement.product_id ?? '-',
      qty: Math.abs(movement.quantity_change),
      unit: movement.unit_input === 'carton' ? `${movement.input_quantity ?? '-'} carton` : `${movement.input_quantity ?? Math.abs(movement.quantity_change)} unit(s)`,
      worker: movement.entered_by ?? '-',
      notes: movement.notes ?? '-',
    }));

  const filteredOutRows = stockOutRows.filter((row) => inRange(row.date, period, selectedDate, selectedWeek, selectedMonth, customStart, customEnd));
  const filteredInRows = stockInRows.filter((row) => inRange(row.date, period, selectedDate, selectedWeek, selectedMonth, customStart, customEnd));

  return (
    <>
      <PageHeader
        title="Stock Activity / Aktiviti Stok"
      />
      <section className="mb-4 grid grid-cols-2 gap-2">
        <button
          className={`rounded-2xl border p-3 text-left shadow-soft transition sm:rounded-[2rem] sm:p-5 ${mode === 'in' ? 'border-accent bg-teal-50 ring-2 ring-teal-100 sm:ring-4' : 'border-line bg-white/85 hover:border-accent'}`}
          onClick={() => setMode('in')}
        >
          <p className="text-xs font-black uppercase tracking-widest text-accent">Record</p>
          <h2 className="mt-1.5 text-lg font-black sm:mt-2 sm:text-2xl">Stock In</h2>
          <p className="mt-1 text-sm font-bold text-neutral-600">Add units or cartons into inventory.</p>
        </button>
        <button
          className={`rounded-2xl border p-3 text-left shadow-soft transition sm:rounded-[2rem] sm:p-5 ${mode === 'out' ? 'border-accent bg-teal-50 ring-2 ring-teal-100 sm:ring-4' : 'border-line bg-white/85 hover:border-accent'}`}
          onClick={() => setMode('out')}
        >
          <p className="text-xs font-black uppercase tracking-widest text-coral">Review</p>
          <h2 className="mt-1.5 text-lg font-black sm:mt-2 sm:text-2xl">Stock Out</h2>
          <p className="mt-1 text-sm font-bold text-neutral-600">Review sales and FOC stock deductions.</p>
        </button>
      </section>

      {mode === 'in' ? <div className="mb-5 sm:mb-8"><StockIn settings={settings} embedded /></div> : null}
      {mode === 'out' ? (
        <section className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-4">
          <div className="rounded-2xl border border-line bg-white/85 p-3 shadow-soft sm:rounded-[1.5rem] sm:p-5">
            <p className="text-xs font-black text-neutral-600 sm:text-sm">Quantity Out</p>
            <p className="mt-1.5 text-lg font-black sm:text-2xl">{filteredOutRows.reduce((sum, row) => sum + row.qty, 0)}</p>
          </div>
          <div className="rounded-2xl border border-line bg-white/85 p-3 shadow-soft sm:rounded-[1.5rem] sm:p-5">
            <p className="text-xs font-black text-neutral-600 sm:text-sm">Total Revenue</p>
            <p className="mt-1.5 text-lg font-black sm:text-2xl">{money(filteredOutRows.filter((row) => row.method !== 'complimentary').reduce((sum, row) => sum + row.total, 0), String(settings.currency_symbol))}</p>
          </div>
          <div className="rounded-2xl border border-pink-200 bg-pink-50 p-3 shadow-soft sm:rounded-[1.5rem] sm:p-5">
            <p className="text-xs font-black text-pink-700 sm:text-sm">FOC Cost</p>
            <p className="mt-1.5 text-lg font-black text-coral sm:text-2xl">- {money(filteredOutRows.filter((row) => row.method === 'complimentary').reduce((sum, row) => sum + row.total, 0), String(settings.currency_symbol))}</p>
          </div>
        </section>
      ) : null}

      <section className="island-panel mb-4 rounded-2xl p-3 sm:mb-5 sm:rounded-[2rem] sm:p-5">
        <h2 className="text-lg font-black sm:text-xl">{mode === 'in' ? 'What was added' : 'What was stocked out'}</h2>
        <div className="mt-2 grid gap-2 lg:grid-cols-[auto_1fr] lg:items-center">
          <div className="grid grid-cols-4 gap-1 rounded-2xl bg-white/80 p-1 text-xs font-black sm:text-sm">
            {(['day', 'week', 'month', 'custom'] as const).map((item) => (
              <button
                key={item}
                className={`min-h-9 rounded-xl px-1.5 py-1.5 ${period === item ? 'bg-accent text-white' : ''}`}
                onClick={() => setPeriod(item)}
              >
                {item === 'day' ? 'Daily' : item === 'week' ? 'Weekly' : item === 'month' ? 'Monthly' : 'Selected'}
              </button>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
            {period === 'day' ? <input className={inputClass} type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /> : null}
            {period === 'week' ? <input className={inputClass} type="week" value={selectedWeek} onChange={(event) => setSelectedWeek(event.target.value)} /> : null}
            {period === 'month' ? <input className={inputClass} type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} /> : null}
            {period === 'custom' ? (
              <>
                <input className={inputClass} type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} />
                <input className={inputClass} type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} />
              </>
            ) : null}
          </div>
        </div>
      </section>

      {mode === 'in' ? (
        <>
          <section className="mb-4 grid grid-cols-2 gap-2 sm:gap-4">
            <div className="rounded-2xl border border-line bg-white/85 p-3 shadow-soft sm:rounded-[1.5rem] sm:p-5">
              <p className="text-xs font-black text-neutral-600 sm:text-sm">Stock-in quantity</p>
              <p className="mt-1.5 text-lg font-black sm:text-2xl">{filteredInRows.reduce((sum, row) => sum + row.qty, 0)} unit(s)</p>
            </div>
            <div className="rounded-2xl border border-line bg-white/85 p-3 shadow-soft sm:rounded-[1.5rem] sm:p-5">
              <p className="text-xs font-black text-neutral-600 sm:text-sm">Entries</p>
              <p className="mt-1.5 text-lg font-black sm:text-2xl">{filteredInRows.length}</p>
            </div>
          </section>
          <section className="island-panel mt-4 rounded-2xl p-3 sm:mt-5 sm:rounded-[2rem] sm:p-5">
            <h2 className="text-lg font-black sm:text-xl">Stock In History</h2>
            <div className="mt-3 grid gap-3 md:hidden">
              {filteredInRows.map((row, index) => (
                <article key={`${row.date}-${row.item}-card-${index}`} className={`rounded-2xl border border-line bg-white/85 p-3 shadow-soft sm:rounded-[1.5rem] sm:p-4 ${index === 0 ? 'ring-2 ring-pink-100' : ''}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-black">{row.item}</p>
                      <p className="text-sm font-bold text-neutral-600">{row.date} · {row.worker}</p>
                    </div>
                    <span className="rounded-xl bg-teal-50 px-3 py-1 text-sm font-black text-accent">+{row.qty}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs font-bold sm:mt-3 sm:gap-2 sm:text-sm">
                    <div className="rounded-2xl bg-shell p-3"><p className="text-neutral-500">Input</p><p>{row.unit}</p></div>
                    <div className="rounded-2xl bg-shell p-3"><p className="text-neutral-500">Reference</p><p>{row.reference}</p></div>
                  </div>
                  {row.notes !== '-' ? <p className="mt-3 text-sm font-bold text-neutral-600">{row.notes}</p> : null}
                </article>
              ))}
            </div>
            <div className="mt-3 hidden overflow-x-auto md:block">
              <table className="w-full min-w-[900px] text-left">
                <thead className="text-sm">
                  <tr>
                    <th className="p-3 whitespace-nowrap">Date</th>
                    <th className="p-3 whitespace-nowrap">Item</th>
                    <th className="p-3 whitespace-nowrap">Worker</th>
                    <th className="p-3 whitespace-nowrap">Input</th>
                    <th className="p-3 whitespace-nowrap">Units added</th>
                    <th className="p-3 whitespace-nowrap">Reference</th>
                    <th className="p-3 whitespace-nowrap">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInRows.map((row, index) => (
                    <tr key={`${row.date}-${row.item}-${index}`} className={`border-t border-line hover:bg-shell ${index === 0 ? 'bg-pink-50' : ''}`}>
                      <td className="p-3 font-black whitespace-nowrap">{row.date}</td>
                      <td className="p-3 font-black whitespace-nowrap">{row.item}</td>
                      <td className="p-3 whitespace-nowrap">{row.worker}</td>
                      <td className="p-3 whitespace-nowrap">{row.unit}</td>
                      <td className="p-3 whitespace-nowrap">{row.qty}</td>
                      <td className="p-3 whitespace-nowrap">{row.reference}</td>
                      <td className="p-3">{row.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="island-panel rounded-2xl p-3 sm:rounded-[2rem] sm:p-5">
            <div className="grid gap-3 md:hidden">
              {filteredOutRows.map((row, index) => (
                <article key={`${row.sale}-${row.item}-card-${index}`} className={`rounded-2xl border border-line bg-white/85 p-3 shadow-soft sm:rounded-[1.5rem] sm:p-4 ${index === 0 ? 'ring-2 ring-pink-100' : ''}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-black">{row.item}</p>
                      <p className="text-sm font-bold text-neutral-600">{row.date} · {row.worker}</p>
                    </div>
                    <span className={`rounded-xl px-3 py-1 text-sm font-black ${row.method === 'complimentary' ? 'bg-pink-50 text-coral' : 'bg-teal-50 text-accent'}`}>
                      {methodLabel(row.method)}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs font-bold sm:mt-3 sm:gap-2 sm:text-sm">
                    <div className="rounded-2xl bg-shell p-3"><p className="text-neutral-500">Quantity Out</p><p>{row.qty}</p></div>
                    <div className="rounded-2xl bg-shell p-3"><p className="text-neutral-500">Value</p><p className={row.method === 'complimentary' ? 'text-coral' : ''}>{row.method === 'complimentary' ? '- ' : ''}{money(row.total, String(settings.currency_symbol))}</p></div>
                  </div>
                  <p className="mt-3 text-sm font-bold text-neutral-600">{row.sale}</p>
                </article>
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[900px] text-left">
                <thead className="text-sm">
                  <tr>
                    <th className="p-3 whitespace-nowrap">Date</th>
                    <th className="p-3 whitespace-nowrap">Sale</th>
                    <th className="p-3 whitespace-nowrap">Worker</th>
                    <th className="p-3 whitespace-nowrap">Item</th>
                    <th className="p-3 whitespace-nowrap">Quantity Out</th>
                    <th className="p-3 whitespace-nowrap">Method</th>
                    <th className="p-3 whitespace-nowrap">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOutRows.map((row, index) => (
                    <tr key={`${row.sale}-${row.item}-${index}`} className={`border-t border-line hover:bg-shell ${index === 0 ? 'bg-pink-50' : ''}`}>
                      <td className="p-3 font-black whitespace-nowrap">{row.date}</td>
                      <td className="p-3 whitespace-nowrap">{row.sale}</td>
                      <td className="p-3 whitespace-nowrap">{row.worker}</td>
                      <td className="p-3 font-black whitespace-nowrap">{row.item}</td>
                      <td className="p-3 whitespace-nowrap">{row.qty}</td>
                      <td className="p-3 whitespace-nowrap">{methodLabel(row.method)}</td>
                      <td className={`p-3 whitespace-nowrap ${row.method === 'complimentary' ? 'text-coral' : ''}`}>
                        {row.method === 'complimentary' ? '- ' : ''}{money(row.total, String(settings.currency_symbol))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
