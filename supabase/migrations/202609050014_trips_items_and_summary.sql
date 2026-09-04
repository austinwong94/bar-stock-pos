-- =====================================================================
-- Fuel reworked around what is actually measurable, a boat trip log,
-- the missing-items register, an attendance accountability trail, and
-- the daily operations summary.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Elderly guests are counted separately: they change how a PIC seats a
-- boat, so the number has to be visible before the group is dragged.
-- ---------------------------------------------------------------------
alter table public.tourists drop constraint if exists tourists_age_band_check;
alter table public.tourists add constraint tourists_age_band_check
  check (age_band in ('adult', 'child', 'infant', 'elderly'));

alter table public.bookings add column if not exists pax_elderly int not null default 0;

create or replace function public.recount_booking_pax(p_booking_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  update public.bookings b
  set pax_adults = counts.adults,
      pax_children = counts.children,
      pax_elderly = counts.elderly,
      pax_total = counts.total
  from (
    select
      count(*) filter (where age_band = 'adult')::int as adults,
      count(*) filter (where age_band in ('child', 'infant'))::int as children,
      count(*) filter (where age_band = 'elderly')::int as elderly,
      count(*)::int as total
    from public.tourists
    where booking_id = p_booking_id
  ) as counts
  where b.id = p_booking_id;
end;
$$;

do $$
declare v_id uuid;
begin
  for v_id in select id from public.bookings loop
    perform public.recount_booking_pax(v_id);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Fuel: the island buys fuel for the fleet, nobody meters a single boat.
-- So record what was bought, log every trip, and estimate per boat from
-- the trips rather than pretending a per-boat reading exists.
-- ---------------------------------------------------------------------
create table if not exists public.fuel_purchases (
  id uuid primary key default gen_random_uuid(),
  purchase_date date not null,
  litres numeric(10,2) not null check (litres >= 0),
  price_per_litre numeric(10,2) not null default 0 check (price_per_litre >= 0),
  total_cost numeric(12,2) not null default 0 check (total_cost >= 0),
  supplier text,
  fuel_type text not null default 'petrol' check (fuel_type in ('petrol', 'diesel')),
  collected_by_employee_id uuid references public.employees(id) on delete set null,
  receipt_image_path text,
  notes text,
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fuel_purchases_date_idx on public.fuel_purchases (purchase_date desc);

create table if not exists public.boat_trips (
  id uuid primary key default gen_random_uuid(),
  service_date date not null,
  boat_id uuid not null references public.boats(id) on delete cascade,
  trip_type text not null default 'island_run'
    check (trip_type in ('island_run', 'extra_run', 'emergency', 'maintenance_run', 'other')),
  assignment_id uuid references public.boat_assignments(id) on delete set null,
  departure_time time,
  return_time time,
  pax_count int not null default 0 check (pax_count >= 0),
  purpose text,
  notes text,
  auto_generated boolean not null default false,
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists boat_trips_date_idx on public.boat_trips (service_date desc, boat_id);
-- One auto row per assignment; manual trips are never deduplicated.
create unique index if not exists boat_trips_assignment_idx
  on public.boat_trips (assignment_id) where assignment_id is not null;

drop trigger if exists fuel_purchases_touch on public.fuel_purchases;
create trigger fuel_purchases_touch before update on public.fuel_purchases
for each row execute function public.touch_updated_at();
drop trigger if exists boat_trips_touch on public.boat_trips;
create trigger boat_trips_touch before update on public.boat_trips
for each row execute function public.touch_updated_at();

create or replace function public.fuel_purchase_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.total_cost is null or new.total_cost = 0 then
    new.total_cost := round(coalesce(new.litres, 0) * coalesce(new.price_per_litre, 0), 2);
  end if;
  if tg_op = 'INSERT' then
    new.recorded_by := coalesce(new.recorded_by, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists fuel_purchase_before_write on public.fuel_purchases;
create trigger fuel_purchase_before_write before insert or update on public.fuel_purchases
for each row execute function public.fuel_purchase_before_write();

-- Carry the old per-boat rows across: refuels become fleet purchases,
-- usage rows become trips, so no history is lost.
do $$
begin
  if to_regclass('public.boat_fuel_logs') is not null then
    insert into public.fuel_purchases (purchase_date, litres, price_per_litre, total_cost, notes, recorded_by, created_at)
    select f.log_date, f.litres, f.price_per_litre, f.total_cost,
           coalesce(f.notes, '') || ' (migrated from ' || b.code || ')', f.recorded_by, f.created_at
    from public.boat_fuel_logs f join public.boats b on b.id = f.boat_id
    where f.entry_type = 'refuel'
      and not exists (select 1 from public.fuel_purchases p where p.created_at = f.created_at);

    insert into public.boat_trips (service_date, boat_id, trip_type, pax_count, purpose, notes, auto_generated, recorded_by, created_at)
    select f.log_date, f.boat_id, 'island_run', 0, f.trip_label,
           coalesce(f.notes, '') || ' (migrated fuel entry: ' || f.litres || ' L)', false, f.recorded_by, f.created_at
    from public.boat_fuel_logs f
    where f.entry_type = 'trip_usage'
      and not exists (select 1 from public.boat_trips t where t.created_at = f.created_at);
  end if;
end $$;

-- Every boat that actually carried guests made a trip, so the log fills
-- itself from the manifest and only the extra runs need typing in.
create or replace function public.sync_boat_trips(p_service_date date)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_added int;
begin
  perform public.require_permission('maintenance.view');

  insert into public.boat_trips (
    service_date, boat_id, trip_type, assignment_id, departure_time, return_time,
    pax_count, purpose, auto_generated, recorded_by
  )
  select
    a.service_date,
    a.boat_id,
    'island_run',
    a.id,
    a.departure_time,
    a.return_time,
    coalesce((select count(*) from public.trip_passengers tp
              where tp.assignment_id = a.id and tp.boarding_status = 'arrived'), 0),
    'Scheduled island run',
    true,
    auth.uid()
  from public.boat_assignments a
  where a.service_date = p_service_date
    and a.status <> 'cancelled'
    and exists (select 1 from public.trip_passengers tp where tp.assignment_id = a.id)
    and not exists (select 1 from public.boat_trips t where t.assignment_id = a.id);

  get diagnostics v_added = row_count;

  -- Keep the auto rows honest if people boarded after the row was made.
  update public.boat_trips t
  set pax_count = coalesce((select count(*) from public.trip_passengers tp
                            where tp.assignment_id = t.assignment_id and tp.boarding_status = 'arrived'), 0),
      departure_time = coalesce(a.departure_time, t.departure_time)
  from public.boat_assignments a
  where t.assignment_id = a.id
    and t.auto_generated
    and a.service_date = p_service_date;

  return v_added;
end;
$$;

create or replace function public.save_boat_trip(
  p_id uuid,
  p_service_date date,
  p_boat_id uuid,
  p_trip_type text,
  p_departure_time text default null,
  p_return_time text default null,
  p_pax_count int default 0,
  p_purpose text default null,
  p_notes text default null
)
returns public.boat_trips
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row public.boat_trips%rowtype;
begin
  perform public.require_permission('maintenance.fuel.record');
  if p_trip_type not in ('island_run', 'extra_run', 'emergency', 'maintenance_run', 'other') then
    raise exception 'Unknown trip type "%".', p_trip_type;
  end if;

  if p_id is null then
    insert into public.boat_trips (
      service_date, boat_id, trip_type, departure_time, return_time,
      pax_count, purpose, notes, auto_generated, recorded_by
    )
    values (
      p_service_date, p_boat_id, p_trip_type,
      nullif(p_departure_time, '')::time, nullif(p_return_time, '')::time,
      coalesce(p_pax_count, 0), nullif(p_purpose, ''), nullif(p_notes, ''), false, auth.uid()
    )
    returning * into v_row;
  else
    update public.boat_trips set
      service_date = p_service_date,
      boat_id = p_boat_id,
      trip_type = p_trip_type,
      departure_time = nullif(p_departure_time, '')::time,
      return_time = nullif(p_return_time, '')::time,
      pax_count = coalesce(p_pax_count, 0),
      purpose = nullif(p_purpose, ''),
      notes = nullif(p_notes, '')
    where id = p_id
    returning * into v_row;
    if not found then raise exception 'Trip not found.'; end if;
  end if;

  return v_row;
end;
$$;

create or replace function public.delete_boat_trip(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  perform public.require_permission('maintenance.manage');
  delete from public.boat_trips where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Fuel estimate.
--
-- Each boat carries a normal litres-per-trip figure. Trips x that figure
-- is the estimate; comparing the fleet estimate against what was really
-- bought is what shows whether fuel is going somewhere it should not.
-- ---------------------------------------------------------------------
create or replace function public.fuel_reconciliation(p_from date, p_to date)
returns table (
  boat_id uuid,
  boat_code text,
  trips int,
  emergency_trips int,
  pax_carried int,
  litres_per_trip numeric,
  estimated_litres numeric,
  estimated_share_pct numeric,
  estimated_cost numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with avg_price as (
    select case when sum(litres) > 0 then sum(total_cost) / sum(litres) else 0 end as price
    from public.fuel_purchases
    where purchase_date between p_from and p_to
  ),
  per_boat as (
    select
      b.id,
      b.code,
      count(t.id)::int as trips,
      count(t.id) filter (where t.trip_type = 'emergency')::int as emergency_trips,
      coalesce(sum(t.pax_count), 0)::int as pax_carried,
      coalesce(b.expected_litres_per_trip, 0) as litres_per_trip,
      count(t.id) * coalesce(b.expected_litres_per_trip, 0) as estimated_litres
    from public.boats b
    left join public.boat_trips t
      on t.boat_id = b.id and t.service_date between p_from and p_to
    group by b.id, b.code, b.expected_litres_per_trip
  ),
  fleet as (select sum(estimated_litres) as total from per_boat)
  select
    p.id,
    p.code,
    p.trips,
    p.emergency_trips,
    p.pax_carried,
    p.litres_per_trip,
    round(p.estimated_litres, 1),
    case when (select total from fleet) > 0
         then round(p.estimated_litres / (select total from fleet) * 100, 1)
         else 0 end,
    round(p.estimated_litres * (select price from avg_price), 2)
  from per_boat p
  where public.has_permission('maintenance.view')
  order by p.code
$$;

create or replace function public.fuel_period_totals(p_from date, p_to date)
returns table (
  litres_bought numeric,
  cost_bought numeric,
  litres_estimated numeric,
  variance_litres numeric,
  variance_pct numeric,
  trips int
)
language sql
stable
security definer
set search_path = public
as $$
  with bought as (
    select coalesce(sum(litres), 0) as litres, coalesce(sum(total_cost), 0) as cost
    from public.fuel_purchases where purchase_date between p_from and p_to
  ),
  used as (
    select
      coalesce(sum(coalesce(b.expected_litres_per_trip, 0)), 0) as litres,
      count(*)::int as trips
    from public.boat_trips t join public.boats b on b.id = t.boat_id
    where t.service_date between p_from and p_to
  )
  select
    bought.litres,
    bought.cost,
    round(used.litres, 1),
    round(bought.litres - used.litres, 1),
    case when used.litres > 0 then round((bought.litres - used.litres) / used.litres * 100, 1) else null end,
    used.trips
  from bought, used
  where public.has_permission('maintenance.view')
$$;

-- ---------------------------------------------------------------------
-- Missing items
-- ---------------------------------------------------------------------
insert into public.departments (code, name, description, icon, sort_order) values
  ('items', 'Island Items', 'Equipment that has gone missing, and whether it turned up again.', 'PackageSearch', 11)
on conflict (code) do update
  set name = excluded.name, description = excluded.description, icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.permissions (code, department_code, name, description, sensitive, sort_order) values
  ('items.view',   'items', 'View missing items',  'See the register of missing equipment.', false, 1),
  ('items.report', 'items', 'Report an item',      'Record an item that has gone missing.', false, 2),
  ('items.manage', 'items', 'Close and correct',   'Mark items found or written off, and edit entries.', true, 3),
  ('items.cost.view','items','See item values',    'View the money value put on missing items.', true, 4)
on conflict (code) do update
  set department_code = excluded.department_code, name = excluded.name,
      description = excluded.description, sensitive = excluded.sensitive, sort_order = excluded.sort_order;

create table if not exists public.missing_items (
  id uuid primary key default gen_random_uuid(),
  item_name text not null,
  category text not null default 'equipment'
    check (category in ('snorkel_gear', 'safety_gear', 'clothing', 'kitchen', 'boat_part', 'electronics', 'equipment', 'other')),
  quantity int not null default 1 check (quantity > 0),
  missing_on date not null default current_date,
  noticed_location text,
  boat_id uuid references public.boats(id) on delete set null,
  remarks text,
  estimated_value numeric(12,2),
  status text not null default 'missing' check (status in ('missing', 'found', 'written_off')),
  found_on date,
  found_remarks text,
  reported_by uuid references public.profiles(id) on delete set null,
  resolved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists missing_items_status_idx on public.missing_items (status, missing_on desc);

drop trigger if exists missing_items_touch on public.missing_items;
create trigger missing_items_touch before update on public.missing_items
for each row execute function public.touch_updated_at();

drop trigger if exists missing_items_audit on public.missing_items;
create trigger missing_items_audit after insert or update or delete on public.missing_items
for each row execute function public.audit_row_change();

create or replace function public.save_missing_item(
  p_id uuid,
  p_item_name text,
  p_category text,
  p_quantity int,
  p_missing_on date,
  p_noticed_location text default null,
  p_boat_id uuid default null,
  p_remarks text default null,
  p_estimated_value numeric default null
)
returns public.missing_items
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row public.missing_items%rowtype;
begin
  if coalesce(trim(p_item_name), '') = '' then raise exception 'Say which item is missing.'; end if;

  if p_id is null then
    perform public.require_permission('items.report');
    insert into public.missing_items (
      item_name, category, quantity, missing_on, noticed_location, boat_id,
      remarks, estimated_value, reported_by
    )
    values (
      trim(p_item_name), coalesce(p_category, 'equipment'), greatest(coalesce(p_quantity, 1), 1),
      coalesce(p_missing_on, current_date), nullif(p_noticed_location, ''), p_boat_id,
      nullif(p_remarks, ''), p_estimated_value, auth.uid()
    )
    returning * into v_row;
  else
    select * into v_row from public.missing_items where id = p_id;
    if not found then raise exception 'Item not found.'; end if;
    if not (public.has_permission('items.manage') or v_row.reported_by = auth.uid()) then
      raise exception 'You can only edit items you reported.' using errcode = '42501';
    end if;

    update public.missing_items set
      item_name = trim(p_item_name),
      category = coalesce(p_category, category),
      quantity = greatest(coalesce(p_quantity, quantity), 1),
      missing_on = coalesce(p_missing_on, missing_on),
      noticed_location = nullif(p_noticed_location, ''),
      boat_id = p_boat_id,
      remarks = nullif(p_remarks, ''),
      estimated_value = p_estimated_value
    where id = p_id
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

create or replace function public.resolve_missing_item(
  p_id uuid,
  p_status text,
  p_found_on date default null,
  p_remarks text default null
)
returns public.missing_items
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row public.missing_items%rowtype;
begin
  perform public.require_permission('items.manage');
  if p_status not in ('missing', 'found', 'written_off') then
    raise exception 'Status must be missing, found or written_off.';
  end if;
  if p_status = 'written_off' and coalesce(trim(p_remarks), '') = '' then
    raise exception 'Say why this item is being written off.';
  end if;

  update public.missing_items set
    status = p_status,
    found_on = case when p_status = 'found' then coalesce(p_found_on, current_date) else null end,
    found_remarks = nullif(p_remarks, ''),
    resolved_by = case when p_status = 'missing' then null else auth.uid() end
  where id = p_id
  returning * into v_row;
  if not found then raise exception 'Item not found.'; end if;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------
-- Attendance accountability: every tick is attributable to a person.
-- ---------------------------------------------------------------------
create table if not exists public.attendance_log (
  id uuid primary key default gen_random_uuid(),
  service_date date not null,
  assignment_id uuid references public.boat_assignments(id) on delete cascade,
  boat_code text,
  passenger_id uuid,
  tourist_name text,
  booking_ref text,
  action text not null,
  from_value text,
  to_value text,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text,
  created_at timestamptz not null default now()
);

create index if not exists attendance_log_day_idx on public.attendance_log (service_date, created_at desc);
create index if not exists attendance_log_assignment_idx on public.attendance_log (assignment_id);

create or replace function public.record_attendance_actions(
  p_passenger_ids uuid[],
  p_action text,
  p_to_value text
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor text;
begin
  select coalesce(full_name, 'unknown') into v_actor from public.profiles where id = auth.uid();

  insert into public.attendance_log (
    service_date, assignment_id, boat_code, passenger_id, tourist_name, booking_ref,
    action, to_value, actor_id, actor_name
  )
  select
    a.service_date, a.id, bo.code, tp.id, t.full_name, bk.booking_ref,
    p_action, p_to_value, auth.uid(), coalesce(v_actor, 'unknown')
  from public.trip_passengers tp
  join public.boat_assignments a on a.id = tp.assignment_id
  join public.boats bo on bo.id = a.boat_id
  join public.tourists t on t.id = tp.tourist_id
  join public.bookings bk on bk.id = tp.booking_id
  where tp.id = any(p_passenger_ids);
end;
$$;

alter table public.trip_passengers add column if not exists returned_by uuid references public.profiles(id) on delete set null;

-- Attendance RPCs, now writing an attributable log line per guest and
-- supporting an explicit "not decided yet" for activities.
create or replace function public.mark_boarding(p_passenger_ids uuid[], p_status text)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_count int;
  v_assignment uuid;
  v_allowed uuid[];
begin
  perform public.require_permission('boarding.mark');
  if p_status not in ('pending', 'arrived', 'no_show') then
    raise exception 'Boarding status must be pending, arrived or no_show.';
  end if;

  select array_agg(tp.id) into v_allowed
  from public.trip_passengers tp
  where tp.id = any(p_passenger_ids) and public.can_see_assignment(tp.assignment_id);

  if v_allowed is null then return 0; end if;

  update public.trip_passengers tp set
    boarding_status = p_status,
    boarded_at = case when p_status = 'pending' then null else now() end,
    boarded_by = case when p_status = 'pending' then null else auth.uid() end
  where tp.id = any(v_allowed);
  get diagnostics v_count = row_count;

  perform public.record_attendance_actions(v_allowed, 'boarding', p_status);

  for v_assignment in select distinct assignment_id from public.trip_passengers where id = any(v_allowed)
  loop
    perform public.refresh_assignment_milestones(v_assignment);
  end loop;

  return v_count;
end;
$$;

create or replace function public.set_passenger_activity(p_passenger_ids uuid[], p_activity_code text)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_count int;
  v_assignment uuid;
  v_allowed uuid[];
begin
  perform public.require_permission('activities.select');
  -- A null code clears the choice back to "not decided". Without this the
  -- guide cannot undo a mis-tap, and a guest looks decided when they are not.
  if p_activity_code is not null
     and not exists (select 1 from public.activity_types where code = p_activity_code and active) then
    raise exception 'Unknown activity "%".', p_activity_code;
  end if;

  select array_agg(tp.id) into v_allowed
  from public.trip_passengers tp
  where tp.id = any(p_passenger_ids) and public.can_see_assignment(tp.assignment_id);

  if v_allowed is null then return 0; end if;

  update public.trip_passengers tp set
    activity_code = p_activity_code,
    activity_status = 'pending',
    activity_marked_at = null,
    activity_marked_by = null,
    returned = false,
    returned_at = null,
    returned_by = null
  where tp.id = any(v_allowed);
  get diagnostics v_count = row_count;

  perform public.record_attendance_actions(
    v_allowed, 'activity_choice', coalesce(p_activity_code, 'cleared'));

  for v_assignment in select distinct assignment_id from public.trip_passengers where id = any(v_allowed)
  loop
    perform public.refresh_assignment_milestones(v_assignment);
  end loop;

  return v_count;
end;
$$;

create or replace function public.mark_activity_attendance(
  p_passenger_ids uuid[],
  p_status text default null,
  p_returned boolean default null
)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_count int;
  v_assignment uuid;
  v_allowed uuid[];
begin
  perform public.require_permission('activities.mark');
  if p_status is not null and p_status not in ('pending', 'joined', 'absent') then
    raise exception 'Activity status must be pending, joined or absent.';
  end if;

  select array_agg(tp.id) into v_allowed
  from public.trip_passengers tp
  where tp.id = any(p_passenger_ids) and public.can_see_assignment(tp.assignment_id);

  if v_allowed is null then return 0; end if;

  update public.trip_passengers tp set
    activity_status = coalesce(p_status, tp.activity_status),
    activity_marked_at = case when p_status is null then tp.activity_marked_at else now() end,
    activity_marked_by = case when p_status is null then tp.activity_marked_by else auth.uid() end,
    returned = coalesce(p_returned, tp.returned),
    returned_at = case
      when p_returned is null then tp.returned_at
      when p_returned then now()
      else null
    end,
    returned_by = case
      when p_returned is null then tp.returned_by
      when p_returned then auth.uid()
      else null
    end
  where tp.id = any(v_allowed);
  get diagnostics v_count = row_count;

  if p_status is not null then
    perform public.record_attendance_actions(v_allowed, 'activity_roll_call', p_status);
  end if;
  if p_returned is not null then
    perform public.record_attendance_actions(
      v_allowed, 'back_on_boat', case when p_returned then 'yes' else 'no' end);
  end if;

  for v_assignment in select distinct assignment_id from public.trip_passengers where id = any(v_allowed)
  loop
    perform public.refresh_assignment_milestones(v_assignment);
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- Daily operations summary: one call that answers "what happened today".
-- Each block is filtered by what the caller is allowed to see, so a guide
-- opening it does not get the bar's takings.
-- ---------------------------------------------------------------------
create or replace function public.operations_summary(p_service_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb := '{}'::jsonb;
begin
  perform public.require_permission('ops.log.view');

  -- Guests and boats
  v := v || jsonb_build_object('guests', (
    select jsonb_build_object(
      'bookings', count(distinct b.id),
      'pax', coalesce(sum(b.pax_total), 0),
      'adults', coalesce(sum(b.pax_adults), 0),
      'children', coalesce(sum(b.pax_children), 0),
      'elderly', coalesce(sum(b.pax_elderly), 0),
      'by_source', coalesce((
        select jsonb_object_agg(source_type, pax)
        from (
          select source_type, sum(pax_total) as pax
          from public.bookings
          where service_date = p_service_date and status <> 'cancelled'
          group by source_type
        ) s
      ), '{}'::jsonb)
    )
    from public.bookings b
    where b.service_date = p_service_date and b.status <> 'cancelled'
  ));

  v := v || jsonb_build_object('boats', coalesce((
    select jsonb_agg(row order by row->>'code')
    from (
      select jsonb_build_object(
        'code', bo.code,
        'name', bo.name,
        'capacity', bo.capacity_pax,
        'captain', cap.full_name,
        'guide', gd.full_name,
        'departure', to_char(a.departure_time, 'HH24:MI'),
        'assigned', (select count(*) from public.trip_passengers tp where tp.assignment_id = a.id),
        'boarded', (select count(*) from public.trip_passengers tp
                    where tp.assignment_id = a.id and tp.boarding_status = 'arrived'),
        'no_show', (select count(*) from public.trip_passengers tp
                    where tp.assignment_id = a.id and tp.boarding_status = 'no_show'),
        'returned', (select count(*) from public.trip_passengers tp
                     where tp.assignment_id = a.id and tp.returned)
      ) as row
      from public.boat_assignments a
      join public.boats bo on bo.id = a.boat_id
      left join public.employees cap on cap.id = a.captain_employee_id
      left join public.employees gd on gd.id = a.guide_employee_id
      where a.service_date = p_service_date
        and a.status <> 'cancelled'
        and exists (select 1 from public.trip_passengers tp where tp.assignment_id = a.id)
    ) boats
  ), '[]'::jsonb));

  -- Activities
  v := v || jsonb_build_object('activities', coalesce((
    select jsonb_agg(jsonb_build_object(
      'code', at.code, 'name', at.name,
      'chosen', counts.chosen, 'joined', counts.joined, 'back', counts.back))
    from public.activity_types at
    join lateral (
      select
        count(*) filter (where tp.activity_code = at.code)::int as chosen,
        count(*) filter (where tp.activity_code = at.code and tp.activity_status = 'joined')::int as joined,
        count(*) filter (where tp.activity_code = at.code and tp.returned)::int as back
      from public.trip_passengers tp
      join public.boat_assignments a on a.id = tp.assignment_id
      where a.service_date = p_service_date
    ) counts on true
    where at.active
  ), '[]'::jsonb));

  v := v || jsonb_build_object('headcount', (
    select jsonb_build_object(
      'assigned', count(*),
      'boarded', count(*) filter (where tp.boarding_status = 'arrived'),
      'no_show', count(*) filter (where tp.boarding_status = 'no_show'),
      'not_checked', count(*) filter (where tp.boarding_status = 'pending'),
      'activity_chosen', count(*) filter (where tp.activity_code is not null),
      'back_on_boat', count(*) filter (where tp.returned)
    )
    from public.trip_passengers tp
    join public.boat_assignments a on a.id = tp.assignment_id
    where a.service_date = p_service_date
  ));

  -- Boat trips and fuel
  v := v || jsonb_build_object('trips', coalesce((
    select jsonb_agg(jsonb_build_object(
      'boat', bo.code, 'type', t.trip_type, 'pax', t.pax_count,
      'departure', to_char(t.departure_time, 'HH24:MI'), 'purpose', t.purpose))
    from public.boat_trips t join public.boats bo on bo.id = t.boat_id
    where t.service_date = p_service_date
  ), '[]'::jsonb));

  if public.has_permission('maintenance.view') then
    v := v || jsonb_build_object('fuel', (
      select jsonb_build_object(
        'litres_bought', coalesce(sum(litres), 0),
        'cost', case when public.has_permission('maintenance.cost.view')
                     then coalesce(sum(total_cost), 0) else null end)
      from public.fuel_purchases where purchase_date = p_service_date
    ));
  end if;

  -- Kitchen and purchasing
  if public.has_permission('kitchen.request.view') or public.has_permission('purchasing.view') then
    v := v || jsonb_build_object('supplies', (
      select jsonb_build_object(
        'requests', count(distinct r.id),
        'items', (select count(*) from public.purchase_request_items i
                  join public.purchase_requests rr on rr.id = i.request_id
                  where rr.needed_for_date = p_service_date),
        'items_bought', (select count(*) from public.purchase_request_items i
                         join public.purchase_requests rr on rr.id = i.request_id
                         where rr.needed_for_date = p_service_date and i.purchase_status = 'bought'),
        'pax_catered', coalesce(max(r.pax_count), 0),
        'spend', case when public.has_permission('purchasing.cost.view') then (
                   select coalesce(sum(i.actual_cost), 0) from public.purchase_request_items i
                   join public.purchase_requests rr on rr.id = i.request_id
                   where rr.needed_for_date = p_service_date) else null end)
      from public.purchase_requests r
      where r.needed_for_date = p_service_date and r.status <> 'cancelled'
    ));
  end if;

  -- Missing items reported today
  if public.has_permission('items.view') then
    v := v || jsonb_build_object('missing_items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'item', item_name, 'quantity', quantity, 'status', status, 'remarks', remarks))
      from public.missing_items where missing_on = p_service_date
    ), '[]'::jsonb));
  end if;

  -- Bar takings
  if public.has_permission('bar.reports.view') then
    v := v || jsonb_build_object('bar', (
      select jsonb_build_object(
        'sales', count(*),
        'total', coalesce(sum(paid_amount), 0),
        'cash', coalesce(sum(paid_amount) filter (where payment_method = 'cash'), 0),
        'qr', coalesce(sum(paid_amount) filter (where payment_method = 'qr'), 0),
        'complimentary', coalesce(sum(total_amount) filter (where payment_method = 'complimentary'), 0))
      from public.sales
      where business_date = p_service_date and status = 'completed'
    ));
  end if;

  -- Anything that went wrong
  v := v || jsonb_build_object('incidents', coalesce((
    select jsonb_agg(jsonb_build_object(
      'event', event_code, 'subject', subject, 'detail', detail,
      'at', to_char(occurred_at at time zone 'Asia/Kuala_Lumpur', 'HH24:MI')))
    from public.operations_events
    where service_date = p_service_date and severity in ('warning', 'alert')
  ), '[]'::jsonb));

  return v;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS + grants
-- ---------------------------------------------------------------------
alter table public.fuel_purchases enable row level security;
alter table public.boat_trips enable row level security;
alter table public.missing_items enable row level security;
alter table public.attendance_log enable row level security;

drop policy if exists "fuel purchases read" on public.fuel_purchases;
create policy "fuel purchases read" on public.fuel_purchases
  for select to authenticated using (public.has_permission('maintenance.view'));

drop policy if exists "fuel purchases insert" on public.fuel_purchases;
create policy "fuel purchases insert" on public.fuel_purchases
  for insert to authenticated with check (public.has_permission('maintenance.fuel.record'));

drop policy if exists "fuel purchases update" on public.fuel_purchases;
create policy "fuel purchases update" on public.fuel_purchases
  for update to authenticated
  using (public.has_permission('maintenance.manage') or recorded_by = auth.uid())
  with check (public.has_permission('maintenance.manage') or recorded_by = auth.uid());

drop policy if exists "fuel purchases delete" on public.fuel_purchases;
create policy "fuel purchases delete" on public.fuel_purchases
  for delete to authenticated using (public.has_permission('maintenance.manage'));

drop policy if exists "boat trips read" on public.boat_trips;
create policy "boat trips read" on public.boat_trips
  for select to authenticated
  using (public.has_permission('maintenance.view') or public.has_permission('fleet.view'));

drop policy if exists "missing items read" on public.missing_items;
create policy "missing items read" on public.missing_items
  for select to authenticated
  using (public.has_permission('items.view') or reported_by = auth.uid());

drop policy if exists "attendance log read" on public.attendance_log;
create policy "attendance log read" on public.attendance_log
  for select to authenticated
  using (
    public.has_permission('ops.log.view')
    or (assignment_id is not null and public.can_see_assignment(assignment_id))
  );

insert into public.access_role_permissions (role_code, permission_code)
select 'operations_manager', code from public.permissions where department_code = 'items'
union all
select 'coordinator', code from public.permissions where code in ('items.view', 'items.report')
union all
select 'guide', code from public.permissions where code in ('items.view', 'items.report')
union all
select 'captain', code from public.permissions where code in ('items.view', 'items.report')
union all
select 'accountant', code from public.permissions where code in ('items.view', 'items.cost.view')
on conflict do nothing;

do $$
declare fn text;
begin
  foreach fn in array array[
    'sync_boat_trips(date)',
    'save_boat_trip(uuid, date, uuid, text, text, text, int, text, text)',
    'delete_boat_trip(uuid)',
    'fuel_reconciliation(date, date)',
    'fuel_period_totals(date, date)',
    'save_missing_item(uuid, text, text, int, date, text, uuid, text, numeric)',
    'resolve_missing_item(uuid, text, date, text)',
    'operations_summary(date)'
  ]
  loop
    execute format('revoke all on function public.%s from anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

revoke all on function public.record_attendance_actions(uuid[], text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Reference numbers were count(*) + 1, so deleting a booking and adding
-- another on the same date reused a reference and hit the unique index.
-- Take the highest suffix actually in use and step past anything taken.
-- ---------------------------------------------------------------------
create or replace function public.next_booking_ref(p_service_date date)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_prefix text := 'LP-' || to_char(p_service_date, 'YYMMDD') || '-';
  v_seq int;
  v_ref text;
begin
  select coalesce(max(nullif(regexp_replace(booking_ref, '^.*-', ''), '')::int), 0) + 1
  into v_seq
  from public.bookings
  where service_date = p_service_date and booking_ref like v_prefix || '%';

  loop
    v_ref := v_prefix || lpad(v_seq::text, 3, '0');
    exit when not exists (select 1 from public.bookings where booking_ref = v_ref);
    v_seq := v_seq + 1;
  end loop;

  return v_ref;
end;
$$;

create or replace function public.next_request_no(p_date date)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_prefix text := 'PR-' || to_char(p_date, 'YYMMDD') || '-';
  v_seq int;
  v_ref text;
begin
  select coalesce(max(nullif(regexp_replace(request_no, '^.*-', ''), '')::int), 0) + 1
  into v_seq
  from public.purchase_requests
  where needed_for_date = p_date and request_no like v_prefix || '%';

  loop
    v_ref := v_prefix || lpad(v_seq::text, 3, '0');
    exit when not exists (select 1 from public.purchase_requests where request_no = v_ref);
    v_seq := v_seq + 1;
  end loop;

  return v_ref;
end;
$$;

revoke all on function public.next_request_no(date) from public, anon, authenticated;
revoke all on function public.next_booking_ref(date) from public, anon, authenticated;
