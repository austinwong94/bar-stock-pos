import { db, can, require as requirePermission, currentUserIdRef } from './demoBackend';
import { TODAY, demoUsers, demoAgencies, demoEmployees } from './demoSeed';
import { accountTotals, countKeys, emptyCounts, type BookingAccount, type BookingPayment, type TravelCounts } from './bookingOperations';

type Row = Record<string, any>;
const uid = () => crypto.randomUUID();
const actor = () => currentUserIdRef.value;
const actorName = (id: string) => db.profiles.find(p => p.id === id)?.full_name ?? 'Unknown User';
let lastStamp = 0;
const stamp = () => new Date(lastStamp = Math.max(Date.now(), lastStamp + 1)).toISOString();
const external = () => db.profiles.find(p => p.id === actor())?.access_role_code === 'external_planner';
const demand = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
function dateAccess(date: string) {
  demand(/^\d{4}-\d{2}-\d{2}$/.test(date ?? ''), 'Choose a service date.');
  if (external()) {
    requirePermission('guests.plan.manage');
    demand(db.departure_planner_access.some(a => a.user_id === actor() && a.service_date === date), 'You have no planning access for this date.');
  } else requirePermission('guests.sheet.view');
}
function version(row: Row | undefined, expected: string | null) {
  if ((row?.updated_at ?? null) !== expected) throw Object.assign(new Error('Changed on another device. Reload before saving.'), { code: '40001' });
}
function audit(action: string, id: string, before: unknown, after: unknown, entity = 'booking') {
  db.audit_logs.push({ id: uid(), actor_id: actor(), action, entity_type: entity, entity_id: id, before_json: structuredClone(before), after_json: structuredClone(after), created_at: stamp() });
}
function once(operation: string, p: Row, task: () => string) {
  demand(p.p_request_id, 'A save reference is required.');
  const fingerprint = JSON.stringify(p);
  const prior = db.operation_requests.find(r => r.actor_id === actor() && r.operation === operation && r.request_id === p.p_request_id);
  if (prior) { demand(prior.payload_hash === fingerprint, 'Save reference changed.'); return prior.result_id; }
  const result = task();
  db.operation_requests.push({ actor_id: actor(), operation, request_id: p.p_request_id, payload_hash: fingerprint, result_id: result });
  return result;
}
export function recountTravelers(bookingId: string) {
  const b = db.bookings.find(x => x.id === bookingId);
  if (!b) return;
  const people = db.tourists.filter(t => t.booking_id === bookingId);
  const counts = { ...emptyCounts };
  for (const t of people) {
    const key = t.traveller_role === 'tour_leader' ? 'tour_leaders' : t.traveller_role === 'tour_guide' ? 'tour_guides' : t.age_band === 'child' ? 'children' : t.age_band === 'infant' ? 'infants' : 'adults';
    counts[key]++;
  }
  countKeys.forEach(key => { b[`pax_${key}`] = counts[key]; });
  b.pax_total = people.length; b.pax_elderly = 0;
}
export function demoStaffPax(a: Row) {
  return new Set([a.captain_employee_id, a.guide_employee_id, ...(a.crew_employee_ids ?? []),
    ...db.trip_bookings.filter(t => t.assignment_id === a.id).map(t => db.bookings.find(b => b.id === t.booking_id)?.guide_employee_id)].filter(Boolean)).size
    + (a.captain_employee_id ? 0 : 1) + (a.crew_employee_ids?.length ? 0 : 1);
}
export function checkDemoOnboard(id: string) {
  const a = db.boat_assignments.find(x => x.id === id);
  demand(a, 'Boat not found.');
  const limit = Math.min(43, db.boats.find(b => b.id === a!.boat_id)?.capacity_pax ?? 0);
  const pax = db.trip_bookings.filter(t => t.assignment_id === id).reduce((n, t) => n + (db.bookings.find(b => b.id === t.booking_id && !['cancelled','no_show'].includes(b.status))?.pax_total ?? 0), 0);
  demand(pax + demoStaffPax(a!) <= limit, `Boat capacity exceeded: ${pax} passengers + ${demoStaffPax(a!)} staff/reserved seats; maximum ${limit} onboard.`);
}
function syncBookingPassengers(b: Row) {
  const link = db.trip_bookings.find(t => t.booking_id === b.id);
  db.trip_passengers = db.trip_passengers.filter(p => p.booking_id !== b.id || (link?.assignment_id === p.assignment_id && db.tourists.some(t => t.id === p.tourist_id)));
  if (link) for (const t of db.tourists.filter(t => t.booking_id === b.id)) {
    if (!db.trip_passengers.some(p => p.tourist_id === t.id && p.assignment_id === link.assignment_id)) db.trip_passengers.push({ id: uid(), assignment_id: link.assignment_id, booking_id: b.id, tourist_id: t.id, boarding_status: 'pending', activity_code: null, activity_status: 'pending', returned: false });
  }
}
function initialized() {
  for(const user of demoUsers) if(!db.profiles.some(p=>p.id===user.id))db.profiles.push({...user,role:'staff',status:user.access_role_code==='pending'?'pending':'active',created_at:stamp()});
  for(const agency of demoAgencies)if(!db.agencies.some(a=>a.id===agency.id))db.agencies.push({...agency});
  for(const employee of demoEmployees)if(!db.employees.some(e=>e.id===employee.id))db.employees.push({...employee});
  for (const name of ['operation_requests','departure_planner_access','booking_accounts','booking_payments','referral_parties']) db[name] ??= [];
  if (!db.referral_parties.some(r => r.is_default)) db.referral_parties.push({ id: uid(), name: 'General Commission', method: null, rate: null, is_default: true, active: true, updated_at: stamp() });
  for (const code of ['guests.sheet.view','guests.sheet.write','guests.plan.manage','guests.finance.manage']) {
    if (!db.permissions.some(p => p.code === code)) db.permissions.push({ code, department_code: 'guests', name: code, sensitive: true });
  }
  if (!db.access_roles.some(r => r.code === 'external_planner')) db.access_roles.push({ code: 'external_planner', name: 'External Departure Planner', description: 'Approved dates only. No financial access.', is_master: false, is_system: true, sort_order: 20 });
  for (const [role, codes] of Object.entries({ external_planner: ['guests.plan.manage'], coordinator: ['guests.sheet.view','guests.sheet.write'], operations_manager: ['guests.sheet.view','guests.sheet.write'], accountant: ['guests.sheet.view','guests.finance.manage'] })) {
    for (const code of codes) if (!db.access_role_permissions.some(r => r.role_code === role && r.permission_code === code)) db.access_role_permissions.push({ role_code: role, permission_code: code });
  }
  for (const b of db.bookings) { recountTravelers(b.id); b.tour_name ??= 'Lovely Paradise Day Trip'; b.dropoff_location ??= ''; b.planning_group ??= 'standard'; b.ops_notes ??= ''; }
  for (const a of db.boat_assignments) { a.crew_employee_ids ??= []; a.updated_at ??= stamp(); }
}
initialized();

const handlers: Record<string, (p: Row) => any> = {
  save_booking_sheet_range(p) {
    demand(Array.isArray(p.p_days)&&p.p_days.length>=1&&p.p_days.length<=7,'Choose 1-7 booking days.');
    const dates=p.p_days.map((d:Row)=>d.p_date).sort();
    demand(new Set(dates).size===dates.length,'A date appears twice in this save.');
    demand((Date.parse(dates.at(-1))-Date.parse(dates[0]))/86400000<=6,'Save one seven-day period at a time.');
    for(const d of dates)dateAccess(d);
    once('booking_sheet_range',p,()=>{const days=p.p_days.map((day:Row)=>({date:day.p_date,rows:handlers.save_booking_spreadsheet({...day,p_request_id:uid()})}));audit('booking_sheet_range',p.p_request_id,null,{days},'booking_sheet');return p.p_request_id;});
    return db.audit_logs.find(a=>a.entity_id===p.p_request_id&&a.actor_id===actor()&&a.action==='booking_sheet_range')?.after_json.days;
  },
  save_booking_spreadsheet(p) {
    dateAccess(p.p_date);
    demand(Array.isArray(p.p_rows)&&p.p_rows.length>0&&p.p_rows.length<=200,'Choose 1-200 changed booking rows.');
    let result:Row[]=[];
    once('booking_spreadsheet',p,()=>{
      demand(new Set(p.p_rows.map((r:Row)=>r.key)).size===p.p_rows.length,'A booking appears twice.');
      const ids=p.p_rows.map((r:Row)=>r.id).filter(Boolean);demand(new Set(ids).size===ids.length,'A booking appears twice.');
      for(const res of p.p_resources.boats??[]){
        let a=db.boat_assignments.find(a=>a.service_date===p.p_date&&a.boat_id===res.boat_id&&a.status!=='cancelled');version(a,res.expected);
        if(!a){const id=handlers.save_sheet_resource({p_date:p.p_date,p_kind:'boat',p_id:null,p_resource_id:res.boat_id,p_driver:null,p_expected_updated_at:null,p_request_id:uid()});a=db.boat_assignments.find(x=>x.id===id);}
        if('captain' in res||'crew' in res)handlers.save_sheet_boat({p_date:p.p_date,p_assignment_id:a!.id,p_expected_updated_at:a!.updated_at,p_captain:'captain' in res?res.captain:a!.captain_employee_id,p_crew:res.crew??a!.crew_employee_ids,p_request_id:uid()});
      }
      for(const res of p.p_resources.vans??[]){const g=db.pickup_groups.find(g=>g.service_date===p.p_date&&g.vehicle_id===res.vehicle_id&&g.status!=='cancelled');version(g,res.expected);handlers.save_sheet_resource({p_date:p.p_date,p_kind:'van',p_id:g?.id??null,p_resource_id:res.vehicle_id,p_driver:'driver' in res?res.driver:g?.driver_employee_id??null,p_expected_updated_at:g?.updated_at??null,p_request_id:uid()});}
      for(const row of p.p_rows){try{
        let id=row.id;const existing=db.bookings.find(b=>b.id===id&&b.service_date===p.p_date);version(existing,row.expected);
        if(!id||Object.keys(row.booking??{}).length)id=handlers.save_daily_booking({p_date:p.p_date,p_booking_id:id,p_expected_updated_at:row.expected,p_changes:row.booking,p_request_id:uid()});
        const b=db.bookings.find(b=>b.id===id)!;const assignment={...row.assignment};
        if('boat_id' in assignment){assignment.assignment_id=assignment.boat_id?db.boat_assignments.find(a=>a.boat_id===assignment.boat_id&&a.service_date===p.p_date&&a.status==='planned')?.id:null;demand(!assignment.boat_id||assignment.assignment_id,'Choose a planned boat.');delete assignment.boat_id;}
        if('vehicle_id' in assignment){assignment.pickup_group_id=assignment.vehicle_id?db.pickup_groups.find(g=>g.vehicle_id===assignment.vehicle_id&&g.service_date===p.p_date&&g.status==='planned')?.id:null;demand(!assignment.vehicle_id||assignment.pickup_group_id,'Choose a planned van.');delete assignment.vehicle_id;}
        if(Object.keys(assignment).length)handlers.save_departure_assignment({p_date:p.p_date,p_booking_id:id,p_expected_updated_at:b.updated_at,p_changes:assignment,p_request_id:uid()});
        const f=row.finance??{};
        if(Object.keys(f).length){requirePermission('guests.finance.manage');let a=db.booking_accounts.find(a=>a.booking_id===id);version(a,row.account_expected);const before=structuredClone(a??null);
          if(!a){a={booking_id:id,amount_due:null,invoice_number:'',remarks:'',referrer_id:null,commission_method:null,commission_rate:null,commission_base:null,commission_pax:0,commission_paid:0};db.booking_accounts.push(a);}
          if('amount_due' in f){demand(f.amount_due===null||(Number.isFinite(f.amount_due)&&f.amount_due>=0&&Math.abs(f.amount_due*100-Math.round(f.amount_due*100))<1e-7),'Enter a valid RM total with at most two decimals.');a.amount_due=f.amount_due;}
          if('payment_done' in f){demand(typeof f.payment_done==='boolean','Done must be ticked or unticked.');a.payment_done=f.payment_done;}
          for(const k of ['invoice_number','remarks'])if(k in f)a[k]=f[k];a.updated_by=actor();a.updated_at=stamp();
          let ref=f.referrer_id;if(f.referrer_name){ref=db.referral_parties.find(x=>x.name.toLowerCase()===f.referrer_name.toLowerCase()&&x.active&&!x.is_default)?.id??handlers.save_referral_party({p_id:null,p_expected_updated_at:null,p_name:f.referrer_name,p_method:null,p_rate:null,p_request_id:uid()});}
          if('referrer_id' in f||f.referrer_name){demand(!a.commission_paid,'Reconcile paid commission before changing the referrer.');const party=db.referral_parties.find(x=>x.id===ref&&x.active&&!x.is_default);demand(!ref||party,'Choose an active referrer.');Object.assign(a,{referrer_id:ref||null,commission_method:null,commission_rate:null,commission_base:null,commission_pax:0});const terms=party?.method?party:db.referral_parties.find(x=>x.is_default);if(party&&['percent','fixed'].includes(terms?.method)&&a.amount_due!==null)handlers.save_booking_finance({p_action:'commission',p_booking_id:id,p_expected_updated_at:a.updated_at,p_values:{referrer_id:ref,use_party_terms:true,base:a.amount_due,pax:0},p_request_id:uid()});}
          for(const pay of f.payments??[])handlers.save_booking_finance({p_action:'payment',p_booking_id:id,p_expected_updated_at:a.updated_at,p_values:{...pay,kind:'receipt'},p_request_id:uid()});
          audit('booking_finance_sheet',id,before,f,'booking_account');
        }
        result.push({key:row.key,id});
      }catch(e){throw Object.assign(new Error(`Row ${row.number}: ${(e as Error).message}`),{code:(e as Row).code});}}
      audit('booking_spreadsheet',p.p_request_id,null,{date:p.p_date,rows:result},'booking_sheet');return p.p_request_id;
    });
    return db.audit_logs.find(a=>a.entity_id===p.p_request_id&&a.actor_id===actor()&&a.action==='booking_spreadsheet')?.after_json.rows??result;
  },
  confirm_sheet_boat_plan(p) {
    dateAccess(p.p_date);if(!external())requirePermission('fleet.assign');
    return once('sheet_boat_plan',p,()=>{
      const board=handlers.read_daily_booking_sheet({p_date:p.p_date});
      demand(JSON.stringify(p.p_expected)===JSON.stringify({bookings:board.bookings,boats:board.boats}),'The boat plan changed on another device. Reopen the suggestion before confirming.');
      demand(Array.isArray(p.p_lines)&&p.p_lines.length>0&&p.p_lines.length<=500,'Choose at least one booking.');
      demand(new Set(p.p_lines.map((x:Row)=>x.booking_id)).size===p.p_lines.length,'A booking appears twice in this plan.');
      for(const line of p.p_lines){const b=db.bookings.find(b=>b.id===line.booking_id&&b.service_date===p.p_date);demand(b&&!db.trip_bookings.some(t=>t.booking_id===b.id),'A booking is no longer waiting for a boat.');demand(line.assignment_id,'Choose a boat.');handlers.save_departure_assignment({p_date:p.p_date,p_booking_id:b!.id,p_expected_updated_at:b!.updated_at,p_changes:{assignment_id:line.assignment_id},p_request_id:uid()});}
      audit('confirmed_boat_plan',p.p_request_id,null,p.p_lines,'departure_plan');return p.p_request_id;
    });
  },
  save_sheet_resource(p) {
    dateAccess(p.p_date);if(!external())requirePermission(p.p_kind==='boat'?'fleet.assign':'guests.pickup.manage');
    return once('sheet_resource',p,()=>{
      let result:string;
      if(p.p_kind==='boat'){
        demand(!p.p_id,'Use boat crew controls to edit this boat.');demand(!db.boat_assignments.some(a=>a.service_date===p.p_date && a.locked),'The departure day is locked.');
        demand(db.boats.some(b=>b.id===p.p_resource_id && b.status==='active'),'Choose an available boat.');demand(!db.boat_assignments.some(a=>a.boat_id===p.p_resource_id && a.service_date===p.p_date && a.status!=='cancelled'),'That boat is already on this day.');
        result=uid();db.boat_assignments.push({id:result,boat_id:p.p_resource_id,service_date:p.p_date,trip_no:1,locked:false,status:'planned',captain_employee_id:null,guide_employee_id:null,crew_employee_ids:[],updated_at:stamp()});
      }else{
        const g=db.pickup_groups.find(g=>g.id===p.p_id && g.service_date===p.p_date);version(g,p.p_expected_updated_at);demand(!g || g.status==='planned','The pickup is already underway.');
        const v=db.transport_vehicles.find(v=>v.id===p.p_resource_id && v.active);demand(v,'Choose an active van.');demand(!db.pickup_groups.some(x=>x.id!==p.p_id && x.service_date===p.p_date && x.status!=='cancelled' && x.vehicle_id===p.p_resource_id),'That van is already on this day.');
        demand(!p.p_driver||db.employees.some(e=>e.id===p.p_driver && e.active && e.job_type==='driver'),'Choose an active driver.');demand(!p.p_driver || !db.pickup_groups.some(x=>x.id!==p.p_id && x.service_date===p.p_date && x.status!=='cancelled' && x.driver_employee_id===p.p_driver),'The driver is already assigned to another van.');
        const used=db.bookings.filter(b=>g && b.pickup_group_id===g.id && !['cancelled','no_show'].includes(b.status)).reduce((n,b)=>n+b.pax_total,0);demand(used<=v!.capacity_pax,'Not enough van passenger seats.');
        result=g?.id??uid();const row={id:result,service_date:p.p_date,status:'planned',name:v!.code,vehicle_id:v!.id,driver_employee_id:p.p_driver,updated_at:stamp()};if(g)Object.assign(g,row);else db.pickup_groups.push(row);
      }
      audit('sheet_resource',result,null,p,p.p_kind);return result;
    });
  },
  read_daily_booking_sheet(p) {
    dateAccess(p.p_date);
    const fields = ['id','service_date','lead_name','booking_ref','pax_total','pax_adults','pax_children','pax_infants','pax_tour_leaders','pax_tour_guides','pax_elderly','pax_assisted','pickup_hotel_name','pickup_area','pickup_time','pickup_required','pickup_group_id','pickup_latitude','pickup_longitude','tour_name','dropoff_location','planning_group','ops_notes','guide_employee_id','status','updated_at'];
    if (!external()) fields.push('lead_phone','agency_id','source_type');
    return {
      restricted: external(),
      available_boats: db.boats.filter(b=>b.status==='active').map(b=>({id:b.id,code:b.code,capacity_pax:Math.min(43,b.capacity_pax)})),
      bookings: db.bookings.filter(b => b.service_date === p.p_date).map(b => ({ ...Object.fromEntries(fields.map(k => [k, b[k] ?? null])), creator_name: actorName(b.created_by), updated_by_name: b.updated_by ? actorName(b.updated_by) : null, assignment_id: db.trip_bookings.find(t => t.booking_id === b.id)?.assignment_id ?? null })),
      boats: db.boat_assignments.filter(a => a.service_date === p.p_date && a.status !== 'cancelled').map(a => ({ ...a, code: db.boats.find(b => b.id === a.boat_id)?.code, capacity_pax: Math.min(43, db.boats.find(b => b.id === a.boat_id)?.capacity_pax ?? 0), staff_pax: demoStaffPax(a), guest_pax: db.trip_bookings.filter(t => t.assignment_id === a.id).reduce((n,t) => n+(db.bookings.find(b => b.id === t.booking_id && !['cancelled','no_show'].includes(b.status))?.pax_total ?? 0),0) })),
      employees: db.employees.filter(e => e.active && ['captain','crew','guide','driver'].includes(e.job_type)).map(e => ({ id:e.id, full_name:e.full_name, job_type:e.job_type, phone:e.phone })),
      vehicles: db.transport_vehicles.filter(v => v.active).map(v => ({ id:v.id,code:v.code,name:v.name,capacity_pax:v.capacity_pax })),
      runs: db.pickup_groups.filter(g => g.service_date === p.p_date && g.status !== 'cancelled').map(g => ({ id:g.id,name:g.name,vehicle_id:g.vehicle_id,driver_employee_id:g.driver_employee_id,status:g.status,updated_at:g.updated_at })),
      agencies: external() ? [] : db.agencies.filter(a => a.active).map(a => ({id:a.id,name:a.name})),
    };
  },
  save_daily_booking(p) {
    requirePermission('guests.sheet.write'); dateAccess(p.p_date);
    return once('daily_booking', p, () => {
      let b = db.bookings.find(b => b.id === p.p_booking_id && b.service_date === p.p_date);
      version(b, p.p_expected_updated_at);
      const c = p.p_changes;
      const before = structuredClone(b ?? null);
      if (!b) {
        demand(!p.p_booking_id, 'Booking not found.');
        b = { id: uid(), booking_ref: `LP-${p.p_date.replaceAll('-','')}-${uid().slice(0,6).toUpperCase()}`, service_date: p.p_date, source_type: 'in_house', status:'confirmed', created_by:actor(), created_at:stamp(), pickup_required:true, pax_assisted:0 };
        db.bookings.push(b);
      }
      const trip = db.boat_assignments.find(a => a.id === db.trip_bookings.find(t => t.booking_id === b!.id)?.assignment_id);
      demand(!trip || (!trip.locked && ['planned','boarding'].includes(trip.status)), 'The departure is locked or underway.');
      if (c.counts) {
        const total = countKeys.reduce((n,k) => n+c.counts[k],0);
        demand(countKeys.every(k => Number.isInteger(c.counts[k]) && c.counts[k]>=0 && c.counts[k]<=500) && total>=1 && total<=500, 'Enter valid passenger counts (1-500 total).');
        countKeys.forEach((key,i) => {
          const role = i===3 ? 'tour_leader' : i===4 ? 'tour_guide' : 'guest';
          const band = i===1 ? 'child' : i===2 ? 'infant' : 'adult';
          const people = db.tourists.filter(t => t.booking_id===b!.id && (t.traveller_role ?? 'guest')===role && (t.age_band===band || (i===0 && t.age_band==='elderly')));
          const remove = people.length-c.counts[key];
          const removable = people.filter(t => t.name_pending && !db.trip_passengers.some(p => p.tourist_id===t.id && (p.boarding_status!=='pending' || p.activity_code)) && !(db.guest_meal_needs??[]).some(n=>n.tourist_id===t.id));
          demand(remove<=removable.length, 'Named or checked-in passengers cannot be removed by changing a count. Edit the passenger list.');
          if (remove>0) { const ids=removable.slice(-remove).map(t => t.id); db.tourists=db.tourists.filter(t => !ids.includes(t.id)); }
          for (let j=people.length; j<c.counts[key]; j++) db.tourists.push({id:uid(),booking_id:b!.id,full_name:`${['Adult','Child','Infant','Local Tour Leader','China Tour Guide'][i]} ${j+1} (Name Pending)`,age_band:band,traveller_role:role,name_pending:true,sort_order:i*1000+j,is_lead:false,needs_assistance:false});
        });
      }
      for (const k of ['lead_name','lead_phone','pickup_hotel_name','pickup_area','pickup_required','pickup_time','tour_name','dropoff_location','planning_group','ops_notes','agency_id','source_type']) if (k in c) b[k]=c[k];
      demand(b.lead_name?.trim(), 'Enter the booking or group name.');
      if (c.pickup_hotel_name !== undefined && c.pickup_hotel_name !== (before as Row)?.pickup_hotel_name) {b.pickup_latitude=null;b.pickup_longitude=null;}
      if (!b.pickup_required) b.pickup_group_id=null;
      recountTravelers(b.id); demand(b.pax_total>0, 'Enter at least one passenger.'); syncBookingPassengers(b);
      if (trip) checkDemoOnboard(trip.id);
      b.updated_at=stamp();b.updated_by=actor();audit('daily_booking',b.id,before,b);return b.id;
    });
  },
  save_departure_assignment(p) {
    dateAccess(p.p_date); if (!external()) requirePermission('fleet.assign');
    return once('departure_assignment',p,()=>{
      const b=db.bookings.find(b=>b.id===p.p_booking_id && b.service_date===p.p_date);
      demand(b && ['draft','confirmed','arrived'].includes(b.status),'Booking unavailable.'); version(b,p.p_expected_updated_at);
      const before=structuredClone(b!);const c=p.p_changes;
      const old=db.boat_assignments.find(a=>a.id===db.trip_bookings.find(t=>t.booking_id===b!.id)?.assignment_id);
      demand(!old || (!old.locked && old.status==='planned'),'This boat plan is locked or underway.');
      if ('assignment_id' in c && (old?.id ?? null)!==(c.assignment_id || null)) {
        demand(!db.trip_passengers.some(t=>t.booking_id===b!.id && (t.boarding_status!=='pending' || t.activity_code)),'Attendance has started. An internal PIC must review this move.');
        if(c.assignment_id) demand(db.boat_assignments.some(a=>a.id===c.assignment_id && a.service_date===p.p_date && !a.locked && a.status==='planned'),'Choose an available boat on this date.');
        db.trip_bookings=db.trip_bookings.filter(t=>t.booking_id!==b!.id);
        if(c.assignment_id)db.trip_bookings.push({id:uid(),booking_id:b!.id,assignment_id:c.assignment_id,assigned_by:actor(),assigned_at:stamp()});
      }
      if('pickup_group_id' in c) {
        demand(!db.pickup_groups.some(g=>g.id===b!.pickup_group_id && g.status!=='planned'),'The pickup is already underway.');
        const run=db.pickup_groups.find(g=>g.id===c.pickup_group_id && g.service_date===p.p_date && g.status==='planned');
        demand(!c.pickup_group_id || run,'Choose a planned van on this date.');
        if(run){const seats=db.transport_vehicles.find(v=>v.id===run.vehicle_id)?.capacity_pax??0;const used=db.bookings.filter(x=>x.id!==b!.id && x.pickup_group_id===run.id && !['cancelled','no_show'].includes(x.status)).reduce((n,x)=>n+x.pax_total,0);demand(used+b!.pax_total<=seats,'This group exceeds the van passenger seats.');b!.pickup_required=true;}
        b!.pickup_group_id=c.pickup_group_id || null;
      }
      if('guide_employee_id' in c){demand(!c.guide_employee_id || db.employees.some(e=>e.id===c.guide_employee_id && e.active && e.job_type==='guide'),'Choose an active local guide.');b!.guide_employee_id=c.guide_employee_id||null;}
      if('pickup_time' in c)b!.pickup_time=c.pickup_time||null;
      syncBookingPassengers(b!);
      const link=db.trip_bookings.find(t=>t.booking_id===b!.id);if(link)checkDemoOnboard(link.assignment_id);
      b!.updated_by=actor();b!.updated_at=stamp();audit('departure_assignment',b!.id,before,c);return b!.id;
    });
  },
  save_sheet_boat(p) {
    dateAccess(p.p_date);if(!external())requirePermission('fleet.crew.assign');
    return once('sheet_boat',p,()=>{
      const a=db.boat_assignments.find(a=>a.id===p.p_assignment_id && a.service_date===p.p_date);demand(a,'Boat not found.');version(a,p.p_expected_updated_at);
      demand(!a!.locked && a!.status==='planned','Boat is locked or underway.');
      const crew=p.p_crew??[];demand(!p.p_captain || db.employees.some(e=>e.id===p.p_captain && e.active && e.job_type==='captain'),'Choose an active captain.');
      demand(crew.every((id:string)=>db.employees.some(e=>e.id===id && e.active && ['crew','captain'].includes(e.job_type))),'Choose active crew.');
      const staff=[p.p_captain,...crew].filter(Boolean);demand(new Set(staff).size===staff.length,'Each staff member can only be counted once.');
      demand(!db.boat_assignments.some(x=>x.id!==a!.id && x.service_date===p.p_date && x.status!=='cancelled' && [x.captain_employee_id,x.guide_employee_id,...(x.crew_employee_ids??[])].some(id=>staff.includes(id))),'A selected staff member is already on another boat that day.');
      const before=structuredClone(a!);a!.captain_employee_id=p.p_captain;a!.crew_employee_ids=crew;checkDemoOnboard(a!.id);a!.updated_at=stamp();audit('sheet_boat',a!.id,before,a,'boat_assignment');return a!.id;
    });
  },
  sheet_planner_access(p) {
    requirePermission('platform.users.manage');
    if(p.p_user_id){demand(db.profiles.some(u=>u.id===p.p_user_id && u.status==='active' && !u.is_anonymous && u.access_role_code==='external_planner'),'Select an active named External Departure Planner account.');db.departure_planner_access=db.departure_planner_access.filter(x=>!(x.user_id===p.p_user_id && x.service_date===p.p_date));if(p.p_allow)db.departure_planner_access.push({user_id:p.p_user_id,service_date:p.p_date,granted_by:actor(),granted_at:stamp()});audit('planner_access',p.p_user_id,null,p,'profile');}
    return db.profiles.filter(u=>u.access_role_code==='external_planner' && u.status==='active' && !u.is_anonymous).map(u=>({id:u.id,full_name:u.full_name,allowed:db.departure_planner_access.some(x=>x.user_id===u.id && x.service_date===p.p_date)}));
  },
  read_booking_accounts(p) {
    requirePermission('guests.finance.manage');const ids=db.bookings.filter(b=>b.service_date===p.p_date).map(b=>b.id);
    return {accounts:db.booking_accounts.filter(a=>ids.includes(a.booking_id)).map(a=>({...a,updated_by_name:actorName(a.updated_by)})),payments:db.booking_payments.filter(a=>ids.includes(a.booking_id)).map(a=>({...a,recorded_by_name:actorName(a.recorded_by)})),referrers:db.referral_parties};
  },
  save_booking_finance(p) {
    requirePermission('guests.finance.manage');
    return once('booking_finance',p,()=>{
      demand(db.bookings.some(b=>b.id===p.p_booking_id),'Booking not found.');
      let a=db.booking_accounts.find(a=>a.booking_id===p.p_booking_id);version(a,p.p_expected_updated_at);
      const before=structuredClone(a??null);const v=p.p_values;
      const money=(x:any)=>{const n=Number(x);demand(x!=='' && x!=null && Number.isFinite(n) && n>=0 && Math.abs(n*100-Math.round(n*100))<1e-6,'Enter an RM amount with at most two decimals.');return n;};
      if(!a){a={booking_id:p.p_booking_id,amount_due:null,invoice_number:'',remarks:'',referrer_id:null,commission_method:null,commission_rate:null,commission_pax:0,commission_base:null,commission_paid:0};db.booking_accounts.push(a);}
      let result=a.booking_id;
      const totals=()=>accountTotals(a as BookingAccount,db.booking_payments.filter(x=>x.booking_id===a!.booking_id) as BookingPayment[]);
      if(p.p_action==='account'){a.amount_due=money(v.amount_due);a.invoice_number=v.invoice_number??'';a.remarks=v.remarks??'';}
      else if(p.p_action==='payment'){
        const amount=money(v.amount);demand(amount>0,'Enter a positive payment.');demand(['receipt','refund'].includes(v.kind),'Choose receipt or refund.');demand(/^\d{4}-\d{2}-\d{2}$/.test(v.payment_date) && v.payment_date<=TODAY,'Choose the actual payment date, not a future date.');
        if(v.kind==='refund')demand(amount<=totals().paid,'A refund cannot exceed the receipts remaining.');
        result=uid();db.booking_payments.push({id:result,booking_id:a.booking_id,payment_date:v.payment_date,amount,kind:v.kind,reference:v.reference??'',note:v.note??'',recorded_by:actor(),created_at:stamp(),voided_at:null});
      }else if(p.p_action==='void_payment'){
        const pay=db.booking_payments.find(x=>x.id===v.id && x.booking_id===a!.booking_id && !x.voided_at);demand(pay && v.reason?.trim().length>=3,'Choose an active payment and explain the correction.');
        demand(pay!.kind!=='receipt' || totals().paid-pay!.amount>=0,'This receipt has been refunded. Reconcile its refund before voiding it.');
        pay!.voided_at=stamp();pay!.voided_by=actor();pay!.void_reason=v.reason.trim();result=pay!.id;
      }else if(p.p_action==='commission'){
        demand(a.amount_due!==null,'Save the booking total first.');const party=db.referral_parties.find(r=>r.id===v.referrer_id && r.active && !r.is_default);demand(!v.referrer_id || party,'Choose an active referrer.');
        const terms=v.use_party_terms && party ? (party.method ? party : db.referral_parties.find(r=>r.is_default)) : v;
        a.referrer_id=party?.id??null;a.commission_method=party ? terms?.method : null;a.commission_rate=party ? money(terms?.rate) : null;
        demand(!party || ['percent','fixed','per_pax'].includes(a.commission_method),'Set the general or referrer commission terms first.');
        demand(a.commission_method!=='percent' || a.commission_rate<=100,'Percentage cannot exceed 100.');a.commission_pax=Number(v.pax??0);a.commission_base=v.base===''||v.base==null ? null : money(v.base);
        demand(a.commission_method!=='percent' || a.commission_base!==null,'Enter the commission base amount.');demand(Number.isInteger(a.commission_pax)&&a.commission_pax>=0&&(a.commission_method!=='per_pax'||a.commission_pax>0),'Enter valid commissionable passengers.');
        demand((totals().commission??0)>=a.commission_paid,'Commission already paid exceeds these terms. Reconcile before changing them.');
      }else if(p.p_action==='commission_paid'){
        const amount=money(v.amount);demand(amount>0 && amount<=(totals().commissionBalance??0),'Enter an amount within the outstanding commission.');a.commission_paid=money(a.commission_paid+amount);
      }else throw new Error('Unknown accounting action.');
      a.updated_at=stamp();a.updated_by=actor();audit(`booking_finance_${p.p_action}`,a.booking_id,before,v,'booking_account');return result;
    });
  },
  save_referral_party(p) {
    requirePermission('guests.finance.manage');return once('referral_party',p,()=>{
      const r=db.referral_parties.find(r=>r.id===p.p_id);version(r,p.p_expected_updated_at);
      demand(p.p_name?.trim(),'Enter a referrer name.');demand(!p.p_method || ['percent','fixed','per_pax'].includes(p.p_method),'Choose commission terms.');demand(!p.p_method ? p.p_rate===null : Number.isFinite(Number(p.p_rate)) && p.p_rate!==null && Number(p.p_rate)>=0 && (p.p_method!=='percent'||Number(p.p_rate)<=100),'Enter a valid commission rate.');
      demand(!db.referral_parties.some(x=>x.id!==p.p_id && x.name.toLowerCase()===p.p_name.trim().toLowerCase()),'A referrer with this name already exists.');
      const next={...r,id:r?.id??uid(),name:r?.is_default?r.name:p.p_name.trim(),method:p.p_method||null,rate:p.p_rate===null?null:Number(p.p_rate),is_default:r?.is_default??false,active:true,updated_at:stamp(),updated_by:actor()};
      audit('referral_terms',next.id,r??null,next,'referral_party');if(r)Object.assign(r,next);else db.referral_parties.push(next);return next.id;
    });
  },
  read_booking_change_log(p) {
    const b=db.bookings.find(b=>b.id===p.p_booking_id);dateAccess(b?.service_date);
    return db.audit_logs.filter(a=>a.entity_id===p.p_booking_id && (!external()||a.action==='departure_assignment') && (can('guests.finance.manage')||!a.action.startsWith('booking_finance_'))).sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,100).map(a=>({created_at:a.created_at,actor:actorName(a.actor_id),action:a.action,details:external()?null:a.after_json}));
  },
};

// New sample mutations match the all-or-nothing transactions used by the cloud RPCs.
export const demoBookingHandlers = Object.fromEntries(Object.entries(handlers).map(([name,handler]) => [name,(p:Row)=>{
  const snapshot=structuredClone(db);
  try{return structuredClone(handler(p));}catch(error){for(const key of Object.keys(db))delete db[key];Object.assign(db,snapshot);throw Object.assign(error as Error,{code:(error as Row).code||'P0001'});}
}]));
