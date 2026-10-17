import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Page';
import { Link } from 'react-router-dom';
import { secondaryButtonClass } from '../components/Form';
import { loadProducts } from '../lib/data';
import type { ProductWithStock, SettingsMap } from '../lib/types';
import { useLanguage } from '../lib/language';
import { useSharedRefresh } from '../lib/useSharedRefresh';

export default function Inventory({ settings }: { settings: SettingsMap }) {
  const { text } = useLanguage();
  const [products, setProducts] = useState<ProductWithStock[]>([]);

  async function refreshInventory() {
    setProducts(await loadProducts(true));
  }

  useEffect(() => {
    void refreshInventory();
  }, []);

  useSharedRefresh(refreshInventory, {
    tables: ['products', 'inventory_balances', 'categories', 'stock_movements'],
    intervalMs: 15000,
  });

  return (
    <>
      <PageHeader
        title={text('Stock Hub', 'Hab Stok')}
        actions={
          <>
            <Link className={secondaryButtonClass} to="/stock-out-report">{text('Stock Activity', 'Aktiviti Stok')}</Link>
            <Link className={secondaryButtonClass} to="/movements">{text('Movement History', 'Sejarah Pergerakan')}</Link>
          </>
        }
      />
      <div className="overflow-hidden rounded-lg border border-line bg-white/80 shadow-none sm:hidden">
        <table className="dense-table w-full table-fixed text-left text-[11px]">
          <thead className="bg-paper">
            <tr>
              <th className="w-[42%] p-2">{text('Product', 'Produk')}</th>
              <th className="w-[24%] p-2">{text('Balance', 'Baki')}</th>
              <th className="w-[34%] p-2">{text('Low Alert (Units)', 'Amaran Rendah (Unit)')}</th>
            </tr>
          </thead>
          <tbody>
        {products.map((product) => {
          const stock = product.inventory_balances?.quantity_on_hand ?? 0;
          const low = stock <= product.low_stock_threshold;
          return (
            <tr key={product.id} className="border-t border-line">
              <td className="p-2 align-top">
                <p className="truncate font-semibold">{product.name}</p>
                <p className="mt-0.5 truncate text-[10px] font-bold text-neutral-600">{product.categories?.name === 'Other' ? 'Others' : product.categories?.name ?? 'Others'}</p>
              </td>
              <td className={`p-2 align-top font-semibold leading-tight ${low ? 'text-warning' : ''}`}>
                {stock}
                <span className="block text-[10px] font-bold text-neutral-600">{text('Units', 'Unit')}</span>
              </td>
              <td className="p-2 align-top leading-tight">
                <span className="font-semibold">{product.low_stock_threshold}</span>
                <span className="ml-1 text-[10px] font-bold text-neutral-600">{text('Units', 'Unit')}</span>
                <span className={`mt-1 inline-flex max-w-full rounded-lg px-1.5 py-0.5 text-[9px] font-semibold ${low ? 'bg-amber-100 text-warning' : product.active ? 'bg-shell text-accent' : 'bg-neutral-100 text-neutral-600'}`}>
                  {low ? text('Low', 'Rendah') : product.active ? text('Active', 'Aktif') : text('Inactive', 'Tidak aktif')}
                </span>
              </td>
            </tr>
          );
        })}
          </tbody>
        </table>
      </div>
      <div className="clean-scroll hidden overflow-x-auto rounded-lg border border-line bg-white/80 shadow-none sm:block sm:rounded-xl">
        <table className="dense-table w-full min-w-[640px] text-left text-xs sm:text-sm">
          <thead className="bg-paper text-sm">
            <tr>
              <th className="p-3">{text('Product', 'Produk')}</th>
              <th className="p-3">{text('Category', 'Kategori')}</th>
              <th className="p-3">{text('Balance', 'Baki')}</th>
              <th className="p-3">{text('Low Alert (Individual Units)', 'Amaran Rendah (Unit Individu)')}</th>
              <th className="p-3">{text('Status', 'Status')}</th>
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
                    {stock} {text('Units', 'Unit')}
                  </td>
                  <td className="p-3">{product.low_stock_threshold} {text('Units', 'Unit')}</td>
                  <td className="p-3">{low ? text('Low Stock (Units)', 'Stok Rendah (Unit)') : product.active ? text('Active', 'Aktif') : text('Inactive', 'Tidak aktif')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
