import { useLanguage } from '../../lib/language';
import type { DeliveryBatchRecord } from '../../lib/platformTypes';
import { deliveryPurchaseLabel, deliveryStockLabel } from '../../lib/deliveryEntry';

export function deliveryTime(value: string, language: string) {
  return new Intl.DateTimeFormat(language === 'ms' ? 'ms-MY' : 'en-GB', {
    timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}

export function DeliveryRecord({ record }: { record: DeliveryBatchRecord }) {
  const { text, language } = useLanguage();
  return <div className="min-w-0">
    <p className="break-words text-sm font-semibold">{record.confirmed_by_name ?? text('Name Not Recorded', 'Nama Tidak Direkod')}</p>
    <p className="mt-1 text-xs text-muted">{deliveryTime(record.confirmed_at, language)} MYT</p>
    <table className="dense-table mt-3 w-full table-fixed text-left text-sm">
      <thead><tr><th>{text('Inventory Item', 'Item Inventori')}</th><th className="w-28 text-right">{text('Stock Added', 'Stok Masuk')}</th></tr></thead>
      <tbody>{record.receipts.map(receipt => <tr key={receipt.id}>
        <td className="break-words font-semibold">{receipt.ingredient_name ?? text('Name Not Recorded', 'Nama Tidak Direkod')}
          <p className="mt-1 text-xs font-normal text-muted">{deliveryPurchaseLabel(receipt.purchase_quantity, receipt.purchase_unit ?? '', receipt.base_per_unit ?? null, receipt.base_unit,receipt.display_unit,receipt.display_factor)}</p>
        </td>
        <td className="break-words text-right font-semibold text-palm tabular">+{deliveryStockLabel(receipt.base_quantity, receipt.base_unit,receipt.display_unit,receipt.display_factor)}</td>
      </tr>)}</tbody>
    </table>
    {record.receipts.some(receipt => receipt.details_backfilled) ? <p className="mt-3 text-xs text-muted">{text('Older receipt: some names were recovered later. Stock quantities are the original recorded amounts.', 'Resit lama: sesetengah nama dipulihkan kemudian. Kuantiti stok ialah jumlah asal yang direkodkan.')}</p> : null}
    <p className="mt-3 break-all text-[11px] text-muted">{text('Record ID', 'ID Rekod')}: {record.id}</p>
  </div>;
}
