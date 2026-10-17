import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, RefreshCw, Pencil, History, ShieldCheck, Ship, Bus, Search, Check, Sparkles } from 'lucide-react';
import { Badge } from '../../components/Page';
import { Field, inputClass, buttonClass, secondaryButtonClass } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { useAccess } from '../../lib/access';
import { supabase } from '../../lib/supabase';
import { todayIso, readErrorMessage } from '../../lib/opsData';
import { useSharedRefresh } from '../../lib/useSharedRefresh';
import { useBusinessDate } from '../../lib/useBusinessDate';
import { bookingCounts, countKeys, countLabels, emptyCounts, travelTotal, type DailyBooking, type DailySheet, type TravelCounts } from '../../lib/bookingOperations';
import BookingAccounts from './BookingAccounts';
import BookingSpreadsheet from './BookingSpreadsheet';
import WeeklyBookingSheet from './WeeklyBookingSheet';
import { BookingDateNavigation } from '../../components/BookingDateNavigation';
import PassengerBreakdown from '../../components/PassengerBreakdown';
import '../../daily-sheet.css';
import { plannedStaff, suggestBoats, type BoatPlanLine } from '../../lib/boatPlanning';
import { prepareSaveAttempt, definitiveSaveFailure, type SaveAttempt } from '../../lib/saveAttempt';

type Changes = Record<string, unknown>;
type Save = (name: string, args: Changes) => Promise<boolean>;
const iconButton = 'sheet-icon';
const countsTitle = 'A: Adults; C: Children; I: Infants; T/L: Local Tour Leaders; TG: China Tour Guides';
const live = (b: DailyBooking) => !['cancelled','no_show'].includes(b.status);

export default function DailyBookingSheet() {
  const { can, profile } = useAccess(); const toast = useToast();
  const [date,setDate]=useBusinessDate('guests');const [sheet,setSheet]=useState<DailySheet|null>(null);
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [view,setView]=useState('bookings');const [query,setQuery]=useState('');
  const [editing,setEditing]=useState<DailyBooking|'new'|null>(null);const [history,setHistory]=useState<DailyBooking|null>(null);const [access,setAccess]=useState(false);
  const [review,setReview]=useState<DailySheet|null>(null);
  const [layout,setLayout]=useState('spreadsheet');const [unsaved,setUnsaved]=useState(false);
  const [period,setPeriod]=useState<'day'|'week'>(()=>{try{return sessionStorage.getItem('booking-sheet-period')==='week'?'week':'day';}catch{return 'day';}});const [sheetBusy,setSheetBusy]=useState(false);const [draftSafe,setDraftSafe]=useState(true);
  const navigationLocked=busy||sheetBusy||!draftSafe;
  useEffect(()=>{try{sessionStorage.setItem('booking-sheet-date',date);sessionStorage.setItem('booking-sheet-period',period);}catch{/* The selected date is an optional tab preference. */}},[date,period]);
  const sequence=useRef(0);const saving=useRef(false);const attempts=useRef(new Map<string,SaveAttempt>());
  const reload=useCallback(async()=>{
    const id=++sequence.current;
    const {data,error}=await supabase.rpc('read_daily_booking_sheet',{p_date:date});
    if(id!==sequence.current)return;
    if(error){setError(error.message);setSheet(null);}else{setSheet(data as DailySheet);setError('');}
  },[date]);
  useEffect(()=>{setSheet(null);void reload();},[reload]);
  useSharedRefresh(()=>!saving.current?reload():undefined,{tables:['bookings','boat_assignments','pickup_groups','trip_bookings'],intervalMs:15000});
  const save:Save=async(name,args)=>{
    if(saving.current)return false;saving.current=true;setBusy(true);
    const {key,payload}=prepareSaveAttempt(attempts.current,name,args);
    try{const {error}=await supabase.rpc(name,payload);if(error)throw error;attempts.current.delete(key);await reload();toast.success('Saved');return true;}
    catch(error){if(definitiveSaveFailure(error))attempts.current.delete(key);toast.error(readErrorMessage(error));await reload();return false;}finally{saving.current=false;setBusy(false);}
  };
  const assign=(b:DailyBooking,changes:Changes)=>save('save_departure_assignment',{p_date:date,p_booking_id:b.id,p_expected_updated_at:b.updated_at,p_changes:changes});
  const canPlan=can('fleet.assign')||can('guests.plan.manage');
  const bookings=sheet?.bookings??[];const active=bookings.filter(live);
  const total=active.reduce((n,b)=>n+b.pax_total,0);const assigned=active.filter(b=>b.assignment_id).reduce((n,b)=>n+b.pax_total,0);
  const rows=bookings.filter(b=>[b.lead_name,b.pickup_hotel_name,b.booking_ref,b.ops_notes].join(' ').toLowerCase().includes(query.toLowerCase()));
  const resource=(kind:string,id:string,run?:DailySheet['runs'][number],driver?:string)=>save('save_sheet_resource',{p_date:date,p_kind:kind,p_id:run?.id??null,p_resource_id:id,p_driver:driver||null,p_expected_updated_at:run?.updated_at??null});
  return <div className="daily-sheet">
    <header className={`booking-workspace-heading ${period==='week'?'booking-week-heading':''}`}>
      <h1>{period==='week'?'Weekly Booking Sheet':'Daily Booking Sheet'}</h1>
      {period==='day'&&sheet&&!error?<dl className="booking-workspace-summary" aria-label="Booking Summary">
        <div><dd>{total}</dd><dt>Passengers</dt></div>
        <div><dd>{active.length}</dd><dt>Bookings</dt></div>
        <div className={total-assigned?'text-warning':'text-palm'} title={assigned+' Assigned to Boats'}><dd>{total-assigned}</dd><dt>Waiting</dt></div>
      </dl>:null}
      <div className="booking-workspace-actions">
      {period==='day'&&view==='bookings'&&canPlan?<button title="Suggest Boats" aria-label="Suggest Boats" className={secondaryButtonClass} disabled={unsaved||busy||!active.some(b=>!b.assignment_id)} onClick={()=>sheet&&setReview(structuredClone(sheet))}><Sparkles size={16}/><span className="hidden sm:inline">Suggest Boats</span></button>:null}
      {can('platform.users.manage')?<button aria-label="Planner Access" title="Planner Access" className={secondaryButtonClass} onClick={()=>setAccess(true)}><ShieldCheck size={16}/><span className="hidden sm:inline">Planner Access</span></button>:null}
      {period==='day'&&can('guests.sheet.write')&&(layout==='list'||view!=='bookings')?<button disabled={navigationLocked} className={secondaryButtonClass} onClick={()=>setEditing('new')}><Plus size={16}/> Add Booking</button>:null}
      </div>
    </header>
    <BookingDateNavigation date={date} onDate={setDate} period={period} onPeriod={setPeriod} disabled={navigationLocked}/>
    {period==='day'?<div className="sheet-toolbar booking-sheet-sections">
      <div className="sheet-tabs" role="tablist" aria-label="Daily Sheet Views">
        <button role="tab" disabled={navigationLocked} aria-selected={view==='bookings'&&layout==='spreadsheet'} onClick={()=>{setView('bookings');setLayout('spreadsheet');}}>Spreadsheet</button>
        <button role="tab" disabled={navigationLocked} aria-selected={view==='bookings'&&layout==='list'} onClick={()=>{setView('bookings');setLayout('list');}}>List</button>
        <button role="tab" disabled={navigationLocked} aria-label="Boats & Vans" aria-selected={view==='boats'} onClick={()=>setView('boats')}><span className="sm:hidden">Transport</span><span className="hidden sm:inline">Boats & Vans</span></button>
        {can('guests.finance.manage')?<button role="tab" disabled={navigationLocked} aria-selected={view==='accounts'} onClick={()=>setView('accounts')}>Accounts</button>:null}
      </div>
      {period==='day'?<button className={iconButton} title="Refresh" aria-label="Refresh Sheet" disabled={navigationLocked} onClick={()=>void reload()}><RefreshCw size={17}/></button>:null}
    </div>:null}
    {period==='week'?<WeeklyBookingSheet key={profile?.id} date={date} onDirty={setUnsaved} onBusy={setSheetBusy} onDraftSafe={setDraftSafe} onHistory={setHistory} onAccounts={d=>{setDate(d);setPeriod('day');setView('accounts');}}/>:error?<p role="alert" className="sheet-alert">{error}</p>:!sheet?<p role="status">Loading bookings...</p>:<>
      {sheet.restricted?<p className="sheet-restricted"><ShieldCheck size={16}/> Planning Access Only <span>{date}</span></p>:null}
      {sheet.contacts_hidden?<p role="status" className="sheet-restricted"><ShieldCheck size={16}/>{sheet.names_hidden?'Guest names and contacts are private for this date.':'Guest contacts are private for this date.'}</p>:null}
      {view==='accounts'?<BookingAccounts date={date} bookings={bookings}/>:view==='bookings'&&layout==='spreadsheet'?<BookingSpreadsheet key={`${date}:${profile?.id}`} date={date} sheet={sheet} reload={reload} onDirty={setUnsaved} onBusy={setSheetBusy} onDraftSafe={setDraftSafe} onHistory={setHistory} onAccounts={()=>setView('accounts')}/>:view==='bookings'?<>
        <div className="sheet-list-toolbar"><label className="sheet-search"><Search size={16}/><input aria-label="Find Booking" placeholder="Name or pickup location" value={query} onChange={e=>setQuery(e.target.value)}/></label><span className="text-xs text-muted">{rows.length} Bookings</span></div>
        <div className="sheet-booking-heading" aria-hidden="true"><span>Booking & Passengers</span><span>Pickup & Tour</span><span>Boat / Local Guide / Van</span><span>Record</span></div>
        <div>{rows.map(b=><article key={b.id} data-booking-id={b.id} className={`sheet-booking-row ${live(b)?'':'opacity-60'}`}>
          <div className="sheet-person"><div className="flex items-start justify-between gap-2"><strong>{b.lead_name}</strong><Badge tone={b.planning_group==='xhs'?'accent':'neutral'}>{b.planning_group==='xhs'?'XHS':b.planning_group==='private'?'Private':`${b.pax_total} pax`}</Badge></div>
            <PassengerBreakdown counts={b}/><span className="sheet-ref">{b.booking_ref}{!live(b)?` · ${b.status}`:''}</span>
            {!sheet.restricted&&b.lead_phone?<a className="sheet-ref" href={`tel:${b.lead_phone.replace(/[^+\d]/g,'')}`}>{b.lead_phone}</a>:null}
          </div>
          <div className="sheet-pickup"><strong>{b.pickup_required?(b.pickup_hotel_name||'Pickup Location Needed'):'Own Transport'}</strong>{b.pickup_area?<span>{b.pickup_area}</span>:null}
            <span>{b.pickup_time?.slice(0,5)||'Time TBA'}{b.dropoff_location?` · Return: ${b.dropoff_location}`:''}</span><span>{b.tour_name}</span>{b.ops_notes?<p className="sheet-note">{b.ops_notes}</p>:null}
          </div>
          <fieldset className="sheet-assignment" disabled={!canPlan||busy||!live(b)}>
            <label>Boat<select aria-label={`Boat for ${b.lead_name}`} value={b.assignment_id??''} onChange={e=>void assign(b,{assignment_id:e.target.value||null})}><option value="">Not Assigned</option>{sheet.boats.map(a=><option key={a.id} value={a.id} disabled={a.locked||a.status!=='planned'||(a.id!==b.assignment_id&&a.capacity_pax-a.guest_pax-a.staff_pax<b.pax_total)}>{a.code} · {a.capacity_pax-a.guest_pax-a.staff_pax} Free</option>)}</select></label>
            <label>Local Guide<select aria-label={`Local Guide for ${b.lead_name}`} value={b.guide_employee_id??''} onChange={e=>void assign(b,{guide_employee_id:e.target.value||null})}><option value="">Not Assigned</option>{sheet.employees.filter(e=>e.job_type==='guide').map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}</select></label>
            <label>Van<select aria-label={`Van for ${b.lead_name}`} value={b.pickup_group_id??''} disabled={!b.pickup_required} onChange={e=>void assign(b,{pickup_group_id:e.target.value||null})}><option value="">{b.pickup_required?'Not Assigned':'Own Transport'}</option>{sheet.runs.map(g=><option key={g.id} value={g.id} disabled={g.status!=='planned'}>{sheet.vehicles.find(v=>v.id===g.vehicle_id)?.code??g.name}</option>)}</select></label>
          </fieldset>
          <div className="sheet-record"><span>{b.updated_by_name?`Updated: ${b.updated_by_name}`:`Entered: ${b.creator_name??'Not Recorded'}`}</span><div className="flex gap-1">
            {can('guests.sheet.write')&&!b.contacts_hidden?<button className={iconButton} title="Edit Booking" aria-label={`Edit ${b.lead_name}`} onClick={()=>setEditing(b)}><Pencil size={16}/></button>:null}
            <button className={iconButton} title="Change History" aria-label={`History for ${b.lead_name}`} onClick={()=>setHistory(b)}><History size={16}/></button>
          </div></div>
        </article>)}</div>
        {!rows.length?<p className="sheet-empty">No bookings for this selection.</p>:null}
      </>:<>
        <div className="sheet-section-heading"><h2><Ship size={18}/> Boats <span>{sheet.boats.length}</span></h2>{canPlan?<select aria-label="Add Boat" className={inputClass} value="" disabled={busy} onChange={e=>void resource('boat',e.target.value)}><option value="">+ Add Boat</option>{sheet.available_boats.filter(b=>!sheet.boats.some(a=>a.boat_id===b.id)).map(b=><option value={b.id} key={b.id}>{b.code} · {b.capacity_pax} Onboard Max</option>)}</select>:null}</div>
        {sheet.boats.map(a=><section className="sheet-boat" key={a.id}>
          <div className="sheet-boat-heading"><h3>{a.code}</h3><strong className={a.guest_pax+a.staff_pax>a.capacity_pax?'text-danger':'text-accent'}>{a.guest_pax+a.staff_pax} / {a.capacity_pax} Onboard</strong><span>{a.guest_pax} Passengers · {a.staff_pax} Staff / Reserved</span>{a.locked?<Badge>Locked</Badge>:null}</div>
          <fieldset disabled={!canPlan||busy||a.locked||a.status!=='planned'} className="sheet-crew">
            <label>Captain<select aria-label={`Captain for ${a.code}`} value={a.captain_employee_id??''} onChange={e=>void save('save_sheet_boat',{p_date:date,p_assignment_id:a.id,p_expected_updated_at:a.updated_at,p_captain:e.target.value||null,p_crew:a.crew_employee_ids})}><option value="">Unassigned · 1 Seat Reserved</option>{sheet.employees.filter(e=>e.job_type==='captain').map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}</select></label>
            <div><span className="sheet-label">Boat Crew{a.crew_employee_ids.length?'':' · 1 Seat Reserved'}</span><div className="sheet-crew-options">{sheet.employees.filter(e=>e.job_type==='crew').map(e=><label key={e.id}><input type="checkbox" checked={a.crew_employee_ids.includes(e.id)} onChange={ev=>void save('save_sheet_boat',{p_date:date,p_assignment_id:a.id,p_expected_updated_at:a.updated_at,p_captain:a.captain_employee_id,p_crew:ev.target.checked?[...a.crew_employee_ids,e.id]:a.crew_employee_ids.filter(id=>id!==e.id)})}/>{e.full_name}</label>)}</div></div>
          </fieldset>
          <div className="sheet-boat-manifest">{active.filter(b=>b.assignment_id===a.id).map(b=><div key={b.id}><strong>{b.lead_name}</strong><PassengerBreakdown counts={b}/><span>{b.pickup_hotel_name||'Own Transport'}</span><strong>{b.pax_total} pax</strong></div>)}</div>
          {!active.some(b=>b.assignment_id===a.id)?<p className="sheet-empty">No bookings assigned.</p>:null}
        </section>)}
        {!sheet.boats.length?<p className="sheet-empty">No boats added for this date.</p>:null}
        <div className="sheet-section-heading"><h2><Bus size={18}/> Vans <span>{sheet.runs.length}</span></h2>{canPlan?<select aria-label="Add Van" className={inputClass} value="" disabled={busy} onChange={e=>void resource('van',e.target.value)}><option value="">+ Add Van</option>{sheet.vehicles.filter(v=>!sheet.runs.some(g=>g.vehicle_id===v.id)).map(v=><option key={v.id} value={v.id}>{v.code} · {v.capacity_pax} Passenger Seats</option>)}</select>:null}</div>
        {sheet.runs.map(g=><div key={g.id} className="sheet-van"><div><strong>{sheet.vehicles.find(v=>v.id===g.vehicle_id)?.code??g.name}</strong><span>{active.filter(b=>b.pickup_group_id===g.id).reduce((n,b)=>n+b.pax_total,0)} Passengers</span></div><label>Driver<select aria-label={`Driver for ${g.name}`} disabled={!canPlan||busy||g.status!=='planned'} value={g.driver_employee_id??''} onChange={e=>void resource('van',g.vehicle_id!,g,e.target.value)}><option value="">Not Assigned</option>{sheet.employees.filter(e=>e.job_type==='driver').map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}</select></label></div>)}
      </>}
    </>}
    {editing&&sheet?<BookingForm key={editing==='new'?'new':editing.id} date={date} booking={editing==='new'?null:editing} sheet={sheet} busy={busy} save={save} onClose={()=>!busy&&setEditing(null)}/>:null}
    {history?<HistoryDialog booking={history} onClose={()=>setHistory(null)}/>:null}
    {access?<PlannerAccess date={date} onClose={()=>setAccess(false)}/>:null}
    {review?<PlanReview sheet={review} busy={busy} onClose={()=>!busy&&setReview(null)} onConfirm={async lines=>{if(await save('confirm_sheet_boat_plan',{p_date:date,p_expected:{bookings:review.bookings,boats:review.boats},p_lines:lines})){setReview(null);setView('boats');}}}/>:null}
  </div>;
}

function BookingForm({date,booking,sheet,busy,save,onClose}:{date:string;booking:DailyBooking|null;sheet:DailySheet;busy:boolean;save:Save;onClose:()=>void}) {
  const [form,setForm]=useState({lead_name:booking?.lead_name??'',lead_phone:booking?.lead_phone??'',pickup_hotel_name:booking?.pickup_hotel_name??'',pickup_area:booking?.pickup_area??'',pickup_required:booking?.pickup_required??true,pickup_time:booking?.pickup_time?.slice(0,5)??'',tour_name:booking?.tour_name??'Lovely Paradise Day Trip',dropoff_location:booking?.dropoff_location??'',agency_id:booking?.agency_id??'',source_type:booking?.source_type??'in_house',planning_group:booking?.planning_group??'standard',ops_notes:booking?.ops_notes??''});
  const [counts,setCounts]=useState<TravelCounts>(booking?bookingCounts(booking):{...emptyCounts});
  const total=travelTotal(counts);const change=(key:keyof typeof form,value:unknown)=>setForm(f=>({...f,[key]:value}));
  const submit=async(e:React.FormEvent)=>{e.preventDefault();if(await save('save_daily_booking',{p_date:date,p_booking_id:booking?.id??null,p_expected_updated_at:booking?.updated_at??null,p_changes:{...form,agency_id:form.agency_id||null,counts}}))onClose();};
  return <Modal title={booking?'Edit Booking':'Add Booking'} onClose={onClose} footer={<div className="flex items-center justify-between gap-3"><strong>{total} Passengers</strong><button form="daily-booking-form" className={buttonClass} disabled={busy||total<1}><Check size={16}/>{busy?'Saving...':'Save Booking'}</button></div>}>
    <form id="daily-booking-form" onSubmit={submit} className="daily-sheet sheet-form"><fieldset disabled={busy}>
      <div className="sheet-form-grid"><Field label="Booking / Group Name"><input required className={inputClass} value={form.lead_name} onChange={e=>change('lead_name',e.target.value)}/></Field><Field label="Contact Number"><input type="tel" className={inputClass} value={form.lead_phone} onChange={e=>change('lead_phone',e.target.value)}/></Field></div>
      <div className="sheet-count-inputs" title={countsTitle}>{countKeys.map((key,i)=><label key={key}>{['Adults','Children','Infants','TL (Local)','TG (China)'][i]}<input aria-label={countLabels[key]} inputMode="numeric" type="number" min="0" max="500" value={counts[key]||''} placeholder="0" onChange={e=>setCounts(c=>({...c,[key]:Number(e.target.value)}))}/></label>)}</div>
      <div className="sheet-form-grid"><Field label="Agency"><select className={inputClass} value={form.agency_id} onChange={e=>{change('agency_id',e.target.value);change('source_type',e.target.value?'agent':'in_house');}}><option value="">Direct Booking</option>{sheet.agencies.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></Field><Field label="Planning Group"><select className={inputClass} value={form.planning_group} onChange={e=>change('planning_group',e.target.value)}><option value="standard">Standard</option><option value="xhs">XHS · Prefer Same Boat</option><option value="private">Private Group</option></select></Field></div>
      <label className="sheet-toggle"><input type="checkbox" checked={form.pickup_required} onChange={e=>change('pickup_required',e.target.checked)}/> Pickup Required</label>
      <div className="sheet-form-grid"><Field label="Pickup Location"><input disabled={!form.pickup_required} className={inputClass} placeholder="Hotel, street or building" value={form.pickup_hotel_name} onChange={e=>change('pickup_hotel_name',e.target.value)}/></Field><Field label="Area"><input className={inputClass} value={form.pickup_area} onChange={e=>change('pickup_area',e.target.value)}/></Field><Field label="Pickup Time"><input type="time" disabled={!form.pickup_required} className={inputClass} value={form.pickup_time} onChange={e=>change('pickup_time',e.target.value)}/></Field><Field label="Drop-off Location"><input className={inputClass} value={form.dropoff_location} onChange={e=>change('dropoff_location',e.target.value)}/></Field></div>
      <Field label="Tour"><input className={inputClass} value={form.tour_name} onChange={e=>change('tour_name',e.target.value)}/></Field>
      <Field label="Shared Planning Remarks"><textarea className={inputClass} rows={2} value={form.ops_notes} onChange={e=>change('ops_notes',e.target.value)}/></Field>
    </fieldset></form>
  </Modal>;
}

function HistoryDialog({booking,onClose}:{booking:DailyBooking;onClose:()=>void}) {
  const [rows,setRows]=useState<{actor:string;action:string;created_at:string;details:unknown}[]>([]);const [error,setError]=useState('');
  useEffect(()=>{void (async()=>{const {data,error}=await supabase.rpc('read_booking_change_log',{p_booking_id:booking.id});if(error)setError(error.message);else setRows(data??[]);})();},[booking.id]);
  return <Modal title={`Change History: ${booking.lead_name}`} onClose={onClose}><div className="daily-sheet">{error?<p role="alert">{error}</p>:rows.length?rows.map((r,i)=><div className="sheet-history" key={i}><strong>{r.actor}</strong><span>{r.action.split('_').join(' ')}</span><time>{new Date(r.created_at).toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur'})} MYT</time></div>):<p>No changes recorded.</p>}</div></Modal>;
}
function PlannerAccess({date,onClose}:{date:string;onClose:()=>void}) {
  const [rows,setRows]=useState<{id:string;full_name:string;allowed:boolean}[]>([]);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const load=async(id?:string,allow?:boolean)=>{setBusy(true);const {data,error}=await supabase.rpc('sheet_planner_access',{p_date:date,p_user_id:id??null,p_allow:allow??false});setBusy(false);if(error)setError(error.message);else{setRows(data??[]);setError('');}};
  useEffect(()=>{void load();},[date]);
  return <Modal title={`Planner Access: ${date}`} onClose={onClose}><div className="daily-sheet"><p className="sheet-restricted">Approved Date Only · No Financial Access</p>{error?<p role="alert">{error}</p>:null}{rows.map(r=><label className="sheet-toggle" key={r.id}><input type="checkbox" disabled={busy} checked={r.allowed} onChange={e=>void load(r.id,e.target.checked)}/>{r.full_name}</label>)}{!rows.length&&!busy?<p>No named External Departure Planner accounts. Create and approve the person's account under Admin & Access first.</p>:null}</div></Modal>;
}

function PlanReview({sheet,busy,onClose,onConfirm}:{sheet:DailySheet;busy:boolean;onClose:()=>void;onConfirm:(lines:BoatPlanLine[])=>Promise<void>}) {
  const [lines,setLines]=useState(()=>suggestBoats(sheet));
  const active=sheet.bookings.filter(live);
  const members=(id:string)=>active.filter(b=>b.assignment_id===id||lines.some(l=>l.booking_id===b.id&&l.assignment_id===id));
  const overload=sheet.boats.some(a=>members(a.id).reduce((n,b)=>n+b.pax_total,0)+plannedStaff(a,members(a.id))>a.capacity_pax);
  const chosen=lines.filter(l=>l.assignment_id);const waiting=lines.filter(l=>!l.assignment_id);
  return <Modal title="Review Suggested Boats" onClose={onClose} wide footer={<div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm">{chosen.length} Bookings to Assign · {waiting.length} Still Waiting</span><button className={buttonClass} disabled={busy||overload||!chosen.length} onClick={()=>void onConfirm(chosen)}><Check size={16}/> Confirm Boat Plan</button></div>}>
    <div className="daily-sheet"><p className="sheet-note">XHS grouping and pickup proximity are preferences. Existing assignments stay in place.</p>{overload?<p role="alert" className="sheet-alert">A boat exceeds its onboard limit. Move a group before confirming.</p>:null}
      {!sheet.boats.length?<p className="sheet-alert">Add the available boats under Boats & Vans first.</p>:null}
      {sheet.boats.map(a=>{const rows=members(a.id);return <section className="sheet-boat" key={a.id}><div className="sheet-boat-heading"><h3>{a.code}</h3><strong>{rows.reduce((n,b)=>n+b.pax_total,0)+plannedStaff(a,rows)} / {a.capacity_pax} Onboard</strong><span>{plannedStaff(a,rows)} Staff / Reserved</span></div>{rows.map(b=><div className="sheet-plan-row" key={b.id}><div><strong>{b.lead_name}</strong><PassengerBreakdown counts={b}/><span>{b.pickup_hotel_name||'Own Transport'}{b.pickup_area?` · ${b.pickup_area}`:''}</span></div>{b.assignment_id?<Badge>Already Assigned</Badge>:<label className="sheet-plan-select">Boat<select disabled={busy} aria-label={`Suggested Boat for ${b.lead_name}`} value={a.id} onChange={e=>setLines(ls=>ls.map(l=>l.booking_id===b.id?{...l,assignment_id:e.target.value||null}:l))}><option value="">Keep Waiting</option>{sheet.boats.filter(x=>!x.locked&&x.status==='planned').map(x=><option key={x.id} value={x.id}>{x.code}</option>)}</select></label>}</div>)}</section>;})}
      {waiting.length?<><h3 className="sheet-subheading">Still Waiting</h3>{waiting.map(l=>{const b=active.find(b=>b.id===l.booking_id)!;return <div className="sheet-plan-row" key={b.id}><div><strong>{b.lead_name} · {b.pax_total} pax</strong><span>{b.pickup_hotel_name||'Own Transport'}</span></div><label className="sheet-plan-select">Boat<select disabled={busy} value="" aria-label={`Suggested Boat for ${b.lead_name}`} onChange={e=>setLines(ls=>ls.map(x=>x.booking_id===b.id?{...x,assignment_id:e.target.value||null}:x))}><option value="">Keep Waiting</option>{sheet.boats.filter(x=>!x.locked&&x.status==='planned').map(a=><option key={a.id} value={a.id}>{a.code}</option>)}</select></label></div>;})}</>:null}
    </div>
  </Modal>;
}
