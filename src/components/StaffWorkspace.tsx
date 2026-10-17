import { useState } from 'react';
import { Check, RefreshCw, Search } from 'lucide-react';
import { BookingDateNavigation } from './BookingDateNavigation';
import { buttonClass, iconButtonClass, inputClass } from './Form';
import { Modal } from './Modal';
import { useLanguage } from '../lib/language';
import { ViewChoices } from './ViewChoices';
import type { ManifestRow } from '../lib/platformTypes';

export function StaffFilters({date,onDate,search,onSearch,boat,onBoat,boats,onRefresh,disabled=false}: {
  date:string; onDate:(value:string)=>void; search:string; onSearch:(value:string)=>void;
  boat:string; onBoat:(value:string)=>void; boats:{id:string;label:string}[]; onRefresh?:()=>void; disabled?:boolean;
}) {
  const {text:t}=useLanguage();
  return <><BookingDateNavigation date={date} onDate={onDate} disabled={disabled} />
    <fieldset disabled={disabled} className="staff-filters">
    <div className="relative min-w-0"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted" /><input type="search" aria-label="Find Guest" className={`${inputClass} pl-9`} placeholder={t('Find Guest','Cari Tetamu')} value={search} onChange={e=>onSearch(e.target.value)} /></div>
    {onRefresh?<button type="button" className={iconButtonClass} title={t('Refresh','Muat Semula')} aria-label="Refresh Attendance" onClick={onRefresh}><RefreshCw className="h-4 w-4" /></button>:null}
    <ViewChoices label="Boat Filter" className="col-span-2" value={boat} onChange={onBoat} items={[{value:'',label:t('All Boats','Semua Bot')},...boats.map(b=>({value:b.id,label:b.label}))]}/>
  </fieldset></>;
}

export function StaffTabs({items,value,onChange}: {items:{value:string;label:string;count?:number}[];value:string;onChange:(value:string)=>void}) {
  return <ViewChoices label="List View" className="staff-list-views mb-3" value={value} onChange={onChange} items={items.map(item=>({value:item.value,label:<>{item.label}{item.count!=null?<span className="ml-1.5 tabular">{item.count}</span>:null}</>}))}/>;
}

export function StaffSummary({items}: {items:{label:string;value:number|string;tone?:'warning'|'accent'}[]}) {
  return <dl className="staff-summary">{items.map(item=><div key={item.label}><dt>{item.label}</dt><dd className={`font-semibold tabular ${item.tone==='warning'?'text-warning':item.tone==='accent'?'text-accent':'text-ink'}`}>{item.value}</dd></div>)}</dl>;
}

export function StaffFeedback({loading,error,notice,onRetry}: {loading:boolean;error:string;notice:string;onRetry:()=>void}) {
  const {text:t}=useLanguage();
  return <>{error?<div role="alert" className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-danger/30 p-2 text-sm text-danger"><span>{error}</span><button type="button" title="Refresh" aria-label="Retry Attendance" className={iconButtonClass} onClick={onRetry}><RefreshCw className="h-4 w-4" /></button></div>:null}
    {loading?<p role="status" className="py-3 text-sm text-muted">{t('Loading attendance...','Memuatkan kehadiran...')}</p>:null}
    {!loading && notice?<p role="status" className="mb-2 flex items-center gap-2 text-xs font-semibold text-accent"><Check className="h-4 w-4" />{notice}</p>:null}</>;
}

export function StaffConfirmation({title,guests,action,busy,error,onClose,onConfirm}: {title:string;guests:ManifestRow[];action:string;busy:boolean;error:string;onClose:()=>void;onConfirm:()=>void}) {
  const [checked,setChecked]=useState(false); const {text:t}=useLanguage();
  return <Modal title={title} onClose={()=>{if(!busy)onClose();}} footer={<div className="grid gap-2">{error?<p role="alert" className="text-sm text-danger">{error}</p>:null}<label className="flex min-h-11 items-center gap-2 text-sm"><input className="h-5 w-5" type="checkbox" disabled={busy} checked={checked} onChange={e=>setChecked(e.target.checked)} />{t('I checked these guests.','Saya telah menyemak tetamu ini.')}</label><button type="button" className={buttonClass} onClick={onConfirm} disabled={!checked || busy}>{busy?t('Saving...','Menyimpan...'):action}</button></div>}>
    <p className="mb-2 text-sm font-semibold">{guests.length} pax</p><ul className="divide-y divide-line">{guests.map(row=><li key={row.passenger_id} className="py-2"><p className="break-words text-sm font-semibold">{row.full_name}</p><p className="text-xs text-muted">{row.boat_code} · {row.booking_ref}</p></li>)}</ul>
  </Modal>;
}
