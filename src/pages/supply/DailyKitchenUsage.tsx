import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Plus, RotateCw, Settings2, Trash2, Users, Utensils } from 'lucide-react';
import { Field, buttonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { useAccess } from '../../lib/access';
import { useLanguage } from '../../lib/language';
import { supabase } from '../../lib/supabase';
import { readErrorMessage, todayIso } from '../../lib/opsData';
import { countBalance, countDisplay, countQuantity, countUnit, type CountItem } from '../../lib/stockCount';
import type { DailyUsage, DailyUsageLine, MealTemplate } from '../../lib/supplyWorkflow';
import { definitiveInitialSaveFailure } from '../../lib/saveAttempt';
import { readPendingUsage, readUsageDraft, usageDraftDays, writeUsageStorage, type UsageDraft, type UsageEntry as Entry, type PendingUsage as Pending } from '../../lib/dailyUsageDraft';

import { kitchenName, kitchenUnit, kitchenValue, kitchenQuantity, kitchenFactor, kitchenOrdered, kitchenMatches } from '../../lib/kitchenCatalogue';

import { MeasureChoices } from '../../components/MeasureChoices';
import { entryQuantity, entryValue, entryDisplay, changeMeasure, measureOptions, validMeasure } from '../../lib/kitchenMeasure';

import { kitchenChoicesKey, preferredMeasure, readKitchenChoices, rememberKitchenChoice, recentIngredientList, recentUsageRange, type KitchenChoices } from '../../lib/kitchenQuickEntry';
import './kitchen-quick-entry.css';

type UsageTarget = {kind:'field';field:'guests'|'staff'|'notes'|'search'} | {kind:'quantity';id:string;field:'guest'|'staff'} | {kind:'unavailable';id:string};

function usageEntries(lines:DailyUsageLine[],items:CountItem[],editing=false):Record<string,Entry>{
  return Object.fromEntries(lines.map(l=>{
    const i=items.find(v=>v.id===l.ingredient_id),current=editing&&i&&kitchenFactor(i);
    const factor=current||l.display_factor||(l.unit==='g'?1000:1),unit=current?kitchenUnit(i!):(l.display_unit||countUnit(l.unit));
    const baseUnit:Entry['baseUnit']=editing&&i?i.base_unit:l.unit==='g'||l.unit==='ml'||l.unit==='unit'?l.unit:undefined;
    let guest=l.guest_quantity?String(l.guest_quantity/factor):'',staff=l.staff_quantity?String(l.staff_quantity/factor):'';
    let measure=!editing&&i&&l.unit!=='unit'&&unit!==kitchenUnit(i)&&['kg','g','L','ml'].includes(unit)?unit:undefined;
    // A partial bottle or bag may not be expressible as an exact container fraction.
    if(current&&i&&['g','ml'].includes(i.base_unit)&&(entryQuantity(guest||'0',i)!==l.guest_quantity||entryQuantity(staff||'0',i)!==l.staff_quantity)){
      measure=i.base_unit;
      guest=l.guest_quantity?entryValue(l.guest_quantity,i,measure)??String(l.guest_quantity):'';
      staff=l.staff_quantity?entryValue(l.staff_quantity,i,measure)??String(l.staff_quantity):'';
    }
    return [l.ingredient_id,{name:l.name,baseUnit,guest,staff,unit:!editing&&i&&l.unit!=='unit'&&['kg','g','L','ml'].includes(unit)?kitchenUnit(i):unit,factor:!editing&&i&&l.unit!=='unit'&&['kg','g','L','ml'].includes(unit)?kitchenFactor(i):factor,measure,version:editing?i?.updated_at:l.expected_item_version}];
  }));
}
function dayForm(date:string,items:CountItem[],row?:DailyUsage|null):UsageDraft {
  return {date,entries:usageEntries(row?.lines??[],items),guests:row?String(row.guest_meals):'',staff:row?String(row.staff_meals):'',notes:row?.notes??'',selected:row?.template_ids??[],all:!row,expected:row?.updated_at??null,updatedAt:new Date().toISOString()};
}

export default function DailyKitchenUsage({items,onSaved,loadError,active:visible=true,resumeDate}:{items:CountItem[];onSaved:()=>Promise<void>;loadError:string;active?:boolean;resumeDate?:string}) {
  const {text:t}=useLanguage(),{profile,can}=useAccess();
  const storageKey=`daily-kitchen-pending:${import.meta.env.VITE_SUPABASE_URL??'review'}:${profile?.id}`;
  const [date,setDate]=useState(()=>{try{return readPendingUsage(localStorage.getItem(storageKey))?.record.business_date??resumeDate??todayIso();}catch{return resumeDate??todayIso();}}),[templates,setTemplates]=useState<MealTemplate[]>([]);
  const [form,setForm]=useState<UsageDraft>(()=>dayForm(date,items));
  const {entries,guests,staff,notes,selected,all}=form;
  const [saved,setSaved]=useState<DailyUsage|null>(null),[editing,setEditing]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [pending,setPending]=useState<Pending|null>(null),[checked,setChecked]=useState(false),[busy,setBusy]=useState(false),[templateOpen,setTemplateOpen]=useState(false);
  const lock=useRef(false),version=useRef(0),draftRaw=useRef<string|null>(null),pendingRaw=useRef<string|null>(null);
  const draftPrefix=storageKey+':draft:',draftKey=draftPrefix+date;
  const [draftDays,setDraftDays]=useState<string[]>([]),[hasDraft,setHasDraft]=useState(false),[conflict,setConflict]=useState(false),[changedElsewhere,setChangedElsewhere]=useState(false),[discardOpen,setDiscardOpen]=useState(false);
  const [search,setSearch]=useState(''),[enteredOnly,setEnteredOnly]=useState(false),[focused,setFocused]=useState<string|null>(null);
  const section=useRef<HTMLElement>(null),recentSequence=useRef(0);
  const choicesKey=kitchenChoicesKey(import.meta.env.VITE_SUPABASE_URL,profile?.id??'');
  const [choices,setChoices]=useState<KitchenChoices>(()=>{try{return readKitchenChoices(localStorage.getItem(choicesKey));}catch{return {};}});
  const [recentData,setRecentData]=useState<unknown>(),[recentError,setRecentError]=useState(''),[recentLoading,setRecentLoading]=useState(true),[recentRetry,setRecentRetry]=useState(0);
  const [dayLoaded,setDayLoaded]=useState(false),[retry,setRetry]=useState(0);
  const [issue,setIssue]=useState<{target:UsageTarget;message:string}|null>(null),issueId=useId();
  const readonly=!!saved&&!editing;
  const active=kitchenOrdered(items.filter(i=>i.active&&!i.kitchen_key?.startsWith('snorkelling-mineral-water')));
  const templateIds=new Set(form.ingredientList?.ids??templates.filter(v=>selected.includes(v.id)).flatMap(v=>v.ingredient_ids));
  const enteredIds=Object.keys(entries).filter(id=>entries[id].guest.trim()||entries[id].staff.trim());
  const unavailable=loadError?[]:enteredIds.filter(id=>!active.some(i=>i.id===id));
  function entryName(id:string){const item=items.find(i=>i.id===id);return entries[id].name||(item?kitchenName(item):t('No Longer Listed Ingredient','Bahan Tidak Lagi Disenaraikan')+' · '+id.slice(0,8));}
  const lastList=useMemo(()=>{if(recentData===undefined)return {list:null,error:''};try{return {list:recentIngredientList(recentData,date,items),error:''};}catch(e){return {list:null,error:readErrorMessage(e,'Recent ingredient list unavailable.')};}},[recentData,date,items]);
  const shown=active.filter(i=>{
    if(!kitchenMatches(i,search))return false;
    if(readonly)return !!(entries[i.id]?.guest||entries[i.id]?.staff);
    const included=search.trim()||all||(!form.ingredientList&&!templates.length)||templateIds.has(i.id)||entries[i.id]?.guest||entries[i.id]?.staff||/^(cooking gas|gas memasak|lpg)$/i.test(i.name);
    return !!included&&(!enteredOnly||enteredIds.includes(i.id)||focused===i.id);
  });
  function fieldIssue(field:'guests'|'staff'|'notes'|'search'){return issue?.target.kind==='field'&&issue.target.field===field;}
  function quantityIssue(id:string,field:'guest'|'staff'){return issue?.target.kind==='quantity'&&issue.target.id===id&&issue.target.field===field;}
  function showIssue(target:UsageTarget,message:string){setSearch('');setEnteredOnly(false);setFocused(null);setIssue({target,message});}
  useLayoutEffect(()=>{
    if(!issue||!visible||loading||pending||busy||readonly||loadError||!dayLoaded||conflict||changedElsewhere)return;
    const target=issue.target;
    const controls=[...section.current?.querySelectorAll<HTMLInputElement|HTMLButtonElement>('[data-usage-target],input[data-usage-item],button[data-usage-unavailable]')??[]];
    const control=controls.find(el=>target.kind==='field'?el.dataset.usageTarget===target.field:target.kind==='quantity'?el.dataset.usageItem===target.id&&el.dataset.usageField===target.field:el.dataset.usageUnavailable===target.id);
    if(!control)return;
    const frame=target.kind==='quantity'?control.closest('li'):control.closest('.count-unavailable')??control;
    if(control.disabled){if(target.kind!=='quantity')return;(frame as HTMLElement)?.focus({preventScroll:true});}
    else control.focus({preventScroll:true});
    frame?.scrollIntoView({block:'center'});
  },[issue,visible,loading,pending,busy,readonly,loadError,dayLoaded,conflict,changedElsewhere]);
  useLayoutEffect(()=>{
    const node=section.current,header=node?.closest('main')?.querySelector<HTMLElement>('.kitchen-header');
    if(!node||!header)return;
    const update=()=>node.style.setProperty('--usage-nav-height',`${Math.ceil(header.getBoundingClientRect().height)}px`);
    update();const observer=new ResizeObserver(update);observer.observe(header);
    return()=>observer.disconnect();
  },[visible]);
  async function loadTemplates(){const r=await supabase.rpc('read_kitchen_templates');if(r.error)throw r.error;setTemplates(r.data??[]);}
  useEffect(()=>{void loadTemplates().catch(e=>setError(readErrorMessage(e,'Could not load templates.')));},[]);
  useEffect(()=>{const ticket=++recentSequence.current;setRecentLoading(true);setRecentData(undefined);setRecentError('');void(async()=>{try{const range=recentUsageRange(date);const r=await supabase.rpc('read_daily_kitchen_usage',{p_from:range.from,p_to:range.to});if(r.error)throw r.error;if(ticket===recentSequence.current)setRecentData(r.data);}catch(e){if(ticket===recentSequence.current)setRecentError(readErrorMessage(e,'Recent ingredient list unavailable.'));}finally{if(ticket===recentSequence.current)setRecentLoading(false);}})();return()=>{recentSequence.current++;};},[date,recentRetry,storageKey]);
  function freshEntry(item:CountItem):Entry{return {guest:'',staff:'',name:kitchenName(item),baseUnit:item.base_unit,unit:kitchenUnit(item),factor:kitchenFactor(item),version:item.updated_at,measure:preferredMeasure(item,choices)};}
  function useLastList(){
    if(!lastList.list||!lastList.list.ids.length||saved||pending||busy||loading||loadError||conflict||changedElsewhere)return;
    chooseList({ingredientList:{date:lastList.list.date,ids:lastList.list.ids},all:false,selected:[]});
  }
  function chooseList(patch:Pick<UsageDraft,'selected'|'all'|'ingredientList'>){
    if(saveEdit(patch)){setEnteredOnly(false);setSearch('');setFocused(null);}
  }
  function toggleTemplate(id:string){
    const current=all||form.ingredientList?[]:selected;
    const next=current.includes(id)?current.filter(v=>v!==id):[...current,id];
    chooseList({selected:next,all:!next.length,ingredientList:undefined});
  }
  function nextQuantity(input:HTMLInputElement){
    const fields=[...section.current?.querySelectorAll<HTMLInputElement>('input[data-usage-item]:not(:disabled)')??[]].filter(el=>el.getClientRects().length);
    const ordered=['guest','staff'].flatMap(group=>fields.filter(el=>el.dataset.usageField===group));
    const index=ordered.indexOf(input),next=index>=0?ordered[index+1]:undefined;if(next){next.focus({preventScroll:true});next.select();next.scrollIntoView({block:'center'});}else input.blur();
  }
  function rememberUnit(item:CountItem,unit:string){try{setChoices(rememberKitchenChoice(localStorage,choicesKey,item,unit));}catch{setNotice(t('Unit choice could not be remembered. This draft is still kept.','Pilihan unit tidak dapat diingati. Draf ini masih disimpan.'));}}
  function refreshDraftDays(){setDraftDays(usageDraftDays(localStorage,draftPrefix));}
  useEffect(()=>{const n=++version.current;setLoading(true);setIssue(null);setDayLoaded(false);setEnteredOnly(false);setSearch('');setFocused(null);setError('');setNotice('');setChecked(false);void(async()=>{try{
    const raw=localStorage.getItem(storageKey),p=readPendingUsage(raw);pendingRaw.current=raw;setPending(p);
    if(p&&p.record.business_date!==date){setDate(p.record.business_date);return;}
    const r=await supabase.rpc('read_daily_kitchen_usage',{p_from:date,p_to:date});if(r.error)throw r.error;if(n!==version.current)return;
    const row=r.data?.[0] as DailyUsage|undefined,rawDraft=localStorage.getItem(draftKey),draft=readUsageDraft(rawDraft,date);
    draftRaw.current=rawDraft;setHasDraft(!!draft);setSaved(row??null);setEditing(!!draft&&!!row);setForm(draft??dayForm(date,items,row));
    setConflict(!!draft&&draft.expected!==(row?.updated_at??null));setChangedElsewhere(false);refreshDraftDays();setDayLoaded(true);
  }catch(e){if(n===version.current)setError(readErrorMessage(e,'Could not load the kitchen day.'));}finally{if(n===version.current)setLoading(false);}})();return()=>{version.current++;};},[date,retry,storageKey]);
  useEffect(()=>{function changed(e:StorageEvent){if(e.storageArea!==localStorage)return;if(e.key===null||e.key===draftKey||e.key===storageKey){setChangedElsewhere(true);}refreshDraftDays();}window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);},[draftKey,storageKey]);
  function saveEdit(patch:Partial<UsageDraft>){if(!dayLoaded||conflict||changedElsewhere||pending||busy)return;try{
    if(localStorage.getItem(storageKey)!==pendingRaw.current)throw new Error(t('This usage changed in another tab. Reload the day before editing.','Penggunaan berubah di tab lain. Muat semula hari sebelum mengedit.'));
    const next={...form,...patch,date,updatedAt:new Date().toISOString()};draftRaw.current=writeUsageStorage(localStorage,draftKey,next,draftRaw.current);
    setForm(next);setHasDraft(true);refreshDraftDays();setNotice('');setError('');setIssue(null);return true;
  }catch(e){setError(readErrorMessage(e,'Draft not saved on this device.'));return false;}}
  function update(id:string,field:'guest'|'staff',value:string){const item=active.find(i=>i.id===id);if(!item)return;const previous=entries[id];
    const entry=previous&&(previous.guest||previous.staff||previous.measure)?previous:freshEntry(item);
    const next={...entry,[field]:value},nextEntries={...entries};
    if(!next.guest&&!next.staff){
      if(!next.measure||!kitchenFactor(item)||!validMeasure(next.measure,item.base_unit))delete nextEntries[id];
      else nextEntries[id]={...next,baseUnit:item.base_unit,unit:kitchenUnit(item),factor:kitchenFactor(item),version:item.updated_at};
    }else nextEntries[id]=next;
    saveEdit({entries:nextEntries});
  }
  function reloadDay(){setIssue(null);setRetry(n=>n+1);}
  function removeUnavailable(id:string){if(readonly||loading||!unavailable.includes(id))return;const next={...entries};delete next[id];saveEdit({entries:next});}
  function discardDraft(){try{draftRaw.current=writeUsageStorage(localStorage,draftKey,null,draftRaw.current);setDiscardOpen(false);reloadDay();}catch(e){setError(readErrorMessage(e,'Draft could not be discarded.'));setDiscardOpen(false);}}
  function review(){if(readonly||pending||busy)return;setError('');setIssue(null);try{
    if(loadError||loading||!dayLoaded||conflict||changedElsewhere)throw new Error(t('Reload the day before confirming.','Muat semula hari sebelum mengesahkan.'));
    if(localStorage.getItem(draftKey)!==draftRaw.current)throw new Error(t('This usage changed in another tab. Reload the day before editing.','Penggunaan berubah di tab lain. Muat semula hari sebelum mengedit.'));
    const mealCounts=[guests,staff].map(v=>/^\d+$/.test(v.trim())?Number(v):NaN);
    const invalidCount=mealCounts.findIndex(n=>!Number.isSafeInteger(n)||n<0||n>100000);
    if(invalidCount!==-1)return showIssue({kind:'field',field:invalidCount===0?'guests':'staff'},t('Enter a whole meal count. Use 0 when no meals were made.','Isi bilangan hidangan bulat. Gunakan 0 jika tiada hidangan disediakan.'));
    const lines:DailyUsageLine[]=[];
    for(const [id,values] of Object.entries(entries)){
      if(!values.guest.trim()&&!values.staff.trim())continue;
      const item=active.find(i=>i.id===id);if(!item)return showIssue({kind:'unavailable',id},t('Remove this unfinished entry before reviewing.','Buang catatan belum siap ini sebelum menyemak.'));
      const quantityTarget:UsageTarget={kind:'quantity',id,field:values.guest.trim()?'guest':'staff'};
      if(!kitchenFactor(item))return showIssue(quantityTarget,t('Unit setup is needed. Ask a manager to set up this item.','Tetapan unit diperlukan. Minta pengurus menetapkan item ini.'));
      if(values.factor!==kitchenFactor(item)||values.unit!==kitchenUnit(item)||values.version!==item.updated_at)return showIssue(quantityTarget,t('Item changed. Clear both quantities and enter the actual amounts again.','Item berubah. Kosongkan kedua-dua kuantiti dan isi semula jumlah sebenar.'));
      const g=values.guest.trim()?entryQuantity(values.guest,item,values.measure):0,s=values.staff.trim()?entryQuantity(values.staff,item,values.measure):0;
      const prev=saved?.lines.find(l=>l.ingredient_id===id),credit=prev?prev.guest_quantity+prev.staff_quantity:0;
      if(g===null||s===null)return showIssue({kind:'quantity',id,field:g===null?'guest':'staff'},t('Check this amount and its unit.','Semak jumlah ini dan unitnya.'));
      if(g+s>countBalance(item)+credit)return showIssue(quantityTarget,t('Guest and staff use together exceed the available stock.','Jumlah guna tetamu dan staf melebihi stok tersedia.'));
      if((!mealCounts[0]&&g)||(!mealCounts[1]&&s))return showIssue({kind:'field',field:!mealCounts[0]&&g?'guests':'staff'},t('Enter the meal count for the ingredients used.','Isi bilangan hidangan bagi bahan yang digunakan.'));
      if(g+s)lines.push({ingredient_id:id,name:kitchenName(item),unit:item.base_unit,expected_item_version:item.updated_at,display_unit:values.measure??kitchenUnit(item),display_factor:values.measure?(['kg','L'].includes(values.measure)?1000:1):kitchenFactor(item),guest_quantity:g,staff_quantity:s});
    }
    if((mealCounts[0]>0&&!lines.some(l=>l.guest_quantity))||(mealCounts[1]>0&&!lines.some(l=>l.staff_quantity)))return showIssue({kind:'field',field:'search'},t('Enter the ingredients used for each meal group.','Isi bahan yang digunakan bagi setiap kumpulan hidangan.'));
    if(saved&&!notes.trim())return showIssue({kind:'field',field:'notes'},t('Add a reason for correcting this day.','Tambah sebab pembetulan hari ini.'));
    const p:Pending={id:crypto.randomUUID(),expected:form.expected,attempted:false,record:{business_date:date,guest_meals:mealCounts[0],staff_meals:mealCounts[1],template_ids:selected,lines,notes}};
    pendingRaw.current=writeUsageStorage(localStorage,storageKey,p,pendingRaw.current);setPending(p);setChecked(false);
  }catch(e){setError(readErrorMessage(e,'Check the usage details.'));}}
  async function confirm(){if(!pending||!checked||lock.current)return;lock.current=true;setBusy(true);setError('');try{
    const p={...pending,attempted:true};pendingRaw.current=writeUsageStorage(localStorage,storageKey,p,pendingRaw.current);setPending(p);
    const r=await supabase.rpc('save_daily_kitchen_usage',{p_record:p.record,p_expected_updated_at:p.expected,p_operation_id:p.id});if(r.error)throw r.error;if(!r.data?.id||r.data.business_date!==p.record.business_date)throw new Error('Confirmation incomplete. Retry the same submission.');
    draftRaw.current=writeUsageStorage(localStorage,draftKey,null,draftRaw.current);
    pendingRaw.current=writeUsageStorage(localStorage,storageKey,null,pendingRaw.current);setSaved(r.data);setEditing(false);setPending(null);setHasDraft(false);setConflict(false);setChangedElsewhere(false);setForm(dayForm(date,items,r.data));refreshDraftDays();
    setNotice(t('Daily Usage Confirmed','Penggunaan Harian Disahkan')+' · '+r.data.created_by_name);
    await onSaved().catch(e=>setError(readErrorMessage(e,'Usage confirmed. Refresh stock to see the latest balance.')));
  }catch(e){setError(readErrorMessage(e,'Confirmation is uncertain. Retry this same submission.'));if(definitiveInitialSaveFailure(pending.attempted,e)){try{const p={...pending,attempted:false};pendingRaw.current=writeUsageStorage(localStorage,storageKey,p,pendingRaw.current);setPending(p);}catch{setChangedElsewhere(true);}}}
  finally{lock.current=false;setBusy(false);}}
  function closeReview(){if(busy||!pending||pending.attempted)return;try{
    // Restore legacy pending records too, even when no typing draft existed before this release.
    const restored=readUsageDraft(draftRaw.current,date)??{...dayForm(date,items),entries:usageEntries(pending.record.lines,items),guests:String(pending.record.guest_meals),staff:String(pending.record.staff_meals),notes:pending.record.notes,selected:pending.record.template_ids,expected:pending.expected};
    draftRaw.current=writeUsageStorage(localStorage,draftKey,restored,draftRaw.current);pendingRaw.current=writeUsageStorage(localStorage,storageKey,null,pendingRaw.current);setPending(null);setForm(restored);setHasDraft(true);setEditing(!!saved);refreshDraftDays();
  }catch(e){setError(readErrorMessage(e,'Could not return to this draft.'));}}
  return <section ref={section} className="supply-workspace" onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing&&e.target instanceof HTMLInputElement&&e.target.dataset.usageItem){e.preventDefault();nextQuantity(e.target);}}}>
    <div className="supply-toolbar"><h2>{t('Daily Food Stock Out','Stok Keluar Makanan Harian')}</h2><input aria-label={t('Usage Date','Tarikh Penggunaan')} type="date" max={todayIso()} className={inputClass+' !w-auto max-w-full'} value={date} disabled={busy||!!pending} onChange={e=>{if(e.target.value){setDate(e.target.value);setNotice('');}}}/></div>
    <div className="usage-draft-bar">
      {hasDraft&&!loading?<div className="usage-draft-status"><span>{t('Draft on This Device · Not Submitted','Draf di Peranti Ini · Belum Dihantar')}</span><button type="button" className={secondaryButtonClass} title={t('Discard Usage Draft','Buang Draf Penggunaan')} aria-label={t('Discard Usage Draft','Buang Draf Penggunaan')} disabled={busy||!!pending||changedElsewhere} onClick={()=>setDiscardOpen(true)}><Trash2 size={16}/></button></div>:null}
      {draftDays.some(day=>day!==date)?<nav className="usage-draft-days" aria-label={t('Unfinished Usage Days','Hari Penggunaan Belum Disahkan')}><span>{t('Other Drafts','Draf Lain')}</span>{draftDays.filter(day=>day!==date).map(day=><button key={day} type="button" disabled={busy||!!pending} onClick={()=>setDate(day)}>{new Date(day+'T12:00:00').toLocaleDateString(t('en-GB','ms-MY'),{day:'numeric',month:'short',year:day.slice(0,4)!==todayIso().slice(0,4)?'numeric':undefined})}</button>)}</nav>:null}
    </div>
    {conflict&&!pending?<p role="alert" className="usage-draft-warning">{t('This day was updated after your draft was started. Check the confirmed record before entering a correction. Discarding this draft will not change the confirmed stock.','Hari ini dikemas kini selepas draf dimulakan. Semak rekod disahkan sebelum membuat pembetulan. Membuang draf ini tidak mengubah stok disahkan.')}</p>:null}
    {changedElsewhere?<p role="alert" className="usage-draft-warning">{t('This usage changed in another tab.','Penggunaan berubah di tab lain.')} <button type="button" className="underline font-semibold" disabled={busy} onClick={reloadDay}>{t('Reload Day','Muat Semula Hari')}</button></p>:null}
    {notice&&(!saved||editing)?<p role="status" className="mb-3 text-sm text-palm">{notice}</p>:null}
    {!pending&&error?<p role="alert" className="usage-draft-error mb-3 text-sm text-danger">{error} <button type="button" className={secondaryButtonClass} onClick={reloadDay}><RotateCw size={16}/>{dayLoaded?t('Reload Day','Muat Semula Hari'):t('Retry','Cuba Lagi')}</button></p>:null}
    {saved?<div className="supply-saved"><span><Check size={16}/> {editing?t('Editing Correction','Mengedit Pembetulan'):t('Confirmed','Disahkan')} · {saved.created_by_name} · {t('Revision','Semakan')} {saved.revision}</span>{readonly&&can('kitchen.manage')?<button className={secondaryButtonClass} disabled={loading||!!pending||changedElsewhere} onClick={()=>{if(saveEdit({entries:usageEntries(saved.lines,items,true),notes:''}))setEditing(true);}}>{t('Correct Record','Betulkan Rekod')}</button>:null}</div>:null}
    {loading?<p role="status" className="py-4 text-sm text-muted">{t('Loading Day...','Memuatkan Hari...')}</p>:<>
      <fieldset disabled={readonly||busy||!!pending||!dayLoaded||conflict||changedElsewhere} className="min-w-0">
        <div className="supply-meal-counts"><Field label={t('Guest Meals','Hidangan Tetamu')}><div className="flex items-center gap-2"><Utensils size={18}/><input data-usage-target="guests" aria-invalid={fieldIssue('guests')||undefined} aria-describedby={fieldIssue('guests')?issueId:undefined} aria-label={t('Number of Guest Meals','Bilangan Hidangan Tetamu')} className={inputClass} inputMode="numeric" maxLength={60} placeholder="0" value={guests} onChange={e=>saveEdit({guests:e.target.value})}/></div></Field><Field label={t('Staff Meals','Hidangan Staf')}><div className="flex items-center gap-2"><Users size={18}/><input data-usage-target="staff" aria-invalid={fieldIssue('staff')||undefined} aria-describedby={fieldIssue('staff')?issueId:undefined} aria-label={t('Number of Staff Meals','Bilangan Hidangan Staf')} className={inputClass} inputMode="numeric" maxLength={60} placeholder="0" value={staff} onChange={e=>saveEdit({staff:e.target.value})}/></div></Field></div>
        {fieldIssue('guests')||fieldIssue('staff')?<p id={issueId} role="alert" className="usage-entry-error">{issue?.message}</p>:null}
        {!readonly?<><div className="supply-template-options usage-list-options" role="group" aria-label={t('Meal Templates','Templat Hidangan')}>
         <div className="usage-default-lists">
         <button type="button" aria-pressed={all||(!form.ingredientList&&!templates.length)} onClick={()=>chooseList({all:true,selected:[],ingredientList:undefined})}>{t('All Ingredients','Semua Bahan')}</button>
         {!editing?<button type="button" aria-pressed={!!form.ingredientList} aria-label={t('Use Last Ingredient List','Guna Senarai Bahan Terakhir')} title={recentLoading?t('Loading last list...','Memuatkan senarai terakhir...'):lastList.list?t('Reuse ingredients only, not quantities.','Guna bahan sahaja, bukan kuantiti.'):t('No ingredient list in the last 28 days.','Tiada senarai bahan dalam 28 hari lalu.')} disabled={recentLoading||!lastList.list?.ids.length||!!loadError||!!recentError||!!lastList.error} onClick={useLastList}><Copy size={16}/>{t('Last List','Senarai Lama')}</button>:null}
         {can('kitchen.manage')?<button type="button" className="usage-template-settings" aria-label={t('Manage Meal Templates','Urus Templat Hidangan')} title={t('Manage Meal Templates','Urus Templat Hidangan')} onClick={()=>setTemplateOpen(true)}><Settings2 size={18}/></button>:null}
         </div>
         {templates.length?<div className="usage-template-lists">{templates.map(v=><button type="button" key={v.id} aria-pressed={!all&&!form.ingredientList&&selected.includes(v.id)} onClick={()=>toggleTemplate(v.id)}>{v.name}</button>)}</div>:null}
        </div>
        <div className="usage-quick-tools">
         <div className="supply-segments two" role="group" aria-label={t('Usage Items','Item Penggunaan')}><button type="button" aria-pressed={!enteredOnly} onClick={()=>setEnteredOnly(false)}>{t('List','Senarai')}</button><button type="button" aria-pressed={enteredOnly} onClick={()=>{setEnteredOnly(true);setSearch('');setFocused(null);}}>{t('Entered','Diisi')} ({enteredIds.length})</button></div>
         <input aria-label={t('Find Ingredient','Cari Bahan')} data-usage-target="search" aria-describedby={fieldIssue('search')?issueId:undefined} type="search" className={inputClass} placeholder={t('Find Ingredient','Cari Bahan')} value={search} onChange={e=>{setSearch(e.target.value);if(e.target.value.trim())setEnteredOnly(false);}}/>
        </div>
        {form.ingredientList?<p className="usage-list-source">{t('Ingredient list from','Senarai bahan daripada')} {new Date(form.ingredientList.date+'T12:00:00').toLocaleDateString(t('en-GB','ms-MY'),{day:'numeric',month:'short'})} · {t('Amounts not copied','Jumlah tidak disalin')}{lastList.list?.date===form.ingredientList.date&&lastList.list.unavailable.length?' · '+lastList.list.unavailable.length+' '+t('unavailable items omitted','item tidak tersedia dikecualikan'):''}</p>:null}
        {recentError||lastList.error?<p role="alert" className="usage-list-source text-danger">{t('Last list unavailable. You can still enter manually.','Senarai lama tidak tersedia. Anda masih boleh mengisi secara manual.')} <button type="button" className="underline" onClick={()=>setRecentRetry(v=>v+1)}>{t('Retry List','Cuba Semula Senarai')}</button></p>:null}</>:null}
        {fieldIssue('search')?<p id={issueId} role="alert" className="usage-entry-error">{issue?.message}</p>:null}
        {unavailable.map(id=>{const value=entries[id],name=entryName(id),unit=value.measure??value.unit??'';return <div key={id} role="alert" className="count-unavailable"><div><strong>{name}</strong><span>{t('Not in the Active Item List','Tiada dalam Senarai Item Aktif')}</span><span>{t('Guest Use','Guna Tetamu')}: {value.guest.trim()||'0'} {unit} · {t('Staff Use','Guna Staf')}: {value.staff.trim()||'0'} {unit}</span>{!readonly?<span>{t('Unfinished entry only. Confirmed stock stays unchanged.','Catatan belum siap sahaja. Stok disahkan tidak berubah.')}</span>:null}{issue?.target.kind==='unavailable'&&issue.target.id===id?<p id={issueId} className="usage-entry-error">{issue.message}</p>:null}</div>{!readonly?<button type="button" className={secondaryButtonClass} data-usage-unavailable={id} aria-describedby={issue?.target.kind==='unavailable'&&issue.target.id===id?issueId:undefined} aria-label={t('Remove Usage Entry: ','Buang Catatan Penggunaan: ')+name} onClick={()=>removeUnavailable(id)}><Trash2 size={16}/>{t('Remove Entry','Buang Catatan')}</button>:null}</div>;})}
        <div className="usage-ingredient-table">
        <div className="supply-usage-grid supply-usage-labels usage-column-labels"><span>{t('Ingredient','Bahan')}</span><span>{t('Guest','Tetamu')}</span><span>{t('Staff','Staf')}</span></div>
        <ul className="divide-y divide-line border-b border-line">{shown.map((i,index)=>{const value=entries[i.id]??freshEntry(i);return <Fragment key={i.id}>{i.kitchen_group!==shown[index-1]?.kitchen_group?<li className="kitchen-category-heading">{i.kitchen_group??t('Other Items','Item Lain')}</li>:null}<li key={i.id} data-usage-row={i.id} tabIndex={issue?.target.kind==='quantity'&&issue.target.id===i.id?-1:undefined} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setFocused(null);}} className={'supply-usage-grid '+(measureOptions(i).length?'has-measure':'')}><div className="min-w-0"><strong className="block break-words text-sm">{kitchenName(i)}</strong><span className="block text-xs text-muted">{value.measure||value.unit||kitchenUnit(i)} · {kitchenFactor(i)?t('Balance','Baki')+' '+entryDisplay(countBalance(i),i,value.measure):t('Unit Setup Needed','Tetapan Unit Diperlukan')}</span></div><input className={inputClass+' !px-2 text-right tabular'} data-usage-item={i.id} enterKeyHint="next" onFocus={()=>setFocused(i.id)} disabled={!kitchenFactor(i)||(guests==='0'&&!value.guest.trim())} data-usage-field="guest" aria-invalid={quantityIssue(i.id,'guest')||undefined} aria-describedby={quantityIssue(i.id,'guest')?issueId:undefined} aria-label={`${kitchenName(i)} Guest (${value.measure||value.unit||kitchenUnit(i)})`} inputMode={['biji','ekor','pcs','botol'].includes(kitchenUnit(i))?'numeric':'decimal'} placeholder="0" value={value.guest} onChange={e=>update(i.id,'guest',e.target.value)}/><input className={inputClass+' !px-2 text-right tabular'} data-usage-item={i.id} enterKeyHint="next" onFocus={()=>setFocused(i.id)} disabled={!kitchenFactor(i)||(staff==='0'&&!value.staff.trim())} data-usage-field="staff" aria-invalid={quantityIssue(i.id,'staff')||undefined} aria-describedby={quantityIssue(i.id,'staff')?issueId:undefined} aria-label={`${kitchenName(i)} Staff (${value.measure||value.unit||kitchenUnit(i)})`} inputMode={['biji','ekor','pcs','botol'].includes(kitchenUnit(i))?'numeric':'decimal'} placeholder="0" value={value.staff} onChange={e=>update(i.id,'staff',e.target.value)}/><div className="usage-measure"><MeasureChoices label={kitchenName(i)+' '+t('Usage Unit','Unit Penggunaan')} options={measureOptions(i)} value={value.measure??value.unit??kitchenUnit(i)} onChange={unit=>{const g=changeMeasure(value.guest,i,value.measure,unit),s=changeMeasure(value.staff,i,value.measure,unit);if(!g||!s){setError(t('Check both amounts before changing units.','Semak kedua-dua jumlah sebelum menukar unit.'));return;}if(saveEdit({entries:{...entries,[i.id]:{name:value.name??kitchenName(i),baseUnit:value.baseUnit,guest:g.value,staff:s.value,measure:g.measure,unit:value.unit??kitchenUnit(i),factor:value.factor??kitchenFactor(i),version:value.version??i.updated_at}}}))rememberUnit(i,unit);}}/></div>{issue?.target.kind==='quantity'&&issue.target.id===i.id?<div id={issueId} role="alert" className="usage-entry-error"><p>{issue.message}</p></div>:null}</li></Fragment>;})}</ul></div>
        {!shown.length?<p className="py-5 text-sm text-muted">{search.trim()?t('No matching ingredients.','Tiada bahan sepadan.'):enteredOnly?t('No amounts entered yet.','Belum ada jumlah diisi.'):t('Choose a saved ingredient list above.','Pilih senarai bahan tersimpan di atas.')}</p>:null}
        <p className="my-3 text-xs text-muted">{t('Enter total used for the whole day, not per meal. Blank means none used.','Isi jumlah digunakan sepanjang hari, bukan setiap hidangan. Kosong bermaksud tidak digunakan.')}</p>
        <Field label={saved&&editing?t('Correction Reason','Sebab Pembetulan'):t('Note (Optional)','Nota (Pilihan)')}><input data-usage-target="notes" aria-invalid={fieldIssue('notes')||undefined} aria-describedby={fieldIssue('notes')?issueId:undefined} className={inputClass} maxLength={2000} value={notes} onChange={e=>saveEdit({notes:e.target.value})}/></Field>
        {fieldIssue('notes')?<p id={issueId} role="alert" className="usage-entry-error">{issue?.message}</p>:null}
        {!readonly?<div className="kitchen-entry-footer"><span className="text-xs text-muted">{t('Recorded By','Direkod Oleh')}<strong className="block text-sm text-ink">{profile?.full_name}</strong></span><button type="button" className={buttonClass} disabled={!!loadError} onClick={review}>{t('Review Stock Out','Semak Stok Keluar')}</button></div>:null}
      </fieldset>
    </>}
    {visible&&pending?<Modal title={t('Confirm Daily Stock Out','Sahkan Stok Keluar Harian')} onClose={closeReview} footer={<div className="grid gap-3">{error?<p role="alert" className="text-sm text-danger">{error}</p>:null}{pending.attempted?<p role="status" className="text-sm">{t('Confirmation pending. Check this same submission before starting another.','Pengesahan belum selesai. Semak penghantaran yang sama sebelum memulakan yang lain.')}</p>:null}<label className="flex items-start gap-2 text-sm"><input type="checkbox" className="h-5 w-5 shrink-0" checked={checked} onChange={e=>setChecked(e.target.checked)} disabled={busy}/>{t('I checked both meal counts and the total ingredients used.','Saya telah menyemak bilangan hidangan dan jumlah bahan digunakan.')}</label><div className="flex justify-end gap-2"><button className={secondaryButtonClass} disabled={busy||pending.attempted} onClick={closeReview}>{t('Back','Kembali')}</button><button className={buttonClass} disabled={busy||!checked||changedElsewhere||!dayLoaded} onClick={()=>void confirm()}>{busy?t('Saving...','Menyimpan...'):pending.attempted?t('Check Confirmation','Semak Pengesahan'):t('Confirm Stock Out','Sahkan Stok Keluar')}</button></div></div>}>
      {changedElsewhere?<p role="alert" className="usage-draft-warning">{t('This usage changed in another tab.','Penggunaan berubah di tab lain.')} <button type="button" className="underline font-semibold" disabled={busy} onClick={reloadDay}>{t('Reload Day','Muat Semula Hari')}</button></p>:null}
      <p className="font-semibold">{pending.record.business_date}</p><p className="my-2 text-sm">{pending.record.guest_meals} {t('Guest Meals','Hidangan Tetamu')} · {pending.record.staff_meals} {t('Staff Meals','Hidangan Staf')}</p>
      <div className="supply-usage-grid supply-usage-labels"><span>{t('Ingredient','Bahan')}</span><span>{t('Guests','Tetamu')}</span><span>{t('Staff','Staf')}</span></div>{pending.record.lines.map(l=><div key={l.ingredient_id} className="supply-usage-grid text-sm usage-confirmation-row"><span className="break-words">{l.name}</span><strong>{l.display_factor?(l.guest_quantity/l.display_factor).toLocaleString('en-MY',{maximumFractionDigits:6}):countDisplay(l.guest_quantity,l.unit)} {l.display_unit||countUnit(l.unit)}</strong><strong>{l.display_factor?(l.staff_quantity/l.display_factor).toLocaleString('en-MY',{maximumFractionDigits:6}):countDisplay(l.staff_quantity,l.unit)} {l.display_unit||countUnit(l.unit)}</strong></div>)}
      <p className="mt-3 text-xs text-muted">{pending.expected?t('Replaces this day’s previous usage. Only the difference changes stock.','Menggantikan penggunaan hari ini. Hanya perbezaan mengubah stok.'):t('Deducts once from the shared kitchen stock.','Ditolak sekali daripada stok dapur bersama.')}</p>
    </Modal>:null}
    {visible&&discardOpen?<Modal title={t('Discard Usage Draft?','Buang Draf Penggunaan?')} onClose={()=>setDiscardOpen(false)} footer={<div className="flex justify-end gap-2"><button className={secondaryButtonClass} onClick={()=>setDiscardOpen(false)}>{t('Keep Draft','Simpan Draf')}</button><button className={buttonClass} onClick={discardDraft}>{t('Discard Draft','Buang Draf')}</button></div>}><p className="text-sm">{t('Only this device’s unfinished entries for this date will be removed. Confirmed usage and stock balances stay unchanged.','Hanya catatan belum disahkan pada peranti ini bagi tarikh ini akan dibuang. Penggunaan disahkan dan baki stok tidak berubah.')}</p></Modal>:null}
    {visible&&templateOpen?<TemplateManager templates={templates} items={active} onClose={()=>setTemplateOpen(false)} onSaved={loadTemplates}/>:null}
  </section>;
}

function TemplateManager({templates,items,onClose,onSaved}:{templates:MealTemplate[];items:CountItem[];onClose:()=>void;onSaved:()=>Promise<void>}) {
  const {text:t}=useLanguage();const [id,setId]=useState(''),[name,setName]=useState(''),[ids,setIds]=useState<string[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function save(){setBusy(true);setError('');try{const r=await supabase.rpc('save_kitchen_template',{p_template:{id:id||null,name,ingredient_ids:ids},p_expected_updated_at:templates.find(v=>v.id===id)?.updated_at??null});if(r.error)throw r.error;await onSaved();onClose();}catch(e){setError(readErrorMessage(e,'Template was not saved.'));}finally{setBusy(false);}}
  return <Modal title={t('Ingredient Templates','Templat Bahan')} onClose={onClose} footer={<button className={buttonClass} disabled={busy||!name.trim()||!ids.length} onClick={()=>void save()}>{t('Save Template','Simpan Templat')}</button>}>
    <div className="supply-template-options">{templates.map(v=><button key={v.id} aria-pressed={id===v.id} onClick={()=>{setId(v.id);setName(v.name);setIds(v.ingredient_ids);}}>{v.name}</button>)}<button onClick={()=>{setId('');setName('');setIds([]);}}><Plus size={16}/>{t('New','Baru')}</button></div>
    <Field label={t('Template Name','Nama Templat')}><input className={inputClass} maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></Field>
    <ul className="mt-3 divide-y divide-line">{items.map(i=><li key={i.id}><label className="flex min-h-11 items-center gap-3 text-sm"><input className="h-5 w-5" type="checkbox" checked={ids.includes(i.id)} onChange={e=>setIds(old=>e.target.checked?[...old,i.id]:old.filter(x=>x!==i.id))}/><span>{kitchenName(i)}</span><span className="ml-auto text-xs text-muted">{kitchenUnit(i)}</span></label></li>)}</ul>
    {error?<p role="alert" className="mt-3 text-sm text-danger">{error}</p>:null}
  </Modal>;
}
