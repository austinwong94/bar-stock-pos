-- =====================================================================
-- Kitchen requests, Things to Purchase, and the outbound message queue
-- that feeds WhatsApp (or any other channel) with a per-section switch.
-- =====================================================================

insert into public.departments (code, name, description, icon, sort_order) values
  ('kitchen',    'Kitchen',            'Ingredients and materials the kitchen needs, by date and pax.', 'ChefHat',  8),
  ('purchasing', 'Things to Purchase', 'The buying queue: what was asked for, what has been bought.',  'ShoppingBasket', 9),
  ('ops',        'Daily Operations',   'Live progress log of the day and what is running late.',       'Activity', 10)
on conflict (code) do update
  set name = excluded.name, description = excluded.description, icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.permissions (code, department_code, name, description, sensitive, sort_order) values
  ('kitchen.request.view',   'kitchen', 'View kitchen requests',  'See what the kitchen has asked for.', false, 1),
  ('kitchen.request.create', 'kitchen', 'Raise a request',        'Create an ingredient or material request.', false, 2),
  ('kitchen.request.submit', 'kitchen', 'Confirm and send',       'Send a request to Things to Purchase. This is what triggers the WhatsApp message.', false, 3),
  ('kitchen.manage',         'kitchen', 'Correct requests',       'Edit or cancel any kitchen request, including other people''s.', true, 4),

  ('purchasing.view',    'purchasing', 'View the buying list', 'See every request waiting to be bought.', false, 1),
  ('purchasing.fulfil',  'purchasing', 'Mark as bought',       'Record what was bought, the cost and the supplier.', false, 2),
  ('purchasing.manage',  'purchasing', 'Manage the queue',     'Change quantities, close or cancel requests.', true, 3),
  ('purchasing.cost.view','purchasing','See purchase costs',   'View the money figures on the buying list.', true, 4),

  ('ops.log.view',    'ops', 'View the operations log', 'See today''s progress and anything running late.', false, 1),
  ('ops.log.manage',  'ops', 'Manage checkpoints',      'Change the times each step is expected to be done by.', true, 2),
  ('ops.messages.send','ops','Send queued messages',    'Send the queued WhatsApp messages and mark them as sent.', false, 3),
  ('ops.messages.manage','ops','Switch messages on and off','Choose which sections send a WhatsApp message.', true, 4),

  ('guests.booking.edit_agency', 'guests', 'Edit the whole agency''s bookings',
   'Edit any booking from the same agency, not only your own entries.', true, 10)
on conflict (code) do update
  set department_code = excluded.department_code, name = excluded.name,
      description = excluded.description, sensitive = excluded.sensitive, sort_order = excluded.sort_order;

-- Preset roles for the two new departments.
insert into public.access_roles (code, name, description, is_master, is_system, sort_order) values
  ('kitchen_staff', 'Kitchen Staff', 'Raises ingredient requests and sends them to purchasing.', false, true, 12),
  ('purchaser',     'Purchaser',     'Works the buying list and records what was bought.', false, true, 13)
on conflict (code) do update set name = excluded.name, description = excluded.description;

insert into public.access_role_permissions (role_code, permission_code)
select 'kitchen_staff', code from public.permissions
  where code in ('kitchen.request.view','kitchen.request.create','kitchen.request.submit')
union all
select 'purchaser', code from public.permissions
  where code in ('purchasing.view','purchasing.fulfil','purchasing.cost.view','kitchen.request.view')
union all
select 'operations_manager', code from public.permissions
  where department_code in ('kitchen','purchasing','ops')
union all
select 'coordinator', code from public.permissions
  where code in ('kitchen.request.view','purchasing.view','ops.log.view','ops.messages.send')
union all
select 'accountant', code from public.permissions
  where code in ('purchasing.view','purchasing.cost.view','kitchen.request.view')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Purchase requests. The kitchen is the first origin; boats and the bar
-- can raise one through the same queue without a second table.
-- ---------------------------------------------------------------------
create table if not exists public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  request_no text not null unique,
  origin text not null default 'kitchen' check (origin in ('kitchen', 'boat', 'bar', 'office', 'other')),
  needed_for_date date not null,
  pax_count int not null default 0 check (pax_count >= 0),
  purpose text,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'buying', 'completed', 'cancelled')),
  notes text,
  requested_by uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz,
  completed_at timestamptz,
  cancelled_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists purchase_requests_date_idx on public.purchase_requests (needed_for_date desc);
create index if not exists purchase_requests_status_idx on public.purchase_requests (status);

create table if not exists public.purchase_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.purchase_requests(id) on delete cascade,
  item_name text not null,
  quantity numeric(12,2) not null default 0 check (quantity >= 0),
  unit text not null default 'kg',
  note text,
  purchase_status text not null default 'pending'
    check (purchase_status in ('pending', 'bought', 'unavailable')),
  purchased_quantity numeric(12,2),
  actual_cost numeric(12,2),
  supplier text,
  purchased_by uuid references public.profiles(id) on delete set null,
  purchased_at timestamptz,
  purchase_note text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists purchase_request_items_request_idx on public.purchase_request_items (request_id, sort_order);

drop trigger if exists purchase_requests_touch on public.purchase_requests;
create trigger purchase_requests_touch before update on public.purchase_requests
for each row execute function public.touch_updated_at();
drop trigger if exists purchase_request_items_touch on public.purchase_request_items;
create trigger purchase_request_items_touch before update on public.purchase_request_items
for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Outbound messages.
--
-- The app never talks to WhatsApp directly. Every event that should be
-- announced writes a finished, ready-to-send message here. How it leaves
-- the building is a separate decision:
--   * a person opens the outbox and taps send (works today, no server),
--   * or a worker drains the queue and posts it automatically.
-- Swapping between those never touches the departments that produce the
-- messages.
-- ---------------------------------------------------------------------
create table if not exists public.notification_rules (
  code text primary key,
  name text not null,
  description text,
  department_code text references public.departments(code) on delete set null,
  channel text not null default 'whatsapp',
  enabled boolean not null default true,
  target_label text,
  sort_order int not null default 0,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.notification_rules (code, name, description, department_code, target_label, sort_order) values
  ('kitchen.request_submitted', 'Kitchen request confirmed',
   'Sends the full ingredient list, date and pax when the kitchen confirms a request.', 'kitchen', 'Purchasing group', 1),
  ('purchasing.completed', 'Purchase run completed',
   'Sends a summary when everything on a request has been bought or marked unavailable.', 'purchasing', 'Purchasing group', 2),
  ('fleet.assignment_completed', 'Boat assignment completed',
   'Sends the full boat manifest with guest names, captain and guide when the day is locked.', 'fleet', 'Operations group', 3),
  ('ops.checkpoint_overdue', 'Step running late',
   'Sends an alert when a step such as boarding is not finished by its expected time.', 'ops', 'Operations group', 4)
on conflict (code) do update
  set name = excluded.name, description = excluded.description,
      department_code = excluded.department_code, sort_order = excluded.sort_order;

create table if not exists public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  rule_code text references public.notification_rules(code) on delete set null,
  department_code text,
  channel text not null default 'whatsapp',
  service_date date,
  title text not null,
  body text not null,
  reference_type text,
  reference_id uuid,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'skipped', 'failed')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_by uuid references public.profiles(id) on delete set null,
  send_note text
);

create index if not exists outbound_messages_status_idx on public.outbound_messages (status, created_at desc);
create index if not exists outbound_messages_ref_idx on public.outbound_messages (reference_type, reference_id);

-- Writes a message only when its rule is switched on, so the toggles in
-- the admin panel really do stop the message being produced at all.
create or replace function public.queue_outbound_message(
  p_rule_code text,
  p_title text,
  p_body text,
  p_service_date date default null,
  p_reference_type text default null,
  p_reference_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_rule public.notification_rules%rowtype;
  v_id uuid;
begin
  select * into v_rule from public.notification_rules where code = p_rule_code;
  if not found or not v_rule.enabled then
    return null;
  end if;

  insert into public.outbound_messages (
    rule_code, department_code, channel, service_date, title, body,
    reference_type, reference_id, created_by
  )
  values (
    p_rule_code, v_rule.department_code, v_rule.channel, p_service_date, p_title, p_body,
    p_reference_type, p_reference_id, auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.set_notification_rule(p_code text, p_enabled boolean)
returns public.notification_rules
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_rule public.notification_rules%rowtype;
begin
  perform public.require_permission('ops.messages.manage');
  update public.notification_rules
  set enabled = p_enabled, updated_by = auth.uid(), updated_at = now()
  where code = p_code
  returning * into v_rule;
  if not found then raise exception 'Unknown notification rule "%".', p_code; end if;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, after_json)
  values (auth.uid(), 'set_notification_rule', 'notification_rule', null,
          jsonb_build_object('rule', p_code, 'enabled', p_enabled));
  return v_rule;
end;
$$;

create or replace function public.mark_outbound_sent(
  p_message_id uuid,
  p_status text default 'sent',
  p_note text default null
)
returns public.outbound_messages
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row public.outbound_messages%rowtype;
begin
  perform public.require_permission('ops.messages.send');
  if p_status not in ('sent', 'skipped', 'failed', 'queued') then
    raise exception 'Unknown message status "%".', p_status;
  end if;

  update public.outbound_messages
  set status = p_status,
      sent_at = case when p_status = 'sent' then now() else null end,
      sent_by = case when p_status = 'sent' then auth.uid() else null end,
      send_note = p_note
  where id = p_message_id
  returning * into v_row;
  if not found then raise exception 'Message not found.'; end if;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------
-- Purchase request RPCs
-- ---------------------------------------------------------------------
create or replace function public.next_request_no(p_date date)
returns text
language sql
volatile
security definer
set search_path = public
as $$
  select 'PR-' || to_char(p_date, 'YYMMDD') || '-' ||
         lpad(((select count(*) from public.purchase_requests where needed_for_date = p_date) + 1)::text, 3, '0')
$$;

create or replace function public.save_purchase_request(
  p_request jsonb,
  p_items jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id uuid := nullif(p_request->>'id', '')::uuid;
  v_date date := (p_request->>'needed_for_date')::date;
  v_row public.purchase_requests%rowtype;
  v_keep uuid[] := array[]::uuid[];
  v_item_id uuid;
  rec record;
begin
  if v_date is null then raise exception 'Say which date the items are needed for.'; end if;

  if v_id is null then
    perform public.require_permission('kitchen.request.create');
    insert into public.purchase_requests (
      request_no, origin, needed_for_date, pax_count, purpose, status, notes, requested_by
    )
    values (
      public.next_request_no(v_date),
      coalesce(nullif(p_request->>'origin', ''), 'kitchen'),
      v_date,
      coalesce((p_request->>'pax_count')::int, 0),
      nullif(p_request->>'purpose', ''),
      'draft',
      nullif(p_request->>'notes', ''),
      auth.uid()
    )
    returning * into v_row;
    v_id := v_row.id;
  else
    select * into v_row from public.purchase_requests where id = v_id;
    if not found then raise exception 'Request not found.'; end if;
    if not (
      public.has_permission('kitchen.manage')
      or (public.has_permission('kitchen.request.create') and v_row.requested_by = auth.uid()
          and v_row.status in ('draft', 'submitted'))
    ) then
      raise exception 'You cannot edit this request.' using errcode = '42501';
    end if;

    update public.purchase_requests set
      needed_for_date = v_date,
      pax_count = coalesce((p_request->>'pax_count')::int, pax_count),
      purpose = nullif(p_request->>'purpose', ''),
      notes = nullif(p_request->>'notes', '')
    where id = v_id;
  end if;

  for rec in
    select value as item, ordinality as ord
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality
  loop
    if coalesce(nullif(trim(rec.item->>'item_name'), ''), '') = '' then continue; end if;
    v_item_id := nullif(rec.item->>'id', '')::uuid;

    if v_item_id is null then
      insert into public.purchase_request_items (request_id, item_name, quantity, unit, note, sort_order)
      values (
        v_id,
        trim(rec.item->>'item_name'),
        coalesce((rec.item->>'quantity')::numeric, 0),
        coalesce(nullif(rec.item->>'unit', ''), 'kg'),
        nullif(rec.item->>'note', ''),
        rec.ord::int
      )
      returning id into v_item_id;
    else
      update public.purchase_request_items i set
        item_name = trim(rec.item->>'item_name'),
        quantity = coalesce((rec.item->>'quantity')::numeric, i.quantity),
        unit = coalesce(nullif(rec.item->>'unit', ''), i.unit),
        note = nullif(rec.item->>'note', ''),
        sort_order = rec.ord::int
      where i.id = v_item_id and i.request_id = v_id;
    end if;

    v_keep := v_keep || v_item_id;
  end loop;

  if array_length(v_keep, 1) is null then
    raise exception 'Add at least one item to the request.';
  end if;

  delete from public.purchase_request_items i
  where i.request_id = v_id and not (i.id = any(v_keep));

  return v_id;
end;
$$;

-- Builds the message text once so the outbox and any future worker send
-- exactly the same thing.
create or replace function public.purchase_request_message(p_request_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.purchase_requests%rowtype;
  v_who text;
  v_lines text := '';
  rec record;
  v_index int := 0;
begin
  select * into v_row from public.purchase_requests where id = p_request_id;
  if not found then return null; end if;

  select coalesce(full_name, 'Kitchen') into v_who from public.profiles where id = v_row.requested_by;

  for rec in
    select item_name, quantity, unit, note
    from public.purchase_request_items
    where request_id = p_request_id
    order by sort_order, item_name
  loop
    v_index := v_index + 1;
    -- FM leaves a trailing '.' on whole numbers, so 12 must not print "12."
    v_lines := v_lines || v_index || '. ' || rec.item_name || ' - ' ||
               trim(trailing '.' from trim(to_char(rec.quantity, 'FM999999990.99'))) || ' ' || rec.unit ||
               coalesce(' (' || nullif(rec.note, '') || ')', '') || E'\n';
  end loop;

  return
    '*THINGS TO PURCHASE*' || E'\n' ||
    'Request: ' || v_row.request_no || E'\n' ||
    'Needed for: ' || to_char(v_row.needed_for_date, 'Dy DD Mon YYYY') || E'\n' ||
    'Pax: ' || v_row.pax_count || E'\n' ||
    coalesce('For: ' || nullif(v_row.purpose, '') || E'\n', '') ||
    E'\n' || v_lines ||
    coalesce(E'\nNote: ' || nullif(v_row.notes, '') || E'\n', '') ||
    E'\nRequested by: ' || v_who;
end;
$$;

create or replace function public.submit_purchase_request(p_request_id uuid)
returns public.purchase_requests
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row public.purchase_requests%rowtype;
begin
  perform public.require_permission('kitchen.request.submit');

  select * into v_row from public.purchase_requests where id = p_request_id;
  if not found then raise exception 'Request not found.'; end if;
  if v_row.status <> 'draft' then raise exception 'This request has already been sent.'; end if;
  if not exists (select 1 from public.purchase_request_items where request_id = p_request_id) then
    raise exception 'Add at least one item before sending.';
  end if;

  update public.purchase_requests
  set status = 'submitted', submitted_at = now()
  where id = p_request_id
  returning * into v_row;

  perform public.queue_outbound_message(
    'kitchen.request_submitted',
    'Kitchen request ' || v_row.request_no,
    public.purchase_request_message(p_request_id),
    v_row.needed_for_date,
    'purchase_request',
    p_request_id
  );

  return v_row;
end;
$$;

create or replace function public.set_purchase_item_status(
  p_item_ids uuid[],
  p_status text,
  p_purchased_quantity numeric default null,
  p_actual_cost numeric default null,
  p_supplier text default null,
  p_note text default null
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
  perform public.require_permission('purchasing.fulfil');
  if p_status not in ('pending', 'bought', 'unavailable') then
    raise exception 'Status must be pending, bought or unavailable.';
  end if;

  update public.purchase_request_items i set
    purchase_status = p_status,
    purchased_quantity = case when p_status = 'pending' then null else coalesce(p_purchased_quantity, i.quantity) end,
    actual_cost = case when p_status = 'pending' then null else coalesce(p_actual_cost, i.actual_cost) end,
    supplier = case when p_status = 'pending' then null else coalesce(p_supplier, i.supplier) end,
    purchase_note = p_note,
    purchased_by = case when p_status = 'pending' then null else auth.uid() end,
    purchased_at = case when p_status = 'pending' then null else now() end
  where i.id = any(p_item_ids);
  get diagnostics v_count = row_count;

  -- A request that has been started is "buying" until every line is settled.
  update public.purchase_requests r
  set status = case
        when not exists (
          select 1 from public.purchase_request_items x
          where x.request_id = r.id and x.purchase_status = 'pending'
        ) then 'completed'
        else 'buying'
      end,
      completed_at = case
        when not exists (
          select 1 from public.purchase_request_items x
          where x.request_id = r.id and x.purchase_status = 'pending'
        ) then now()
        else null
      end
  where r.id in (select request_id from public.purchase_request_items where id = any(p_item_ids))
    and r.status in ('submitted', 'buying', 'completed');

  return v_count;
end;
$$;

create or replace function public.cancel_purchase_request(p_request_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row public.purchase_requests%rowtype;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Say why this request is being cancelled.';
  end if;
  select * into v_row from public.purchase_requests where id = p_request_id;
  if not found then raise exception 'Request not found.'; end if;
  if not (
    public.has_permission('kitchen.manage')
    or public.has_permission('purchasing.manage')
    or (v_row.requested_by = auth.uid() and v_row.status = 'draft')
  ) then
    raise exception 'You cannot cancel this request.' using errcode = '42501';
  end if;

  update public.purchase_requests
  set status = 'cancelled', cancelled_reason = trim(p_reason)
  where id = p_request_id;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, before_json, after_json)
  values (auth.uid(), 'cancel_purchase_request', 'purchase_request', p_request_id,
          to_jsonb(v_row), jsonb_build_object('reason', trim(p_reason)));
end;
$$;

-- ---------------------------------------------------------------------
-- Boat manifest message
-- ---------------------------------------------------------------------
create or replace function public.boat_assignment_message(p_service_date date)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_text text;
  v_boat record;
  v_group record;
  v_person record;
  v_seated int;
  v_unassigned int;
begin
  v_text := '*BOAT ASSIGNMENT*' || E'\n' || to_char(p_service_date, 'Dy DD Mon YYYY') || E'\n';

  for v_boat in
    select a.id, a.departure_time, b.code, b.name, b.capacity_pax,
           cap.full_name as captain, gd.full_name as guide
    from public.boat_assignments a
    join public.boats b on b.id = a.boat_id
    left join public.employees cap on cap.id = a.captain_employee_id
    left join public.employees gd on gd.id = a.guide_employee_id
    where a.service_date = p_service_date and a.status <> 'cancelled'
    order by b.sort_order, b.code
  loop
    select coalesce(sum(bk.pax_total), 0) into v_seated
    from public.trip_bookings tb
    join public.bookings bk on bk.id = tb.booking_id
    where tb.assignment_id = v_boat.id;

    continue when v_seated = 0;

    v_text := v_text || E'\n' || '*' || v_boat.code ||
              coalesce(' (' || v_boat.name || ')', '') || '*' ||
              coalesce(' - ' || to_char(v_boat.departure_time, 'HH24:MI'), '') || E'\n' ||
              'Captain: ' || coalesce(v_boat.captain, 'not set') ||
              '  |  Guide: ' || coalesce(v_boat.guide, 'not set') || E'\n' ||
              'Pax: ' || v_seated || '/' || v_boat.capacity_pax || E'\n';

    for v_group in
      select bk.id, bk.lead_name, bk.pax_total, bk.pickup_hotel_name
      from public.trip_bookings tb
      join public.bookings bk on bk.id = tb.booking_id
      where tb.assignment_id = v_boat.id
      order by bk.lead_name
    loop
      v_text := v_text || '- ' || v_group.lead_name || ' (' || v_group.pax_total || ' pax' ||
                coalesce(', ' || nullif(v_group.pickup_hotel_name, ''), '') || ')' || E'\n';
      for v_person in
        select full_name from public.tourists where booking_id = v_group.id order by sort_order
      loop
        v_text := v_text || '   . ' || v_person.full_name || E'\n';
      end loop;
    end loop;
  end loop;

  select coalesce(sum(bk.pax_total), 0) into v_unassigned
  from public.bookings bk
  where bk.service_date = p_service_date
    and bk.status <> 'cancelled'
    and not exists (select 1 from public.trip_bookings tb where tb.booking_id = bk.id);

  if v_unassigned > 0 then
    v_text := v_text || E'\n' || '*Still without a boat: ' || v_unassigned || ' pax*';
  end if;

  return v_text;
end;
$$;

-- Locking the day is what "assignment completed" means, so that is where
-- the manifest goes out.
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

  if p_locked then
    perform public.queue_outbound_message(
      'fleet.assignment_completed',
      'Boat assignment ' || to_char(p_service_date, 'DD Mon YYYY'),
      public.boat_assignment_message(p_service_date),
      p_service_date,
      'boat_assignment_day',
      null
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.purchase_requests enable row level security;
alter table public.purchase_request_items enable row level security;
alter table public.notification_rules enable row level security;
alter table public.outbound_messages enable row level security;

drop policy if exists "purchase requests read" on public.purchase_requests;
create policy "purchase requests read" on public.purchase_requests
  for select to authenticated
  using (
    public.has_permission('kitchen.request.view')
    or public.has_permission('purchasing.view')
    or requested_by = auth.uid()
  );

drop policy if exists "purchase items read" on public.purchase_request_items;
create policy "purchase items read" on public.purchase_request_items
  for select to authenticated
  using (
    public.has_permission('kitchen.request.view')
    or public.has_permission('purchasing.view')
    or exists (
      select 1 from public.purchase_requests r
      where r.id = purchase_request_items.request_id and r.requested_by = auth.uid()
    )
  );

drop policy if exists "notification rules read" on public.notification_rules;
create policy "notification rules read" on public.notification_rules
  for select to authenticated
  using (public.has_permission('ops.log.view') or public.has_permission('ops.messages.manage'));

drop policy if exists "outbound messages read" on public.outbound_messages;
create policy "outbound messages read" on public.outbound_messages
  for select to authenticated
  using (public.has_permission('ops.messages.send') or public.has_permission('ops.messages.manage'));

-- Every write goes through the security definer RPCs above.

do $$
declare fn text;
begin
  foreach fn in array array[
    'save_purchase_request(jsonb, jsonb)',
    'submit_purchase_request(uuid)',
    'set_purchase_item_status(uuid[], text, numeric, numeric, text, text)',
    'cancel_purchase_request(uuid, text)',
    'purchase_request_message(uuid)',
    'boat_assignment_message(date)',
    'set_notification_rule(text, boolean)',
    'mark_outbound_sent(uuid, text, text)'
  ]
  loop
    execute format('revoke all on function public.%s from anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

revoke all on function public.queue_outbound_message(text, text, text, date, text, uuid) from public, anon, authenticated;
revoke all on function public.next_request_no(date) from public, anon, authenticated;
