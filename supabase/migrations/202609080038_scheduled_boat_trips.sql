-- Planned assignments are visible immediately but are not evidence of a voyage.
alter table public.boat_trips add column trip_status text not null default 'recorded' check(trip_status in ('planned','departed','returned','cancelled','recorded'));
alter table public.boat_trips add column planned_pax int not null default 0;

create function public.refresh_scheduled_boat_trip(p_assignment_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare a public.boat_assignments%rowtype; expected int; boarded int; state text;
begin
  select * into a from public.boat_assignments where id=p_assignment_id;
  if not found then return; end if;
  -- Do not erase previously logged historical trips whose old assignments lack a departure status.
  if a.service_date<(now() at time zone 'Asia/Kuala_Lumpur')::date and a.status not in ('departed','returned','cancelled')
    and exists(select 1 from public.boat_trips where assignment_id=a.id and trip_status='recorded') then return; end if;
  select count(*),count(*) filter(where boarding_status='arrived') into expected,boarded from public.trip_passengers where assignment_id=a.id;
  if expected=0 and not exists(select 1 from public.boat_trips where assignment_id=a.id) then return; end if;
  state:=case when a.status in ('departed','returned','cancelled') then a.status else 'planned' end;
  insert into public.boat_trips(service_date,boat_id,assignment_id,departure_time,return_time,pax_count,planned_pax,trip_status,purpose,auto_generated,recorded_by)
  values(a.service_date,a.boat_id,a.id,a.departure_time,a.return_time,boarded,expected,state,'Scheduled island run',true,auth.uid())
  on conflict(assignment_id) where assignment_id is not null do update set
    service_date=excluded.service_date,boat_id=excluded.boat_id,departure_time=excluded.departure_time,return_time=excluded.return_time,pax_count=excluded.pax_count,planned_pax=excluded.planned_pax,trip_status=excluded.trip_status
  where (boat_trips.service_date,boat_trips.boat_id,boat_trips.departure_time,boat_trips.return_time,boat_trips.pax_count,boat_trips.planned_pax,boat_trips.trip_status)
    is distinct from (excluded.service_date,excluded.boat_id,excluded.departure_time,excluded.return_time,excluded.pax_count,excluded.planned_pax,excluded.trip_status);
end; $$;

create function public.sync_scheduled_boat_trigger() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_table_name='boat_assignments' then
    perform public.refresh_scheduled_boat_trip(new.id);
  else
    if tg_op<>'INSERT' then perform public.refresh_scheduled_boat_trip(old.assignment_id); end if;
    if tg_op<>'DELETE' then perform public.refresh_scheduled_boat_trip(new.assignment_id); end if;
  end if;
  return null;
end; $$;
create trigger scheduled_boat_assignment after insert or update on public.boat_assignments for each row execute function public.sync_scheduled_boat_trigger();
create trigger scheduled_boat_passenger after insert or update or delete on public.trip_passengers for each row execute function public.sync_scheduled_boat_trigger();
do $$ declare id uuid; begin for id in select a.id from public.boat_assignments a loop perform public.refresh_scheduled_boat_trip(id); end loop; end $$;

create or replace function public.sync_boat_trips(p_service_date date) returns int language plpgsql security definer set search_path=public as $$
declare a record; begin
  perform public.require_permission('maintenance.view');
  for a in select id from public.boat_assignments where service_date=p_service_date loop perform public.refresh_scheduled_boat_trip(a.id); end loop;
  return 0;
end; $$;

create function public.confirm_scheduled_boat_trip(p_trip_id uuid,p_expected_updated_at timestamptz,p_status text,p_time time,p_request_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare t public.boat_trips%rowtype; previous public.operation_requests%rowtype;
  payload text:=md5(jsonb_build_array(p_trip_id,p_expected_updated_at,p_status,p_time)::text); waiting int;
begin
  perform public.require_permission('maintenance.fuel.record');
  perform pg_advisory_xact_lock(73081,1);
  if p_request_id is null then raise exception 'A confirmation reference is required.'; end if;
  select * into previous from public.operation_requests where actor_id=auth.uid() and operation='scheduled_boat_trip' and request_id=p_request_id;
  if found then
    if previous.payload_hash<>payload then raise exception 'This confirmation already succeeded with different details.'; end if;
    return previous.result_id;
  end if;
  select * into t from public.boat_trips where id=p_trip_id for update;
  if not found or t.assignment_id is null or not t.auto_generated then raise exception 'Scheduled trip not found.'; end if;
  if t.updated_at is distinct from p_expected_updated_at then raise exception 'This boat changed on another device. Refresh and review it again.'; end if;
  if p_time is null or p_status is null or p_status not in ('departed','returned') then raise exception 'Enter the actual time.'; end if;
  if t.service_date>(now() at time zone 'Asia/Kuala_Lumpur')::date then raise exception 'A future trip cannot depart yet.'; end if;
  if p_status='departed' then
    if t.trip_status<>'planned' then raise exception 'This boat is no longer waiting to depart.'; end if;
    if not exists(select 1 from public.boats where id=t.boat_id and status='active') then raise exception 'This boat is not available to depart.'; end if;
    select count(*) into waiting from public.trip_passengers where assignment_id=t.assignment_id and boarding_status='pending';
    if t.pax_count=0 or waiting>0 then raise exception 'Finish boarding: check in guests or mark no-shows before confirming departure.'; end if;
    update public.boat_assignments set status='departed',departure_time=p_time where id=t.assignment_id;
  else
    if t.trip_status<>'departed' then raise exception 'Confirm departure before recording the return.'; end if;
    update public.boat_assignments set status='returned',return_time=p_time where id=t.assignment_id;
  end if;
  insert into public.operation_requests(actor_id,operation,request_id,payload_hash,result_id) values(auth.uid(),'scheduled_boat_trip',p_request_id,payload,t.id);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_json,after_json) values(auth.uid(),'scheduled_boat_trip','boat_trip',t.id,to_jsonb(t),jsonb_build_object('status',p_status,'actual_time',p_time));
  return t.id;
end; $$;

-- Scheduled records are maintained from the boat board, never deleted as manual trips.
create or replace function public.delete_boat_trip(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  perform public.require_permission('maintenance.manage');
  if exists(select 1 from public.boat_trips where id=p_id and auto_generated) then raise exception 'Scheduled trips are maintained from the boat board.'; end if;
  delete from public.boat_trips where id=p_id;
end; $$;

-- Keep the existing RPC contracts while excluding plans from usage estimates.
create or replace function public.fuel_reconciliation(p_from date,p_to date)
returns table(boat_id uuid,boat_code text,trips int,emergency_trips int,pax_carried int,litres_per_trip numeric,estimated_litres numeric,estimated_share_pct numeric,estimated_cost numeric)
language sql stable security definer set search_path=public as $$
  with price as (select case when sum(litres)>0 then sum(total_cost)/sum(litres) else 0 end as amount from public.fuel_purchases where purchase_date between p_from and p_to),
  per_boat as (
    select b.id,b.code,count(t.id)::int as trips,count(t.id) filter(where t.trip_type='emergency')::int as emergency,coalesce(sum(t.pax_count),0)::int as pax,
      coalesce(b.expected_litres_per_trip,0) as baseline,count(t.id)*coalesce(b.expected_litres_per_trip,0) as estimate
    from public.boats b left join public.boat_trips t on t.boat_id=b.id and t.service_date between p_from and p_to and t.trip_status in ('recorded','departed','returned')
    group by b.id,b.code,b.expected_litres_per_trip)
  select p.id,p.code,p.trips,p.emergency,p.pax,p.baseline,round(p.estimate,1),case when sum(p.estimate) over()>0 then round(p.estimate/sum(p.estimate) over()*100,1) else 0 end,round(p.estimate*(select amount from price),2)
  from per_boat p where public.has_permission('maintenance.view') order by p.code;
$$;
create or replace function public.fuel_period_totals(p_from date,p_to date)
returns table(litres_bought numeric,cost_bought numeric,litres_estimated numeric,variance_litres numeric,variance_pct numeric,trips int)
language sql stable security definer set search_path=public as $$
  with bought as(select coalesce(sum(litres),0) as litres,coalesce(sum(total_cost),0) as cost from public.fuel_purchases where purchase_date between p_from and p_to),
  used as(select coalesce(sum(coalesce(b.expected_litres_per_trip,0)),0) as litres,count(*)::int as trips from public.boat_trips t join public.boats b on b.id=t.boat_id where t.service_date between p_from and p_to and t.trip_status in ('recorded','departed','returned'))
  select bought.litres,bought.cost,round(used.litres,1),round(bought.litres-used.litres,1),case when used.litres>0 then round((bought.litres-used.litres)/used.litres*100,1) else null end,used.trips
  from bought,used where public.has_permission('maintenance.view');
$$;
revoke all on function public.refresh_scheduled_boat_trip(uuid),public.sync_scheduled_boat_trigger(),public.confirm_scheduled_boat_trip(uuid,timestamptz,text,time,uuid) from public,anon;
grant execute on function public.confirm_scheduled_boat_trip(uuid,timestamptz,text,time,uuid) to authenticated;

alter function public.save_boat_trip(uuid,date,uuid,text,text,text,int,text,text) rename to save_manual_boat_trip_internal;
revoke all on function public.save_manual_boat_trip_internal(uuid,date,uuid,text,text,text,int,text,text) from public,anon,authenticated;
create function public.save_boat_trip(p_id uuid,p_service_date date,p_boat_id uuid,p_trip_type text,p_departure_time text default null,p_return_time text default null,p_pax_count int default 0,p_purpose text default null,p_notes text default null)
returns public.boat_trips language plpgsql security definer set search_path=public as $$
begin
  perform public.require_permission('maintenance.fuel.record');
  if exists(select 1 from public.boat_trips where id=p_id and auto_generated) then raise exception 'Scheduled trips are maintained from the boat board.'; end if;
  return public.save_manual_boat_trip_internal(p_id,p_service_date,p_boat_id,p_trip_type,p_departure_time,p_return_time,p_pax_count,p_purpose,p_notes);
end; $$;
revoke all on function public.save_boat_trip(uuid,date,uuid,text,text,text,int,text,text) from public,anon;
grant execute on function public.save_boat_trip(uuid,date,uuid,text,text,text,int,text,text) to authenticated;

-- Preserve the complete operations summary, changing only its trip inclusion rule.
do $$ declare body text; needle text:='where t.service_date = p_service_date'; begin
  body:=pg_get_functiondef('public.operations_summary(date)'::regprocedure);
  if position(needle in body)=0 then raise exception 'Operations summary trip filter changed; review this migration.'; end if;
  execute replace(body,needle,needle||' and t.trip_status in (''recorded'',''departed'',''returned'')');
end; $$;
