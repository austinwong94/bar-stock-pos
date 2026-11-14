import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { Modal } from './Modal';
import { secondaryButtonClass } from './Form';
import { useLanguage } from '../lib/language';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { receiptSource, signedReceiptUrl, type HistorySale } from '../lib/barSalesHistory';
import { assetPath } from '../lib/assets';
import { money } from '../lib/format';

export function QrReceiptPreview({ sale, currency, onClose }: { sale: HistorySale; currency: string; onClose: () => void }) {
  const { text } = useLanguage();
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const [image, setImage] = useState({ ticket: 0, url: '', phase: 'url' as 'url' | 'image' | 'ready' | 'error' });
  useEffect(() => {
    let active = true;
    const ticket = ++generation.current;
    setImage({ ticket, url: '', phase: 'url' });
    void (async () => {
      const source = receiptSource(sale.qr_receipt_image_path, isSupabaseConfigured);
      let url: string;
      if (source.kind === 'local') url = source.path.startsWith('demo/') ? assetPath('assets/qr-receipt-demo.svg') : source.path;
      else {
        const result = await supabase.storage.from('payment-receipts').createSignedUrl(source.path, 300);
        if (result.error) throw result.error;
        url = signedReceiptUrl(result.data?.signedUrl, source.path);
      }
      if (active) setImage({ ticket, url, phase: 'image' });
    })().catch(() => { if (active) setImage({ ticket, url: '', phase: 'error' }); });
    return () => { active = false; generation.current++; };
  }, [sale.id, sale.qr_receipt_image_path, retry]);
  const result = (phase: 'ready' | 'error') => setImage(previous => previous.ticket === image.ticket && previous.url === image.url ? { ...previous, phase } : previous);
  const loading = image.phase === 'url' || image.phase === 'image';
  return <Modal title={text('QR Payment Receipt', 'Resit Bayaran QR') + ' · ' + sale.sale_number} onClose={onClose}>
    <dl className="mb-3 grid grid-cols-2 gap-2 text-sm">
      <div><dt className="text-xs text-muted">{text('Amount', 'Amaun')}</dt><dd className="font-semibold">{money(sale.paid_amount, currency)}</dd></div>
      <div><dt className="text-xs text-muted">{text('QR Type', 'Jenis QR')}</dt><dd>{sale.qr_payment_type || '-'}</dd></div>
      <div className="min-w-0"><dt className="text-xs text-muted">{text('Reference', 'Rujukan')}</dt><dd className="[overflow-wrap:anywhere]">{sale.qr_reference || '-'}</dd></div>
      <div className="min-w-0"><dt className="text-xs text-muted">{text('Staff', 'Staf')}</dt><dd className="[overflow-wrap:anywhere]">{sale.order_taken_by || '-'}</dd></div>
    </dl>
    <div data-qr-preview className="relative h-72 overflow-hidden rounded border border-line bg-shell sm:h-96" aria-busy={loading}>
      {image.url && image.phase !== 'error' ? <img key={image.ticket + ':' + image.url} src={image.url} alt={text('QR receipt for', 'Resit QR untuk') + ' ' + sale.sale_number} aria-hidden={image.phase !== 'ready'} className={'h-full w-full object-contain ' + (image.phase === 'ready' ? '' : 'invisible')} onLoad={() => result('ready')} onError={() => result('error')} /> : null}
      {loading ? <div role="status" className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-sm text-muted"><LoaderCircle size={20} className="animate-spin" />{text('Opening Receipt...', 'Membuka Resit...')}</div> : null}
      {image.phase === 'error' ? <div role="alert" className="absolute inset-0 grid content-center justify-items-center gap-2 p-3 text-center text-sm text-danger"><p>{text('Receipt image could not load.', 'Gambar resit tidak dapat dimuatkan.')}</p><button type="button" className={secondaryButtonClass} onClick={() => setRetry(value => value + 1)}><RefreshCw size={16} />{text('Retry Photo', 'Cuba Lagi Foto')}</button></div> : null}
    </div>
  </Modal>;
}
