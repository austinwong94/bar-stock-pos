import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Camera, Minus, Percent, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { Field, buttonClass, dangerButtonClass, inputClass, secondaryButtonClass } from '../components/Form';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/Page';
import { useToast } from '../components/Toast';
import { groupByCategory, loadProducts } from '../lib/data';
import { dualMoney, money } from '../lib/format';
import { supabase } from '../lib/supabase';
import { isSupabaseConfigured } from '../lib/supabase';
import { saveLocalSale } from '../lib/localStore';
import type { PaymentMethod, ProductWithStock, SettingsMap } from '../lib/types';
import { useLanguage } from '../lib/language';
import { assetPath } from '../lib/assets';

type CartItem = { product: ProductWithStock; quantity: number; customPrice?: number };

function parseStaffNames(settings: SettingsMap) {
  return String(settings.staff_names || 'Chloe, Happy, Elle, NekoMiao')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

function localDrinkFallback(product: ProductWithStock) {
  const name = product.name.toLowerCase();
  if (name.includes('pale')) return assetPath('assets/beer-pale-ale.svg');
  if (name.includes('dark')) return assetPath('assets/beer-dark.svg');
  if (name.includes('lager')) return assetPath('assets/beer-lager.svg');
  if (name.includes('coke')) return assetPath('assets/coke.svg');
  if (name.includes('7up')) return assetPath('assets/7up.svg');
  if (name.includes('fanta')) return assetPath('assets/fanta.svg');
  return assetPath('assets/custom-order.svg');
}

const confirmationSchema = z.object({
  method: z.enum(['cash', 'qr', 'complimentary']),
  qrReference: z.string().optional(),
  complimentaryReason: z.string().optional(),
});

export default function POS({ settings }: { settings: SettingsMap }) {
  const toast = useToast();
  const { text } = useLanguage();
  const [products, setProducts] = useState<ProductWithStock[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [qrReference, setQrReference] = useState('');
  const [qrReceipt, setQrReceipt] = useState<File | null>(null);
  const [complimentaryReason, setComplimentaryReason] = useState('');
  const [orderTakenBy, setOrderTakenBy] = useState(parseStaffNames(settings)[0] ?? 'Chloe');
  const [discount, setDiscount] = useState(0);
  const [customName, setCustomName] = useState('Custom Order');
  const [customPrice, setCustomPrice] = useState('');
  const [customDiscount, setCustomDiscount] = useState('');
  const [saving, setSaving] = useState(false);
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);
  const cameraInputId = 'qr-receipt-camera';
  const staffUsers = useMemo(() => parseStaffNames(settings), [settings]);
  const todayLabel = format(new Date(), 'EEE, d MMM yyyy');

  async function refreshProducts() {
    setProducts(await loadProducts(false));
  }

  useEffect(() => {
    void refreshProducts();
  }, []);

  useEffect(() => {
    if (staffUsers.length > 0 && !staffUsers.includes(orderTakenBy)) {
      setOrderTakenBy(staffUsers[0]);
    }
  }, [orderTakenBy, staffUsers]);

  const groups = useMemo(() => groupByCategory(products), [products]);
  const subtotal = cart.reduce((sum, item) => sum + item.quantity * Number(item.customPrice ?? item.product.price_per_unit), 0);
  const total = Math.max(0, subtotal - discount);
  const cartQuantity = cart.reduce((sum, item) => sum + item.quantity, 0);
  const regularGroups = Object.entries(groups).filter(([category]) => category !== 'Others');

  function add(product: ProductWithStock) {
    const stock = product.inventory_balances?.quantity_on_hand ?? 0;
    const existing = cart.find((item) => item.product.id === product.id)?.quantity ?? 0;
    if (!settings.allow_negative_stock && existing + 1 > stock) {
      toast.error(`${product.name} does not have enough stock.`);
      return;
    }
    setCart((items) => {
      const found = items.find((item) => item.product.id === product.id);
      if (found) {
        return items.map((item) =>
          item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item,
        );
      }
      return [...items, { product, quantity: 1 }];
    });
  }

  function addCustomOrder() {
    const price = Number(customPrice);
    if (!Number.isFinite(price) || price <= 0) {
      toast.error('Enter a custom price first.');
      return;
    }
    const customProduct: ProductWithStock = {
      id: `custom-${crypto.randomUUID()}`,
      name: customName.trim() || 'Custom Order',
      category_id: null,
      price_per_unit: price,
      cost_per_unit: null,
      carton_size: 1,
      low_stock_threshold: 0,
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      categories: { id: 'custom', name: 'Others', sort_order: 99 },
      inventory_balances: { quantity_on_hand: 9999 },
    };
    setCart((items) => [...items, { product: customProduct, quantity: 1, customPrice: price }]);
    setCustomPrice('');
  }

  function choosePayment(nextMethod: PaymentMethod) {
    setCartDrawerOpen(false);
    setMethod(nextMethod);
    if (nextMethod === 'qr') {
      window.setTimeout(() => document.getElementById(cameraInputId)?.click(), 50);
    }
  }

  function applyDiscountPercent(percent: number) {
    setCustomDiscount('');
    setDiscount(Number((subtotal * percent).toFixed(2)));
  }

  function change(productId: string, delta: number) {
    setCart((items) =>
      items
        .map((item) =>
          item.product.id === productId ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item,
        )
        .filter((item) => item.quantity > 0),
    );
  }

  async function confirmSale() {
    if (!method) return;
    const parsed = confirmationSchema.safeParse({ method, qrReference, complimentaryReason });
    if (!parsed.success) {
      toast.error('Check the confirmation fields.');
      return;
    }
    setSaving(true);
    if (!isSupabaseConfigured) {
      const savedSale = saveLocalSale({
        items: cart.map((item) => ({
          product_id: item.product.id.startsWith('custom-') ? null : item.product.id,
          name: item.product.name,
          quantity: item.quantity,
          unit_price: Number(item.customPrice ?? item.product.price_per_unit),
          line_total: item.quantity * Number(item.customPrice ?? item.product.price_per_unit),
        })),
        paymentMethod: method,
        totalAmount: total,
        paidAmount: method === 'complimentary' ? 0 : total,
        discountAmount: discount,
        orderTakenBy,
        qrReference: qrReference || null,
        qrReceiptName: qrReceipt?.name ?? null,
        complimentaryReason: complimentaryReason || null,
      });
      setSaving(false);
      setCart([]);
      setMethod(null);
      setQrReference('');
      setQrReceipt(null);
      setComplimentaryReason('');
      await refreshProducts();
      toast.success(`Sale ${savedSale.sale_number} saved by ${orderTakenBy}. Total ${dualMoney(total, String(settings.currency_symbol))}.`);
      return;
    }
    let qrReceiptPath: string | null = null;
    if (method === 'qr' && qrReceipt) {
      const path = `qr-receipts/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${qrReceipt.name}`;
      const upload = await supabase.storage.from('payment-receipts').upload(path, qrReceipt);
      if (upload.error) {
        setSaving(false);
        toast.error(upload.error.message);
        return;
      }
      qrReceiptPath = upload.data.path;
    }
    const { data, error } = await supabase.rpc('complete_sale', {
      p_items: cart.map((item) => ({
        product_id: item.product.id.startsWith('custom-') ? null : item.product.id,
        name: item.product.name,
        quantity: item.quantity,
        custom_price: item.customPrice ?? null,
      })),
      p_payment_method: method,
      p_qr_reference: qrReference || null,
      p_qr_receipt_image_path: qrReceiptPath,
      p_complimentary_reason: complimentaryReason || null,
      p_discount_amount: discount,
      p_order_taken_by: orderTakenBy,
      p_idempotency_key: crypto.randomUUID(),
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!data) {
      toast.error('Sale did not return a confirmation.');
      return;
    }
    setCart([]);
    setMethod(null);
    setQrReference('');
    setQrReceipt(null);
    setComplimentaryReason('');
    await refreshProducts();
    toast.success(`Sale ${data.sale_number} saved. Total ${money(data.total_amount, String(settings.currency_symbol))}.`);
  }

  const confirmDisabled =
    saving ||
    cart.length === 0 ||
    !orderTakenBy ||
    discount > subtotal ||
    (method === 'qr' && !qrReceipt) ||
    (method === 'qr' && Boolean(settings.require_qr_reference) && qrReference.trim().length === 0) ||
    (method === 'complimentary' && complimentaryReason.trim().length === 0);

  function renderCartPanel(inDrawer = false) {
    return (
      <>
        {!inDrawer ? <h2 className="text-xl font-black sm:text-2xl">{text('Order Cart', 'Bakul')}</h2> : null}
        <p className="mt-1 text-sm font-bold text-accent">{text('Accepted by', 'Diterima oleh')} {orderTakenBy}</p>
        <div className="mt-3 grid gap-2 sm:mt-4 sm:gap-3">
          {cart.length === 0 ? <p className="text-neutral-600">{text('No items selected.', 'Tiada item dipilih.')}</p> : null}
          {cart.map((item) => (
            <div key={item.product.id} className="rounded-xl border border-line bg-white/85 p-2.5 sm:rounded-2xl sm:p-3">
              <div className="flex justify-between gap-3">
                <strong>{item.product.name}</strong>
                <span>{money(item.quantity * Number(item.customPrice ?? item.product.price_per_unit), String(settings.currency_symbol))}</span>
              </div>
              <p className="mt-1 text-sm text-neutral-600">
                {item.quantity} x {money(item.customPrice ?? item.product.price_per_unit, String(settings.currency_symbol))}
              </p>
              <div className="mt-2 flex gap-2 sm:mt-3">
                <button className={`${secondaryButtonClass} w-10 px-0 sm:w-12`} onClick={() => change(item.product.id, -1)} aria-label="Decrease">
                  <Minus className="h-4 w-4" />
                </button>
                <button className={`${secondaryButtonClass} w-10 px-0 sm:w-12`} onClick={() => change(item.product.id, 1)} aria-label="Increase">
                  <Plus className="h-4 w-4" />
                </button>
                <button className={`${dangerButtonClass} w-10 px-0 sm:w-12`} onClick={() => change(item.product.id, -9999)} aria-label="Remove">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-2xl bg-shell p-3 sm:mt-5 sm:rounded-[1.5rem] sm:p-4">
          <Field label={text('Discount', 'Diskaun')}>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              <button type="button" className={`${secondaryButtonClass} px-2`} onClick={() => { setCustomDiscount(''); setDiscount(0); }}>
                0%
              </button>
              {[0.05, 0.1, 0.15, 0.2].map((rate) => (
                <button key={rate} type="button" className={`${secondaryButtonClass} px-2`} onClick={() => applyDiscountPercent(rate)}>
                  {Math.round(rate * 100)}%
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Percent className="h-5 w-5 text-coral" />
              <input
                className={inputClass}
                type="number"
                min={0}
                step="0.01"
                value={customDiscount}
                onChange={(e) => {
                  setCustomDiscount(e.target.value);
                  setDiscount(Number(e.target.value || 0));
                }}
                placeholder={text('Custom discount amount', 'Jumlah diskaun khas')}
              />
            </div>
          </Field>
          <div className="mt-3 flex justify-between gap-3 font-bold sm:mt-4">
            <span>Subtotal</span>
            <span>{money(subtotal, String(settings.currency_symbol))}</span>
          </div>
          <div className="mt-2 flex justify-between gap-3 font-bold text-coral">
            <span>{text('Discount amount', 'Jumlah diskaun')}</span>
            <span>- {money(discount, String(settings.currency_symbol))}</span>
          </div>
          <div className="mt-2 flex justify-between gap-3 text-xl font-black sm:text-2xl">
            <span>Total</span>
            <span>{money(total, String(settings.currency_symbol))}</span>
          </div>
          <p className="mt-1 text-sm font-bold text-accent">{dualMoney(total, String(settings.currency_symbol))}</p>
          <div className="mt-4 grid gap-3">
            <button className={buttonClass} disabled={cart.length === 0} onClick={() => choosePayment('cash')}>
              {text('Cash Payment', 'Bayaran tunai')} 💵
            </button>
            <button className={buttonClass} disabled={cart.length === 0} onClick={() => choosePayment('qr')}>
              <Camera className="h-5 w-5" />
              {text('QR Payment', 'Bayaran QR')} 📱
            </button>
            <button className={secondaryButtonClass} disabled={cart.length === 0} onClick={() => choosePayment('complimentary')}>
              Complimentary (FOC) 🎁
            </button>
          </div>
        </div>
      </>
    );
  }

  function renderLiveCartPanel() {
    if (cart.length === 0) return null;
    return (
      <section className="island-panel sticky top-[6.25rem] z-20 max-h-[48vh] overflow-y-auto rounded-2xl p-2.5 2xl:hidden">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-black">Selected order</h2>
            <p className="text-xs font-bold text-accent">Accepted by {orderTakenBy}</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-black uppercase tracking-widest text-neutral-500">{cartQuantity} item(s)</p>
            <p className="text-base font-black">{money(total, String(settings.currency_symbol))}</p>
          </div>
        </div>
        <div className="mt-2 grid gap-2">
          {cart.map((item) => (
            <div key={item.product.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-line bg-white/85 p-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-black">{item.product.name}</p>
                <p className="text-xs font-bold text-neutral-600">
                  {item.quantity} x {money(item.customPrice ?? item.product.price_per_unit, String(settings.currency_symbol))}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button className={`${secondaryButtonClass} h-9 min-h-9 w-9 px-0`} onClick={() => change(item.product.id, -1)} aria-label="Decrease">
                  <Minus className="h-4 w-4" />
                </button>
                <span className="grid h-9 min-w-9 place-items-center rounded-xl bg-teal-50 px-2 text-sm font-black text-accent">{item.quantity}</span>
                <button className={`${secondaryButtonClass} h-9 min-h-9 w-9 px-0`} onClick={() => change(item.product.id, 1)} aria-label="Increase">
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <>
      <PageHeader
        title={text('POS', 'Jualan')}
      />
      <section className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-pink-200 bg-gradient-to-r from-pink-50 via-white to-teal-50 p-2.5 shadow-soft sm:mb-5 sm:rounded-[1.75rem] sm:p-4">
        <p className="text-xs font-black uppercase tracking-widest text-accent">{text('Today', 'Hari ini')}</p>
        <p className="text-base font-black text-ink sm:text-xl lg:text-2xl">{todayLabel}</p>
      </section>
      <input
        id={cameraInputId}
        className="hidden"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(event) => setQrReceipt(event.target.files?.[0] ?? null)}
      />
      <div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="grid min-w-0 content-start gap-4">
          <section className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-2xl border border-line bg-white/90 p-2 shadow-soft backdrop-blur sm:p-2.5 lg:sticky lg:top-4 lg:z-10 2xl:static">
            <p className="text-xs font-black leading-tight sm:text-sm">{text('Order taken by', 'Diterima oleh')}</p>
            <div className="grid min-w-0 grid-cols-4 gap-1.5">
              {staffUsers.map((user) => (
                <button
                  key={user}
                  type="button"
                  onClick={() => setOrderTakenBy(user)}
                  className={`min-w-0 truncate rounded-xl border px-1.5 py-2 text-center text-xs font-black shadow-soft transition sm:px-3 sm:text-sm ${
                    orderTakenBy === user
                      ? 'border-accent bg-accent text-white'
                      : 'border-line bg-white text-ink hover:border-accent'
                  }`}
                >
                  {user}
                </button>
              ))}
            </div>
          </section>
          {renderLiveCartPanel()}
          {regularGroups.map(([category, items]) => (
            <div key={category}>
              <h2 className="mb-2 text-lg font-black sm:mb-3 sm:text-xl">{text(category, category === 'Soft Drink' ? 'Minuman Ringan' : category === 'Beer' ? 'Bir' : 'Lain-lain')}</h2>
              <div className="grid min-w-0 grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3">
                {items.map((product) => {
                  const stock = product.inventory_balances?.quantity_on_hand ?? 0;
                  const low = stock <= product.low_stock_threshold;
                  const disabled = stock <= 0 && !settings.allow_negative_stock;
                  const selectedQuantity = cart.find((item) => item.product.id === product.id)?.quantity ?? 0;
                  return (
                    <button
                      key={product.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => add(product)}
                      className={`relative min-h-28 overflow-hidden rounded-2xl border p-0 text-left shadow-soft transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-32 sm:rounded-[1.25rem] lg:min-h-36 ${
                        selectedQuantity > 0
                          ? 'border-accent bg-teal-50 ring-4 ring-teal-100'
                          : low
                            ? 'border-warning bg-amber-50'
                            : 'border-line bg-white/90'
                      }`}
                    >
                      {selectedQuantity > 0 ? (
                        <span className="absolute right-2 top-2 z-10 grid h-8 min-w-8 place-items-center rounded-full bg-accent px-2 text-sm font-black text-white shadow-glow sm:right-3 sm:top-3 sm:h-10 sm:min-w-10">
                          {selectedQuantity}
                        </span>
                      ) : null}
                      <img
                        src={product.image_url ?? localDrinkFallback(product)}
                        data-fallback={localDrinkFallback(product)}
                        alt=""
                        className="h-14 w-full object-cover sm:h-16 lg:h-20"
                        onError={(event) => {
                          const fallback = event.currentTarget.dataset.fallback;
                          if (fallback && !event.currentTarget.src.endsWith(fallback)) {
                            event.currentTarget.src = fallback;
                          }
                        }}
                      />
                      <span className="block px-2.5 pt-2 text-sm font-black leading-tight sm:px-3 sm:text-base lg:px-3">{product.name}</span>
                      <span className="mt-0.5 block px-2.5 text-sm font-bold sm:px-3">{money(product.price_per_unit, String(settings.currency_symbol))}</span>
                      <span className="block px-2.5 pb-2.5 pt-0.5 text-xs text-neutral-600 sm:px-3 lg:text-sm">{stock} {text('cans available', 'tin tersedia')}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <div>
            <h2 className="mb-2 text-lg font-black sm:mb-3 sm:text-xl">{text('Custom Order', 'Pesanan Khas')}</h2>
            <div className="island-card grid min-w-0 gap-3 rounded-2xl p-3 sm:grid-cols-[120px_1fr] sm:items-end sm:rounded-[1.75rem] sm:p-4 lg:grid-cols-[130px_minmax(0,1fr)_minmax(0,1fr)_auto]">
              <img src={assetPath('assets/custom-order.svg')} alt="" className="h-20 w-full rounded-2xl object-cover sm:h-full sm:rounded-3xl" />
              <Field label={text('Product name', 'Nama produk')}>
                <input className={inputClass} value={customName} onChange={(e) => setCustomName(e.target.value)} />
              </Field>
              <Field label={text('Custom price', 'Harga khas')}>
                <input className={inputClass} type="number" min={0} step="0.01" value={customPrice} onChange={(e) => setCustomPrice(e.target.value)} placeholder="38.00" />
              </Field>
              <button type="button" className={`${buttonClass} w-full md:w-auto`} onClick={addCustomOrder}>
                <Plus className="h-4 w-4" />
                {text('Add', 'Tambah')}
              </button>
            </div>
          </div>
        </section>
        <aside className="island-panel hidden min-w-0 rounded-[1.5rem] p-3 2xl:sticky 2xl:top-4 2xl:block 2xl:self-start">
          {renderCartPanel()}
        </aside>
      </div>
      <div className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 p-2 shadow-[0_-18px_45px_rgba(196,70,115,0.18)] backdrop-blur sm:p-3 2xl:hidden">
        <div className="mx-auto grid max-w-[760px] grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => setCartDrawerOpen(true)}
            className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-xl border border-accent bg-teal-50 px-3 py-2 text-left shadow-soft sm:gap-3 sm:rounded-2xl sm:px-4 sm:py-3"
          >
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-white sm:h-11 sm:w-11 sm:rounded-2xl">
              <ShoppingCart className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-black text-accent">{cartQuantity} item(s) selected</span>
              <span className="block truncate text-lg font-black sm:text-xl">{money(total, String(settings.currency_symbol))}</span>
            </span>
          </button>
          <button className={`${buttonClass} min-h-[54px] px-3 sm:min-h-[68px] sm:px-4`} disabled={cart.length === 0} onClick={() => setCartDrawerOpen(true)}>
            View cart
          </button>
        </div>
      </div>
      {cartDrawerOpen ? (
        <Modal title={text('Order Cart', 'Bakul')} onClose={() => setCartDrawerOpen(false)}>
          {renderCartPanel(true)}
        </Modal>
      ) : null}
      <div className="h-20 sm:h-28 2xl:hidden" />
      {method ? (
        <Modal
          title={`Confirm ${method === 'qr' ? 'QR Payment' : method === 'cash' ? 'Cash Payment' : 'Complimentary (FOC)'}`}
          onClose={() => setMethod(null)}
          footer={
            <div className="grid w-full gap-2 sm:flex sm:justify-end">
              <button className={secondaryButtonClass} onClick={() => setMethod(null)}>Cancel</button>
              <button className={buttonClass} disabled={confirmDisabled} onClick={confirmSale}>
                {saving ? 'Saving...' : `Confirm ${method === 'complimentary' ? 'FOC' : method === 'cash' ? 'Cash Payment' : 'QR Payment'}`}
              </button>
            </div>
          }
        >
          <div className="grid gap-3">
            {cart.map((item) => (
              <div key={item.product.id} className="flex justify-between border-b border-line py-2">
                <span>{item.product.name} x {item.quantity}</span>
                <strong>{money(Number(item.customPrice ?? item.product.price_per_unit) * item.quantity, String(settings.currency_symbol))}</strong>
              </div>
            ))}
            <div className="rounded-2xl bg-shell p-3">
              <div className="flex justify-between text-sm font-bold">
                <span>Subtotal</span>
                <span>{money(subtotal, String(settings.currency_symbol))}</span>
              </div>
              <div className="mt-2 flex justify-between text-sm font-bold text-coral">
                <span>{text('Discount amount', 'Jumlah diskaun')}</span>
                <span>- {money(discount, String(settings.currency_symbol))}</span>
              </div>
            </div>
            <div className="flex justify-between text-lg font-black sm:text-xl">
              <span>Total</span>
              <span>{money(total, String(settings.currency_symbol))}</span>
            </div>
            {method === 'complimentary' ? (
              <p className="rounded-2xl bg-pink-50 p-3 text-sm font-black text-coral">Paid amount: {money(0, String(settings.currency_symbol))}. FOC is recorded as cost, not sales.</p>
            ) : null}
            <p className="text-sm font-bold text-accent">{dualMoney(total, String(settings.currency_symbol))}</p>
            <p className="rounded-2xl bg-shell p-3 text-sm font-bold">{text('Order accepted by', 'Diterima oleh')}: {orderTakenBy}</p>
            {method === 'qr' ? (
              <>
                <Field label={text('QR Payment reference or transaction ID', 'Rujukan Bayaran QR atau ID transaksi')}>
                  <input className={inputClass} value={qrReference} onChange={(e) => setQrReference(e.target.value)} />
                </Field>
                <div className="rounded-2xl border border-line bg-shell p-3">
                  <p className="font-black">{text('QR Payment receipt photo', 'Gambar resit Bayaran QR')}</p>
                  <p className="mt-1 text-sm text-neutral-600">{qrReceipt ? qrReceipt.name : text('Camera should open automatically. Take a receipt photo before confirming.', 'Kamera akan dibuka secara automatik. Ambil gambar resit sebelum sahkan.')}</p>
                  <button className={`${secondaryButtonClass} mt-3`} onClick={() => document.getElementById(cameraInputId)?.click()}>
                    <Camera className="h-4 w-4" />
                    {text('Snap again', 'Ambil semula')}
                  </button>
                </div>
              </>
            ) : null}
            {method === 'complimentary' ? (
              <Field label={text('Complimentary (FOC) reason', 'Sebab FOC')}>
                <textarea className={inputClass} value={complimentaryReason} onChange={(e) => setComplimentaryReason(e.target.value)} />
              </Field>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
