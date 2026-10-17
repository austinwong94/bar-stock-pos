-- =====================================================================
-- Pickup rebuilt around how it actually works.
--
-- Not every guest is collected: some make their own way to the jetty. The
-- ones who are collected have to be split across vehicles, and each vehicle
-- drives a route, so the useful question is not "who is near whom" but
-- "which van picks up whom, in what order, leaving at what time".
-- =====================================================================

-- ---------------------------------------------------------------------
-- Opt in, per booking
-- ---------------------------------------------------------------------
alter table public.bookings add column if not exists pickup_required boolean not null default false;

-- Anything that already had a hotel recorded was, in practice, a pickup.
update public.bookings
set pickup_required = true
where pickup_required = false
  and coalesce(nullif(trim(pickup_hotel_name), ''), '') <> '';

-- ---------------------------------------------------------------------
-- Vehicles
-- ---------------------------------------------------------------------
create table if not exists public.transport_vehicles (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text,
  vehicle_type text not null default 'van'
    check (vehicle_type in ('van', 'minibus', 'bus', 'car', 'pickup_truck', 'other')),
  capacity_pax int not null default 0 check (capacity_pax >= 0),
  plate_no text,
  default_driver_employee_id uuid references public.employees(id) on delete set null,
  active boolean not null default true,
  notes text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists transport_vehicles_code_key on public.transport_vehicles (lower(code));

drop trigger if exists transport_vehicles_touch on public.transport_vehicles;
create trigger transport_vehicles_touch before update on public.transport_vehicles
for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- A run is one vehicle driving one route on one date.
-- The old table grouped bookings by proximity only; it grows a vehicle,
-- a departure time and an ordered set of stops.
-- ---------------------------------------------------------------------
alter table public.pickup_groups add column if not exists vehicle_id uuid references public.transport_vehicles(id) on delete set null;
alter table public.pickup_groups add column if not exists depart_time time;
alter table public.pickup_groups add column if not exists status text not null default 'planned';
alter table public.pickup_groups add column if not exists sort_order int not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pickup_groups_status_check') then
    alter table public.pickup_groups add constraint pickup_groups_status_check
      check (status in ('planned', 'on_the_road', 'completed', 'cancelled'));
  end if;
end $$;

-- Where each booking sits in its run's route.
alter table public.bookings add column if not exists pickup_stop_order int;
alter table public.bookings add column if not exists pickup_eta time;

create index if not exists bookings_pickup_required_idx
  on public.bookings (service_date, pickup_required) where pickup_required;

insert into public.app_settings (key, value) values
  ('base_latitude',  '5.4200'::jsonb),
  ('base_longitude', '100.3400'::jsonb),
  ('base_name',      '"Main jetty"'::jsonb),
  ('pickup_stop_minutes', '5'::jsonb),
  ('pickup_speed_kmh', '30'::jsonb)
on conflict (key) do nothing;

insert into public.permissions (code, department_code, name, description, sensitive, sort_order) values
  ('guests.pickup.vehicles', 'guests', 'Manage vehicles', 'Add vans and set who drives them.', true, 10)
on conflict (code) do update set name = excluded.name, description = excluded.description;

insert into public.access_role_permissions (role_code, permission_code)
select 'operations_manager', 'guests.pickup.vehicles'
union all select 'coordinator', 'guests.pickup.vehicles'
on conflict do nothing;

create or replace function public.setting_numeric(p_key text, p_default numeric)
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce((select nullif(value #>> '{}', '')::numeric from public.app_settings where key = p_key), p_default)
$$;

-- ---------------------------------------------------------------------
-- Route ordering.
--
-- Collection runs end at the jetty, so the sensible route starts at the
-- hotel furthest away and works inwards, picking the nearest next stop
-- each time. Times are then worked backwards from when the vehicle has to
-- be at the jetty, which is what a driver actually needs to know.
-- ---------------------------------------------------------------------
create or replace function public.order_pickup_run(p_run_id uuid)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_run public.pickup_groups%rowtype;
  v_base_lat numeric := public.setting_numeric('base_latitude', 5.42);
  v_base_lng numeric := public.setting_numeric('base_longitude', 100.34);
  v_speed numeric := greatest(public.setting_numeric('pickup_speed_kmh', 30), 5);
  v_dwell numeric := public.setting_numeric('pickup_stop_minutes', 5);
  v_cur_lat numeric;
  v_cur_lng numeric;
  v_key text;
  v_lat numeric;
  v_lng numeric;
  v_best numeric;
  v_order int := 0;
  v_minutes numeric := 0;
  v_total numeric := 0;
  v_target time;
  v_start time;
  rec record;
begin
  select * into v_run from public.pickup_groups where id = p_run_id;
  if not found then return 0; end if;

  -- Distinct stops: several bookings at one hotel are one stop.
  create temp table if not exists tmp_stops (
    stop_key text primary key,
    lat numeric,
    lng numeric,
    visit_order int,
    minutes_from_start numeric
  ) on commit drop;
  delete from tmp_stops;

  insert into tmp_stops (stop_key, lat, lng)
  select
    lower(coalesce(nullif(trim(b.pickup_hotel_name), ''), nullif(trim(b.pickup_area), ''), b.id::text)),
    avg(coalesce(b.pickup_latitude, l.latitude)),
    avg(coalesce(b.pickup_longitude, l.longitude))
  from public.bookings b
  left join public.pickup_locations l on l.id = b.pickup_location_id
  where b.pickup_group_id = p_run_id
  group by 1;

  if not exists (select 1 from tmp_stops) then return 0; end if;

  -- Start furthest from the jetty; stops with no coordinates go last so
  -- they do not drag the route around.
  select stop_key, lat, lng into v_key, v_cur_lat, v_cur_lng
  from tmp_stops
  order by coalesce(public.distance_km(lat, lng, v_base_lat, v_base_lng), -1) desc
  limit 1;

  loop
    v_order := v_order + 1;
    update tmp_stops set visit_order = v_order, minutes_from_start = v_minutes where stop_key = v_key;

    select s.stop_key, s.lat, s.lng,
           coalesce(public.distance_km(v_cur_lat, v_cur_lng, s.lat, s.lng), 999)
    into v_key, v_lat, v_lng, v_best
    from tmp_stops s
    where s.visit_order is null
    order by coalesce(public.distance_km(v_cur_lat, v_cur_lng, s.lat, s.lng), 999), s.stop_key
    limit 1;

    exit when not found;

    v_minutes := v_minutes + v_dwell + (coalesce(v_best, 0) / v_speed) * 60;
    v_cur_lat := coalesce(v_lat, v_cur_lat);
    v_cur_lng := coalesce(v_lng, v_cur_lng);
  end loop;

  -- Time from the last stop back to the jetty.
  v_total := v_minutes + v_dwell
             + (coalesce(public.distance_km(v_cur_lat, v_cur_lng, v_base_lat, v_base_lng), 0) / v_speed) * 60;

  -- Be at the jetty half an hour before the first boat leaves.
  select min(a.departure_time) into v_target
  from public.boat_assignments a
  where a.service_date = v_run.service_date and a.status <> 'cancelled' and a.departure_time is not null;

  v_target := coalesce(v_target, nullif(public.setting_text('default_departure_time', '09:00'), '')::time);
  v_target := v_target - interval '30 minutes';
  v_start := v_target - make_interval(mins => ceil(v_total)::int);

  update public.pickup_groups
  set depart_time = v_start,
      pickup_time = v_start
  where id = p_run_id;

  for rec in select stop_key, visit_order, minutes_from_start from tmp_stops loop
    update public.bookings b
    set pickup_stop_order = rec.visit_order,
        pickup_eta = v_start + make_interval(mins => ceil(rec.minutes_from_start)::int)
    where b.pickup_group_id = p_run_id
      and lower(coalesce(nullif(trim(b.pickup_hotel_name), ''), nullif(trim(b.pickup_area), ''), b.id::text)) = rec.stop_key;
  end loop;

  return v_order;
end;
$$;

-- ---------------------------------------------------------------------
-- Planning: fill vehicles by area, respecting how many seats each has.
-- ---------------------------------------------------------------------
create or replace function public.auto_plan_pickups(
  p_service_date date,
  p_radius_km numeric default null
)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_radius numeric := coalesce(p_radius_km, public.setting_numeric('pickup_group_radius_km', 1.5));
  v_base_lat numeric := public.setting_numeric('base_latitude', 5.42);
  v_base_lng numeric := public.setting_numeric('base_longitude', 100.34);
  rec record;
  v_run_id uuid;
  v_vehicle record;
  v_placed int := 0;
  v_seats int;
  v_used int;
begin
  perform public.require_permission('guests.pickup.manage');

  for rec in
    select
      b.id,
      b.pax_total,
      coalesce(nullif(trim(b.pickup_hotel_name), ''), nullif(trim(b.pickup_area), ''), 'Pickup') as spot,
      nullif(trim(b.pickup_area), '') as area,
      coalesce(b.pickup_latitude, l.latitude) as lat,
      coalesce(b.pickup_longitude, l.longitude) as lng
    from public.bookings b
    left join public.pickup_locations l on l.id = b.pickup_location_id
    where b.service_date = p_service_date
      and b.pickup_required
      and b.pickup_group_id is null
      and b.status in ('draft', 'confirmed', 'arrived')
    -- Furthest hotels first, so a run builds inwards towards the jetty.
    order by coalesce(public.distance_km(
      coalesce(b.pickup_latitude, l.latitude), coalesce(b.pickup_longitude, l.longitude),
      v_base_lat, v_base_lng), -1) desc, b.created_at
  loop
    v_run_id := null;

    -- An existing run works if it goes near this hotel and still has seats.
    select g.id into v_run_id
    from public.pickup_groups g
    left join public.transport_vehicles v on v.id = g.vehicle_id
    where g.service_date = p_service_date
      and g.status <> 'cancelled'
      and (
        exists (
          select 1 from public.bookings ob
          where ob.pickup_group_id = g.id
            and (
              lower(coalesce(ob.pickup_hotel_name, '')) = lower(rec.spot)
              or (rec.lat is not null and ob.pickup_latitude is not null
                  and public.distance_km(rec.lat, rec.lng, ob.pickup_latitude, ob.pickup_longitude) <= v_radius)
            )
        )
      )
      and (
        coalesce(v.capacity_pax, 0) = 0
        or coalesce((select sum(x.pax_total) from public.bookings x where x.pickup_group_id = g.id), 0) + rec.pax_total
           <= v.capacity_pax
      )
    order by g.sort_order, g.created_at
    limit 1;

    if v_run_id is null then
      -- Next vehicle that is not already out on a run today.
      select v.* into v_vehicle
      from public.transport_vehicles v
      where v.active
        and not exists (
          select 1 from public.pickup_groups g
          where g.service_date = p_service_date and g.vehicle_id = v.id and g.status <> 'cancelled'
        )
      order by v.capacity_pax desc, v.sort_order, v.code
      limit 1;

      insert into public.pickup_groups (
        service_date, name, area_label, latitude, longitude,
        vehicle_id, driver_employee_id, auto_created, created_by, sort_order
      )
      values (
        p_service_date,
        coalesce(v_vehicle.code, 'Run') || ' · ' || rec.spot,
        rec.area,
        rec.lat,
        rec.lng,
        v_vehicle.id,
        v_vehicle.default_driver_employee_id,
        true,
        auth.uid(),
        coalesce((select max(sort_order) + 1 from public.pickup_groups where service_date = p_service_date), 1)
      )
      returning id into v_run_id;
    end if;

    update public.bookings set pickup_group_id = v_run_id where id = rec.id;
    v_placed := v_placed + 1;
  end loop;

  -- Drop empty auto runs, then order the routes that have stops.
  delete from public.pickup_groups g
  where g.service_date = p_service_date
    and g.auto_created
    and not exists (select 1 from public.bookings b where b.pickup_group_id = g.id);

  for rec in select id from public.pickup_groups where service_date = p_service_date loop
    perform public.order_pickup_run(rec.id);
  end loop;

  return v_placed;
end;
$$;

create or replace function public.set_booking_pickup(p_booking_id uuid, p_required boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not (public.has_permission('guests.pickup.manage') or public.can_edit_booking(p_booking_id)) then
    raise exception 'You cannot change this booking.' using errcode = '42501';
  end if;

  update public.bookings
  set pickup_required = p_required,
      pickup_group_id = case when p_required then pickup_group_id else null end,
      pickup_stop_order = case when p_required then pickup_stop_order else null end,
      pickup_eta = case when p_required then pickup_eta else null end
  where id = p_booking_id;
  if not found then raise exception 'Booking not found.'; end if;
end;
$$;

create or replace function public.assign_pickup_run(
  p_booking_id uuid,
  p_run_id uuid,
  p_allow_overload boolean default false
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_seats int;
  v_used int;
  v_incoming int;
  v_label text;
  v_old uuid;
begin
  perform public.require_permission('guests.pickup.manage');

  select pickup_group_id, pax_total into v_old, v_incoming from public.bookings where id = p_booking_id;
  if not found then raise exception 'Booking not found.'; end if;

  if p_run_id is not null then
    select coalesce(v.capacity_pax, 0), coalesce(g.name, 'This run')
    into v_seats, v_label
    from public.pickup_groups g
    left join public.transport_vehicles v on v.id = g.vehicle_id
    where g.id = p_run_id;
    if not found then raise exception 'Pickup run not found.'; end if;

    select coalesce(sum(pax_total), 0) into v_used
    from public.bookings where pickup_group_id = p_run_id and id <> p_booking_id;

    if not p_allow_overload and v_seats > 0 and v_used + v_incoming > v_seats then
      raise exception '% has % seat(s) left and this booking is % pax.',
        v_label, greatest(v_seats - v_used, 0), v_incoming;
    end if;
  end if;

  update public.bookings
  set pickup_group_id = p_run_id,
      pickup_required = case when p_run_id is not null then true else pickup_required end,
      pickup_stop_order = null,
      pickup_eta = null
  where id = p_booking_id;

  if p_run_id is not null then perform public.order_pickup_run(p_run_id); end if;
  if v_old is not null and v_old is distinct from p_run_id then perform public.order_pickup_run(v_old); end if;
end;
$$;

create or replace function public.save_pickup_run(
  p_id uuid,
  p_service_date date,
  p_name text,
  p_vehicle_id uuid default null,
  p_driver_employee_id uuid default null,
  p_depart_time text default null,
  p_status text default null,
  p_notes text default null
)
returns public.pickup_groups
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row public.pickup_groups%rowtype;
begin
  perform public.require_permission('guests.pickup.manage');
  if coalesce(trim(p_name), '') = '' then raise exception 'Give the run a name.'; end if;

  if p_id is null then
    insert into public.pickup_groups (
      service_date, name, vehicle_id, driver_employee_id, depart_time, pickup_time, notes, created_by, sort_order
    )
    values (
      p_service_date, trim(p_name), p_vehicle_id, p_driver_employee_id,
      nullif(p_depart_time, '')::time, nullif(p_depart_time, '')::time, p_notes, auth.uid(),
      coalesce((select max(sort_order) + 1 from public.pickup_groups where service_date = p_service_date), 1)
    )
    returning * into v_row;
  else
    update public.pickup_groups g set
      name = trim(p_name),
      vehicle_id = p_vehicle_id,
      driver_employee_id = p_driver_employee_id,
      depart_time = coalesce(nullif(p_depart_time, '')::time, g.depart_time),
      pickup_time = coalesce(nullif(p_depart_time, '')::time, g.pickup_time),
      status = coalesce(nullif(p_status, ''), g.status),
      notes = coalesce(p_notes, g.notes)
    where g.id = p_id
    returning * into v_row;
    if not found then raise exception 'Pickup run not found.'; end if;
  end if;

  return v_row;
end;
$$;

create or replace function public.delete_pickup_run(p_run_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  perform public.require_permission('guests.pickup.manage');
  update public.bookings
  set pickup_group_id = null, pickup_stop_order = null, pickup_eta = null
  where pickup_group_id = p_run_id;
  delete from public.pickup_groups where id = p_run_id;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS + grants
-- ---------------------------------------------------------------------
alter table public.transport_vehicles enable row level security;

drop policy if exists "vehicles read" on public.transport_vehicles;
create policy "vehicles read" on public.transport_vehicles
  for select to authenticated
  using (
    public.has_permission('guests.pickup.manage')
    or public.has_permission('guests.pickup.vehicles')
    or public.has_permission('platform.directory.manage')
  );

drop policy if exists "vehicles write" on public.transport_vehicles;
create policy "vehicles write" on public.transport_vehicles
  for all to authenticated
  using (public.has_permission('guests.pickup.vehicles') or public.has_permission('platform.directory.manage'))
  with check (public.has_permission('guests.pickup.vehicles') or public.has_permission('platform.directory.manage'));

do $$
declare fn text;
begin
  foreach fn in array array[
    'order_pickup_run(uuid)',
    'auto_plan_pickups(date, numeric)',
    'set_booking_pickup(uuid, boolean)',
    'assign_pickup_run(uuid, uuid, boolean)',
    'save_pickup_run(uuid, date, text, uuid, uuid, text, text, text)',
    'delete_pickup_run(uuid)'
  ]
  loop
    execute format('revoke all on function public.%s from anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

grant execute on function public.setting_numeric(text, numeric) to authenticated;
