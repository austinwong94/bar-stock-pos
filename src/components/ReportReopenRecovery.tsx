import { RefreshCw } from 'lucide-react';
import { secondaryButtonClass } from './Form';
import { useLanguage } from '../lib/language';
import type { useReportReopen } from '../lib/useReportReopen';

export function ReportReopenRecovery({action}: {action: ReturnType<typeof useReportReopen>}) {
  const {text} = useLanguage(), pending = action.pending;
  if (!pending && !action.error) return null;
  return <section role="alert" className="bar-reopen-recovery mb-3 grid min-w-0 gap-3 rounded-lg border border-warning bg-amber-50 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
    <div className="min-w-0">
      <h2 className="text-sm font-semibold">{text('Report Reopening Pending', 'Pembukaan Semula Laporan Belum Disahkan')}</h2>
      {pending ? <p className="mt-1 break-words text-xs text-muted">{pending.args.p_business_date} · {new Date(pending.createdAt).toLocaleString(text('en-MY','ms-MY'), {timeZone:'Asia/Kuala_Lumpur',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})} MYT</p> : null}
      <p className="mt-1 break-words text-sm">{action.error ? text('Keep this device. Ask the owner to check the original reopening.', 'Simpan peranti ini. Minta pemilik menyemak pembukaan semula asal.') : text('Your original request is kept. Check it before editing or closing this report.', 'Permintaan asal dikekalkan. Semak sebelum menyunting atau menutup laporan ini.')}</p>
    </div>
    {pending ? <button type="button" className={`${secondaryButtonClass} min-h-11 justify-center whitespace-normal`} disabled={action.busy || !action.canRetry} onClick={() => void action.retry()}><RefreshCw size={16} className="shrink-0"/>{action.busy ? text('Checking...', 'Menyemak...') : text('Check Report Reopening', 'Semak Pembukaan Semula')}</button> : null}
  </section>;
}
