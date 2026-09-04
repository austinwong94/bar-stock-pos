-- =====================================================================
-- Daily operations log, late-step alerts, and the full change trail on
-- guest records.
-- =====================================================================

create table if not exists public.operations_events (
  id uuid primary key default gen_random_uuid(),
  service_date date not null,
  department_code text,
  event_code text not null,
  subject text,
  detail text,
  severity text not null default 'info' check (severity in ('info', 'warning', 'alert')),
  reference_type text,
  reference_id uuid,
  occurred_at timestamptz not null default now(),
  actor_id uuid references public.profiles(id) on delete set null
);

create index if not exists operations_events_day_idx on public.operations_events (service_date, occurred_at);

-- One completion event per thing, however many times the RPC is called.
create unique index if not exists operations_events_once_idx
  on public.operations_events (event_code, reference_id)
  where reference_id is not null;

create table if not exists public.operations_checkpoints (
  code text primary key,
  name text not null,
  department_code text,
  event_code text not null,
  scope text not null default 'per_boat' check (scope in ('per_boat', 'per_day')),
  due_time time not null,
  enabled boolean not null default true,
  sort_order int not null default 0
);

insert into public.operations_checkpoints (code, name, department_code, event_code, scope, due_time, sort_order) values
  ('assignment_locked',  'Boat assignment finished',   'fleet',      'fleet.assignment_completed', 'per_day',  '08:00', 1),
  ('boarding_done',      'Boarding attendance done',   'boarding',   'boarding.completed',        'per_boat', '09:00', 2),
  ('activity_chosen',    'Activities chosen',          'activities', 'activities.selected',       'per_boat', '11:00', 3),
  ('activity_roll_call', 'Activity roll call done',    'activities', 'activities.completed',      'per_boat', '15:00', 4),
  ('everyone_back',      'Everyone back on the boat',  'activities', 'activities.all_returned',   'per_boat', '16:00', 5)
on conflict (code) do update
  set name = excluded.name, department_code = excluded.department_code,
      event_code = excluded.event_code, scope = excluded.scope, sort_order = excluded.sort_order;

create or replace function public.log_operations_event(
  p_service_date date,
  p_department_code text,
  p_event_code text,
  p_subject text default null,
  p_detail text default null,
  p_severity text default 'info',
  p_reference_type text default null,
  p_reference_id uuid default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  insert into public.operations_events (
    service_date, department_code, event_code, subject, detail, severity,
    reference_type, reference_id, actor_id
  )
  values (
    p_service_date, p_department_code, p_event_code, p_subject, p_detail, p_severity,
    p_reference_type, p_reference_id, auth.uid()
  )
  on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------
-- Completion detection. Called after the boarding and activity RPCs so a
-- milestone is recorded the moment the last passenger is dealt with.
-- ---------------------------------------------------------------------
create or replace function public.refresh_assignment_milestones(p_assignment_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_date date;
  v_boat text;
  v_total int;
  v_boarded int;
  v_chosen int;
  v_marked int;
  v_returned int;
  v_arrived int;
begin
  select a.service_date, b.code into v_date, v_boat
  from public.boat_assignments a join public.boats b on b.id = a.boat_id
  where a.id = p_assignment_id;
  if v_date is null then return; end if;

  select
    count(*),
    count(*) filter (where boarding_status <> 'pending'),
    count(*) filter (where boarding_status = 'arrived')
  into v_total, v_boarded, v_arrived
  from public.trip_passengers where assignment_id = p_assignment_id;

  if v_total = 0 then return; end if;

  if v_boarded = v_total then
    perform public.log_operations_event(
      v_date, 'boarding', 'boarding.completed', v_boat,
      v_arrived || ' of ' || v_total || ' guests checked in',
      'info', 'boat_assignment', p_assignment_id);
  end if;

  select
    count(*) filter (where activity_code is not null),
    count(*) filter (where activity_status <> 'pending'),
    count(*) filter (where returned)
  into v_chosen, v_marked, v_returned
  from public.trip_passengers
  where assignment_id = p_assignment_id and boarding_status = 'arrived';

  if v_arrived > 0 and v_chosen = v_arrived then
    perform public.log_operations_event(
      v_date, 'activities', 'activities.selected', v_boat,
      'All ' || v_arrived || ' guests have an activity',
      'info', 'boat_assignment', p_assignment_id);
  end if;

  if v_arrived > 0 and v_marked = v_arrived then
    perform public.log_operations_event(
      v_date, 'activities', 'activities.completed', v_boat,
      'Activity roll call done for ' || v_arrived || ' guests',
      'info', 'boat_assignment', p_assignment_id);
  end if;

  if v_arrived > 0 and v_returned = v_arrived then
    perform public.log_operations_event(
      v_date, 'activities', 'activities.all_returned', v_boat,
      'All ' || v_arrived || ' guests back on board',
      'info', 'boat_assignment', p_assignment_id);
  end if;
end;
$$;

-- Re-declare the boarding and activity RPCs with the milestone hook.
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

  for v_assignment in
    select distinct assignment_id from public.trip_passengers where id = any(p_passenger_ids)
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

  for v_assignment in
    select distinct assignment_id from public.trip_passengers where id = any(p_passenger_ids)
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

  for v_assignment in
    select distinct assignment_id from public.trip_passengers where id = any(p_passenger_ids)
  loop
    perform public.refresh_assignment_milestones(v_assignment);
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- What is done, what is late
-- ---------------------------------------------------------------------
create or replace function public.operations_day_status(p_service_date date)
returns table (
  checkpoint_code text,
  checkpoint_name text,
  department_code text,
  subject text,
  assignment_id uuid,
  due_time time,
  done boolean,
  done_at timestamptz,
  overdue boolean,
  detail text
)
language sql
stable
security definer
set search_path = public
as $$
  with per_day as (
    select c.code, c.name, c.department_code, null::text as subject, null::uuid as assignment_id, c.due_time, c.sort_order, c.event_code
    from public.operations_checkpoints c
    where c.enabled and c.scope = 'per_day'
  ),
  per_boat as (
    select c.code, c.name, c.department_code, b.code as subject, a.id as assignment_id, c.due_time, c.sort_order, c.event_code
    from public.operations_checkpoints c
    cross join lateral (
      select a.id, a.boat_id
      from public.boat_assignments a
      where a.service_date = p_service_date
        and a.status <> 'cancelled'
        and exists (select 1 from public.trip_passengers tp where tp.assignment_id = a.id)
    ) a
    join public.boats b on b.id = a.boat_id
    where c.enabled and c.scope = 'per_boat'
  ),
  rows as (select * from per_day union all select * from per_boat)
  select
    r.code,
    r.name,
    r.department_code,
    r.subject,
    r.assignment_id,
    r.due_time,
    e.id is not null as done,
    e.occurred_at as done_at,
    e.id is null
      and (now() at time zone 'Asia/Kuala_Lumpur') > (p_service_date + r.due_time) as overdue,
    e.detail
  from rows r
  left join public.operations_events e
    on e.event_code = r.event_code
   and e.service_date = p_service_date
   and (r.assignment_id is null or e.reference_id = r.assignment_id)
  where public.has_permission('ops.log.view')
  order by r.sort_order, r.subject nulls first
$$;

-- Queues one alert per late step. Safe to call repeatedly: the unique
-- index on operations_events keeps it to a single alert per step per day.
create or replace function public.raise_overdue_alerts(p_service_date date)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  rec record;
  v_raised int := 0;
  v_label text;
begin
  perform public.require_permission('ops.log.view');

  for rec in
    select * from public.operations_day_status(p_service_date) where overdue
  loop
    v_label := rec.checkpoint_name || coalesce(' - ' || rec.subject, '');

    if exists (
      select 1 from public.operations_events e
      where e.service_date = p_service_date
        and e.event_code = 'ops.overdue'
        and e.subject = v_label
    ) then
      continue;
    end if;

    insert into public.operations_events (
      service_date, department_code, event_code, subject, detail, severity
    )
    values (
      p_service_date, rec.department_code, 'ops.overdue', v_label,
      'Not done by ' || to_char(rec.due_time, 'HH24:MI'), 'alert'
    );

    perform public.queue_outbound_message(
      'ops.checkpoint_overdue',
      'Running late: ' || v_label,
      '*RUNNING LATE*' || E'\n' || to_char(p_service_date, 'Dy DD Mon YYYY') || E'\n\n' ||
      v_label || E'\n' || 'Expected by ' || to_char(rec.due_time, 'HH24:MI') || ', still not done.',
      p_service_date,
      'operations_checkpoint',
      rec.assignment_id
    );

    v_raised := v_raised + 1;
  end loop;

  return v_raised;
end;
$$;

create or replace function public.set_operations_checkpoint(p_code text, p_due_time text, p_enabled boolean)
returns public.operations_checkpoints
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row public.operations_checkpoints%rowtype;
begin
  perform public.require_permission('ops.log.manage');
  update public.operations_checkpoints
  set due_time = coalesce(nullif(p_due_time, '')::time, due_time),
      enabled = coalesce(p_enabled, enabled)
  where code = p_code
  returning * into v_row;
  if not found then raise exception 'Unknown checkpoint "%".', p_code; end if;
  return v_row;
end;
$$;

-- =====================================================================
-- Change trail on guest records
-- =====================================================================
alter table public.audit_logs add column if not exists reason text;
alter table public.audit_logs add column if not exists actor_name text;
create index if not exists audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);
create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);

-- Generic row logger: who changed what, when, and what it looked like
-- before and after.
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  select full_name into v_name from public.profiles where id = auth.uid();

  insert into public.audit_logs (
    actor_id, actor_name, action, entity_type, entity_id, before_json, after_json,
    reason
  )
  values (
    auth.uid(),
    coalesce(v_name, 'system'),
    lower(tg_op),
    tg_table_name,
    case when tg_op = 'DELETE' then old.id else new.id end,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end,
    nullif(current_setting('app.change_reason', true), '')
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists bookings_audit on public.bookings;
create trigger bookings_audit after insert or update or delete on public.bookings
for each row execute function public.audit_row_change();

drop trigger if exists tourists_audit on public.tourists;
create trigger tourists_audit after insert or update or delete on public.tourists
for each row execute function public.audit_row_change();

drop trigger if exists tourist_private_audit on public.tourist_private;
create trigger tourist_private_audit after insert or update or delete on public.tourist_private
for each row execute function public.audit_row_change();

drop trigger if exists purchase_requests_audit on public.purchase_requests;
create trigger purchase_requests_audit after insert or update or delete on public.purchase_requests
for each row execute function public.audit_row_change();

drop trigger if exists boats_audit on public.boats;
create trigger boats_audit after insert or update or delete on public.boats
for each row execute function public.audit_row_change();

drop trigger if exists boat_repairs_audit on public.boat_repairs;
create trigger boat_repairs_audit after insert or update or delete on public.boat_repairs
for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------
-- "You may only edit what you entered."
--
-- edit_own now means exactly that: the rows this account created. Editing
-- everything an agency entered is a separate, stronger permission, and
-- editing anyone's is stronger still.
-- ---------------------------------------------------------------------
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
          b.status in ('draft', 'confirmed')
          and (
            (public.has_permission('guests.booking.edit_own') and b.created_by = auth.uid())
            or (
              public.has_permission('guests.booking.edit_agency')
              and b.agency_id is not null
              and b.agency_id = public.my_agency_id()
            )
          )
        )
      )
  )
$$;

-- Deleting a guest record always needs a written reason, and the reason
-- is stored on the audit row.
create or replace function public.delete_booking(p_booking_id uuid, p_reason text default null)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row public.bookings%rowtype;
begin
  perform public.require_permission('guests.booking.delete');

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Say why this booking is being deleted.';
  end if;
  if length(trim(p_reason)) < 5 then
    raise exception 'Give a real reason for deleting this booking.';
  end if;

  select * into v_row from public.bookings where id = p_booking_id;
  if not found or not public.can_view_booking(p_booking_id) then
    raise exception 'Booking not found.';
  end if;

  -- Only the person who entered it, or someone allowed to edit anyone's,
  -- may remove it. An outside agent can never delete another agency's work.
  if not (public.has_permission('guests.booking.edit_all') or v_row.created_by = auth.uid()) then
    raise exception 'You can only delete bookings you entered.' using errcode = '42501';
  end if;

  perform set_config('app.change_reason', trim(p_reason), true);

  insert into public.audit_logs(actor_id, actor_name, action, entity_type, entity_id, before_json, reason)
  select auth.uid(), coalesce(p.full_name, 'unknown'), 'delete_booking', 'booking', p_booking_id,
         to_jsonb(v_row), trim(p_reason)
  from public.profiles p where p.id = auth.uid();

  delete from public.bookings where id = p_booking_id;
  perform set_config('app.change_reason', '', true);
end;
$$;

drop function if exists public.delete_booking(uuid);

-- The change trail for one booking, for the people allowed to see it.
create or replace function public.booking_history(p_booking_id uuid)
returns table (
  id uuid,
  action text,
  entity_type text,
  actor_name text,
  reason text,
  created_at timestamptz,
  summary text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.id,
    a.action,
    a.entity_type,
    coalesce(a.actor_name, 'unknown'),
    a.reason,
    a.created_at,
    case a.entity_type
      when 'bookings' then coalesce(a.after_json->>'lead_name', a.before_json->>'lead_name')
      when 'tourists' then coalesce(a.after_json->>'full_name', a.before_json->>'full_name')
      when 'tourist_private' then 'passport / ID details'
      else coalesce(a.after_json->>'lead_name', a.before_json->>'lead_name')
    end
  from public.audit_logs a
  where public.can_view_booking(p_booking_id)
    and (
      (a.entity_type in ('bookings', 'booking') and a.entity_id = p_booking_id)
      or (a.entity_type = 'tourists' and coalesce(a.after_json->>'booking_id', a.before_json->>'booking_id') = p_booking_id::text)
      or (a.entity_type = 'tourist_private' and a.entity_id in (
            select t.id from public.tourists t where t.booking_id = p_booking_id))
    )
  order by a.created_at desc
  limit 200
$$;

-- ---------------------------------------------------------------------
-- Badge counts for the home screen
-- ---------------------------------------------------------------------
create or replace function public.department_badges(p_service_date date)
returns table (department_code text, count int, label text)
language sql
stable
security definer
set search_path = public
as $$
  select 'purchasing', count(*)::int, 'request(s) waiting to be bought'
  from public.purchase_requests
  where status in ('submitted', 'buying') and public.has_permission('purchasing.view')
  having count(*) > 0

  union all
  select 'kitchen', count(*)::int, 'draft request(s) not sent yet'
  from public.purchase_requests
  where status = 'draft'
    and public.has_permission('kitchen.request.view')
    and (requested_by = auth.uid() or public.has_permission('kitchen.manage'))
  having count(*) > 0

  union all
  select 'fleet', count(*)::int, 'booking(s) with no boat'
  from public.bookings b
  where b.service_date = p_service_date
    and b.status <> 'cancelled'
    and public.has_permission('fleet.assign')
    and not exists (select 1 from public.trip_bookings tb where tb.booking_id = b.id)
  having count(*) > 0

  union all
  select 'boarding', count(*)::int, 'guest(s) not checked in'
  from public.trip_passengers tp
  join public.boat_assignments a on a.id = tp.assignment_id
  where a.service_date = p_service_date
    and tp.boarding_status = 'pending'
    and public.can_see_assignment(tp.assignment_id)
  having count(*) > 0

  union all
  select 'activities', count(*)::int, 'guest(s) with no activity chosen'
  from public.trip_passengers tp
  join public.boat_assignments a on a.id = tp.assignment_id
  where a.service_date = p_service_date
    and tp.boarding_status = 'arrived'
    and tp.activity_code is null
    and public.can_see_assignment(tp.assignment_id)
  having count(*) > 0

  union all
  select 'maintenance', count(*)::int, 'repair job(s) still open'
  from public.boat_repairs
  where status in ('reported', 'in_progress') and public.has_permission('maintenance.view')
  having count(*) > 0

  union all
  select 'ops', count(*)::int, 'message(s) waiting to be sent'
  from public.outbound_messages
  where status = 'queued' and public.has_permission('ops.messages.send')
  having count(*) > 0

  union all
  select 'platform', count(*)::int, 'account(s) waiting for approval'
  from public.profiles
  where status = 'pending' and public.has_permission('platform.users.manage')
  having count(*) > 0
$$;

-- ---------------------------------------------------------------------
-- RLS + grants
-- ---------------------------------------------------------------------
alter table public.operations_events enable row level security;
alter table public.operations_checkpoints enable row level security;

drop policy if exists "operations events read" on public.operations_events;
create policy "operations events read" on public.operations_events
  for select to authenticated using (public.has_permission('ops.log.view'));

drop policy if exists "operations checkpoints read" on public.operations_checkpoints;
create policy "operations checkpoints read" on public.operations_checkpoints
  for select to authenticated
  using (public.has_permission('ops.log.view') or public.has_permission('ops.log.manage'));

do $$
declare fn text;
begin
  foreach fn in array array[
    'operations_day_status(date)',
    'raise_overdue_alerts(date)',
    'set_operations_checkpoint(text, text, boolean)',
    'department_badges(date)',
    'booking_history(uuid)',
    'delete_booking(uuid, text)'
  ]
  loop
    execute format('revoke all on function public.%s from anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

revoke all on function public.log_operations_event(date, text, text, text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.refresh_assignment_milestones(uuid) from public, anon, authenticated;
revoke all on function public.audit_row_change() from public, anon, authenticated;
