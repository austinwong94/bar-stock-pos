create function public.save_sheet_resource(p_date date,p_kind text,p_id uuid,p_resource_id uuid,p_driver uuid,p_expected_updated_at timestamptz,p_request_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare fingerprint text; prior public.operation_requests%rowtype; result uuid; g public.pickup_groups%rowtype; v public.transport_vehicles%rowtype;
begin
 perform public.check_sheet_date(p_date);
 if not public.is_external_planner() then perform public.require_permission(case when p_kind='boat' then 'fleet.assign' else 'guests.pickup.manage' end); end if;
 perform pg_advisory_xact_lock(73081,1);
 if p_request_id is null then raise exception 'Save reference is required.'; end if;
 fingerprint:=md5(jsonb_build_array(p_date,p_kind,p_id,p_resource_id,p_driver,p_expected_updated_at)::text);
 select * into prior from public.operation_requests where actor_id=auth.uid() and operation='sheet_resource' and request_id=p_request_id;
 if found then if prior.payload_hash<>fingerprint then raise exception 'Save reference changed.'; end if; return prior.result_id; end if;
 if p_kind='boat' then
  if p_id is not null then raise exception 'Use the boat crew controls to edit an existing boat.'; end if;
  if exists(select 1 from public.boat_assignments where service_date=p_date and locked) then raise exception 'The departure day is locked.'; end if;
  if not exists(select 1 from public.boats where id=p_resource_id and status='active' and capacity_pax>0) then raise exception 'Choose an available boat.'; end if;
  if exists(select 1 from public.boat_assignments where service_date=p_date and boat_id=p_resource_id and status<>'cancelled') then raise exception 'That boat is already on this day.'; end if;
  insert into public.boat_assignments(service_date,boat_id,trip_no) values(p_date,p_resource_id,1) returning id into result;
 elsif p_kind='van' then
  if p_id is not null then select * into g from public.pickup_groups where id=p_id and service_date=p_date for update;
   if not found or g.updated_at is distinct from p_expected_updated_at then raise exception 'Van changed. Reload before saving.' using errcode='40001'; end if;
   if g.status<>'planned' then raise exception 'The pickup is already underway.'; end if;
  end if;
  select * into v from public.transport_vehicles where id=p_resource_id and active;
  if not found then raise exception 'Choose an active van.'; end if;
  if exists(select 1 from public.pickup_groups where vehicle_id=v.id and service_date=p_date and status<>'cancelled' and id is distinct from p_id) then raise exception 'That van is already on this day.'; end if;
  if p_driver is not null and not exists(select 1 from public.employees where id=p_driver and job_type='driver' and active) then raise exception 'Choose an active driver.'; end if;
  if p_driver is not null and exists(select 1 from public.pickup_groups where driver_employee_id=p_driver and service_date=p_date and status<>'cancelled' and id is distinct from p_id) then raise exception 'The driver is already assigned to another van.'; end if;
  if p_id is null then insert into public.pickup_groups(service_date,name,vehicle_id,driver_employee_id) values(p_date,v.code,v.id,p_driver) returning id into result;
  else update public.pickup_groups set vehicle_id=v.id,driver_employee_id=p_driver where id=p_id returning id into result; end if;
 else raise exception 'Choose boat or van.'; end if;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_json,after_json) values(auth.uid(),'sheet_resource',p_kind,result,to_jsonb(g),jsonb_build_object('service_date',p_date,'resource_id',p_resource_id,'driver',p_driver));
 insert into public.operation_requests(actor_id,operation,request_id,payload_hash,result_id) values(auth.uid(),'sheet_resource',p_request_id,fingerprint,result);
 return result;
end $$;
revoke all on function public.save_sheet_resource(date,text,uuid,uuid,uuid,timestamptz,uuid) from public,anon;
grant execute on function public.save_sheet_resource(date,text,uuid,uuid,uuid,timestamptz,uuid) to authenticated;
