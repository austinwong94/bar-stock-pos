import { RefreshCw } from 'lucide-react';
import { secondaryButtonClass } from './Form';
import { useLanguage } from '../lib/language';
import { money } from '../lib/format';
import type { useSaleAction } from '../lib/useSaleAction';

export function SaleActionRecovery({action, currency}: {action: ReturnType<typeof useSaleAction>; currency: string}) {
  const {text} = useLanguage(), pending = action.pending;
  if (!pending && !action.error) return null;
  const label = pending?.args.p_action === 'void' ? text('Void Sale', 'Batalkan Jualan') : pending?.args.p_action === 'verified' ? text('Verify QR', 'Sahkan QR') : text('QR Mismatch', 'QR Tidak Sepadan');
  return <section role="alert" className="bar-sale-recovery mb-3 grid min-w-0 gap-3 rounded-lg border border-warning bg-amber-50 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
    <div className="min-w-0">
      <h2 className="text-sm font-semibold">{text('Sale Action Pending', 'Tindakan Jualan Belum Disahkan')}</h2>
      {pending ? <><p className="break-words text-sm font-semibold">{pending.summary.saleNumber} · {label} · {money(pending.summary.amount, currency)}</p><p className="text-xs text-muted">{pending.summary.businessDate} · {new Date(pending.createdAt).toLocaleString(text('en-MY','ms-MY'),{timeZone:'Asia/Kuala_Lumpur',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})} MYT</p>{pending.args.p_reason ? <p className="mt-1 break-words text-sm">{text('Reason', 'Sebab')}: {pending.args.p_reason}</p> : null}</> : null}
      <p className="mt-1 break-words text-sm">{action.error ? text('Keep this device. Ask the owner to check the original action.', 'Simpan peranti ini. Minta pemilik menyemak tindakan asal.') : text('Check this action before making another change.', 'Semak tindakan ini sebelum membuat perubahan lain.')}</p>
    </div>
    {pending ? <button type="button" className={secondaryButtonClass} disabled={action.busy || !action.canRetry} onClick={() => void action.retry()}><RefreshCw size={16}/>{action.busy ? text('Checking...', 'Menyemak...') : text('Check Sale Action', 'Semak Tindakan Jualan')}</button> : null}
  </section>;
}
