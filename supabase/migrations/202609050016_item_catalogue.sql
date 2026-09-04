-- =====================================================================
-- A catalogue of the things that get asked for again and again, so a
-- weekly kitchen order is a few taps instead of a typing exercise.
-- The catalogue teaches itself: anything typed into a request is added,
-- and the more an item is used the higher it sorts.
-- =====================================================================

create table if not exists public.catalogue_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'ingredient' check (kind in ('ingredient', 'equipment')),
  name text not null,
  category text,
  unit text not null default 'kg',
  default_quantity numeric(12,2),
  times_used int not null default 0,
  last_used_at timestamptz,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists catalogue_items_name_key on public.catalogue_items (kind, lower(name));
create index if not exists catalogue_items_rank_idx on public.catalogue_items (kind, times_used desc, name);

drop trigger if exists catalogue_items_touch on public.catalogue_items;
create trigger catalogue_items_touch before update on public.catalogue_items
for each row execute function public.touch_updated_at();

insert into public.catalogue_items (kind, name, category, unit, default_quantity) values
  ('ingredient', 'Chicken breast',   'Meat',      'kg',  10),
  ('ingredient', 'Chicken whole',    'Meat',      'kg',  12),
  ('ingredient', 'Beef slices',      'Meat',      'kg',   6),
  ('ingredient', 'Prawns',           'Seafood',   'kg',   5),
  ('ingredient', 'Squid',            'Seafood',   'kg',   4),
  ('ingredient', 'Fish fillet',      'Seafood',   'kg',   8),
  ('ingredient', 'Jasmine rice',     'Dry goods', 'kg',  20),
  ('ingredient', 'Noodles',          'Dry goods', 'kg',   6),
  ('ingredient', 'Cooking oil',      'Dry goods', 'L',    5),
  ('ingredient', 'Salt',             'Dry goods', 'kg',   1),
  ('ingredient', 'Sugar',            'Dry goods', 'kg',   2),
  ('ingredient', 'Mixed vegetables', 'Fresh',     'kg',   8),
  ('ingredient', 'Onions',           'Fresh',     'kg',   5),
  ('ingredient', 'Garlic',           'Fresh',     'kg',   2),
  ('ingredient', 'Chilli',           'Fresh',     'kg',   2),
  ('ingredient', 'Tomatoes',         'Fresh',     'kg',   4),
  ('ingredient', 'Cucumber',         'Fresh',     'kg',   4),
  ('ingredient', 'Watermelon',       'Fruit',     'kg',  10),
  ('ingredient', 'Pineapple',        'Fruit',     'pcs',  8),
  ('ingredient', 'Eggs',             'Fresh',     'tray', 3),
  ('ingredient', 'Drinking water',   'Drinks',    'box',  6),
  ('ingredient', 'Ice',              'Drinks',    'bag',  6),
  ('ingredient', 'Charcoal',         'Other',     'bag',  4),
  ('ingredient', 'Gas cylinder',     'Other',     'pcs',  1),
  ('equipment', 'Snorkel goggles',   'Snorkel gear', 'pcs', 1),
  ('equipment', 'Snorkel mask',      'Snorkel gear', 'pcs', 1),
  ('equipment', 'Fins',              'Snorkel gear', 'pcs', 1),
  ('equipment', 'Life jacket (adult)', 'Safety gear', 'pcs', 1),
  ('equipment', 'Life jacket (child)', 'Safety gear', 'pcs', 1),
  ('equipment', 'Dry bag',           'Equipment',    'pcs', 1),
  ('equipment', 'Cooler box',        'Equipment',    'pcs', 1),
  ('equipment', 'Staff polo shirt',  'Clothing',     'pcs', 1),
  ('equipment', 'Beach towel',       'Clothing',     'pcs', 1),
  ('equipment', 'First aid kit',     'Safety gear',  'pcs', 1)
on conflict do nothing;

-- Anything typed into a request joins the catalogue, so it is one tap the
-- next time round.
create or replace function public.remember_catalogue_item(
  p_kind text,
  p_name text,
  p_unit text,
  p_quantity numeric default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if coalesce(trim(p_name), '') = '' then return; end if;

  insert into public.catalogue_items (kind, name, unit, default_quantity, times_used, last_used_at, created_by)
  values (p_kind, trim(p_name), coalesce(nullif(p_unit, ''), 'kg'), p_quantity, 1, now(), auth.uid())
  on conflict (kind, lower(name)) do update
    set times_used = public.catalogue_items.times_used + 1,
        last_used_at = now(),
        unit = coalesce(nullif(excluded.unit, ''), public.catalogue_items.unit),
        default_quantity = coalesce(excluded.default_quantity, public.catalogue_items.default_quantity);
end;
$$;

-- Hook it into saving a request.
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

    perform public.remember_catalogue_item(
      'ingredient',
      trim(rec.item->>'item_name'),
      rec.item->>'unit',
      (rec.item->>'quantity')::numeric
    );

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

-- Most menus repeat, so starting from last week's order beats retyping it.
create or replace function public.copy_purchase_request(p_source_id uuid, p_needed_for_date date)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_source public.purchase_requests%rowtype;
  v_id uuid;
begin
  perform public.require_permission('kitchen.request.create');
  select * into v_source from public.purchase_requests where id = p_source_id;
  if not found then raise exception 'Request not found.'; end if;

  insert into public.purchase_requests (
    request_no, origin, needed_for_date, pax_count, purpose, status, notes, requested_by
  )
  values (
    public.next_request_no(p_needed_for_date), v_source.origin, p_needed_for_date,
    v_source.pax_count, v_source.purpose, 'draft', v_source.notes, auth.uid()
  )
  returning id into v_id;

  insert into public.purchase_request_items (request_id, item_name, quantity, unit, note, sort_order)
  select v_id, item_name, quantity, unit, note, sort_order
  from public.purchase_request_items
  where request_id = p_source_id
  order by sort_order;

  return v_id;
end;
$$;

alter table public.catalogue_items enable row level security;

drop policy if exists "catalogue read" on public.catalogue_items;
create policy "catalogue read" on public.catalogue_items
  for select to authenticated
  using (
    public.has_permission('kitchen.request.view')
    or public.has_permission('kitchen.request.create')
    or public.has_permission('purchasing.view')
    or public.has_permission('items.view')
    or public.has_permission('items.report')
  );

drop policy if exists "catalogue write" on public.catalogue_items;
create policy "catalogue write" on public.catalogue_items
  for all to authenticated
  using (public.has_permission('kitchen.manage') or public.has_permission('platform.directory.manage'))
  with check (public.has_permission('kitchen.manage') or public.has_permission('platform.directory.manage'));

revoke all on function public.remember_catalogue_item(text, text, text, numeric) from public, anon, authenticated;
revoke all on function public.copy_purchase_request(uuid, date) from anon;
grant execute on function public.copy_purchase_request(uuid, date) to authenticated;
