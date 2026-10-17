import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, PackageCheck, Pencil, Search, Trash2 } from 'lucide-react';
import { Field, buttonClass, iconButtonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { deliveredStockQuantity, deliveryErrorLabels, deliveryLineError, fixedDeliveryUnit, measuredPieceDelivery } from '../../lib/delivery';
import { useLanguage } from '../../lib/language';
import { loadLocalIngredientItems } from '../../lib/localStore';
import { readErrorMessage } from '../../lib/opsData';
import { awaitingDelivery, receivedQuantity } from '../../lib/purchasingProgress';
import { isDemoMode, isSupabaseConfigured, supabase } from '../../lib/supabase';
import type { DeliveryBatchRecord, DeliveryDraft, PurchaseRequest, PurchaseRequestItem } from '../../lib/platformTypes';
import type { IngredientWithBalance } from '../../lib/types';
import { DeliveryRecord, deliveryTime } from './DeliveryRecord';
import { useAccess } from '../../lib/access';
import { deliveryPurchaseLabel, deliveryRemaining, deliveryStockLabel, outstandingAfterDelivery, type DeliveryEntry, suggestedDeliveryEntry } from '../../lib/deliveryEntry';
import { kitchenFactor, kitchenUnit, kitchenFractional } from '../../lib/kitchenCatalogue';
import { definitiveInitialSaveFailure } from '../../lib/saveAttempt';
import { deliveryRecoveryKey, readDeliveryRecovery, writeDeliveryRecovery, type DeliveryRecovery, type DeliveryOperation } from '../../lib/deliveryRecovery';

import { MeasureChoices } from '../../components/MeasureChoices';
import { baseToSize, sizeToBase, type SizeUnit } from '../../lib/kitchenUnitBatch';
import { UnitSizeInput } from './UnitSizeInput';
import './kitchen-unit-setup.css';

const blank: DeliveryEntry = { quantity: '', ingredientId: '', size: '' };
const amount = (value: number) => Number(value).toLocaleString('en-MY', { maximumFractionDigits: 4 });

export function DeliveryBatch({ request: incomingRequest, initialDraft: incomingDraft, receiptSource = false, onClose, onSaved }: { request: PurchaseRequest; initialDraft?: DeliveryDraft; receiptSource?: boolean; onClose: () => void; onSaved: () => void }) {
  const { text, language } = useLanguage();
  const { can, profile } = useAccess();
  const storageKey=deliveryRecoveryKey(import.meta.env.VITE_SUPABASE_URL,profile?.id??'',receiptSource,incomingRequest.id);
  const [loaded]=useState(()=>{try{const raw=localStorage.getItem(storageKey),value=readDeliveryRecovery(raw);if(value&&(value.request.id!==incomingRequest.id||value.receiptSource!==receiptSource))throw Error('Delivery recovery belongs to a different source.');return {raw,value,error:''};}catch(e){return {raw:null,value:null,error:readErrorMessage(e,'Delivery recovery could not be read.')};}});
  const request=loaded.value?.request??incomingRequest,initialDraft=loaded.value?.draft??incomingDraft;
  const savedRaw=useRef(loaded.raw),recovery=useRef(loaded.value);
  const [storageError,setStorageError]=useState(loaded.error);
  const canReceive = can('purchasing.receive');
  const [draft, setDraft] = useState(initialDraft);
  const [edited, setEdited] = useState(!!loaded.value&&!loaded.value.review);
  const [draftAttempted, setDraftAttempted] = useState(loaded.value?.operation?.kind==='save');
  const [cancelling, setCancelling] = useState(loaded.value?.operation?.kind==='cancel');
  const [cancelAttempted, setCancelAttempted] = useState(loaded.value?.operation?.kind==='cancel');
  const [reason, setReason] = useState(loaded.value?.operation?.kind==='cancel'?loaded.value.operation.args.p_reason:'');
  const draftId = useRef(loaded.value?.draftId??initialDraft?.id ?? crypto.randomUUID());
  const pendingDraft = useRef<Record<string, unknown> | null>(loaded.value?.operation?.kind==='save'?loaded.value.operation.args:null);
  const items = [...(request.purchase_request_items ?? [])].filter(item => awaitingDelivery(item) || initialDraft?.items.some(line => line.item_id === item.id)).sort((a, b) => a.sort_order - b.sort_order);
  const [ingredients, setIngredients] = useState<IngredientWithBalance[]>([]);
  const [entries, setEntries] = useState<Record<string, DeliveryEntry>>(loaded.value?.entries??{});
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'entered'>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  const [review, setReview] = useState(loaded.value?.review??!!initialDraft);
  const [checked, setChecked] = useState(loaded.value?.operation?.kind==='confirm');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [attempted, setAttempted] = useState(loaded.value?.operation?.kind==='confirm');
  const [discard, setDiscard] = useState(false);
  const [record, setRecord] = useState<DeliveryBatchRecord | null>(initialDraft?.confirmed_record ?? null);
  const sending = useRef(false);
  const rows = useRef<Record<string, HTMLLIElement | null>>({});
  const entered = items.filter(item => !!entries[item.id]?.quantity.trim());
  const remaining = deliveryRemaining;
  const ingredientFor = (item: PurchaseRequestItem) => ingredients.find(ingredient => ingredient.id === entries[item.id]?.ingredientId);
  const issue = (item: PurchaseRequestItem) => {
    const entry = entries[item.id] ?? blank;
    const ingredient = ingredientFor(item);
    const measured = ingredient && measuredPieceDelivery(item.unit, ingredient.base_unit);
    if (measured && !/^\d+$/.test(entry.pieces ?? '')) return 'pieces';
    return !ingredient ? 'ingredient' : deliveryLineError(item.unit, ingredient.base_unit, Number(entry.quantity), measured ? null : Number(entry.size), remaining(item),kitchenFractional(ingredient),receiptSource ? 4 : 2, measured ? Number(entry.pieces) : null);
  };
  const invalid = entered.filter(item => !!issue(item));
  const visible = items.filter(item => (filter === 'all' || !!entries[item.id]?.quantity.trim() || item.id === editingId) && `${item.item_name} ${item.supplier ?? ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const outstanding = outstandingAfterDelivery(items, draft?.items ?? []);
  const stockLabel=(quantity:number,base:string,unit?:string|null,factor?:number|null)=>deliveryStockLabel(quantity,base,base==='g'?'kg':base==='ml'?'L':unit,base==='g'||base==='ml'?1000:factor);
  const stockAdded = (item: PurchaseRequestItem) => measuredPieceDelivery(item.unit, ingredientFor(item)?.base_unit ?? '') ? Number(entries[item.id]?.pieces) : Math.round(Number(entries[item.id]?.quantity) * Number(entries[item.id]?.size) * 100) / 100;
  function persist(patch:Partial<DeliveryRecovery>={},remove=false) {
    if(loaded.error || !profile?.id) {setStorageError(loaded.error||text('Sign in again before saving.','Log masuk semula sebelum menyimpan.'));return false;}
    try {
      const next:DeliveryRecovery={version:1,receiptSource,request,draft:draft??null,draftId:draftId.current,entries,review,operation:recovery.current?.operation??null,updatedAt:new Date().toISOString(),...patch};
      savedRaw.current=writeDeliveryRecovery(localStorage,storageKey,remove?null:next,savedRaw.current);
      recovery.current=remove?null:next;setStorageError('');return true;
    }catch(e){setStorageError(readErrorMessage(e,text('Could not keep this delivery on your phone. Nothing new was sent.','Penghantaran tidak dapat disimpan pada telefon. Tiada rekod baharu dihantar.')));return false;}
  }

  useEffect(() => {
    let active = true;
    setLoading(true); setLoadError('');
    void (async () => {
      try {
        const stock = receiptSource ? await supabase.rpc('read_kitchen_stock') : null;
        const result = stock ? {data:stock.data?.items,error:stock.error} : isSupabaseConfigured
          ? await supabase.from('ingredient_items').select('*').eq('active', true).order('name')
          : { data: loadLocalIngredientItems(), error: null };
        if (result.error) throw result.error;
        if (!Array.isArray(result.data)) throw Error('Inventory items are incomplete. Retry before entering a delivery.');
        if (!active) return;
        const catalogue = ((result.data ?? []) as IngredientWithBalance[]).filter(item => item.active);
        setIngredients(catalogue);
        setEntries(previous => Object.fromEntries(items.map(item => {
          const saved = initialDraft?.items.find(line => line.item_id === item.id);
          // Reuse only a unique exact name and the item's verified unit conversion.
          return [item.id, previous[item.id] ?? (saved ? { quantity: String(saved.quantity), ingredientId: saved.ingredient_id, size: saved.base_per_unit == null ? '' : String(saved.base_per_unit), pieces: saved.measured_pieces == null ? '' : String(saved.measured_pieces) } : suggestedDeliveryEntry(item,catalogue))];
        })));
      } catch (failure) { if (active) setLoadError(readErrorMessage(failure, text('Could not load inventory items.', 'Item inventori tidak dapat dimuatkan.'))); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [request, retry, text]);

  useEffect(() => {
    if ((!edited && !draftAttempted) || record) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [edited, draftAttempted, record]);
  useEffect(() => { if (expanded) rows.current[expanded]?.scrollIntoView({ block: 'nearest' }); }, [expanded, search]);

  function quantityInput(item:PurchaseRequestItem,value:string,unit?:SizeUnit){
    const fixed=fixedDeliveryUnit(item.unit);if(!fixed||fixed.baseUnit==='unit'||!unit){update(item.id,{quantity:value,quantity_value:undefined,quantity_measure:undefined});return;}
    const base=sizeToBase(value,unit,fixed.baseUnit),purchaseUnit=item.unit.toLowerCase()==='l'?'L':item.unit as SizeUnit;
    update(item.id,{quantity:base===null?(value.trim()?'invalid':''):baseToSize(base,purchaseUnit,fixed.baseUnit)??'invalid',quantity_value:value,quantity_measure:unit});
  }
  function quantityMeasure(item:PurchaseRequestItem,unit:SizeUnit){
    const entry=entries[item.id]??blank,fixed=fixedDeliveryUnit(item.unit)!;
    if(!entry.quantity.trim()){quantityInput(item,entry.quantity_value??'',unit);return;}
    const purchaseUnit=(item.unit.toLowerCase()==='l'?'L':item.unit) as SizeUnit,base=sizeToBase(entry.quantity,purchaseUnit,fixed.baseUnit);
    if(base===null){setError(text('Check this amount before changing units.','Semak jumlah ini sebelum menukar unit.'));return;}
    quantityInput(item,baseToSize(base,unit,fixed.baseUnit)!,unit);
  }
  function update(id: string, patch: Partial<DeliveryEntry>) {
    if (sending.current || draftAttempted || attempted || stale || !canReceive) return;
    const next={ ...entries, [id]: { ...(entries[id] ?? blank), ...patch } };
    if(!persist({entries:next,review:false}))return;
    setEntries(next);
    setChecked(false); setError(''); setEdited(true);
  }
  function editDelivery(id?: string, problem?: string | null) {
    if (sending.current || draftAttempted || attempted || stale || loading || loadError || !canReceive) return;
    if(!persist({review:false}))return;
    flushSync(() => {
      setReview(false); setChecked(false);
      if (id) { setSearch(''); setFilter('entered'); setEditingId(id); }
      if (problem && id) setExpanded(id);
    });
    if (!id) return;
    const row = rows.current[id];
    const target = problem === 'ingredient' || problem === 'unit' ? row?.querySelector<HTMLSelectElement>('select')
      : row?.querySelector<HTMLInputElement>(problem === 'pieces' ? 'input[data-delivery-field="pieces"]' : problem === 'size' ? 'input[data-delivery-field="size"]' : 'input[data-delivery-field="quantity"]');
    target?.focus();
    if (target instanceof HTMLInputElement) target.select();
    target?.scrollIntoView({ block: 'center' });
  }
  function close() {
    if (sending.current) return;
    if ((edited || draftAttempted || attempted) && !record && !stale) setDiscard(true);
    else onClose();
  }
  async function prepareReview() {
    if (sending.current || !canReceive || stale || (!pendingDraft.current && (loading || loadError || !entered.length || invalid.length))) return;
    pendingDraft.current ??= { p_id: draftId.current, p_request_id: request.id, p_expected_version: draft?.version ?? 0, p_operation_id: crypto.randomUUID(),
      p_items: entered.map(item => ({ item_id: item.id, ingredient_id: entries[item.id].ingredientId, quantity: Number(entries[item.id].quantity), base_per_unit: measuredPieceDelivery(item.unit,ingredientFor(item)!.base_unit) ? null : Number(entries[item.id].size),
        ...(measuredPieceDelivery(item.unit,ingredientFor(item)!.base_unit) ? { measured_pieces: Number(entries[item.id].pieces) } : {}), ingredient_version: ingredientFor(item)!.updated_at,
        expected_base_unit: ingredientFor(item)!.base_unit, expected_updated_at: item.updated_at, expected_received_quantity: receivedQuantity(item) })) };
    if(!persist({operation:{kind:'save',args:pendingDraft.current} as DeliveryOperation})){if(!draftAttempted)pendingDraft.current=null;return;}
    sending.current = true; setBusy(true); setDraftAttempted(true); setError('');
    try {
      const result = await supabase.rpc(receiptSource ? 'save_receipt_delivery_draft' : 'save_delivery_draft', pendingDraft.current);
      if (result.error) throw result.error;
      if (result.data?.id!==draftId.current) throw new Error(text('Draft save could not be verified. Retry to check.', 'Simpanan draf tidak dapat disahkan. Cuba lagi.'));
      if(!persist({draft:result.data,review:true,operation:null}))return;
      setDraft(result.data); setReview(true); setEdited(false); setChecked(false); setDraftAttempted(false); pendingDraft.current = null;
      if(result.data.confirmed_record){if(!persist({},true))return;setRecord(result.data.confirmed_record);}
      onSaved();
    } catch (failure) {
      const code = (failure as { code?: string })?.code;
      setError(readErrorMessage(failure, text('Draft save could not be verified. Retry to check.', 'Simpanan draf tidak dapat disahkan. Cuba lagi.')));
      if (definitiveInitialSaveFailure(draftAttempted, failure) && persist({operation:null})) { pendingDraft.current = null; setDraftAttempted(false);if(code==='40001'){setStale(true);onSaved();} }
    } finally { sending.current = false; setBusy(false); }
  }
  async function save() {
    if (sending.current || !canReceive || !checked || !review || !draft || stale) return;
    const operation=recovery.current?.operation??{kind:'confirm' as const,args:{p_id:draft.id,p_expected_version:draft.version}};
    if(operation.kind!=='confirm'||!persist({operation}))return;
    sending.current = true; setBusy(true); setAttempted(true); setError('');
    try {
      const result = await supabase.rpc(receiptSource ? 'confirm_receipt_delivery_draft' : 'confirm_delivery_draft', operation.args);
      if (result.error) throw result.error;
      if (!result.data?.id) throw new Error(text('The saved delivery could not be verified. Retry to check.', 'Penghantaran tersimpan tidak dapat disahkan. Cuba lagi untuk menyemak.'));
      if(!persist({},true))return;
      setRecord(result.data as DeliveryBatchRecord); onSaved();
    } catch (failure) {
      const code = (failure as { code?: string })?.code;
      const conflict = code === '40001';
      setError(readErrorMessage(failure, text('Confirmation could not be verified. Retry the same delivery.', 'Pengesahan tidak dapat disemak. Cuba semula penghantaran yang sama.')));
      if (definitiveInitialSaveFailure(attempted, failure)&&persist({operation:null})) { setAttempted(false); setChecked(false);if(conflict){setStale(true);onSaved();} }
    } finally { sending.current = false; setBusy(false); }
  }

  async function cancelDraft() {
    if (!draft || sending.current || !canReceive || !reason.trim()) return;
    const operation=recovery.current?.operation??{kind:'cancel' as const,args:{p_id:draft.id,p_expected_version:draft.version,p_reason:reason.trim()}};
    if(operation.kind!=='cancel'||!persist({operation}))return;
    sending.current = true; setBusy(true); setCancelAttempted(true); setError('');
    try {
      const result = await supabase.rpc(receiptSource ? 'cancel_receipt_delivery_draft' : 'cancel_delivery_draft', operation.args);
      if (result.error) throw result.error;
      if(!persist({},true))return;
      setDraft({ ...draft, status: 'cancelled', cancelled_reason: reason.trim() }); setCancelling(false); onSaved();
    } catch (failure) {
      setError(readErrorMessage(failure, text('Cancellation could not be verified. Retry to check.', 'Pembatalan tidak dapat disahkan. Cuba lagi.')));
      if (definitiveInitialSaveFailure(cancelAttempted, failure)&&persist({operation:null})) {setCancelAttempted(false);if ((failure as { code?: string })?.code === '40001') { setStale(true); setCancelling(false); onSaved(); }}
    } finally { sending.current = false; setBusy(false); }
  }

  return <Modal panelClassName={!record && !discard && !cancelling && draft?.status !== 'cancelled' && items.length > 8 ? 'delivery-batch-dialog' : ''} title={record ? text('Delivery Recorded', 'Penghantaran Direkod') : draft?.status === 'cancelled' ? text('Draft Cancelled', 'Draf Dibatalkan') : cancelling ? text('Cancel Delivery Draft?', 'Batalkan Draf Penghantaran?') : discard ? text('Close Delivery Entry?', 'Tutup Catatan Penghantaran?') : review ? text('Review Delivery', 'Semak Penghantaran') : text('Receive Delivery', 'Terima Penghantaran')} onClose={close}
    footer={record || stale || draft?.status === 'cancelled' || !canReceive ? <div className="flex justify-end"><button className={buttonClass} onClick={onClose}>{stale ? text('Close & Refresh', 'Tutup & Muat Semula') : text('Done', 'Selesai')}</button></div>
      : cancelling ? <div className="grid grid-cols-2 gap-2"><button className={secondaryButtonClass} disabled={busy || cancelAttempted} onClick={() => { setCancelling(false); setError(''); }}>{text('Keep Draft', 'Simpan Draf')}</button><button className={buttonClass + ' bg-danger'} disabled={busy || !reason.trim() || !!loaded.error} onClick={() => void cancelDraft()}>{cancelAttempted?text('Retry Cancellation','Cuba Batalkan Semula'):text('Cancel Draft', 'Batalkan Draf')}</button></div>
      : discard ? <div className="grid grid-cols-2 gap-2"><button className={secondaryButtonClass} onClick={() => setDiscard(false)}>{text('Keep Editing', 'Teruskan Mengedit')}</button><button className={secondaryButtonClass} onClick={onClose}>{text('Close & Keep', 'Tutup & Simpan')}</button></div>
      : <div className="grid gap-3">
        {review ? <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 shrink-0 accent-accent" disabled={busy || attempted} checked={checked} onChange={event => setChecked(event.target.checked)} />{text('I checked the items, delivered quantities and stock units.', 'Saya telah menyemak item, kuantiti dihantar dan unit stok.')}</label> : null}
        <div className="flex items-center justify-between gap-2">
          {review ? <div className="flex shrink-0 gap-2"><button className={iconButtonClass} title={text('Back to Delivery Entry', 'Kembali ke Catatan Penghantaran')} aria-label={text('Back to Delivery Entry', 'Kembali ke Catatan Penghantaran')} disabled={busy || attempted || loading || !!loadError} onClick={() => editDelivery()}><ArrowLeft className="h-4 w-4" /></button><button className={iconButtonClass} title={text('Cancel Draft', 'Batalkan Draf')} aria-label={text('Cancel Draft', 'Batalkan Draf')} disabled={busy || attempted} onClick={() => setCancelling(true)}><Trash2 className="h-4 w-4" /></button></div>
            : <span className="grid gap-0.5 text-xs text-muted"><span className="tabular">{entered.length} / {items.length} {text('Entered', 'Diisi')}</span><span>{text('Not Confirmed', 'Belum Disahkan')}</span></span>}
          {!review && !draftAttempted && invalid.length ? <button className={secondaryButtonClass} disabled={busy || loading || !!loadError || !!loaded.error} onClick={() => editDelivery(invalid[0].id, issue(invalid[0]))}><ArrowRight className="h-4 w-4" />{text('Check Items', 'Semak Item')} ({invalid.length})</button>
            : <button className={buttonClass} disabled={busy || !!loaded.error || (review ? !checked : !draftAttempted && (loading || !!loadError || !entered.length || !!invalid.length))} onClick={() => review ? void save() : void prepareReview()}>
              {review ? <PackageCheck className="h-4 w-4 shrink-0" /> : <ArrowRight className="h-4 w-4 shrink-0" />}
              {busy ? review ? text('Confirming...', 'Mengesahkan...') : text('Saving Draft...', 'Menyimpan Draf...') : review ? attempted ? text('Retry Confirmation', 'Cuba Sahkan Semula') : text('Confirm Delivery', 'Sahkan Penghantaran') : draftAttempted ? text('Retry Draft Save', 'Cuba Simpan Draf') : `${text('Review', 'Semak')} (${entered.length})`}
            </button>}
        </div>
      </div>}>
    {storageError ? <p role="alert" className="mb-3 break-words text-sm text-danger">{storageError}</p> : null}
    {!record && recovery.current && (!review || recovery.current.operation || discard) ? <div role="status" className="mb-3 border-l-2 border-line pl-3 text-xs"><strong>{recovery.current.operation ? text('Check Status · Same Delivery Kept', 'Semak Status · Penghantaran Sama Disimpan') : text('Saved on This Device', 'Disimpan pada Peranti Ini')}</strong><p className="mt-1 text-muted">{recovery.current.operation ? text('Retry this delivery to check its result. Do not enter it again.', 'Cuba semula penghantaran ini untuk menyemak hasilnya. Jangan masukkan semula.') : text('Resume from To Finish. Not confirmed.', 'Sambung melalui Belum Selesai. Belum disahkan.')}</p></div> : null}
    {cancelling ? <div className="grid gap-3"><Field label={text('Reason', 'Sebab')}><input className={inputClass} value={reason} maxLength={300} disabled={busy || cancelAttempted} onChange={event => setReason(event.target.value)} /></Field>{error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}</div>
      : draft?.status === 'cancelled' ? <div className="grid gap-3 text-sm"><p>{text('No stock was added.', 'Tiada stok ditambah.')}</p><p className="break-words">{draft.cancelled_reason}</p></div>
      : discard ? <p className="text-sm">{text('Your entries stay on this device. Open To Finish to resume the same delivery. If its status is unverified, retry it rather than entering a new delivery.', 'Catatan kekal pada peranti ini. Buka Belum Selesai untuk menyambung penghantaran yang sama. Jika status belum diketahui, cuba semula tanpa membuat penghantaran baharu.')}</p>
      : record ? <>
        <p role="status" className="mb-3 flex items-center gap-2 text-sm font-semibold text-palm"><CheckCircle2 className="h-5 w-5 shrink-0" />{isDemoMode ? text('Saved in Local Preview', 'Disimpan dalam Pratonton Setempat') : text('Saved to Cloud', 'Disimpan ke Awan')}</p>
        <p className="mb-3 text-xs font-semibold">{record.request_no}</p>
        <DeliveryRecord record={record} />
      </> : <>
        <div data-delivery-reference className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs"><span className="min-w-0 flex-1 break-words font-semibold">{receiptSource ? text('Receipt', 'Resit')+' ' : ''}{request.request_no}</span><span className="shrink-0 whitespace-nowrap text-muted">{receiptSource ? text('Purchased', 'Dibeli') : text('Needed', 'Diperlukan')}: {request.needed_for_date}</span></div>
        {loadError ? <div role="alert" className="mb-3 grid gap-2 text-sm text-danger">{loadError}<button className={secondaryButtonClass} onClick={() => setRetry(value => value + 1)}>{text('Retry', 'Cuba Lagi')}</button></div> : null}
        {loading && !review ? <p role="status" className="text-sm text-muted">{text('Loading Inventory...', 'Memuatkan Inventori...')}</p> : !review ? <fieldset disabled={busy || draftAttempted || attempted || stale || !!loaded.error || !canReceive} className="delivery-entry min-w-0" onKeyDown={event => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing || !(event.target instanceof HTMLInputElement) || !event.target.dataset.deliveryField) return;
          event.preventDefault();
          const fields = [...event.currentTarget.querySelectorAll<HTMLInputElement>('input[data-delivery-field]:not(:disabled)')].filter(input => input.getClientRects().length);
          const next = fields[fields.indexOf(event.target) + 1];
          if (next) { next.focus(); next.select(); next.scrollIntoView({ block: 'center' }); }
          else event.target.blur();
        }}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <label className="relative block min-w-0 flex-[1_1_10rem]"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted" /><input className={inputClass + ' !pl-9'} aria-label={text('Find Delivery Item', 'Cari Item Penghantaran')} placeholder={text('Find Item', 'Cari Item')} value={search} onChange={event => setSearch(event.target.value)} /></label>
          </div>
          <div className="supply-segments delivery-entry-filter" role="group" aria-label={text('Delivery Items', 'Item Penghantaran')}>
            <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>{text('All Items', 'Semua Item')} <span className="tabular">{items.length}</span></button>
            <button type="button" aria-pressed={filter === 'entered'} onClick={() => setFilter('entered')}>{text('Entered', 'Diisi')} <span className="tabular">{entered.length}</span></button>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_2.75rem] gap-2 border-b border-line pb-2 text-xs font-semibold text-muted"><span>{text('Item', 'Item')} ({visible.length})</span><span>{text('Delivered', 'Dihantar')}</span><span /></div>
          <ul className="divide-y divide-line">{visible.map(item => {
            const entry = entries[item.id] ?? blank;
            const ingredient = ingredientFor(item);
            const fixed = fixedDeliveryUnit(item.unit);
            const measured = ingredient && measuredPieceDelivery(item.unit, ingredient.base_unit);
            const problem = entry.quantity.trim() ? issue(item) : null;
            return <li key={item.id} ref={node => { rows.current[item.id] = node; }} data-delivery-item={item.id} className="py-3">
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_5.5rem_2.75rem] items-center gap-2">
                <div className="min-w-0"><p className="break-words text-sm font-semibold">{item.item_name}</p><p className="mt-0.5 break-words text-xs text-muted">{text('To Receive', 'Belum Diterima')}: {amount(remaining(item))} {item.unit}</p></div>
                <input className={inputClass + ' !px-2 text-right tabular'} inputMode="decimal" enterKeyHint="next" data-delivery-field="quantity" onFocus={() => setEditingId(item.id)} onBlur={() => setEditingId(null)} aria-label={`${text('Delivered', 'Dihantar')}: ${item.item_name} (${entry.quantity_measure??item.unit})`} aria-invalid={!!entry.quantity && !!problem} maxLength={12} value={entry.quantity_value??entry.quantity} onChange={event => quantityInput(item,event.target.value,entry.quantity_measure)} />
                <button className={iconButtonClass + (expanded === item.id ? ' border-accent text-accent' : '')} aria-expanded={expanded === item.id} aria-label={`${text('Delivery Details', 'Butiran Penghantaran')}: ${item.item_name}`} title={text('Delivery Details', 'Butiran Penghantaran')} onClick={() => setExpanded(expanded === item.id ? null : item.id)}><ChevronDown className={'h-4 w-4 ' + (expanded === item.id ? 'rotate-180' : '')} /></button>
              </div>
              {fixed&&fixed.baseUnit!=='unit'?<MeasureChoices label={item.item_name+' '+text('Delivered Unit','Unit Dihantar')} options={fixed.baseUnit==='g'?['kg','g']:['L','ml']} value={entry.quantity_measure??(item.unit.toLowerCase()==='l'?'L':item.unit)} onChange={unit=>quantityMeasure(item,unit as SizeUnit)}/>:null}
              {problem ? <p className="mt-2 text-xs text-danger">{text(...deliveryErrorLabels[problem])}</p>
                : entry.quantity.trim() && ingredient ? <div className="mt-2 flex flex-wrap justify-between gap-1 text-xs"><span className="break-words font-semibold text-palm">+{stockLabel(stockAdded(item), ingredient.base_unit,kitchenUnit(ingredient),kitchenFactor(ingredient))} · {ingredient.name}</span><span className="text-muted">{text('Still Due', 'Baki Belum Diterima')}: {amount(Math.round((remaining(item) - Number(entry.quantity)) * 10000) / 10000)} {item.unit}</span></div> : null}
              {expanded === item.id || !ingredient ? <div className="mt-3 grid gap-3 border-l-2 border-line pl-3">
                <Field label={text('Inventory Item', 'Item Inventori')}><select aria-label={text('Inventory Item', 'Item Inventori')} className={inputClass} value={entry.ingredientId} onChange={event => update(item.id, { ingredientId: event.target.value, size: fixed ? String(fixed.size) : '', pieces: '',size_measure:undefined,size_value:undefined })}>
                  <option value="">{text('Choose an ingredient', 'Pilih bahan')}</option>{ingredients.filter(row => !fixed || row.base_unit === fixed.baseUnit || measuredPieceDelivery(item.unit,row.base_unit)).map(row => <option key={row.id} value={row.id}>{row.name} ({row.base_unit === 'unit' ? 'pcs' : row.base_unit})</option>)}
                </select></Field>
                {fixed && !measured ? <p className="text-sm text-muted">1 {item.unit} = {amount(fixed.size)} {fixed.baseUnit === 'unit' ? 'pcs' : fixed.baseUnit}</p> : null}
              </div> : null}
              {measured ? <label className="mt-2 grid grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-2 text-xs font-semibold"><span>{text('Actual Pieces Received', 'Bilangan Sebenar Diterima')} (pcs)</span><input aria-label={`${text('Actual Pieces Received', 'Bilangan Sebenar Diterima')}: ${item.item_name}`} className={inputClass + ' !px-2 text-right tabular'} inputMode="numeric" enterKeyHint="next" data-delivery-field="pieces" maxLength={11} value={entry.pieces ?? ''} onChange={event => update(item.id, { pieces: event.target.value })} /></label> : null}
              {!fixed && (expanded===item.id || !ingredient || kitchenUnit(ingredient)!==item.unit || Number(entry.size)!==kitchenFactor(ingredient)) ? (ingredient&&ingredient.base_unit!=='unit'?<UnitSizeInput inputProps={{'data-delivery-field':'size',enterKeyHint:'next',onFocus:()=>setEditingId(item.id),onBlur:()=>setEditingId(null)}} line={{id:item.id,name:item.item_name,base:ingredient.base_unit,unit:item.unit as 'pack',factor:entry.size,carton:'',water:false,expected:ingredient.updated_at,size_unit:entry.size_measure,size_value:entry.size_value}} language={language} disabled={!ingredient} label={text('Pack Size','Saiz Pek')+': '+item.item_name+' ('+ingredient.base_unit+'/'+item.unit+')'} helpId={'delivery-size-'+item.id} onChange={patch=>update(item.id,{size:patch.factor??'',size_measure:patch.size_unit,size_value:patch.size_value})}/>:<label className="mt-2 grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-2 text-xs text-muted"><span>{text('Pack Size', 'Saiz Pek')} ({ingredient&&kitchenFactor(ingredient)===1?kitchenUnit(ingredient):ingredient?.base_unit ?? text('Base Units', 'Unit Asas')} / {item.unit})</span><input aria-label={`${text('Pack Size', 'Saiz Pek')}: ${item.item_name} (${ingredient?.base_unit ?? '-'}/${item.unit})`} className={inputClass + ' !px-2 text-right tabular'} inputMode="decimal" enterKeyHint="next" data-delivery-field="size" onFocus={() => setEditingId(item.id)} onBlur={() => setEditingId(null)} disabled={!ingredient} maxLength={14} value={entry.size} onChange={event => update(item.id, { size: event.target.value })} /></label>) : null}
            </li>;
          })}</ul>
          {!visible.length ? <p className="py-4 text-sm text-muted">{text('No Matching Items', 'Tiada Item Sepadan')}</p> : null}
        </fieldset> : <>
          {!attempted ? <div className="mb-3 border-l-2 border-warning pl-3 text-xs"><p className="font-semibold text-warning">{isDemoMode ? text('Draft Saved in Local Preview', 'Draf Disimpan dalam Pratonton Setempat') : text('Draft Saved to Cloud', 'Draf Disimpan ke Awan')}</p><p className="mt-1 text-muted">{text('Not Received. No stock added.', 'Belum Diterima. Tiada stok ditambah.')}</p></div> : null}
          {draft ? <p className="mb-3 break-words text-xs text-muted">{draft.updated_by_name ?? text('Name Not Recorded', 'Nama Tidak Direkod')} · {deliveryTime(draft.updated_at, language)} MYT</p> : null}
          <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3 border-b border-line pb-2 text-xs font-semibold text-muted"><span>{text('Inventory Item', 'Item Inventori')}</span><span className="text-right">{text('Stock to Add', 'Stok Akan Ditambah')}</span></div>
          <ul className="divide-y divide-line">{draft?.items.map(item => <li key={item.item_id} className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-3 py-3">
            <div className="min-w-0"><button type="button" className="delivery-review-edit" title={text('Edit Delivery', 'Edit Penghantaran')} aria-label={`${text('Edit Delivery', 'Edit Penghantaran')}: ${item.purchase_name}`} disabled={busy || attempted || stale || loading || !!loadError || !canReceive} onClick={() => editDelivery(item.item_id)}><Pencil size={14}/><span><strong>{item.ingredient_name}</strong>{item.ingredient_name !== item.purchase_name ? <small>{text('Purchase', 'Pembelian')}: {item.purchase_name}</small> : null}<small>{deliveryPurchaseLabel(item.quantity, item.purchase_unit, item.base_per_unit, item.expected_base_unit,item.display_unit,item.display_factor)}</small></span></button></div>
            <span className="break-words text-right text-sm font-semibold text-palm tabular">+{stockLabel(deliveredStockQuantity(item), item.expected_base_unit,item.display_unit,item.display_factor)}</span>
          </li>)}</ul>
          <div className="mt-3 border-t border-line pt-3">
            <p className="text-sm font-semibold">{text('Still Due After This Delivery', 'Baki Selepas Penghantaran Ini')}</p>
            {outstanding.length ? <ul className="mt-1 divide-y divide-line">{outstanding.map(({item,remaining: due}) => <li key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-2 text-xs"><span className="break-words text-muted">{item.item_name}</span><span className="font-semibold tabular">{amount(due)} {item.unit}</span></li>)}</ul>
              : <p className="mt-1 text-xs text-muted">{text('None for the purchased items.', 'Tiada bagi item yang telah dibeli.')}</p>}
          </div>
        </>}
        {error ? <p role="alert" className="mt-3 break-words text-sm text-danger">{error}</p> : null}
      </>}
  </Modal>;
}
