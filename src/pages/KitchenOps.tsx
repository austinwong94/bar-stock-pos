import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { addDays, addMonths, addWeeks, format, parseISO, startOfWeek } from 'date-fns';
import { AlertTriangle, ChevronLeft, ChevronRight, Copy, Eye, Plus, Trash2, UtensilsCrossed, Users } from 'lucide-react';
import { Field, buttonClass, inputClass, secondaryButtonClass } from '../components/Form';
import { Modal } from '../components/Modal';
import { Stat } from '../components/Page';
import { KitchenHeader } from '../components/KitchenHeader';
import { ChoiceButtons } from '../components/ChoiceButtons';
import { StaffSummary, StaffTabs } from '../components/StaffWorkspace';
import { useToast } from '../components/Toast';
import { malaysiaBusinessDateInputValue } from '../lib/format';
import { useLanguage } from '../lib/language';
import {
  loadLocalIngredientItems,
  loadLocalKitchenPax,
  loadLocalKitchenProductionReports,
  saveLocalKitchenPax,
  submitLocalKitchenProduction,
} from '../lib/localStore';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type { IngredientWithBalance, KitchenDailyPax, KitchenProductionReport, SettingsMap } from '../lib/types';
import { useSharedRefresh } from '../lib/useSharedRefresh';
import { readAllRows } from '../lib/readAllRows';

type Period = 'day' | 'week' | 'month' | 'custom';
type ServingBasis = 'pax' | 'table' | 'batch';
type UsageLine = { ingredient_id: string; quantity_per_platter: string; notes: string };

function splitStaffNames(value: SettingsMap[keyof SettingsMap]) {
  return String(value || 'Chloe, Happy, Elle, NekoMiao')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function ingredientBalance(item: IngredientWithBalance) {
  const balance = item.ingredient_balances;
  if (Array.isArray(balance)) return Number(balance[0]?.quantity_on_hand ?? 0);
  return Number(balance?.quantity_on_hand ?? 0);
}

function qty(value: number, unit: string) {
  const digits = unit === 'unit' ? 0 : 2;
  return `${Number(value || 0).toFixed(digits)} ${unit}`;
}

function weekStartFromInput(value: string) {
  const [yearText, weekText] = value.split('-W');
  const year = Number(yearText);
  const week = Number(weekText);
  const weekOne = startOfWeek(new Date(year, 0, 4), { weekStartsOn: 1 });
  return addWeeks(weekOne, Math.max(week - 1, 0));
}

function inRange(date: string, period: Period, selectedDate: string, selectedWeek: string, selectedMonth: string, customStart: string, customEnd: string) {
  if (period === 'day') return date === selectedDate;
  if (period === 'month') return date.startsWith(selectedMonth);
  if (period === 'custom') return date >= customStart && date <= customEnd;
  const weekStart = weekStartFromInput(selectedWeek);
  const weekEnd = addDays(weekStart, 6);
  const parsed = parseISO(date);
  return parsed >= weekStart && parsed <= weekEnd;
}

function compactIngredients(report: KitchenProductionReport) {
  const items = report.kitchen_production_items ?? [];
  if (items.length === 0) return '-';
  return items
    .slice(0, 3)
    .map((item) => `${item.ingredient_items?.name ?? 'Ingredient'} ${qty(item.total_quantity, item.unit)}`)
    .join(', ') + (items.length > 3 ? ` +${items.length - 3}` : '');
}

export default function KitchenOps({ settings }: { settings: SettingsMap }) {
  const { text } = useLanguage();
  const toast = useToast();
  const staffNames = useMemo(() => splitStaffNames(settings.staff_names), [settings.staff_names]);
  const today = malaysiaBusinessDateInputValue(new Date(), settings.business_day_close_time);
  const [workspace,setWorkspace]=useState('prepare');
  const [productionReview,setProductionReview]=useState(false);
  const [productionError,setProductionError]=useState('');
  const [reviewChecked,setReviewChecked]=useState(false);
  const [ingredients, setIngredients] = useState<IngredientWithBalance[]>([]);
  const [paxRows, setPaxRows] = useState<KitchenDailyPax[]>([]);
  const [reports, setReports] = useState<KitchenProductionReport[]>([]);
  const [period, setPeriod] = useState<Period>('day');
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedWeek, setSelectedWeek] = useState(() => format(parseISO(today), "RRRR-'W'II"));
  const [selectedMonth, setSelectedMonth] = useState(today.slice(0, 7));
  const [customStart, setCustomStart] = useState(today);
  const [customEnd, setCustomEnd] = useState(today);
  const [paxDate, setPaxDate] = useState(today);
  const [paxCount, setPaxCount] = useState('');
  const [paxWorker, setPaxWorker] = useState(staffNames[0] ?? 'Chloe');
  const [paxNotes, setPaxNotes] = useState('');
  const [paxVersion, setPaxVersion] = useState<string | null>(null);
  const [paxDirty, setPaxDirty] = useState(false);
  const [platterDate, setPlatterDate] = useState(today);
  const [platterName, setPlatterName] = useState('Seafood Platter');
  const [platterCount, setPlatterCount] = useState('');
  const [servingBasis, setServingBasis] = useState<ServingBasis>('pax');
  const [submittedBy, setSubmittedBy] = useState(staffNames[0] ?? 'Chloe');
  const [productionNotes, setProductionNotes] = useState('');
  const [usageLines, setUsageLines] = useState<UsageLine[]>([{ ingredient_id: '', quantity_per_platter: '', notes: '' }]);
  const [savingPax, setSavingPax] = useState(false);
  const [savingProduction, setSavingProduction] = useState(false);
  const [productionRequestId, setProductionRequestId] = useState(() => crypto.randomUUID());
  const [previewReport, setPreviewReport] = useState<KitchenProductionReport | null>(null);
  const [showPaxReminder, setShowPaxReminder] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [recentReports, setRecentReports] = useState<KitchenProductionReport[]>([]);
  const [copyOpen, setCopyOpen] = useState(false);
  const generation = useRef(0);

  const activeIngredients = useMemo(() => ingredients.filter((item) => item.active && ['Food','Seafood','Condiment'].includes(item.category)), [ingredients]);
  const todayPax = paxRows.find((row) => row.business_date === today) ?? null;
  const selectedPax = paxRows.find((row) => row.business_date === paxDate) ?? null;
  const filteredReports = reports.filter((report) => inRange(report.business_date, period, selectedDate, selectedWeek, selectedMonth, customStart, customEnd));
  const ingredientUsageTotal = filteredReports.reduce((sum, report) => sum + (report.kitchen_production_items ?? []).length, 0);

  useEffect(() => {
    setPaxWorker((current) => current || staffNames[0] || 'Chloe');
    setSubmittedBy((current) => current || staffNames[0] || 'Chloe');
  }, [staffNames]);

  async function loadKitchenData() {
    const ticket = ++generation.current;
    try {
    if (!isSupabaseConfigured) {
      const localIngredients = loadLocalIngredientItems(true);
      setIngredients(localIngredients);
      setPaxRows(loadLocalKitchenPax());
      setReports(loadLocalKitchenProductionReports());
      setRecentReports(loadLocalKitchenProductionReports().slice(0,20));
      setLoadError('');
      return;
    }
    const from = period==='day'?selectedDate:period==='week'?format(weekStartFromInput(selectedWeek),'yyyy-MM-dd'):period==='month'?`${selectedMonth}-01`:customStart;
    const to = period==='day'?from:period==='week'?format(addDays(weekStartFromInput(selectedWeek),6),'yyyy-MM-dd'):period==='month'?format(addDays(addMonths(parseISO(from),1),-1),'yyyy-MM-dd'):customEnd;
    if (!from || !to || from>to) throw new Error('Choose a valid date range.');
    const [ingredientResult, paxResult, reportRows, recentResult] = await Promise.all([
      supabase.from('ingredient_items').select('*, ingredient_balances(quantity_on_hand)').order('category').order('name'),
      supabase.from('kitchen_daily_pax').select('*').in('business_date',[today,paxDate]),
      readAllRows<KitchenProductionReport>((start,end)=>supabase.from('kitchen_production_reports').select('*, kitchen_production_items(*, ingredient_items(id,name,category,base_unit))').gte('business_date',from).lte('business_date',to).order('created_at',{ascending:false}).order('id').range(start,end)),
      supabase.from('kitchen_production_reports').select('*, kitchen_production_items(*, ingredient_items(id,name,category,base_unit))').order('created_at',{ascending:false}).order('id').limit(20),
    ]);
    for (const result of [ingredientResult,paxResult,recentResult]) if (result.error) throw result.error;
    if (ticket !== generation.current) return;
    const nextIngredients = (ingredientResult.data ?? []) as IngredientWithBalance[];
    setIngredients(nextIngredients);
    setPaxRows((paxResult.data ?? []) as KitchenDailyPax[]);
    setReports(reportRows);
    setRecentReports(recentResult.data ?? []);
    setLoadError('');
    } catch { if (ticket===generation.current) setLoadError(text('Kitchen records could not refresh. Previous records are still shown. Retry before confirming stock use.', 'Rekod dapur tidak dapat dimuat semula. Rekod lama masih dipaparkan. Cuba lagi sebelum sahkan penggunaan stok.')); }
  }

  useEffect(() => {
    void loadKitchenData();
    return () => { generation.current++; };
  }, [period,selectedDate,selectedWeek,selectedMonth,customStart,customEnd,paxDate,today]);

  useEffect(() => {
    if (paxDirty) return;
    if (selectedPax) {
      setPaxCount(String(selectedPax.pax_count));
      setPaxWorker(selectedPax.entered_by ?? staffNames[0] ?? 'Chloe');
      setPaxNotes(selectedPax.notes ?? '');
      setPaxVersion(selectedPax.updated_at);
    } else {
      setPaxCount('');
      setPaxNotes('');
      setPaxVersion(null);
    }
  }, [paxDate, selectedPax?.updated_at, paxDirty]);

  useSharedRefresh(loadKitchenData, {
    tables: ['ingredient_items', 'ingredient_balances', 'ingredient_movements', 'kitchen_daily_pax', 'kitchen_production_reports', 'kitchen_production_items'],
    intervalMs: 15000,
  });

  function updateUsageLine(index: number, patch: Partial<UsageLine>) {
    setUsageLines((lines) => lines.map((line, itemIndex) => (itemIndex === index ? { ...line, ...patch } : line)));
  }

  function addUsageLine() {
    setUsageLines((lines) => [...lines, { ingredient_id: '', quantity_per_platter: '', notes: '' }]);
  }

  function copyPreparation(report: KitchenProductionReport) {
    const lines = report.kitchen_production_items ?? [];
    if (!lines.length || lines.some(line=>!activeIngredients.some(item=>item.id===line.ingredient_id && item.base_unit===line.unit))) {
      toast.error(text('An ingredient is unavailable or its unit changed. Review this record before reusing it.', 'Bahan tidak tersedia atau unit berubah. Semak rekod sebelum guna semula.')); return;
    }
    setPlatterName(report.platter_name); setServingBasis(report.serving_basis); setPlatterCount('');
    setUsageLines(lines.map(line=>({ingredient_id:line.ingredient_id,quantity_per_platter:String(line.quantity_per_platter),notes:line.notes??''})));
    setProductionNotes(''); setProductionRequestId(crypto.randomUUID()); setReviewChecked(false); setCopyOpen(false);
    toast.success(text('Ingredients copied. Enter the number being prepared today.', 'Bahan disalin. Masukkan jumlah yang disediakan hari ini.'));
  }

  function removeUsageLine(index: number) {
    setUsageLines((lines) => (lines.length === 1 ? lines : lines.filter((_, itemIndex) => itemIndex !== index)));
  }

  function shiftPeriod(direction: -1 | 1) {
    if (period === 'day') {
      setSelectedDate(format(addDays(parseISO(selectedDate), direction), 'yyyy-MM-dd'));
      return;
    }
    if (period === 'week') {
      setSelectedWeek(format(addWeeks(weekStartFromInput(selectedWeek), direction), "RRRR-'W'II"));
      return;
    }
    if (period === 'month') {
      setSelectedMonth(format(addMonths(new Date(`${selectedMonth}-01T00:00:00`), direction), 'yyyy-MM'));
    }
  }

  async function savePax(event: FormEvent) {
    event.preventDefault();
    const count = Number(paxCount);
    if (!paxDate) return toast.error(text('Choose the date.', 'Pilih tarikh.'));
    if (!paxCount.trim() || !Number.isInteger(count) || count < 0) return toast.error(text('Enter a whole visitor count, 0 or more.', 'Masukkan jumlah pelawat bulat, 0 atau lebih.'));
    setSavingPax(true);
    try {
      if (!isSupabaseConfigured) {
        saveLocalKitchenPax({ businessDate: paxDate, paxCount: count, enteredBy: paxWorker, notes: paxNotes.trim() || null });
      } else {
        const { data, error } = await supabase.rpc('save_kitchen_pax_checked', {
          p_expected_updated_at: paxVersion,
          p_business_date: paxDate,
          p_pax_count: count,
          p_entered_by: paxWorker,
          p_notes: paxNotes.trim() || null,
        });
        if (error) throw error;
        setPaxVersion(data.updated_at);
      }
      sessionStorage.setItem(`kitchen_pax_reminder_${paxDate}`, 'saved');
      setShowPaxReminder(false);
      await loadKitchenData();
      setPaxDirty(false);
      toast.success(text('Pax count saved.', 'Jumlah pax disimpan.'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text('Unable to save pax.', 'Tidak dapat simpan pax.'));
    } finally {
      setSavingPax(false);
    }
  }

  async function submitProduction(event: {preventDefault():void}, confirmed=false) {
    event.preventDefault();
    if(savingProduction)return;
    if(loadError)return toast.error(text('Refresh the kitchen records before confirming preparation.','Muat semula rekod dapur sebelum mengesahkan penyediaan.'));
    const count = Number(platterCount);
    const invalidLine = usageLines.findIndex((line) => !line.ingredient_id || !line.quantity_per_platter.trim() || !Number.isFinite(Number(line.quantity_per_platter)) || Number(line.quantity_per_platter) <= 0);
    if (invalidLine !== -1) return toast.error(text(`Complete ingredient row ${invalidLine + 1}, or remove it.`, `Lengkapkan baris bahan ${invalidLine + 1}, atau buangkannya.`));
    const items = usageLines
      .map((line) => ({ ingredient_id: line.ingredient_id, quantity_per_platter: Number(line.quantity_per_platter), notes: line.notes.trim() || null }));

    if (!platterDate) return toast.error(text('Choose the production date.', 'Pilih tarikh penyediaan.'));
    if (!platterName.trim()) return toast.error(text('Enter the platter or set name.', 'Masukkan nama platter atau set.'));
    if (!Number.isInteger(count) || count <= 0) return toast.error(text('Enter a whole number prepared, greater than 0.', 'Masukkan jumlah bulat disediakan, lebih daripada 0.'));
    if (items.length === 0) return toast.error(text('Add at least one ingredient.', 'Tambah sekurang-kurangnya satu bahan.'));

    if(!confirmed){setReviewChecked(false);setProductionError('');setProductionReview(true);return;}
    if(!reviewChecked)return;
    setSavingProduction(true);
    try {
      if (!isSupabaseConfigured) {
        submitLocalKitchenProduction({
          businessDate: platterDate,
          platterName,
          platterCount: count,
          servingBasis,
          submittedBy,
          notes: productionNotes.trim() || null,
          items,
        });
      } else {
        const { error } = await supabase.rpc('submit_kitchen_production_checked', {
          p_request_id: productionRequestId,
          p_business_date: platterDate,
          p_platter_name: platterName,
          p_platter_count: count,
          p_submitted_by: submittedBy,
          p_items: items,
          p_serving_basis: servingBasis,
          p_notes: productionNotes.trim() || null,
        });
        if (error) throw error;
      }
      setUsageLines([{ ingredient_id: '', quantity_per_platter: '', notes: '' }]);
      setPlatterCount('');
      setProductionReview(false);
      setWorkspace('records');setPeriod('day');setSelectedDate(platterDate);
      setProductionNotes('');
      setProductionRequestId(crypto.randomUUID());
      await loadKitchenData();
      toast.success(text('Kitchen production saved and ingredient stock deducted.', 'Penyediaan dapur disimpan dan stok bahan ditolak.'));
    } catch (error) {
      const message=error instanceof Error?error.message:text('Unable to save kitchen production.','Tidak dapat simpan penyediaan dapur.');setProductionError(message);toast.error(message);
    } finally {
      setSavingProduction(false);
    }
  }

  function dismissPaxReminder() {
    sessionStorage.setItem(`kitchen_pax_reminder_${today}`, 'dismissed');
    setShowPaxReminder(false);
  }

  return (
    <div className="staff-workspace">
      <KitchenHeader />

      <StaffTabs value={workspace} onChange={setWorkspace} items={[{value:'prepare',label:text('Prepare Meals','Sediakan Hidangan')},{value:'pax',label:text('Pax','Pax')},{value:'records',label:text('Records','Rekod')}]} />
      {loadError ? <p role="alert" className="mb-3 text-sm text-danger">{loadError} <button type="button" className="underline" onClick={()=>void loadKitchenData()}>{text('Retry','Cuba Lagi')}</button></p> : null}
      <StaffSummary items={[{label:text('Today Pax','Pax Hari Ini'),value:todayPax?todayPax.pax_count:text('Not Entered','Belum Diisi'),tone:todayPax?'accent':'warning'},{label:text('Preparation Records','Rekod Penyediaan'),value:filteredReports.length}]} />
      <section className="mb-4">
        <form onSubmit={savePax} className={(workspace!=='pax'?'hidden ':'')+'min-w-0 border-b border-line py-3'}>
          <div className="flex items-center gap-2">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-teal-50 text-accent"><Users className="h-5 w-5" /></span>
            <h2 className="text-base font-bold">{text('Island Pax', 'Pax Pulau')}</h2>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Field label={text('Date', 'Tarikh')}>
              <input className={inputClass} type="date" value={paxDate} onChange={(event) => { setPaxDirty(false); setPaxDate(event.target.value); }} />
            </Field>
            <Field label={text('Pax Arrived', 'Pax Tiba')}>
              <input className={inputClass} type="number" min={0} step={1} value={paxCount} onChange={(event) => { setPaxDirty(true); setPaxCount(event.target.value); }} placeholder="0" />
            </Field>
          </div>
          <div className="mt-3">
            <p className="mb-2 text-sm font-black">{text('Entered By', 'Diisi Oleh')}</p>
            <div className="grid grid-cols-2 gap-2">
              {staffNames.map((name) => (
                <button key={name} type="button" onClick={() => { setPaxDirty(true); setPaxWorker(name); }} className={`min-h-11 min-w-0 rounded-lg border px-1 text-xs font-semibold ${paxWorker === name ? 'border-accent bg-accent text-white shadow-glow' : 'border-line bg-white/90'}`}>
                  {name}
                </button>
              ))}
            </div>
          </div>
          <Field label={text('Notes', 'Nota')}>
            <input className={inputClass} value={paxNotes} onChange={(event) => { setPaxDirty(true); setPaxNotes(event.target.value); }} placeholder={text('Optional', 'Pilihan')} />
          </Field>
          <button className={`${buttonClass} mt-3 w-full`} disabled={savingPax}>{savingPax ? text('Saving...', 'Menyimpan...') : text('Save pax', 'Simpan pax')}</button>
        </form>

        <form onSubmit={submitProduction} className={(workspace!=='prepare'?'hidden ':'')+'min-w-0 border-b border-line py-3'}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="hidden h-10 w-10 place-items-center rounded-lg bg-pink-50 text-coral sm:grid"><UtensilsCrossed className="h-5 w-5" /></span>
              <h2 className="text-sm font-bold sm:text-base">{text('Prepare Meals', 'Sediakan Hidangan')}</h2>
            </div>
            <button type="button" className={secondaryButtonClass} onClick={()=>setCopyOpen(true)} disabled={!recentReports.length || savingProduction}><Copy size={16}/>{text('Use Previous','Guna Sebelumnya')}</button>
            {activeIngredients.length === 0 ? <span className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-black text-warning">{text('Add ingredients in Admin first', 'Tambah bahan di Admin dahulu')}</span> : null}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Field label={text('Date', 'Tarikh')}>
              <input className={inputClass} type="date" value={platterDate} onChange={(event) => setPlatterDate(event.target.value)} />
            </Field>
            <Field label={text('Meal / Platter', 'Hidangan / Platter')}>
              <input className={inputClass} value={platterName} onChange={(event) => setPlatterName(event.target.value)} />
            </Field>
            <div className="col-span-2 grid min-w-0 grid-cols-[minmax(0,0.85fr)_minmax(0,2fr)] items-end gap-2">
            <Field label={text('Number Prepared', 'Jumlah Disediakan')}>
              <input className={inputClass} type="number" min={1} step={1} value={platterCount} onChange={(event) => setPlatterCount(event.target.value)} />
            </Field>
            <fieldset className="min-w-0"><legend className="mb-1.5 text-sm font-semibold text-muted">{text('Serving Basis', 'Asas Hidangan')}</legend>
              <ChoiceButtons label={text('Serving Basis', 'Asas Hidangan')} value={servingBasis} onChange={setServingBasis} className="!grid-cols-3 [&_button]:px-1 [&_button]:py-1" options={[[ 'pax', text('Per Person', 'Setiap Orang') ], ['table', text('Per Table', 'Setiap Meja')], ['batch', text('Whole Batch', 'Seluruh Kelompok')]]} />
            </fieldset>
            </div>
          </div>

          <div className="mt-3">
            <p className="mb-2 text-sm font-black">{text('Submitted By', 'Dihantar Oleh')}</p>
            <div className="grid grid-cols-4 gap-1.5">
              {staffNames.map((name) => (
                <button key={name} type="button" onClick={() => setSubmittedBy(name)} className={`min-h-11 min-w-0 rounded-lg border px-1 text-xs font-semibold ${submittedBy === name ? 'border-accent bg-accent text-white shadow-glow' : 'border-line bg-white/90'}`}>
                  {name}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 divide-y divide-line border-y border-line">
            {usageLines.map((line,index)=>{
              const ingredient=activeIngredients.find(item=>item.id===line.ingredient_id);
              const total=Number(line.quantity_per_platter||0)*Number(platterCount||0);
              const perLabel=servingBasis==='pax'?text('Per Person','Setiap Orang'):servingBasis==='table'?text('Per Table','Setiap Meja'):text('Per Batch','Setiap Kelompok');
              return <div key={index} className="grid grid-cols-[minmax(0,1fr)_6.5rem_2.75rem] items-end gap-2 py-3">
                <Field label={text('Ingredient','Bahan')}><select className={inputClass} aria-label={'Ingredient '+(index+1)} value={line.ingredient_id} onChange={event=>updateUsageLine(index,{ingredient_id:event.target.value})}><option value="">{text('Choose Ingredient','Pilih Bahan')}</option>{activeIngredients.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
                <Field label={perLabel+' ('+(ingredient?.base_unit==='unit'?'pcs':ingredient?.base_unit??'-')+')'}><input aria-label={'Ingredient Quantity '+(index+1)} className={inputClass+' !px-2 text-right'} inputMode="decimal" value={line.quantity_per_platter} onChange={event=>updateUsageLine(index,{quantity_per_platter:event.target.value})} placeholder="0" /></Field>
                <button type="button" title={text('Remove Ingredient','Buang Bahan')} aria-label={'Remove Ingredient '+(index+1)} className={secondaryButtonClass+' !w-11 !px-0'} disabled={usageLines.length===1} onClick={()=>removeUsageLine(index)}><Trash2 className="h-4 w-4" /></button>
                <div className="col-span-3 flex flex-wrap justify-between gap-2 text-xs"><span>{text('To Deduct','Akan Ditolak')}: <strong className="text-warning">{ingredient?qty(total,ingredient.base_unit):'-'}</strong></span><span className="text-muted">{text('In Stock','Dalam Stok')}: {ingredient?qty(ingredientBalance(ingredient),ingredient.base_unit):'-'}</span></div>
                <details className="col-span-3"><summary className="flex min-h-11 cursor-pointer items-center text-xs font-semibold text-muted">{text('Item Note','Nota Item')}{line.notes?' · '+line.notes:''}</summary><input aria-label={'Ingredient Note '+(index+1)} className={inputClass} value={line.notes} onChange={event=>updateUsageLine(index,{notes:event.target.value})} /></details>
              </div>;
            })}
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-end">
            <button type="button" className={secondaryButtonClass} onClick={addUsageLine}><Plus className="h-4 w-4" />{text('Add Ingredient', 'Tambah Bahan')}</button>
            <Field label={text('Preparation Notes', 'Nota Penyediaan')}>
              <input className={inputClass} value={productionNotes} onChange={(event) => setProductionNotes(event.target.value)} placeholder={text('Optional', 'Pilihan')} />
            </Field>
          </div>
          <button className={`${buttonClass} mt-3 w-full`} disabled={savingProduction || !!loadError || activeIngredients.length === 0}>{savingProduction ? text('Saving...', 'Menyimpan...') : text('Review Preparation', 'Semak Penyediaan')}</button>
        </form>
      </section>

      <section className={(workspace!=='records'?'hidden ':'')+'border-y border-line py-3'}>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <h2 className="text-base font-bold">{text('Preparation Records', 'Rekod Penyediaan')}</h2>
          <div className="grid min-w-0 gap-2 lg:grid-cols-[430px_minmax(0,1fr)] lg:items-center">
            <div className="grid grid-cols-4 gap-1 rounded-2xl bg-white/80 p-1 text-xs font-black sm:text-sm">
              {(['day', 'week', 'month', 'custom'] as const).map((item) => (
                <button key={item} type="button" className={`min-h-9 rounded-xl px-1.5 ${period === item ? 'bg-accent text-white' : ''}`} onClick={() => setPeriod(item)}>
                  {item === 'day' ? text('Daily', 'Harian') : item === 'week' ? text('Weekly', 'Mingguan') : item === 'month' ? text('Monthly', 'Bulanan') : text('Selected', 'Pilihan')}
                </button>
              ))}
            </div>
            <div className={`grid min-w-0 gap-2 ${period === 'custom' ? 'sm:grid-cols-2' : 'grid-cols-[auto_minmax(0,1fr)_auto]'}`}>
              {period !== 'custom' ? (
                <>
                  <button type="button" className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-white shadow-soft" onClick={() => shiftPeriod(-1)} aria-label="Previous period"><ChevronLeft className="h-4 w-4" /></button>
                  {period === 'day' ? <input className={inputClass} type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /> : null}
                  {period === 'week' ? <input className={inputClass} type="week" value={selectedWeek} onChange={(event) => setSelectedWeek(event.target.value)} /> : null}
                  {period === 'month' ? <input className={inputClass} type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} /> : null}
                  <button type="button" className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-white shadow-soft" onClick={() => shiftPeriod(1)} aria-label="Next period"><ChevronRight className="h-4 w-4" /></button>
                </>
              ) : (
                <>
                  <input className={inputClass} type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} />
                  <input className={inputClass} type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} />
                </>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-white/75 sm:hidden">
          <table className="dense-table w-full table-fixed text-left text-[11px]">
            <thead>
              <tr>
                <th className="w-[46%] p-2">{text('Date / set', 'Tarikh / set')}</th>
                <th className="w-[18%] p-2">{text('Qty', 'Qty')}</th>
                <th className="w-[20%] p-2">{text('By', 'Oleh')}</th>
                <th className="w-[16%] p-2">{text('View', 'Lihat')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredReports.map((report) => (
                <tr key={`mobile-history-${report.id}`} className="border-t border-line align-top">
                  <td className="p-2">
                    <p className="truncate font-black">{report.business_date}</p>
                    <p className="mt-0.5 line-clamp-1 font-bold text-neutral-700">{report.platter_name}</p>
                    <p className="mt-1 line-clamp-2 text-[10px] font-bold text-neutral-600">{compactIngredients(report)}</p>
                  </td>
                  <td className="p-2 font-black leading-tight">
                    <span className="block">{report.meal_purpose?report.meals_prepared??'-':report.platter_count}</span>
                    <span className="block text-[10px] text-neutral-600">{report.meal_purpose?text('Meals','Hidangan'):report.serving_basis}</span>
                  </td>
                  <td className="p-2">
                    <span className="line-clamp-2 font-bold text-neutral-700">{report.submitted_by ?? '-'}</span>
                  </td>
                  <td className="p-2">
                    <button type="button" className="grid h-8 w-8 place-items-center rounded-xl border border-line bg-white text-ink shadow-soft" onClick={() => setPreviewReport(report)} aria-label={text('Preview kitchen report', 'Pratonton laporan dapur')}>
                      <Eye className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredReports.length === 0 ? <div className="border-t border-line p-4 text-center text-sm font-bold text-neutral-600">{text('No kitchen production saved for this period.', 'Tiada penyediaan dapur disimpan untuk tempoh ini.')}</div> : null}
        </div>

        <div className="clean-scroll mt-3 hidden overflow-x-auto rounded-2xl border border-line bg-white/75 sm:block">
          <table className="dense-table w-full min-w-[860px] text-left text-xs sm:text-sm">
            <thead>
              <tr>
                <th className="p-3 whitespace-nowrap">{text('Date', 'Tarikh')}</th>
                <th className="p-3 whitespace-nowrap">{text('Set / platter', 'Set / platter')}</th>
                <th className="p-3 whitespace-nowrap">{text('Basis', 'Asas')}</th>
                <th className="p-3 whitespace-nowrap">{text('Prepared', 'Disediakan')}</th>
                <th className="p-3 whitespace-nowrap">{text('Submitted by', 'Dihantar oleh')}</th>
                <th className="p-3 whitespace-nowrap">{text('Ingredients deducted', 'Bahan ditolak')}</th>
                <th className="p-3 whitespace-nowrap">{text('Action', 'Tindakan')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredReports.map((report) => (
                <tr key={report.id} className="border-t border-line hover:bg-shell">
                  <td className="p-3 font-black whitespace-nowrap">{report.business_date}</td>
                  <td className="p-3 font-black whitespace-nowrap">{report.platter_name}</td>
                  <td className="p-3 whitespace-nowrap">{report.meal_purpose?text('Actual Total','Jumlah Sebenar'):report.serving_basis}</td>
                  <td className="p-3 whitespace-nowrap">{report.meal_purpose?report.meals_prepared??'-':report.platter_count}</td>
                  <td className="p-3 whitespace-nowrap">{report.submitted_by ?? '-'}</td>
                  <td className="p-3 min-w-[260px]">{compactIngredients(report)}</td>
                  <td className="p-3 whitespace-nowrap"><button type="button" className={secondaryButtonClass} onClick={() => setPreviewReport(report)}>{text('Preview', 'Pratonton')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredReports.length === 0 ? <div className="border-t border-line p-4 text-center text-sm font-bold text-neutral-600">{text('No kitchen production saved for this period.', 'Tiada penyediaan dapur disimpan untuk tempoh ini.')}</div> : null}
        </div>
      </section>

      {productionReview?<Modal title={text('Confirm Meal Preparation','Sahkan Penyediaan Makanan')} onClose={()=>{if(!savingProduction)setProductionReview(false);}} footer={<div className="grid gap-3">{productionError?<p role="alert" className="text-sm text-danger">{productionError}</p>:null}<label className="flex items-start gap-2 text-sm"><input type="checkbox" className="h-5 w-5 shrink-0" checked={reviewChecked} disabled={savingProduction} onChange={e=>setReviewChecked(e.target.checked)} />{text('I checked the servings and ingredient quantities.','Saya telah menyemak hidangan dan kuantiti bahan.')}</label><button type="button" className={buttonClass} disabled={!reviewChecked||savingProduction} onClick={event=>void submitProduction(event,true)}>{savingProduction?text('Saving...','Menyimpan...'):text('Confirm Preparation','Sahkan Penyediaan')}</button></div>}>
        <p className="font-semibold">{platterName} · {platterCount} {servingBasis==='pax'?text('People','Orang'):servingBasis==='table'?text('Tables','Meja'):text('Batches','Kelompok')}</p><p className="mb-3 text-sm text-muted">{platterDate} · {submittedBy}</p>
        <ul className="divide-y divide-line">{usageLines.map((line,index)=>{const ingredient=activeIngredients.find(i=>i.id===line.ingredient_id);return <li key={index} className="flex items-start justify-between gap-3 py-3 text-sm"><span>{ingredient?.name}</span><strong className="shrink-0 text-warning">-{ingredient?qty(Number(line.quantity_per_platter)*Number(platterCount),ingredient.base_unit):'-'}</strong></li>;})}</ul>
      </Modal>:null}
      {copyOpen ? <Modal title={text('Use Previous Preparation','Guna Penyediaan Sebelumnya')} onClose={()=>setCopyOpen(false)}>
        {usageLines.some(line=>line.quantity_per_platter.trim()) ? <p className="mb-3 text-sm text-warning">{text('Choosing a record replaces the unsaved ingredients below.','Memilih rekod menggantikan bahan yang belum disimpan.')}</p> : null}
        <ul className="divide-y divide-line">{recentReports.map(report=><li key={report.id} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="break-words text-sm font-semibold">{report.platter_name}</p><p className="text-xs text-muted">{report.business_date} · {report.serving_basis==='pax'?text('Per Person','Setiap Orang'):report.serving_basis==='table'?text('Per Table','Setiap Meja'):text('Per Batch','Setiap Kelompok')}</p><p className="break-words text-xs text-muted">{compactIngredients(report)}</p></div><button type="button" className={secondaryButtonClass+' shrink-0'} aria-label={text('Use ','Guna ')+report.platter_name} onClick={()=>copyPreparation(report)}><Copy size={16}/>{text('Use','Guna')}</button></li>)}</ul>
      </Modal> : null}
      {showPaxReminder ? (
        <Modal
          title={text('Enter today pax', 'Masukkan pax hari ini')}
          onClose={dismissPaxReminder}
          footer={
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" className={secondaryButtonClass} onClick={dismissPaxReminder}>{text('Later', 'Nanti')}</button>
              <button type="button" className={buttonClass} onClick={(event) => void savePax(event as unknown as FormEvent)} disabled={savingPax || !paxCount}>{text('Save pax', 'Simpan pax')}</button>
            </div>
          }
        >
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-warning">
            <div className="flex gap-2"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><p>{text('Pax count is missing. It is needed to compare kitchen food preparation with actual visitors.', 'Jumlah pax belum diisi. Ia diperlukan untuk banding penyediaan makanan dengan pelawat sebenar.')}</p></div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Field label={text('Date', 'Tarikh')}><input className={inputClass} type="date" value={paxDate} onChange={(event) => setPaxDate(event.target.value)} /></Field>
            <Field label={text('Pax arrived', 'Pax tiba')}><input className={inputClass} type="number" min={0} value={paxCount} onChange={(event) => setPaxCount(event.target.value)} autoFocus /></Field>
          </div>
        </Modal>
      ) : null}

      {previewReport ? (
        <Modal title={`${previewReport.platter_name} · ${previewReport.business_date}`} onClose={() => setPreviewReport(null)} size="wide">
          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label={text('Prepared', 'Disediakan')} value={previewReport.meal_purpose?previewReport.meals_prepared??'-':previewReport.platter_count} />
            <Stat label={text('Basis', 'Asas')} value={previewReport.meal_purpose?text('Actual Total','Jumlah Sebenar'):previewReport.serving_basis} />
            <Stat label={text('Submitted by', 'Dihantar oleh')} value={previewReport.submitted_by ?? '-'} />
            <Stat label={text('Ingredient lines', 'Baris bahan')} value={(previewReport.kitchen_production_items ?? []).length} />
          </div>
          <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-white/75 sm:hidden">
            <table className="dense-table w-full table-fixed text-left text-[11px]">
              <thead>
                <tr>
                  <th className="w-[42%] p-2">{text('Ingredient', 'Bahan')}</th>
                  <th className="w-[29%] p-2">{previewReport.meal_purpose?text('Recorded','Direkod'):text('Per Set', 'Setiap Set')}</th>
                  <th className="w-[29%] p-2">{text('Deducted', 'Ditolak')}</th>
                </tr>
              </thead>
              <tbody>
                {(previewReport.kitchen_production_items ?? []).map((item) => (
                  <tr key={`mobile-preview-${item.id}`} className="border-t border-line align-top">
                    <td className="p-2">
                      <p className="line-clamp-2 font-black">{item.ingredient_items?.name ?? item.ingredient_id}</p>
                      {item.notes ? <p className="mt-1 line-clamp-2 text-[10px] font-bold text-neutral-600">{item.notes}</p> : null}
                    </td>
                    <td className="p-2 font-bold leading-tight">{qty(item.quantity_per_platter, item.unit)}</td>
                    <td className="p-2 font-black leading-tight text-coral">- {qty(item.total_quantity, item.unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="clean-scroll mt-3 hidden overflow-x-auto rounded-2xl border border-line sm:block">
            <table className="dense-table w-full min-w-[640px] text-left text-sm">
              <thead><tr><th className="p-3">{text('Ingredient', 'Bahan')}</th><th className="p-3">{previewReport.meal_purpose?text('Recorded','Direkod'):text('Per Platter', 'Setiap Platter')}</th><th className="p-3">{text('Total deducted', 'Jumlah ditolak')}</th><th className="p-3">{text('Notes', 'Nota')}</th></tr></thead>
              <tbody>
                {(previewReport.kitchen_production_items ?? []).map((item) => (
                  <tr key={item.id} className="border-t border-line">
                    <td className="p-3 font-black">{item.ingredient_items?.name ?? item.ingredient_id}</td>
                    <td className="p-3">{qty(item.quantity_per_platter, item.unit)}</td>
                    <td className="p-3 font-black text-coral">- {qty(item.total_quantity, item.unit)}</td>
                    <td className="p-3">{item.notes ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {previewReport.notes ? <p className="mt-3 rounded-2xl bg-shell p-3 text-sm font-bold text-neutral-700">{previewReport.notes}</p> : null}
        </Modal>
      ) : null}
    </div>
  );
}
