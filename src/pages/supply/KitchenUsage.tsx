import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Search, Utensils, Users } from 'lucide-react';
import { Field, buttonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { useAccess } from '../../lib/access';
import { useLanguage } from '../../lib/language';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import { loadLocalKitchenProductionReports } from '../../lib/localStore';
import type { KitchenProductionReport } from '../../lib/types';
import { malaysiaDateInputValue } from '../../lib/format';
import { readErrorMessage } from '../../lib/opsData';
import { definitiveInitialSaveFailure } from '../../lib/saveAttempt';
import { countBalance, countDisplay, countQuantity, countUnit, type CountItem } from '../../lib/stockCount';
import { readUsageAttempt, storeUsageAttempt, usageItems, type MealPurpose, type UsageAttempt } from '../../lib/kitchenUsage';

export default function KitchenUsage({items,loadError,onSaved,onWaste}: {items:CountItem[];loadError:string;onSaved:()=>Promise<void>;onWaste:()=>void}) {
  const {text:t}=useLanguage(),{profile}=useAccess();
  const key=`kitchen-usage:${import.meta.env.VITE_SUPABASE_URL??'preview'}:${profile?.id}`;
  const [recovery]=useState(()=>{try{return {attempt:readUsageAttempt(localStorage,key),error:''};}catch(e){return {attempt:null,error:readErrorMessage(e,'Unable to read pending usage.')};}});
  const [purpose,setPurpose]=useState<MealPurpose>('guest_meals'),[date,setDate]=useState(malaysiaDateInputValue(new Date()));
  const [entries,setEntries]=useState<Record<string,string>>({}),[search,setSearch]=useState(''),[selectedOnly,setSelectedOnly]=useState(false);
  const [meal,setMeal]=useState(''),[portions,setPortions]=useState(''),[notes,setNotes]=useState('');
  const [attempt,setAttempt]=useState<UsageAttempt|null>(recovery.attempt),[checked,setChecked]=useState(false),[busy,setBusy]=useState(false);
  const [error,setError]=useState(recovery.error),[notice,setNotice]=useState('');
  const [copyOpen,setCopyOpen]=useState(false),[previous,setPrevious]=useState<KitchenProductionReport[]>([]);
  const [copyError,setCopyError]=useState('');
  const lock=useRef(false);
  const selected=Object.values(entries).filter(v=>v.trim()).length;
  const visible=items.filter(i=>i.active && i.name.toLowerCase().includes(search.toLowerCase()) && (!selectedOnly||entries[i.id]?.trim()));
  const purposeName=(value:MealPurpose)=>value==='guest_meals'?t('Guest Meals','Makanan Tetamu'):t('Staff Meals','Makanan Staf');
  async function loadPrevious() {
    if(!isSupabaseConfigured){setPrevious(loadLocalKitchenProductionReports().slice(0,20));return;}
    const result=await supabase.from('kitchen_production_reports').select('*, kitchen_production_items(*)').order('created_at',{ascending:false}).limit(20);
    if(result.error){setCopyError(t('Previous batches could not load. Try again.','Kelompok sebelumnya tidak dapat dimuatkan. Cuba lagi.'));return;}
    setPrevious(result.data??[]);setCopyError('');
  }
  useEffect(()=>{void loadPrevious();},[profile?.id]);
  function copyBatch(report:KitchenProductionReport) {
    const lines=report.kitchen_production_items??[];
    if(!lines.length||lines.some(line=>!items.some(i=>i.id===line.ingredient_id&&i.active&&i.base_unit===line.unit))){setCopyError(t('An ingredient is unavailable or its unit changed. Choose another batch.','Bahan tidak tersedia atau unit telah berubah. Pilih kelompok lain.'));return;}
    const quantities:Record<string,number>={};lines.forEach(line=>{quantities[line.ingredient_id]=(quantities[line.ingredient_id]??0)+Number(line.total_quantity);});
    setEntries(Object.fromEntries(Object.entries(quantities).map(([id,n])=>[id,String(n/(items.find(i=>i.id===id)!.base_unit==='g'?1000:1))])));
    setMeal(report.platter_name.replace(/^(Guest Meals|Staff Meals)( \/ )?/,''));
    setPortions(report.meals_prepared?String(report.meals_prepared):'');
    if(report.meal_purpose)setPurpose(report.meal_purpose);
    setCopyOpen(false);setNotice(t('Amounts copied. Check today’s actual usage before confirming.','Kuantiti disalin. Semak penggunaan sebenar hari ini sebelum sahkan.'));
  }
  function review() {
    try {
      if(loadError)throw new Error(t('Refresh stock before confirming.','Muat semula stok sebelum mengesahkan.'));
      const lines=usageItems(items,entries);
      if(!lines.length)return;
      const n=portions.trim()?Number(portions):null;
      if(n!==null&&(!Number.isInteger(n)||n<=0))throw new Error(t('Enter a whole number of meals, or leave it blank.','Masukkan jumlah hidangan bulat, atau biarkan kosong.'));
      if(!date)throw new Error(t('Choose the usage date.','Pilih tarikh penggunaan.'));
      const next:UsageAttempt={id:crypto.randomUUID(),date,purpose,meal:meal.trim(),portions:n,notes:notes.trim(),items:lines,attempted:false,createdAt:new Date().toISOString()};
      storeUsageAttempt(localStorage,key,next);setAttempt(next);setChecked(false);setError('');setNotice('');
    }catch(e){setError(e instanceof Error&&items.some(i=>i.name===e.message)?t('Check the quantity for ','Semak kuantiti untuk ')+e.message:readErrorMessage(e,'Check the quantities.'));}
  }
  function edit() {
    if(!attempt||busy||attempt.attempted)return;
    try {localStorage.removeItem(key);}catch(e){setError(readErrorMessage(e,'Unable to reopen the entry.'));return;}
    setPurpose(attempt.purpose);setDate(attempt.date);setMeal(attempt.meal);setPortions(attempt.portions===null?'':String(attempt.portions));setNotes(attempt.notes);
    setEntries(Object.fromEntries(attempt.items.map(i=>[i.ingredient_id,String(i.quantity/(i.expected_base_unit==='g'?1000:1))])));
    setAttempt(null);setError('');
  }
  async function confirm() {
    if(!attempt||!checked||lock.current)return;
    lock.current=true;setBusy(true);setError('');let submitted=false,saved=false;
    try {
      const pending={...attempt,attempted:true};storeUsageAttempt(localStorage,key,pending);setAttempt(pending);submitted=true;
      const result=await supabase.rpc('record_kitchen_usage_checked',{p_request_id:pending.id,p_business_date:pending.date,p_purpose:pending.purpose,p_meal:pending.meal,p_portions:pending.portions,p_notes:pending.notes,p_items:pending.items.map(({name,...line})=>line)});
      if(result.error)throw result.error;
      if(!result.data)throw new Error('Confirmation was incomplete.');
      saved=true;localStorage.removeItem(key);setAttempt(null);setEntries({});setNotes('');setMeal('');setPortions('');setChecked(false);
      setNotice(t('Usage Confirmed','Penggunaan Disahkan')+' · '+purposeName(pending.purpose)+' · '+pending.items.length+' '+t('items','item')+' · '+pending.id.slice(0,8));
      await onSaved();
      void loadPrevious();
    }catch(e){
      const definite=!saved&&(!submitted&&!attempt.attempted||definitiveInitialSaveFailure(attempt.attempted,e));
      if(definite){try{const editable={...attempt,attempted:false};storeUsageAttempt(localStorage,key,editable);setAttempt(editable);}catch{setError(t('Keep this confirmation open. Device storage is unavailable.','Kekalkan pengesahan ini. Storan peranti tidak tersedia.'));return;}}
      setError(definite?readErrorMessage(e,'Usage was not saved.'):t('Confirmation pending. Check this same submission again before entering another.','Menunggu pengesahan. Semak penghantaran ini sebelum membuat rekod lain.'));
    }finally{lock.current=false;setBusy(false);}
  }
  return <section aria-label={t('Record Usage','Rekod Penggunaan')}>
    <div className="kitchen-purpose" role="group" aria-label={t('Usage For','Kegunaan')}>
      <button aria-pressed={purpose==='guest_meals'} disabled={!!attempt} onClick={()=>setPurpose('guest_meals')}><Utensils size={16}/>{t('Guest Meals','Makanan Tetamu')}</button>
      <button aria-pressed={purpose==='staff_meals'} disabled={!!attempt} onClick={()=>setPurpose('staff_meals')}><Users size={16}/>{t('Staff Meals','Makanan Staf')}</button>
      <button disabled={!!attempt} onClick={onWaste}>{t('Waste / Other','Sisa / Lain')}</button>
    </div>
    <div className="my-3 flex items-center justify-between gap-3 text-xs text-muted"><span className="min-w-0 break-words">{t('Recorded By','Direkod Oleh')}<strong className="block text-sm text-ink">{profile?.full_name}</strong></span><button className={secondaryButtonClass+' shrink-0'} disabled={!!attempt} onClick={()=>{setCopyOpen(true);void loadPrevious();}}><Copy size={16}/>{t('Use Previous','Guna Sebelumnya')}</button></div>
    {notice?<p role="status" className="mb-3 text-sm text-accent">{notice}</p>:null}
    {!attempt&&error?<p role="alert" className="mb-3 text-sm text-danger">{error}</p>:null}
    <fieldset disabled={!!attempt||!!recovery.error} className="min-w-0">
      <div className="kitchen-entry-fields">
        <Field label={t('Date','Tarikh')}><input type="date" className={inputClass} value={date} onChange={e=>setDate(e.target.value)}/></Field>
        <Field label={t('Meal Name (Optional)','Nama Hidangan (Pilihan)')}><input className={inputClass} value={meal} maxLength={120} placeholder={t('e.g. Lunch','cth. Makan Tengah Hari')} onChange={e=>setMeal(e.target.value)}/></Field>
      </div>
      <div className="my-3 flex flex-wrap gap-2">
        <label className="relative min-w-0 flex-1"><Search size={16} className="absolute left-3 top-3.5 text-muted"/><input aria-label={t('Find Ingredient','Cari Bahan')} type="search" className={inputClass+' pl-9'} placeholder={t('Find Ingredient','Cari Bahan')} value={search} onChange={e=>setSearch(e.target.value)}/></label>
        <button className={secondaryButtonClass} aria-pressed={selectedOnly} onClick={()=>setSelectedOnly(!selectedOnly)}>{selectedOnly?t('All Items','Semua Item'):t('Entered','Diisi')+' ('+selected+')'}</button>
      </div>
      <div className="kitchen-quantity-row border-b border-line py-2 text-xs font-semibold text-muted"><span>{t('Ingredient','Bahan')}</span><span>{t('Total Used','Jumlah Digunakan')}</span></div>
      <ul className="divide-y divide-line">{visible.map(item=>{
        const input=entries[item.id]??'',quantity=countQuantity(input,item.base_unit),balance=countBalance(item);
        const invalid=!!input.trim()&&(quantity===null||quantity<=0||quantity>balance);
        return <li className="kitchen-quantity-row py-2" key={item.id}>
          <div className="min-w-0"><p className="break-words text-sm font-semibold">{item.name}</p><p className={'text-xs '+(invalid?'text-danger':'text-muted')}>{invalid?t('Check Quantity','Semak Kuantiti'):t('Available','Tersedia')+': '+countDisplay(balance,item.base_unit)+' '+countUnit(item.base_unit)}</p></div>
          <label className="flex min-w-0 items-center gap-2"><input aria-label={`${t('Total Used','Jumlah Digunakan')} ${item.name} (${countUnit(item.base_unit)})`} aria-invalid={invalid} className={inputClass+' text-right tabular'} inputMode={item.base_unit==='unit'?'numeric':'decimal'} value={input} onChange={e=>{setEntries(old=>({...old,[item.id]:e.target.value}));setNotice('');}}/><span className="w-6 shrink-0 text-xs text-muted">{countUnit(item.base_unit)}</span></label>
        </li>;
      })}</ul>
      {!visible.length?<p className="py-4 text-sm text-muted">{t('No Matching Items','Tiada Item Sepadan')}</p>:null}
      <div className="kitchen-entry-fields mt-3"><Field label={t('Meals Prepared (Optional)','Jumlah Hidangan (Pilihan)')}><input inputMode="numeric" className={inputClass} value={portions} onChange={e=>setPortions(e.target.value)}/></Field><Field label={t('Notes (Optional)','Nota (Pilihan)')}><input className={inputClass} value={notes} maxLength={2000} onChange={e=>setNotes(e.target.value)}/></Field></div>
      <div className="kitchen-entry-footer"><span className="text-sm">{selected} {t('Items Entered','Item Diisi')}</span><button className={buttonClass} disabled={!selected||!!loadError} onClick={review}>{t('Review Usage','Semak Penggunaan')}</button></div>
    </fieldset>
    {attempt?<Modal title={t('Confirm Usage','Sahkan Penggunaan')} onClose={edit} footer={<div className="grid gap-3">
      {error?<p role="alert" className="text-sm text-danger">{error}</p>:null}
      <label className="flex items-start gap-2 text-sm"><input className="h-5 w-5 shrink-0" type="checkbox" checked={checked} disabled={busy} onChange={e=>setChecked(e.target.checked)}/>{t('These are the actual totals used, not quantities per meal.','Ini ialah jumlah sebenar digunakan, bukan kuantiti setiap hidangan.')}</label>
      <div className="grid grid-cols-2 gap-2"><button className={secondaryButtonClass} disabled={busy||attempt.attempted} onClick={edit}>{t('Back to Edit','Kembali Edit')}</button><button className={buttonClass} disabled={busy||!checked} onClick={()=>void confirm()}><Check size={16}/>{busy?t('Saving...','Menyimpan...'):attempt.attempted?t('Check Confirmation','Semak Pengesahan'):t('Confirm Usage','Sahkan Penggunaan')}</button></div>
    </div>}>
      <p className="text-sm font-semibold">{purposeName(attempt.purpose)} · {attempt.date}</p><p className="mb-3 text-xs text-muted">{[attempt.meal,attempt.portions?attempt.portions+' '+t('meals','hidangan'):'',profile?.full_name].filter(Boolean).join(' · ')}</p>
      <ul className="divide-y divide-line">{attempt.items.map(i=><li key={i.ingredient_id} className="flex justify-between gap-3 py-2 text-sm"><span className="min-w-0 break-words">{i.name}</span><strong className="shrink-0 tabular">{countDisplay(i.quantity,i.expected_base_unit)} {countUnit(i.expected_base_unit)}</strong></li>)}</ul>
      <p className="mt-3 text-xs text-muted">{attempt.attempted?t('Waiting for confirmation.','Menunggu pengesahan.'):t('Not submitted. Confirm to deduct from shared stock.','Belum dihantar. Sahkan untuk menolak stok bersama.')}</p>
    </Modal>:null}
    {copyOpen?<Modal title={t('Use Previous Batch','Guna Kelompok Sebelumnya')} onClose={()=>setCopyOpen(false)}>
      {copyError?<p role="alert" className="mb-3 text-sm text-danger">{copyError}</p>:null}
      {selected?<p className="mb-3 text-sm text-warning">{t('Choosing a batch replaces the unsaved quantities.','Memilih kelompok menggantikan kuantiti yang belum disimpan.')}</p>:null}
      <ul className="divide-y divide-line">{previous.map(report=><li key={report.id} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="break-words text-sm font-semibold">{report.platter_name}</p><p className="text-xs text-muted">{report.business_date} · {report.kitchen_production_items?.length??0} {t('items','item')}</p></div><button className={secondaryButtonClass+' shrink-0'} onClick={()=>copyBatch(report)}>{t('Use','Guna')}</button></li>)}</ul>
      {!previous.length&&!copyError?<p className="text-sm text-muted">{t('No previous batches yet.','Belum ada kelompok sebelumnya.')}</p>:null}
    </Modal>:null}
  </section>;
}
