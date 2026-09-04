-- =====================================================================
-- Boats, crew directory, fuel logs and repair history
-- =====================================================================

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  employee_code text,
  full_name text not null,
  job_type text not null default 'crew'
    check (job_type in ('captain', 'guide', 'driver', 'crew', 'bar', 'office', 'other')),
  phone text,
  profile_id uuid references public.profiles(id) on delete set null,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists employees_code_key on public.employees (lower(employee_code)) where employee_code is not null;
create index if not exists employees_job_type_idx on public.employees (job_type, active);
create index if not exists employees_profile_idx on public.employees (profile_id);

create table if not exists public.boats (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text,
  boat_type text not null default 'speedboat',
  capacity_pax int not null default 0 check (capacity_pax >= 0),
  ownership text not null default 'owned' check (ownership in ('owned', 'partner', 'charter')),
  owner_name text,
  registration_no text,
  engine_info text,
  expected_litres_per_trip numeric(10,2),
  status text not null default 'active' check (status in ('active', 'maintenance', 'inactive')),
  status_note text,
  sort_order int not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists boats_code_key on public.boats (lower(code));

create table if not exists public.boat_fuel_logs (
  id uuid primary key default gen_random_uuid(),
  boat_id uuid not null references public.boats(id) on delete cascade,
  log_date date not null,
  entry_type text not null default 'trip_usage' check (entry_type in ('trip_usage', 'refuel')),
  trip_label text,
  entered_island boolean not null default true,
  litres numeric(10,2) not null check (litres >= 0),
  price_per_litre numeric(10,2) not null default 0 check (price_per_litre >= 0),
  total_cost numeric(12,2) not null default 0 check (total_cost >= 0),
  tank_level_after_pct int check (tank_level_after_pct between 0 and 100),
  engine_hours numeric(10,2),
  handled_by_employee_id uuid references public.employees(id) on delete set null,
  receipt_image_path text,
  notes text,
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists boat_fuel_logs_boat_date_idx on public.boat_fuel_logs (boat_id, log_date desc);
create index if not exists boat_fuel_logs_date_idx on public.boat_fuel_logs (log_date desc);

create table if not exists public.boat_repairs (
  id uuid primary key default gen_random_uuid(),
  boat_id uuid not null references public.boats(id) on delete cascade,
  reported_date date not null default current_date,
  damaged_on date,
  issue_title text not null,
  issue_category text not null default 'other'
    check (issue_category in ('engine', 'propeller', 'hull', 'electrical', 'fuel_system', 'steering', 'safety_gear', 'interior', 'other')),
  issue_details text,
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  status text not null default 'reported' check (status in ('reported', 'in_progress', 'fixed', 'cancelled')),
  cost numeric(12,2) not null default 0 check (cost >= 0),
  vendor text,
  fixed_date date,
  out_of_service boolean not null default false,
  is_recurring boolean not null default false,
  previous_repair_id uuid references public.boat_repairs(id) on delete set null,
  reported_by_employee_id uuid references public.employees(id) on delete set null,
  recorded_by uuid references public.profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists boat_repairs_boat_idx on public.boat_repairs (boat_id, reported_date desc);
create index if not exists boat_repairs_status_idx on public.boat_repairs (status);
create index if not exists boat_repairs_category_idx on public.boat_repairs (boat_id, issue_category);

drop trigger if exists employees_touch_updated_at on public.employees;
create trigger employees_touch_updated_at before update on public.employees
for each row execute function public.touch_updated_at();
drop trigger if exists boats_touch_updated_at on public.boats;
create trigger boats_touch_updated_at before update on public.boats
for each row execute function public.touch_updated_at();
drop trigger if exists boat_fuel_logs_touch_updated_at on public.boat_fuel_logs;
create trigger boat_fuel_logs_touch_updated_at before update on public.boat_fuel_logs
for each row execute function public.touch_updated_at();
drop trigger if exists boat_repairs_touch_updated_at on public.boat_repairs;
create trigger boat_repairs_touch_updated_at before update on public.boat_repairs
for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Fuel: fill in the money column and stamp the recorder
-- ---------------------------------------------------------------------
create or replace function public.boat_fuel_before_write()
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

drop trigger if exists boat_fuel_before_write on public.boat_fuel_logs;
create trigger boat_fuel_before_write before insert or update on public.boat_fuel_logs
for each row execute function public.boat_fuel_before_write();

-- ---------------------------------------------------------------------
-- Repairs: flag "same problem as last time" and park the boat when a job
-- takes it out of service.
-- ---------------------------------------------------------------------
create or replace function public.boat_repair_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  prior public.boat_repairs%rowtype;
begin
  if tg_op = 'INSERT' then
    new.recorded_by := coalesce(new.recorded_by, auth.uid());
  end if;

  -- Only look for a previous occurrence when the reporter has not already
  -- linked one by hand.
  if new.previous_repair_id is null then
    select * into prior
    from public.boat_repairs r
    where r.boat_id = new.boat_id
      and r.id is distinct from new.id
      and r.status <> 'cancelled'
      and r.issue_category = new.issue_category
      and r.reported_date >= new.reported_date - interval '365 days'
    order by r.reported_date desc
    limit 1;

    if found then
      new.previous_repair_id := prior.id;
      new.is_recurring := true;
    end if;
  else
    new.is_recurring := true;
  end if;

  if new.status = 'fixed' and new.fixed_date is null then
    new.fixed_date := current_date;
  end if;
  if new.status <> 'fixed' then
    new.fixed_date := null;
  end if;

  return new;
end;
$$;

drop trigger if exists boat_repair_before_write on public.boat_repairs;
create trigger boat_repair_before_write before insert or update on public.boat_repairs
for each row execute function public.boat_repair_before_write();

create or replace function public.boat_repair_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.boat_id, old.boat_id);
  blocked boolean;
begin
  select exists (
    select 1 from public.boat_repairs r
    where r.boat_id = target and r.out_of_service and r.status in ('reported', 'in_progress')
  ) into blocked;

  update public.boats b
  set status = case
        when blocked then 'maintenance'
        when b.status = 'maintenance' then 'active'
        else b.status
      end,
      status_note = case when blocked then 'Under repair' else null end
  where b.id = target
    and (blocked or b.status = 'maintenance');

  return coalesce(new, old);
end;
$$;

drop trigger if exists boat_repair_after_write on public.boat_repairs;
create trigger boat_repair_after_write after insert or update or delete on public.boat_repairs
for each row execute function public.boat_repair_after_write();

-- ---------------------------------------------------------------------
-- Fuel spend summary. Used by the maintenance page to show whether a boat
-- is burning more than its normal litres per trip.
-- ---------------------------------------------------------------------
create or replace function public.boat_fuel_summary(p_from date, p_to date)
returns table (
  boat_id uuid,
  boat_code text,
  trips int,
  litres_used numeric,
  litres_loaded numeric,
  cost_used numeric,
  cost_loaded numeric,
  avg_litres_per_trip numeric,
  expected_litres_per_trip numeric,
  variance_pct numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with logs as (
    select
      b.id,
      b.code,
      b.expected_litres_per_trip,
      count(*) filter (where f.entry_type = 'trip_usage') as trips,
      coalesce(sum(f.litres) filter (where f.entry_type = 'trip_usage'), 0) as litres_used,
      coalesce(sum(f.litres) filter (where f.entry_type = 'refuel'), 0) as litres_loaded,
      coalesce(sum(f.total_cost) filter (where f.entry_type = 'trip_usage'), 0) as cost_used,
      coalesce(sum(f.total_cost) filter (where f.entry_type = 'refuel'), 0) as cost_loaded
    from public.boats b
    left join public.boat_fuel_logs f
      on f.boat_id = b.id and f.log_date between p_from and p_to
    group by b.id, b.code, b.expected_litres_per_trip
  )
  select
    id,
    code,
    trips::int,
    litres_used,
    litres_loaded,
    cost_used,
    cost_loaded,
    case when trips > 0 then round(litres_used / trips, 2) else 0 end as avg_litres_per_trip,
    expected_litres_per_trip,
    case
      when trips > 0 and coalesce(expected_litres_per_trip, 0) > 0
      then round(((litres_used / trips) - expected_litres_per_trip) / expected_litres_per_trip * 100, 1)
      else null
    end as variance_pct
  from logs
  where public.has_permission('maintenance.view')
  order by code
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.employees enable row level security;
alter table public.boats enable row level security;
alter table public.boat_fuel_logs enable row level security;
alter table public.boat_repairs enable row level security;

-- Crew directory. Travel agents hold none of these permissions, so they
-- cannot enumerate staff.
drop policy if exists "employees read" on public.employees;
create policy "employees read" on public.employees
  for select to authenticated
  using (
    public.has_permission('platform.directory.manage')
    or public.has_permission('fleet.view')
    or public.has_permission('maintenance.view')
    or public.has_permission('boarding.view')
    or profile_id = auth.uid()
  );

drop policy if exists "employees write" on public.employees;
create policy "employees write" on public.employees
  for all to authenticated
  using (public.has_permission('platform.directory.manage'))
  with check (public.has_permission('platform.directory.manage'));

drop policy if exists "boats read" on public.boats;
create policy "boats read" on public.boats
  for select to authenticated
  using (
    public.has_permission('fleet.view')
    or public.has_permission('maintenance.view')
    or public.has_permission('boarding.view')
    or public.has_permission('activities.view')
  );

drop policy if exists "boats write" on public.boats;
create policy "boats write" on public.boats
  for all to authenticated
  using (public.has_permission('fleet.boats.manage'))
  with check (public.has_permission('fleet.boats.manage'));

drop policy if exists "fuel read" on public.boat_fuel_logs;
create policy "fuel read" on public.boat_fuel_logs
  for select to authenticated using (public.has_permission('maintenance.view'));

drop policy if exists "fuel insert" on public.boat_fuel_logs;
create policy "fuel insert" on public.boat_fuel_logs
  for insert to authenticated with check (public.has_permission('maintenance.fuel.record'));

drop policy if exists "fuel update" on public.boat_fuel_logs;
create policy "fuel update" on public.boat_fuel_logs
  for update to authenticated
  using (public.has_permission('maintenance.manage') or (recorded_by = auth.uid() and created_at > now() - interval '24 hours'))
  with check (public.has_permission('maintenance.manage') or recorded_by = auth.uid());

drop policy if exists "fuel delete" on public.boat_fuel_logs;
create policy "fuel delete" on public.boat_fuel_logs
  for delete to authenticated using (public.has_permission('maintenance.manage'));

drop policy if exists "repairs read" on public.boat_repairs;
create policy "repairs read" on public.boat_repairs
  for select to authenticated
  using (public.has_permission('maintenance.view') or public.has_permission('fleet.view'));

drop policy if exists "repairs insert" on public.boat_repairs;
create policy "repairs insert" on public.boat_repairs
  for insert to authenticated with check (public.has_permission('maintenance.repair.record'));

drop policy if exists "repairs update" on public.boat_repairs;
create policy "repairs update" on public.boat_repairs
  for update to authenticated
  using (public.has_permission('maintenance.manage') or public.has_permission('maintenance.repair.close'))
  with check (public.has_permission('maintenance.manage') or public.has_permission('maintenance.repair.close'));

drop policy if exists "repairs delete" on public.boat_repairs;
create policy "repairs delete" on public.boat_repairs
  for delete to authenticated using (public.has_permission('maintenance.manage'));

grant execute on function public.boat_fuel_summary(date, date) to authenticated;
