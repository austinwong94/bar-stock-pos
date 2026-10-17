import { Fragment, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Check, ClipboardCheck, History, Pencil, RotateCcw, Search, Trash2 } from 'lucide-react';
import { Field, buttonClass, iconButtonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { ViewChoices } from '../../components/ViewChoices';
import { useAccess } from '../../lib/access';
import { useLanguage } from '../../lib/language';
import { isDemoMode, supabase } from '../../lib/supabase';
import { definitiveInitialSaveFailure } from '../../lib/saveAttempt';
import { readErrorMessage } from '../../lib/opsData';
import { countBalance, countChanged, countDisplay, countUnit, readCountAttempt, storeCountAttempt, type CountAttempt, type CountItem } from '../../lib/stockCount';
import { readCountDraft, writeCountDraft, type CountEntry as Entry } from '../../lib/stockCountDraft';
import { packedCount } from '../../lib/kitchenUsage';

import { kitchenName, kitchenUnit, kitchenFactor, kitchenValue, kitchenQuantity, kitchenMatches, kitchenGroupEnglish, type KitchenGroup } from '../../lib/kitchenCatalogue';

import { MeasureChoices } from '../../components/MeasureChoices';
import { entryQuantity, entryDisplay, changeMeasure, measureOptions, validMeasure, measuredPackedCount } from '../../lib/kitchenMeasure';
import { preferredMeasure } from '../../lib/kitchenQuickEntry';
import { useKitchenMeasurePreference } from '../../lib/useKitchenMeasurePreference';

export default function KitchenStockCount({ items, loadError, onSaved, onEdit, onHistory, active = true }: { items: CountItem[]; loadError: string; onSaved: () => Promise<void>; onEdit: () => void; onHistory: () => void; active?: boolean }) {
  const { text: t } = useLanguage(); const { profile } = useAccess();
  const unitMemory=useKitchenMeasurePreference('count');
  const prefix = `kitchen-count:${import.meta.env.VITE_SUPABASE_URL ?? 'preview'}:${profile?.id}`;
  const draftKey = prefix + ':draft';
  const [recovery] = useState(() => { try { const raw=localStorage.getItem(draftKey);return { attempt: readCountAttempt(localStorage,prefix), draft:readCountDraft(raw),raw,error: '' }; } catch(e) { return { attempt: null,draft:null,raw:null,error: readErrorMessage(e,'Unable to read the pending count.') }; } });
  const draftRaw=useRef(recovery.raw);
  const [entries,setEntries] = useState<Record<string,Entry>>(recovery.draft?.entries??{});
  const [search,setSearch] = useState(''), [notes,setNotes] = useState(recovery.draft?.notes??'');
  const [showExpected,setShowExpected]=useState(false),[packMode,setPackMode]=useState(recovery.draft?.packMode??false);
  const [filter,setFilter]=useState('all'),[editingId,setEditingId]=useState<string|null>(null),[differencesOnly,setDifferencesOnly]=useState(false);
  const [draftError,setDraftError]=useState(''),[otherTab,setOtherTab]=useState(false),[discard,setDiscard]=useState(false);
  const [attempt,setAttempt] = useState<CountAttempt|null>(recovery.attempt);
  const [checked,setChecked] = useState(false), [busy,setBusy] = useState(false), [uncertain,setUncertain] = useState(!!recovery.attempt?.attempted);
  const [error,setError] = useState(recovery.error), [notice,setNotice] = useState('');
  const lock = useRef(false);
  const section = useRef<HTMLElement>(null);
  const selected = Object.values(entries).filter(e=>e.input.trim());
  const lines = selected.map(e=>({...e.snapshot,...(e.measure?{display_unit:e.measure,display_factor:['kg','L'].includes(e.measure)?1000:1}:{}),counted_quantity:entryQuantity(e.input,{base_unit:e.snapshot.expected_base_unit,kitchen_key:'snapshot',kitchen_unit:e.snapshot.display_unit,kitchen_factor:e.snapshot.display_factor??(e.snapshot.expected_base_unit==='g'?1000:1)} as CountItem,e.measure) ?? NaN}));
  const changed = lines.filter(l=>countChanged(l,items.find(i=>i.id===l.ingredient_id)) || (entries[l.ingredient_id]?.packSize!=null && entries[l.ingredient_id].packSize!==Number(items.find(i=>i.id===l.ingredient_id)?.default_pack_size)));
  const invalid = lines.some(l=>!Number.isFinite(l.counted_quantity));
  const ready = items.every(i=>'balance_version' in i);
  const activeItems=items.filter(i=>i.active);
  const unavailable=Object.entries(entries).filter(([id,e])=>e.input.trim()&&!activeItems.some(i=>i.id===id));
  const enteredCount=activeItems.filter(i=>entries[i.id]?.input.trim()).length;
  const validCount=lines.length-lines.filter(l=>!Number.isFinite(l.counted_quantity)||changed.includes(l)).length;
  const visible = activeItems.filter(i=>kitchenMatches(i,search)&&(filter==='all'||i.id===editingId||(filter==='entered'?!!entries[i.id]?.input.trim():!entries[i.id]?.input.trim())));
  const blocked=!!attempt||!!recovery.error||otherTab;
  const differenceLines=attempt?.lines.filter(l=>Math.round((l.counted_quantity-l.expected_balance)*100)!==0)??[];
  const shortCount=differenceLines.filter(l=>l.counted_quantity<l.expected_balance).length;
  const extraCount=differenceLines.length-shortCount;
  const reviewLines=attempt?(differencesOnly?differenceLines:attempt.lines):[];

  useEffect(()=>{
    const sync=(event:StorageEvent)=>{if(event.storageArea===localStorage&&(event.key===draftKey||event.key?.startsWith(prefix+'/'))){setOtherTab(true);setChecked(false);}};
    window.addEventListener('storage',sync);
    return()=>window.removeEventListener('storage',sync);
  },[draftKey,prefix]);

  function saveDraft(nextEntries:Record<string,Entry>,nextNotes=notes,nextPackMode=packMode) {
    try {
      const hasDraft=Object.keys(nextEntries).length>0||nextNotes.trim();
      draftRaw.current=writeCountDraft(localStorage,draftKey,hasDraft?{entries:nextEntries,notes:nextNotes,packMode:nextPackMode,updatedAt:new Date().toISOString()}:null,draftRaw.current);
      setDraftError('');return true;
    }catch(e){setDraftError(readErrorMessage(e,'Draft not saved on this device.'));return false;}
  }
  function updateEntries(next:Record<string,Entry>) {setEntries(next);return saveDraft(next);}
  function clearEntry(id:string) {const next={...entries};delete next[id];return updateEntries(next);}
  function removeUnavailable(id:string) {if(blocked)return;const next={...entries};delete next[id];if(saveDraft(next))setEntries(next);}
  function countFields() {
    return Array.from(section.current?.querySelectorAll<HTMLInputElement>('input[data-count-item]:not(:disabled)') ?? []);
  }
  function focusCount(id:string) {
    const input=countFields().find(field=>field.dataset.countItem===id);
    input?.focus({preventScroll:true});input?.select();input?.scrollIntoView({block:'center'});
  }
  function nextField(input:HTMLInputElement) {
    const fields=countFields(),next=fields[fields.indexOf(input)+1];
    if(next){next.focus({preventScroll:true});next.select();next.scrollIntoView({block:'center'});}
    else input.blur();
  }
  function recount(id:string) {
    flushSync(()=>{clearEntry(id);setEditingId(id);});
    focusCount(id);
  }
  function discardDraft() {
    if(!saveDraft({},'',false))return;
    setEntries({});setNotes('');setPackMode(false);setFilter('all');setDiscard(false);setNotice('');
  }

  function edit(item: CountItem, input: string, measure?:string) {
    setNotice('');
    if(!input.trim()&&(!measure||!kitchenFactor(item)||!validMeasure(measure,item.base_unit)))return clearEntry(item.id);
    return updateEntries({...entries,[item.id]:{input,measure,snapshot:input.trim()&&entries[item.id]?.snapshot ? entries[item.id].snapshot : {ingredient_id:item.id,name:kitchenName(item),display_unit:kitchenUnit(item),display_factor:kitchenFactor(item),expected_item_version:item.updated_at,expected_base_unit:item.base_unit,expected_balance:countBalance(item),expected_version:item.balance_version,counted_quantity:0}}});
  }
  function editPacks(item:CountItem,packs:string,loose:string,looseMeasure=entries[item.id]?.looseMeasure) {
    const amount=looseMeasure?measuredPackedCount(packs,loose,Number(item.default_pack_size),item,looseMeasure):packedCount(packs,loose,Number(item.default_pack_size),item.base_unit);
    const input=amount===null?(packs.trim()||loose.trim()?'invalid':''):String(item.base_unit==='unit'?amount/kitchenFactor(item):amount);
    setNotice('');if(!input){clearEntry(item.id);return;}
    updateEntries({...entries,[item.id]:{input,measure:item.base_unit==='unit'?undefined:item.base_unit,packs,loose,looseMeasure,packSize:Number(item.default_pack_size),snapshot:entries[item.id]?.snapshot??{ingredient_id:item.id,name:kitchenName(item),display_unit:kitchenUnit(item),display_factor:kitchenFactor(item),expected_item_version:item.updated_at,expected_base_unit:item.base_unit,expected_balance:countBalance(item),expected_version:item.balance_version,counted_quantity:0}}});
  }
  function review() {
    if (!lines.length || invalid || changed.length || loadError || !ready || blocked || !saveDraft(entries)) return;
    const next:CountAttempt={id:crypto.randomUUID(),lines,notes:notes.trim(),attempted:false,createdAt:new Date().toISOString()};
    try { storeCountAttempt(localStorage,prefix,next); setAttempt(next);setDifferencesOnly(next.lines.some(l=>Math.round((l.counted_quantity-l.expected_balance)*100)!==0));setChecked(false);setUncertain(false);setError(''); }
    catch(e){setError(readErrorMessage(e,'Unable to prepare the count.'));}
  }
  function backToCount(itemId?:string) {
    if(!attempt || busy || uncertain || otherTab)return;
    const restored=Object.fromEntries(attempt.lines.map(line=>[line.ingredient_id,{input:String(line.counted_quantity/(line.display_factor??(line.expected_base_unit==='g'?1000:1))),measure:line.expected_base_unit!=='unit'&&['kg','g','L','ml'].includes(line.display_unit??'')?line.display_unit:undefined,snapshot:{...line,display_unit:items.find(i=>i.id===line.ingredient_id)?kitchenUnit(items.find(i=>i.id===line.ingredient_id)!):line.display_unit,display_factor:items.find(i=>i.id===line.ingredient_id)?kitchenFactor(items.find(i=>i.id===line.ingredient_id)!):line.display_factor}}]));
    if(!saveDraft(restored,attempt.notes,false))return;
    try { localStorage.removeItem(prefix+'/'+attempt.id); }
    catch(e) { setError(readErrorMessage(e,'Unable to reopen the count.')); return; }
    // Finish closing the dialog before focusing, while still in the tap event for phone keyboards.
    flushSync(()=>{
      setEntries(restored);setPackMode(false);setNotes(attempt.notes);setAttempt(null);setError('');setChecked(false);
      if(itemId){setFilter('entered');setSearch('');setEditingId(itemId);}
      onEdit();
    });
    if(itemId)focusCount(itemId);
  }
  async function confirm() {
    if(!attempt || !checked || lock.current || otherTab)return;
    lock.current=true;setBusy(true);setError('');
    const wasAttempted=attempt.attempted;
    let saved=false,submitted=false;
    try {
      const pending={...attempt,attempted:true};storeCountAttempt(localStorage,prefix,pending);setAttempt(pending);setUncertain(true);
      submitted=true;
      const result=await supabase.rpc('record_kitchen_stock_count',{p_items:pending.lines.map(({name,...line})=>line),p_notes:pending.notes,p_request_id:pending.id});
      if(result.error)throw result.error;
      if(result.data!==pending.id)throw new Error('The count confirmation was incomplete.');
      saved=true;draftRaw.current=writeCountDraft(localStorage,draftKey,null,draftRaw.current);localStorage.removeItem(prefix+'/'+pending.id);
      const next=readCountAttempt(localStorage,prefix);
      setAttempt(next);setEntries({});setNotes('');setChecked(false);setUncertain(!!next?.attempted);
      setFilter('all');setDraftError('');
      setNotice((isDemoMode?t('Count Confirmed in Preview','Kiraan Disahkan dalam Pratonton'):t('Stock Count Confirmed','Kiraan Stok Disahkan'))+' · '+pending.lines.length+' '+t('items','item')+' · '+pending.id.slice(0,8));
      await onSaved();
    } catch(e) {
      const definite=!saved && (!submitted&&!wasAttempted||definitiveInitialSaveFailure(wasAttempted,e));
      if(definite){
        try {const editable={...attempt,attempted:false};storeCountAttempt(localStorage,prefix,editable);setAttempt(editable);}
        catch {setError(t('Device storage is unavailable. Keep this confirmation open.','Storan peranti tidak tersedia. Kekalkan pengesahan ini.'));return;}
      }
      setUncertain(!definite);
      setError(definite?readErrorMessage(e,'The count was not saved.'):t('Confirmation pending. Check this same count again before starting another.','Menunggu pengesahan. Semak kiraan yang sama sebelum memulakan kiraan lain.'));
    } finally {lock.current=false;setBusy(false);}
  }

  return <section ref={section} aria-label={t('Count Food Stock','Kira Stok Makanan')} onKeyDown={event=>{
    if(event.key==='Enter'&&!event.nativeEvent.isComposing&&event.target instanceof HTMLInputElement&&event.target.dataset.countItem){event.preventDefault();nextField(event.target);}
  }}>
    <div className="count-session-heading"><div className="min-w-0"><p className="break-words text-sm"><span className="text-muted">{t('Counted By','Dikira Oleh')}: </span><strong>{profile?.full_name}</strong></p><p role="status" className="mt-1 text-xs text-muted">{draftRaw.current?t('Draft on This Device · Not Submitted','Draf pada Peranti Ini · Belum Dihantar'):t('No Count Started','Kiraan Belum Dimulakan')}</p></div><strong className="shrink-0 text-sm tabular">{validCount} / {activeItems.length}</strong>{Object.keys(entries).length||notes?<button className={iconButtonClass} disabled={blocked} title={t('Discard Count Draft','Buang Draf Kiraan')} aria-label={t('Discard Count Draft','Buang Draf Kiraan')} onClick={()=>setDiscard(true)}><Trash2 size={16}/></button>:null}</div>
    {notice?<div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm font-semibold text-accent"><p>{notice}</p><button className={secondaryButtonClass} onClick={onHistory}><History size={16}/>{t('View Count History','Lihat Sejarah Kiraan')}</button></div>:null}
    {otherTab?<p role="alert" className="mb-3 text-sm text-danger">{t('This count changed in another tab.','Kiraan ini berubah di tab lain.')} <button className="underline" onClick={()=>window.location.reload()}>{t('Reload Count','Muat Semula Kiraan')}</button></p>:null}
    {draftError?<p role="alert" className="mb-3 text-sm text-danger">{draftError} <button className="underline" disabled={otherTab} onClick={()=>saveDraft(entries)}>{t('Retry Draft Save','Cuba Simpan Draf Lagi')}</button></p>:null}
    {!ready?<p role="alert" className="mb-3 text-sm text-danger">{t('Stock counting needs the latest database update. Other food stock tools are unchanged.','Kiraan stok memerlukan kemas kini pangkalan data terkini.')}</p>:null}
    {!attempt && error?<p role="alert" className="mb-3 text-sm text-danger">{error}</p>:null}
    {unitMemory.failed&&!attempt?<p role="status" className="mb-3 text-xs text-muted">{t('Unit memory unavailable. Recording drafts are kept separately.','Ingatan unit tidak tersedia. Draf rekod disimpan berasingan.')}</p>:null}
    {unavailable.map(([id,e])=><div key={id} role="alert" className="count-unavailable"><div><strong>{e.snapshot.name}</strong><span>{t('Not in the Active Item List','Tiada dalam Senarai Item Aktif')} · {e.input} {e.measure??e.snapshot.display_unit??countUnit(e.snapshot.expected_base_unit)}</span></div><button type="button" className={secondaryButtonClass} disabled={blocked} aria-label={t('Remove Count Entry: ','Buang Catatan Kiraan: ')+e.snapshot.name} onClick={()=>removeUnavailable(id)}>{t('Remove Entry','Buang Catatan')}</button></div>)}
    <label className="relative mb-3 block"><Search className="absolute left-3 top-3.5 h-4 w-4 text-muted"/><input aria-label={t('Find Item to Count','Cari Item untuk Dikira')} type="search" className={inputClass+' pl-9'} value={search} onChange={e=>{setSearch(e.target.value);if(e.target.value.trim()){setFilter('all');setEditingId(null);}}} placeholder={t('Find Food Item','Cari Item Makanan')}/></label>
    <ViewChoices label={t('Count Progress','Kemajuan Kiraan')} value={filter} className="count-progress-tabs" onChange={value=>{setFilter(value);setSearch('');setEditingId(null);}} items={[{value:'all',label:t('All','Semua')+' '+activeItems.length},{value:'remaining',label:t('To Count','Belum Dikira')+' '+(activeItems.length-enteredCount)},{value:'entered',label:t('Entered','Diisi')+' '+enteredCount}]}/>
    <div className="mb-3 flex flex-wrap items-center gap-2"><button aria-pressed={!packMode} className={packMode?secondaryButtonClass:buttonClass} disabled={blocked} onClick={()=>{setPackMode(false);saveDraft(entries,notes,false);}}>{t('Quantity','Kuantiti')}</button><button aria-pressed={packMode} className={packMode?buttonClass:secondaryButtonClass} disabled={blocked} onClick={()=>{setPackMode(true);saveDraft(entries,notes,true);}}>{t('Packs + Loose','Pek + Baki')}</button><label className="ml-auto flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" checked={showExpected} onChange={e=>setShowExpected(e.target.checked)}/>{t('Show Expected','Tunjuk Jangkaan')}</label></div>
    <div className="stock-count-columns border-b border-line pb-2 text-xs font-semibold text-muted"><span>{t('Item','Item')}</span><span>{t('Actual Count','Kiraan Sebenar')}</span><span/></div>
    <ul className="divide-y divide-line">{visible.map((item,index)=>{
      const entry=entries[item.id],measure=entry?entry.measure:preferredMeasure(item,unitMemory.choices), quantity=entryQuantity(entry?.input??'',item,measure), stale=!!entry && !!entry.input.trim() && (countChanged(entry.snapshot,item)||(entry.packSize!=null&&entry.packSize!==Number(item.default_pack_size)));
      const delta=quantity===null?null:Math.round((quantity-(entry?.snapshot.expected_balance??countBalance(item)))*100)/100;
      const looseInput=entry?.loose??(quantity===null?'':String(quantity/(item.base_unit==='g'?1000:1)));
      const canPack=packMode&&!!kitchenFactor(item)&&Number(item.default_pack_size)>1&&!!item.pack_label;
      return <Fragment key={item.id}>{index===0||item.kitchen_group!==visible[index-1]?.kitchen_group?<li className="kitchen-category-heading">{t(kitchenGroupEnglish[item.kitchen_group as KitchenGroup]??'Other Items',item.kitchen_group??'Item Lain')}</li>:null}<li className={'stock-count-columns py-2 '+(measureOptions(item).length?'has-measure':'')} onFocus={()=>setEditingId(item.id)} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setEditingId(null);}}>
        <div className="min-w-0"><p className="break-words text-sm font-semibold">{kitchenName(item)}</p>{!kitchenFactor(item)?<p className="text-xs text-warning">{t('Unit Setup Needed','Tetapan Unit Diperlukan')}</p>:null}{showExpected?<p className="text-xs text-muted">{t('Expected','Dijangka')}: {entryDisplay(entry?.snapshot.expected_balance??countBalance(item),item,measure)} {measure??kitchenUnit(item)}</p>:null}
        {stale?<p role="alert" className="text-xs font-semibold text-danger">{t('Stock changed. Recount.','Stok berubah. Kira semula.')}</p>:delta!==null&&showExpected?<p className={'text-xs '+(delta<0?'text-danger':delta>0?'text-warning':'text-palm')}>{delta===0?t('Matches','Sepadan'):`${delta>0?'+':''}${entryDisplay(delta,item,entry?.measure)} ${entry?.measure??kitchenUnit(item)} ${t('difference','perbezaan')}`}</p>:entry?.input.trim()&&quantity===null?<p className="text-xs text-danger">{t('Check Quantity','Semak Kuantiti')}</p>:null}</div>
        {canPack?<span className="text-right text-sm tabular">{quantity===null?'':kitchenValue(quantity,item)+' '+kitchenUnit(item)}</span>:<div className="min-w-0"><input data-count-item={item.id} enterKeyHint="next" aria-label={`${t('Actual Count','Kiraan Sebenar')} ${kitchenName(item)} (${measure??kitchenUnit(item)})`} aria-invalid={!!entry?.input.trim()&&(quantity===null||stale)} disabled={!ready||blocked||!kitchenFactor(item)} className={inputClass+' text-right tabular'} inputMode={['biji','ekor','pcs','botol'].includes(kitchenUnit(item))?'numeric':'decimal'} maxLength={60} placeholder="" value={entry?.input??''} onChange={e=>edit(item,e.target.value,measure)}/>{!measureOptions(item).length?<span className="text-xs text-muted">{kitchenUnit(item)}</span>:null}<MeasureChoices label={kitchenName(item)+' '+t('Count Unit','Unit Kiraan')} options={measureOptions(item)} value={measure??kitchenUnit(item)} disabled={!ready||blocked||!kitchenFactor(item)} onChange={unit=>{const result=changeMeasure(entry?.input??'',item,measure,unit);if(result){if(edit(item,result.value,result.measure))unitMemory.remember(item,unit);}else setError(t('Check this amount before changing units.','Semak jumlah ini sebelum menukar unit.'));}}/></div>}
        <button type="button" className={iconButtonClass} disabled={!entry||blocked} aria-label={`${t('Recount','Kira Semula')} ${kitchenName(item)}`} title={t('Clear and Recount','Kosongkan dan Kira Semula')} onClick={()=>recount(item.id)}><RotateCcw size={16}/></button>
        {canPack?<div className="kitchen-pack-fields"><Field label={`${item.pack_label} (${countDisplay(Number(item.default_pack_size),item.base_unit)} ${countUnit(item.base_unit)})`}><input data-count-item={item.id} enterKeyHint="next" aria-label={`${t('Sealed Packs','Pek Penuh')} ${kitchenName(item)}`} className={inputClass} inputMode="numeric" maxLength={60} disabled={!ready||blocked} value={entry?.packs??''} onChange={e=>editPacks(item,e.target.value,looseInput)}/></Field><Field label={`${t('Loose','Baki Terbuka')} (${entry?.looseMeasure??countUnit(item.base_unit)})`}><input data-count-item={item.id} enterKeyHint="next" aria-label={`${t('Loose','Baki Terbuka')} ${kitchenName(item)}`} className={inputClass} inputMode="decimal" maxLength={60} disabled={!ready||blocked} value={looseInput} onChange={e=>editPacks(item,entry?.packs??'',e.target.value)}/></Field>{item.base_unit!=='unit'?<MeasureChoices label={kitchenName(item)+' '+t('Loose Unit','Unit Baki')} options={item.base_unit==='g'?['kg','g']:['L','ml']} value={entry?.looseMeasure??countUnit(item.base_unit)} disabled={!ready||blocked} onChange={unit=>{const looseItem={...item,kitchen_unit:countUnit(item.base_unit),kitchen_factor:item.base_unit==='g'?1000:1};const result=changeMeasure(looseInput,looseItem,entry?.looseMeasure,unit);if(result)editPacks(item,entry?.packs??'',result.value,result.measure);else setError(t('Check the loose amount before changing units.','Semak baki sebelum menukar unit.'));}}/>:null}</div>:null}
      </li></Fragment>;
    })}</ul>
    {!visible.length?<p className="py-4 text-sm text-muted">{search.trim()?t('No Matching Items','Tiada Item Sepadan'):filter==='entered'?t('No Active Counts Entered Yet','Belum Ada Kiraan Item Aktif Diisi'):filter==='remaining'&&activeItems.length?t('Every Active Item Has an Entry','Semua Item Aktif Ada Catatan'):t('No Active Items Available','Tiada Item Aktif Tersedia')}</p>:null}
    <div className="mt-3"><Field label={t('Count Notes (Optional)','Nota Kiraan (Pilihan)')}><textarea aria-label={t('Count Notes (Optional)','Nota Kiraan (Pilihan)')} className={inputClass} rows={2} maxLength={2000} value={notes} onChange={e=>{setNotes(e.target.value);saveDraft(entries,e.target.value);}} disabled={blocked} /></Field></div>
    <div className="kitchen-entry-footer"><div className="min-w-0 text-sm"><span>{validCount} {t('Items Counted','Item Dikira')}</span>{changed.length||invalid?<button className="block text-left text-xs text-danger underline" onClick={()=>{setFilter('entered');setSearch('');if(unavailable.length)section.current?.querySelector('.count-unavailable')?.scrollIntoView({block:'center'});}}>{unavailable.length?t('Check Inactive Entries','Semak Catatan Tidak Aktif'):changed.length?t('Stock Changed · Recount','Stok Berubah · Kira Semula'):t('Check Invalid Quantities','Semak Kuantiti Tidak Sah')}</button>:null}</div><button className={buttonClass} disabled={!lines.length||invalid||!!changed.length||!!loadError||!ready||blocked||!!draftError} onClick={review}><ClipboardCheck size={16}/>{t('Review Count','Semak Kiraan')}</button></div>
    {attempt&&active?<Modal title={t('Confirm Stock Count','Sahkan Kiraan Stok')} panelClassName={attempt.lines.length>8?'stock-count-review-dialog':''} onClose={()=>backToCount()} footer={<div className="grid gap-3">
      {error?<p role="alert" className="text-sm text-danger">{error}</p>:null}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="h-5 w-5 shrink-0" checked={checked} disabled={busy} onChange={e=>setChecked(e.target.checked)}/>{t('I physically counted these items and checked the differences.','Saya telah mengira item ini dan menyemak perbezaan.')}</label>
      {otherTab?<p role="alert" className="text-sm text-danger">{t('This count changed in another tab. Reload before confirming.','Kiraan ini berubah di tab lain. Muat semula sebelum mengesahkan.')} <button className="underline" onClick={()=>window.location.reload()}>{t('Reload Count','Muat Semula Kiraan')}</button></p>:null}
      <div className="grid grid-cols-2 gap-2"><button className={secondaryButtonClass} disabled={busy||uncertain||otherTab} onClick={()=>backToCount()}>{t('Back to Count','Kembali ke Kiraan')}</button><button className={buttonClass} disabled={busy||!checked||otherTab} onClick={()=>void confirm()}><Check size={16}/>{busy?t('Saving...','Menyimpan...'):uncertain?t('Check Confirmation','Semak Pengesahan'):t('Confirm Count','Sahkan Kiraan')}</button></div>
    </div>}>
      <p className="mb-3 text-sm text-muted">{attempt.lines.length} {t('Items','Item')} · {profile?.full_name}</p>
      <dl className="count-review-summary"><div><dt>{t('Short Items','Item Kurang')}</dt><dd className="text-danger">{shortCount}</dd></div><div><dt>{t('Extra Items','Item Lebih')}</dt><dd className="text-warning">{extraCount}</dd></div><div><dt>{t('Matched Items','Item Sepadan')}</dt><dd className="text-palm">{attempt.lines.length-differenceLines.length}</dd></div></dl>
      <ViewChoices label={t('Count Review','Semakan Kiraan')} value={differencesOnly?'differences':'all'} onChange={v=>setDifferencesOnly(v==='differences')} className="count-review-tabs" items={[{value:'differences',label:t('Differences','Perbezaan')+' '+differenceLines.length},{value:'all',label:t('All Items','Semua Item')+' '+attempt.lines.length}]}/>
      <div className="count-review-columns border-b border-line py-2 text-xs text-muted"><span>{t('Item','Item')}</span><span>{t('Expected','Dijangka')}</span><span>{t('Counted','Dikira')}</span><span>{t('Change','Beza')}</span></div>
      <ul className="divide-y divide-line">{reviewLines.map(line=>{
        const factor=line.display_factor??(line.expected_base_unit==='g'?1000:1);
        const amount=(n:number)=>(n/factor).toLocaleString('en-MY',{maximumFractionDigits:6});
        const delta=Math.round((line.counted_quantity-line.expected_balance)*100)/100;
        return <li key={line.ingredient_id} className="count-review-columns py-2 text-sm tabular"><div><button type="button" className="count-review-edit" disabled={busy||uncertain||otherTab} aria-label={t('Edit Count: ','Ubah Kiraan: ')+line.name} title={t('Edit Count','Ubah Kiraan')} onClick={()=>backToCount(line.ingredient_id)}><Pencil size={14}/><span><strong>{line.name}</strong><small>{line.display_unit??countUnit(line.expected_base_unit)}</small></span></button></div><span>{amount(line.expected_balance)}</span><strong>{amount(line.counted_quantity)}</strong><strong className={delta<0?'text-danger':delta>0?'text-warning':'text-palm'}>{delta>0?'+':''}{amount(delta)}</strong></li>;
      })}</ul>
      {!reviewLines.length?<p className="py-4 text-center text-sm text-muted">{t('All Entered Counts Match','Semua Kiraan Diisi Sepadan')}</p>:null}
      <p className="mt-3 text-xs text-muted">{t('Uncounted items stay unchanged.','Item belum dikira kekal tanpa perubahan.')}</p>
      {attempt.notes?<p className="mt-3 break-words text-sm">{attempt.notes}</p>:null}
    </Modal>:null}
    {discard&&active?<Modal title={t('Discard Count Draft?','Buang Draf Kiraan?')} onClose={()=>setDiscard(false)} footer={<div className="flex justify-end gap-2"><button className={secondaryButtonClass} onClick={()=>setDiscard(false)}>{t('Keep Counting','Teruskan Kiraan')}</button><button className={buttonClass} onClick={discardDraft}><Trash2 size={16}/>{t('Discard Draft','Buang Draf')}</button></div>}><p className="text-sm">{t('Only this device’s unfinished count will be removed. Stock balances and confirmed records will not change.','Hanya draf kiraan pada peranti ini akan dibuang. Baki stok dan rekod disahkan tidak berubah.')}</p></Modal>:null}
  </section>;
}
