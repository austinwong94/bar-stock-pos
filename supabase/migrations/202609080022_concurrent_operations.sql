-- Coordinators share the same capacity pool. Serialize operational writes
-- before reading it; financial and ingredient balances keep their row locks.
create or replace function public.lock_operations_write()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(73081, 1);
  return null;
end;
$$;
do $$
declare t text;
begin
  foreach t in array array['bookings','tourists','boat_assignments','trip_bookings','trip_passengers',
    'boats','pickup_groups','transport_vehicles','purchase_requests','purchase_request_items']
  loop
    execute format('create trigger operations_write_lock before insert or update or delete on public.%I for each statement execute function public.lock_operations_write()',t);
  end loop;
end $$;

-- Acquire the same lock before functions compute a plan or check a version.
do $$
declare r record; definition text;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
    where n.nspname='public' and l.lanname='plpgsql' and p.proname in (
      'save_booking','delete_booking','ensure_boat_assignments','auto_seat_boats','assign_booking_to_boat','unassign_booking',
      'set_trip_crew','copy_previous_crew','set_day_locked','auto_plan_pickups','assign_pickup_run',
      'set_booking_pickup','save_pickup_run','delete_pickup_run','save_purchase_request',
      'submit_purchase_request','cancel_purchase_request','copy_purchase_request','set_purchase_item_status')
  loop
    definition := pg_get_functiondef(r.oid);
    execute regexp_replace(definition,'\mbegin\M',E'begin\n  perform pg_advisory_xact_lock(73081, 1);','i');
  end loop;
end $$;

create or replace function public.check_boat_group()
returns trigger language plpgsql security definer set search_path=public as $$
declare a public.boat_assignments%rowtype; b public.bookings%rowtype; cap int; seated int; boat_status text;
begin
  if tg_op in ('DELETE','UPDATE') and exists(select 1 from public.boat_assignments where id=old.assignment_id and locked)
    then raise exception 'This day is locked. Unlock it before changing guests.'; end if;
  if tg_op='DELETE' then return old; end if;
  select * into a from public.boat_assignments where id=new.assignment_id;
  select * into b from public.bookings where id=new.booking_id;
  select capacity_pax,status into cap,boat_status from public.boats where id=a.boat_id;
  if a.locked then raise exception 'This day is locked.'; end if;
  if a.service_date<>b.service_date then raise exception 'The booking and boat dates must match.'; end if;
  if a.status='cancelled' or boat_status<>'active' then raise exception 'This boat is unavailable.'; end if;
  if b.status not in ('draft','confirmed','arrived') then raise exception 'This booking cannot be seated.'; end if;
  select coalesce(sum(bk.pax_total),0) into seated from public.trip_bookings tb join public.bookings bk on bk.id=tb.booking_id
    where tb.assignment_id=new.assignment_id and tb.booking_id<>new.booking_id;
  if cap<=0 or seated+b.pax_total>cap then raise exception 'The whole group does not fit. Refresh the boat board.'; end if;
  return new;
end;
$$;
create trigger check_boat_group before insert or update or delete on public.trip_bookings
for each row execute function public.check_boat_group();

create or replace function public.check_booking_capacity()
returns trigger language plpgsql security definer set search_path=public as $$
declare a record; v_run record; v_total int;
begin
  for a in select ba.*,bo.capacity_pax from public.trip_bookings tb
    join public.boat_assignments ba on ba.id=tb.assignment_id join public.boats bo on bo.id=ba.boat_id
    where tb.booking_id=new.id
  loop
    if new.service_date<>a.service_date then raise exception 'Unassign the boat before changing the booking date.'; end if;
    if a.locked and (new.pax_total is distinct from old.pax_total or new.status is distinct from old.status)
      then raise exception 'The boat day is locked.'; end if;
    select coalesce(sum(b.pax_total),0) into v_total from public.trip_bookings tb join public.bookings b on b.id=tb.booking_id where tb.assignment_id=a.id;
    if v_total>a.capacity_pax then raise exception 'The added guests exceed the boat capacity.'; end if;
  end loop;
  if new.pickup_group_id is not null then
    select g.service_date,v.capacity_pax into v_run from public.pickup_groups g
      left join public.transport_vehicles v on v.id=g.vehicle_id where g.id=new.pickup_group_id;
    if v_run.service_date<>new.service_date then raise exception 'The pickup and booking dates must match.'; end if;
    select coalesce(sum(pax_total),0) into v_total from public.bookings where pickup_group_id=new.pickup_group_id and status not in ('cancelled','no_show');
    if coalesce(v_run.capacity_pax,0)<=0 or v_total>v_run.capacity_pax then raise exception 'The pickup vehicle has insufficient seats.'; end if;
  end if;
  return new;
end;
$$;
create trigger check_booking_capacity after update of pax_total,service_date,pickup_group_id,status on public.bookings
for each row execute function public.check_booking_capacity();

create or replace function public.protect_locked_guests()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_booking uuid;
begin
  v_booking := case when tg_op='DELETE' then old.booking_id else new.booking_id end;
  if exists(select 1 from public.trip_bookings tb join public.boat_assignments a on a.id=tb.assignment_id
    where tb.booking_id=v_booking and a.locked) then raise exception 'Unlock the boat day before editing its guests.'; end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
create trigger protect_locked_guests before insert or update or delete on public.tourists
for each row execute function public.protect_locked_guests();

create or replace function public.protect_locked_crew()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.locked and (new.captain_employee_id is distinct from old.captain_employee_id
    or new.guide_employee_id is distinct from old.guide_employee_id
    or new.departure_time is distinct from old.departure_time
    or new.service_date is distinct from old.service_date or new.boat_id is distinct from old.boat_id)
    then raise exception 'Unlock the day before changing the boat or crew.'; end if;
  return new;
end;
$$;
create trigger protect_locked_crew before update on public.boat_assignments
for each row execute function public.protect_locked_crew();

create table public.operation_requests(
  actor_id uuid not null references public.profiles(id),
  operation text not null,
  request_id uuid not null,
  payload_hash text not null,
  result_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(actor_id,operation,request_id)
);
alter table public.operation_requests enable row level security;
revoke all on public.operation_requests from anon,authenticated;

-- Request tokens survive retries; edits carry the version actually displayed.
do $$
declare r record; definition text; payload text; id_name text; table_name text; guard text; ending text;
begin
  for r in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('save_booking','save_purchase_request')
  loop
    payload := case when r.proname='save_booking' then 'p_booking' else 'p_request' end;
    id_name := case when r.proname='save_booking' then 'v_booking_id' else 'v_id' end;
    table_name := case when r.proname='save_booking' then 'bookings' else 'purchase_requests' end;
    definition := pg_get_functiondef(r.oid);
    guard := format($g$
  if %3$s is null then perform public.require_permission(%6$L);
  elsif not (%7$s) then raise exception 'You cannot edit this record.' using errcode='42501'; end if;
  if nullif(%1$s->>'_request_id','') is not null then
    if exists(select 1 from public.operation_requests where actor_id=auth.uid() and operation=%2$L and request_id=(%1$s->>'_request_id')::uuid) then
      if not exists(select 1 from public.operation_requests where actor_id=auth.uid() and operation=%2$L and request_id=(%1$s->>'_request_id')::uuid and payload_hash=md5(%1$s::text || %5$s::text))
        then raise exception 'This saved request has changed. Reload it before saving again.'; end if;
      return (select result_id from public.operation_requests where actor_id=auth.uid() and operation=%2$L and request_id=(%1$s->>'_request_id')::uuid);
    end if;
  end if;
  if %3$s is not null then
    perform 1 from public.%4$I where id=%3$s and updated_at=(%1$s->>'_expected_updated_at')::timestamptz for update;
    if not found then raise exception 'Someone changed this record. Reload it before saving your changes.' using errcode='40001'; end if;
  end if;
  $g$,payload,r.proname,id_name,table_name,case when r.proname='save_booking' then 'p_tourists' else 'p_items' end,
    case when r.proname='save_booking' then 'guests.booking.create' else 'kitchen.request.create' end,
    case when r.proname='save_booking' then 'public.can_edit_booking(v_booking_id)'
      else 'public.has_permission(''kitchen.manage'') or public.has_permission(''purchasing.manage'') or (public.has_permission(''kitchen.request.create'') and exists(select 1 from public.purchase_requests where id=v_id and requested_by=auth.uid() and status=''draft''))' end);
    definition := replace(definition,'perform pg_advisory_xact_lock(73081, 1);','perform pg_advisory_xact_lock(73081, 1);' || guard);
    ending := format($g$
  if nullif(%1$s->>'_request_id','') is not null then
    insert into public.operation_requests(actor_id,operation,request_id,payload_hash,result_id)
    values(auth.uid(),%2$L,(%1$s->>'_request_id')::uuid,md5(%1$s::text || %4$s::text),%3$s);
  end if;
  return %3$s;
  $g$,payload,r.proname,id_name,case when r.proname='save_booking' then 'p_tourists' else 'p_items' end);
    definition := replace(definition,format('return %s;',id_name),ending);
    execute definition;
  end loop;
end $$;
