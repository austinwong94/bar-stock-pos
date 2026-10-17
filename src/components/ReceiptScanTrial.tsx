import { useState } from 'react';
import { ScanLine } from 'lucide-react';
import { secondaryButtonClass } from './Form';
import { isDemoMode, supabase } from '../lib/supabase';
import { useLanguage } from '../lib/language';
import { readErrorMessage } from '../lib/opsData';
import { receiptDifference, type ReceiptScan } from '../lib/purchaseEvidence';

export function ReceiptScanTrial({ recordId, total }: { recordId: string; total: number }) {
  const { text } = useLanguage();
  const [scan, setScan] = useState<ReceiptScan | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function run() {
    if (busy) return;
    setError('');
    if (isDemoMode) { setError(text('AI scanning is not connected in this review. No API charges and no stock changes.', 'Imbasan AI belum disambungkan dalam pratonton ini. Tiada caj API atau perubahan stok.')); return; }
    setBusy(true);
    try {
      const result = await supabase.functions.invoke('scan-purchase-receipt', { body: { record_id: recordId } });
      if (result.error) {
        const details = await result.error.context?.json?.().catch(() => null);
        throw new Error(details?.error || result.error.message);
      }
      if (!result.data?.extraction) throw new Error('No readable scan was returned.');
      setScan(result.data.extraction);
    } catch (e) { setError(readErrorMessage(e, text('Scan unavailable. Manual record is unchanged.', 'Imbasan tidak tersedia. Rekod manual tidak berubah.'))); }
    finally { setBusy(false); }
  }
  const difference = scan ? receiptDifference(String(total), scan) : null;
  return <section className="mt-3 border-t border-line pt-3">
    <button type="button" className={secondaryButtonClass} onClick={() => void run()} disabled={busy}><ScanLine size={16}/>{busy ? text('Scanning...', 'Mengimbas...') : text('AI Receipt Check (Trial)', 'Semak Resit AI (Percubaan)')}</button>
    {error ? <p role="status" className="mt-2 text-xs text-muted">{error}</p> : null}
    {scan ? <div className="mt-3 grid gap-2 text-sm">
      <p className="font-semibold">{text('AI Comparison · Manual Record Unchanged', 'Perbandingan AI · Rekod Manual Tidak Berubah')}</p>
      <p className="break-words">{scan.supplier ?? '—'} · {scan.date ?? '—'} · {scan.receipt_no ?? '—'}</p>
      <p className="text-xs text-muted">{text('Subtotal', 'Subtotal')}: {scan.subtotal?.toFixed(2) ?? '?'} · {text('Tax', 'Cukai')}: {scan.tax?.toFixed(2) ?? '?'} · {text('Discount', 'Diskaun')}: {scan.discount?.toFixed(2) ?? '?'}</p>
      <table className="dense-table w-full table-fixed text-left text-xs"><thead><tr><th>{text('Receipt Item', 'Item Resit')}</th><th className="w-20 text-right">{text('Quantity', 'Kuantiti')}</th><th className="w-20 text-right">{scan.currency ?? '?'}</th></tr></thead><tbody>{scan.items.map((item, i) => <tr key={i}><td className="break-words">{item.description}</td><td className="break-words text-right">{item.quantity ?? '?'} {item.unit}</td><td className="text-right">{item.amount?.toFixed(2) ?? '?'}</td></tr>)}</tbody></table>
      <div className="grid grid-cols-2 gap-2 border-t border-line pt-2"><p>{text('Manual Total', 'Jumlah Manual')}<strong className="block">MYR {total.toFixed(2)}</strong></p><p>{text('AI Total', 'Jumlah AI')}<strong className="block">{scan.currency ?? '?'} {scan.total?.toFixed(2) ?? '?'}</strong></p></div>
      <p className={difference === 0 && scan.currency === 'MYR' ? 'text-palm' : 'text-warning'}>{scan.currency !== 'MYR' || difference === null ? text('Total or currency needs checking.', 'Jumlah atau mata wang perlu disemak.') : difference === 0 ? text('Totals match. Check the items too.', 'Jumlah sepadan. Semak item juga.') : text(`Difference: MYR ${difference.toFixed(2)}. Check the receipt.`, `Perbezaan: MYR ${difference.toFixed(2)}. Semak resit.`)}</p>
      {scan.warnings.map((warning, i) => <p className="break-words text-xs text-warning" key={i}>{warning}</p>)}
    </div> : null}
  </section>;
}
