import { useEffect, useRef, useState } from 'react';
import { Check, ClipboardCheck, RotateCcw, Search, Trash2 } from 'lucide-react';
import { Field, buttonClass, iconButtonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { useAccess } from '../../lib/access';
import { useLanguage } from '../../lib/language';
import { supabase } from '../../lib/supabase';
import { readErrorMessage } from '../../lib/opsData';
import { countBalance, countDisplay, countUnit, type CountItem } from '../../lib/stockCount';
import { readStockOutAttempt, stockOutArgs, stockFailureIsDefinite, stockOutChanged, stockOutQuantity, stockOutReasons, storeStockOutAttempt, submitStockOut, type StockOutAttempt, type StockOutLine } from '../../lib/stockOut';
import { readStockOutDraft, writeStockOutDraft, type StockOutEntry as Entry } from '../../lib/stockOutDraft';

import { kitchenName, kitchenUnit, kitchenFactor, kitchenValue, kitchenMatches, kitchenOrdered, kitchenQuantity } from '../../lib/kitchenCatalogue';
import { MeasureChoices } from '../../components/MeasureChoices';
import { entryQuantity as measuredQuantity, entryDisplay, changeMeasure, measureOptions, validMeasure } from '../../lib/kitchenMeasure';
const lineDisplay=(n:number,l:StockOutLine)=>l.display_factor?(n/l.display_factor).toLocaleString('en-MY',{maximumFractionDigits:6})+' '+l.display_unit:countDisplay(n,l.expected_base_unit)+' '+countUnit(l.expected_base_unit);
const entryQuantity=(input:string,l:StockOutLine)=>{const q=l.display_factor?kitchenQuantity(input,{name:l.name,base_unit:l.expected_base_unit,kitchen_key:'snapshot',kitchen_factor:l.display_factor} as CountItem):stockOutQuantity(input,l.expected_base_unit);return q!==null&&q>0?q:null;};
export default function KitchenStockOut({items,loadError,onEdit,onSaved,active=true}: {items:CountItem[];loadError:string;onEdit:()=>void;onSaved:()=>Promise<void>;active?:boolean}) {
  const {text:t}=useLanguage(), {profile}=useAccess();
  const prefix=`kitchen-stock-out:${import.meta.env.VITE_SUPABASE_URL??'preview'}:${profile?.id}`;
  const draftKey=prefix+':draft';
  const [recovery]=useState(()=>{try{const raw=localStorage.getItem(draftKey);return {attempt:readStockOutAttempt(localStorage,prefix),draft:readStockOutDraft(raw),raw,error:''};}catch(e){return {attempt:null,draft:null,raw:null,error:readErrorMessage(e,'Unable to read pending stock-out.')};}});
  const draftRaw=useRef(recovery.raw),createdAt=useRef(recovery.draft?.createdAt??recovery.attempt?.createdAt??new Date().toISOString()),section=useRef<HTMLElement>(null);
  const [entries,setEntries]=useState<Record<string,Entry>>(recovery.draft?.entries??{});
  const [search,setSearch]=useState(''),[reason,setReason]=useState(recovery.draft?.reason??''),[notes,setNotes]=useState(recovery.draft?.notes??'');
  const [enteredOnly,setEnteredOnly]=useState(false),[focused,setFocused]=useState<string|null>(null),[otherTab,setOtherTab]=useState(false),[discard,setDiscard]=useState(false),[draftError,setDraftError]=useState(''),[draftTime,setDraftTime]=useState(recovery.draft?.updatedAt??'');
  const [attempt,setAttempt]=useState<StockOutAttempt|null>(recovery.attempt);
  const [checked,setChecked]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(recovery.error);
  const lock=useRef(false);
  const blocked=!!attempt||!!recovery.error||otherTab||busy;
  const lines=Object.values(entries).filter(e=>e.input.trim()).map(e=>({...e.snapshot,...(e.measure?{display_unit:e.measure,display_factor:['kg','L'].includes(e.measure)?1000:1}:{}),quantity:(e.measure?measuredQuantity(e.input,{base_unit:e.snapshot.expected_base_unit} as CountItem,e.measure):entryQuantity(e.input,e.snapshot))??NaN}));
  const ready=items.every(i=>'balance_version' in i);
  const valid=lines.length>0&&lines.length<=200&&lines.every(l=>Number.isFinite(l.quantity)&&l.quantity>0&&l.quantity<=l.expected_balance&&!stockOutChanged(l,items.find(i=>i.id===l.ingredient_id)))&&!!reason&&!!notes.trim()&&ready&&!loadError;
  const visible=kitchenOrdered(items.filter(i=>i.active&&kitchenMatches(i,search)&&(!enteredOnly||entries[i.id]?.input.trim()||focused===i.id)));
  const reasonLabel=(value:string)=>{const pair=stockOutReasons.find(([reason])=>reason===value);return pair?t(pair[0],pair[1]):value;};
  useEffect(()=>{const changed=(e:StorageEvent)=>{if(e.storageArea===localStorage&&(e.key===null||e.key===draftKey||e.key?.startsWith(prefix+'/'))){setOtherTab(true);setChecked(false);}};window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);},[prefix,draftKey]);
  function assertCurrent(){
    const current=readStockOutAttempt(localStorage,prefix);
    if(localStorage.getItem(draftKey)!==draftRaw.current||current?.id!==attempt?.id||(current&&attempt&&(current.attempted!==attempt.attempted||JSON.stringify(stockOutArgs(current))!==JSON.stringify(stockOutArgs(attempt))))){
      setOtherTab(true);setChecked(false);throw Error(t('This waste record changed in another tab. Reload before editing.','Rekod sisa berubah di tab lain. Muat semula sebelum mengedit.'));
    }
  }
  function saveDraft(next:Record<string,Entry>,nextReason=reason,nextNotes=notes){
    try{assertCurrent();const time=new Date().toISOString(),has=Object.keys(next).length||nextReason||nextNotes;
      draftRaw.current=writeStockOutDraft(localStorage,draftKey,has?{version:1,entries:next,reason:nextReason,notes:nextNotes,createdAt:createdAt.current,updatedAt:time}:null,draftRaw.current);
      setDraftTime(has?time:'');setDraftError('');setError('');return true;
    }catch(e){const message=readErrorMessage(e,'Waste draft not saved on this device.');setDraftError(message);setError(message);return false;}
  }
  function updateEntries(next:Record<string,Entry>){if(blocked)return false;setEntries(next);return saveDraft(next);}
  function discardDraft(){if(blocked||!saveDraft({},'',''))return;setEntries({});setReason('');setNotes('');setSearch('');setEnteredOnly(false);setDiscard(false);createdAt.current=new Date().toISOString();}
  function edit(item:CountItem,input:string,measure?:string) {
    const next={...entries};if(!input.trim()&&!measure)delete next[item.id];else next[item.id]={input,measure:input.trim()||validMeasure(measure,item.base_unit)?measure:undefined,snapshot:input.trim()&&entries[item.id]?.snapshot?entries[item.id].snapshot:{ingredient_id:item.id,name:kitchenName(item),display_unit:kitchenUnit(item),display_factor:kitchenFactor(item),expected_item_version:item.updated_at,expected_base_unit:item.base_unit,expected_balance:countBalance(item),expected_version:item.balance_version,quantity:0}};
    updateEntries(next);
  }
  function review() {
    if(!valid||blocked||!saveDraft(entries))return;
    const next:StockOutAttempt={id:crypto.randomUUID(),lines,reason,notes:notes.trim(),attempted:false,createdAt:new Date().toISOString()};
    try {storeStockOutAttempt(localStorage,prefix,next);setAttempt(next);setChecked(false);setError('');}
    catch(e){setError(readErrorMessage(e,'Unable to prepare the stock-out.'));}
  }
  function backToEdit() {
    if(!attempt||busy||attempt.attempted||otherTab)return;
    const restored=Object.fromEntries(attempt.lines.map(line=>[line.ingredient_id,{input:String(line.quantity/(line.display_factor||(line.expected_base_unit==='g'?1000:1))),measure:line.expected_base_unit!=='unit'&&['kg','g','L','ml'].includes(line.display_unit??'')?line.display_unit:undefined,snapshot:{...line,display_unit:items.find(i=>i.id===line.ingredient_id)?kitchenUnit(items.find(i=>i.id===line.ingredient_id)!):line.display_unit,display_factor:items.find(i=>i.id===line.ingredient_id)?kitchenFactor(items.find(i=>i.id===line.ingredient_id)!):line.display_factor}}]));
    if(!saveDraft(restored,attempt.reason,attempt.notes))return;
    try {localStorage.removeItem(prefix+'/'+attempt.id);}
    catch(e){setError(readErrorMessage(e,'Unable to reopen the stock-out.'));return;}
    setEntries(restored);
    setReason(attempt.reason);setNotes(attempt.notes);setAttempt(null);setChecked(false);setError('');onEdit();
  }
  async function confirm() {
    if(!attempt||!checked||lock.current||otherTab||recovery.error)return;
    lock.current=true;setBusy(true);setError('');
    const wasAttempted=attempt.attempted;
    let submitted=false,committed=false;
    try {
      assertCurrent();
      const pending={...attempt,attempted:true};
      storeStockOutAttempt(localStorage,prefix,pending);setAttempt(pending);
      submitted=true;
      await submitStockOut(supabase,pending);
      committed=true;
      draftRaw.current=writeStockOutDraft(localStorage,draftKey,null,draftRaw.current);setDraftTime('');createdAt.current=new Date().toISOString();
      localStorage.removeItem(prefix+'/'+pending.id);
      setAttempt(readStockOutAttempt(localStorage,prefix));setEntries({});setNotes('');setReason('');setChecked(false);setDraftError('');setSearch('');setEnteredOnly(false);
      await onSaved();
    }catch(e){
      if(!submitted){setError(readErrorMessage(e,'The original waste confirmation is kept.'));return;}
      const definite=!committed&&(!submitted&&!wasAttempted||stockFailureIsDefinite(wasAttempted,e));
      if(definite){
        try {const editable={...attempt,attempted:false};storeStockOutAttempt(localStorage,prefix,editable);setAttempt(editable);}
        catch {setError(t('Device storage is unavailable. Keep this confirmation open.','Storan peranti tidak tersedia. Kekalkan pengesahan ini.'));return;}
      }
      const missing=(e as {code?:string})?.code==='PGRST202'||(e as {code?:string})?.code==='42883';
      setError(definite?(missing?t('Stock-out needs the latest database update. No stock was deducted.','Stok keluar memerlukan kemas kini pangkalan data terkini. Tiada stok ditolak.'):readErrorMessage(e,'Stock-out was not saved.')):t('Confirmation pending. Check this same stock-out again before entering it again.','Menunggu pengesahan. Semak stok keluar yang sama sebelum memasukkannya semula.'));
    }finally{lock.current=false;setBusy(false);}
  }
  return <section ref={section} aria-label={t('Waste / Other','Sisa / Lain')} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing&&e.target instanceof HTMLInputElement&&e.target.dataset.wasteItem){e.preventDefault();const fields=[...section.current?.querySelectorAll<HTMLInputElement>('input[data-waste-item]:not(:disabled)')??[]].filter(el=>el.getClientRects().length),next=fields[fields.indexOf(e.target)+1];if(next){next.focus({preventScroll:true});next.select();next.scrollIntoView({block:'center'});}else e.target.blur();}}}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm"><span>{t('Entered By','Diisi Oleh')}: <strong>{profile?.full_name}</strong></span><span className="text-muted">{lines.length} {t(lines.length===1?'Item':'Items','Item')}</span></div>
    {!attempt&&(draftTime||Object.keys(entries).length||reason||notes)?<div className="request-draft-status mb-3"><span>{draftError?t('Draft Not Saved · Keep This Page Open','Draf Belum Disimpan · Kekalkan Halaman Ini'):t('Draft on This Device · Not Submitted','Draf pada Peranti Ini · Belum Dihantar')}{draftTime&&!draftError?' · '+new Date(draftTime).toLocaleTimeString(t('en-MY','ms-MY'),{hour:'2-digit',minute:'2-digit'}):''}</span><button className={iconButtonClass} disabled={blocked} aria-label={t('Discard Waste Draft','Buang Draf Sisa')} title={t('Discard Waste Draft','Buang Draf Sisa')} onClick={()=>setDiscard(true)}><Trash2 size={16}/></button></div>:null}
    {otherTab?<p role="alert" className="mb-3 text-sm text-danger">{t('This waste record changed in another tab.','Rekod sisa berubah di tab lain.')} <button type="button" className="underline" onClick={()=>window.location.reload()}>{t('Reload Waste Record','Muat Semula Rekod Sisa')}</button></p>:null}
    {draftError?<p role="alert" className="mb-3 text-sm text-danger">{draftError} <button type="button" className="underline" disabled={otherTab||!!recovery.error} onClick={()=>saveDraft(entries)}>{t('Retry Draft Save','Cuba Simpan Draf Lagi')}</button></p>:null}
    <p className="mb-3 border-l-2 border-warning pl-3 text-sm">{t('Previously recorded meal usage is already deducted.','Penggunaan hidangan yang telah direkodkan sudah ditolak.')}</p>
    {!ready?<p role="alert" className="mb-3 text-sm text-danger">{t('Stock-out needs the latest database update.','Stok keluar memerlukan kemas kini pangkalan data terkini.')}</p>:null}
    {!attempt&&error&&!draftError?<p role="alert" className="mb-3 text-sm text-danger">{error}</p>:null}
    <div className="arrival-entry-filter"><label className="relative block min-w-0"><Search className="absolute left-3 top-3.5 h-4 w-4 text-muted"/><input type="search" aria-label={t('Find Food Item','Cari Item Makanan')} className={inputClass+' pl-9'} value={search} disabled={blocked} onChange={e=>{setSearch(e.target.value);if(e.target.value.trim())setEnteredOnly(false);}} placeholder={t('Find Item','Cari Item')}/></label><div className="supply-segments two" role="group" aria-label={t('Waste Items','Item Sisa')}><button type="button" disabled={blocked} aria-pressed={!enteredOnly} onClick={()=>setEnteredOnly(false)}>{t('All Items','Semua Item')}</button><button type="button" disabled={blocked} aria-pressed={enteredOnly} onClick={()=>{setEnteredOnly(true);setSearch('');setFocused(null);}}>{t('Entered','Diisi')} ({lines.length})</button></div></div>
    <div className="stock-count-columns border-b border-line pb-2 text-xs font-semibold text-muted"><span>{t('Item / Balance','Item / Baki')}</span><span>{t('Stock Out','Stok Keluar')}</span><span/></div>
    <ul className="divide-y divide-line">{visible.map(item=>{
      const entry=entries[item.id], amount=entry?(entry.measure?measuredQuantity(entry.input,item,entry.measure):entryQuantity(entry.input,entry.snapshot)):null, hasInput=!!entry?.input.trim();
      const stale=hasInput&&stockOutChanged(entry.snapshot,item);
      const before=entry?.snapshot.expected_balance??countBalance(item);
      const issue=stale?t('Stock changed. Check again.','Stok berubah. Semak semula.'):hasInput&&(amount===null||amount<=0)?t(item.base_unit==='unit'?'Enter Whole Pieces':'Enter a Positive Quantity',item.base_unit==='unit'?'Masukkan Bilangan Bulat':'Masukkan Kuantiti Positif'):amount!==null&&amount>before?t('Exceeds Balance','Melebihi Baki'):'';
      return <li key={item.id} className={'stock-count-columns py-3 '+(measureOptions(item).length?'has-measure':'')} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setFocused(null);}}>
        <div className="min-w-0"><p className="break-words text-sm font-semibold">{kitchenName(item)}</p><p className="text-xs text-muted">{t('Balance','Baki')}: {entryDisplay(before,item,entry?.measure)} {entry?.measure??(kitchenFactor(item)?kitchenUnit(item):countUnit(item.base_unit))}</p>
        {issue?<p role="alert" className="text-xs font-semibold text-danger">{issue}</p>:amount!==null?<p className="text-xs text-muted">{t('After','Selepas')}: {entryDisplay(before-amount,item,entry?.measure)} {entry?.measure??(kitchenFactor(item)?kitchenUnit(item):countUnit(item.base_unit))}</p>:null}</div>
        <div className="min-w-0"><input data-waste-item={item.id} enterKeyHint="next" onFocus={()=>setFocused(item.id)} aria-label={`${t('Stock Out','Stok Keluar')} ${kitchenName(item)} (${entry?.measure??kitchenUnit(item)})`} aria-invalid={!!issue} className={inputClass+' text-right tabular'} disabled={!ready||!kitchenFactor(item)||blocked} inputMode={item.base_unit==='unit'?'numeric':'decimal'} maxLength={60} value={entry?.input??''} onChange={e=>edit(item,e.target.value,entry?.measure)}/>{!measureOptions(item).length?<span className="text-xs text-muted">{kitchenUnit(item)}</span>:null}<MeasureChoices label={kitchenName(item)+' '+t('Stock Out Unit','Unit Stok Keluar')} options={measureOptions(item)} value={entry?.measure??kitchenUnit(item)} disabled={!ready||!kitchenFactor(item)||blocked} onChange={unit=>{const result=changeMeasure(entry?.input??'',item,entry?.measure,unit);if(result)edit(item,result.value,result.measure);else setError(t('Check this amount before changing units.','Semak jumlah ini sebelum menukar unit.'));}}/></div>
        <button type="button" className={iconButtonClass} aria-label={`${t('Clear Quantity','Kosongkan Kuantiti')} ${kitchenName(item)}`} title={t('Clear and Check Again','Kosongkan dan Semak Semula')} disabled={!entry||blocked} onClick={()=>{const next={...entries};delete next[item.id];updateEntries(next);}}><RotateCcw size={16}/></button>
      </li>;
    })}</ul>
    {!visible.length?<p className="py-4 text-sm text-muted">{t('No Matching Items','Tiada Item Sepadan')}</p>:null}
    <div className="mt-4 grid gap-3"><fieldset disabled={blocked}><legend className="mb-2 text-sm font-semibold">{t('Reason','Sebab')}</legend><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{stockOutReasons.map(([value,ms])=><button type="button" key={value} aria-pressed={reason===value} className={reason===value?buttonClass:secondaryButtonClass} onClick={()=>{setReason(value);saveDraft(entries,value);}}>{t(value,ms)}</button>)}</div></fieldset>
      <Field label={t('What Happened','Apa Yang Berlaku')}><textarea aria-label={t('What Happened','Apa Yang Berlaku')} className={inputClass} rows={2} maxLength={2000} value={notes} disabled={blocked} onChange={e=>{setNotes(e.target.value);saveDraft(entries,reason,e.target.value);}}/></Field>
    </div>
    <div className="kitchen-entry-footer"><span className="text-sm tabular">{lines.length} {t(lines.length===1?'Item':'Items','Item')}</span><button className={buttonClass} disabled={!valid||blocked||!!draftError} onClick={review}><ClipboardCheck size={16}/>{t('Review Waste / Other','Semak Sisa / Lain')}</button></div>
    {attempt&&active?<Modal title={t('Confirm Waste / Other','Sahkan Sisa / Lain')} onClose={backToEdit} footer={<div className="grid gap-3">
      {error?<p role="alert" className="text-sm text-danger">{error}</p>:null}
      {otherTab?<p role="alert" className="text-sm text-danger">{t('This waste record changed in another tab. Reload before confirming.','Rekod sisa berubah di tab lain. Muat semula sebelum mengesahkan.')} <button type="button" className="underline" onClick={()=>window.location.reload()}>{t('Reload Waste Record','Muat Semula Rekod Sisa')}</button></p>:null}
      {attempt.attempted&&!error&&!busy?<p role="status" className="text-sm text-warning">{t('Confirmation pending. Check the original request.','Menunggu pengesahan. Semak permintaan asal.')}</p>:null}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="h-5 w-5 shrink-0" checked={checked} disabled={busy} onChange={e=>setChecked(e.target.checked)}/>{t('I checked the quantities, units and reason.','Saya telah menyemak kuantiti, unit dan sebab.')}</label>
      <div className="grid grid-cols-2 gap-2"><button className={secondaryButtonClass} disabled={busy||attempt.attempted||otherTab} onClick={backToEdit}>{t('Back to Edit','Sunting Semula')}</button><button className={buttonClass} disabled={busy||!checked||otherTab||!!recovery.error} onClick={()=>void confirm()}><Check size={16}/>{busy?t('Saving...','Menyimpan...'):attempt.attempted?t('Check Status','Semak Status'):t('Confirm','Sahkan')}</button></div>
    </div>}>
      <p className="text-sm font-semibold">{reasonLabel(attempt.reason)} · {profile?.full_name}</p><p className="mt-1 break-words text-sm text-muted">{attempt.notes}</p>
      <ul className="mt-3 divide-y divide-line">{attempt.lines.map(line=><li key={line.ingredient_id} className="py-3"><p className="break-words text-sm font-semibold">{line.name}</p><div className="mt-1 grid grid-cols-3 gap-2 text-xs">{[[t('Before','Sebelum'),line.expected_balance],[t('Stock Out','Stok Keluar'),line.quantity],[t('After','Selepas'),line.expected_balance-line.quantity]].map(([label,value])=><span key={label}>{label}<strong className="block text-sm">{lineDisplay(Number(value),line)}</strong></span>)}</div></li>)}</ul>
    </Modal>:null}
    {discard&&active?<Modal title={t('Discard Waste Draft?','Buang Draf Sisa?')} onClose={()=>setDiscard(false)} footer={<div className="grid gap-3">{draftError?<p role="alert" className="text-sm text-danger">{draftError}</p>:null}<div className="flex justify-end gap-2"><button className={secondaryButtonClass} onClick={()=>setDiscard(false)}>{t('Keep Draft','Simpan Draf')}</button><button className={buttonClass} disabled={blocked} onClick={discardDraft}>{t('Discard Draft','Buang Draf')}</button></div></div>}><p className="text-sm">{t('Only this device’s unfinished waste entries will be removed. Confirmed records and stock balances stay unchanged.','Hanya catatan sisa belum selesai pada peranti ini dibuang. Rekod disahkan dan baki stok kekal tanpa perubahan.')}</p></Modal>:null}
  </section>;
}
