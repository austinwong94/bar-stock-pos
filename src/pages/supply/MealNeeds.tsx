import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Check, MessageSquare, Plus, Search, Undo2 } from 'lucide-react';
import { PageHeader } from '../../components/Page';
import { iconButtonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { KitchenHeader } from '../../components/KitchenHeader';
import { StaffSummary, StaffTabs } from '../../components/StaffWorkspace';
import { ChoiceButtons } from '../../components/ChoiceButtons';
import { useBusinessDate } from '../../lib/useBusinessDate';
import { BookingDateNavigation } from '../../components/BookingDateNavigation';
import { useSharedRefresh } from '../../lib/useSharedRefresh';
import { useAccess } from '../../lib/access';
import { useLanguage } from '../../lib/language';
import { supabase } from '../../lib/supabase';
import { readErrorMessage } from '../../lib/opsData';
import { commonAllergens, mealChoices, type MealNeed } from '../../lib/mealNeeds';

type Details = Pick<MealNeed, 'meal_preference' | 'allergy_status' | 'allergens' | 'notes'>;
type Attempt = { row: MealNeed; details?: Details; token: string; phase: 'saving' | 'failed'; message?: string };
const detailsOf = (row: MealNeed): Details => ({ meal_preference: row.meal_preference, allergy_status: row.allergy_status, allergens: row.allergens, notes: row.notes });
const allergenMalay: Record<string, string> = { Shellfish: 'Kerang-kerangan', Fish: 'Ikan', Peanuts: 'Kacang Tanah', 'Tree Nuts': 'Kekacang Pokok', Milk: 'Susu', Eggs: 'Telur', Soy: 'Soya', 'Wheat / Gluten': 'Gandum / Gluten', Sesame: 'Bijan' };

export default function MealNeeds() {
  const { text: t } = useLanguage();
  const { can } = useAccess();
  const location = useLocation();
  const [date, setDate] = useBusinessDate('guests');
  const [search, setSearch] = useState('');
  const [view, setView] = useState('meals');
  const [rows, setRows] = useState<MealNeed[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState<Record<string, Attempt>>({});
  const [notices, setNotices] = useState<Record<string, string>>({});
  const pending = useRef<Record<string, Attempt>>({});
  const generation = useRef(0);
  const activeDate = useRef(date);
  activeDate.current = date;

  const read = useCallback(async () => {
    const response = await supabase.rpc('read_guest_meal_needs', { p_date: date });
    if (response.error) throw response.error;
    return (response.data ?? []) as MealNeed[];
  }, [date]);
  const refresh = useCallback(async () => {
    const ticket = ++generation.current;
    try {
      const next = await read();
      if (ticket === generation.current) {
        // Background refreshes must not replace choices whose saves are still unresolved.
        setRows(old => next.map(row => pending.current[row.tourist_id] ? old.find(r => r.tourist_id === row.tourist_id) ?? row : row));
        setError('');
      }
    } catch (e) { if (ticket === generation.current) setError(readErrorMessage(e, 'Could not load meal requirements.')); }
    finally { if (ticket === generation.current) setLoading(false); }
  }, [read]);
  useEffect(() => { setLoading(true); setRows([]); setNotices({}); void refresh(); return () => { generation.current++; }; }, [refresh]);
  useSharedRefresh(refresh, { tables: ['tourists', 'bookings', 'guest_meal_needs'], intervalMs: 15000 });

  function putAttempt(id: string, attempt?: Attempt) {
    const next = { ...pending.current };
    if (attempt) next[id] = attempt; else delete next[id];
    pending.current = next;
    setAttempts(next);
  }
  async function loadGuest(id: string) {
    const next = (await read()).find(row => row.tourist_id === id);
    if (!next) throw new Error('Guest is no longer on this service date. Refresh the list.');
    if (activeDate.current !== date) return;
    generation.current++;
    setRows(old => old.map(row => row.tourist_id === id ? next : row));
  }
  async function run(attempt: Attempt) {
    const id = attempt.row.tourist_id;
    if (pending.current[id]?.phase === 'saving') return;
    generation.current++;
    putAttempt(id, { ...attempt, phase: 'saving' });
    setNotices(old => ({ ...old, [id]: '' }));
    let saved = false;
    try {
      const response = attempt.details
        ? await supabase.rpc('save_guest_meal_needs', { p_tourist_id: id, p_expected_updated_at: attempt.row.updated_at, p_details: attempt.details, p_request_id: attempt.token })
        : await supabase.rpc('review_guest_meal_needs', { p_tourist_id: id, p_expected_updated_at: attempt.row.updated_at });
      if (response.error) throw response.error;
      saved = true;
      await loadGuest(id);
      putAttempt(id);
      setNotices(old => ({ ...old, [id]: t('Saved', 'Disimpan') }));
    } catch (e) {
      const message = readErrorMessage(e, 'Save could not be confirmed.');
      if (/changed|different details/i.test(message) && !saved) {
        try {
          await loadGuest(id);
          putAttempt(id);
          setNotices(old => ({ ...old, [id]: t('Changed on another device. Latest details loaded; choose again.', 'Diubah pada peranti lain. Butiran terkini dimuatkan; pilih semula.') }));
          return;
        } catch { /* Preserve the exact retry request until its outcome can be checked. */ }
      }
      putAttempt(id, { ...attempt, phase: 'failed', message: saved ? t('Saved, but refresh failed. Retry to check the record.', 'Disimpan, tetapi muat semula gagal. Cuba lagi untuk semak rekod.') : t('Save Not Confirmed. Retry or reload this guest.', 'Simpanan Belum Disahkan. Cuba lagi atau muat semula tetamu.') });
    }
  }
  function save(row: MealNeed, patch: Partial<Details>) {
    if (pending.current[row.tourist_id]) return;
    const details = { ...detailsOf(row), ...patch };
    if (JSON.stringify(details) === JSON.stringify(detailsOf(row))) return;
    void run({ row, details, token: crypto.randomUUID(), phase: 'saving' });
  }
  async function reload(id: string) {
    try { await loadGuest(id); putAttempt(id); setNotices(old => ({ ...old, [id]: t('Latest Details Loaded', 'Butiran Terkini Dimuatkan') })); }
    catch { setError(t('Could not refresh. Your unsaved choice is still shown.', 'Tidak dapat muat semula. Pilihan belum disimpan masih dipaparkan.')); }
  }
  // Search by identity so a changed meal never makes its guest disappear.
  const shown = rows.filter(row => [row.full_name, row.lead_name, row.booking_ref].join(' ').toLowerCase().includes(search.toLowerCase()));
  return <div className="staff-workspace">
    {location.pathname.startsWith('/kitchen') ? <KitchenHeader /> : <PageHeader title={t('Meals & Allergies', 'Makanan & Alahan')} />}
    <BookingDateNavigation date={date} onDate={setDate} disabled={Object.keys(attempts).length > 0} />
    <div className="mb-3">
      <label className="relative"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted" /><input type="search" aria-label={t('Find Guest', 'Cari Tetamu')} placeholder={t('Find Guest', 'Cari Tetamu')} className={inputClass + ' pl-9'} value={search} onChange={e => setSearch(e.target.value)} /></label>
    </div>
    <StaffSummary items={[{label:t('Vegetarian / Vegan','Vegetarian / Vegan'),value:rows.filter(r=>['vegetarian','vegan'].includes(r.meal_preference)).length},{label:t('Allergies','Alahan'),value:rows.filter(r=>r.allergy_status==='reported').length},{label:t('Not Asked','Belum Ditanya'),value:rows.filter(r=>r.allergy_status==='unknown'||r.meal_preference==='unknown').length}]} />
    <StaffTabs value={view} onChange={setView} items={[{ value: 'meals', label: t('Meal Choices', 'Pilihan Makanan') }, { value: 'allergies', label: t('Allergies', 'Alahan') }]} />
    {error ? <p role="alert" className="mb-3 text-sm text-danger">{error} <button className="underline" onClick={() => void refresh()}>{t('Retry', 'Cuba Lagi')}</button></p> : null}
    {loading ? <p role="status" className="py-4 text-sm">{t('Loading...', 'Memuatkan...')}</p> : <ul className="divide-y divide-line border-y border-line">
      {shown.map(row => <MealRow key={row.tourist_id} row={row} view={view} attempt={attempts[row.tourist_id]} notice={notices[row.tourist_id] ?? ''} kitchen={can('kitchen.production.manage')} onSave={save} onReview={() => void run({ row, token: crypto.randomUUID(), phase: 'saving' })} onRetry={() => void run(attempts[row.tourist_id])} onReload={() => void reload(row.tourist_id)} />)}
    </ul>}
    {!loading && !shown.length ? <p className="py-6 text-center text-sm text-muted">{t('No Guests Found', 'Tiada Tetamu Ditemui')}</p> : null}
  </div>;
}

function MealRow({ row, view, attempt, notice, kitchen, onSave, onReview, onRetry, onReload }: {
  row: MealNeed; view: string; attempt?: Attempt; notice: string; kitchen: boolean;
  onSave: (row: MealNeed, patch: Partial<Details>) => void; onReview: () => void; onRetry: () => void; onReload: () => void;
}) {
  const { text: t } = useLanguage();
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState(row.notes);
  const [custom, setCustom] = useState('');
  const [clearTo, setClearTo] = useState<'none_reported' | 'unknown' | null>(null);
  const noteSnapshot = useRef(row);
  const displayed = attempt?.details ? { ...row, ...attempt.details } : row;
  const disabled = !!attempt;
  useEffect(() => { if (!notesOpen) setNotes(row.notes); }, [row.notes, notesOpen]);
  useEffect(() => { setClearTo(null); }, [row.updated_at]);
  const chooseAllergen = (allergen: string) => {
    const allergens = row.allergens.includes(allergen) ? row.allergens.filter(a => a !== allergen) : [...row.allergens, allergen];
    onSave(row, { allergens, allergy_status: allergens.length ? 'reported' : 'unknown' });
  };
  function saveNotes() { if (notes.trim() !== noteSnapshot.current.notes) onSave(noteSnapshot.current, { notes: notes.trim() }); }
  const meal = mealChoices.find(c => c[0] === row.meal_preference)!;
  const allergyText = row.allergy_status === 'reported' ? row.allergens.map(a => t(a, allergenMalay[a] ?? a)).join(', ') || row.notes : row.allergy_status === 'unknown' ? t('Allergies: Not Asked', 'Alahan: Belum Ditanya') : t('No Allergies Reported', 'Tiada Alahan Dilaporkan');
  return <li data-meal-guest={row.tourist_id} className="min-w-0 py-3">
    <div className="grid min-w-0 gap-x-5 gap-y-2 lg:grid-cols-[minmax(12rem,1fr)_minmax(0,2fr)]">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0"><p className="break-words text-sm font-semibold">{row.full_name}</p><p className="break-words text-xs text-muted">{row.booking_ref} · {row.lead_name}</p></div>
        <div className="flex shrink-0 gap-1">
          {view === 'meals' && row.meal_preference !== 'unknown' ? <button type="button" disabled={disabled} title={t('Reset Meal Choice', 'Tetapkan Semula Pilihan Makanan')} aria-label={t('Reset Meal for ', 'Tetapkan Semula Makanan untuk ') + row.full_name} className={iconButtonClass} onClick={() => onSave(row, { meal_preference: 'unknown' })}><Undo2 className="h-4 w-4" /></button> : null}
          <button type="button" disabled={disabled} title={t('Meal Instructions', 'Arahan Makanan')} aria-label={t('Meal Instructions for ', 'Arahan Makanan untuk ') + row.full_name} aria-expanded={notesOpen} className={iconButtonClass} onClick={() => { noteSnapshot.current = row; setNotes(row.notes); setNotesOpen(!notesOpen); }}><MessageSquare className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="min-w-0">
        {view === 'meals' ? <ChoiceButtons label={t('Meal for ', 'Makanan untuk ') + row.full_name} value={displayed.meal_preference} disabled={disabled} className="!grid-cols-[1.05fr_1.4fr_0.8fr_0.75fr] [&_svg]:hidden [&_button]:px-1" options={[[ 'standard', t('Standard', 'Biasa') ], ['vegetarian', 'Vegetarian'], ['vegan', 'Vegan'], ['other', t('Other', 'Lain')]]} onChange={meal_preference => { onSave(row, { meal_preference }); if (meal_preference === 'other') { noteSnapshot.current = row; setNotesOpen(true); } }} /> : <>
          <div className="mb-1.5 flex gap-1.5" role="group" aria-label={t('Allergy Status for ', 'Status Alahan untuk ') + row.full_name}>
            {(['none_reported', 'unknown'] as const).map(status => <button key={status} type="button" disabled={disabled} aria-pressed={displayed.allergy_status === status} className={secondaryButtonClass + ' flex-1 !px-2 !text-sm ' + (displayed.allergy_status === status ? '!border-accent !bg-accent !text-white' : '')} onClick={() => { if (row.allergy_status === 'reported') setClearTo(status); else onSave(row, { allergy_status: status, allergens: [] }); }}>{status === 'none_reported' ? t('None Reported', 'Tiada Dilaporkan') : t('Not Asked', 'Belum Ditanya')}</button>)}
          </div>
          <div role="group" aria-label={t('Allergens for ', 'Alergen untuk ') + row.full_name} className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 xl:grid-cols-5">
            {[...commonAllergens, ...row.allergens.filter(a => !commonAllergens.includes(a))].map(allergen => <button key={allergen} type="button" disabled={disabled} aria-pressed={displayed.allergens.includes(allergen)} onClick={() => chooseAllergen(allergen)} className={`flex min-h-11 min-w-0 items-center justify-center gap-1 rounded-md border px-1.5 py-1.5 text-sm leading-tight ${displayed.allergens.includes(allergen) ? 'border-danger bg-danger/10 font-semibold text-danger' : 'border-line bg-surface'}`}><span className="min-w-0 break-words">{t(allergen, allergenMalay[allergen] ?? allergen)}</span>{displayed.allergens.includes(allergen) ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}</button>)}
          </div>
          <form className="mt-1.5 flex gap-1.5" onSubmit={e => { e.preventDefault(); if (custom.trim() && !disabled) { onSave(row, { allergy_status: 'reported', allergens: [...new Set([...row.allergens, custom.trim()])] }); setCustom(''); } }}><input aria-label={t('Other Allergy for ', 'Alahan Lain untuk ') + row.full_name} className={inputClass} placeholder={t('Other Allergy', 'Alahan Lain')} maxLength={80} value={custom} disabled={disabled} onChange={e => setCustom(e.target.value)} /><button type="submit" disabled={disabled || !custom.trim()} className={iconButtonClass} title={t('Add Allergy', 'Tambah Alahan')} aria-label={t('Add Allergy for ', 'Tambah Alahan untuk ') + row.full_name}><Plus className="h-4 w-4" /></button></form>
        </>}
      </div>
      <div className="min-w-0 lg:col-span-2">
        {clearTo ? <div role="alert" className="my-2 border-l-2 border-danger pl-3 text-sm"><p>{t('Replace the reported allergies? Confirm with the guest first.', 'Ganti alahan yang dilaporkan? Sahkan dengan tetamu dahulu.')}</p><div className="mt-2 flex flex-wrap gap-2"><button disabled={disabled} className={secondaryButtonClass} onClick={() => { onSave(row, { allergy_status: clearTo, allergens: [] }); setClearTo(null); }}>{clearTo === 'none_reported' ? t('Confirm None Reported', 'Sahkan Tiada Dilaporkan') : t('Reset to Not Asked', 'Tetapkan Belum Ditanya')}</button><button className={secondaryButtonClass} onClick={() => setClearTo(null)}>{t('Keep Allergies', 'Kekalkan Alahan')}</button></div></div> : null}
        {notesOpen ? <div className="mt-2"><label className="block text-sm"><span>{t('Meal Instructions', 'Arahan Makanan')}</span><textarea aria-label={t('Meal Instructions for ', 'Arahan Makanan untuk ') + row.full_name} className={inputClass + ' mt-1'} rows={2} maxLength={2000} value={notes} disabled={disabled} onFocus={() => { noteSnapshot.current = row; }} onChange={e => setNotes(e.target.value)} /></label><div className="mt-1.5 flex items-center justify-between gap-2"><span className="text-xs text-warning">{notes.trim() !== row.notes ? t('Unsaved Instructions', 'Arahan Belum Disimpan') : ''}</span><button type="button" className={secondaryButtonClass} disabled={disabled || notes.trim() === row.notes} onClick={saveNotes}><Check className="h-4 w-4" />{t('Save Instructions', 'Simpan Arahan')}</button></div></div> : row.notes ? <p className="mt-1 break-words text-sm">{row.notes}</p> : null}
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1.5 text-xs">
          <p className={'min-w-0 break-words ' + (row.allergy_status === 'reported' ? 'font-semibold text-danger' : 'text-muted')}>{view === 'allergies' ? t(meal[1], meal[2]) + ' · ' : ''}{allergyText}</p>
          <span role="status" className="text-muted">{attempt?.phase === 'saving' ? t('Saving...', 'Menyimpan...') : !attempt ? notice : ''}</span>
        </div>
        {attempt?.phase === 'failed' ? <div role="alert" className="mt-2 text-sm text-danger"><p>{attempt.message}</p><div className="mt-1 flex gap-2"><button className={secondaryButtonClass} onClick={onRetry}>{t('Retry Save', 'Cuba Simpan Lagi')}</button><button className={secondaryButtonClass} onClick={onReload}>{t('Reload Guest', 'Muat Semula Tetamu')}</button></div></div> : null}
        {kitchen && row.updated_at && row.meal_preference !== 'unknown' && row.allergy_status !== 'unknown' ? <button type="button" disabled={disabled || !!row.reviewed_at} aria-label={t('Kitchen Reviewed ', 'Dapur Telah Semak ') + row.full_name} onClick={onReview} className="mt-1 flex min-h-11 items-center gap-1.5 text-sm font-semibold text-accent disabled:text-muted"><Check className="h-4 w-4" />{row.reviewed_at ? t('Kitchen Reviewed', 'Dapur Telah Semak') : t('Mark Kitchen Reviewed', 'Tanda Dapur Telah Semak')}{row.reviewed_at ? ' · ' + row.reviewed_by : ''}</button> : null}
      </div>
    </div>
  </li>;
}
