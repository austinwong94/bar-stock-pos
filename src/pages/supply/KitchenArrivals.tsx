import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Check, PackageCheck, Search, Trash2 } from 'lucide-react';
import { Field, buttonClass, iconButtonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { PurchaseSupplier } from '../../components/PurchaseSupplier';
import { Modal } from '../../components/Modal';
import { useLanguage } from '../../lib/language';
import { useAccess } from '../../lib/access';
import { supabase } from '../../lib/supabase';
import { todayIso, readErrorMessage } from '../../lib/opsData';
import { definitiveInitialSaveFailure } from '../../lib/saveAttempt';
import { kitchenName, kitchenFactor, kitchenUnit, kitchenOrdered, kitchenMatches, kitchenQuantity, kitchenGroupEnglish, type KitchenGroup } from '../../lib/kitchenCatalogue';
import { arrivalDate, arrivalDraftFromPending, readArrivalDraft, readPendingArrival, writeArrivalStorage, type ArrivalDraft, type ArrivalLine, type KitchenArrival, type PendingArrival } from '../../lib/kitchenArrivalDraft';
import type { CountItem } from '../../lib/stockCount';

import { MeasureChoices } from '../../components/MeasureChoices';
import { entryQuantity, changeMeasure, measureOptions, validMeasure } from '../../lib/kitchenMeasure';
import { preferredMeasure } from '../../lib/kitchenQuickEntry';
import { useKitchenMeasurePreference } from '../../lib/useKitchenMeasurePreference';

const blank = (supplier = ''): ArrivalDraft => ({ date: todayIso(), supplier, reference: '', entries: {}, updatedAt: new Date().toISOString() });
export default function KitchenArrivals({ onSaved, onDraftChange, active = true }: { onSaved?: () => Promise<void>; onDraftChange?: () => void; active?: boolean }) {
  const { text: t } = useLanguage(), { profile } = useAccess();
  const unitMemory=useKitchenMeasurePreference('arrival'),section=useRef<HTMLElement>(null);
  const key = `kitchen-arrival:${import.meta.env.VITE_SUPABASE_URL ?? 'review'}:${profile?.id}`, draftKey = key + ':draft';
  const [initial] = useState(() => {
    try {
      const raw = localStorage.getItem(key), draftRaw = localStorage.getItem(draftKey), pending = readPendingArrival(raw), draft = readArrivalDraft(draftRaw);
      return { raw, draftRaw, pending, draft: draft ?? (pending ? arrivalDraftFromPending(pending) : blank()), error: '' };
    } catch (e) { return { raw: null, draftRaw: null, pending: null, draft: blank(), error: readErrorMessage(e, 'Could not read this delivery.') }; }
  });
  const [form, setForm] = useState(initial.draft), [pending, setPending] = useState<PendingArrival | null>(initial.pending);
  const [items, setItems] = useState<CountItem[]>([]), [records, setRecords] = useState<KitchenArrival[]>([]);
  const [error, setError] = useState(''), [storageError, setStorageError] = useState(initial.error), [loadError, setLoadError] = useState(''), [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [checked, setChecked] = useState(false);
  const [hasDraft, setHasDraft] = useState(!!initial.draftRaw), [changedElsewhere, setChangedElsewhere] = useState(false), [discard, setDiscard] = useState(false);
  const [search, setSearch] = useState(''), [enteredOnly, setEnteredOnly] = useState(false), [focused, setFocused] = useState<string | null>(null);
  const [issue,setIssue]=useState<{id:string;message:string}|null>(null),issueId=useId();
  const pendingRaw = useRef(initial.raw), draftRaw = useRef(initial.draftRaw), lock = useRef(false), sequence = useRef(0);
  const { date, supplier, reference, entries } = form;
  const entered = Object.entries(entries).filter(([,e]) => e.value.trim());
  const blocked = loading || busy || !!pending || !!storageError || !!loadError || changedElsewhere;
  useLayoutEffect(()=>{
    if(!issue||!active||blocked)return;
    const input=[...section.current?.querySelectorAll<HTMLInputElement>('input[data-arrival-item]')??[]].find(el=>el.dataset.arrivalItem===issue.id);
    const remove=[...section.current?.querySelectorAll<HTMLButtonElement>('button[data-arrival-missing]')??[]].find(el=>el.dataset.arrivalMissing===issue.id);
    const control=input??remove;if(!control)return;
    const row=control.closest('li')??control.closest('.count-unavailable');
    if(control.disabled)(row as HTMLElement)?.focus({preventScroll:true});else control.focus({preventScroll:true});
    row?.scrollIntoView({block:'center'});
  },[issue,active,blocked]);
  const refresh = useCallback(async () => {
    const ticket = ++sequence.current; setLoading(true);
    try {
      const r = await supabase.rpc('read_kitchen_stock'); if (r.error) throw r.error;
      const history = await supabase.rpc('read_kitchen_arrivals', { p_from: arrivalDate(date) ? date : todayIso(), p_to: arrivalDate(date) ? date : todayIso() }); if (history.error) throw history.error;
      if (ticket !== sequence.current) return;
      setItems(kitchenOrdered(r.data.items)); setRecords(history.data ?? []); setLoadError('');
    } catch (e) { if (ticket === sequence.current) setLoadError(readErrorMessage(e, t('Could not load deliveries.', 'Penghantaran tidak dapat dimuatkan.'))); }
    finally { if (ticket === sequence.current) setLoading(false); }
  }, [date, t]);
  useEffect(() => { void refresh(); return () => { sequence.current++; }; }, [refresh]);
  useEffect(() => {
    const changed = (e: StorageEvent) => { if (e.storageArea === localStorage && (e.key === null || e.key === key || e.key === draftKey)) { setChangedElsewhere(true); onDraftChange?.(); } };
    window.addEventListener('storage', changed); return () => window.removeEventListener('storage', changed);
  }, [key, draftKey, onDraftChange]);
  function assertCurrent() {
    if (localStorage.getItem(key) !== pendingRaw.current || localStorage.getItem(draftKey) !== draftRaw.current) throw Error(t('This delivery changed in another tab. Reload the draft before editing.', 'Penghantaran berubah di tab lain. Muat semula draf sebelum mengedit.'));
  }
  function edit(patch: Partial<ArrivalDraft>) {
    if (blocked || lock.current) return false;
    try {
      assertCurrent();
      const next = { ...form, ...patch, updatedAt: new Date().toISOString() };
      draftRaw.current = writeArrivalStorage(localStorage, draftKey, next, draftRaw.current);
      setForm(next); setHasDraft(true); setError(''); setNotice(''); setIssue(null); onDraftChange?.();
      return true;
    } catch (e) { setError(readErrorMessage(e, 'Draft not saved on this device.')); return false; }
  }
  function update(item: CountItem, value: string, measure?:string) {
    const snapshot={name:kitchenName(item),unit:kitchenUnit(item),baseUnit:item.base_unit,factor:kitchenFactor(item),version:item.updated_at};
    const next = { ...entries };
    if (!value && (!measure||!kitchenFactor(item)||!validMeasure(measure,item.base_unit))) delete next[item.id];
    else next[item.id] = { ...(value?entries[item.id]??snapshot:snapshot), value, measure };
    return edit({ entries: next });
  }
  function showIssue(id:string,message:string){setSearch('');setEnteredOnly(false);setFocused(null);setIssue({id,message});}
  function reloadDraft() {
    if (busy) return;
    try {
      const raw = localStorage.getItem(key), dRaw = localStorage.getItem(draftKey), p = readPendingArrival(raw), d = readArrivalDraft(dRaw);
      pendingRaw.current = raw; draftRaw.current = dRaw; setPending(p); setForm(d ?? (p ? arrivalDraftFromPending(p) : blank()));
      setHasDraft(!!d); setChangedElsewhere(false); setStorageError(''); setError(''); setIssue(null); setChecked(false); setDiscard(false); onDraftChange?.(); void refresh();
    } catch (e) { setStorageError(readErrorMessage(e, 'Could not load this draft.')); }
  }
  function discardDraft() {
    try { assertCurrent(); draftRaw.current = writeArrivalStorage(localStorage, draftKey, null, draftRaw.current); setForm(blank()); setHasDraft(false); setDiscard(false); setError(''); onDraftChange?.(); }
    catch (e) { setError(readErrorMessage(e, 'Draft could not be discarded.')); setDiscard(false); }
  }
  function review() {
    setError('');setIssue(null);
    try {
      if (blocked) return;
      assertCurrent();
      if (!arrivalDate(date) || date > todayIso()) throw Error(t('Choose the actual delivery date, not a future date.', 'Pilih tarikh sebenar barang tiba, bukan tarikh akan datang.'));
      const lines:ArrivalLine[]=[];
      for(const [id,entry] of entered){
        const item = items.find(i => i.id === id && i.active);
        if(!item)return showIssue(id,t('Remove this unfinished entry before reviewing.','Buang catatan belum siap ini sebelum menyemak.'));
        if(entry.version!==item.updated_at||entry.factor!==kitchenFactor(item)||entry.unit!==kitchenUnit(item)||entry.baseUnit!==item.base_unit)return showIssue(id,t('Item changed. Clear the quantity and enter the actual amount again.','Item berubah. Kosongkan kuantiti dan isi semula jumlah sebenar.'));
        const quantity = entryQuantity(entry.value, item, entry.measure);
        if(quantity===null||quantity<=0)return showIssue(id,t('Enter an amount greater than 0 in the selected unit.','Isi jumlah melebihi 0 dalam unit dipilih.'));
        lines.push({ ingredient_id: id, name: entry.name, quantity, entered_quantity: Number(entry.value), display_unit: entry.measure??entry.unit, setup_unit:entry.unit, setup_factor:entry.factor, unit: entry.baseUnit, expected_version: entry.version });
      }
      if (!lines.length || !supplier.trim()) throw Error(t('Select the supplier and quantities received.', 'Pilih pembekal dan kuantiti diterima.'));
      const p = { id: crypto.randomUUID(), record: { date, supplier, reference, lines }, attempted: false };
      pendingRaw.current = writeArrivalStorage(localStorage, key, p, pendingRaw.current); setPending(p); setChecked(false); onDraftChange?.();
    } catch (e) { setError(readErrorMessage(e, 'Check delivered quantities.')); }
  }
  function back() {
    if (busy || !pending || pending.attempted || changedElsewhere) return;
    try {
      assertCurrent();
      const restored = readArrivalDraft(draftRaw.current) ?? arrivalDraftFromPending(pending);
      draftRaw.current = writeArrivalStorage(localStorage, draftKey, restored, draftRaw.current);
      pendingRaw.current = writeArrivalStorage(localStorage, key, null, pendingRaw.current);
      setForm(restored); setHasDraft(true); setPending(null); setChecked(false); setError(''); onDraftChange?.();
    } catch (e) { setError(readErrorMessage(e, 'Could not return to this draft.')); }
  }
  async function confirm() {
    if (!pending || !checked || lock.current || changedElsewhere || storageError) return;
    lock.current = true; setBusy(true); setError('');
    try {
      assertCurrent();
      const p = { ...pending, attempted: true };
      pendingRaw.current = writeArrivalStorage(localStorage, key, p, pendingRaw.current); setPending(p);
      const r = await supabase.rpc('record_kitchen_arrival', { p_record: p.record, p_operation_id: p.id });
      if (r.error) throw r.error;
      if (!r.data?.id || r.data.date !== p.record.date) throw Error('Confirmation incomplete. Retry this same delivery.');
      draftRaw.current = writeArrivalStorage(localStorage, draftKey, null, draftRaw.current);
      pendingRaw.current = writeArrivalStorage(localStorage, key, null, pendingRaw.current);
      setPending(null); setHasDraft(false); setForm({ ...blank(p.record.supplier), date: p.record.date }); setEnteredOnly(false); setSearch('');
      setNotice(t('Delivery Confirmed', 'Penghantaran Disahkan') + ' · ' + r.data.id.slice(0, 8) + ' · ' + r.data.created_by_name); onDraftChange?.();
      await refresh(); await onSaved?.().catch(e => setError(readErrorMessage(e, 'Delivery confirmed. Refresh stock to see the latest balance.')));
    } catch (e) {
      setError(readErrorMessage(e, 'Confirmation is uncertain. Retry this same delivery.'));
      if (definitiveInitialSaveFailure(pending.attempted, e)) {
        try { const p = { ...pending, attempted: false }; pendingRaw.current = writeArrivalStorage(localStorage, key, p, pendingRaw.current); setPending(p); } catch { setChangedElsewhere(true); }
      }
    } finally { lock.current = false; setBusy(false); }
  }
  const visible = items.filter(i => i.active && kitchenMatches(i, search) && (!enteredOnly || entries[i.id]?.value.trim() || focused === i.id));
  const missing = loadError?[]:entered.filter(([id]) => !items.some(i => i.id === id && i.active));
  const warning = changedElsewhere ? t('This delivery changed in another tab.', 'Penghantaran berubah di tab lain.') : storageError;
  return <section ref={section} className="supply-workspace arrival-entry" onKeyDown={e=>{
    if(e.key==='Enter'&&!e.nativeEvent.isComposing&&e.target instanceof HTMLInputElement&&e.target.dataset.arrivalItem){
      e.preventDefault();const fields=[...section.current?.querySelectorAll<HTMLInputElement>('input[data-arrival-item]:not(:disabled)')??[]].filter(el=>el.getClientRects().length),next=fields[fields.indexOf(e.target)+1];
      if(next){next.focus({preventScroll:true});next.select();next.scrollIntoView({block:'center'});}else e.target.blur();
    }
  }}>
    <div className="supply-toolbar"><h2>{t('Unlisted Delivery', 'Penghantaran Lain')}</h2><input type="date" aria-label={t('Delivery Date', 'Tarikh Sampai')} className={inputClass + ' !w-auto'} value={date} max={todayIso()} disabled={busy || !!pending || changedElsewhere || !!storageError} onChange={e => edit({ date: e.target.value })}/></div>
    {notice ? <p role="status" className="my-3 text-sm text-palm">{notice}</p> : null}
    {hasDraft && !pending ? <div className="request-draft-status mb-3"><span>{t('Draft on This Device · Not Received', 'Draf di Peranti Ini · Belum Diterima')}</span><button className={iconButtonClass} disabled={busy || changedElsewhere} aria-label={t('Discard Delivery Draft', 'Buang Draf Penghantaran')} title={t('Discard Delivery Draft', 'Buang Draf Penghantaran')} onClick={() => setDiscard(true)}><Trash2 size={16}/></button></div> : null}
    {warning ? <p role="alert" className="my-3 text-sm text-danger">{warning} <button className="underline" disabled={busy} onClick={reloadDraft}>{t('Reload Draft', 'Muat Semula Draf')}</button></p> : null}
    {loadError ? <p role="alert" className="my-3 text-sm text-danger">{loadError} <button className="underline" onClick={() => void refresh()}>{t('Retry', 'Cuba Lagi')}</button></p> : null}
    {!pending && error ? <p role="alert" className="my-3 text-sm text-danger">{error}</p> : null}
    {unitMemory.failed&&!pending?<p role="status" className="my-3 text-xs text-muted">{t('Unit memory unavailable. Recording drafts are kept separately.','Ingatan unit tidak tersedia. Draf rekod disimpan berasingan.')}</p>:null}
    <fieldset disabled={blocked}>
      <div className="grid gap-3 sm:grid-cols-2"><PurchaseSupplier value={supplier} onChange={value => edit({ supplier: value })}/><Field label={t('Receipt / Delivery No. (Optional)', 'No. Resit / Penghantaran (Pilihan)')}><input className={inputClass} maxLength={120} value={reference} onChange={e => edit({ reference: e.target.value })}/></Field></div>
      <div className="arrival-entry-filter"><label className="relative block min-w-0"><Search className="absolute left-3 top-3" size={16}/><input type="search" aria-label={t('Find Delivered Item', 'Cari Barang Sampai')} placeholder={t('Find Item', 'Cari Item')} className={inputClass + ' pl-9'} value={search} onChange={e => {setSearch(e.target.value);if(e.target.value.trim())setEnteredOnly(false);}}/></label><div className="supply-segments two" role="group" aria-label={t('Delivery Items', 'Item Penghantaran')}><button type="button" aria-pressed={!enteredOnly} onClick={() => setEnteredOnly(false)}>{t('All Items', 'Semua Item')}</button><button type="button" aria-pressed={enteredOnly} onClick={() => {setEnteredOnly(true);setSearch('');setFocused(null);}}>{t('Entered', 'Diisi')} ({entered.length})</button></div></div>
      {missing.map(([id,e]) => <div key={id} role="alert" className="count-unavailable" tabIndex={issue?.id===id?-1:undefined}><div><strong>{e.name}</strong><span>{t('Not in the Active Item List', 'Tiada dalam Senarai Item Aktif')} · {e.value} {e.measure??e.unit}</span>{issue?.id===id?<p id={issueId} className="arrival-entry-error">{issue.message}</p>:null}</div><button type="button" data-arrival-missing={id} aria-describedby={issue?.id===id?issueId:undefined} className={secondaryButtonClass} aria-label={t('Remove Delivery Entry: ','Buang Catatan Penghantaran: ')+e.name} onClick={() => { const next = { ...entries }; delete next[id]; edit({ entries: next }); }}>{t('Remove Entry', 'Buang Catatan')}</button></div>)}
      <ul>{visible.map((i,index) => {
        const entry = entries[i.id], measure=entry?entry.measure:preferredMeasure(i,unitMemory.choices), unit = measure ?? entry?.unit ?? kitchenUnit(i), group = i.kitchen_group ?? 'Other';
        const changed = !!entry && (entry.version !== i.updated_at || entry.unit !== kitchenUnit(i) || entry.factor !== kitchenFactor(i) || entry.baseUnit !== i.base_unit);
        return <Fragment key={i.id}>{i.kitchen_group !== visible[index-1]?.kitchen_group ? <li className="kitchen-category-heading">{t(kitchenGroupEnglish[group as KitchenGroup] ?? 'Other Items', group === 'Other' ? 'Item Lain' : group)}</li> : null}<li tabIndex={issue?.id===i.id?-1:undefined} className={'kitchen-simple-row '+(measureOptions(i).length?'has-measure':'')} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setFocused(null);}}><div><strong>{kitchenName(i)}</strong><small>{unit}</small>{changed && issue?.id!==i.id ? <small className="!text-danger">{t('Setup Changed', 'Tetapan Berubah')}</small> : !kitchenFactor(i) ? <small className="!text-danger">{t('Unit Setup Needed', 'Tetapan Unit Diperlukan')}</small> : null}</div><div><input id={'arrival-quantity-' + i.id} data-arrival-item={i.id} aria-invalid={issue?.id===i.id||undefined} aria-describedby={issue?.id===i.id?issueId:undefined} aria-label={`${kitchenName(i)} ${t('Received','Diterima')} (${unit})`} className={inputClass + ' text-right'} inputMode="decimal" enterKeyHint="next" maxLength={60} disabled={!entry && !kitchenFactor(i)} value={entry?.value ?? ''} placeholder="" onFocus={() => setFocused(i.id)} onChange={e => update(i,e.target.value,measure)}/><MeasureChoices label={kitchenName(i)+' '+t('Received Unit','Unit Diterima')} options={measureOptions(i)} value={unit} disabled={blocked||!kitchenFactor(i)} onChange={next=>{const result=changeMeasure(entry?.value??'',i,measure,next);if(result){if(update(i,result.value,result.measure))unitMemory.remember(i,next);}else setError(t('Check this amount before changing units.','Semak jumlah ini sebelum menukar unit.'));}}/></div>{issue?.id===i.id?<div id={issueId} role="alert" className="arrival-entry-error"><p>{issue.message}</p></div>:null}</li></Fragment>;
      })}</ul>
      {!visible.length && !loading ? <p className="py-4 text-sm text-muted">{search.trim()?t('No Matching Items','Tiada Item Sepadan'):enteredOnly?(missing.length?t('No Active Entries in This View','Tiada Catatan Aktif dalam Paparan Ini'):t('No Quantities Entered Yet','Belum Ada Kuantiti Diisi')):t('No Active Items Available','Tiada Item Aktif Tersedia')}</p> : null}
      <div className="kitchen-entry-footer"><span className="text-sm">{entered.length} {t('Items', 'Item')} · {profile?.full_name}</span><button className={buttonClass} disabled={!supplier.trim() || !entered.length || !items.length} onClick={review}><PackageCheck size={16}/>{t('Review Delivery', 'Semak Penghantaran')}</button></div>
    </fieldset>
    {records.length ? <details className="mt-4 border-t border-line py-3"><summary className="text-sm font-semibold">{t('Recorded for This Date', 'Direkod untuk Tarikh Ini')} ({records.length})</summary>{records.map(r => <div key={r.id} className="py-3 text-sm border-b border-line"><strong>{r.supplier}</strong> · {r.reference || r.id.slice(0,8)} · {r.created_by_name}<ul>{r.lines.map(l => <li key={l.ingredient_id}>{l.name}: {l.entered_quantity} {l.display_unit}</li>)}</ul></div>)}</details> : null}
    {pending && active ? <Modal title={t('Confirm Delivery', 'Sahkan Penghantaran')} panelClassName={pending.record.lines.length > 8 ? 'arrival-review-dialog' : ''} onClose={back} footer={<div className="grid gap-3">{error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}{warning ? <p role="alert" className="text-sm text-danger">{warning} <button className="underline" disabled={busy} onClick={reloadDraft}>{t('Reload Draft', 'Muat Semula Draf')}</button></p> : null}<label className="flex items-start gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={checked} disabled={busy} onChange={e => setChecked(e.target.checked)}/>{t('I checked the actual items and quantities received.', 'Saya semak barang dan kuantiti sebenar yang diterima.')}</label><div className="flex justify-end gap-2"><button className={secondaryButtonClass} disabled={busy || pending.attempted || changedElsewhere} onClick={back}>{t('Back', 'Kembali')}</button><button className={buttonClass} disabled={busy || !checked || changedElsewhere || !!storageError} onClick={() => void confirm()}><Check size={16}/>{busy ? t('Saving...', 'Menyimpan...') : pending.attempted ? t('Check Confirmation', 'Semak Pengesahan') : t('Confirm Received', 'Sahkan Diterima')}</button></div></div>}>
      <p className="text-sm">{pending.record.date} · {pending.record.supplier} · {pending.record.reference}</p><p className="mt-2 text-xs text-muted">{pending.attempted || changedElsewhere ? t('Confirmation Not Verified · Stock May Already Be Added', 'Status Pengesahan Belum Diketahui · Stok Mungkin Telah Ditambah') : t('Not Confirmed · No Stock Added', 'Belum Disahkan · Tiada Stok Ditambah')}</p><ul className="mt-3 divide-y divide-line">{pending.record.lines.map(l => <li key={l.ingredient_id} className="flex justify-between gap-3 py-2 text-sm"><strong>{l.name}</strong><span className="shrink-0">{l.entered_quantity} {l.display_unit}</span></li>)}</ul>
    </Modal> : null}
    {discard && active ? <Modal title={t('Discard Delivery Draft?', 'Buang Draf Penghantaran?')} onClose={() => setDiscard(false)} footer={<div className="flex justify-end gap-2"><button className={secondaryButtonClass} onClick={() => setDiscard(false)}>{t('Keep Draft', 'Simpan Draf')}</button><button className={buttonClass} onClick={discardDraft}>{t('Discard Draft', 'Buang Draf')}</button></div>}><p className="text-sm">{t('Only the unfinished draft on this device will be removed. Confirmed deliveries and stock stay unchanged.', 'Hanya draf belum siap pada peranti ini dibuang. Penghantaran disahkan dan stok tidak berubah.')}</p></Modal> : null}
  </section>;
}
