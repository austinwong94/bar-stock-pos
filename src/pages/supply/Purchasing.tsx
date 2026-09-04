import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, PackageX, ShoppingBasket, Undo2 } from 'lucide-react';
import { PageHeader, Stat } from '../../components/Page';
import { Field, buttonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { supabase } from '../../lib/supabase';
import { useAccess } from '../../lib/access';
import { readErrorMessage } from '../../lib/opsData';
import { money } from '../../lib/format';
import { requestStatusLabels } from './Kitchen';
import type { PurchaseRequest, PurchaseRequestItem } from '../../lib/platformTypes';
import type { SettingsMap } from '../../lib/types';

export default function Purchasing({ settings }: { settings: SettingsMap }) {
  const toast = useToast();
  const { can, reloadBadges } = useAccess();
  const currency = String(settings.currency_symbol ?? 'MYR');

  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [showDone, setShowDone] = useState(false);
  const [buying, setBuying] = useState<{ request: PurchaseRequest; item: PurchaseRequestItem } | null>(null);
  const [loading, setLoading] = useState(true);

  const canFulfil = can('purchasing.fulfil');
  const showCost = can('purchasing.cost.view');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('purchase_requests')
        .select('*, purchase_request_items(*)')
        .neq('status', 'draft')
        .order('needed_for_date')
        .limit(200);
      if (error) throw error;
      setRequests((data ?? []) as PurchaseRequest[]);
    } catch (error) {
      toast.error(readErrorMessage(error, 'Could not load the buying list.'));
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visible = useMemo(
    () => requests.filter((request) => (showDone ? true : request.status === 'submitted' || request.status === 'buying')),
    [requests, showDone],
  );

  const totals = useMemo(() => {
    const items = requests.flatMap((request) => request.purchase_request_items ?? []);
    return {
      pending: items.filter((item) => item.purchase_status === 'pending').length,
      spend: items.reduce((sum, item) => sum + Number(item.actual_cost ?? 0), 0),
      open: requests.filter((request) => request.status === 'submitted' || request.status === 'buying').length,
    };
  }, [requests]);

  async function quickSet(item: PurchaseRequestItem, status: 'pending' | 'unavailable') {
    const { error } = await supabase.rpc('set_purchase_item_status', {
      p_item_ids: [item.id],
      p_status: status,
      p_purchased_quantity: null,
      p_actual_cost: null,
      p_supplier: null,
      p_note: null,
    });
    if (error) { toast.error(error.message); return; }
    void refresh();
    void reloadBadges();
  }

  return (
    <>
      <PageHeader
        title="Things to Purchase"
        subtitle="Everything the kitchen and the boats have asked for. Tick items off as you buy them."
        actions={
          <label className="flex items-center gap-2 rounded-2xl border border-line bg-white/90 px-3 py-2 text-sm font-black">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            Show finished
          </label>
        }
      />

      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <Stat label="Open requests" value={String(totals.open)} tone={totals.open ? 'warn' : 'good'} />
        <Stat label="Items still to buy" value={String(totals.pending)} />
        {showCost ? <Stat label="Recorded spend" value={money(totals.spend, currency)} /> : null}
      </div>

      {loading ? <p className="p-4 font-bold">Loading...</p> : null}

      <div className="grid gap-3">
        {visible.map((request) => {
          const items = [...(request.purchase_request_items ?? [])].sort((a, b) => a.sort_order - b.sort_order);
          const done = items.filter((item) => item.purchase_status !== 'pending').length;
          return (
            <section key={request.id} className="rounded-2xl border border-line bg-white/85 shadow-soft">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2.5">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-black">
                    <ShoppingBasket className="h-4 w-4 text-accent" />
                    {request.request_no}
                    <span className="rounded-lg bg-shell px-2 py-0.5 text-xs">{requestStatusLabels[request.status]}</span>
                  </p>
                  <p className="mt-0.5 text-sm font-semibold text-neutral-700">
                    Needed {request.needed_for_date} · {request.pax_count} pax
                    {request.purpose ? ` · ${request.purpose}` : ''}
                  </p>
                </div>
                <span className={`rounded-xl px-3 py-1.5 text-sm font-black ${done === items.length ? 'bg-shell text-accent' : 'bg-amber-50 text-amber-800'}`}>
                  {done} / {items.length} done
                </span>
              </header>

              <ul className="divide-y divide-line">
                {items.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                    <div className="min-w-[10rem] flex-1">
                      <p className="text-sm font-black">
                        {item.item_name}
                        {item.purchase_status === 'unavailable' ? (
                          <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-black text-danger">NOT AVAILABLE</span>
                        ) : null}
                      </p>
                      <p className="text-xs font-semibold text-neutral-600">
                        Asked for {Number(item.quantity)} {item.unit}
                        {item.note ? ` · ${item.note}` : ''}
                        {item.purchase_status === 'bought' && item.supplier ? ` · from ${item.supplier}` : ''}
                        {showCost && item.actual_cost ? ` · ${money(item.actual_cost, currency)}` : ''}
                      </p>
                    </div>

                    {canFulfil ? (
                      <div className="flex shrink-0 gap-1.5">
                        {item.purchase_status === 'pending' ? (
                          <>
                            <button type="button" className={buttonClass} onClick={() => setBuying({ request, item })}>
                              <Check className="h-4 w-4" /> Bought
                            </button>
                            <button
                              type="button"
                              className={secondaryButtonClass}
                              onClick={() => quickSet(item, 'unavailable')}
                              aria-label="Mark unavailable"
                            >
                              <PackageX className="h-4 w-4" />
                            </button>
                          </>
                        ) : (
                          <button type="button" className={secondaryButtonClass} onClick={() => quickSet(item, 'pending')}>
                            <Undo2 className="h-4 w-4" /> Undo
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="shrink-0 text-xs font-black capitalize">{item.purchase_status}</span>
                    )}
                  </li>
                ))}
              </ul>

              {request.notes ? (
                <p className="border-t border-line px-3 py-2 text-xs font-semibold text-neutral-600">Note: {request.notes}</p>
              ) : null}
            </section>
          );
        })}
        {!loading && visible.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm font-bold text-neutral-500">
            Nothing waiting to be bought.
          </p>
        ) : null}
      </div>

      {buying ? (
        <BoughtForm
          item={buying.item}
          currency={currency}
          showCost={showCost}
          onClose={() => setBuying(null)}
          onSaved={() => { setBuying(null); void refresh(); void reloadBadges(); }}
        />
      ) : null}
    </>
  );
}

function BoughtForm({
  item,
  currency,
  showCost,
  onClose,
  onSaved,
}: {
  item: PurchaseRequestItem;
  currency: string;
  showCost: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [cost, setCost] = useState('');
  const [supplier, setSupplier] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const { error } = await supabase.rpc('set_purchase_item_status', {
      p_item_ids: [item.id],
      p_status: 'bought',
      p_purchased_quantity: Number(quantity) || Number(item.quantity),
      p_actual_cost: cost === '' ? null : Number(cost),
      p_supplier: supplier || null,
      p_note: note || null,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${item.item_name} marked as bought.`);
    onSaved();
  }

  return (
    <Modal
      title={`Bought: ${item.item_name}`}
      onClose={onClose}
      footer={
        <button type="button" className={`${buttonClass} w-full`} disabled={busy} onClick={save}>
          {busy ? 'Saving...' : 'Save'}
        </button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Quantity bought (${item.unit})`}>
          <input className={inputClass} inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </Field>
        {showCost ? (
          <Field label={`Cost (${currency})`}>
            <input className={inputClass} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
          </Field>
        ) : null}
        <Field label="Bought from">
          <input className={inputClass} value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Market / supplier" />
        </Field>
        <Field label="Note">
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
