-- =====================================================================
-- Bookings, tourists, pickup coordination, boat manifest, boarding and
-- island activities.
--
-- Privacy rule that drives every policy in this file: a travel agent may
-- only ever reach the bookings their own agency created. The full guest
-- list needs guests.booking.view_all, which no agent role holds.
-- =====================================================================

create table if not exists public.pickup_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  area text,
  address text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists pickup_locations_name_key on public.pickup_locations (lower(name));

create table if not exists public.pickup_groups (
  id uuid primary key default gen_random_uuid(),
  service_date date not null,
  name text not null,
  area_label text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  pickup_time time,
  vehicle text,
  driver_employee_id uuid references public.employees(id) on delete set null,
  notes text,
  auto_created boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pickup_groups_date_idx on public.pickup_groups (service_date);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  booking_ref text not null unique,
  service_date date not null,
  source_type text not null default 'in_house'
    check (source_type in ('agent', 'ota', 'in_house', 'walk_in', 'other')),
  agency_id uuid references public.agencies(id) on delete set null,
  external_ref text,
  lead_name text not null,
  lead_phone text,
  lead_email text,
  nationality text,
  pax_total int not null default 0,
  pax_adults int not null default 0,
  pax_children int not null default 0,
  pickup_location_id uuid references public.pickup_locations(id) on delete set null,
  pickup_hotel_name text,
  pickup_area text,
  pickup_latitude numeric(9,6),
  pickup_longitude numeric(9,6),
  pickup_time time,
  pickup_group_id uuid references public.pickup_groups(id) on delete set null,
  status text not null default 'confirmed'
    check (status in ('draft', 'confirmed', 'arrived', 'cancelled', 'no_show')),
  special_requests text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bookings_service_date_idx on public.bookings (service_date, created_at);
create index if not exists bookings_agency_idx on public.bookings (agency_id, service_date);
create index if not exists bookings_created_by_idx on public.bookings (created_by);
create index if not exists bookings_pickup_group_idx on public.bookings (pickup_group_id);

-- One row per person. Everyone on the same booking stays on the same
-- booking, which is what keeps a family of five together downstream.
create table if not exists public.tourists (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  full_name text not null,
  phone text,
  nationality text,
  age_band text not null default 'adult' check (age_band in ('adult', 'child', 'infant')),
  gender text,
  is_lead boolean not null default false,
  seat_note text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tourists_booking_idx on public.tourists (booking_id, sort_order);

-- Identity documents live in their own table so that a captain reading a
-- boarding list physically cannot select passport numbers.
create table if not exists public.tourist_private (
  tourist_id uuid primary key references public.tourists(id) on delete cascade,
  passport_no text,
  date_of_birth date,
  email text,
  medical_notes text,
  dietary_notes text,
  updated_at timestamptz not null default now()
);

create table if not exists public.activity_types (
  code text primary key,
  name text not null,
  description text,
  sort_order int not null default 0,
  active boolean not null default true
);

insert into public.activity_types (code, name, description, sort_order) values
  ('snorkel', 'Snorkelling', 'Reef snorkelling trip.', 1),
  ('volcano', 'Volcanic Mud', 'Volcanic mud bath on the island.', 2),
  ('others',  'Others / Rest', 'Resting on the island, injured, or another activity.', 3)
on conflict (code) do nothing;

create table if not exists public.boat_assignments (
  id uuid primary key default gen_random_uuid(),
  service_date date not null,
  boat_id uuid not null references public.boats(id) on delete cascade,
  trip_no int not null default 1,
  departure_time time,
  return_time time,
  captain_employee_id uuid references public.employees(id) on delete set null,
  guide_employee_id uuid references public.employees(id) on delete set null,
  status text not null default 'planned'
    check (status in ('planned', 'boarding', 'departed', 'returned', 'cancelled')),
  locked boolean not null default false,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_date, boat_id, trip_no)
);

create index if not exists boat_assignments_date_idx on public.boat_assignments (service_date);

-- A booking sits on exactly one boat, so the whole group moves together.
create table if not exists public.trip_bookings (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.boat_assignments(id) on delete cascade,
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now()
);

create index if not exists trip_bookings_assignment_idx on public.trip_bookings (assignment_id);

create table if not exists public.trip_passengers (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.boat_assignments(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  tourist_id uuid not null references public.tourists(id) on delete cascade,
  boarding_status text not null default 'pending'
    check (boarding_status in ('pending', 'arrived', 'no_show')),
  boarded_at timestamptz,
  boarded_by uuid references public.profiles(id) on delete set null,
  activity_code text references public.activity_types(code) on delete set null,
  activity_status text not null default 'pending'
    check (activity_status in ('pending', 'joined', 'absent')),
  activity_marked_at timestamptz,
  activity_marked_by uuid references public.profiles(id) on delete set null,
  returned boolean not null default false,
  returned_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, tourist_id)
);

create index if not exists trip_passengers_assignment_idx on public.trip_passengers (assignment_id);
create index if not exists trip_passengers_booking_idx on public.trip_passengers (booking_id);

drop trigger if exists pickup_locations_touch on public.pickup_locations;
create trigger pickup_locations_touch before update on public.pickup_locations
for each row execute function public.touch_updated_at();
drop trigger if exists pickup_groups_touch on public.pickup_groups;
create trigger pickup_groups_touch before update on public.pickup_groups
for each row execute function public.touch_updated_at();
drop trigger if exists bookings_touch on public.bookings;
create trigger bookings_touch before update on public.bookings
for each row execute function public.touch_updated_at();
drop trigger if exists tourists_touch on public.tourists;
create trigger tourists_touch before update on public.tourists
for each row execute function public.touch_updated_at();
drop trigger if exists tourist_private_touch on public.tourist_private;
create trigger tourist_private_touch before update on public.tourist_private
for each row execute function public.touch_updated_at();
drop trigger if exists boat_assignments_touch on public.boat_assignments;
create trigger boat_assignments_touch before update on public.boat_assignments
for each row execute function public.touch_updated_at();
drop trigger if exists trip_passengers_touch on public.trip_passengers;
create trigger trip_passengers_touch before update on public.trip_passengers
for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Visibility helpers. Every cross-table check is security definer so RLS
-- policies never recurse into each other.
-- ---------------------------------------------------------------------
create or replace function public.crew_on_assignment(p_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.boat_assignments ba
    join public.employees e on e.profile_id = auth.uid() and e.active
    where ba.id = p_assignment_id
      and e.id in (ba.captain_employee_id, ba.guide_employee_id)
  )
$$;

create or replace function public.can_see_assignment(p_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_permission('fleet.view')
      or public.has_permission('boarding.view_all')
      or (
        (public.has_permission('boarding.view') or public.has_permission('activities.view'))
        and public.crew_on_assignment(p_assignment_id)
      )
$$;

-- The one rule that keeps agencies apart.
create or replace function public.can_view_booking(p_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.bookings b
    where b.id = p_booking_id
      and (
        public.has_permission('guests.booking.view_all')
        or (
          public.has_permission('guests.booking.view_own')
          and (
            b.created_by = auth.uid()
            or (b.agency_id is not null and b.agency_id = public.my_agency_id())
          )
        )
      )
  )
  or exists (
    select 1
    from public.trip_bookings tb
    where tb.booking_id = p_booking_id
      and public.can_see_assignment(tb.assignment_id)
  )
$$;

create or replace function public.can_edit_booking(p_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.bookings b
    where b.id = p_booking_id
      and (
        public.has_permission('guests.booking.edit_all')
        or (
          public.has_permission('guests.booking.edit_own')
          and b.status in ('draft', 'confirmed')
          and (
            b.created_by = auth.uid()
            or (b.agency_id is not null and b.agency_id = public.my_agency_id())
          )
        )
      )
  )
$$;

-- ---------------------------------------------------------------------
-- Keep the pax counts on a booking equal to the people actually listed,
-- so boat capacity maths can never drift from the name list.
-- ---------------------------------------------------------------------
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
      pax_total = counts.total
  from (
    select
      count(*) filter (where age_band = 'adult')::int as adults,
      count(*) filter (where age_band in ('child', 'infant'))::int as children,
      count(*)::int as total
    from public.tourists
    where booking_id = p_booking_id
  ) as counts
  where b.id = p_booking_id;
end;
$$;

create or replace function public.tourists_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.booking_id, old.booking_id);
begin
  perform public.recount_booking_pax(target);

  -- A person added after the boat was chosen joins the same boat.
  if tg_op = 'INSERT' then
    insert into public.trip_passengers (assignment_id, booking_id, tourist_id)
    select tb.assignment_id, tb.booking_id, new.id
    from public.trip_bookings tb
    where tb.booking_id = new.booking_id
    on conflict (assignment_id, tourist_id) do nothing;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists tourists_after_write on public.tourists;
create trigger tourists_after_write after insert or update or delete on public.tourists
for each row execute function public.tourists_after_write();

-- ---------------------------------------------------------------------
-- Assigning a booking to a boat fans the whole group out into passengers.
-- ---------------------------------------------------------------------
create or replace function public.trip_bookings_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.trip_passengers (assignment_id, booking_id, tourist_id)
  select new.assignment_id, new.booking_id, t.id
  from public.tourists t
  where t.booking_id = new.booking_id
  on conflict (assignment_id, tourist_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trip_bookings_after_insert on public.trip_bookings;
create trigger trip_bookings_after_insert after insert on public.trip_bookings
for each row execute function public.trip_bookings_after_insert();

create or replace function public.trip_bookings_after_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.trip_passengers
  where assignment_id = old.assignment_id and booking_id = old.booking_id;
  return old;
end;
$$;

drop trigger if exists trip_bookings_after_delete on public.trip_bookings;
create trigger trip_bookings_after_delete after delete on public.trip_bookings
for each row execute function public.trip_bookings_after_delete();

-- ---------------------------------------------------------------------
-- Booking reference
-- ---------------------------------------------------------------------
create or replace function public.next_booking_ref(p_service_date date)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  seq int;
begin
  select count(*) + 1 into seq from public.bookings where service_date = p_service_date;
  return 'LP-' || to_char(p_service_date, 'YYMMDD') || '-' || lpad(seq::text, 3, '0');
end;
$$;

create or replace function public.distance_km(
  lat1 numeric, lon1 numeric, lat2 numeric, lon2 numeric
)
returns numeric
language sql
immutable
as $$
  select case
    when lat1 is null or lon1 is null or lat2 is null or lon2 is null then null
    else round((
      6371 * 2 * asin(least(1, sqrt(
        power(sin(radians(lat2 - lat1) / 2), 2) +
        cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)
      )))
    )::numeric, 3)
  end
$$;

-- ---------------------------------------------------------------------
-- save_booking: one call saves the booking header and every person on it.
-- The whole grid row set is sent at once, the way the team works in Excel.
-- ---------------------------------------------------------------------
create or replace function public.save_booking(
  p_booking jsonb,
  p_tourists jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_booking_id uuid := nullif(p_booking->>'id', '')::uuid;
  v_date date := (p_booking->>'service_date')::date;
  v_lead text := nullif(trim(p_booking->>'lead_name'), '');
  v_agency uuid;
  v_source text;
  v_edit_all boolean := public.has_permission('guests.booking.edit_all');
  v_see_private boolean := public.has_permission('guests.contact.view');
  v_keep uuid[] := array[]::uuid[];
  rec record;
  v_person_id uuid;
  v_is_new boolean := v_booking_id is null;
begin
  if v_is_new then
    perform public.require_permission('guests.booking.create');
  elsif not public.can_edit_booking(v_booking_id) then
    raise exception 'You cannot edit this booking.' using errcode = '42501';
  end if;

  if v_date is null then raise exception 'An arrival date is required.'; end if;
  if v_lead is null then raise exception 'A lead guest name is required.'; end if;

  -- An agent can never file a booking under a different source or agency.
  if v_edit_all then
    v_agency := nullif(p_booking->>'agency_id', '')::uuid;
    v_source := coalesce(nullif(p_booking->>'source_type', ''), 'in_house');
  else
    v_agency := public.my_agency_id();
    select coalesce(a.source_type, 'in_house') into v_source
    from public.agencies a where a.id = v_agency;
    v_source := coalesce(v_source, 'in_house');
  end if;

  if v_is_new then
    insert into public.bookings (
      booking_ref, service_date, source_type, agency_id, external_ref,
      lead_name, lead_phone, lead_email, nationality,
      pickup_location_id, pickup_hotel_name, pickup_area,
      pickup_latitude, pickup_longitude, pickup_time,
      status, special_requests, notes, created_by
    )
    values (
      public.next_booking_ref(v_date), v_date, v_source, v_agency,
      nullif(p_booking->>'external_ref', ''),
      v_lead,
      nullif(p_booking->>'lead_phone', ''),
      nullif(p_booking->>'lead_email', ''),
      nullif(p_booking->>'nationality', ''),
      nullif(p_booking->>'pickup_location_id', '')::uuid,
      nullif(p_booking->>'pickup_hotel_name', ''),
      nullif(p_booking->>'pickup_area', ''),
      nullif(p_booking->>'pickup_latitude', '')::numeric,
      nullif(p_booking->>'pickup_longitude', '')::numeric,
      nullif(p_booking->>'pickup_time', '')::time,
      coalesce(nullif(p_booking->>'status', ''), 'confirmed'),
      nullif(p_booking->>'special_requests', ''),
      nullif(p_booking->>'notes', ''),
      auth.uid()
    )
    returning id into v_booking_id;
  else
    update public.bookings b set
      service_date = v_date,
      source_type = case when v_edit_all then v_source else b.source_type end,
      agency_id = case when v_edit_all then v_agency else b.agency_id end,
      external_ref = nullif(p_booking->>'external_ref', ''),
      lead_name = v_lead,
      lead_phone = nullif(p_booking->>'lead_phone', ''),
      lead_email = nullif(p_booking->>'lead_email', ''),
      nationality = nullif(p_booking->>'nationality', ''),
      pickup_location_id = nullif(p_booking->>'pickup_location_id', '')::uuid,
      pickup_hotel_name = nullif(p_booking->>'pickup_hotel_name', ''),
      pickup_area = nullif(p_booking->>'pickup_area', ''),
      pickup_latitude = nullif(p_booking->>'pickup_latitude', '')::numeric,
      pickup_longitude = nullif(p_booking->>'pickup_longitude', '')::numeric,
      pickup_time = nullif(p_booking->>'pickup_time', '')::time,
      status = coalesce(nullif(p_booking->>'status', ''), b.status),
      special_requests = nullif(p_booking->>'special_requests', ''),
      notes = nullif(p_booking->>'notes', '')
    where b.id = v_booking_id;
  end if;

  -- Replace the people on the booking with the incoming list.
  for rec in
    select value as person, ordinality as ord
    from jsonb_array_elements(coalesce(p_tourists, '[]'::jsonb)) with ordinality
  loop
    if coalesce(nullif(trim(rec.person->>'full_name'), ''), '') = '' then
      continue;
    end if;

    v_person_id := nullif(rec.person->>'id', '')::uuid;

    if v_person_id is null then
      insert into public.tourists (
        booking_id, full_name, phone, nationality, age_band, gender, is_lead, seat_note, sort_order
      )
      values (
        v_booking_id,
        trim(rec.person->>'full_name'),
        nullif(rec.person->>'phone', ''),
        nullif(rec.person->>'nationality', ''),
        coalesce(nullif(rec.person->>'age_band', ''), 'adult'),
        nullif(rec.person->>'gender', ''),
        coalesce((rec.person->>'is_lead')::boolean, rec.ord = 1),
        nullif(rec.person->>'seat_note', ''),
        rec.ord::int
      )
      returning id into v_person_id;
    else
      update public.tourists t set
        full_name = trim(rec.person->>'full_name'),
        phone = nullif(rec.person->>'phone', ''),
        nationality = nullif(rec.person->>'nationality', ''),
        age_band = coalesce(nullif(rec.person->>'age_band', ''), 'adult'),
        gender = nullif(rec.person->>'gender', ''),
        is_lead = coalesce((rec.person->>'is_lead')::boolean, t.is_lead),
        seat_note = nullif(rec.person->>'seat_note', ''),
        sort_order = rec.ord::int
      where t.id = v_person_id and t.booking_id = v_booking_id;
    end if;

    v_keep := v_keep || v_person_id;

    if v_see_private and rec.person ? 'private' then
      insert into public.tourist_private (
        tourist_id, passport_no, date_of_birth, email, medical_notes, dietary_notes
      )
      values (
        v_person_id,
        nullif(rec.person->'private'->>'passport_no', ''),
        nullif(rec.person->'private'->>'date_of_birth', '')::date,
        nullif(rec.person->'private'->>'email', ''),
        nullif(rec.person->'private'->>'medical_notes', ''),
        nullif(rec.person->'private'->>'dietary_notes', '')
      )
      on conflict (tourist_id) do update set
        passport_no = excluded.passport_no,
        date_of_birth = excluded.date_of_birth,
        email = excluded.email,
        medical_notes = excluded.medical_notes,
        dietary_notes = excluded.dietary_notes,
        updated_at = now();
    end if;
  end loop;

  -- A booking with nobody on it is always a mistake, never an instruction
  -- to wipe the guest list.
  if array_length(v_keep, 1) is null then
    raise exception 'A booking needs at least one guest name.';
  end if;

  delete from public.tourists t
  where t.booking_id = v_booking_id
    and not (t.id = any(v_keep));

  perform public.recount_booking_pax(v_booking_id);
  return v_booking_id;
end;
$$;

create or replace function public.delete_booking(p_booking_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  perform public.require_permission('guests.booking.delete');
  if not public.can_view_booking(p_booking_id) then
    raise exception 'Booking not found.';
  end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, before_json)
  select auth.uid(), 'delete_booking', 'booking', p_booking_id, to_jsonb(b)
  from public.bookings b where b.id = p_booking_id;
  delete from public.bookings where id = p_booking_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Daily boat board
-- ---------------------------------------------------------------------
create or replace function public.ensure_boat_assignments(p_service_date date)
returns setof public.boat_assignments
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  perform public.require_permission('fleet.view');

  insert into public.boat_assignments (service_date, boat_id, trip_no, departure_time, created_by)
  select p_service_date, b.id, 1,
         nullif(public.setting_text('default_departure_time', '09:00'), '')::time,
         auth.uid()
  from public.boats b
  where b.status = 'active'
    and not exists (
      select 1 from public.boat_assignments a
      where a.service_date = p_service_date and a.boat_id = b.id and a.trip_no = 1
    );

  return query
    select a.* from public.boat_assignments a
    where a.service_date = p_service_date
    order by a.trip_no;
end;
$$;

create or replace function public.assign_booking_to_boat(
  p_booking_id uuid,
  p_assignment_id uuid,
  p_allow_overbook boolean default false
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_assignment public.boat_assignments%rowtype;
  v_capacity int;
  v_seated int;
  v_incoming int;
  v_boat_code text;
begin
  perform public.require_permission('fleet.assign');

  select * into v_assignment from public.boat_assignments where id = p_assignment_id;
  if not found then raise exception 'That boat trip does not exist.'; end if;
  if v_assignment.locked then raise exception 'This day is locked. Unlock it before changing boats.'; end if;

  select b.capacity_pax, b.code into v_capacity, v_boat_code from public.boats b where b.id = v_assignment.boat_id;

  select coalesce(pax_total, 0) into v_incoming from public.bookings where id = p_booking_id;
  if not found then raise exception 'Booking not found.'; end if;

  select coalesce(sum(bk.pax_total), 0) into v_seated
  from public.trip_bookings tb
  join public.bookings bk on bk.id = tb.booking_id
  where tb.assignment_id = p_assignment_id and tb.booking_id <> p_booking_id;

  if not p_allow_overbook and v_capacity > 0 and v_seated + v_incoming > v_capacity then
    raise exception '% only has % seat(s) left and this group is % pax.',
      v_boat_code, greatest(v_capacity - v_seated, 0), v_incoming;
  end if;

  -- Moving a group always moves all of it: drop the old seat first.
  delete from public.trip_bookings where booking_id = p_booking_id;

  insert into public.trip_bookings (assignment_id, booking_id, assigned_by)
  values (p_assignment_id, p_booking_id, auth.uid());
end;
$$;

create or replace function public.unassign_booking(p_booking_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_locked boolean;
begin
  perform public.require_permission('fleet.assign');
  select ba.locked into v_locked
  from public.trip_bookings tb
  join public.boat_assignments ba on ba.id = tb.assignment_id
  where tb.booking_id = p_booking_id;

  if coalesce(v_locked, false) then
    raise exception 'This day is locked. Unlock it before changing boats.';
  end if;

  delete from public.trip_bookings where booking_id = p_booking_id;
end;
$$;

create or replace function public.set_trip_crew(
  p_assignment_id uuid,
  p_captain_employee_id uuid default null,
  p_guide_employee_id uuid default null,
  p_departure_time text default null,
  p_status text default null,
  p_clear_captain boolean default false,
  p_clear_guide boolean default false
)
returns public.boat_assignments
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row public.boat_assignments%rowtype;
begin
  perform public.require_permission('fleet.crew.assign');

  update public.boat_assignments a set
    captain_employee_id = case when p_clear_captain then null else coalesce(p_captain_employee_id, a.captain_employee_id) end,
    guide_employee_id = case when p_clear_guide then null else coalesce(p_guide_employee_id, a.guide_employee_id) end,
    departure_time = coalesce(nullif(p_departure_time, '')::time, a.departure_time),
    status = coalesce(nullif(p_status, ''), a.status)
  where a.id = p_assignment_id
  returning * into v_row;

  if not found then raise exception 'That boat trip does not exist.'; end if;
  return v_row;
end;
$$;

create or replace function public.set_day_locked(p_service_date date, p_locked boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  perform public.require_permission('fleet.finalize');
  update public.boat_assignments set locked = p_locked where service_date = p_service_date;
end;
$$;

-- ---------------------------------------------------------------------
-- Pickup coordination. Bookings staying at the same hotel, or at hotels
-- within the configured radius of each other, land in one pickup run.
-- ---------------------------------------------------------------------
create or replace function public.save_pickup_group(
  p_id uuid,
  p_service_date date,
  p_name text,
  p_area_label text default null,
  p_pickup_time text default null,
  p_vehicle text default null,
  p_driver_employee_id uuid default null,
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
  if coalesce(trim(p_name), '') = '' then raise exception 'A pickup group name is required.'; end if;

  if p_id is null then
    insert into public.pickup_groups (service_date, name, area_label, pickup_time, vehicle, driver_employee_id, notes, created_by)
    values (p_service_date, trim(p_name), p_area_label, nullif(p_pickup_time, '')::time, p_vehicle, p_driver_employee_id, p_notes, auth.uid())
    returning * into v_row;
  else
    update public.pickup_groups g set
      name = trim(p_name),
      area_label = p_area_label,
      pickup_time = nullif(p_pickup_time, '')::time,
      vehicle = p_vehicle,
      driver_employee_id = p_driver_employee_id,
      notes = p_notes
    where g.id = p_id
    returning * into v_row;
    if not found then raise exception 'Pickup group not found.'; end if;
  end if;

  return v_row;
end;
$$;

create or replace function public.set_pickup_group(p_booking_id uuid, p_group_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  perform public.require_permission('guests.pickup.manage');
  update public.bookings set pickup_group_id = p_group_id where id = p_booking_id;
  if not found then raise exception 'Booking not found.'; end if;
end;
$$;

create or replace function public.delete_pickup_group(p_group_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  perform public.require_permission('guests.pickup.manage');
  update public.bookings set pickup_group_id = null where pickup_group_id = p_group_id;
  delete from public.pickup_groups where id = p_group_id;
end;
$$;

create or replace function public.auto_group_pickups(
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
  v_radius numeric := coalesce(
    p_radius_km,
    nullif(public.setting_text('pickup_group_radius_km', '1.5'), '')::numeric,
    1.5
  );
  rec record;
  v_group_id uuid;
  v_grouped int := 0;
begin
  perform public.require_permission('guests.pickup.manage');

  for rec in
    select
      b.id,
      coalesce(nullif(trim(b.pickup_hotel_name), ''), l.name, nullif(trim(b.pickup_area), ''), 'Unassigned pickup') as spot,
      coalesce(nullif(trim(b.pickup_area), ''), l.area) as area,
      coalesce(b.pickup_latitude, l.latitude) as lat,
      coalesce(b.pickup_longitude, l.longitude) as lng
    from public.bookings b
    left join public.pickup_locations l on l.id = b.pickup_location_id
    where b.service_date = p_service_date
      and b.pickup_group_id is null
      and b.status in ('draft', 'confirmed', 'arrived')
    order by lower(coalesce(nullif(trim(b.pickup_hotel_name), ''), l.name, '')), b.created_at
  loop
    v_group_id := null;

    -- Same building first, then anything inside the radius.
    select g.id into v_group_id
    from public.pickup_groups g
    where g.service_date = p_service_date
      and (
        lower(g.name) = lower(rec.spot)
        or (
          rec.lat is not null and g.latitude is not null
          and public.distance_km(rec.lat, rec.lng, g.latitude, g.longitude) <= v_radius
        )
      )
    order by
      case when lower(g.name) = lower(rec.spot) then 0 else 1 end,
      coalesce(public.distance_km(rec.lat, rec.lng, g.latitude, g.longitude), 999)
    limit 1;

    if v_group_id is null then
      insert into public.pickup_groups (service_date, name, area_label, latitude, longitude, auto_created, created_by)
      values (p_service_date, rec.spot, rec.area, rec.lat, rec.lng, true, auth.uid())
      returning id into v_group_id;
    end if;

    update public.bookings set pickup_group_id = v_group_id where id = rec.id;
    v_grouped := v_grouped + 1;
  end loop;

  -- Tidy up runs that ended up empty.
  delete from public.pickup_groups g
  where g.service_date = p_service_date
    and g.auto_created
    and not exists (select 1 from public.bookings b where b.pickup_group_id = g.id);

  return v_grouped;
end;
$$;

-- ---------------------------------------------------------------------
-- Boarding and island activities
-- ---------------------------------------------------------------------
create or replace function public.mark_boarding(p_passenger_ids uuid[], p_status text)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  perform public.require_permission('boarding.mark');
  if p_status not in ('pending', 'arrived', 'no_show') then
    raise exception 'Boarding status must be pending, arrived or no_show.';
  end if;

  update public.trip_passengers tp set
    boarding_status = p_status,
    boarded_at = case when p_status = 'pending' then null else now() end,
    boarded_by = case when p_status = 'pending' then null else auth.uid() end
  where tp.id = any(p_passenger_ids)
    and public.can_see_assignment(tp.assignment_id);

  get diagnostics v_count = row_count;
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
begin
  perform public.require_permission('activities.select');
  if p_activity_code is not null
     and not exists (select 1 from public.activity_types where code = p_activity_code and active) then
    raise exception 'Unknown activity "%".', p_activity_code;
  end if;

  update public.trip_passengers tp set
    activity_code = p_activity_code,
    activity_status = 'pending',
    activity_marked_at = null,
    activity_marked_by = null,
    returned = false,
    returned_at = null
  where tp.id = any(p_passenger_ids)
    and public.can_see_assignment(tp.assignment_id);

  get diagnostics v_count = row_count;
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
begin
  perform public.require_permission('activities.mark');
  if p_status is not null and p_status not in ('pending', 'joined', 'absent') then
    raise exception 'Activity status must be pending, joined or absent.';
  end if;

  update public.trip_passengers tp set
    activity_status = coalesce(p_status, tp.activity_status),
    activity_marked_at = case when p_status is null then tp.activity_marked_at else now() end,
    activity_marked_by = case when p_status is null then tp.activity_marked_by else auth.uid() end,
    returned = coalesce(p_returned, tp.returned),
    returned_at = case
      when p_returned is null then tp.returned_at
      when p_returned then now()
      else null
    end
  where tp.id = any(p_passenger_ids)
    and public.can_see_assignment(tp.assignment_id);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- Boarding list view. Name, phone and the group they booked with - the
-- only guest columns a captain or guide ever needs.
-- ---------------------------------------------------------------------
create or replace view public.trip_manifest with (security_invoker = true) as
select
  tp.id as passenger_id,
  tp.assignment_id,
  tp.booking_id,
  tp.tourist_id,
  tp.boarding_status,
  tp.boarded_at,
  tp.activity_code,
  tp.activity_status,
  tp.returned,
  tp.note,
  t.full_name,
  coalesce(t.phone, b.lead_phone) as phone,
  t.age_band,
  t.is_lead,
  t.nationality,
  b.booking_ref,
  b.lead_name,
  b.pax_total as group_size,
  b.service_date,
  a.boat_id,
  bo.code as boat_code,
  bo.name as boat_name
from public.trip_passengers tp
join public.tourists t on t.id = tp.tourist_id
join public.bookings b on b.id = tp.booking_id
join public.boat_assignments a on a.id = tp.assignment_id
join public.boats bo on bo.id = a.boat_id;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.pickup_locations enable row level security;
alter table public.pickup_groups enable row level security;
alter table public.bookings enable row level security;
alter table public.tourists enable row level security;
alter table public.tourist_private enable row level security;
alter table public.activity_types enable row level security;
alter table public.boat_assignments enable row level security;
alter table public.trip_bookings enable row level security;
alter table public.trip_passengers enable row level security;

drop policy if exists "pickup locations read" on public.pickup_locations;
create policy "pickup locations read" on public.pickup_locations
  for select to authenticated
  using (
    public.has_permission('guests.booking.create')
    or public.has_permission('guests.booking.view_own')
    or public.has_permission('guests.booking.view_all')
    or public.has_permission('guests.pickup.manage')
    or public.has_permission('platform.directory.manage')
  );

drop policy if exists "pickup locations write" on public.pickup_locations;
create policy "pickup locations write" on public.pickup_locations
  for all to authenticated
  using (public.has_permission('platform.directory.manage') or public.has_permission('guests.pickup.manage'))
  with check (public.has_permission('platform.directory.manage') or public.has_permission('guests.pickup.manage'));

drop policy if exists "pickup groups read" on public.pickup_groups;
create policy "pickup groups read" on public.pickup_groups
  for select to authenticated
  using (
    public.has_permission('guests.pickup.manage')
    or public.has_permission('guests.booking.view_all')
    or public.has_permission('fleet.view')
  );

-- Bookings. This policy is the fence between agencies; everything else in
-- the guest department hangs off it.
drop policy if exists "bookings read" on public.bookings;
create policy "bookings read" on public.bookings
  for select to authenticated
  using (
    public.has_permission('guests.booking.view_all')
    or (
      public.has_permission('guests.booking.view_own')
      and (
        created_by = auth.uid()
        or (agency_id is not null and agency_id = public.my_agency_id())
      )
    )
    or exists (
      select 1 from public.trip_bookings tb
      where tb.booking_id = bookings.id and public.can_see_assignment(tb.assignment_id)
    )
  );

drop policy if exists "tourists read" on public.tourists;
create policy "tourists read" on public.tourists
  for select to authenticated
  using (public.can_view_booking(booking_id));

drop policy if exists "tourist private read" on public.tourist_private;
create policy "tourist private read" on public.tourist_private
  for select to authenticated
  using (
    public.has_permission('guests.contact.view')
    and exists (
      select 1 from public.tourists t
      where t.id = tourist_private.tourist_id and public.can_view_booking(t.booking_id)
    )
  );

drop policy if exists "activity types read" on public.activity_types;
create policy "activity types read" on public.activity_types
  for select to authenticated using (true);

drop policy if exists "activity types write" on public.activity_types;
create policy "activity types write" on public.activity_types
  for all to authenticated
  using (public.has_permission('activities.manage'))
  with check (public.has_permission('activities.manage'));

drop policy if exists "assignments read" on public.boat_assignments;
create policy "assignments read" on public.boat_assignments
  for select to authenticated using (public.can_see_assignment(id));

drop policy if exists "trip bookings read" on public.trip_bookings;
create policy "trip bookings read" on public.trip_bookings
  for select to authenticated using (public.can_see_assignment(assignment_id));

drop policy if exists "trip passengers read" on public.trip_passengers;
create policy "trip passengers read" on public.trip_passengers
  for select to authenticated using (public.can_see_assignment(assignment_id));

-- Every write in this department goes through the security definer RPCs
-- above, which check the permission and the ownership rule first. There is
-- deliberately no direct insert/update/delete policy on bookings, tourists,
-- trip_bookings or trip_passengers.

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'save_booking(jsonb, jsonb)',
    'delete_booking(uuid)',
    'ensure_boat_assignments(date)',
    'assign_booking_to_boat(uuid, uuid, boolean)',
    'unassign_booking(uuid)',
    'set_trip_crew(uuid, uuid, uuid, text, text, boolean, boolean)',
    'set_day_locked(date, boolean)',
    'save_pickup_group(uuid, date, text, text, text, text, uuid, text)',
    'set_pickup_group(uuid, uuid)',
    'delete_pickup_group(uuid)',
    'auto_group_pickups(date, numeric)',
    'mark_boarding(uuid[], text)',
    'set_passenger_activity(uuid[], text)',
    'mark_activity_attendance(uuid[], text, boolean)'
  ]
  loop
    execute format('revoke all on function public.%s from anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

revoke all on function public.can_view_booking(uuid) from anon;
revoke all on function public.can_edit_booking(uuid) from anon;
revoke all on function public.crew_on_assignment(uuid) from anon;
revoke all on function public.can_see_assignment(uuid) from anon;
revoke all on function public.recount_booking_pax(uuid) from public, anon, authenticated;
grant select on public.trip_manifest to authenticated;
