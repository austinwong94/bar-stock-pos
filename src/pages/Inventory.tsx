import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { PageHeader } from '../components/Page';
import { Link } from 'react-router-dom';
import { iconButtonClass, secondaryButtonClass } from '../components/Form';
import { loadProducts, loadRecipeProductIds } from '../lib/data';
import type { SettingsMap } from '../lib/types';
import { useLanguage } from '../lib/language';
import { useSharedRefresh } from '../lib/useSharedRefresh';
import { barCategoryLabel, barStockRows, stockStatusLabel, type StockViewRow } from '../lib/barStockView';

export default function Inventory({ settings: _settings }: { settings: SettingsMap }) {
  const { text } = useLanguage();
  const [rows, setRows] = useState<StockViewRow[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const generation = useRef(0);

  async function refreshInventory(background = false) {
    const ticket = ++generation.current;
    if (!background) setLoading(true);
    try {
      const [products, recipes] = await Promise.all([loadProducts(true), loadRecipeProductIds()]);
      const next = barStockRows(products, recipes);
      if (ticket !== generation.current) return;
      setRows(next); setError('');
    } catch {
      if (ticket === generation.current) setError(text('Stock could not be verified. Refresh before using these balances.', 'Stok tidak dapat disahkan. Muat semula sebelum menggunakan baki ini.'));
    } finally { if (ticket === generation.current) setLoading(false); }
  }

  useEffect(() => {
    void refreshInventory();
    return () => { generation.current++; };
  }, []);

  useSharedRefresh(() => refreshInventory(true), {
    tables: ['products', 'inventory_balances', 'categories', 'stock_movements', 'recipe_ingredients'],
    intervalMs: 15000,
  });
  const balance = (row: StockViewRow) => row.recipe ? text('By Recipe', 'Ikut Resipi') : row.balance === null ? text('Not Available', 'Tidak Tersedia') : row.balance;
  const status = (row: StockViewRow) => <span className={`inline-block max-w-full break-words rounded px-1.5 py-0.5 text-xs font-semibold leading-snug ${['low', 'unavailable', 'alert-unset', 'recipe-needed'].includes(row.status) ? 'bg-amber-100 text-warning' : 'bg-shell text-muted'}`}>{stockStatusLabel(row.status, text)}</span>;

  return (
    <>
      <PageHeader
        title={text('Stock Hub', 'Hab Stok')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={iconButtonClass} disabled={loading} title={text('Refresh Stock', 'Muat Semula Stok')} aria-label={text('Refresh Stock', 'Muat Semula Stok')} onClick={() => void refreshInventory()}><RefreshCw size={16} /></button>
            <Link className={secondaryButtonClass} to="/stock-out-report">{text('Stock Activity', 'Aktiviti Stok')}</Link>
            <Link className={secondaryButtonClass} to="/movements">{text('Movement History', 'Sejarah Pergerakan')}</Link>
          </div>
        }
      />
      {loading ? <p role="status" className="py-4 text-sm text-muted">{text('Checking Stock...', 'Menyemak Stok...')}</p> : error ? <div role="alert" className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-danger/30 p-3 text-sm text-danger"><span>{error}</span><button className={secondaryButtonClass} onClick={() => void refreshInventory()}><RefreshCw size={16} />{text('Retry', 'Cuba Lagi')}</button></div> : <>
      {rows.some(row => row.product.active && !row.recipe && row.balance === null) ? <p role="status" className="bar-notice">{text('Some stock balances are unavailable.', 'Sesetengah baki stok tidak tersedia.')}</p> : null}
      <div className="overflow-hidden rounded-lg border border-line bg-white/80 shadow-none sm:hidden">
        <table className="dense-table w-full table-fixed text-left text-xs">
          <thead className="bg-paper">
            <tr>
              <th className="w-[44%] p-2">{text('Product', 'Produk')}</th>
              <th className="w-[25%] p-2">{text('Balance (Units)', 'Baki (Unit)')}</th>
              <th className="w-[31%] p-2">{text('Low Alert (Units)', 'Amaran Rendah (Unit)')}</th>
            </tr>
          </thead>
          <tbody>
        {rows.map((row) => {
          const product = row.product, low = row.status === 'low';
          return (
            <tr key={product.id} data-stock-product={product.id} className="border-t border-line">
              <td className="p-2 align-top">
                <p className="font-semibold [overflow-wrap:anywhere]">{product.name}</p>
                <p className="mt-0.5 text-xs text-muted [overflow-wrap:anywhere]">{barCategoryLabel(product.categories?.name, text)}</p>
              </td>
              <td className={`p-2 align-top font-semibold leading-tight [overflow-wrap:anywhere] ${low ? 'text-warning' : ''}`}>
                {balance(row)}
              </td>
              <td className="p-2 align-top leading-tight">
                <p className="font-semibold">{row.threshold === null ? '-' : row.threshold}</p>
                <div className="mt-1">{status(row)}</div>
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
              <th className="p-3">{text('Balance (Units)', 'Baki (Unit)')}</th>
              <th className="p-3">{text('Low Alert (Units)', 'Amaran Rendah (Unit)')}</th>
              <th className="p-3">{text('Status', 'Status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const product = row.product, low = row.status === 'low';
              return (
                <tr key={product.id} data-stock-product={product.id} className="border-t border-line">
                  <td className="p-3 font-semibold [overflow-wrap:anywhere]">{product.name}</td>
                  <td className="p-3 [overflow-wrap:anywhere]">{barCategoryLabel(product.categories?.name, text)}</td>
                  <td className={`p-3 font-bold ${low ? 'text-warning' : ''}`}>
                    {balance(row)}
                  </td>
                  <td className="p-3">{row.threshold === null ? '-' : row.threshold}</td>
                  <td className="p-3">{status(row)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!rows.length ? <p className="py-4 text-sm text-muted">{text('No products yet.', 'Belum ada produk.')}</p> : null}
      </>}
    </>
  );
}
