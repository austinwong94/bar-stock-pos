import { db, currentUserIdRef, require as requirePermission } from './demoBackend';

export const isActualTrip = (trip: Record<string, any>) => !['planned','cancelled'].includes(trip.trip_status ?? 'recorded');

export function syncDemoBoatTrips() {
  for (const a of db.boat_assignments) {
    const passengers=db.trip_passengers.filter(p=>p.assignment_id===a.id);
    let trip=db.boat_trips.find(t=>t.assignment_id===a.id);
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    if(trip&&a.service_date<today&&!['departed','returned','cancelled'].includes(a.status)&&(trip.trip_status??'recorded')==='recorded')continue;
    if (!passengers.length&&!trip) continue;
    const values={service_date:a.service_date,boat_id:a.boat_id,departure_time:a.departure_time??null,return_time:a.return_time??null,pax_count:passengers.filter(p=>p.boarding_status==='arrived').length,planned_pax:passengers.length,trip_status:['departed','returned','cancelled'].includes(a.status)?a.status:'planned'};
    if (!trip) {trip={id:crypto.randomUUID(),assignment_id:a.id,trip_type:'island_run',purpose:'Scheduled island run',auto_generated:true,created_at:new Date().toISOString(),recorded_by:currentUserIdRef.value}; db.boat_trips.push(trip);}
    if (Object.entries(values).some(([key,value])=>trip![key]!==value)) Object.assign(trip,values,{updated_at:new Date(Math.max(Date.now(),Date.parse(trip.updated_at??'')+1||0)).toISOString()});
  }
}

export function confirmDemoBoatTrip({p_trip_id,p_expected_updated_at,p_status,p_time,p_request_id}:any) {
  requirePermission('maintenance.fuel.record');
  const actor=currentUserIdRef.value,payload=JSON.stringify([p_trip_id,p_expected_updated_at,p_status,p_time]);
  db.operation_requests??=[];
  const prior=db.operation_requests.find(r=>r.actor_id===actor&&r.operation==='scheduled_boat_trip'&&r.request_id===p_request_id);
  if(prior){if(prior.payload_hash!==payload)throw new Error('This confirmation already succeeded with different details.');return prior.result_id;}
  const trip=db.boat_trips.find(t=>t.id===p_trip_id),a=db.boat_assignments.find(a=>a.id===trip?.assignment_id);
  if(!trip||!a)throw new Error('Scheduled trip not found.');
  if(trip.updated_at!==p_expected_updated_at)throw new Error('This boat changed on another device. Refresh and review it again.');
  if(!p_request_id||!/^\d{2}:\d{2}(:\d{2})?$/.test(p_time??'')||!['departed','returned'].includes(p_status))throw new Error('Enter the actual time.');
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  if(a.service_date>today)throw new Error('A future trip cannot depart yet.');
  if(p_status==='departed'){
    if(trip.trip_status!=='planned')throw new Error('This boat is no longer waiting to depart.');
    if(db.boats.find(b=>b.id===a.boat_id)?.status!=='active')throw new Error('This boat is not available to depart.');
    if(!trip.pax_count||db.trip_passengers.some(p=>p.assignment_id===a.id&&p.boarding_status==='pending'))throw new Error('Finish boarding: check in guests or mark no-shows before confirming departure.');
  }else if(trip.trip_status!=='departed')throw new Error('Confirm departure before recording the return.');
  const before=structuredClone(trip);
  a.status=p_status;a[p_status==='departed'?'departure_time':'return_time']=p_time;
  syncDemoBoatTrips();
  db.audit_logs.push({id:crypto.randomUUID(),actor_id:actor,action:'scheduled_boat_trip',entity_type:'boat_trip',entity_id:trip.id,before_json:before,after_json:structuredClone(trip),created_at:new Date().toISOString()});
  db.operation_requests.push({actor_id:actor,operation:'scheduled_boat_trip',request_id:p_request_id,payload_hash:payload,result_id:trip.id});
  return trip.id;
}
