import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Ship } from 'lucide-react';
import { Modal } from './Modal';
import { Field, buttonClass, inputClass, secondaryButtonClass } from './Form';
import { supabase } from '../lib/supabase';
import { readErrorMessage, todayIso } from '../lib/opsData';
import { useLanguage } from '../lib/language';
import type { BoatTrip } from '../lib/platformTypes';

export function ScheduledBoatTrips({trips,date,canRecord,onSaved}:{trips:BoatTrip[];date:string;canRecord:boolean;onSaved:()=>void}) {
  const {text:t}=useLanguage();
  const [selected,setSelected]=useState<BoatTrip|null>(null);
  const rows=trips.filter(trip=>trip.auto_generated&&trip.service_date===date&&trip.trip_status!=='cancelled');
  const status=(s:string)=>s==='departed'?t('Departed','Telah Berlepas'):s==='returned'?t('Returned','Telah Kembali'):t('Planned','Dirancang');
  return <section className="mb-5 border-y border-line py-3" aria-label="Scheduled Boats">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-bold">{t('Scheduled Boats','Bot Berjadual')} <span className="text-sm font-normal text-muted">· {date}</span></h2><Link className="text-sm font-semibold text-accent underline underline-offset-4" to="/fleet">{t('Boat Assignments','Penugasan Bot')}</Link></div>
    <ul className="divide-y divide-line">{rows.map(trip=><li key={trip.id} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" data-scheduled-trip={trip.id}>
      <div className="min-w-0"><p className="flex flex-wrap items-center gap-2 text-sm font-semibold"><Ship className="h-4 w-4 text-accent" />{trip.boats?.code} <span className="text-xs text-muted">{status(trip.trip_status??'planned')}</span></p><p className="mt-1 text-sm">{trip.pax_count} {t('Checked In','Daftar Masuk')} · {trip.planned_pax??0} {t('Assigned','Ditugaskan')}{trip.departure_time?' · '+trip.departure_time.slice(0,5):''}</p></div>
      {canRecord&&['planned','departed'].includes(trip.trip_status??'planned')?<button className={trip.trip_status==='departed'?secondaryButtonClass:buttonClass} onClick={()=>setSelected(trip)} aria-label={(trip.trip_status==='departed'?'Mark Returned ':'Confirm Departure ')+trip.boats?.code}>{trip.trip_status==='departed'?t('Mark Returned','Tandakan Kembali'):t('Confirm Departure','Sahkan Berlepas')}</button>:null}
    </li>)}</ul>
    {!rows.length?<p className="py-3 text-sm text-muted">{t('No Assigned Boats for This Date','Tiada Bot Ditugaskan untuk Tarikh Ini')}</p>:null}
    {selected?<TripConfirmation trip={selected} onClose={()=>setSelected(null)} onSaved={()=>{setSelected(null);onSaved();}} />:null}
  </section>;
}

function TripConfirmation({trip,onClose,onSaved}:{trip:BoatTrip;onClose:()=>void;onSaved:()=>void}) {
  const {text:t}=useLanguage();const returning=trip.trip_status==='departed';
  const [time,setTime]=useState(()=>trip.service_date===todayIso()?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date()):'');
  const [checked,setChecked]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [token]=useState(()=>crypto.randomUUID());
  async function save(){if(busy||!checked||!time)return;setBusy(true);setError('');try{const r=await supabase.rpc('confirm_scheduled_boat_trip',{p_trip_id:trip.id,p_expected_updated_at:trip.updated_at,p_status:returning?'returned':'departed',p_time:time,p_request_id:token});if(r.error)throw r.error;onSaved();}catch(e){setError(readErrorMessage(e,'Confirmation not saved.'));}finally{setBusy(false);}}
  return <Modal title={returning?t('Confirm Return','Sahkan Kembali'):t('Confirm Departure','Sahkan Berlepas')} onClose={()=>{if(!busy)onClose();}} footer={<div className="grid gap-3">{error?<p role="alert" className="text-sm text-danger">{error}</p>:null}<button className={buttonClass} disabled={busy||!checked||!time} onClick={()=>void save()}><Check className="h-4 w-4" />{busy?t('Saving...','Menyimpan...'):t('Confirm','Sahkan')}</button></div>}>
    <p className="mb-3 font-semibold">{trip.boats?.code} · {trip.service_date} · {trip.pax_count} pax</p>
    <Field label={returning?t('Actual Return Time','Masa Sebenar Kembali'):t('Actual Departure Time','Masa Sebenar Berlepas')}><input type="time" className={inputClass} value={time} disabled={busy} onChange={e=>setTime(e.target.value)} /></Field>
    <label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" className="h-5 w-5 shrink-0" checked={checked} disabled={busy} onChange={e=>setChecked(e.target.checked)} />{returning?t('This boat has returned.','Bot ini telah kembali.'):t('This boat has departed with the checked-in guests.','Bot ini telah berlepas dengan tetamu yang telah mendaftar masuk.')}</label>
  </Modal>;
}
