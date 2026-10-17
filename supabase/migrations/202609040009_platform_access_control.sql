-- =====================================================================
-- Lovely Paradise Operations Platform - Department + Permission model
-- ---------------------------------------------------------------------
-- Replaces the "one shared access code makes everyone an admin" model
-- with department-scoped permissions that are enforced by Postgres RLS,
-- so external agents cannot read in-house guest data even if they call
-- the REST API directly with their own token.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Catalogue tables
-- ---------------------------------------------------------------------
create table if not exists public.departments (
  code text primary key,
  name text not null,
  description text,
  icon text,
  sort_order int not null default 0,
  active boolean not null default true
);

create table if not exists public.permissions (
  code text primary key,
  department_code text not null references public.departments(code) on delete cascade,
  name text not null,
  description text,
  sensitive boolean not null default false,
  sort_order int not null default 0
);

create table if not exists public.access_roles (
  code text primary key,
  name text not null,
  description text,
  is_master boolean not null default false,
  is_system boolean not null default false,
  sort_order int not null default 0
);

create table if not exists public.access_role_permissions (
  role_code text not null references public.access_roles(code) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (role_code, permission_code)
);

-- Per-user exceptions layered on top of the role. A revoke always wins.
create table if not exists public.user_permission_overrides (
  user_id uuid not null references public.profiles(id) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  effect text not null check (effect in ('grant', 'revoke')),
  granted_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (user_id, permission_code)
);

-- Agencies / booking sources. An agent user belongs to exactly one.
create table if not exists public.agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source_type text not null default 'agent' check (source_type in ('agent', 'ota', 'in_house', 'walk_in', 'other')),
  contact_person text,
  contact_phone text,
  contact_email text,
  commission_note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists agencies_name_key on public.agencies (lower(name));

-- ---------------------------------------------------------------------
-- Profile changes
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists access_role_code text;
alter table public.profiles add column if not exists status text not null default 'pending';
alter table public.profiles add column if not exists agency_id uuid references public.agencies(id) on delete set null;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists login_email text;
alter table public.profiles add column if not exists is_anonymous boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_status_check') then
    alter table public.profiles add constraint profiles_status_check
      check (status in ('pending', 'active', 'suspended'));
  end if;
end $$;

-- The legacy role column still drives every existing bar/POS policy, so it
-- stays, but it needs a value that means "no access at all".
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('pending', 'cashier', 'manager', 'admin'));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_access_role_fk') then
    alter table public.profiles add constraint profiles_access_role_fk
      foreign key (access_role_code) references public.access_roles(code) on delete set null;
  end if;
end $$;

create index if not exists profiles_agency_idx on public.profiles (agency_id);
create index if not exists profiles_access_role_idx on public.profiles (access_role_code);

-- ---------------------------------------------------------------------
-- Seed departments
-- ---------------------------------------------------------------------
insert into public.departments (code, name, description, icon, sort_order) values
  ('bar',          'Bar POS & Stock',      'Island bar point of sale, stock, closing and sales reports.',       'ShoppingCart', 1),
  ('maintenance',  'Boat Maintenance',     'Daily fuel usage, refuelling and repair records for every boat.',    'Wrench',       2),
  ('guests',       'Tourist Bookings',     'Booking and tourist records from agents, OTAs, in-house and others.','Users',        3),
  ('fleet',        'Boat Assignment',      'Boat register plus the daily drag-and-drop tourist boat manifest.',  'Ship',         4),
  ('boarding',     'Boarding Attendance',  'Captain and guide passenger check-in before departure.',             'ClipboardCheck',5),
  ('activities',   'Island Activities',    'Activity choice and headcount so nobody is left on the island.',     'Waves',        6),
  ('platform',     'Admin & Access',       'Master admin panel: users, roles, permissions and directories.',     'ShieldCheck',  7)
on conflict (code) do update
  set name = excluded.name, description = excluded.description, icon = excluded.icon, sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------
-- Seed permissions
-- ---------------------------------------------------------------------
insert into public.permissions (code, department_code, name, description, sensitive, sort_order) values
  ('bar.pos.use',              'bar', 'Use POS',                 'Take orders and complete sales.', false, 1),
  ('bar.pos.void',             'bar', 'Void sales',              'Cancel a completed sale and return stock.', true, 2),
  ('bar.stock.view',           'bar', 'View stock',              'See inventory balances and stock activity.', false, 3),
  ('bar.stock.manage',         'bar', 'Stock in / adjust',       'Receive stock and make adjustments.', false, 4),
  ('bar.closing.manage',       'bar', 'Daily closing',           'Count cash and close the business day.', true, 5),
  ('bar.reports.view',         'bar', 'Bar reports',             'Open daily sales and accounting reports.', true, 6),
  ('bar.products.manage',      'bar', 'Manage products',         'Add products, prices and bundles.', true, 7),
  ('bar.settings.manage',      'bar', 'Bar settings',            'Change bar settings and staff name list.', true, 8),

  ('maintenance.view',         'maintenance', 'View maintenance',   'Open fuel and repair records.', false, 1),
  ('maintenance.fuel.record',  'maintenance', 'Record fuel',        'Enter daily petrol usage and refuelling.', false, 2),
  ('maintenance.repair.record','maintenance', 'Record repairs',     'Report a boat damage or repair job.', false, 3),
  ('maintenance.repair.close', 'maintenance', 'Close repairs',      'Mark a repair as fixed and set the fixed date.', false, 4),
  ('maintenance.cost.view',    'maintenance', 'View costs',         'See fuel and repair money figures.', true, 5),
  ('maintenance.manage',       'maintenance', 'Correct records',    'Edit or delete fuel and repair records.', true, 6),

  ('guests.booking.create',    'guests', 'Enter bookings',        'Create bookings and tourist rows.', false, 1),
  ('guests.booking.view_own',  'guests', 'View own bookings',     'See only bookings from own agency or own entries.', false, 2),
  ('guests.booking.edit_own',  'guests', 'Edit own bookings',     'Change bookings from own agency before arrival.', false, 3),
  ('guests.booking.view_all',  'guests', 'View ALL bookings',     'See the full guest list from every source.', true, 4),
  ('guests.booking.edit_all',  'guests', 'Edit ALL bookings',     'Change any booking from any source.', true, 5),
  ('guests.booking.delete',    'guests', 'Delete bookings',       'Cancel and remove booking records.', true, 6),
  ('guests.contact.view',      'guests', 'View passport / ID',    'See passport, birth date, email and medical notes.', true, 7),
  ('guests.export',            'guests', 'Export guest list',     'Download guest data as a file.', true, 8),
  ('guests.pickup.manage',     'guests', 'Pickup coordination',   'Group bookings into pickup runs by hotel and area.', false, 9),

  ('fleet.view',               'fleet', 'View fleet',             'See boats, capacity and the daily board.', false, 1),
  ('fleet.boats.manage',       'fleet', 'Manage boats',           'Add boats, capacity, ownership and maintenance status.', true, 2),
  ('fleet.assign',             'fleet', 'Assign tourists',        'Drag bookings onto boats for a service date.', false, 3),
  ('fleet.crew.assign',        'fleet', 'Assign captain / guide', 'Choose the captain and tour guide for each boat.', false, 4),
  ('fleet.finalize',           'fleet', 'Lock the manifest',      'Freeze a day so the boat list cannot change.', true, 5),

  ('boarding.view',            'boarding', 'View own boarding list', 'See the passenger list for boats you crew.', false, 1),
  ('boarding.mark',            'boarding', 'Mark boarding',         'Mark tourists as arrived, waiting or no show.', false, 2),
  ('boarding.view_all',        'boarding', 'View all boats',        'See boarding progress for every boat.', true, 3),

  ('activities.view',          'activities', 'View activities',      'See activity selection and headcount.', false, 1),
  ('activities.select',        'activities', 'Choose activity',      'Set snorkel, volcanic mud or other per tourist.', false, 2),
  ('activities.mark',          'activities', 'Mark activity roll call','Confirm who joined and who returned.', false, 3),
  ('activities.manage',        'activities', 'Manage activity types','Add or retire activity options.', true, 4),

  ('platform.users.manage',    'platform', 'Manage users',          'Approve accounts, set roles and per-user access.', true, 1),
  ('platform.roles.manage',    'platform', 'Manage roles',          'Edit the role and permission matrix.', true, 2),
  ('platform.directory.manage','platform', 'Manage directory',      'Maintain employees, agencies and pickup locations.', true, 3),
  ('platform.settings.manage', 'platform', 'Platform settings',     'Change platform-wide settings.', true, 4),
  ('platform.audit.view',      'platform', 'View audit log',        'Read the security and change audit trail.', true, 5)
on conflict (code) do update
  set department_code = excluded.department_code,
      name = excluded.name,
      description = excluded.description,
      sensitive = excluded.sensitive,
      sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------
-- Seed preset roles. Every one of these can be re-mixed from the admin
-- panel; they only decide what a new user starts with.
-- ---------------------------------------------------------------------
insert into public.access_roles (code, name, description, is_master, is_system, sort_order) values
  ('master_admin',       'Master Admin',        'Full control of every department and the access matrix.', true,  true, 1),
  ('operations_manager', 'Operations Manager',  'Runs every operation department. No access-control rights.', false, true, 2),
  ('coordinator',        'Trip Coordinator',    'Full guest list, pickup grouping and boat assignment.', false, true, 3),
  ('bar_staff',          'Bar Staff',           'Island bar POS, stock, closing and bar reports only.', false, true, 4),
  ('captain',            'Boat Captain',        'Boarding check-in for the boats they crew.', false, true, 5),
  ('guide',              'Tour Guide',          'Boarding check-in plus island activity roll call.', false, true, 6),
  ('agent',              'Travel Agent',        'Enters own bookings only. Cannot see other sources.', false, true, 7),
  ('accountant',         'Accountant',          'Read-only money view across bar and boat costs.', false, true, 8),
  ('pending',            'Pending Approval',    'Signed up but not approved. No access to anything.', false, true, 9)
on conflict (code) do update
  set name = excluded.name, description = excluded.description,
      is_master = excluded.is_master, is_system = excluded.is_system, sort_order = excluded.sort_order;

-- master_admin needs no rows: is_master short-circuits every check.
insert into public.access_role_permissions (role_code, permission_code)
select 'operations_manager', code from public.permissions where department_code <> 'platform'
union all
select 'coordinator', code from public.permissions
  where code in (
    'guests.booking.create','guests.booking.view_own','guests.booking.edit_own',
    'guests.booking.view_all','guests.booking.edit_all','guests.booking.delete',
    'guests.contact.view','guests.export','guests.pickup.manage',
    'fleet.view','fleet.assign','fleet.crew.assign','fleet.finalize',
    'boarding.view','boarding.view_all','boarding.mark',
    'activities.view','activities.select','activities.mark'
  )
union all
select 'bar_staff', code from public.permissions where department_code = 'bar'
union all
-- Crew deliberately do NOT get fleet.view: that would show them every
-- boat's passenger list. They see only the boats they are rostered on.
select 'captain', code from public.permissions
  where code in ('boarding.view','boarding.mark','activities.view')
union all
select 'guide', code from public.permissions
  where code in ('boarding.view','boarding.mark','activities.view','activities.select','activities.mark')
union all
select 'agent', code from public.permissions
  where code in ('guests.booking.create','guests.booking.view_own','guests.booking.edit_own')
union all
select 'accountant', code from public.permissions
  where code in ('bar.reports.view','bar.stock.view','maintenance.view','maintenance.cost.view')
on conflict do nothing;


-- ---------------------------------------------------------------------
-- Permission helpers. Security definer + stable so RLS policies can call
-- them. user_has_permission() is the core; everything else wraps it.
-- ---------------------------------------------------------------------
create or replace function public.user_has_permission(p_user_id uuid, p_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_user_id is null then false
    -- master admin short circuit
    when exists (
      select 1
      from public.profiles p
      join public.access_roles r on r.code = p.access_role_code
      where p.id = p_user_id and p.status = 'active' and r.is_master
    ) then true
    -- an explicit revoke always beats the role
    when exists (
      select 1 from public.user_permission_overrides o
      where o.user_id = p_user_id and o.permission_code = p_code and o.effect = 'revoke'
    ) then false
    when exists (
      select 1
      from public.user_permission_overrides o
      join public.profiles p on p.id = o.user_id
      where o.user_id = p_user_id
        and o.permission_code = p_code
        and o.effect = 'grant'
        and p.status = 'active'
    ) then true
    else exists (
      select 1
      from public.profiles p
      join public.access_role_permissions rp on rp.role_code = p.access_role_code
      where p.id = p_user_id and p.status = 'active' and rp.permission_code = p_code
    )
  end
$$;

create or replace function public.has_permission(p_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.user_has_permission(auth.uid(), p_code)
$$;

create or replace function public.require_permission(p_code text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not public.has_permission(p_code) then
    raise exception 'Your access does not include "%".', p_code using errcode = '42501';
  end if;
end;
$$;

create or replace function public.is_master_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.access_roles r on r.code = p.access_role_code
    where p.id = auth.uid() and p.status = 'active' and r.is_master
  )
$$;

create or replace function public.my_agency_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select agency_id from public.profiles where id = auth.uid() and status = 'active'
$$;

-- Every permission the caller effectively holds. Powers the frontend menu;
-- it is a convenience, never the fence - RLS is the fence.
create or replace function public.my_permissions()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select p.code from public.permissions p where public.has_permission(p.code)
$$;

-- ---------------------------------------------------------------------
-- The legacy profiles.role column still drives every bar/POS policy that
-- shipped before this migration. Rather than maintain two hierarchies it
-- is now a projection of the bar permissions the user actually holds.
-- ---------------------------------------------------------------------
create or replace function public.legacy_role_for(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.user_has_permission(p_user_id, 'bar.products.manage')
      or public.user_has_permission(p_user_id, 'bar.settings.manage') then 'admin'
    when public.user_has_permission(p_user_id, 'bar.stock.manage')
      or public.user_has_permission(p_user_id, 'bar.closing.manage')
      or public.user_has_permission(p_user_id, 'bar.reports.view') then 'manager'
    when public.user_has_permission(p_user_id, 'bar.pos.use') then 'cashier'
    else 'pending'
  end
$$;

create or replace function public.sync_legacy_role(p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  next_role text;
begin
  if p_user_id is null then return; end if;
  next_role := public.legacy_role_for(p_user_id);
  update public.profiles set role = next_role where id = p_user_id and role is distinct from next_role;
end;
$$;

create or replace function public.profiles_sync_legacy_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.access_role_code is not distinct from old.access_role_code
     and new.status is not distinct from old.status then
    return new;
  end if;
  perform public.sync_legacy_role(new.id);
  return new;
end;
$$;

drop trigger if exists profiles_sync_legacy_role on public.profiles;
create trigger profiles_sync_legacy_role
after insert or update of access_role_code, status on public.profiles
for each row execute function public.profiles_sync_legacy_role();

create or replace function public.overrides_sync_legacy_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_legacy_role(coalesce(new.user_id, old.user_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists overrides_sync_legacy_role on public.user_permission_overrides;
create trigger overrides_sync_legacy_role
after insert or update or delete on public.user_permission_overrides
for each row execute function public.overrides_sync_legacy_role();

-- current_user_role() used to fall back to 'admin' when a profile row was
-- missing, which handed full bar rights to anyone. It now fails closed.
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'pending')
$$;

-- Two extra bar presets so existing cashier/manager staff keep exactly the
-- rights they had instead of being promoted by the migration.
insert into public.access_roles (code, name, description, is_master, is_system, sort_order) values
  ('bar_manager', 'Bar Manager', 'Bar POS, stock in, closing and reports. Cannot change products or prices.', false, true, 41),
  ('bar_cashier', 'Bar Cashier', 'Takes orders on the POS and can look up stock.', false, true, 42)
on conflict (code) do update set name = excluded.name, description = excluded.description;

insert into public.access_role_permissions (role_code, permission_code)
select 'bar_manager', code from public.permissions
  where code in ('bar.pos.use','bar.pos.void','bar.stock.view','bar.stock.manage','bar.closing.manage','bar.reports.view')
union all
select 'bar_cashier', code from public.permissions
  where code in ('bar.pos.use','bar.stock.view')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- New sign-ups. A brand new account lands on "pending" with zero rights
-- until a master admin approves it, so a leaked sign-up page is harmless.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  anonymous boolean := coalesce((to_jsonb(new)->>'is_anonymous')::boolean, new.email is null);
  code_login_enabled boolean := public.setting_bool('allow_access_code_login', true);
  code_role text := public.setting_text('access_code_role', 'bar_staff');
  next_role text;
  next_status text;
begin
  if anonymous and code_login_enabled and exists (select 1 from public.access_roles where code = code_role) then
    next_role := code_role;
    next_status := 'active';
  else
    next_role := 'pending';
    next_status := 'pending';
  end if;

  insert into public.profiles (id, full_name, role, access_role_code, status, login_email, is_anonymous)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data->>'full_name', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Lovely Paradise Staff'
    ),
    'pending',
    next_role,
    next_status,
    new.email,
    anonymous
  )
  on conflict (id) do nothing;

  perform public.sync_legacy_role(new.id);
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Backfill existing accounts. Anonymous access-code sessions keep exactly
-- the bar rights they have today; nobody is silently promoted.
-- ---------------------------------------------------------------------
do $$
declare
  has_anon_column boolean := exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'users' and column_name = 'is_anonymous'
  );
begin
  if has_anon_column then
    execute $sql$
      update public.profiles p
      set is_anonymous = coalesce(u.is_anonymous, u.email is null),
          login_email = u.email
      from auth.users u
      where u.id = p.id
    $sql$;
  else
    execute $sql$
      update public.profiles p
      set is_anonymous = (u.email is null), login_email = u.email
      from auth.users u
      where u.id = p.id
    $sql$;
  end if;
end $$;

update public.profiles
set access_role_code = case
      when is_anonymous then 'bar_staff'
      when role = 'admin' then 'bar_staff'
      when role = 'manager' then 'bar_manager'
      else 'bar_cashier'
    end,
    status = 'active'
where access_role_code is null;

alter table public.profiles alter column access_role_code set default 'pending';

-- Re-project every legacy role from the new matrix.
do $$
declare
  target uuid;
begin
  for target in select id from public.profiles loop
    perform public.sync_legacy_role(target);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Admin RPCs. Every access change goes through these so it is validated
-- and written to the audit log.
-- ---------------------------------------------------------------------
create or replace function public.admin_update_user(
  p_user_id uuid,
  p_full_name text default null,
  p_access_role_code text default null,
  p_status text default null,
  p_agency_id uuid default null,
  p_phone text default null,
  p_clear_agency boolean default false
)
returns public.profiles
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  before_row public.profiles%rowtype;
  after_row public.profiles%rowtype;
  target_is_master boolean;
  new_is_master boolean;
begin
  perform public.require_permission('platform.users.manage');

  select * into before_row from public.profiles where id = p_user_id;
  if not found then raise exception 'User not found.'; end if;

  select coalesce(r.is_master, false) into target_is_master
  from public.access_roles r where r.code = before_row.access_role_code;

  if coalesce(target_is_master, false) and not public.is_master_admin() then
    raise exception 'Only a master admin can change another master admin.' using errcode = '42501';
  end if;

  if p_access_role_code is not null then
    select coalesce(is_master, false) into new_is_master from public.access_roles where code = p_access_role_code;
    if not found then raise exception 'Unknown access role "%".', p_access_role_code; end if;
    if new_is_master and not public.is_master_admin() then
      raise exception 'Only a master admin can grant master admin.' using errcode = '42501';
    end if;
  end if;

  if before_row.id = auth.uid() and p_access_role_code is not null
     and coalesce(target_is_master, false) and not coalesce(new_is_master, false)
     and (select count(*) from public.profiles pr
          join public.access_roles ar on ar.code = pr.access_role_code
          where ar.is_master and pr.status = 'active') <= 1 then
    raise exception 'You are the only master admin. Promote someone else first.';
  end if;

  update public.profiles
  set full_name = coalesce(nullif(p_full_name, ''), full_name),
      access_role_code = coalesce(p_access_role_code, access_role_code),
      status = coalesce(p_status, status),
      agency_id = case when p_clear_agency then null else coalesce(p_agency_id, agency_id) end,
      phone = coalesce(p_phone, phone)
  where id = p_user_id
  returning * into after_row;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, before_json, after_json)
  values (auth.uid(), 'admin_update_user', 'profile', p_user_id, to_jsonb(before_row), to_jsonb(after_row));

  return after_row;
end;
$$;

create or replace function public.admin_set_permission_override(
  p_user_id uuid,
  p_permission_code text,
  p_effect text
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  target_department text;
begin
  perform public.require_permission('platform.users.manage');

  select department_code into target_department from public.permissions where code = p_permission_code;
  if not found then raise exception 'Unknown permission "%".', p_permission_code; end if;

  if target_department = 'platform' and not public.is_master_admin() then
    raise exception 'Only a master admin can change admin-panel permissions.' using errcode = '42501';
  end if;

  if p_effect not in ('grant', 'revoke', 'inherit') then
    raise exception 'Effect must be grant, revoke or inherit.';
  end if;

  if p_effect = 'inherit' then
    delete from public.user_permission_overrides
    where user_id = p_user_id and permission_code = p_permission_code;
  else
    insert into public.user_permission_overrides (user_id, permission_code, effect, granted_by)
    values (p_user_id, p_permission_code, p_effect, auth.uid())
    on conflict (user_id, permission_code)
    do update set effect = excluded.effect, granted_by = excluded.granted_by, created_at = now();
  end if;

  perform public.sync_legacy_role(p_user_id);

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, after_json)
  values (auth.uid(), 'admin_set_permission_override', 'profile', p_user_id,
          jsonb_build_object('permission', p_permission_code, 'effect', p_effect));
end;
$$;

create or replace function public.admin_set_role_permission(
  p_role_code text,
  p_permission_code text,
  p_enabled boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  target_department text;
  role_is_master boolean;
begin
  perform public.require_permission('platform.roles.manage');

  select coalesce(is_master, false) into role_is_master from public.access_roles where code = p_role_code;
  if not found then raise exception 'Unknown access role "%".', p_role_code; end if;
  if role_is_master then raise exception 'The master admin role always has every permission.'; end if;

  select department_code into target_department from public.permissions where code = p_permission_code;
  if not found then raise exception 'Unknown permission "%".', p_permission_code; end if;
  if target_department = 'platform' and not public.is_master_admin() then
    raise exception 'Only a master admin can change admin-panel permissions.' using errcode = '42501';
  end if;

  if p_enabled then
    insert into public.access_role_permissions (role_code, permission_code)
    values (p_role_code, p_permission_code)
    on conflict do nothing;
  else
    delete from public.access_role_permissions
    where role_code = p_role_code and permission_code = p_permission_code;
  end if;

  update public.profiles set role = public.legacy_role_for(id) where access_role_code = p_role_code;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, after_json)
  values (auth.uid(), 'admin_set_role_permission', 'access_role', null,
          jsonb_build_object('role', p_role_code, 'permission', p_permission_code, 'enabled', p_enabled));
end;
$$;

create or replace function public.admin_save_access_role(
  p_code text,
  p_name text,
  p_description text default null
)
returns public.access_roles
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  saved public.access_roles%rowtype;
  clean_code text := lower(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9]+', '_', 'g'));
begin
  perform public.require_permission('platform.roles.manage');
  if clean_code = '' then raise exception 'A role code is required.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'A role name is required.'; end if;

  insert into public.access_roles (code, name, description, is_master, is_system, sort_order)
  values (clean_code, trim(p_name), p_description, false, false, 100)
  on conflict (code) do update
    set name = excluded.name, description = excluded.description
  returning * into saved;

  return saved;
end;
$$;

create or replace function public.admin_delete_access_role(p_code text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  target public.access_roles%rowtype;
begin
  perform public.require_permission('platform.roles.manage');
  select * into target from public.access_roles where code = p_code;
  if not found then raise exception 'Unknown access role "%".', p_code; end if;
  if target.is_system then raise exception 'Built-in roles cannot be deleted. Edit their permissions instead.'; end if;
  if exists (select 1 from public.profiles where access_role_code = p_code) then
    raise exception 'Move the users on this role to another role first.';
  end if;
  delete from public.access_roles where code = p_code;
end;
$$;

create or replace function public.admin_effective_permissions(p_user_id uuid)
returns table (permission_code text, source text, allowed boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.code,
    case
      when (select coalesce(r.is_master, false) from public.profiles pr
            join public.access_roles r on r.code = pr.access_role_code where pr.id = p_user_id) then 'master'
      when o.effect = 'revoke' then 'revoked'
      when o.effect = 'grant' then 'granted'
      when rp.permission_code is not null then 'role'
      else 'none'
    end as source,
    public.user_has_permission(p_user_id, p.code) as allowed
  from public.permissions p
  left join public.user_permission_overrides o
    on o.permission_code = p.code and o.user_id = p_user_id
  left join public.access_role_permissions rp
    on rp.permission_code = p.code
   and rp.role_code = (select access_role_code from public.profiles where id = p_user_id)
  where public.has_permission('platform.users.manage')
  order by p.department_code, p.sort_order
$$;

-- ---------------------------------------------------------------------
-- RLS for the access-control tables
-- ---------------------------------------------------------------------
alter table public.departments enable row level security;
alter table public.permissions enable row level security;
alter table public.access_roles enable row level security;
alter table public.access_role_permissions enable row level security;
alter table public.user_permission_overrides enable row level security;
alter table public.agencies enable row level security;

drop policy if exists "departments read" on public.departments;
create policy "departments read" on public.departments
  for select to authenticated using (true);

drop policy if exists "permissions read" on public.permissions;
create policy "permissions read" on public.permissions
  for select to authenticated using (true);

drop policy if exists "access roles read" on public.access_roles;
create policy "access roles read" on public.access_roles
  for select to authenticated using (true);

drop policy if exists "access role permissions read" on public.access_role_permissions;
create policy "access role permissions read" on public.access_role_permissions
  for select to authenticated using (true);

drop policy if exists "overrides read" on public.user_permission_overrides;
create policy "overrides read" on public.user_permission_overrides
  for select to authenticated
  using (user_id = auth.uid() or public.has_permission('platform.users.manage'));

-- Agencies: an agent may only ever see their own agency row.
drop policy if exists "agencies read" on public.agencies;
create policy "agencies read" on public.agencies
  for select to authenticated
  using (
    public.has_permission('platform.directory.manage')
    or public.has_permission('guests.booking.view_all')
    or id = public.my_agency_id()
  );

drop policy if exists "agencies write" on public.agencies;
create policy "agencies write" on public.agencies
  for all to authenticated
  using (public.has_permission('platform.directory.manage'))
  with check (public.has_permission('platform.directory.manage'));

-- ---------------------------------------------------------------------
-- Tighten the pre-existing profile policies. Bar staff used to be able to
-- list every profile because their legacy role was 'admin'.
-- ---------------------------------------------------------------------
drop policy if exists "profiles read self or admin" on public.profiles;
drop policy if exists "profiles admin update" on public.profiles;

create policy "profiles read self or user admin" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.has_permission('platform.users.manage'));

create policy "profiles self name update" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Platform settings must stay reachable for whoever holds
-- platform.settings.manage, even if they hold no bar permissions at all.
drop policy if exists "settings admin write" on public.app_settings;
create policy "settings admin write" on public.app_settings
  for all to authenticated
  using (public.has_permission('bar.settings.manage') or public.has_permission('platform.settings.manage'))
  with check (public.has_permission('bar.settings.manage') or public.has_permission('platform.settings.manage'));

drop policy if exists "audit admin read" on public.audit_logs;
create policy "audit read" on public.audit_logs
  for select to authenticated using (public.has_permission('platform.audit.view'));

-- Role and permission edits only ever happen through the admin RPCs above,
-- which are security definer, so no direct table write policy is needed.

-- ---------------------------------------------------------------------
-- Platform settings
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value) values
  ('platform_name',            '"Lovely Paradise Operations"'::jsonb),
  ('allow_access_code_login',  'true'::jsonb),
  ('access_code_role',         '"bar_staff"'::jsonb),
  ('pickup_group_radius_km',   '1.5'::jsonb),
  ('default_departure_time',   '"09:00"'::jsonb)
on conflict (key) do nothing;

-- Turning the shared bar code off must lock out the tablets that are
-- already signed in with it, not just block the next sign-in.
create or replace function public.app_settings_access_code_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.key = 'allow_access_code_login' and coalesce((new.value::text)::boolean, true) = false then
    update public.profiles
    set status = 'suspended'
    where is_anonymous and status = 'active';
  end if;
  return new;
end;
$$;

drop trigger if exists app_settings_access_code_guard on public.app_settings;
create trigger app_settings_access_code_guard
after insert or update of value on public.app_settings
for each row execute function public.app_settings_access_code_guard();

grant execute on function public.has_permission(text) to authenticated;
grant execute on function public.my_permissions() to authenticated;
grant execute on function public.my_agency_id() to authenticated;
grant execute on function public.is_master_admin() to authenticated;

-- Never callable from the browser: they exist for triggers and other
-- security-definer functions only.
revoke all on function public.sync_legacy_role(uuid) from public, anon, authenticated;
revoke all on function public.legacy_role_for(uuid) from public, anon, authenticated;
revoke all on function public.user_has_permission(uuid, text) from public, anon, authenticated;
