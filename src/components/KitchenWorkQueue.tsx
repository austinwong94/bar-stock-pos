import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ChevronRight, Clock3, RefreshCw, Search } from 'lucide-react';
import { Modal } from './Modal';
import { iconButtonClass, inputClass, secondaryButtonClass } from './Form';
import { useAccess } from '../lib/access';
import { useLanguage } from '../lib/language';
import { isDemoMode, supabase } from '../lib/supabase';
import { readAllRows } from '../lib/readAllRows';
import { useSharedRefresh } from '../lib/useSharedRefresh';
import { combineKitchenWork, deviceKitchenWork, savedKitchenWork, type WorkKind, type WorkRow } from '../lib/kitchenWorkQueue';

const labels:Record<WorkKind,[string,string]>={request:['Purchase Request','Permintaan Belian'],receipt:['Receipt','Resit'],payment:['Supplier Payment','Bayaran Pembekal'],delivery:['Delivery','Penghantaran'],'receipt-delivery':['Receipt Delivery','Penghantaran Resit'],usage:['Guest & Staff Meals','Hidangan Tetamu & Staf'],count:['Stock Check','Semak Stok'],arrival:['Unlisted Delivery','Penghantaran Lain'],water:['Snorkelling Water','Air Snorkelling'],waste:['Waste / Other','Sisa / Lain']};

export function KitchenWorkQueue(){
  const {can,profile}=useAccess(),{text:t,language}=useLanguage(),navigate=useNavigate();
  const countId=useId();
  const [open,setOpen]=useState(false),[saved,setSaved]=useState<WorkRow[]>([]),[device,setDevice]=useState<WorkRow[]>([]);
  const [loading,setLoading]=useState(true),[error,setError]=useState(false),[storageError,setStorageError]=useState(false),[query,setQuery]=useState('');
  const [scope,setScope]=useState<'all'|'device'|'saved'>('all'),generation=useRef(0);
  const readDevice=useCallback(()=>{try{setDevice(deviceKitchenWork(localStorage,profile?.id??'',profile?.full_name??'',import.meta.env.VITE_SUPABASE_URL,can));setStorageError(false);}catch{setStorageError(true);setDevice([]);}},[profile?.id,profile?.full_name,can]);
  const refresh=useCallback(async()=>{
    const ticket=++generation.current;setLoading(true);readDevice();
    try{const rows=await savedKitchenWork(supabase,()=>readAllRows(async(from,to)=>{if(from>=10000)throw Error('Too many unfinished requests.');return await supabase.from('purchase_requests').select('id,request_no,needed_for_date,updated_at,status,purchase_request_items(id)').eq('status','draft').eq('origin','kitchen').order('id').range(from,to);}),can,isDemoMode);
      if(ticket===generation.current){setSaved(rows);setError(false);}
    }catch{if(ticket===generation.current){setError(true);setSaved([]);}}
    finally{if(ticket===generation.current)setLoading(false);}
  },[can,readDevice]);
  useEffect(()=>{void refresh();return()=>{generation.current++;};},[refresh]);
  useSharedRefresh(refresh,{tables:['purchase_requests','receipt_reviews','delivery_drafts','receipt_delivery_drafts'],intervalMs:60000});
  useEffect(()=>{window.addEventListener('storage',readDevice);const timer=window.setInterval(readDevice,5000);return()=>{window.removeEventListener('storage',readDevice);window.clearInterval(timer);};},[readDevice]);
  const rows=combineKitchenWork(error?[]:saved,device),visible=rows.filter(r=>(scope==='all'||r.source===scope)&&[r.title,r.date,r.actor,...labels[r.kind]].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const savedLabel=isDemoMode?t('Saved in Preview','Disimpan dalam Pratonton'):t('Cloud','Awan');
  const countText=error||storageError?t('Unfinished records could not be fully checked.','Rekod belum selesai tidak dapat disemak sepenuhnya.'):loading?t('Checking unfinished records.','Menyemak rekod belum selesai.'):rows.length+' '+t('unfinished records','rekod belum selesai');
  const state=(r:WorkRow)=>r.state==='unreadable'?t('Needs Manager Check','Perlu Semakan Pengurus'):r.state==='uncertain'?t('Check Status','Semak Status'):r.state==='review'?t('Needs Confirmation','Perlu Pengesahan'):t('Not Submitted','Belum Dihantar');
  function show(){setOpen(true);setQuery('');setScope('all');void refresh();}
  return <div className="kitchen-work-trigger">
    <button type="button" className={secondaryButtonClass+' kitchen-work-button'} onClick={show} aria-label={t('To Finish','Belum Selesai')} aria-describedby={countId} title={t('To Finish','Belum Selesai')+' · '+countText}><Clock3 size={16}/><span className="work-button-label">{t('To Finish','Belum Selesai')}</span><span aria-hidden="true" className={'work-count '+(error||storageError?'text-danger':'')}>{error||storageError?'!':loading?'…':rows.length>99?'99+':rows.length}</span></button>
    <span id={countId} className="sr-only">{countText}</span>
    {open?<Modal title={t('To Finish','Belum Selesai')} onClose={()=>setOpen(false)} footer={<div className="flex justify-end"><button className={secondaryButtonClass} onClick={()=>setOpen(false)}>{t('Close','Tutup')}</button></div>}>
      <div className="work-queue-toolbar"><label className="relative min-w-0"><Search size={16} className="absolute left-3 top-3.5 text-muted"/><input type="search" className={inputClass+' pl-9'} value={query} onChange={e=>setQuery(e.target.value)} aria-label={t('Find Unfinished Work','Cari Kerja Belum Selesai')} placeholder={t('Item, Supplier or Date','Item, Pembekal atau Tarikh')}/></label><button className={iconButtonClass} disabled={loading} onClick={()=>void refresh()} aria-label={t('Refresh List','Muat Semula Senarai')} title={t('Refresh List','Muat Semula Senarai')}><RefreshCw size={16}/></button></div>
      <div className="supply-segments three my-3" role="group" aria-label={t('Saved Where','Disimpan Di Mana')}>{(['all','device','saved'] as const).map(s=><button key={s} aria-pressed={scope===s} onClick={()=>setScope(s)}>{s==='all'?t('All','Semua'):s==='device'?t('This Device','Peranti Ini'):isDemoMode?t('Preview','Pratonton'):savedLabel}</button>)}</div>
      {loading?<p role="status" className="mb-2 text-xs text-muted">{t('Checking Saved Records…','Menyemak Rekod Tersimpan…')}</p>:null}
      {error?<p role="alert" className="work-queue-warning"><AlertTriangle size={16}/><span>{t('Saved records could not be checked. This is not an empty queue.','Rekod tersimpan tidak dapat disemak. Ini bukan senarai kosong.')} <button className="underline" onClick={()=>void refresh()}>{t('Retry','Cuba Lagi')}</button></span></p>:null}
      {storageError?<p role="alert" className="work-queue-warning"><AlertTriangle size={16}/>{t('Drafts on this device could not be checked. Keep this device and ask a manager.','Draf pada peranti ini tidak dapat disemak. Simpan peranti ini dan minta pengurus menyemak.')}</p>:null}
      <ul className="work-queue-list">{visible.map(row=><li key={row.key}>
        <button type="button" className="work-queue-row" disabled={row.state==='unreadable'||(loading&&row.source==='saved')}
          aria-label={t('Open ','Buka ')+t(...labels[row.kind])+': '+(row.title||row.date)}
          onClick={()=>{if(row.route){setOpen(false);navigate(row.route);}}}>
          <span className="min-w-0">
            <span className="work-queue-kind">{t(...labels[row.kind])}<span className={row.state==='uncertain'||row.state==='unreadable'?'text-danger':'text-warning'}>{state(row)}</span></span>
            {row.title||row.date?<strong>{row.title||row.date}</strong>:null}
            <small>{[row.source==='device'?t('This Device Only','Peranti Ini Sahaja'):savedLabel,row.title?row.date:'',row.items?row.items+' '+(row.items===1?t('Item','Item'):t('Items','Item')):'',row.actor].filter(Boolean).join(' · ')}</small>
            {row.time?<small>{new Intl.DateTimeFormat(language==='ms'?'ms-MY':'en-GB',{timeZone:'Asia/Kuala_Lumpur',dateStyle:'medium',timeStyle:'short'}).format(new Date(row.time))} MYT</small>:null}
          </span>
          {row.state==='unreadable'?<AlertTriangle size={18}/>:<ChevronRight size={18}/>}</button>
      </li>)}</ul>
      {!visible.length&&!loading&&!error&&!storageError?<p className="py-5 text-center text-sm text-muted">{query?t('No Matching Records','Tiada Rekod Sepadan'):t('Nothing to Finish','Tiada Kerja Belum Selesai')}</p>:null}
      <p className="mt-3 text-xs text-muted">{t('Device drafts are not submitted or synced. A pending confirmation must be checked before re-entering it.','Draf peranti belum dihantar atau disegerakkan. Pengesahan tertangguh mesti disemak sebelum dimasukkan semula.')}</p>
    </Modal>:null}
  </div>;
}
