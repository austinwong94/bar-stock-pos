import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Page';
import { displayDate } from '../lib/format';
import { supabase } from '../lib/supabase';
import { isSupabaseConfigured } from '../lib/supabase';
import { demoMovements } from '../lib/demo';
import type { StockMovement } from '../lib/types';

export default function StockMovements() {
  const [movements, setMovements] = useState<StockMovement[]>([]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setMovements(demoMovements);
      return;
    }
    supabase
      .from('stock_movements')
      .select('*, products(name)')
      .order('created_at', { ascending: false })
      .limit(200)
      .then(({ data }: { data: unknown[] | null }) => setMovements((data ?? []) as StockMovement[]));
  }, []);

  return (
    <>
      <PageHeader title="Stock Movement History" subtitle="Ledger of stock-ins, sales, complimentary stock-outs, void reversals, and adjustments." />
      <div className="grid gap-2 md:hidden">
        {movements.map((movement) => (
          <article key={movement.id} className="rounded-2xl border border-line bg-white/85 p-3 shadow-soft sm:rounded-[1.5rem] sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-black">{movement.products?.name ?? '-'}</p>
                <p className="text-sm font-bold text-neutral-600">{displayDate(movement.created_at)} · {movement.movement_type}</p>
              </div>
              <span className={`rounded-xl px-3 py-1 text-sm font-black ${movement.quantity_change < 0 ? 'bg-pink-50 text-coral' : 'bg-teal-50 text-accent'}`}>
                {movement.quantity_change}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1.5 text-center text-xs font-bold sm:mt-3 sm:gap-2 sm:text-sm">
              <div className="rounded-xl bg-shell p-2 sm:rounded-2xl"><p className="text-neutral-500">Before</p><p>{movement.quantity_before}</p></div>
              <div className="rounded-xl bg-shell p-2 sm:rounded-2xl"><p className="text-neutral-500">After</p><p>{movement.quantity_after}</p></div>
              <div className="rounded-xl bg-shell p-2 sm:rounded-2xl"><p className="text-neutral-500">Input</p><p>{movement.input_quantity ?? '-'} {movement.unit_input ?? ''}</p></div>
            </div>
            <p className="mt-3 text-sm font-bold text-neutral-600">{movement.reason ?? movement.notes ?? '-'}</p>
          </article>
        ))}
      </div>
      <div className="hidden overflow-x-auto rounded-[2rem] border border-line bg-white/80 shadow-soft md:block">
        <table className="w-full min-w-[960px] text-left">
          <thead className="bg-paper text-sm">
            <tr>
              <th className="p-3">Date</th>
              <th className="p-3">Product</th>
              <th className="p-3">Type</th>
              <th className="p-3">Change</th>
              <th className="p-3">Before</th>
              <th className="p-3">After</th>
              <th className="p-3">Input</th>
              <th className="p-3">Notes</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((movement) => (
              <tr key={movement.id} className="border-t border-line">
                <td className="p-3">{displayDate(movement.created_at)}</td>
                <td className="p-3 font-bold">{movement.products?.name ?? '-'}</td>
                <td className="p-3">{movement.movement_type}</td>
                <td className="p-3">{movement.quantity_change}</td>
                <td className="p-3">{movement.quantity_before}</td>
                <td className="p-3">{movement.quantity_after}</td>
                <td className="p-3">{movement.input_quantity ?? '-'} {movement.unit_input ?? ''}</td>
                <td className="p-3">{movement.reason ?? movement.notes ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
