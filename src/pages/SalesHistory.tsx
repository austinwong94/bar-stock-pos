import { useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Ban, CheckCircle2, ReceiptText } from 'lucide-react';
import { Field, buttonClass, dangerButtonClass, inputClass, secondaryButtonClass } from '../components/Form';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/Page';
import { useToast } from '../components/Toast';
import { money, todayInputValue } from '../lib/format';
import { supabase } from '../lib/supabase';
import { isSupabaseConfigured } from '../lib/supabase';
import { loadLocalSaleItems, loadLocalSales } from '../lib/localStore';
import type { PaymentMethod, Sale, SaleItem, SettingsMap } from '../lib/types';

type SaleWithItems = Sale & { sale_items?: SaleItem[] };
type MethodFilter = PaymentMethod | 'all';

function paymentMethodLabel(method: PaymentMethod) {
  if (method === 'cash') return 'Cash Payment';
  if (method === 'qr') return 'QR Payment';
  return 'Complimentary (FOC)';
}

function paymentTone(method: PaymentMethod) {
  if (method === 'cash') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (method === 'qr') return 'border-sky-200 bg-sky-50 text-sky-700';
  return 'border-pink-200 bg-pink-50 text-coral';
}

function statusTone(status: Sale['status']) {
  return status === 'completed'
    ? 'bg-teal-50 text-accent'
    : 'bg-red-50 text-danger';
}

function statusLabel(status: Sale['status']) {
  return status === 'completed' ? 'Completed' : 'Voided';
}

function saleDateLabel(date: string) {
  return format(parseISO(date), 'EEE, d MMM yyyy');
}

function itemName(item: SaleItem) {
  return item.products?.name ?? item.custom_item_name ?? item.product_id ?? 'Custom Order';
}

export default function SalesHistory({ settings, embedded = false }: { settings: SettingsMap; embedded?: boolean }) {
  const toast = useToast();
  const [date, setDate] = useState(isSupabaseConfigured ? todayInputValue() : '2026-05-03');
  const [method, setMethod] = useState<MethodFilter>('all');
  const [sales, setSales] = useState<SaleWithItems[]>([]);
  const [voiding, setVoiding] = useState<Sale | null>(null);
  const [reason, setReason] = useState('');

  async function refresh() {
    if (!isSupabaseConfigured) {
      const localSales = loadLocalSales();
      const localSaleItems = loadLocalSaleItems();
      setSales(
        localSales
          .filter((sale) => sale.business_date === date)
          .filter((sale) => method === 'all' || sale.payment_method === method)
          .map((sale) => ({ ...sale, sale_items: localSaleItems.filter((item) => item.sale_id === sale.id) })),
      );
      return;
    }
    let query = supabase
      .from('sales')
      .select('*, sale_items(*, products(name))')
      .eq('business_date', date)
      .order('created_at', { ascending: false });
    if (method !== 'all') query = query.eq('payment_method', method);
    const { data, error } = await query;
    if (error) toast.error(error.message);
    setSales((data ?? []) as SaleWithItems[]);
  }

  useEffect(() => {
    void refresh();
  }, [date, method]);

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
    if (!isSupabaseConfigured) {
      toast.error('Connect Supabase to void saved sales across devices.');
      return;
    }
    const { error } = await supabase.rpc('void_sale', { p_sale_id: voiding.id, p_reason: reason });
    if (error) {
      toast.error(error.message);
      return;
    }
    setVoiding(null);
    setReason('');
    await refresh();
    toast.success('Sale voided and stock reversed.');
  }

  async function verifyQr(sale: Sale, status: 'verified' | 'mismatch') {
    if (!isSupabaseConfigured) {
      toast.error(`Connect Supabase to mark QR Payment as ${status} across devices.`);
      return;
    }
    const { error } = await supabase.rpc('verify_qr_payment', {
      p_sale_id: sale.id,
      p_status: status,
      p_notes: null,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    await refresh();
    toast.success(`QR Payment marked ${status}.`);
  }

  return (
    <>
      {embedded ? null : <PageHeader title="Sales History / Sejarah Jualan" subtitle="Review completed sales, QR Payment status, staff, item details, and voids." />}

      <section className="mb-4 grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-5">
        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-3 shadow-soft sm:rounded-[1.5rem] sm:p-4 lg:p-5">
          <p className="text-xs font-black text-violet-700 sm:text-sm">Total Revenue</p>
          <p className="mt-1.5 text-lg font-black sm:text-xl lg:text-2xl">{money(totals.revenue, String(settings.currency_symbol))}</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 shadow-soft sm:rounded-[1.5rem] sm:p-4 lg:p-5">
          <p className="text-xs font-black text-emerald-700 sm:text-sm">Cash Payment 💵</p>
          <p className="mt-1.5 text-lg font-black sm:text-xl lg:text-2xl">{money(totals.cash, String(settings.currency_symbol))}</p>
        </div>
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3 shadow-soft sm:rounded-[1.5rem] sm:p-4 lg:p-5">
          <p className="text-xs font-black text-sky-700 sm:text-sm">QR Payment 📱</p>
          <p className="mt-1.5 text-lg font-black sm:text-xl lg:text-2xl">{money(totals.qr, String(settings.currency_symbol))}</p>
        </div>
        <div className="rounded-2xl border border-pink-200 bg-pink-50 p-3 shadow-soft sm:rounded-[1.5rem] sm:p-4 lg:p-5">
          <p className="text-xs font-black text-pink-700 sm:text-sm">FOC Cost 🎁</p>
          <p className="mt-1.5 text-lg font-black text-coral sm:text-xl lg:text-2xl">- {money(totals.focCost, String(settings.currency_symbol))}</p>
        </div>
        <div className="rounded-2xl border border-line bg-white/85 p-3 shadow-soft sm:rounded-[1.5rem] sm:p-4 lg:p-5">
          <p className="text-xs font-black text-neutral-600 sm:text-sm">Transactions</p>
          <p className="mt-1.5 text-lg font-black sm:text-xl lg:text-2xl">{totals.transactions}</p>
        </div>
      </section>

      <section className="island-panel mb-4 rounded-2xl p-3 sm:mb-5 sm:rounded-[2rem] sm:p-5">
        <div className="grid gap-3 lg:grid-cols-[280px_1fr] lg:items-end">
          <Field label="Business date">
            <input className={inputClass} type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </Field>
          <div>
            <p className="mb-2 text-sm font-semibold">Payment method</p>
            <div className="grid grid-cols-2 gap-1 rounded-2xl bg-white/80 p-1 text-xs font-black sm:grid-cols-4 sm:text-sm">
              {([
                ['all', 'All'],
                ['cash', 'Cash Payment'],
                ['qr', 'QR Payment'],
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
          <div className="island-panel rounded-2xl p-4 text-center sm:rounded-[2rem] sm:p-6">
            <ReceiptText className="mx-auto h-10 w-10 text-accent" />
            <p className="mt-3 text-base font-black sm:text-lg">No sales found for {saleDateLabel(date)}.</p>
            <p className="mt-1 text-sm font-bold text-neutral-600">Try another date or payment method.</p>
          </div>
        ) : null}

        {sales.map((sale) => {
          const isFoc = sale.payment_method === 'complimentary';
          return (
            <article key={sale.id} className="rounded-2xl border border-line bg-white/85 p-3 shadow-soft sm:rounded-[1.75rem] sm:p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-black leading-tight sm:text-xl">{sale.sale_number}</h2>
                    <span className={`rounded-full border px-3 py-1 text-xs font-black ${paymentTone(sale.payment_method)}`}>
                      {paymentMethodLabel(sale.payment_method)}
                    </span>
                    <span className={`rounded-full px-3 py-1 text-xs font-black ${statusTone(sale.status)}`}>
                      {statusLabel(sale.status)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-bold text-neutral-600">
                    {saleDateLabel(sale.business_date)} · Order taken by {sale.order_taken_by ?? '-'}
                  </p>
                  {sale.payment_method === 'qr' ? (
                    <p className="mt-1 text-sm font-bold text-sky-700">
                      QR status: {sale.qr_status} · Ref: {sale.qr_reference ?? '-'}
                    </p>
                  ) : null}
                  {sale.payment_method === 'complimentary' ? (
                    <p className="mt-1 text-sm font-bold text-coral">Reason: {sale.complimentary_reason ?? '-'}</p>
                  ) : null}
                </div>

                <div className="grid gap-2 sm:grid-cols-[1fr_auto] lg:min-w-[360px] lg:grid-cols-1 lg:text-right">
                  <div className="rounded-xl bg-shell p-3 sm:rounded-2xl">
                    <p className="text-xs font-black uppercase tracking-widest text-neutral-500">{isFoc ? 'FOC Cost' : 'Total Revenue'}</p>
                    <p className={`text-xl font-black sm:text-2xl ${isFoc ? 'text-coral' : 'text-ink'}`}>
                      {isFoc ? '- ' : ''}{money(isFoc ? sale.total_amount : sale.paid_amount, String(settings.currency_symbol))}
                    </p>
                    {Number(sale.discount_amount ?? 0) > 0 ? (
                      <p className="mt-1 text-sm font-bold text-coral">Discount: - {money(sale.discount_amount, String(settings.currency_symbol))}</p>
                    ) : null}
                  </div>

                  {sale.status === 'completed' ? (
                    <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end">
                      {sale.payment_method === 'qr' ? (
                        <>
                          <button className={`${secondaryButtonClass} justify-center`} onClick={() => verifyQr(sale, 'verified')}>
                            <CheckCircle2 className="h-4 w-4" />
                            Verify QR Payment
                          </button>
                          <button className={`${secondaryButtonClass} justify-center`} onClick={() => verifyQr(sale, 'mismatch')}>
                            Mismatch
                          </button>
                        </>
                      ) : null}
                      <button className={`${dangerButtonClass} justify-center`} onClick={() => setVoiding(sale)}>
                        <Ban className="h-4 w-4" />
                        Void
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="mt-3 overflow-hidden rounded-xl border border-line bg-white/80 sm:mt-4 sm:rounded-2xl">
                <div className="hidden grid-cols-[1fr_90px_130px_130px] bg-shell px-3 py-2 text-sm font-black md:grid">
                  <span>Item</span>
                  <span>Quantity</span>
                  <span>Unit price</span>
                  <span className="text-right">Line total</span>
                </div>
                <div className="divide-y divide-line">
                  {(sale.sale_items ?? []).map((item) => (
                    <div key={item.id} className="grid gap-2 px-3 py-3 text-sm font-bold md:grid-cols-[1fr_90px_130px_130px] md:items-center">
                      <span className="font-black">{itemName(item)}</span>
                      <span>Qty {item.quantity}</span>
                      <span>{money(item.unit_price, String(settings.currency_symbol))}</span>
                      <span className="font-black md:text-right">{money(item.line_total, String(settings.currency_symbol))}</span>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          );
        })}
      </section>

      {voiding ? (
        <Modal
          title={`Void ${voiding.sale_number}`}
          onClose={() => setVoiding(null)}
          footer={
            <div className="grid w-full gap-2 sm:flex sm:justify-end">
              <button className={secondaryButtonClass} onClick={() => setVoiding(null)}>Cancel</button>
              <button className={dangerButtonClass} disabled={!reason.trim()} onClick={voidSale}>Void sale</button>
            </div>
          }
        >
          <Field label="Mandatory void reason">
            <textarea className={inputClass} value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
        </Modal>
      ) : null}
    </>
  );
}
