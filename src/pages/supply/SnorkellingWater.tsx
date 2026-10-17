import { useEffect, useRef, useState } from 'react';
import { addDays, format, parseISO } from 'date-fns';
import { Check, ChevronLeft, ChevronRight, Droplets, Trash2 } from 'lucide-react';
import { Field, buttonClass, iconButtonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { useLanguage } from '../../lib/language';
import { useAccess } from '../../lib/access';
import { supabase } from '../../lib/supabase';
import { readErrorMessage, todayIso } from '../../lib/opsData';
import { countBalance, type CountItem } from '../../lib/stockCount';
import { definitiveInitialSaveFailure } from '../../lib/saveAttempt';
import { waterVariants } from '../../lib/kitchenCatalogue';
import { readPendingWater, readWaterDraft, waterBalanceAfter, waterBottles, waterDate, waterDraftDays, waterDraftFromPending, waterKeys, writeWaterStorage, type PendingWater, type WaterDay, type WaterDraft } from '../../lib/waterUsageDraft';

const storageKey = (base: string, waterKey: string) => base + (waterKey === 'snorkelling-mineral-water' ? '' : ':' + waterKey);
const dayForm = (date: string, waterKey: string, row?: WaterDay | null): WaterDraft => ({
  date, waterKey, bottles: row ? String(row.bottles) : '', closed: row?.closed ?? false, notes: row?.notes ?? '',
  expected: row?.updated_at ?? null, updatedAt: new Date().toISOString(),
});

export default function SnorkellingWater({ items, onSaved, loadError = '', active = true, resumeDate, resumeSize }: { items: CountItem[]; onSaved: () => Promise<void>; loadError?: string; active?: boolean; resumeDate?:string; resumeSize?:string }) {
  const { text: t } = useLanguage(), { profile, can } = useAccess();
  const base = 'water-usage:' + (import.meta.env.VITE_SUPABASE_URL ?? 'review') + ':' + profile?.id;
  const [initial] = useState(() => {
    let waterKey = resumeSize && waterKeys.includes(resumeSize) ? resumeSize : waterKeys[0];
    try {
      const preferred = localStorage.getItem(base + ':size');
      if (!resumeSize && preferred && waterKeys.includes(preferred)) waterKey = preferred;
      for (const k of resumeSize ? [waterKey] : [waterKey, ...waterKeys.filter(k => k !== waterKey)]) {
        const raw = localStorage.getItem(storageKey(base, k));
        if (raw) { waterKey = k; return { waterKey, date: readPendingWater(raw, k)?.record.business_date ?? todayIso() }; }
      }
    } catch { /* The entry loader surfaces storage errors without discarding the record. */ }
    return { waterKey, date: resumeDate ?? todayIso() };
  });
  const [waterKey, setWaterKey] = useState(initial.waterKey), [date, setDate] = useState(initial.date);
  const key = storageKey(base, waterKey), draftPrefix = key + ':draft:', draftKey = draftPrefix + date;
  const [form, setForm] = useState<WaterDraft>(() => dayForm(date, waterKey)), [saved, setSaved] = useState<WaterDay | null>(null);
  const [records, setRecords] = useState<WaterDay[]>([]), [pending, setPending] = useState<PendingWater | null>(null);
  const [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [checked, setChecked] = useState(false);
  const [error, setError] = useState(''), [storageError, setStorageError] = useState(''), [loadedKey, setLoadedKey] = useState('');
  const [retry, setRetry] = useState(0), [hasDraft, setHasDraft] = useState(false), [draftDays, setDraftDays] = useState<string[]>([]);
  const [conflict, setConflict] = useState(false), [changedElsewhere, setChangedElsewhere] = useState(false), [discard, setDiscard] = useState(false);
  const version = useRef(0), lock = useRef(false), pendingRaw = useRef<string | null>(null), draftRaw = useRef<string | null>(null);
  const ready = loadedKey === draftKey, readonly = !!saved && !editing;
  const water = items.find(i => i.active && i.kitchen_key === waterKey && i.base_unit === 'unit');
  const balance = water && !loadError ? countBalance(water) : null;
  const used = waterBottles(form.bottles, form.closed), after = waterBalanceAfter(balance, used, saved?.bottles ?? 0);
  const blocked = !ready || busy || !!pending || readonly || !!storageError || !!loadError || conflict || changedElsewhere || !water;
  const label = waterKey === 'snorkelling-mineral-water' ? t('Water: Size Unspecified', 'Air: Saiz Belum Dinyatakan') : t('Mineral Water', 'Air Mineral') + ' ' + waterVariants.find(v => v.key === waterKey)?.label;
  const prettyDate = (day: string) => format(parseISO(day), 'dd/MM/yyyy');

  useEffect(() => {
    const n = ++version.current; setLoadedKey(''); setError(''); setChecked(false); setDiscard(false);
    void (async () => {
      let p: PendingWater | null, draft: WaterDraft | null;
      try {
        const raw = localStorage.getItem(key); p = readPendingWater(raw, waterKey);
        pendingRaw.current = raw; setPending(p);
        if (p && p.record.business_date !== date) { setDate(p.record.business_date); return; }
        const dRaw = localStorage.getItem(draftKey); draft = readWaterDraft(dRaw, date, waterKey);
        draftRaw.current = dRaw; setHasDraft(!!draft); setDraftDays(waterDraftDays(localStorage, draftPrefix));
        setStorageError(''); setChangedElsewhere(false);
      } catch (e) { if (n === version.current) setStorageError(readErrorMessage(e, 'Could not read this water draft.')); return; }
      try {
        const r = await supabase.rpc('read_kitchen_water_usage', { p_from: date.slice(0, 7) + '-01', p_to: date });
        if (r.error) throw r.error;
        if (n !== version.current) return;
        const list = (r.data ?? []).filter((d: WaterDay) => (d.water_key ?? 'snorkelling-mineral-water') === waterKey);
        const row = list.find((d: WaterDay) => d.business_date === date) as WaterDay | undefined;
        const restored = draft ?? (p ? waterDraftFromPending(p, waterKey) : dayForm(date, waterKey, row));
        setRecords(list); setSaved(row ?? null); setForm(restored); setEditing(!!row && (!!draft || !!p));
        setConflict(!!draft && draft.expected !== (row?.updated_at ?? null)); setLoadedKey(draftKey);
      } catch (e) { if (n === version.current) setError(readErrorMessage(e, t('Water records could not load.', 'Rekod air tidak dapat dimuatkan.'))); }
    })();
    return () => { version.current++; };
  }, [date, key, retry]);
  useEffect(() => {
    const changed = (e: StorageEvent) => {
      if (e.storageArea !== localStorage) return;
      if (e.key === null || e.key === key || e.key === draftKey) setChangedElsewhere(true);
      try { setDraftDays(waterDraftDays(localStorage, draftPrefix)); } catch { setChangedElsewhere(true); }
    };
    window.addEventListener('storage', changed); return () => window.removeEventListener('storage', changed);
  }, [key, draftKey]);
  function assertCurrent() {
    if (localStorage.getItem(key) !== pendingRaw.current || localStorage.getItem(draftKey) !== draftRaw.current)
      throw Error(t('This water record changed in another tab. Reload the day before editing.', 'Rekod air berubah di tab lain. Muat semula hari sebelum mengedit.'));
  }
  function edit(patch: Partial<WaterDraft>, startCorrection = false) {
    if (!ready || busy || lock.current || pending || storageError || conflict || changedElsewhere || (readonly && !startCorrection)) return false;
    try {
      assertCurrent();
      const next = { ...form, ...patch, updatedAt: new Date().toISOString() };
      draftRaw.current = writeWaterStorage(localStorage, draftKey, next, draftRaw.current, waterKey);
      setForm(next); setHasDraft(true); setDraftDays(waterDraftDays(localStorage, draftPrefix)); setError(''); return true;
    } catch (e) { setError(readErrorMessage(e, 'Draft not saved on this device.')); return false; }
  }
  function chooseSize(k: string) {
    if (busy || pending) return;
    setWaterKey(k);
    try { localStorage.setItem(base + ':size', k); } catch { /* This preference does not alter a stock record. */ }
  }
  function chooseDate(day: string) { if (!busy && !pending && waterDate(day) && day <= todayIso()) setDate(day); }
  function reloadDay() { if (!busy) setRetry(n => n + 1); }
  function discardDraft() {
    try { assertCurrent(); draftRaw.current = writeWaterStorage(localStorage, draftKey, null, draftRaw.current, waterKey); setDiscard(false); reloadDay(); }
    catch (e) { setError(readErrorMessage(e, 'Draft could not be discarded.')); setDiscard(false); }
  }
  function review() {
    if (blocked) return;
    setError('');
    try {
      assertCurrent();
      if (!waterDate(date) || date > todayIso() || used === null || after === null || after < 0)
        throw Error(t('Enter whole bottles used, within available stock.', 'Isi bilangan botol penuh digunakan, mengikut stok tersedia.'));
      if (saved && (!can('kitchen.manage') || !form.notes.trim()))
        throw Error(t('A manager and correction reason are required.', 'Pengurus dan sebab pembetulan diperlukan.'));
      const p: PendingWater = { id: crypto.randomUUID(), record: { business_date: date, water_key: waterKey, bottles: used, closed: form.closed, notes: form.notes }, expected: form.expected, attempted: false };
      pendingRaw.current = writeWaterStorage(localStorage, key, p, pendingRaw.current, waterKey); setPending(p); setChecked(false);
    } catch (e) { setError(readErrorMessage(e, 'Check the water usage details.')); }
  }
  function back() {
    if (busy || !pending || pending.attempted || changedElsewhere || storageError) return;
    try {
      assertCurrent();
      const restored = readWaterDraft(draftRaw.current, date, waterKey) ?? waterDraftFromPending(pending, waterKey);
      draftRaw.current = writeWaterStorage(localStorage, draftKey, restored, draftRaw.current, waterKey);
      pendingRaw.current = writeWaterStorage(localStorage, key, null, pendingRaw.current, waterKey);
      setPending(null); setForm(restored); setHasDraft(true); setChecked(false); setError(''); setDraftDays(waterDraftDays(localStorage, draftPrefix)); setRetry(n => n + 1);
    } catch (e) { setError(readErrorMessage(e, 'Could not return to this draft.')); }
  }
  async function save() {
    if (!pending || !checked || lock.current || changedElsewhere || storageError || (!ready && !pending.attempted)) return;
    lock.current = true; setBusy(true); setError('');
    try {
      assertCurrent();
      const p = { ...pending, attempted: true };
      pendingRaw.current = writeWaterStorage(localStorage, key, p, pendingRaw.current, waterKey); setPending(p);
      const r = await supabase.rpc('save_kitchen_water_usage', { p_record: p.record, p_expected_updated_at: p.expected, p_operation_id: p.id });
      if (r.error) throw r.error;
      if (!r.data?.id || r.data.business_date !== p.record.business_date || (r.data.water_key ?? 'snorkelling-mineral-water') !== waterKey || r.data.bottles !== p.record.bottles)
        throw Error(t('Confirmation incomplete. Check this same submission.', 'Pengesahan belum lengkap. Semak rekod yang sama.'));
      draftRaw.current = writeWaterStorage(localStorage, draftKey, null, draftRaw.current, waterKey);
      pendingRaw.current = writeWaterStorage(localStorage, key, null, pendingRaw.current, waterKey);
      setPending(null); setSaved(r.data); setForm(dayForm(date, waterKey, r.data)); setHasDraft(false); setEditing(false); setConflict(false);
      setRecords(rows => [...rows.filter(row => row.id !== r.data.id), r.data]); setDraftDays(waterDraftDays(localStorage, draftPrefix));
      await onSaved().catch(e => setError(readErrorMessage(e, 'Usage confirmed. Reload stock for the latest balance.')));
    } catch (e) {
      setError(readErrorMessage(e, 'Confirmation is uncertain. Check this same submission.'));
      if (definitiveInitialSaveFailure(pending.attempted, e)) {
        try { const p = { ...pending, attempted: false }; pendingRaw.current = writeWaterStorage(localStorage, key, p, pendingRaw.current, waterKey); setPending(p); }
        catch { setChangedElsewhere(true); }
      }
    } finally { lock.current = false; setBusy(false); }
  }
  const warning = changedElsewhere ? t('This water record changed in another tab.', 'Rekod air berubah di tab lain.') : storageError;
  const pendingMatches = pending && (pending.record.water_key ?? 'snorkelling-mineral-water') === waterKey && pending.record.business_date === date;
  return <section className="supply-workspace water-entry">
    <div className="supply-segments three mb-3" role="group" aria-label={t('Bottle Size', 'Saiz Botol')}>{waterVariants.map(v => <button key={v.key} aria-pressed={waterKey === v.key} disabled={busy || !!pending} onClick={() => chooseSize(v.key)}>{v.key === 'snorkelling-mineral-water' ? t('Unspecified', 'Belum Dinyatakan') : v.label}</button>)}</div>
    <div className="supply-toolbar water-heading"><h2 className="flex items-center gap-2"><Droplets size={18}/>{label}</h2><div className="water-date-stepper">
      <button className={iconButtonClass} disabled={busy || !!pending} title={t('Previous Day', 'Hari Sebelumnya')} aria-label={t('Previous Day', 'Hari Sebelumnya')} onClick={() => chooseDate(format(addDays(parseISO(date), -1), 'yyyy-MM-dd'))}><ChevronLeft size={16}/></button>
      <input className={inputClass} aria-label={t('Water Usage Date', 'Tarikh Guna Air')} type="date" max={todayIso()} value={date} disabled={busy || !!pending} onChange={e => chooseDate(e.target.value)}/>
      <button className={iconButtonClass} disabled={busy || !!pending || date >= todayIso()} title={t('Next Day', 'Hari Seterusnya')} aria-label={t('Next Day', 'Hari Seterusnya')} onClick={() => chooseDate(format(addDays(parseISO(date), 1), 'yyyy-MM-dd'))}><ChevronRight size={16}/></button>
    </div></div>
    <div className="usage-draft-bar">
      {hasDraft && ready && !pending ? <div className="usage-draft-status"><span>{t('Draft on This Device · Not Submitted', 'Draf di Peranti Ini · Belum Dihantar')}</span><button className={iconButtonClass} aria-label={t('Discard Water Draft', 'Buang Draf Air')} title={t('Discard Water Draft', 'Buang Draf Air')} disabled={busy || changedElsewhere} onClick={() => setDiscard(true)}><Trash2 size={16}/></button></div> : null}
      {draftDays.some(day => day !== date) ? <nav className="usage-draft-days" aria-label={t('Unfinished Water Days', 'Hari Penggunaan Air Belum Disahkan')}><span>{t('Other Drafts', 'Draf Lain')}</span>{draftDays.filter(day => day !== date).map(day => <button key={day} disabled={busy || !!pending} onClick={() => chooseDate(day)}>{prettyDate(day)}</button>)}</nav> : null}
    </div>
    {warning && !pendingMatches ? <p role="alert" className="usage-draft-warning">{warning} <button className="underline" disabled={busy} onClick={reloadDay}>{t('Reload Day', 'Muat Semula Hari')}</button></p> : null}
    {error && !pendingMatches ? <p role="alert" className="my-3 text-sm text-danger">{error} <button className="underline" onClick={reloadDay}>{t('Reload Day', 'Muat Semula Hari')}</button></p> : null}
    {conflict && ready && !pending ? <p role="alert" className="usage-draft-warning">{t('This day changed after your draft started. Discard the old draft to view the confirmed record; stock will not change.', 'Hari ini berubah selepas draf dimulakan. Buang draf lama untuk melihat rekod disahkan; stok tidak berubah.')}</p> : null}
    {!ready ? !error && !storageError ? <p role="status" className="py-3 text-sm">{t('Loading Day...', 'Memuatkan Hari...')}</p> : null : <>
      {saved ? <div className="supply-saved"><span><Check size={16}/>{editing ? t('Editing Correction', 'Mengedit Pembetulan') : t('Confirmed', 'Disahkan')} · {saved.created_by_name}</span>{readonly && can('kitchen.manage') ? <button className={secondaryButtonClass} disabled={busy || !!pending || changedElsewhere} onClick={() => { if (edit({ notes: '' }, true)) setEditing(true); }}>{t('Correct Record', 'Betulkan Rekod')}</button> : null}</div> : null}
      {!water ? <p role="alert" className="my-3 text-sm text-danger">{t('This bottle size needs stock setup by a manager.', 'Saiz botol ini memerlukan tetapan stok oleh pengurus.')}</p> : null}
      <dl className="water-stock-summary"><div><dt>{t('Current Stock', 'Stok Semasa')}</dt><dd>{balance ?? '—'} <small>{t('bottles', 'botol')}</small></dd></div><div><dt>{readonly ? t('Recorded Usage', 'Penggunaan Direkod') : t('After Confirmation', 'Selepas Pengesahan')}</dt><dd className={after !== null && after < 0 ? 'text-danger' : ''}>{readonly ? saved?.bottles : conflict || changedElsewhere ? '—' : after ?? '—'} <small>{t('bottles', 'botol')}</small></dd></div></dl>
      <fieldset disabled={blocked} className="grid min-w-0 gap-3">
        <div className="water-quantity-row"><div className="supply-segments two" role="group" aria-label={t('Operating Status', 'Status Operasi')}><button type="button" aria-pressed={!form.closed} onClick={() => { if (form.closed) edit({ closed: false, bottles: '' }); }}>{t('Operating', 'Beroperasi')}</button><button type="button" aria-pressed={form.closed} onClick={() => { if (!form.closed) edit({ closed: true, bottles: '' }); }}>{t('Closed', 'Cuti')}</button></div>
        {!form.closed ? <Field label={t('Bottles Used', 'Botol Digunakan')}><input className={inputClass} inputMode="numeric" maxLength={60} enterKeyHint="done" placeholder="0" value={form.bottles} onChange={e => edit({ bottles: e.target.value })}/></Field> : <p className="text-sm font-semibold">{t('Closed · 0 Bottles Used', 'Cuti · 0 Botol Digunakan')}</p>}</div>
        {used !== null && after !== null && after < 0 && !readonly ? <p role="alert" className="text-sm text-danger">{t('Not enough recorded stock. Check deliveries and bottles used.', 'Stok direkod tidak mencukupi. Semak barang diterima dan botol digunakan.')}</p> : null}
        <Field label={saved && editing ? t('Correction Reason', 'Sebab Pembetulan') : t('Note (Optional)', 'Nota (Pilihan)')}><input className={inputClass} maxLength={2000} value={form.notes} onChange={e => edit({ notes: e.target.value })}/></Field>
        {!readonly ? <div className="kitchen-entry-footer water-entry-footer"><span>{profile?.full_name}</span><button className={buttonClass} disabled={used === null || after === null || after < 0 || (!!saved && !form.notes.trim())} onClick={review}>{t('Review Usage', 'Semak Penggunaan')}</button></div> : null}
      </fieldset>
      <div className="water-history-heading"><h3>{t('Recorded Days', 'Hari Direkod')}</h3><span>{prettyDate(date.slice(0, 7) + '-01')} – {prettyDate(date)}</span></div>
      <table className="water-history"><thead><tr><th>{t('Date', 'Tarikh')}</th><th>{t('Used', 'Diguna')}</th><th>{t('Recorded By', 'Direkod Oleh')}</th></tr></thead><tbody>{[...records].sort((a, b) => b.business_date.localeCompare(a.business_date)).map(r => <tr key={r.id} aria-current={r.business_date === date ? 'date' : undefined}><td><button disabled={busy || !!pending} onClick={() => chooseDate(r.business_date)}>{format(parseISO(r.business_date), 'dd/MM')}</button></td><td>{r.closed ? t('Closed', 'Cuti') : r.bottles}</td><td>{r.created_by_name}</td></tr>)}</tbody></table>
      {!records.length ? <p className="py-3 text-sm text-muted">{t('No confirmed records for these dates.', 'Tiada rekod disahkan bagi tarikh ini.')}</p> : null}
      <p className="mt-2 text-xs text-muted">{t('Quantities are individual bottles. Unrecorded days are not counted as zero.', 'Kuantiti ialah botol individu. Hari belum direkod tidak dikira sebagai sifar.')}</p>
    </>}
    {active && pendingMatches ? <Modal title={t('Confirm Water Usage', 'Sahkan Penggunaan Air')} onClose={back} footer={<div className="grid gap-3">
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      {warning ? <p role="alert" className="usage-draft-warning">{warning} <button className="underline" disabled={busy} onClick={reloadDay}>{t('Reload Day', 'Muat Semula Hari')}</button></p> : null}
      <label className="flex items-start gap-2 text-sm"><input className="h-5 w-5 shrink-0" type="checkbox" disabled={busy} checked={checked} onChange={e => setChecked(e.target.checked)}/>{t('The date, bottle size and bottles used are correct.', 'Tarikh, saiz botol dan botol digunakan adalah betul.')}</label>
      <div className="flex justify-end gap-2"><button className={secondaryButtonClass} disabled={busy || pending.attempted || changedElsewhere || !!storageError} onClick={back}>{t('Back', 'Kembali')}</button><button className={buttonClass} disabled={busy || !checked || changedElsewhere || !!storageError || (!ready && !pending.attempted)} onClick={() => void save()}>{busy ? t('Saving...', 'Menyimpan...') : pending.attempted ? t('Check Confirmation', 'Semak Pengesahan') : t('Confirm Usage', 'Sahkan Penggunaan')}</button></div>
    </div>}>
      <p className="text-sm">{prettyDate(pending.record.business_date)} · {label}</p><p className="mt-3 font-semibold">{pending.record.closed ? t('Closed / No Usage', 'Cuti / Tiada Penggunaan') : pending.record.bottles + ' ' + t('bottles used', 'botol digunakan')}</p>
      <p className="mt-3 text-xs text-muted">{pending.attempted || changedElsewhere ? t('Confirmation Not Verified · Stock May Already Be Deducted', 'Status Pengesahan Belum Diketahui · Stok Mungkin Telah Ditolak') : pending.expected ? t('Replaces this day’s previous usage. Only the difference changes stock.', 'Menggantikan penggunaan terdahulu hari ini. Hanya perbezaan mengubah stok.') : t('Not Confirmed · No Stock Deducted', 'Belum Disahkan · Tiada Stok Ditolak')}</p>
    </Modal> : null}
    {active && discard ? <Modal title={t('Discard Water Draft?', 'Buang Draf Air?')} onClose={() => setDiscard(false)} footer={<div className="flex justify-end gap-2"><button className={secondaryButtonClass} onClick={() => setDiscard(false)}>{t('Keep Draft', 'Simpan Draf')}</button><button className={buttonClass} onClick={discardDraft}>{t('Discard Draft', 'Buang Draf')}</button></div>}><p className="text-sm">{t('Only the unfinished entries for this date and bottle size on this device will be removed. Confirmed usage and stock stay unchanged.', 'Hanya catatan belum siap bagi tarikh dan saiz botol ini pada peranti ini dibuang. Penggunaan disahkan dan stok tidak berubah.')}</p></Modal> : null}
  </section>;
}
