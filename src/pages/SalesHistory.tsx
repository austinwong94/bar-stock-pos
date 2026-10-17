import { useEffect, useMemo, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { AlertTriangle, Ban, CheckCircle2, Eye, ReceiptText } from 'lucide-react';
import { Field, buttonClass, dangerButtonClass, inputClass, secondaryButtonClass } from '../components/Form';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/Page';
import { readClosingSnapshot } from '../lib/barClosing';
import { useToast } from '../components/Toast';
import { malaysiaBusinessDateInputValue, money } from '../lib/format';
import { supabase } from '../lib/supabase';
import { isSupabaseConfigured } from '../lib/supabase';
import { loadLocalSaleItems, loadLocalSales, updateLocalQrPayment, voidLocalSale } from '../lib/localStore';
import type { PaymentMethod, Sale, SaleItem, SettingsMap } from '../lib/types';
import { useLanguage } from '../lib/language';
import { assetPath } from '../lib/assets';
import { useSharedRefresh } from '../lib/useSharedRefresh';

type SaleWithItems = Sale & { sale_items?: SaleItem[] };
type MethodFilter = PaymentMethod | 'all';

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function paymentMethodLabel(method: PaymentMethod, translate: (en: string, ms: string) => string) {
  if (method === 'cash') return translate('Cash Payment', 'Bayaran Tunai');
  if (method === 'qr') return translate('QR Payment', 'Bayaran QR');
  return translate('Complimentary (FOC)', 'Percuma (FOC)');
}

function paymentMethodCompactLabel(method: PaymentMethod, translate: (en: string, ms: string) => string) {
  if (method === 'cash') return translate('Cash Payment', 'Bayaran Tunai');
  if (method === 'qr') return translate('QR Payment', 'Bayaran QR');
  return 'FOC';
}

function paymentTone(method: PaymentMethod) {
  if (method === 'cash') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (method === 'qr') return 'border-sky-200 bg-sky-50 text-sky-700';
  return 'border-line bg-shell text-coral';
}

function statusTone(status: Sale['status']) {
  return status === 'completed'
    ? 'bg-shell text-accent'
    : 'bg-red-50 text-danger';
}

function statusLabel(status: Sale['status'], translate: (en: string, ms: string) => string) {
  return status === 'completed' ? translate('Completed', 'Selesai') : translate('Voided', 'Dibatalkan');
}

function qrStatusLabel(status: string | null | undefined, translate: (en: string, ms: string) => string) {
  if (status === 'pending') return translate('Pending', 'Belum disahkan');
  if (status === 'verified') return translate('Verified', 'Disahkan');
  if (status === 'mismatch') return translate('Mismatch', 'Tidak sepadan');
  return '-';
}

function qrStatusTone(status: string | null | undefined) {
  if (status === 'verified') return 'bg-shell text-accent';
  if (status === 'mismatch') return 'bg-amber-50 text-warning';
  if (status === 'pending') return 'bg-pink-100 text-coral';
  return 'bg-white text-neutral-600';
}

function saleDateLabel(date: string) {
  return format(parseISO(date), 'EEE, d MMM yyyy');
}

function saleCalendarDate(sale: Sale) {
  return sale.business_date;
}

function itemName(item: SaleItem) {
  return item.products?.name ?? item.custom_item_name ?? item.product_id ?? 'Custom Order';
}

export default function SalesHistory({ settings, embedded = false }: { settings: SettingsMap; embedded?: boolean }) {
  const toast = useToast();
  const { text } = useLanguage();
  const [date, setDate] = useState(() => malaysiaBusinessDateInputValue(new Date(), settings.business_day_close_time));
  const [method, setMethod] = useState<MethodFilter>('all');
  const [sales, setSales] = useState<SaleWithItems[]>([]);
  const [voiding, setVoiding] = useState<Sale | null>(null);
  const [reason, setReason] = useState('');
  const [receiptPreview, setReceiptPreview] = useState<{ sale: Sale; url: string } | null>(null);
  const [voidSaving, setVoidSaving] = useState(false);
  const [verifyingSaleKey, setVerifyingSaleKey] = useState<string | null>(null);
  const [loadingReceiptId, setLoadingReceiptId] = useState<string | null>(null);
  const [readError,setReadError]=useState(''),[reading,setReading]=useState(true);
  const generation=useRef(0);

  async function refresh() {
    const ticket=++generation.current;
    try {
    if (!isSupabaseConfigured) {
      const localSales = loadLocalSales();
      const localSaleItems = loadLocalSaleItems();
      setSales(
        localSales
          .filter((sale) => sale.business_date === date)
          .filter((sale) => method === 'all' || sale.payment_method === method)
          .map((sale) => ({ ...sale, sale_items: localSaleItems.filter((item) => item.sale_id === sale.id) })),
      );
      setReading(false);setReadError('');
      return;
    }
    const snapshot=await readClosingSnapshot(supabase,date);
    if(ticket!==generation.current)return;
    setSales(snapshot.sales.filter(s=>method==='all'||s.payment_method===method).sort((a,b)=>b.created_at.localeCompare(a.created_at)));
    setReadError('');
    }catch(e){if(ticket===generation.current)setReadError((e as Error).message||'Sales could not be loaded.');}
    finally{if(ticket===generation.current)setReading(false);}
  }

  useEffect(() => {
    setReading(true);
    void refresh();
    return()=>{generation.current++;};
  }, [date, method]);

  useSharedRefresh(refresh, {
    tables: ['sales', 'sale_items', 'stock_movements'],
    intervalMs: 12000,
  });

  const totals = useMemo(() => {
    const completed = sales.filter((sale) => sale.status === 'completed');
    return {
      cash: completed.reduce((sum, sale) => sum + (sale.payment_method === 'cash' ? Number(sale.paid_amount) : 0), 0),
      qr: completed.reduce((sum, sale) => sum + (sale.payment_method === 'qr' ? Number(sale.paid_amount) : 0), 0),
      focCost: completed.reduce((sum, sale) => sum + (sale.payment_method === 'complimentary' ? Number(sale.total_amount) : 0), 0),
      revenue: completed.reduce((sum, sale) => sum + (sale.payment_method === 'complimentary' ? 0 : Number(sale.paid_amount)), 0),
      transactions: completed.length,
      voided: sales.filter((sale) => sale.status === 'voided').length,
    };
  }, [sales]);

  async function voidSale() {
    if (!voiding || !reason.trim()) return;
    if (voidSaving) return;
    setVoidSaving(true);
    if (!isSupabaseConfigured) {
      const updatedSale = voidLocalSale(voiding.id, reason.trim());
      if (!updatedSale) {
        setVoidSaving(false);
        toast.error(text('Sale could not be voided.', 'Jualan tidak dapat dibatalkan.'));
        return;
      }
      setVoiding(null);
      setReason('');
      await refresh();
      setVoidSaving(false);
      toast.success(text('Sale voided and stock reversed locally.', 'Jualan dibatalkan dan stok dibalikkan pada peranti ini.'));
      return;
    }
    const { error } = await supabase.rpc('void_sale', { p_sale_id: voiding.id, p_reason: reason });
    if (error) {
      setVoidSaving(false);
      toast.error(error.message);
      return;
    }
    setVoiding(null);
    setReason('');
    await refresh();
    setVoidSaving(false);
    toast.success(text('Sale voided and stock reversed.', 'Jualan dibatalkan dan stok dibalikkan.'));
  }

  async function verifyQr(sale: Sale, status: 'verified' | 'mismatch') {
    const actionKey = `${sale.id}:${status}`;
    if (verifyingSaleKey) return;
    setVerifyingSaleKey(actionKey);
    if (!isSupabaseConfigured) {
      updateLocalQrPayment(sale.id, status);
      await refresh();
      setVerifyingSaleKey(null);
      toast.success(text('QR Payment status updated on this device.', 'Status Bayaran QR dikemas kini pada peranti ini.'));
      return;
    }
    const { error } = await supabase.rpc('verify_qr_payment', {
      p_sale_id: sale.id,
      p_status: status,
      p_notes: null,
    });
    if (error) {
      setVerifyingSaleKey(null);
      toast.error(error.message);
      return;
    }
    await refresh();
    setVerifyingSaleKey(null);
    toast.success(text('QR Payment status updated.', 'Status Bayaran QR dikemas kini.'));
  }

  async function viewQrReceipt(sale: Sale) {
    if (loadingReceiptId) return;
    const path = sale.qr_receipt_image_path;
    if (!path) {
      toast.error(text('No QR Payment receipt image attached to this sale.', 'Tiada gambar resit Bayaran QR dilampirkan pada jualan ini.'));
      return;
    }
    if (path.startsWith('http') || path.startsWith('data:')) {
      setReceiptPreview({ sale, url: path });
      return;
    }
    if (path.startsWith('demo/')) {
      setReceiptPreview({ sale, url: assetPath('assets/qr-receipt-demo.svg') });
      return;
    }
    setLoadingReceiptId(sale.id);
    const { data, error } = await supabase.storage.from('payment-receipts').createSignedUrl(path, 60 * 5);
    setLoadingReceiptId(null);
    if (error || !data?.signedUrl) {
      toast.error(error?.message ?? text('Could not open QR Payment receipt image.', 'Tidak dapat buka gambar resit Bayaran QR.'));
      return;
    }
    setReceiptPreview({ sale, url: data.signedUrl });
  }

  if(reading||readError)return <><PageHeader title={text('Sales History','Sejarah Jualan')}/><p role={readError?'alert':'status'} className="my-3 text-sm">{readError||text('Loading Sales...','Memuatkan Jualan...')}</p>{readError?<button className={secondaryButtonClass} onClick={()=>void refresh()}>{text('Retry','Cuba Lagi')}</button>:null}</>;

  return (
    <>
      {embedded ? null : <PageHeader title={text('Sales History', 'Sejarah Jualan')} />}

      <section className="mb-4 grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-5">
        <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 shadow-none sm:rounded-xl sm:p-4 lg:p-5">
          <p className="text-xs font-semibold text-violet-700 sm:text-sm">{text('Total Revenue', 'Jumlah Hasil')}</p>
          <p className="mt-1.5 text-lg font-semibold sm:text-xl lg:text-2xl">{money(totals.revenue, String(settings.currency_symbol))}</p>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 shadow-none sm:rounded-xl sm:p-4 lg:p-5">
          <p className="text-xs font-semibold text-emerald-700 sm:text-sm">{text('Cash Payment', 'Bayaran Tunai')} 💵</p>
          <p className="mt-1.5 text-lg font-semibold sm:text-xl lg:text-2xl">{money(totals.cash, String(settings.currency_symbol))}</p>
        </div>
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 shadow-none sm:rounded-xl sm:p-4 lg:p-5">
          <p className="text-xs font-semibold text-sky-700 sm:text-sm">{text('QR Payment', 'Bayaran QR')} 📱</p>
          <p className="mt-1.5 text-lg font-semibold sm:text-xl lg:text-2xl">{money(totals.qr, String(settings.currency_symbol))}</p>
        </div>
        <div className="rounded-lg border border-line bg-shell p-3 shadow-none sm:rounded-xl sm:p-4 lg:p-5">
          <p className="text-xs font-semibold text-accent sm:text-sm">{text('FOC Value', 'Nilai FOC')} 🎁</p>
          <p className="mt-1.5 text-lg font-semibold text-coral sm:text-xl lg:text-2xl">{money(totals.focCost, String(settings.currency_symbol))}</p>
        </div>
        <div className="rounded-lg border border-line bg-white/85 p-3 shadow-none sm:rounded-xl sm:p-4 lg:p-5">
          <p className="text-xs font-semibold text-neutral-600 sm:text-sm">{text('Transactions', 'Transaksi')}</p>
          <p className="mt-1.5 text-lg font-semibold sm:text-xl lg:text-2xl">{totals.transactions}</p>
        </div>
      </section>

      <section className="island-panel mb-4 rounded-lg p-3 sm:mb-5 sm:rounded-xl sm:p-5">
        <div className="grid gap-3 lg:grid-cols-[280px_1fr] lg:items-end">
          <Field label={text('Business date', 'Tarikh bisnes')}>
            <input className={inputClass} type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </Field>
          <div>
            <p className="mb-2 text-sm font-semibold">{text('Payment method', 'Kaedah bayaran')}</p>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-white/80 p-1 text-xs font-semibold sm:grid-cols-4 sm:text-sm">
              {([
                ['all', text('All', 'Semua')],
                ['cash', text('Cash Payment', 'Bayaran Tunai')],
                ['qr', text('QR Payment', 'Bayaran QR')],
                ['complimentary', 'FOC'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`min-h-9 rounded-xl px-2 py-1.5 text-center sm:min-h-11 sm:px-3 sm:py-2 ${method === value ? 'bg-accent text-white' : 'text-ink'}`}
                  onClick={() => setMethod(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3">
        {sales.length === 0 ? (
          <div className="island-panel rounded-lg p-4 text-center sm:rounded-xl sm:p-6">
            <ReceiptText className="mx-auto h-10 w-10 text-accent" />
            <p className="mt-3 text-base font-semibold sm:text-lg">{text('No sales found for', 'Tiada jualan untuk')} {saleDateLabel(date)}.</p>
            <p className="mt-1 text-sm font-bold text-neutral-600">{text('Try another date or payment method.', 'Cuba tarikh atau kaedah bayaran lain.')}</p>
          </div>
        ) : null}

        {sales.length > 0 ? (
          <>
          <div className="overflow-hidden rounded-lg border border-line bg-white/85 shadow-none xl:hidden">
            <table className="dense-table w-full table-fixed text-left text-[11px]">
              <thead className="bg-paper">
                <tr>
                  <th className="w-[40%] p-2">{text('Sale', 'Jualan')}</th>
                  <th className="w-[23%] p-2">{text('Method', 'Kaedah')}</th>
                  <th className="w-[21%] p-2">{text('Amount', 'Amaun')}</th>
                  <th className="w-[16%] p-2">{text('Action', 'Tindakan')}</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((sale) => {
                  const isFoc = sale.payment_method === 'complimentary';
                  const isQr = sale.payment_method === 'qr';
                  const hasReceipt = Boolean(sale.qr_receipt_image_path);
                  const items = sale.sale_items ?? [];
                  const isQrUpdating = verifyingSaleKey?.startsWith(`${sale.id}:`) ?? false;
                  const isReceiptLoading = loadingReceiptId === sale.id;
                  const itemSummary = items
                    .slice(0, 2)
                    .map((item) => `${itemName(item)} x ${item.quantity}`)
                    .join(', ');
                  return (
                    <tr key={`mobile-${sale.id}`} className="border-t border-line align-top">
                      <td className="p-2">
                        <p className="truncate font-semibold">{sale.sale_number}</p>
                        <p className="mt-0.5 truncate text-[10px] font-bold text-neutral-600">{format(parseISO(saleCalendarDate(sale)), 'd MMM')} · {sale.order_taken_by ?? '-'}</p>
                        <p className="mt-1 line-clamp-2 text-[10px] font-bold text-neutral-700">
                          {itemSummary || '-'}{items.length > 2 ? ` +${items.length - 2}` : ''}
                        </p>
                        {isQr ? <p className="mt-1 truncate text-[10px] font-bold text-sky-700">{sale.qr_payment_type ?? 'QR'} · {sale.qr_reference ?? '-'}</p> : null}
                      </td>
                      <td className="p-2">
                        <span className={`inline-flex max-w-full rounded-full border px-1.5 py-0.5 text-[9px] font-semibold leading-tight ${paymentTone(sale.payment_method)}`}>
                          <span className="line-clamp-2">{paymentMethodCompactLabel(sale.payment_method, text)}</span>
                        </span>
                        <span className={`mt-1 inline-flex max-w-full rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-tight ${statusTone(sale.status)}`}>
                          {statusLabel(sale.status, text)}
                        </span>
                        {isQr ? <span className={`mt-1 inline-flex max-w-full rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-tight ${qrStatusTone(sale.qr_status)}`}>{qrStatusLabel(sale.qr_status, text)}</span> : null}
                      </td>
                      <td className="p-2 font-bold leading-tight">
                        <span className={`block whitespace-nowrap text-[11px] font-semibold ${isFoc ? 'text-coral' : 'text-ink'}`}>
                          {isFoc ? '- ' : ''}{money(isFoc ? sale.total_amount : sale.paid_amount, String(settings.currency_symbol))}
                        </span>
                        {Number(sale.discount_amount ?? 0) > 0 ? (
                          <span className="mt-1 block whitespace-nowrap text-[10px] text-warning">- {money(sale.discount_amount, String(settings.currency_symbol))}</span>
                        ) : null}
                        <span className="mt-1 block text-[10px] text-neutral-600">{countLabel(items.reduce((sum, item) => sum + Number(item.quantity), 0), text('Unit', 'Unit'), text('Units', 'Unit'))}</span>
                      </td>
                      <td className="p-2">
                        {sale.status === 'completed' ? (
                          <div className="grid grid-cols-2 gap-1">
                            {isQr ? (
                              <>
                                <button type="button" className="grid h-8 w-8 place-items-center rounded-xl border border-line bg-white text-ink shadow-none disabled:opacity-40" disabled={!hasReceipt || isReceiptLoading} onClick={() => viewQrReceipt(sale)} aria-label={text('View QR Payment receipt image', 'Lihat gambar resit Bayaran QR')}><Eye className="h-4 w-4" /></button>
                                <button type="button" className="grid h-8 w-8 place-items-center rounded-xl border border-line bg-white text-accent shadow-none disabled:opacity-40" disabled={sale.qr_status === 'verified' || isQrUpdating} onClick={() => verifyQr(sale, 'verified')} aria-label={text('Verify QR Payment', 'Sahkan Bayaran QR')}><CheckCircle2 className="h-4 w-4" /></button>
                                <button type="button" className="grid h-8 w-8 place-items-center rounded-xl border border-line bg-white text-warning shadow-none disabled:opacity-40" disabled={sale.qr_status === 'mismatch' || isQrUpdating} onClick={() => verifyQr(sale, 'mismatch')} aria-label={text('Mark QR Payment mismatch', 'Tanda Bayaran QR tidak sepadan')}><AlertTriangle className="h-4 w-4" /></button>
                              </>
                            ) : null}
                            <button type="button" className="grid h-8 w-8 place-items-center rounded-xl border border-red-100 bg-red-50 text-danger shadow-none disabled:opacity-40" disabled={voidSaving || isQrUpdating} onClick={() => setVoiding(sale)} aria-label={text('Void sale', 'Batalkan jualan')}><Ban className="h-4 w-4" /></button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="clean-scroll hidden overflow-x-auto rounded-lg border border-line bg-white/85 shadow-none sm:rounded-xl xl:block">
            <table className="dense-table w-full min-w-[1120px] text-left text-xs sm:text-sm">
              <thead className="bg-paper">
                <tr>
                  <th className="p-3 whitespace-nowrap">{text('Sale', 'Jualan')}</th>
                  <th className="p-3 whitespace-nowrap">{text('Date / Staff', 'Tarikh / Staf')}</th>
                  <th className="p-3 whitespace-nowrap">{text('Method', 'Kaedah')}</th>
                  <th className="p-3 whitespace-nowrap">{text('Status', 'Status')}</th>
                  <th className="p-3 whitespace-nowrap">{text('Items', 'Item')}</th>
                  <th className="p-3 whitespace-nowrap">{text('Discount', 'Diskaun')}</th>
                  <th className="p-3 whitespace-nowrap">{text('Total', 'Jumlah')}</th>
                  <th className="p-3 whitespace-nowrap">{text('QR details', 'Butiran QR')}</th>
                  <th className="p-3 whitespace-nowrap">{text('Receipt photo', 'Gambar resit')}</th>
                  <th className="p-3 whitespace-nowrap">{text('QR status', 'Status QR')}</th>
                  <th className="p-3 whitespace-nowrap">{text('Action', 'Tindakan')}</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((sale) => {
                  const isFoc = sale.payment_method === 'complimentary';
                  const isQr = sale.payment_method === 'qr';
                  const hasReceipt = Boolean(sale.qr_receipt_image_path);
                  const isQrUpdating = verifyingSaleKey?.startsWith(`${sale.id}:`) ?? false;
                  const isReceiptLoading = loadingReceiptId === sale.id;
                  const items = (sale.sale_items ?? [])
                    .map((item) => `${itemName(item)} x ${item.quantity} @ ${money(item.unit_price, String(settings.currency_symbol))} = ${money(item.line_total, String(settings.currency_symbol))}`)
                    .join(', ');
                  return (
                    <tr key={sale.id} className="border-t border-line align-top">
                      <td className="p-3 font-semibold whitespace-nowrap">{sale.sale_number}</td>
                      <td className="p-3 whitespace-nowrap">
                        <span className="block font-bold">{saleDateLabel(saleCalendarDate(sale))}</span>
                        <span className="block text-xs font-bold text-neutral-600">{sale.order_taken_by ?? '-'}</span>
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${paymentTone(sale.payment_method)}`}>
                          {paymentMethodLabel(sale.payment_method, text)}
                        </span>
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(sale.status)}`}>
                          {statusLabel(sale.status, text)}
                        </span>
                      </td>
                      <td className="max-w-[300px] p-3 text-xs font-bold leading-relaxed sm:text-sm">{items || '-'}</td>
                      <td className="p-3 whitespace-nowrap">
                        {Number(sale.discount_amount ?? 0) > 0 ? `- ${money(sale.discount_amount, String(settings.currency_symbol))}` : '-'}
                      </td>
                      <td className={`p-3 font-semibold whitespace-nowrap ${isFoc ? 'text-coral' : 'text-ink'}`}>
                        {isFoc ? '- ' : ''}{money(isFoc ? sale.total_amount : sale.paid_amount, String(settings.currency_symbol))}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        {isQr ? (
                          <span className="grid gap-0.5">
                            <span className="font-bold">{sale.qr_payment_type ?? '-'}</span>
                            <span className="text-xs font-bold text-neutral-600">{text('Ref', 'Rujukan')}: {sale.qr_reference ?? '-'}</span>
                          </span>
                        ) : '-'}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        {isQr ? (
                          <div className="grid gap-1">
                            <button className={`${secondaryButtonClass} dense-action justify-center`} disabled={!hasReceipt || isReceiptLoading} onClick={() => viewQrReceipt(sale)}>
                              <Eye className="h-3.5 w-3.5" />
                              {isReceiptLoading ? text('Loading', 'Memuat') : text('View image', 'Lihat gambar')}
                            </button>
                            <span className={`text-[0.68rem] font-semibold ${hasReceipt ? 'text-accent' : 'text-coral'}`}>
                              {hasReceipt ? text('Photo attached', 'Gambar ada') : text('No photo attached', 'Tiada gambar')}
                            </span>
                          </div>
                        ) : '-'}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        {isQr ? <span className={`rounded-xl px-2.5 py-1 text-[0.68rem] font-semibold ${qrStatusTone(sale.qr_status)}`}>{qrStatusLabel(sale.qr_status, text)}</span> : '-'}
                      </td>
                      <td className="p-3">
                        {sale.status === 'completed' ? (
                          <div className="flex flex-wrap gap-2">
                            {isQr ? (
                              <>
                                <button className={`${secondaryButtonClass} min-h-9 rounded-xl px-3 py-1.5 text-xs`} disabled={sale.qr_status === 'verified' || isQrUpdating} onClick={() => verifyQr(sale, 'verified')}>
                                  <CheckCircle2 className="h-4 w-4" />
                                  {verifyingSaleKey === `${sale.id}:verified` ? text('Updating', 'Mengemas kini') : text('Verify', 'Sahkan')}
                                </button>
                                <button className={`${secondaryButtonClass} min-h-9 rounded-xl px-3 py-1.5 text-xs`} disabled={sale.qr_status === 'mismatch' || isQrUpdating} onClick={() => verifyQr(sale, 'mismatch')}>
                                  {verifyingSaleKey === `${sale.id}:mismatch` ? text('Updating', 'Mengemas kini') : text('Mismatch', 'Tidak sepadan')}
                                </button>
                              </>
                            ) : null}
                            <button className={`${dangerButtonClass} min-h-9 rounded-xl px-3 py-1.5 text-xs`} disabled={voidSaving || isQrUpdating} onClick={() => setVoiding(sale)}>
                              <Ban className="h-4 w-4" />
                              {text('Void', 'Batal')}
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        ) : null}
      </section>

      {voiding ? (
        <Modal
          title={`${text('Void', 'Batal')} ${voiding.sale_number}`}
          onClose={() => { if (!voidSaving) setVoiding(null); }}
          footer={
            <div className="grid w-full gap-2 sm:flex sm:justify-end">
              <button className={secondaryButtonClass} disabled={voidSaving} onClick={() => setVoiding(null)}>{text('Cancel', 'Batal')}</button>
              <button className={dangerButtonClass} disabled={voidSaving || !reason.trim()} onClick={voidSale}>{voidSaving ? text('Voiding...', 'Membatalkan...') : text('Void sale', 'Batalkan jualan')}</button>
            </div>
          }
        >
          <Field label={text('Mandatory void reason', 'Sebab batal wajib diisi')}>
            <textarea className={inputClass} value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
        </Modal>
      ) : null}

      {receiptPreview ? (
        <Modal title={`${text('QR Payment Receipt', 'Resit Bayaran QR')} ${receiptPreview.sale.sale_number}`} onClose={() => setReceiptPreview(null)}>
          <p className="mb-3 text-sm font-bold text-neutral-700">
            {money(receiptPreview.sale.paid_amount, String(settings.currency_symbol))} · {receiptPreview.sale.qr_payment_type ?? '-'} · {text('Ref', 'Rujukan')}: {receiptPreview.sale.qr_reference ?? '-'} · {text('Staff', 'Staf')}: {receiptPreview.sale.order_taken_by ?? '-'}
          </p>
          <img src={receiptPreview.url} alt="QR Payment receipt" className="max-h-[70vh] w-full rounded-lg border border-line object-contain" />
        </Modal>
      ) : null}
    </>
  );
}
