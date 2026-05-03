import { useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Ban, CheckCircle2, ReceiptText } from 'lucide-react';
import { Field, buttonClass, dangerButtonClass, inputClass, secondaryButtonClass } from '../components/Form';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/Page';
import { useToast } from '../components/Toast';
import { malaysiaDateBounds, malaysiaDateInputValue, money, todayInputValue } from '../lib/format';
import { supabase } from '../lib/supabase';
import { isSupabaseConfigured } from '../lib/supabase';
import { loadLocalSaleItems, loadLocalSales } from '../lib/localStore';
import type { PaymentMethod, Sale, SaleItem, SettingsMap } from '../lib/types';
import { useLanguage } from '../lib/language';

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

function saleCalendarDate(sale: Sale) {
  return sale.created_at ? malaysiaDateInputValue(sale.created_at) : sale.business_date;
}

function itemName(item: SaleItem) {
  return item.products?.name ?? item.custom_item_name ?? item.product_id ?? 'Custom Order';
}

export default function SalesHistory({ settings, embedded = false }: { settings: SettingsMap; embedded?: boolean }) {
  const toast = useToast();
  const { text } = useLanguage();
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
          .filter((sale) => sale.business_date === date || saleCalendarDate(sale) === date)
          .filter((sale) => method === 'all' || sale.payment_method === method)
          .map((sale) => ({ ...sale, sale_items: localSaleItems.filter((item) => item.sale_id === sale.id) })),
      );
      return;
    }
    const { startIso, endIso } = malaysiaDateBounds(date);
    let businessDateQuery = supabase
      .from('sales')
      .select('*, sale_items(*, products(name))')
      .eq('business_date', date)
      .order('created_at', { ascending: false });
    let createdAtQuery = supabase
      .from('sales')
      .select('*, sale_items(*, products(name))')
      .gte('created_at', startIso)
      .lt('created_at', endIso)
      .order('created_at', { ascending: false });
    if (method !== 'all') {
      businessDateQuery = businessDateQuery.eq('payment_method', method);
      createdAtQuery = createdAtQuery.eq('payment_method', method);
    }
    const [{ data: businessDateData, error: businessDateError }, { data: createdAtData, error: createdAtError }] = await Promise.all([businessDateQuery, createdAtQuery]);
    if (businessDateError || createdAtError) toast.error(businessDateError?.message ?? createdAtError?.message ?? 'Could not load sales.');
    const mergedSales = new Map<string, SaleWithItems>();
    ([...(businessDateData ?? []), ...(createdAtData ?? [])] as SaleWithItems[]).forEach((sale) => {
      mergedSales.set(sale.id, sale);
    });
    setSales(Array.from(mergedSales.values()).sort((a, b) => b.created_at.localeCompare(a.created_at)));
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
      {embedded ? null : <PageHeader title={text('Sales History', 'Sejarah Jualan')} />}

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

        {sales.length > 0 ? (
          <div className="overflow-x-auto rounded-2xl border border-line bg-white/85 shadow-soft sm:rounded-[2rem]">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="bg-paper">
                <tr>
                  <th className="p-3 whitespace-nowrap">Sale</th>
                  <th className="p-3 whitespace-nowrap">Date / Staff</th>
                  <th className="p-3 whitespace-nowrap">Method</th>
                  <th className="p-3 whitespace-nowrap">Status</th>
                  <th className="p-3 whitespace-nowrap">Items</th>
                  <th className="p-3 whitespace-nowrap">Discount</th>
                  <th className="p-3 whitespace-nowrap">Total</th>
                  <th className="p-3 whitespace-nowrap">QR</th>
                  <th className="p-3 whitespace-nowrap">Action</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((sale) => {
                  const isFoc = sale.payment_method === 'complimentary';
                  const items = (sale.sale_items ?? [])
                    .map((item) => `${itemName(item)} x ${item.quantity}`)
                    .join(', ');
                  return (
                    <tr key={sale.id} className="border-t border-line align-top">
                      <td className="p-3 font-black whitespace-nowrap">{sale.sale_number}</td>
                      <td className="p-3 whitespace-nowrap">
                        <span className="block font-bold">{saleDateLabel(saleCalendarDate(sale))}</span>
                        <span className="block text-xs font-bold text-neutral-600">{sale.order_taken_by ?? '-'}</span>
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <span className={`rounded-full border px-3 py-1 text-xs font-black ${paymentTone(sale.payment_method)}`}>
                          {paymentMethodLabel(sale.payment_method)}
                        </span>
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <span className={`rounded-full px-3 py-1 text-xs font-black ${statusTone(sale.status)}`}>
                          {statusLabel(sale.status)}
                        </span>
                      </td>
                      <td className="max-w-[280px] p-3 font-bold">{items || '-'}</td>
                      <td className="p-3 whitespace-nowrap">
                        {Number(sale.discount_amount ?? 0) > 0 ? `- ${money(sale.discount_amount, String(settings.currency_symbol))}` : '-'}
                      </td>
                      <td className={`p-3 font-black whitespace-nowrap ${isFoc ? 'text-coral' : 'text-ink'}`}>
                        {isFoc ? '- ' : ''}{money(isFoc ? sale.total_amount : sale.paid_amount, String(settings.currency_symbol))}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        {sale.payment_method === 'qr' ? `${sale.qr_status} / ${sale.qr_reference ?? '-'}` : '-'}
                      </td>
                      <td className="p-3">
                        {sale.status === 'completed' ? (
                          <div className="flex flex-wrap gap-2">
                            {sale.payment_method === 'qr' ? (
                              <>
                                <button className={`${secondaryButtonClass} min-h-9 rounded-xl px-3 py-1.5 text-xs`} onClick={() => verifyQr(sale, 'verified')}>
                                  <CheckCircle2 className="h-4 w-4" />
                                  Verify
                                </button>
                                <button className={`${secondaryButtonClass} min-h-9 rounded-xl px-3 py-1.5 text-xs`} onClick={() => verifyQr(sale, 'mismatch')}>
                                  Mismatch
                                </button>
                              </>
                            ) : null}
                            <button className={`${dangerButtonClass} min-h-9 rounded-xl px-3 py-1.5 text-xs`} onClick={() => setVoiding(sale)}>
                              <Ban className="h-4 w-4" />
                              Void
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
        ) : null}
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
