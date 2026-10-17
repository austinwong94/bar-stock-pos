import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Search, X, Calculator, Pencil, Trash2, RefreshCw } from 'lucide-react';
import { Field, buttonClass, iconButtonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { useAccess } from '../../lib/access';
import { useLanguage } from '../../lib/language';
import { readErrorMessage } from '../../lib/opsData';
import { isDemoMode, supabase } from '../../lib/supabase';
import type { PurchaseBatchRecord, PurchaseRequest } from '../../lib/platformTypes';
import { PurchasePhotoField, PurchaseEvidenceViewer } from '../../components/PurchasePhotoField';
import { PurchaseSupplier } from '../../components/PurchaseSupplier';
import { ReceiptScanTrial } from '../../components/ReceiptScanTrial';
import { ReceiptDuplicateCheck, useReceiptDuplicateCheck } from '../../components/ReceiptDuplicateCheck';
import { moneyCents, type PurchasePhoto } from '../../lib/purchaseEvidence';
import { todayIso } from '../../lib/opsData';
import { PurposeButtons, ReceiptDetails } from './PurchaseReceipts';
import { ReceiptReviewEditor } from './ReceiptReview';
import type { ReceiptReview } from '../../lib/receiptReview';
import type { ExpenseReceipt } from '../../lib/supplyWorkflow';
import { purposeLabels } from '../../lib/supplyWorkflow';
import { remainingToBuy } from '../../lib/purchasingProgress';
import { definitiveInitialSaveFailure } from '../../lib/saveAttempt';
import { hasPurchaseEntry, purchaseEntryIssues, type PurchaseEntry as Entry } from '../../lib/purchaseEntry';
import { createPurchaseDraft, purchaseDraftEvent, purchaseDraftPayload, purchaseDraftPrefix, readPurchaseDraft, refreshPurchaseDraft, writePurchaseDraft, PurchaseDraftError, type PurchaseDraft } from '../../lib/purchaseDraft';

export function PurchaseBatch({ request, storageKey, onClose, onSaved }: { request: PurchaseRequest | null; storageKey?: string; onClose: () => void; onSaved: () => void }) {
  const { profile, can } = useAccess(), { text } = useLanguage();
  const prefix = purchaseDraftPrefix(isDemoMode ? 'preview' : 'cloud', import.meta.env.VITE_SUPABASE_URL ?? 'review', profile?.id ?? '');
  const key = storageKey ?? prefix + request?.id;
  const [initial] = useState(() => {
    try {
      if (!profile?.id || !key.startsWith(prefix)) throw Error();
      const raw = localStorage.getItem(key), saved = readPurchaseDraft(raw, profile.id);
      if (saved && key !== prefix + saved.request.id) throw Error();
      const draft = saved ?? (request ? createPurchaseDraft(request, profile.id, todayIso()) : null);
      return { raw, draft };
    } catch { return { raw: null, draft: null }; }
  });
  if (!initial.draft || initial.draft.actorId !== profile?.id || !can('purchasing.fulfil') || !can('purchasing.cost.view')) return <Modal title={text('Purchase Draft', 'Draf Belian')} onClose={onClose}>
    <p role="alert" className="text-sm text-danger">{text('This draft could not be opened. Check your purchase access and browser storage. Existing drafts have not been changed.', 'Draf ini tidak dapat dibuka. Semak akses pembelian dan storan pelayar. Draf sedia ada tidak diubah.')}</p>
  </Modal>;
  if (!initial.raw && request) return <RequestPurchaseReview requestId={request.id} onClose={onClose} onSaved={onSaved}/>;
  return <PurchaseBatchForm key={key} initial={{ raw: initial.raw, draft: initial.draft }} storageKey={key} onClose={onClose} onSaved={onSaved}/>;
}

function RequestPurchaseReview({requestId,onClose,onSaved}:{requestId:string;onClose:()=>void;onSaved:()=>void}) {
  const {text:t}=useLanguage();
  const [id]=useState(()=>crypto.randomUUID()),[review,setReview]=useState<ReceiptReview|null>(null),[receipt,setReceipt]=useState<ExpenseReceipt|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{let active=true;void supabase.rpc('start_request_receipt_review',{p_id:id,p_request_id:requestId}).then(({data,error}:{data:ReceiptReview;error:unknown})=>{if(!active)return;if(error)setError(readErrorMessage(error,t('Could not open the pending purchase. Retry to check the same entry.','Belian tertunda tidak dapat dibuka. Cuba lagi untuk menyemak catatan sama.')));else{setReview(data);setError('');}});return()=>{active=false;};},[id,requestId,retry,t]);
  if(receipt)return <ReceiptDetails record={receipt} onClose={onClose}/>;
  if(review)return <ReceiptReviewEditor initial={review} onClose={onClose} onSaved={r=>{setReceipt(r);onSaved();}}/>;
  return <Modal title={t('Record Purchase','Rekod Belian')} onClose={onClose}>{error?<p role="alert" className="text-sm text-danger">{error}<button className={secondaryButtonClass} onClick={()=>setRetry(n=>n+1)}>{t('Retry','Cuba Lagi')}</button></p>:<p role="status" className="text-sm text-muted">{t('Opening Saved Review...','Membuka Semakan Disimpan...')}</p>}</Modal>;
}

function PurchaseRecord({ record }: { record: PurchaseBatchRecord }) {
  const { text, language } = useLanguage();
  const { can } = useAccess();
  const showCost = can('purchasing.cost.view') && record.items.some(item => item.actual_cost != null);
  const at = new Intl.DateTimeFormat(language === 'ms' ? 'ms-MY' : 'en-GB', {
    timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(record.confirmed_at));
  return <div className="min-w-0">
    <p className="break-words text-sm font-semibold">{record.confirmed_by_name ?? text('Name Not Recorded', 'Nama Tidak Direkod')} · {at} MYT</p>
    <p className="mt-1 break-words text-xs text-muted">{record.supplier ?? text('Supplier Not Entered', 'Pembekal Belum Diisi')}{record.reference ? ` · ${record.reference}` : ''}</p>
    <table className="dense-table mt-3 w-full table-fixed text-left text-sm">
      <thead><tr><th>{text('Item', 'Item')}</th><th className="w-24 text-right">{text('Bought', 'Dibeli')}</th>{showCost ? <th className="w-24 text-right">MYR</th> : null}</tr></thead>
      <tbody>{record.items.map(item => <tr key={item.id}><td className="break-words font-semibold">{item.item_name}</td><td className="break-words text-right tabular">{Number(item.quantity)} {item.unit}</td>{showCost ? <td className="break-words text-right tabular">{item.actual_cost == null ? text('Not Entered', 'Belum Diisi') : Number(item.actual_cost).toFixed(2)}</td> : null}</tr>)}</tbody>
    </table>
    {can('purchasing.cost.view') ? <p className="mt-3 flex justify-between gap-3 border-t border-line pt-3 text-sm font-bold"><span>{text('Purchase Total', 'Jumlah Pembelian')}</span><span className="tabular">MYR {record.evidence ? Number(record.evidence.total_cost).toFixed(2) : record.items.every(item => item.actual_cost != null) ? record.items.reduce((sum, item) => sum + Number(item.actual_cost), 0).toFixed(2) : text('Not Recorded', 'Tidak Direkod')}</span></p> : null}
    {record.evidence && can('purchasing.cost.view') ? <>
      <p className="mt-1 text-xs text-muted">{text('Receipt Date', 'Tarikh Resit')}: {record.evidence.purchase_date}</p>
      <PurchaseEvidenceViewer receipt={record.evidence.receipt_path} items={record.evidence.items_path}/>
      {can('purchasing.fulfil') ? <ReceiptScanTrial recordId={record.id} total={Number(record.evidence.total_cost)}/> : null}
    </> : null}
  </div>;
}

function PurchaseBatchForm({ initial, storageKey, onClose, onSaved }: { initial: { raw: string | null; draft: PurchaseDraft }; storageKey: string; onClose: () => void; onSaved: () => void }) {
  const { text } = useLanguage();
  const { can, profile } = useAccess();
  const [draft, setDraft] = useState(initial.draft);
  const current = useRef(draft), raw = useRef(initial.raw), active = useRef(true), savedRecord = useRef(false);
  const [hasDraft, setHasDraft] = useState(!!initial.raw), [storageError, setStorageError] = useState(''), [changedElsewhere, setChangedElsewhere] = useState(false);
  const { request, entries, supplier, purpose, reference, purchaseDate, totalCost, receiptPhoto, itemsPhoto, photoFolder, withCosts, attempted } = draft;
  const items = [...request.purchase_request_items].filter(item => hasPurchaseEntry(entries[item.id]) || item.purchase_status !== 'unavailable' && remainingToBuy(item)>0).sort((a, b) => a.sort_order - b.sort_order);
  const [search, setSearch] = useState('');
  const [entryFilter, setEntryFilter] = useState<'all' | 'entered'>('all');
  const [focusedEntry, setFocusedEntry] = useState<string | null>(null);
  const entryList = useRef<HTMLUListElement>(null);
  const entryId = useId();
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const [review, setReview] = useState(initial.draft.attempted);
  const [checked, setChecked] = useState(initial.draft.attempted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [record, setRecord] = useState<PurchaseBatchRecord | null>(null);
  const sending = useRef(false);
  const entered = items.filter(item => hasPurchaseEntry(entries[item.id]));
  const invalid = entered.filter(item => {
    const issue = purchaseEntryIssues(entries[item.id], remainingToBuy(item));
    return issue.quantity || issue.cost || draft.recheck[item.id] || item.purchase_status === 'unavailable';
  });
  const visible = items.filter(item => (entryFilter === 'all' || item.id === focusedEntry || hasPurchaseEntry(entries[item.id]))
    && `${item.item_name} ${item.note ?? ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const dirty = entered.length > 0 || !!supplier || !!reference || !!totalCost || !!receiptPhoto || !!itemsPhoto;
  const showCosts = can('purchasing.cost.view') && withCosts;
  const totalCents = moneyCents(totalCost);
  const lineCents = entered.reduce((sum, item) => sum + (moneyCents(entries[item.id].cost) ?? 0), 0);
  const completeCosts = showCosts && entered.length > 0 && entered.every(item => moneyCents(entries[item.id].cost) !== null);
  const proofReady = !!purpose && !!supplier.trim() && !!purchaseDate && purchaseDate <= todayIso() && totalCents !== null
    && !!receiptPhoto && !!itemsPhoto && receiptPhoto.hash !== itemsPhoto.hash && can('purchasing.cost.view');
  const missing = [!purpose ? text('purchase purpose','tujuan pembelian') : '', !supplier.trim() ? text('supplier','pembekal') : '', !purchaseDate || purchaseDate > todayIso() ? text('receipt date','tarikh resit') : '',
    totalCents === null ? text('receipt total','jumlah resit') : '', !receiptPhoto ? text('receipt photo','foto resit') : '', !itemsPhoto ? text('items photo','foto barang') : ''].filter(Boolean);
  const rowClass = showCosts ? 'purchase-entry-row has-costs' : 'purchase-entry-row';
  const blocked = busy || changedElsewhere || !!storageError || !can('purchasing.fulfil') || !can('purchasing.cost.view');
  const duplicateCheck = useReceiptDuplicateCheck(supplier, reference, receiptPhoto?.hash ?? '', undefined, !record && !attempted);

  useEffect(() => {
    active.current = true;
    const changed = (event: StorageEvent) => {
      if (event.storageArea === localStorage && (event.key === storageKey || event.key === null)) setChangedElsewhere(true);
    };
    window.addEventListener('storage', changed);
    return () => { active.current = false; window.removeEventListener('storage', changed); };
  }, [storageKey]);

  function storageMessage(e: unknown) {
    if (e instanceof PurchaseDraftError && e.code === 'conflict') return text('This draft changed in another tab. Close and resume it to load the latest entry.', 'Draf berubah di tab lain. Tutup dan sambung semula untuk memuatkan catatan terkini.');
    return text('Draft could not be saved on this device. Check browser storage and retry.', 'Draf tidak dapat disimpan pada peranti ini. Semak storan pelayar dan cuba lagi.');
  }
  function persist(next: PurchaseDraft) {
    raw.current = writePurchaseDraft(localStorage, storageKey, next, raw.current, draft.actorId);
    current.current = next; setDraft(next); setHasDraft(true); setStorageError('');
    window.dispatchEvent(new Event(purchaseDraftEvent));
  }
  function edit(patch: Partial<Pick<PurchaseDraft, 'entries' | 'supplier' | 'purpose' | 'reference' | 'purchaseDate' | 'totalCost' | 'receiptPhoto' | 'itemsPhoto' | 'withCosts' | 'recheck'>>) {
    if (!active.current || sending.current || current.current.attempted || changedElsewhere || stale || savedRecord.current || profile?.id !== draft.actorId) return false;
    try { persist({ ...current.current, ...patch, updatedAt: new Date().toISOString() }); setChecked(false); return true; }
    catch (e) { setStorageError(storageMessage(e)); if (e instanceof PurchaseDraftError && e.code === 'conflict') setChangedElsewhere(true); return false; }
  }
  const setEntries = (value: Record<string, Entry> | ((previous: Record<string, Entry>) => Record<string, Entry>)) => edit({ entries: typeof value === 'function' ? value(current.current.entries) : value });
  const setSupplier = (supplier: string) => edit({ supplier });
  const setPurpose = (purpose: string) => edit({ purpose: purpose as PurchaseDraft['purpose'] });
  const setReference = (reference: string) => edit({ reference });
  const setPurchaseDate = (purchaseDate: string) => edit({ purchaseDate });
  const setTotalCost = (totalCost: string) => edit({ totalCost });
  const setReceiptPhoto = (receiptPhoto: PurchasePhoto) => edit({ receiptPhoto });
  const setItemsPhoto = (itemsPhoto: PurchasePhoto) => edit({ itemsPhoto });
  const setWithCosts = (withCosts: boolean) => edit({ withCosts });

  function discardDraft() {
    if (sending.current || current.current.attempted || changedElsewhere) return;
    try { raw.current = writePurchaseDraft(localStorage, storageKey, null, raw.current, draft.actorId); window.dispatchEvent(new Event(purchaseDraftEvent)); onClose(); }
    catch (e) { setStorageError(storageMessage(e)); setDiscard(false); }
  }
  async function reloadRequest() {
    if (sending.current || current.current.attempted || changedElsewhere) return;
    sending.current = true; setBusy(true); setError('');
    try {
      const result = await supabase.from('purchase_requests').select('*, purchase_request_items(*)').eq('id', request.id).maybeSingle();
      if (result.error) throw result.error;
      if (!result.data || !['submitted', 'buying', 'completed'].includes(result.data.status)) throw new Error(text('This request is no longer available for purchasing. Your draft is kept.', 'Permintaan ini tidak lagi tersedia untuk pembelian. Draf anda disimpan.'));
      persist(refreshPurchaseDraft(current.current, result.data as PurchaseRequest)); setStale(false); setReview(false); setChecked(false); setSearch(''); setEntryFilter('all');
      onSaved();
    } catch (e) {
      if (e instanceof PurchaseDraftError) { setStorageError(storageMessage(e)); if (e.code === 'conflict') setChangedElsewhere(true); }
      else setError(readErrorMessage(e, text('Could not refresh the request. Your draft is kept.', 'Permintaan gagal dimuat semula. Draf anda disimpan.')));
    }
    finally { sending.current = false; setBusy(false); }
  }

  useEffect(() => {
    if (!dirty || record || !storageError) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, record, storageError]);

  useEffect(() => {
    if (!pendingFocus || review) return;
    const field = pendingFocus === 'invalid' ? entryList.current?.querySelector<HTMLInputElement>('input[aria-invalid="true"]')
      : document.getElementById(`${entryId}-${pendingFocus}-input`) as HTMLInputElement | null;
    field?.focus(); field?.select(); field?.scrollIntoView({ block: 'center' });
    setPendingFocus(null);
  }, [pendingFocus, review, entryId]);

  function close() {
    if (sending.current) return;
    onClose();
  }
  function update(id: string, field: keyof Entry, value: string) {
    const recheck = { ...current.current.recheck };
    if (field === 'quantity') delete recheck[id];
    edit({ entries: { ...current.current.entries, [id]: { ...(current.current.entries[id] ?? { quantity: '', cost: '' }), [field]: value } }, recheck });
    setError(''); setChecked(false);
  }
  function editReviewedItem(id: string) {
    setReview(false); setChecked(false); setSearch(''); setEntryFilter('all');
    setPendingFocus(id);
  }
  function nextInput(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    const fields = Array.from(entryList.current?.querySelectorAll<HTMLInputElement>('input[data-purchase-entry]') ?? []);
    const next = fields[fields.indexOf(event.currentTarget) + 1];
    if (next) { next.focus(); next.select(); next.scrollIntoView({ block: 'nearest' }); }
    else event.currentTarget.blur();
  }
  function showInvalid() {
    setSearch(''); setEntryFilter('all');
    setPendingFocus('invalid');
  }
  async function save() {
    if (sending.current || blocked || !checked || !review || stale || (!attempted && (duplicateCheck.blocked || !entered.length || invalid.length || !proofReady))) return;
    sending.current = true; setBusy(true); setError('');
    let sent = false;
    try {
      const pending = { ...current.current, attempted: true };
      persist(pending);
      sent = true;
      const { data, error: failure } = await supabase.rpc('record_purchase_batch_checked', purchaseDraftPayload(pending));
      if (failure) throw failure;
      if (!data?.id || data.request_id !== request.id) throw new Error(text('The saved purchase record could not be verified. Retry to check.', 'Rekod pembelian tidak dapat disahkan. Cuba lagi untuk menyemak.'));
      savedRecord.current = true;
      setRecord(data as PurchaseBatchRecord); onSaved();
      try {
        raw.current = writePurchaseDraft(localStorage, storageKey, null, raw.current, draft.actorId);
        setHasDraft(false); window.dispatchEvent(new Event(purchaseDraftEvent));
      } catch { setStorageError(text('Purchase saved, but the device draft could not be cleared. Resume it to check the same confirmation.', 'Pembelian disimpan, tetapi draf peranti gagal dibuang. Sambung semula untuk menyemak pengesahan yang sama.')); }
    } catch (failure) {
      if (!sent) { setStorageError(storageMessage(failure)); return; }
      const code = (failure as { code?: string })?.code;
      const conflict = code === '40001';
      setStale(conflict && !attempted);
      setError(readErrorMessage(failure, text('Confirmation could not be verified. Retry to check the same purchase.', 'Pengesahan tidak dapat disemak. Cuba lagi untuk menyemak pembelian yang sama.')));
      if (conflict) onSaved();
      if (definitiveInitialSaveFailure(attempted, failure)) {
        try { persist({ ...current.current, attempted: false, operationId: crypto.randomUUID() }); setChecked(false); }
        catch (e) { setStorageError(storageMessage(e)); }
      }
    } finally { sending.current = false; setBusy(false); }
  }

  const storageFeedback = <>
    {storageError || changedElsewhere ? <p role="alert" className="text-xs text-danger">{storageError || text('Draft changed in another tab. Close and resume it.', 'Draf berubah di tab lain. Tutup dan sambung semula.')}</p> : null}
    {storageError && !changedElsewhere ? <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => { try { persist(current.current); } catch (e) { setStorageError(storageMessage(e)); if (e instanceof PurchaseDraftError && e.code === 'conflict') setChangedElsewhere(true); } }}>{text('Retry Device Save', 'Cuba Simpan di Peranti')}</button> : null}
  </>;
  return <Modal title={record ? text('Purchase Recorded', 'Pembelian Direkod') : discard ? text('Discard Purchase Draft?', 'Buang Draf Belian?') : review ? text('Confirm Purchases', 'Sahkan Pembelian') : text('Record Purchases', 'Rekod Pembelian')}
    onClose={close} panelClassName={'purchase-batch-dialog' + (!review && !record && !discard ? ' purchase-batch-entry' : '')}
    footer={record ? <div className="flex justify-end"><button className={buttonClass} onClick={onClose}>{text('Done', 'Selesai')}</button></div>
      : discard ? <div className="grid gap-3">{storageFeedback}<div className="grid grid-cols-2 gap-2"><button className={secondaryButtonClass} onClick={() => setDiscard(false)}>{text('Keep Draft', 'Simpan Draf')}</button><button className={secondaryButtonClass + ' text-danger'} disabled={busy || changedElsewhere || attempted} onClick={discardDraft}>{text('Discard Draft', 'Buang Draf')}</button></div></div>
      : stale ? <div className="grid gap-3">{storageFeedback}<button type="button" className={buttonClass + ' w-full'} disabled={blocked || attempted} onClick={() => void reloadRequest()}><RefreshCw size={16}/>{text('Refresh Request & Keep Entries', 'Muat Semula & Simpan Catatan')}</button></div>
      : <div className="grid gap-3">
        {storageFeedback}
        {!review && invalid.length > 0 ? <button type="button" className="min-h-11 text-left text-sm font-semibold text-danger underline underline-offset-2" onClick={showInvalid}>{text(`Check ${invalid.length} Item${invalid.length === 1 ? '' : 's'}`, `Semak ${invalid.length} Item`)}</button>
          : !review && entered.length > 0 && missing.length ? <p className="text-xs text-muted">{text('Still Needed', 'Masih Diperlukan')}: {missing.join(', ')}</p> : null}
        {review ? <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 shrink-0 accent-accent" checked={checked} disabled={busy || attempted} onChange={event => setChecked(event.target.checked)} />{text('I checked the items, quantities, total and both photos.', 'Saya telah menyemak item, kuantiti, jumlah dan kedua-dua foto.')}</label> : null}
        <div className="flex min-w-0 items-center justify-between gap-2">
          {review ? <button className={iconButtonClass} disabled={busy || attempted} title={text('Back to Entry', 'Kembali ke Catatan')} aria-label={text('Back to Entry', 'Kembali ke Catatan')} onClick={() => { setReview(false); setChecked(false); }}><ArrowLeft className="h-4 w-4" /></button>
            : <span className="text-xs text-muted tabular">{entered.length} / {items.length} {text('Entered', 'Diisi')}{totalCents !== null ? <strong className="mt-1 block text-ink">MYR {(totalCents / 100).toFixed(2)}</strong> : null}</span>}
          <button className={buttonClass} disabled={blocked || (!attempted && (duplicateCheck.blocked || !entered.length || !!invalid.length || !proofReady)) || (review && !checked)} onClick={() => review ? void save() : (setReview(true), setChecked(false))}>
            {review ? <Check className="h-4 w-4 shrink-0" /> : <ArrowRight className="h-4 w-4 shrink-0" />}
            {busy ? text('Saving...', 'Menyimpan...') : review ? attempted ? text('Check Confirmation', 'Semak Pengesahan') : text('Confirm Purchase', 'Sahkan Pembelian') : text('Review', 'Semak') + ` (${entered.length})`}
          </button>
        </div>
      </div>}>
    {discard ? <p className="text-sm">{text('Discard this unfinished draft on this device? Recorded purchases and stock balances will not change.', 'Buang draf belum siap pada peranti ini? Pembelian direkod dan baki stok tidak akan berubah.')}</p>
      : record ? <>
        <p className="mb-2 text-xs font-semibold">{record.request_no}</p>
        <p role="status" className="mb-3 flex items-center gap-2 text-sm font-semibold text-palm"><CheckCircle2 className="h-5 w-5 shrink-0" />{text('Saved', 'Disimpan')}{isDemoMode ? text(' in Local Preview', ' dalam Pratonton Setempat') : text(' to Cloud', ' ke Awan')}</p>
        <p className="mb-3 text-sm text-muted">{text('Awaiting delivery. Inventory is unchanged.', 'Menunggu penghantaran. Inventori tidak berubah.')}</p>
        <PurchaseRecord record={record} />
        {storageError ? <p role="alert" className="mt-3 text-sm text-warning">{storageError}</p> : null}
      </> : <>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-semibold">{request.request_no}</span><span className="text-muted">{text('Needed', 'Diperlukan')}: {request.needed_for_date}</span></div>
        <ReceiptDuplicateCheck check={duplicateCheck}/>
        {hasDraft ? <div className="purchase-draft-status"><span role="status">{attempted ? text('Confirmation Pending · Check Before Re-entering', 'Pengesahan Belum Pasti · Semak Sebelum Isi Semula') : text('Draft on This Device · Not Submitted', 'Draf di Peranti Ini · Belum Dihantar')}</span>{!attempted ? <button type="button" className={iconButtonClass} title={text('Discard Purchase Draft', 'Buang Draf Belian')} aria-label={text('Discard Purchase Draft', 'Buang Draf Belian')} disabled={busy || changedElsewhere} onClick={() => setDiscard(true)}><Trash2 size={16}/></button> : null}</div> : null}
        {!review ? <fieldset className="min-w-0" disabled={blocked || attempted || stale}>
          <div className="purchase-receipt-fields grid grid-cols-2 items-end gap-3">
            <div className="col-span-2"><Field label={text('Purchase For','Pembelian Untuk')}><PurposeButtons value={purpose} onChange={setPurpose}/></Field></div>
            <div className="col-span-2"><PurchaseSupplier value={supplier} onChange={setSupplier}/></div>
            <Field label={text('Receipt Date', 'Tarikh Resit')}><input type="date" className={inputClass} value={purchaseDate} max={todayIso()} onChange={event => setPurchaseDate(event.target.value)}/></Field>
            <Field label={text('Receipt No. (Optional)', 'No. Resit (Pilihan)')}><input className={inputClass} maxLength={120} value={reference} onChange={event => setReference(event.target.value)} /></Field>
            <div className="col-span-2"><Field label={text('Receipt Total (MYR)', 'Jumlah Resit (MYR)')}><input className={inputClass + ' font-semibold tabular'} inputMode="decimal" value={totalCost} maxLength={11} onChange={event => setTotalCost(event.target.value)} aria-invalid={!!totalCost && totalCents === null}/></Field>
              {completeCosts && lineCents !== totalCents && !invalid.length ? <button type="button" className="mt-1 inline-flex min-h-11 items-center gap-2 text-xs font-semibold text-accent" onClick={() => setTotalCost((lineCents / 100).toFixed(2))}><Calculator size={16}/>{text('Use Item Total', 'Guna Jumlah Item')} · MYR {(lineCents / 100).toFixed(2)}</button> : null}
            </div>
          </div>
          <div className="purchase-proof-fields my-3 grid grid-cols-2 gap-2">
            <PurchasePhotoField label={text('Receipt Photo', 'Foto Resit')} kind="receipt" actor={profile?.id ?? ''} folder={photoFolder} value={receiptPhoto} otherHash={itemsPhoto?.hash} onChange={setReceiptPhoto}/>
            <PurchasePhotoField label={text('Items Photo', 'Foto Barang')} kind="items" actor={profile?.id ?? ''} folder={photoFolder} value={itemsPhoto} otherHash={receiptPhoto?.hash} onChange={setItemsPhoto}/>
          </div>
          {isDemoMode ? <p className="text-xs text-muted">{text('Preview photos stay on this device. Live records use private cloud storage.', 'Foto pratonton disimpan pada peranti ini. Rekod langsung menggunakan storan awan peribadi.')}</p> : null}
          {!can('purchasing.cost.view') ? <p role="alert" className="mt-2 text-sm text-danger">{text('A purchasing PIC with cost access must record this purchase.', 'PIC pembelian dengan akses kos perlu merekod pembelian ini.')}</p> : null}
          <div className="purchase-entry-tools">
          <div className="supply-segments purchase-entry-filters" aria-label={text('Purchase Items', 'Item Belian')}>
            <button type="button" aria-pressed={entryFilter === 'all'} onClick={() => { setEntryFilter('all'); }}>{text('All', 'Semua')} ({items.length})</button>
            <button type="button" aria-pressed={entryFilter === 'entered'} onClick={() => { setEntryFilter('entered'); }}>{text('Entered', 'Diisi')} ({entered.length})</button>
          </div>
          <div className="my-2 flex min-w-0 items-center gap-2">
            <label className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted" /><input className={inputClass + ' !pl-9 !pr-11'} aria-label={text('Find Item', 'Cari Item')} placeholder={text('Find Item', 'Cari Item')} value={search} onChange={event => { setSearch(event.target.value); }} />{search ? <button type="button" className="absolute right-0 top-0 grid h-11 w-11 place-items-center" aria-label={text('Clear Item Search', 'Padam Carian Item')} title={text('Clear Item Search', 'Padam Carian Item')} onClick={() => { setSearch(''); }}><X size={16}/></button> : null}</label>
            {can('purchasing.cost.view') ? <label className="flex min-h-11 shrink-0 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-accent" checked={withCosts} disabled={Object.values(entries).some(entry => !!entry.cost.trim())} onChange={event => setWithCosts(event.target.checked)} />{text('Add Costs', 'Tambah Kos')}</label> : null}
          </div>
          <div className={rowClass + ' border-b border-line pb-2 text-xs font-semibold text-muted'}><span>{text('Item', 'Item')} ({visible.length})</span><span className="text-right">{text('Bought', 'Dibeli')}</span>{showCosts ? <span className="text-right">{text('Total MYR', 'Jumlah MYR')}</span> : null}</div>
          </div>
          <ul ref={entryList} className="purchase-entry-list divide-y divide-line">{visible.map((item, index) => {
            const entry = entries[item.id] ?? { quantity: '', cost: '' };
            const issue = purchaseEntryIssues(entry, remainingToBuy(item));
            const unavailable = item.purchase_status === 'unavailable' || remainingToBuy(item) === 0;
            const recheck = draft.recheck[item.id];
            const quantityError = unavailable ? text('This item is no longer available to buy on this request. Remove this entry.', 'Item ini tidak lagi boleh dibeli dalam permintaan ini. Buang catatan ini.')
              : recheck ? text(`Item changed. Previously: ${recheck.name} (${recheck.unit}). Re-enter the quantity using the current unit.`, `Item berubah. Sebelum ini: ${recheck.name} (${recheck.unit}). Isi semula kuantiti mengikut unit semasa.`)
              : issue.quantity === 'exceeds' ? text(`Only ${remainingToBuy(item)} ${item.unit} left to buy.`, `Baki untuk dibeli: ${remainingToBuy(item)} ${item.unit}.`)
              : issue.quantity ? text('Enter more than 0, up to 2 decimals.', 'Isi lebih daripada 0, sehingga 2 perpuluhan.') : '';
            return <li key={item.id} className={rowClass + ' py-2'} onFocus={() => setFocusedEntry(item.id)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedEntry(null); }}>
              <div className="min-w-0"><p className="break-words text-sm font-semibold">{item.item_name}</p><p className="mt-0.5 break-words text-xs text-muted">{text('Still To Buy', 'Belum Dibeli')} {remainingToBuy(item)} {item.unit}</p>{item.note ? <p className="mt-0.5 break-words text-xs text-muted">{item.note}</p> : null}</div>
              <label className="min-w-0 self-start"><input id={`${entryId}-${item.id}-input`} data-purchase-entry aria-label={`${text('Bought', 'Dibeli')}: ${item.item_name} (${item.unit})`} aria-invalid={!!quantityError} aria-describedby={quantityError ? `${entryId}-${item.id}-quantity` : undefined} className={inputClass + ' !px-2 text-right tabular'} inputMode="decimal" enterKeyHint={index === visible.length - 1 && !showCosts ? 'done' : 'next'} onKeyDown={nextInput} value={entry.quantity} maxLength={12} onChange={event => update(item.id, 'quantity', event.target.value)} /><span className="mt-0.5 block break-words text-right text-[11px] text-muted">{item.unit}</span></label>
              {showCosts ? <input data-purchase-entry aria-label={`${text('Total Cost', 'Jumlah Kos')}: ${item.item_name} (MYR)`} aria-invalid={issue.cost} aria-describedby={issue.cost ? `${entryId}-${item.id}-cost` : undefined} className={inputClass + ' self-start !px-2 text-right tabular'} inputMode="decimal" enterKeyHint={index === visible.length - 1 ? 'done' : 'next'} onKeyDown={nextInput} value={entry.cost} maxLength={12} onChange={event => update(item.id, 'cost', event.target.value)} /> : null}
              {quantityError ? <p id={`${entryId}-${item.id}-quantity`} className="col-span-full text-xs text-danger">{quantityError}</p> : null}
              {unavailable || recheck ? <button type="button" className="col-span-full inline-flex min-h-11 items-center gap-2 text-sm text-danger" onClick={() => { const recheck = { ...current.current.recheck }, entries = { ...current.current.entries }; delete recheck[item.id]; delete entries[item.id]; edit({ entries, recheck }); }}><Trash2 size={16}/>{text('Remove Entry', 'Buang Catatan')}</button> : null}
              {issue.cost ? <p id={`${entryId}-${item.id}-cost`} className="col-span-full text-xs text-danger">{text('Use a cost of 0 or more, up to 2 decimals.', 'Isi kos 0 atau lebih, sehingga 2 perpuluhan.')}</p> : null}
            </li>;
          })}</ul>
          {!visible.length ? <p className="py-4 text-sm text-muted">{entryFilter === 'entered' && !entered.length ? text('No Items Entered', 'Belum Ada Item Diisi') : text('No Matching Items', 'Tiada Item Sepadan')}</p> : null}
        </fieldset> : <>
          <p className="break-words text-sm font-semibold">{supplier}{reference ? ` · ${reference}` : ''}</p>
          <p className="text-sm">{purpose && text(...purposeLabels[purpose])}</p>
          <p className="mt-1 text-xs text-muted">{text('Receipt Date', 'Tarikh Resit')}: {purchaseDate}</p>
          <p className="my-3 flex justify-between text-sm font-bold"><span>{text('Receipt Total', 'Jumlah Resit')}</span><span>MYR {(totalCents! / 100).toFixed(2)}</span></p>
          <PurchaseEvidenceViewer receipt={receiptPhoto!.path} items={itemsPhoto!.path}/>
          <div className={rowClass + ' mt-3 border-b border-line pb-2 text-xs font-semibold text-muted'}><span>{text('Item', 'Item')} ({entered.length})</span><span className="text-right">{text('Bought', 'Dibeli')}</span>{showCosts ? <span className="text-right">MYR</span> : null}</div>
          <ul className="divide-y divide-line">{entered.map(item => <li className={rowClass + ' py-2 text-sm'} key={item.id}><button type="button" className="purchase-review-edit" disabled={busy || attempted} aria-label={`${text('Edit', 'Ubah')}: ${item.item_name}`} onClick={() => editReviewedItem(item.id)}><Pencil size={14}/><span>{item.item_name}</span></button><span className="break-words text-right tabular">{Number(entries[item.id].quantity)} {item.unit}</span>{showCosts ? <span className="break-words text-right tabular">{entries[item.id].cost.trim() ? Number(entries[item.id].cost).toFixed(2) : text('Not Entered', 'Belum Diisi')}</span> : null}</li>)}</ul>
          <p className="mt-3 text-sm text-muted">{text(`${items.length - entered.length} not included · Awaiting delivery after confirmation.`, `${items.length - entered.length} tidak termasuk · Menunggu penghantaran selepas pengesahan.`)}</p>
        </>}
        {completeCosts ? <p className={`mt-3 text-xs ${lineCents === totalCents ? 'text-palm' : 'text-warning'}`}>{text('Item Costs', 'Kos Item')}: MYR {(lineCents / 100).toFixed(2)}{lineCents !== totalCents ? text(' · Different from receipt total. Check taxes, discounts or missing items.', ' · Berbeza daripada jumlah resit. Semak cukai, diskaun atau item tertinggal.') : ''}</p> : null}
        {error ? <p role="alert" className="mt-3 break-words text-sm text-danger">{error}</p> : null}
      </>}
  </Modal>;
}

export function PurchaseBatchRecords({ request }: { request: PurchaseRequest }) {
  const { text } = useLanguage();
  const [records, setRecords] = useState<PurchaseBatchRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void (async () => {
      try {
        const result = await supabase.rpc('read_purchase_batch_records', { p_request_id: request.id });
        if (result.error) throw result.error;
        if (active) { setRecords(result.data.records); setTotal(result.data.total); }
      } catch (failure) { if (active) setError(readErrorMessage(failure, text('Could not load purchase records.', 'Rekod pembelian tidak dapat dimuatkan.'))); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [request.id, retry, text]);
  return <>
    {loading ? <p role="status" className="text-sm text-muted">{text('Loading...', 'Memuatkan...')}</p> : error ? <div role="alert" className="grid gap-3 text-sm text-danger">{error}<button className={secondaryButtonClass} onClick={() => setRetry(value => value + 1)}>{text('Retry', 'Cuba Lagi')}</button></div> : <>
      {!records.length ? <p className="text-sm text-muted">{text('No multi-item confirmations recorded. Individual purchases appear in the request list.', 'Tiada pengesahan berbilang item direkod. Pembelian individu dipaparkan dalam senarai permintaan.')}</p> : null}
      {total > records.length ? <p className="mb-3 text-xs text-muted">{text(`Latest ${records.length} of ${total} records`, `${records.length} rekod terkini daripada ${total}`)}</p> : null}
      <div className="divide-y divide-line">{records.map(record => <div key={record.id} className="py-3 first:pt-0"><PurchaseRecord record={record} /></div>)}</div>
    </>}
  </>;
}
