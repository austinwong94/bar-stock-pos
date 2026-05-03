import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Page';
import { Link } from 'react-router-dom';
import { secondaryButtonClass } from '../components/Form';
import { loadProducts } from '../lib/data';
import { cansAndCartons } from '../lib/format';
import type { ProductWithStock, SettingsMap } from '../lib/types';

export default function Inventory({ settings }: { settings: SettingsMap }) {
  const [products, setProducts] = useState<ProductWithStock[]>([]);

  useEffect(() => {
    loadProducts(true).then(setProducts).catch(console.error);
  }, []);

  return (
    <>
      <PageHeader
        title="Stock Hub / Stok"
        subtitle="Inventory, stock-in, and movement history are combined here to reduce tabs."
        actions={
          <>
            <Link className={secondaryButtonClass} to="/stock-out-report">Stock Activity / Aktiviti Stok</Link>
            <Link className={secondaryButtonClass} to="/movements">Movement History / Sejarah</Link>
          </>
        }
      />
      <div className="grid gap-2 md:hidden">
        {products.map((product) => {
          const stock = product.inventory_balances?.quantity_on_hand ?? 0;
          const low = stock <= product.low_stock_threshold;
          return (
            <article key={product.id} className="rounded-2xl border border-line bg-white/85 p-3 shadow-soft sm:rounded-[1.5rem] sm:p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-black">{product.name}</h2>
                  <p className="text-sm font-bold text-neutral-600">{product.categories?.name ?? 'Others'}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-black ${low ? 'bg-amber-100 text-warning' : 'bg-teal-50 text-accent'}`}>
                  {low ? 'Low' : product.active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs font-bold sm:mt-3 sm:gap-2 sm:text-sm">
                <div className="rounded-xl bg-shell p-2 sm:rounded-2xl sm:p-3"><p className="text-neutral-500">On hand</p><p className={low ? 'text-warning' : ''}>{cansAndCartons(stock, product.carton_size)}</p></div>
                <div className="rounded-xl bg-shell p-2 sm:rounded-2xl sm:p-3"><p className="text-neutral-500">Threshold</p><p>{product.low_stock_threshold} cans</p></div>
              </div>
            </article>
          );
        })}
      </div>
      <div className="hidden overflow-x-auto rounded-[2rem] border border-line bg-white/80 shadow-soft md:block">
        <table className="w-full min-w-[760px] text-left">
          <thead className="bg-paper text-sm">
            <tr>
              <th className="p-3">Product</th>
              <th className="p-3">Category</th>
              <th className="p-3">On hand</th>
              <th className="p-3">Threshold</th>
              <th className="p-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => {
              const stock = product.inventory_balances?.quantity_on_hand ?? 0;
              const low = stock <= product.low_stock_threshold;
              return (
                <tr key={product.id} className="border-t border-line">
                  <td className="p-3 font-bold">{product.name}</td>
                  <td className="p-3">{product.categories?.name === 'Other' ? 'Others' : product.categories?.name ?? 'Others'}</td>
                  <td className={`p-3 font-bold ${low ? 'text-warning' : ''}`}>
                    {cansAndCartons(stock, product.carton_size)}
                  </td>
                  <td className="p-3">{product.low_stock_threshold} cans</td>
                  <td className="p-3">{product.active ? 'Active' : 'Inactive'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-sm text-neutral-600">Currency: {String(settings.currency_symbol)}</p>
    </>
  );
}
