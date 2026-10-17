import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightLeft, Check, ChevronDown, Lock, LockOpen, Ship, Users, Wand2 } from 'lucide-react';
import { PageHeader } from '../../components/Page';
import { Field, buttonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { Modal } from '../../components/Modal';
import PassengerBreakdown from '../../components/PassengerBreakdown';
import { StaffFilters, StaffSummary, StaffTabs } from '../../components/StaffWorkspace';
import { useToast } from '../../components/Toast';
import { useBusinessDate } from '../../lib/useBusinessDate';
import { useSharedRefresh } from '../../lib/useSharedRefresh';
import { useLanguage } from '../../lib/language';
import { supabase } from '../../lib/supabase';
import { useAccess } from '../../lib/access';
import { loadBoats, loadEmployees, readErrorMessage } from '../../lib/opsData';
import type { Boat, BoatAssignment, Booking, Employee, TripBooking } from '../../lib/platformTypes';

export function crewSnapshot(row: BoatAssignment) {
  return { captain: row.captain_employee_id, guide: row.guide_employee_id, departure: row.departure_time?.slice(0,5) || null };
}

export default function BoatBoard() {
  const toast=useToast(); const {can}=useAccess(); const {text:t}=useLanguage();
  const [date,setDate]=useBusinessDate('guests');
  const [boats,setBoats]=useState<Boat[]>([]), [assignments,setAssignments]=useState<BoatAssignment[]>([]);
  const [tripBookings,setTripBookings]=useState<TripBooking[]>([]), [bookings,setBookings]=useState<Booking[]>([]);
  const [captains,setCaptains]=useState<Employee[]>([]), [guides,setGuides]=useState<Employee[]>([]);
  const [loading,setLoading]=useState(true), [busy,setBusy]=useState(false), [error,setError]=useState('');
  const [search,setSearch]=useState(''), [boatFilter,setBoatFilter]=useState(''), [view,setView]=useState('waiting');
  const [moving,setMoving]=useState<{booking:Booking;source:string|null}|null>(null);
  const [crew,setCrew]=useState<BoatAssignment|null>(null), [modalError,setModalError]=useState('');
  const generation=useRef(0), writing=useRef(false);
  const canAssign=can('fleet.assign'), canCrew=can('fleet.crew.assign'), canLock=can('fleet.finalize');

  const refresh=useCallback(async()=>{
    const ticket=++generation.current;
    try {
      const result=canAssign ? await supabase.rpc('ensure_boat_assignments',{p_service_date:date})
        : await supabase.from('boat_assignments').select('*').eq('service_date',date).order('trip_no');
      if(result.error)throw result.error;
      const rows=(result.data??[]) as BoatAssignment[], ids=rows.map(r=>r.id);
      const [boatRows,trips,groups,captainRows,guideRows]=await Promise.all([
        loadBoats(true),
        ids.length?supabase.from('trip_bookings').select('*').in('assignment_id',ids):Promise.resolve({data:[],error:null}),
        supabase.rpc('read_guest_bookings',{p_date:date}),
        loadEmployees(['captain']),
        loadEmployees(['guide']),
      ]);
      if(trips.error)throw trips.error; if(groups.error)throw groups.error;
      if(ticket!==generation.current)return;
      setAssignments(rows);setBoats(boatRows);setTripBookings(trips.data??[]);setBookings((groups.data??[]).filter((b:Booking)=>b.status!=='cancelled').sort((a:Booking,b:Booking)=>a.lead_name.localeCompare(b.lead_name)));
      setCaptains(captainRows);setGuides(guideRows);setError('');
    } catch(e) {if(ticket===generation.current)setError(readErrorMessage(e,'Could not load the boat board.'));}
    finally {if(ticket===generation.current)setLoading(false);}
  },[canAssign,canCrew,date]);
  useEffect(()=>{setLoading(true);setMoving(null);setCrew(null);void refresh();return()=>{generation.current++;};},[refresh]);
  useSharedRefresh(refresh,{tables:['boats','boat_assignments','bookings','trip_bookings','tourists']});

  const boatById=useMemo(()=>new Map(boats.map(b=>[b.id,b])),[boats]);
  const sourceById=useMemo(()=>new Map(tripBookings.map(b=>[b.booking_id,b.assignment_id])),[tripBookings]);
  const groupsFor=(id:string)=>bookings.filter(b=>sourceById.get(b.id)===id);
  const matches=(b:Booking)=>[b.lead_name,b.booking_ref,b.pickup_hotel_name,...(b.tourists??[]).map(p=>p.full_name)].some(value=>value?.toLowerCase().includes(search.trim().toLowerCase()));
  const waiting=bookings.filter(b=>!sourceById.has(b.id)), waitingPax=waiting.reduce((n,b)=>n+b.pax_total,0);
  const total=bookings.reduce((n,b)=>n+b.pax_total,0), locked=assignments.some(a=>a.locked);
  const options=assignments.map(a=>{
    const boat=boatById.get(a.boat_id);
    const staff = new Set([a.captain_employee_id,a.guide_employee_id,...(a.crew_employee_ids??[]),...groupsFor(a.id).map(b=>b.guide_employee_id)].filter(Boolean)).size + (a.captain_employee_id?0:1) + (a.crew_employee_ids?.length?0:1);
    return {assignment:a,label:(boat?.code??'Boat')+' · '+t('Trip','Trip')+' '+a.trip_no,capacity:Math.min(43,boat?.capacity_pax??0),pax:groupsFor(a.id).reduce((n,b)=>n+b.pax_total,0)+staff,staff};
  });

  async function run(rpc:string,args:Record<string,unknown>,message:string,close?:()=>void) {
    if(writing.current)return;
    writing.current=true;setBusy(true);setModalError('');
    try {
      const result=await supabase.rpc(rpc,args);
      if(result.error)throw result.error;
      close?.();toast.success(message);await refresh();
    } catch(e) {const message=readErrorMessage(e,'Could not save. Please try again.');setModalError(message);toast.error(message);await refresh();}
    finally {writing.current=false;setBusy(false);}
  }
  function openMove(booking:Booking) {setModalError('');setMoving({booking,source:sourceById.get(booking.id)??null});}
  function changeDate(value:string){setDate(value);setBoatFilter('');}

  return <div className="staff-workspace">
    <PageHeader title={t('Boat Board','Penugasan Bot')} actions={<>
      {canCrew&&!locked?<button className={secondaryButtonClass} disabled={busy||loading} onClick={()=>void run('copy_previous_crew',{p_service_date:date},t('Available crew assignments copied.','Penugasan kru disalin.'))}><Users className="h-4 w-4" />{t('Copy Crew','Salin Kru')}</button>:null}
      {canAssign&&!locked&&can('guests.sheet.view')?<Link className={secondaryButtonClass} to="/guests/sheet"><Wand2 className="h-4 w-4" />{t('Review Boat Plan','Semak Pelan Bot')}</Link>:null}
      {canLock?<button className={secondaryButtonClass} disabled={busy||loading||!assignments.length} onClick={()=>void run('set_day_locked',{p_service_date:date,p_locked:!locked},locked?t('Day unlocked.','Hari dibuka.'):t('Day locked.','Hari dikunci.'))}>{locked?<LockOpen className="h-4 w-4" />:<Lock className="h-4 w-4" />}{locked?t('Unlock','Buka Kunci'):t('Lock Day','Kunci Hari')}</button>:null}
    </>} />
    <StaffFilters date={date} onDate={changeDate} search={search} onSearch={setSearch} boat={boatFilter} onBoat={value=>{setBoatFilter(value);if(value)setView('boats');}} boats={options.map(o=>({id:o.assignment.id,label:o.label}))} onRefresh={()=>void refresh()} disabled={busy} />
    <StaffSummary items={[{label:t('Expected','Dijangka'),value:total},{label:t('Assigned','Ditugaskan'),value:total-waitingPax,tone:'accent'},{label:t('Waiting','Menunggu'),value:waitingPax,tone:waitingPax?'warning':undefined}]} />
    {can('maintenance.view')?<div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3"><Link className={secondaryButtonClass} to="/maintenance">{t('Departures & Trips','Perlepasan & Trip')}</Link>{can('maintenance.fuel.record')?<Link className={secondaryButtonClass} to="/maintenance?action=fuel">{t('Record Fuel','Rekod Bahan Api')}</Link>:null}{can('maintenance.repair.record')?<Link className={secondaryButtonClass} to="/maintenance?action=damage">{t('Report Damage','Lapor Kerosakan')}</Link>:null}</div>:null}
    <StaffTabs value={view} onChange={setView} items={[{value:'waiting',label:t('Waiting for a Boat','Menunggu Bot'),count:waitingPax},{value:'boats',label:t('Boats & Crew','Bot & Kru'),count:assignments.length}]} />
    {error?<div role="alert" className="mb-3 text-sm text-danger">{error}<button className={secondaryButtonClass} onClick={()=>void refresh()}>{t('Retry','Cuba Lagi')}</button></div>:null}
    {locked?<p className="mb-3 flex items-center gap-2 text-xs font-semibold text-muted"><Lock className="h-4 w-4" />{t('Assignments Locked','Penugasan Dikunci')}</p>:null}
    {loading?<p className="py-4 text-sm text-muted">{t('Loading...','Memuatkan...')}</p>:view==='waiting'?<section aria-label="Waiting for a Boat" className="divide-y divide-line">
      {waiting.filter(matches).map(b=><GroupRow key={b.id} booking={b} disabled={busy||locked} onAssign={canAssign?()=>openMove(b):undefined} />)}
      {!waiting.filter(matches).length?<p className="py-8 text-center text-sm text-muted">{waiting.length?t('No Matching Guests','Tiada Tetamu Sepadan'):t('Everyone Has a Boat','Semua Tetamu Telah Ditugaskan')}</p>:null}
    </section>:<div className="grid items-start gap-x-5 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
      {options.filter(o=>!boatFilter||o.assignment.id===boatFilter).map(o=>{
        const a=o.assignment, groups=groupsFor(a.id).filter(matches);
        if(search.trim()&&!groups.length)return null;
        const captain=captains.find(e=>e.id===a.captain_employee_id), guide=guides.find(e=>e.id===a.guide_employee_id);
        return <section key={a.id} className="min-w-0 border-t-2 border-line pt-3" data-boat={a.id}>
          <header className="mb-2">
            <div className="flex items-start justify-between gap-2"><h2 className="flex min-w-0 items-center gap-2 text-base font-bold"><Ship className="h-4 w-4 shrink-0 text-accent" />{o.label}</h2><div className="shrink-0 text-right"><p className="text-sm font-bold tabular">{o.pax} / {o.capacity} {t('Onboard','Atas Bot')}</p><p className="text-xs text-muted">{Math.max(o.capacity-o.pax,0)} {t(o.capacity-o.pax===1?'Seat Left':'Seats Left','Tempat Kosong')}</p></div></div>
            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted">{t('Staff / Reserved','Kru / Simpanan')}</dt><dd>{o.staff}</dd>
              <dt className="text-muted">{t('Captain','Kapten')}</dt><dd className="break-words">{captain?.full_name??(a.captain_employee_id?t('Assigned','Ditugaskan'):t('Not Assigned','Belum Ditugaskan'))}</dd>
              <dt className="text-muted">{t('Guide','Pemandu')}</dt><dd className="break-words">{guide?.full_name??(a.guide_employee_id?t('Assigned','Ditugaskan'):t('Not Assigned','Belum Ditugaskan'))}</dd>
              <dt className="text-muted">{t('Departure','Berlepas')}</dt><dd>{a.departure_time?.slice(0,5)??'-'}</dd>
            </dl>
            {canCrew?<button className={secondaryButtonClass+' mt-2 w-full'} disabled={busy||a.locked} aria-label={'Assign Crew for '+o.label} onClick={()=>{setModalError('');setCrew(a);}}><Users className="h-4 w-4" />{t('Assign Crew','Tugaskan Kru')}</button>:null}
          </header>
          {groups.map(b=><GroupRow key={b.id} booking={b} disabled={busy||locked} onboard onAssign={canAssign?()=>openMove(b):undefined} />)}
          {!groups.length?<p className="border-t border-line py-4 text-sm text-muted">{t('No Groups Assigned','Tiada Kumpulan Ditugaskan')}</p>:null}
        </section>;
      })}
    </div>}
    {moving?<AssignBoat booking={moving.booking} source={moving.source} options={options} busy={busy} error={modalError} onClose={()=>setMoving(null)} onSave={target=>void run('assign_booking_to_boat_checked',{p_booking_id:moving.booking.id,p_expected_assignment_id:moving.source,p_expected_pax:moving.booking.pax_total,p_assignment_id:target},t('Boat assignment saved.','Penugasan bot disimpan.'),()=>setMoving(null))} />:null}
    {crew?<CrewEditor assignment={crew} label={options.find(o=>o.assignment.id===crew.id)?.label??'Boat'} captains={captains} guides={guides} busy={busy} error={modalError} onClose={()=>setCrew(null)} onSave={values=>void run('set_trip_crew_checked',{p_assignment_id:crew.id,p_expected:crewSnapshot(crew),p_captain:values.captain||null,p_guide:values.guide||null,p_departure:values.departure||null},t('Crew assignment saved.','Penugasan kru disimpan.'),()=>setCrew(null))} />:null}
  </div>;
}

function GroupRow({booking:b,onAssign,disabled,onboard=false}:{booking:Booking;onAssign?:()=>void;disabled:boolean;onboard?:boolean}) {
  const {text:t}=useLanguage(); const [open,setOpen]=useState(false);
  return <article className="border-b border-line py-2.5 last:border-b-0" data-booking={b.id}>
    <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="break-words text-sm font-semibold">{b.lead_name}</p><p className="mt-0.5 text-xs text-muted">{b.booking_ref} · {b.pax_total} pax</p></div>{onAssign?<button className={secondaryButtonClass+' shrink-0 px-2'} aria-label={'Assign Boat for '+b.lead_name} disabled={disabled} onClick={onAssign}><ArrowRightLeft className="h-4 w-4" /><span>{onboard?t('Move','Pindah'):t('Assign','Tugas')}</span></button>:null}</div>
    <div className="flex flex-wrap items-center justify-between gap-x-2"><PassengerBreakdown counts={b}/>{b.tourists?.length?<button type="button" className="flex items-center gap-1 px-1 text-xs font-semibold text-muted" aria-expanded={open} onClick={()=>setOpen(!open)}><ChevronDown className={'h-4 w-4 '+(open?'rotate-180':'')} />{t('Names','Nama')}</button>:null}</div>
    {open?<ul className="mt-1 space-y-1 border-l-2 border-line pl-3">{b.tourists?.map(p=><li key={p.id} className="break-words text-sm">{p.full_name}</li>)}</ul>:null}
  </article>;
}

type BoatOption={assignment:BoatAssignment;label:string;capacity:number;pax:number};
function AssignBoat({booking,source,options,busy,error,onClose,onSave}:{booking:Booking;source:string|null;options:BoatOption[];busy:boolean;error:string;onClose:()=>void;onSave:(id:string|null)=>void}) {
  const {text:t}=useLanguage();const [target,setTarget]=useState('');
  const selected=options.find(o=>o.assignment.id===target), valid=target==='waiting'||!!selected&&!selected.assignment.locked&&selected.capacity-selected.pax>=booking.pax_total;
  return <Modal title={t('Assign Boat','Tugaskan Bot')} onClose={()=>{if(!busy)onClose();}} footer={<div className="grid gap-2">{error?<p role="alert" className="text-sm text-danger">{error}</p>:null}<button className={buttonClass} disabled={busy||!valid} onClick={()=>onSave(target==='waiting'?null:target)}><Check className="h-4 w-4" />{busy?t('Saving...','Menyimpan...'):t('Confirm Assignment','Sahkan Penugasan')}</button></div>}>
    <p className="break-words text-base font-bold">{booking.lead_name}</p><p className="mb-3 text-sm text-muted">{booking.booking_ref} · {booking.pax_total} pax</p>
    <fieldset className="grid gap-2" disabled={busy}><legend className="sr-only">{t('Choose Boat','Pilih Bot')}</legend>{options.map(o=>{
      const current=o.assignment.id===source,left=o.capacity-o.pax,unavailable=current||o.assignment.locked||left<booking.pax_total;
      return <label key={o.assignment.id} className={'flex min-h-14 items-center gap-3 rounded-lg border p-3 '+(target===o.assignment.id?'border-accent bg-accent/5':'border-line')+(unavailable?' opacity-60':' cursor-pointer')}><input type="radio" name="target-boat" value={o.assignment.id} checked={target===o.assignment.id} disabled={unavailable} onChange={()=>setTarget(o.assignment.id)} className="h-5 w-5 shrink-0 accent-accent" /><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{o.label}</span><span className="block text-xs text-muted">{current?t('Current Boat','Bot Semasa'):o.assignment.locked?t('Locked','Dikunci'):left<booking.pax_total?t('Not Enough Seats','Tempat Tidak Mencukupi'):t('Available','Tersedia')}</span></span><span className="shrink-0 text-right text-sm font-bold">{Math.max(left,0)}<span className="block text-xs font-normal text-muted">{t(left===1?'Seat Left':'Seats Left','Tempat Kosong')}</span></span></label>;
    })}{source?<label className="flex min-h-11 items-center gap-3 py-2 text-sm"><input type="radio" name="target-boat" checked={target==='waiting'} onChange={()=>setTarget('waiting')} className="h-5 w-5 accent-accent" />{t('Move Back to Waiting','Pindah ke Senarai Menunggu')}</label>:null}</fieldset>
  </Modal>;
}

function CrewEditor({assignment,label,captains,guides,busy,error,onClose,onSave}:{assignment:BoatAssignment;label:string;captains:Employee[];guides:Employee[];busy:boolean;error:string;onClose:()=>void;onSave:(value:{captain:string;guide:string;departure:string})=>void}) {
  const {text:t}=useLanguage(); const [captain,setCaptain]=useState(assignment.captain_employee_id??''),[guide,setGuide]=useState(assignment.guide_employee_id??''),[departure,setDeparture]=useState(assignment.departure_time?.slice(0,5)??'');
  return <Modal title={t('Assign Crew','Tugaskan Kru')} onClose={()=>{if(!busy)onClose();}} footer={<div className="grid gap-2">{error?<p role="alert" className="text-sm text-danger">{error}</p>:null}<button className={buttonClass} disabled={busy} onClick={()=>onSave({captain,guide,departure})}><Check className="h-4 w-4" />{busy?t('Saving...','Menyimpan...'):t('Save Crew','Simpan Kru')}</button></div>}>
    <p className="mb-3 font-semibold">{label}</p><fieldset disabled={busy} className="grid gap-3">
      <Field label={t('Captain','Kapten')}><select aria-label="Captain" className={inputClass} value={captain} onChange={e=>setCaptain(e.target.value)}><option value="">{t('Not Assigned','Belum Ditugaskan')}</option>{captains.map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}</select></Field>
      <Field label={t('Guide','Pemandu')}><select aria-label="Guide" className={inputClass} value={guide} onChange={e=>setGuide(e.target.value)}><option value="">{t('Not Assigned','Belum Ditugaskan')}</option>{guides.map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}</select></Field>
      <Field label={t('Departure Time','Masa Berlepas')}><input aria-label="Departure Time" type="time" className={inputClass} value={departure} onChange={e=>setDeparture(e.target.value)} /></Field>
    </fieldset>
  </Modal>;
}
