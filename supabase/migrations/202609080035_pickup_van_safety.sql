-- Old duplicates remain visible for review; never delete assigned guests.
create or replace function public.check_pickup_vehicle_slot()
returns trigger language plpgsql security definer set search_path=public as $$
declare capacity int; passengers int;
begin
  perform pg_advisory_xact_lock(73081,1);
  if new.vehicle_id is null or new.status='cancelled' then return new; end if;
  if tg_op='UPDATE' then
    if new.vehicle_id is not distinct from old.vehicle_id and new.service_date=old.service_date and new.status=old.status then return new; end if;
  end if;
  if exists(select 1 from public.pickup_groups where service_date=new.service_date and vehicle_id=new.vehicle_id and status<>'cancelled' and id<>new.id)
    then raise exception 'This van is already added for this date. Use its existing assignment.' using errcode='23505'; end if;
  select capacity_pax into capacity from public.transport_vehicles where id=new.vehicle_id and active;
  if capacity is null or capacity<=0 then raise exception 'Choose an available van.'; end if;
  select coalesce(sum(pax_total),0) into passengers from public.bookings where pickup_group_id=new.id and status not in ('cancelled','no_show') and pickup_required;
  if passengers>capacity then raise exception 'This van has insufficient seats for the assigned guests.'; end if;
  return new;
end;
$$;
create trigger check_pickup_vehicle_slot before insert or update of vehicle_id,service_date,status on public.pickup_groups
for each row execute function public.check_pickup_vehicle_slot();

create or replace function public.save_pickup_van_checked(
  p_id uuid,p_service_date date,p_version text,p_request_id uuid,p_name text,p_vehicle_id uuid,
  p_driver_employee_id uuid default null,p_depart_time text default null,p_status text default 'planned',p_notes text default null
)
returns public.pickup_groups language plpgsql volatile security definer set search_path=public as $$
declare previous public.operation_requests%rowtype; saved public.pickup_groups%rowtype; before_row public.pickup_groups%rowtype; fingerprint text;
begin
  perform public.require_permission('guests.pickup.manage');
  perform pg_advisory_xact_lock(73081,1);
  if p_request_id is null or p_service_date is null or p_vehicle_id is null then raise exception 'Choose a van and service date.'; end if;
  fingerprint:=md5(jsonb_build_array(p_id,p_service_date,p_version,p_name,p_vehicle_id,p_driver_employee_id,p_depart_time,p_status,p_notes)::text);
  select * into previous from public.operation_requests where actor_id=auth.uid() and operation='save_pickup_van' and request_id=p_request_id;
  if found then
    if previous.payload_hash<>fingerprint then raise exception 'This save reference belongs to different van details.'; end if;
    select * into saved from public.pickup_groups where id=previous.result_id;
    if not found then raise exception 'The saved van has since been removed. Refresh the board.'; end if;
    return saved;
  end if;
  if p_version is distinct from (public.read_pickup_board(p_service_date)->>'version') then raise exception 'Pickup details changed on another device. Close this form and reopen it.' using errcode='40001'; end if;
  if p_status not in ('planned','on_the_road','completed') or p_status is null then raise exception 'Choose a valid van status.'; end if;
  if p_id is not null then
    select * into before_row from public.pickup_groups where id=p_id and service_date=p_service_date;
    if not found or before_row.status='cancelled' then raise exception 'This van is no longer available.'; end if;
    if before_row.status<>'planned' and before_row.vehicle_id is distinct from p_vehicle_id then raise exception 'The pickup is already underway. Its van cannot change.'; end if;
  elsif p_status<>'planned' then raise exception 'New vans must start as planned.';
  end if;
  if not exists(select 1 from public.transport_vehicles where id=p_vehicle_id and active and capacity_pax>0) then raise exception 'Choose an available van.'; end if;
  if exists(select 1 from public.pickup_groups where vehicle_id=p_vehicle_id and service_date=p_service_date and status<>'cancelled' and id is distinct from p_id) then raise exception 'This van is already added for this date.' using errcode='23505'; end if;
  saved:=public.save_pickup_run(p_id,p_service_date,p_name,p_vehicle_id,p_driver_employee_id,p_depart_time,p_status,p_notes);
  -- An empty time means unconfirmed, never retain an automatically estimated ETA.
  update public.pickup_groups set depart_time=nullif(p_depart_time,'')::time,pickup_time=nullif(p_depart_time,'')::time where id=saved.id returning * into saved;
  insert into public.operation_requests(actor_id,operation,request_id,payload_hash,result_id) values(auth.uid(),'save_pickup_van',p_request_id,fingerprint,saved.id);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_json,after_json) values(auth.uid(),'save_pickup_van','pickup_group',saved.id,case when p_id is null then null else to_jsonb(before_row) end,to_jsonb(saved));
  return saved;
end;
$$;
revoke all on function public.save_pickup_van_checked(uuid,date,text,uuid,text,uuid,uuid,text,text,text) from public,anon;
grant execute on function public.save_pickup_van_checked(uuid,date,text,uuid,text,uuid,uuid,text,text,text) to authenticated;

-- Moving a guest must not fabricate start times or overwrite a driver's time.
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
    if not found or r.status<>'planned' or r.service_date<>bk.service_date then raise exception 'Choose a planned van on the same date.'; end if;
    if not exists(select 1 from public.transport_vehicles where id=r.vehicle_id and active and capacity_pax>0) then raise exception 'Choose an available van.'; end if;
  end if;
  -- The existing booking trigger rechecks the whole van's capacity atomically.
  update public.bookings set pickup_group_id=p_run_id,pickup_stop_order=null,pickup_eta=null,pickup_required=case when p_run_id is not null then true else pickup_required end where id=p_booking_id;
  update public.bookings set pickup_eta=null where pickup_group_id in (p_run_id,bk.pickup_group_id);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_json,after_json) values(auth.uid(),'assign_pickup_van','booking',p_booking_id,to_jsonb(bk),jsonb_build_object('pickup_group_id',p_run_id));
end;
$$;
