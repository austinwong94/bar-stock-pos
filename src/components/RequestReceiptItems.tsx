import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { RefreshCw } from 'lucide-react';
import { inputClass, secondaryButtonClass } from './Form';
import { useLanguage } from '../lib/language';
import { remainingToBuy } from '../lib/purchasingProgress';
import { hasPurchaseEntry, purchaseEntryIssues } from '../lib/purchaseEntry';
import { requestItemMatches } from '../lib/kitchenRequestDraft';
import type { ReceiptData, ReceiptReview } from '../lib/receiptReview';

export function RequestReceiptItems({record,data,onChange,onRefresh,checkSignal=0}:{record:ReceiptReview;data:ReceiptData;onChange:(patch:Partial<ReceiptData>)=>void;onRefresh:()=>void;checkSignal?:number}) {
  const {text:t}=useLanguage();
  const items=record.request_snapshot?.purchase_request_items??[];
  const [search,setSearch]=useState(''),[enteredOnly,setEnteredOnly]=useState(false),[focused,setFocused]=useState<string|null>(null);
  const entries=data.request_entries??{};
  const entered=items.filter(i=>hasPurchaseEntry(entries[i.id]));
  const visible=items.filter(i=>requestItemMatches(i,search)&&(!enteredOnly||i.id===focused||hasPurchaseEntry(entries[i.id])));
  const fields=useRef(new Map<string,HTMLInputElement>()),refresh=useRef<HTMLButtonElement>(null),[checkTarget,setCheckTarget]=useState<string|null>(null);
  useEffect(()=>{
    if(!checkSignal)return;
    setSearch('');setEnteredOnly(false);setFocused(null);
    const invalid=items.find(i=>{if(!hasPurchaseEntry(entries[i.id]))return false;const issue=purchaseEntryIssues(entries[i.id],remainingToBuy(i));return i.purchase_status==='unavailable'||!!issue.quantity||issue.cost;});
    const item=invalid??items.find(i=>i.purchase_status!=='unavailable'&&remainingToBuy(i)>0),issue=invalid?purchaseEntryIssues(entries[invalid.id],remainingToBuy(invalid)):null;
    const field=issue&&!issue.quantity&&issue.cost?'cost':'quantity',unknown=Object.keys(entries).some(id=>!items.some(i=>i.id===id));
    setCheckTarget(unknown||!item?'refresh':item.id+':'+field);
  },[checkSignal]);
  useLayoutEffect(()=>{
    if(!checkTarget||search.trim()||enteredOnly)return;
    // Callback refs are populated after the restored list has committed.
    const node=checkTarget==='refresh'?refresh.current:fields.current.get(checkTarget);
    if(node){setCheckTarget(null);node.focus({preventScroll:true});node.scrollIntoView({block:'center'});}
  },[checkTarget,search,enteredOnly]);
  function next(event:KeyboardEvent<HTMLUListElement>){if(event.key!=='Enter'||event.nativeEvent.isComposing||!(event.target instanceof HTMLInputElement))return;event.preventDefault();const fields=Array.from(event.currentTarget.querySelectorAll<HTMLInputElement>('input'));const field=fields[fields.indexOf(event.target)+1];if(field){field.focus();field.select();}else event.target.blur();}
  return <section className="request-receipt-items" aria-label={t('Buying List Quantities','Kuantiti Senarai Belian')}>
    <div className="supply-toolbar"><h3 className="text-sm font-semibold">{record.request_snapshot?.request_no}</h3><button ref={refresh} type="button" className={secondaryButtonClass} onClick={onRefresh}><RefreshCw size={16}/>{t('Refresh List','Muat Semula')}</button></div>
    <p className="mb-2 text-xs text-muted">{t('Bought now. Leave unpurchased items blank. Stock changes only after delivery is received.','Dibeli sekarang. Biarkan barang belum dibeli kosong. Stok berubah selepas penghantaran diterima.')}</p>
    <div className="request-list-tools purchase-list-tools">
      <div className="request-entry-filter"><input type="search" className={inputClass} aria-label={t('Find Requested Item','Cari Item Diminta')} placeholder={t('Find Item','Cari Item')} value={search} onChange={e=>{setSearch(e.target.value);setFocused(null);if(e.target.value.trim())setEnteredOnly(false);}}/><div className="supply-segments two" role="group" aria-label={t('Purchase Items','Item Belian')}><button type="button" aria-pressed={!enteredOnly} onClick={()=>{setSearch('');setFocused(null);setEnteredOnly(false);}}>{t('All Items','Semua Item')}</button><button type="button" aria-pressed={enteredOnly} onClick={()=>{setSearch('');setFocused(null);setEnteredOnly(true);}}>{t('Entered','Diisi')} ({entered.length})</button></div></div>
      <div className="purchase-entry-row has-costs text-xs text-muted"><span>{t('Item','Item')}</span><span className="text-right">{t('Bought','Dibeli')}</span><span className="text-right">{t('Total RM','Jumlah RM')}</span></div>
    </div>
    <ul className="divide-y divide-line" onKeyDown={next}>{visible.map(i=>{
      const e=entries[i.id]??{quantity:'',cost:''},issue=purchaseEntryIssues(e,remainingToBuy(i));
      const unavailable=i.purchase_status==='unavailable'||remainingToBuy(i)<=0;
      const change=(patch:Partial<typeof e>)=>onChange({request_entries:{...entries,[i.id]:{...e,...patch}}});
      return <li key={i.id} className="purchase-entry-row has-costs py-2">
        <span className="min-w-0"><strong className="block break-words text-sm">{i.item_name}</strong><small className="block break-words text-muted">{unavailable?t('No Longer Needed','Tidak Lagi Diperlukan'):t('Still To Buy','Belum Dibeli')+' '+remainingToBuy(i)+' '+i.unit}</small></span>
        <label className="min-w-0"><input ref={node=>{if(node)fields.current.set(i.id+':quantity',node);else fields.current.delete(i.id+':quantity');}} className={inputClass+' !px-2 text-right'} aria-label={t('Bought','Dibeli')+': '+i.item_name+' ('+i.unit+')'} inputMode="decimal" enterKeyHint="next" maxLength={12} value={e.quantity} onFocus={()=>setFocused(i.id)} onBlur={()=>setFocused(null)} aria-invalid={!!issue.quantity||(unavailable&&!!e.quantity)} onChange={event=>change({quantity:event.target.value})}/><small className="block break-words text-right text-muted">{i.unit}</small></label>
        <input ref={node=>{if(node)fields.current.set(i.id+':cost',node);else fields.current.delete(i.id+':cost');}} className={inputClass+' !px-2 text-right self-start'} aria-label={t('Total Cost','Jumlah Kos')+': '+i.item_name+' (MYR)'} inputMode="decimal" enterKeyHint="next" maxLength={12} value={e.cost} onFocus={()=>setFocused(i.id)} onBlur={()=>setFocused(null)} aria-invalid={issue.cost} onChange={event=>change({cost:event.target.value})}/>
        {issue.quantity||issue.cost||unavailable&&e.quantity?<p className="col-span-full text-xs text-danger">{t('Check the quantity, unit and cost. Do not exceed what is still needed.','Semak kuantiti, unit dan kos. Jangan melebihi baki diperlukan.')}</p>:null}
      </li>;
    })}</ul>
    {!visible.length?<p role="status" className="py-3 text-sm text-muted">{search.trim()?t('No matching items.','Tiada item sepadan.'):enteredOnly?t('No purchase entries yet.','Belum ada catatan belian.'):t('No items in this buying list.','Tiada item dalam senarai belian ini.')}</p>:null}
  </section>;
}
