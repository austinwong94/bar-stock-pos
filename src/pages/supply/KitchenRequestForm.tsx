import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type ClipboardEvent, type FormEvent } from 'react';
import Papa from 'papaparse';
import { Check, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { Field, buttonClass, iconButtonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { useLanguage } from '../../lib/language';
import { supabase } from '../../lib/supabase';
import { readErrorMessage, todayIso } from '../../lib/opsData';
import { definitiveInitialSaveFailure } from '../../lib/saveAttempt';
import { kitchenGroupEnglish, type KitchenGroup } from '../../lib/kitchenCatalogue';
import { blankRequestItem, mergeRequestCatalogue, readRequestDraft, requestCatalogueRows, requestDraftPayload, requestItemGroup, requestItemMatches, requestRows, requestUnits, writeRequestDraft, type KitchenRequestDraft, type RequestItemEntry } from '../../lib/kitchenRequestDraft';
import type { CatalogueItem, PurchaseRequest } from '../../lib/platformTypes';

export function KitchenRequestForm({ request, repeat, storageKey, onClose, onSaved, onDraftChange }: {
  request: PurchaseRequest | null; repeat: PurchaseRequest | null; storageKey: string;
  onClose: () => void; onSaved: (id: string) => void; onDraftChange: () => void;
}) {
  const { text: t } = useLanguage();
  const [initial] = useState(() => {
    try { const raw = localStorage.getItem(storageKey); return { raw, draft: readRequestDraft(raw), error: '' }; }
    catch (e) { return { raw: null, draft: null, error: readErrorMessage(e, 'Could not read this draft.') }; }
  });
  const raw = useRef(initial.raw), sending = useRef(false),section=useRef<HTMLFormElement>(null);
  const [form, setForm] = useState<KitchenRequestDraft>(() => initial.draft ?? {
    version: 1, requestId: request?.id ?? '', requestNo: request?.request_no ?? '', expected: request?.updated_at ?? null,
    operationId: crypto.randomUUID(), neededFor: request?.needed_for_date ?? todayIso(), pax: request ? String(request.pax_count) : '',
    purpose: request?.purpose ?? '', notes: request?.notes ?? '', items: request ? requestRows(request) : repeat ? requestRows(repeat, true) : [], attempted: false, updatedAt: new Date().toISOString(),
  });
  const [loading, setLoading] = useState(!initial.error), [busy, setBusy] = useState(false), [error, setError] = useState(initial.error);
  const [hasDraft, setHasDraft] = useState(!!initial.raw), [changedElsewhere, setChangedElsewhere] = useState(false), [stale, setStale] = useState(false);
  const [search, setSearch] = useState(''), [enteredOnly, setEnteredOnly] = useState(false), [expanded, setExpanded] = useState<string | null>(null), [focused, setFocused] = useState<string | null>(null);
  const [discard, setDiscard] = useState(false), [savedId, setSavedId] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [issue,setIssue]=useState<{key:string;kind:'quantity'|'name'|'unit';message:string}|null>(null),issueId=useId();
  const blocked = loading || busy || !!initial.error || changedElsewhere || stale || form.attempted || !!savedId;
  const entered = form.items.filter(i => i.quantity.trim() && Number(i.quantity) !== 0);
  const visible = form.items.filter(i => i.key === expanded || requestItemMatches(i, search) && (!enteredOnly || i.key === focused || !!i.quantity.trim() && Number(i.quantity) !== 0));
  const groupName = (group: string) => t(kitchenGroupEnglish[group as KitchenGroup] ?? (group === 'Other' ? 'Other Items' : group), group === 'Other' ? 'Item Lain' : group);
  function itemIssue(key:string,kind:'quantity'|'name'|'unit'){return issue?.key===key&&issue.kind===kind;}
  function showItemIssue(key:string,kind:'quantity'|'name'|'unit',message:string){setSearch('');setEnteredOnly(false);setFocused(null);setExpanded(kind==='quantity'?null:key);setIssue({key,kind,message});}
  useLayoutEffect(()=>{
    if(!issue||blocked||discard)return;
    const control=[...section.current?.querySelectorAll<HTMLInputElement|HTMLSelectElement>('[data-request-key]')??[]].find(el=>el.dataset.requestKey===issue.key&&el.dataset.requestField===issue.kind);
    if(!control)return;
    control.focus({preventScroll:true});if(control instanceof HTMLInputElement)control.select();
    const frame=issue.kind==='quantity'?control.closest('.request-item-row'):control.closest('label');
    (frame??control).scrollIntoView({block:'center'});
  },[issue,blocked,discard,expanded]);

  useEffect(() => {
    if (initial.error) return;
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        if (form.requestId && !form.attempted) {
          const r = await supabase.from('purchase_requests').select('id,status,updated_at').eq('id', form.requestId).maybeSingle();
          if (r.error) throw r.error;
          if (!active) return;
          if (!r.data || r.data.status !== 'draft' || r.data.updated_at !== form.expected) { setStale(true); return; }
        }
        if (!initial.draft) {
          const r = await supabase.from('catalogue_items').select('*').eq('kind', 'ingredient').eq('active', true).order('name');
          if (r.error) throw r.error;
          if (!active) return;
          const catalogue = requestCatalogueRows((r.data ?? []) as CatalogueItem[]);
          setForm(old => ({ ...old, items: mergeRequestCatalogue(old.items, catalogue) }));
        }
        setError('');
      } catch (e) { if (active) setError(readErrorMessage(e, t('Could not load the request list. Retry before entering quantities.', 'Senarai permintaan gagal dimuatkan. Cuba lagi sebelum mengisi kuantiti.'))); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  // The list is loaded once per opened form; language changes must not reset typed quantities.
  }, [retry]);

  useEffect(() => {
    const changed = (e: StorageEvent) => { if (e.storageArea === localStorage && (e.key === storageKey || e.key === null)) setChangedElsewhere(true); };
    window.addEventListener('storage', changed); return () => window.removeEventListener('storage', changed);
  }, [storageKey]);

  function persist(next: KitchenRequestDraft) {
    raw.current = writeRequestDraft(localStorage, storageKey, next, raw.current);
    setForm(next); setHasDraft(true); onDraftChange();
  }
  function edit(patch: Partial<KitchenRequestDraft>) {
    if (blocked || sending.current) return false;
    try { persist({ ...form, ...patch, updatedAt: new Date().toISOString() }); setError(''); setIssue(null); return true; }
    catch (e) { setError(readErrorMessage(e, t('Draft not saved on this device.', 'Draf belum disimpan pada peranti ini.'))); return false; }
  }
  function update(key: string, patch: Partial<RequestItemEntry>) { return edit({ items: form.items.map(i => i.key === key ? { ...i, ...patch } : i) }); }
  function nextFromName(item:RequestItemEntry){
    if(blocked||sending.current)return;
    if(!item.item_name.trim())return showItemIssue(item.key,'name',t('Enter the item name.','Isi nama item.'));
    setExpanded(null);setIssue(null);
    const input=[...section.current?.querySelectorAll<HTMLInputElement>('.request-quantity')??[]].find(el=>el.dataset.requestKey===item.key);
    if(input){input.focus({preventScroll:true});input.select();input.scrollIntoView({block:'center'});}
  }
  function pasteItems(event: ClipboardEvent<HTMLInputElement>, key: string) {
    const value = event.clipboardData.getData('text/plain');
    if (!/[\t\n]/.test(value)) return;
    event.preventDefault();
    const result = Papa.parse<string[]>(value, { delimiter: '\t', skipEmptyLines: 'greedy' });
    if (result.errors.length) { setError(t('Could not read the pasted rows. Check the copied cells.', 'Baris ditampal tidak dapat dibaca. Semak sel yang disalin.')); return; }
    const next = [...form.items], start = next.findIndex(i => i.key === key);
    if (start < 0 || Math.max(next.length, start + result.data.length) > 1000) return;
    result.data.forEach((cells, offset) => {
      const base = next[start + offset] ?? blankRequestItem();
      next[start + offset] = { ...base, item_name: (cells[0] ?? base.item_name).trim(), quantity: (cells[1] ?? base.quantity).trim(), unit: (cells[2] ?? base.unit).trim() || base.unit, note: (cells[3] ?? base.note).trim() };
    });
    edit({ items: next });
  }
  function discardDraft() {
    try { writeRequestDraft(localStorage, storageKey, null, raw.current); onDraftChange(); onClose(); }
    catch (e) { setError(readErrorMessage(e, 'Draft could not be discarded.')); setDiscard(false); }
  }
  function addItem() {
    const item = blankRequestItem();
    if (edit({ items: [...form.items, item] })) { setSearch(''); setEnteredOnly(false); setExpanded(item.key); }
  }
  // Only opening the editor moves focus; typing must keep the active field.
  useEffect(() => { if (expanded&&!issue) document.getElementById('request-name-' + expanded)?.focus(); }, [expanded]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (sending.current || loading || initial.error || changedElsewhere || stale) return;
    if (savedId) { onSaved(savedId); return; }
    setError('');setIssue(null);
    if (!form.attempted) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(form.neededFor) || !Number.isFinite(Date.parse(form.neededFor)) || new Date(form.neededFor).toISOString().slice(0, 10) !== form.neededFor) { setError(t('Choose a valid needed-by date.', 'Pilih tarikh diperlukan yang sah.')); return; }
      if (!entered.length) { setError(t('Enter a quantity for at least one item.', 'Isi kuantiti bagi sekurang-kurangnya satu item.')); return; }
      const invalid = form.items.find(i => (!i.item_name.trim() && (i.quantity.trim() || i.note.trim())) || (i.quantity.trim() && (!/^\d+(\.\d{1,2})?$/.test(i.quantity.trim()) || !Number.isFinite(Number(i.quantity)))) || !i.unit.trim());
      if(invalid){
        if(!invalid.item_name.trim())return showItemIssue(invalid.key,'name',t('Enter the item name.','Isi nama item.'));
        if(invalid.quantity.trim()&&(!/^\d+(\.\d{1,2})?$/.test(invalid.quantity.trim())||!Number.isFinite(Number(invalid.quantity))))return showItemIssue(invalid.key,'quantity',t('Enter 0 or more, with up to two decimal places.','Isi 0 atau lebih, sehingga dua tempat perpuluhan.'));
        return showItemIssue(invalid.key,'unit',t('Choose the unit for this item.','Pilih unit untuk item ini.'));
      }
      if (!Number.isSafeInteger(Number(form.pax)) || Number(form.pax) < 0) { setError(t('Pax must be a whole number, zero or greater.', 'Pax mesti nombor bulat, sifar atau lebih.')); return; }
    }
    sending.current = true; setBusy(true);
    try {
      const pending = { ...form, attempted: true };
      persist(pending);
      const result = await supabase.rpc('save_purchase_request', requestDraftPayload(pending));
      if (result.error) throw result.error;
      if (typeof result.data !== 'string' || !result.data) throw Error(t('Save confirmation was not received. Check this same request again.', 'Pengesahan simpanan belum diterima. Semak permintaan yang sama.'));
      setSavedId(result.data);
      raw.current = writeRequestDraft(localStorage, storageKey, null, raw.current);
      onDraftChange(); onSaved(result.data);
    } catch (e) {
      setError(readErrorMessage(e, t('Save not confirmed. Check this same request before starting another.', 'Simpanan belum disahkan. Semak permintaan yang sama sebelum memulakan yang lain.')));
      if (definitiveInitialSaveFailure(form.attempted, e)) {
        try { persist({ ...form, attempted: false, operationId: crypto.randomUUID() }); } catch { setChangedElsewhere(true); }
      }
    } finally { sending.current = false; setBusy(false); }
  }

  return <Modal title={discard ? t('Discard Device Draft?', 'Buang Draf Peranti?') : form.requestNo ? `${t('Edit', 'Edit')} ${form.requestNo}` : t('New Kitchen Request', 'Permintaan Dapur Baru')} panelClassName="request-dialog" onClose={() => { if (!busy) onClose(); }} footer={discard ? <div className="flex justify-end gap-2"><button className={secondaryButtonClass} onClick={() => setDiscard(false)}>{t('Keep Draft', 'Simpan Draf')}</button><button className={buttonClass} onClick={discardDraft}>{t('Discard Draft', 'Buang Draf')}</button></div> : <div className="request-entry-footer"><span className="text-sm tabular"><strong>{entered.length}</strong> {t('Items', 'Item')}</span><button type="submit" form="kitchen-request-form" className={buttonClass} disabled={busy || loading || !!initial.error || changedElsewhere || stale || (!entered.length && !form.attempted)}>{busy ? t('Saving...', 'Menyimpan...') : savedId ? t('Open Saved Request', 'Buka Permintaan Tersimpan') : form.attempted ? t('Check Saved Request', 'Semak Permintaan Tersimpan') : t('Save & Review', 'Simpan & Semak')}</button></div>}>
    {discard ? <p className="text-sm">{t('Remove only the unfinished draft on this device? Saved requests and stock balances stay unchanged.', 'Buang draf belum siap pada peranti ini sahaja? Permintaan tersimpan dan baki stok tidak berubah.')}</p> : <form ref={section} id="kitchen-request-form" onSubmit={save} className="request-entry">
      {error ? <p role="alert" className="text-sm text-danger">{error} {!hasDraft && !initial.error ? <button type="button" className="underline" onClick={() => setRetry(n => n + 1)}>{t('Retry', 'Cuba Lagi')}</button> : null}</p> : null}
      {hasDraft ? <div className="request-draft-status"><span>{form.attempted ? t('Save Pending · Not Sent', 'Simpanan Belum Pasti · Belum Dihantar') : t('Draft on This Device · Not Sent', 'Draf di Peranti Ini · Belum Dihantar')}</span>{!form.attempted ? <button type="button" className={iconButtonClass} disabled={busy || changedElsewhere} title={t('Discard Device Draft', 'Buang Draf Peranti')} aria-label={t('Discard Device Draft', 'Buang Draf Peranti')} onClick={() => setDiscard(true)}><Trash2 size={16}/></button> : null}</div> : null}
      {changedElsewhere ? <p role="alert" className="text-sm text-danger">{t('This draft changed in another tab. Close and resume it to load the latest entry.', 'Draf berubah di tab lain. Tutup dan sambung semula untuk memuatkan catatan terkini.')}</p> : null}
      {stale ? <p role="alert" className="text-sm text-danger">{t('This saved request changed after your draft. Discard this device draft and reopen the saved request before editing.', 'Permintaan tersimpan berubah selepas draf ini. Buang draf peranti dan buka semula permintaan tersimpan sebelum mengedit.')}</p> : null}
      {loading ? <p role="status" className="text-sm">{t('Loading Usual Items...', 'Memuatkan Item Biasa...')}</p> : null}
      <fieldset disabled={blocked} className="request-entry">
        <div className="request-entry-meta"><Field label={t('Needed By', 'Diperlukan Pada')}><input type="date" className={inputClass} value={form.neededFor} onChange={e => edit({ neededFor: e.target.value })} required/></Field><details><summary>{t('Optional Details', 'Butiran Pilihan')}</summary><div className="grid gap-3 pt-3"><Field label={t('Pax', 'Pax')}><input inputMode="numeric" className={inputClass} maxLength={60} value={form.pax} onChange={e => edit({ pax: e.target.value })}/></Field><Field label={t('Purpose', 'Tujuan')}><input className={inputClass} maxLength={500} value={form.purpose} onChange={e => edit({ purpose: e.target.value })}/></Field><Field label={t('Purchasing Note', 'Nota Pembelian')}><input className={inputClass} maxLength={2000} value={form.notes} onChange={e => edit({ notes: e.target.value })}/></Field></div></details></div>
        <div className="request-list-tools">
          <div className="request-entry-filter"><input type="search" className={inputClass} placeholder={t('Find Item', 'Cari Item')} aria-label={t('Find Request Item', 'Cari Item')} value={search} onChange={e => { setSearch(e.target.value); setExpanded(null); setFocused(null); if (e.target.value.trim()) setEnteredOnly(false); }}/><div className="supply-segments two" role="group" aria-label={t('Request Items', 'Item Permintaan')}><button type="button" aria-pressed={!enteredOnly} onClick={() => { setSearch(''); setExpanded(null); setFocused(null); setEnteredOnly(false); }}>{t('All Items', 'Semua Item')}</button><button type="button" aria-pressed={enteredOnly} onClick={() => { setSearch(''); setExpanded(null); setFocused(null); setEnteredOnly(true); }}>{t('Entered', 'Diisi')} ({entered.length})</button></div></div>
          <div className="request-quantity-label"><span>{t('Item', 'Item')}</span><span>{t('Quantity', 'Kuantiti')}</span><span/></div>
        </div>
        <div className="request-item-list">{visible.map((item, index) => {
          const group = requestItemGroup(item), open = expanded === item.key;
          return <Fragment key={item.key}>{index === 0 || group !== requestItemGroup(visible[index - 1]) ? <h3 className="kitchen-category-heading">{groupName(group)}</h3> : null}<div className="request-item-row">
            <div className="request-item-name"><strong>{item.item_name || t('New Item', 'Item Baru')}</strong><span>{item.unit}</span>{item.note ? <small>{item.note}</small> : null}</div>
            <input className={inputClass + ' request-quantity'} id={'request-quantity-' + item.key} data-request-key={item.key} data-request-field="quantity" aria-invalid={itemIssue(item.key,'quantity')||undefined} aria-describedby={itemIssue(item.key,'quantity')?issueId:undefined} aria-label={`${item.item_name || t('New Item', 'Item Baru')} ${t('Quantity', 'Kuantiti')} (${item.unit})`} inputMode="decimal" enterKeyHint="next" onFocus={() => setFocused(item.key)} onBlur={() => setFocused(null)} maxLength={60} value={item.quantity} placeholder="" onChange={e => update(item.key, { quantity: e.target.value })} onKeyDown={e => { if (e.key === 'Enter'&&!e.nativeEvent.isComposing) { e.preventDefault(); const next = visible[index + 1]; if (next) document.getElementById('request-quantity-' + next.key)?.focus(); else e.currentTarget.blur(); } }}/>
            <button type="button" className={iconButtonClass} aria-expanded={open} aria-label={`${t('Edit Item', 'Edit Item')} ${item.item_name || index + 1}`} title={t('Edit Item', 'Edit Item')} onClick={() => {setIssue(null);setExpanded(open ? null : item.key);}}><MoreHorizontal size={18}/></button>
            {itemIssue(item.key,'quantity')?<p id={issueId} role="alert" className="request-field-error">{issue?.message}</p>:null}
            {open ? <div className="request-item-edit"><Field label={t('Item Name', 'Nama Item')}><input id={'request-name-' + item.key} data-request-key={item.key} data-request-field="name" aria-label={t('Item Name','Nama Item')} aria-invalid={itemIssue(item.key,'name')||undefined} aria-describedby={itemIssue(item.key,'name')?issueId:undefined} enterKeyHint="next" onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing){e.preventDefault();nextFromName(item);}}} className={inputClass} maxLength={500} onPaste={e => pasteItems(e, item.key)} value={item.item_name} onChange={e => update(item.key, { item_name: e.target.value })}/>{itemIssue(item.key,'name')?<p id={issueId} role="alert" className="request-field-error">{issue?.message}</p>:null}</Field><Field label="Unit"><select data-request-key={item.key} data-request-field="unit" aria-label="Unit" aria-invalid={itemIssue(item.key,'unit')||undefined} aria-describedby={itemIssue(item.key,'unit')?issueId:undefined} className={inputClass} value={item.unit} onChange={e => update(item.key, { unit: e.target.value })}>{!item.unit?<option value="">{t('Select Unit','Pilih Unit')}</option>:null}{[...new Set([item.unit, ...requestUnits])].filter(Boolean).map(u => <option key={u}>{u}</option>)}</select>{itemIssue(item.key,'unit')?<p id={issueId} role="alert" className="request-field-error">{issue?.message}</p>:null}</Field><Field label={t('Item Note', 'Nota Item')}><input className={inputClass} maxLength={2000} value={item.note} onChange={e => update(item.key, { note: e.target.value })}/></Field><div className="flex justify-between gap-2"><button type="button" className={secondaryButtonClass} onClick={() => { if (edit({ items: form.items.filter(i => i.key !== item.key) })) setExpanded(null); }}><Trash2 size={16}/>{t('Remove', 'Buang')}</button><button type="button" className={secondaryButtonClass} onClick={() => { setExpanded(null); document.getElementById('request-quantity-' + item.key)?.focus(); }}><Check size={16}/>{t('Done', 'Selesai')}</button></div></div> : null}
          </div></Fragment>;
        })}</div>
        {!visible.length && !loading ? <p className="py-3 text-sm text-muted">{search.trim() ? t('No matching items.', 'Tiada item sepadan.') : enteredOnly ? t('No quantities entered yet.', 'Belum ada kuantiti diisi.') : t('No items in this list. Add an item below.', 'Tiada item dalam senarai ini. Tambah item di bawah.')}</p> : null}
        <button type="button" className={secondaryButtonClass + ' justify-self-start'} onClick={addItem}><Plus size={16}/>{t('Add Item', 'Tambah Item')}</button>
      </fieldset>
    </form>}
  </Modal>;
}
