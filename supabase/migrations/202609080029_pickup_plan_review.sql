-- One snapshot for review, one transaction to confirm. No external geocoding.
create or replace function public.read_pickup_board(p_date date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  perform public.require_permission('guests.pickup.manage');
  select jsonb_build_object(
    'bookings',coalesce((select jsonb_agg(to_jsonb(b) order by b.id) from public.bookings b where service_date=p_date and status not in ('cancelled','no_show')),'[]'::jsonb),
    'runs',coalesce((select jsonb_agg(to_jsonb(g)||jsonb_build_object('transport_vehicles',to_jsonb(v)) order by g.sort_order,g.id) from public.pickup_groups g left join public.transport_vehicles v on v.id=g.vehicle_id where g.service_date=p_date),'[]'::jsonb),
    'vehicles',coalesce((select jsonb_agg(to_jsonb(v) order by sort_order,id) from public.transport_vehicles v where active),'[]'::jsonb),
    'locations',coalesce((select jsonb_agg(to_jsonb(l) order by name,id) from public.pickup_locations l where active),'[]'::jsonb)
  ) into result;
  return result || jsonb_build_object('version',md5(result::text));
end;
$$;

create or replace function public.confirm_pickup_plan(p_date date,p_version text,p_groups jsonb,p_request_id uuid)
returns integer language plpgsql volatile security definer set search_path=public as $$
declare previous public.operation_requests%rowtype; g jsonb; bid text; r public.pickup_groups%rowtype;
  v public.transport_vehicles%rowtype; bk public.bookings%rowtype; used int; placed int:=0;
  seen uuid[]:='{}'; vehicles uuid[]:='{}'; plan_hash text;
begin
  perform public.require_permission('guests.pickup.manage');
  perform pg_advisory_xact_lock(73081,1);
  if p_request_id is null or p_date is null then raise exception 'Missing plan reference or date.'; end if;
  plan_hash:=md5(p_date::text || coalesce(p_version,'') || coalesce(p_groups::text,''));
  select * into previous from public.operation_requests where actor_id=auth.uid() and operation='confirm_pickup_plan' and request_id=p_request_id;
  if found then
    if previous.payload_hash<>plan_hash then raise exception 'This confirmation reference was already used for another plan.'; end if;
    return (select coalesce(sum(jsonb_array_length(x->'booking_ids')),0)::int from jsonb_array_elements(p_groups) x);
  end if;
  if p_version is distinct from (public.read_pickup_board(p_date)->>'version') then raise exception 'Pickup details changed on another device. Close this draft and suggest again.'; end if;
  if jsonb_typeof(p_groups) is distinct from 'array' or jsonb_array_length(p_groups)=0 then raise exception 'Choose at least one group.'; end if;
  for g in select * from jsonb_array_elements(p_groups) loop
    if jsonb_typeof(g->'booking_ids') is distinct from 'array' or jsonb_array_length(g->'booking_ids')=0 then raise exception 'A vehicle needs at least one booking.'; end if;
    select * into v from public.transport_vehicles where id=(g->>'vehicle_id')::uuid and active;
    if not found or v.capacity_pax<=0 then raise exception 'Vehicle is unavailable.'; end if;
    if v.id=any(vehicles) then raise exception 'A vehicle cannot appear twice in this pickup plan.'; end if;
    vehicles:=array_append(vehicles,v.id);
    if nullif(g->>'run_id','') is not null then
      select * into r from public.pickup_groups where id=(g->>'run_id')::uuid;
      if not found or r.service_date<>p_date or r.vehicle_id is distinct from v.id or r.status<>'planned' then raise exception 'Pickup run is no longer available.'; end if;
    else
      r.id:=null;
    end if;
    if exists(select 1 from public.pickup_groups where service_date=p_date and vehicle_id=v.id and status<>'cancelled' and id is distinct from r.id) then raise exception 'This vehicle already has a run for this date.'; end if;
    select coalesce(sum(pax_total),0) into used from public.bookings where pickup_group_id=r.id and status not in ('cancelled','no_show') and pickup_required;
    for bid in select jsonb_array_elements_text(g->'booking_ids') loop
      if bid::uuid=any(seen) then raise exception 'A booking cannot be assigned twice.'; end if;
      seen:=array_append(seen,bid::uuid);
      select * into bk from public.bookings where id=bid::uuid;
      if not found or bk.service_date<>p_date or bk.status in ('cancelled','no_show') or not bk.pickup_required or bk.pickup_group_id is not null then raise exception 'A booking is no longer waiting for pickup.'; end if;
      used:=used+bk.pax_total;
    end loop;
    if used>v.capacity_pax then raise exception '% has only % passenger seats; % pax selected.',v.code,v.capacity_pax,used; end if;
    if r.id is null then
      insert into public.pickup_groups(service_date,name,vehicle_id,driver_employee_id,status,created_by,sort_order)
      values(p_date,v.code || ' pickup',v.id,v.default_driver_employee_id,'planned',auth.uid(),coalesce((select max(sort_order)+1 from public.pickup_groups where service_date=p_date),1)) returning * into r;
    end if;
    for bid in select jsonb_array_elements_text(g->'booking_ids') loop
      placed:=placed+1;
      update public.bookings set pickup_group_id=r.id,pickup_stop_order=null,pickup_eta=null where id=bid::uuid;
    end loop;
    -- Sequence and travel times remain unconfirmed; do not invent driving ETAs.
  end loop;
  insert into public.operation_requests(actor_id,operation,request_id,payload_hash,result_id) values(auth.uid(),'confirm_pickup_plan',p_request_id,plan_hash,p_request_id);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_json) values(auth.uid(),'confirm_pickup_plan','pickup_plan',p_request_id,jsonb_build_object('service_date',p_date,'groups',p_groups));
  return placed;
end;
$$;

create or replace function public.save_pickup_point_checked(p_booking_id uuid,p_expected_updated_at timestamptz,p_name text,p_area text,p_latitude double precision,p_longitude double precision,p_location_id uuid default null)
returns void language plpgsql volatile security definer set search_path=public as $$
declare bk public.bookings%rowtype;
begin
  perform public.require_permission('guests.pickup.manage');
  perform pg_advisory_xact_lock(73081,1);
  select * into bk from public.bookings where id=p_booking_id;
  if not found or bk.updated_at is distinct from p_expected_updated_at then raise exception 'Booking changed. Refresh before editing the pickup point.'; end if;
  if coalesce(trim(p_name),'')='' then raise exception 'Enter a pickup location.'; end if;
  if (p_latitude is null)<>(p_longitude is null) or not (coalesce(p_latitude,0) between -90 and 90 and coalesce(p_longitude,0) between -180 and 180) then raise exception 'Enter valid latitude and longitude together, or leave both empty.'; end if;
  if bk.pickup_group_id is not null and exists(select 1 from public.pickup_groups where id=bk.pickup_group_id and status<>'planned') then raise exception 'This pickup is already underway. Its location cannot change.'; end if;
  update public.bookings set pickup_hotel_name=trim(p_name),pickup_area=nullif(trim(p_area),''),pickup_latitude=p_latitude,pickup_longitude=p_longitude,pickup_location_id=p_location_id,pickup_eta=null where id=p_booking_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_json,after_json) values(auth.uid(),'save_pickup_point','booking',p_booking_id,to_jsonb(bk),jsonb_build_object('name',trim(p_name),'area',p_area,'latitude',p_latitude,'longitude',p_longitude));
end;
$$;

create or replace function public.assign_pickup_run_checked(p_booking_id uuid,p_run_id uuid,p_expected_updated_at timestamptz)
returns void language plpgsql volatile security definer set search_path=public as $$
declare bk public.bookings%rowtype; r public.pickup_groups%rowtype;
begin
  perform public.require_permission('guests.pickup.manage');
  perform pg_advisory_xact_lock(73081,1);
  select * into bk from public.bookings where id=p_booking_id;
  if not found or bk.updated_at is distinct from p_expected_updated_at then raise exception 'Booking changed. Refresh before moving it.'; end if;
  if bk.status in ('cancelled','no_show') then raise exception 'This booking is not available for pickup.'; end if;
  if exists(select 1 from public.pickup_groups where id=bk.pickup_group_id and status<>'planned') then raise exception 'The pickup is already underway.'; end if;
  if p_run_id is not null then
    select * into r from public.pickup_groups where id=p_run_id;
    if not found or r.status<>'planned' or r.service_date<>bk.service_date then raise exception 'Choose a planned run on the same date.'; end if;
  end if;
  perform public.assign_pickup_run(p_booking_id,p_run_id,false);
  update public.bookings set pickup_eta=null where pickup_group_id in (p_run_id,bk.pickup_group_id);
end;
$$;

revoke all on function public.read_pickup_board(date),public.confirm_pickup_plan(date,text,jsonb,uuid),public.save_pickup_point_checked(uuid,timestamptz,text,text,double precision,double precision,uuid),public.assign_pickup_run_checked(uuid,uuid,timestamptz) from public,anon;
grant execute on function public.read_pickup_board(date),public.confirm_pickup_plan(date,text,jsonb,uuid),public.save_pickup_point_checked(uuid,timestamptz,text,text,double precision,double precision,uuid),public.assign_pickup_run_checked(uuid,uuid,timestamptz) to authenticated;
