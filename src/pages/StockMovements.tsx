import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Page';
import { displayDate } from '../lib/format';
import { supabase } from '../lib/supabase';
import { isSupabaseConfigured } from '../lib/supabase';
import { loadLocalStockMovements } from '../lib/localStore';
import type { StockMovement } from '../lib/types';
import { readAllRows } from '../lib/readAllRows';

function movementLabel(type: StockMovement['movement_type']) {
  if (type === 'stock_in') return 'Stock In';
  if (type === 'sale') return 'Sale';
  if (type === 'complimentary') return 'FOC';
  if (type === 'void_sale') return 'Void Sale';
  return 'Adjustment';
}

function inputLabel(movement: StockMovement) {
  const quantity = Number(movement.input_quantity ?? Math.abs(Number(movement.quantity_change)));
  if (movement.unit_input === 'carton') return `${movement.input_quantity ?? '-'} ${quantity === 1 ? 'Carton' : 'Cartons'}`;
  if (movement.unit_input === 'can') return `${movement.input_quantity ?? '-'} ${quantity === 1 ? 'Unit' : 'Units'}`;
  return movement.input_quantity == null ? '-' : `${movement.input_quantity} ${quantity === 1 ? 'Unit' : 'Units'}`;
}

function unitLabel(quantity: number) {
  return Math.abs(quantity) === 1 ? 'unit' : 'units';
}

export default function StockMovements() {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setMovements(loadLocalStockMovements());
      return;
    }
    let active=true;
    void readAllRows<StockMovement>((from,to)=>supabase.from('stock_movements').select('*, products(name)').order('created_at', { ascending: false }).order('id').range(from,to))
      .then(rows=>{if(active){setMovements(rows);setError('');}})
      .catch(()=>{if(active)setError('Stock history could not be loaded. Retry before using these records.');});
    return()=>{active=false;};
  }, [retry]);

  return (
    <>
      <PageHeader title="Stock Movement History" />
      {error ? <p role="alert" className="mb-3 text-sm text-danger">{error} <button className="underline" onClick={()=>setRetry(n=>n+1)}>Retry</button></p> : null}
      <div className="grid gap-2 sm:hidden">
        {movements.map((movement) => (
          <article key={movement.id} className="rounded-lg border border-line bg-white/85 p-3 shadow-none sm:rounded-xl sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{movement.products?.name ?? '-'}</p>
                <p className="text-sm font-bold text-neutral-600">{displayDate(movement.created_at)} · {movementLabel(movement.movement_type)}</p>
              </div>
              <span className={`rounded-xl px-3 py-1 text-sm font-semibold ${movement.quantity_change < 0 ? 'bg-shell text-coral' : 'bg-shell text-accent'}`}>
                {movement.quantity_change > 0 ? '+' : ''}{movement.quantity_change} {unitLabel(Number(movement.quantity_change))}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1.5 text-center text-xs font-bold sm:mt-3 sm:gap-2 sm:text-sm">
              <div className="rounded-xl bg-shell p-2 sm:rounded-lg"><p className="text-neutral-500">Before units</p><p>{movement.quantity_before}</p></div>
              <div className="rounded-xl bg-shell p-2 sm:rounded-lg"><p className="text-neutral-500">After units</p><p>{movement.quantity_after}</p></div>
              <div className="rounded-xl bg-shell p-2 sm:rounded-lg"><p className="text-neutral-500">Input</p><p>{inputLabel(movement)}</p></div>
            </div>
            <p className="mt-3 text-sm font-bold text-neutral-600">{movement.reason ?? movement.notes ?? '-'}</p>
          </article>
        ))}
      </div>
      <div className="clean-scroll hidden overflow-x-auto rounded-lg border border-line bg-white/80 shadow-none sm:block sm:rounded-xl">
        <table className="w-full min-w-[760px] text-left text-xs sm:text-sm">
          <thead className="bg-paper text-sm">
            <tr>
              <th className="p-3">Date</th>
              <th className="p-3">Product</th>
              <th className="p-3">Type</th>
              <th className="p-3">Unit Change (individual units)</th>
              <th className="p-3">Before (units)</th>
              <th className="p-3">After (units)</th>
              <th className="p-3">Input</th>
              <th className="p-3">Notes</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((movement) => (
              <tr key={movement.id} className="border-t border-line">
                <td className="p-3 whitespace-nowrap">{displayDate(movement.created_at)}</td>
                <td className="p-3 font-bold">{movement.products?.name ?? '-'}</td>
                <td className="p-3 whitespace-nowrap">{movementLabel(movement.movement_type)}</td>
                <td className="p-3 whitespace-nowrap font-semibold">{movement.quantity_change > 0 ? '+' : ''}{movement.quantity_change} {unitLabel(Number(movement.quantity_change))}</td>
                <td className="p-3 whitespace-nowrap">{movement.quantity_before}</td>
                <td className="p-3 whitespace-nowrap">{movement.quantity_after}</td>
                <td className="p-3 whitespace-nowrap">{inputLabel(movement)}</td>
                <td className="p-3">{movement.reason ?? movement.notes ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
