create table if not exists public.stock_in_drafts (
  id uuid primary key default gen_random_uuid(),
  draft_number text unique not null,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'cancelled')),
  entered_by text,
  supplier text,
  reference text,
  notes text,
  entries jsonb not null,
  total_units int not null default 0 check (total_units >= 0),
  created_by uuid references auth.users(id),
  confirmed_by uuid references auth.users(id),
  cancelled_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text
);

alter table public.stock_in_drafts enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'stock_in_drafts'
      and policyname = 'stock in drafts manager read'
  ) then
    create policy "stock in drafts manager read"
    on public.stock_in_drafts
    for select to authenticated
    using (public.current_user_role() in ('manager', 'admin'));
  end if;
end $$;

create or replace function public.create_stock_in_draft(
  p_entries jsonb,
  p_entered_by text default null,
  p_supplier text default null,
  p_reference text default null,
  p_notes text default null
)
returns public.stock_in_drafts
language plpgsql
security definer
set search_path = public
as $$
declare
  entry jsonb;
  product_record public.products%rowtype;
  entry_quantity int;
  entry_unit text;
  entry_cost numeric;
  entry_cans int;
  normalized_entries jsonb := '[]'::jsonb;
  total_cans int := 0;
  draft_record public.stock_in_drafts%rowtype;
  next_number text;
begin
  perform public.require_role(array['manager', 'admin']);

  if jsonb_typeof(p_entries) <> 'array' then
    raise exception 'Stock In entries must be an array.';
  end if;

  if jsonb_array_length(p_entries) = 0 then
    raise exception 'Enter at least one Stock In item.';
  end if;

  for entry in select value from jsonb_array_elements(p_entries)
  loop
    entry_quantity := nullif(entry->>'quantity', '')::int;
    entry_unit := entry->>'unit';
    entry_cost := nullif(entry->>'cost_per_unit', '')::numeric;

    if entry_quantity is null or entry_quantity <= 0 then
      raise exception 'Quantity must be positive.';
    end if;

    if entry_unit not in ('can', 'carton') then
      raise exception 'Unit must be UNIT(S) or CARTON(S).';
    end if;

    if entry_cost is not null and entry_cost < 0 then
      raise exception 'Cost cannot be negative.';
    end if;

    select * into product_record
    from public.products
    where id = (entry->>'product_id')::uuid;

    if not found then
      raise exception 'Product not found.';
    end if;

    entry_cans := entry_quantity * case when entry_unit = 'carton' then product_record.carton_size else 1 end;
    total_cans := total_cans + entry_cans;
    normalized_entries := normalized_entries || jsonb_build_array(jsonb_build_object(
      'product_id', product_record.id,
      'product_name', product_record.name,
      'quantity', entry_quantity,
      'unit', entry_unit,
      'carton_size', product_record.carton_size,
      'cans', entry_cans,
      'cost_per_unit', entry_cost
    ));
  end loop;

  next_number := 'SI-DRAFT-' || to_char(now() at time zone 'Asia/Kuala_Lumpur', 'YYYYMMDD-HH24MISS') || '-' || upper(substr(gen_random_uuid()::text, 1, 4));

  insert into public.stock_in_drafts (
    draft_number, status, entered_by, supplier, reference, notes, entries, total_units, created_by
  )
  values (
    next_number, 'draft', nullif(p_entered_by, ''), nullif(p_supplier, ''), nullif(p_reference, ''), nullif(p_notes, ''), normalized_entries, total_cans, auth.uid()
  )
  returning * into draft_record;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, after_json)
  values (auth.uid(), 'stock_in_draft_created', 'stock_in_draft', draft_record.id, to_jsonb(draft_record));

  return draft_record;
end;
$$;

create or replace function public.confirm_stock_in_draft(p_draft_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  draft_record public.stock_in_drafts%rowtype;
  confirmed_draft public.stock_in_drafts%rowtype;
  entry jsonb;
  result jsonb;
  results jsonb := '[]'::jsonb;
begin
  perform public.require_role(array['manager', 'admin']);

  select * into draft_record
  from public.stock_in_drafts
  where id = p_draft_id
  for update;

  if not found then
    raise exception 'Stock In draft not found.';
  end if;

  if draft_record.status <> 'draft' then
    raise exception 'Stock In draft is already %.', draft_record.status;
  end if;

  for entry in select value from jsonb_array_elements(draft_record.entries)
  loop
    result := public.stock_in_product(
      (entry->>'product_id')::uuid,
      (entry->>'quantity')::int,
      entry->>'unit',
      nullif(entry->>'cost_per_unit', '')::numeric,
      draft_record.supplier,
      nullif(concat_ws(' / ', draft_record.reference, draft_record.draft_number), ''),
      draft_record.notes,
      draft_record.entered_by
    );
    results := results || jsonb_build_array(result);
  end loop;

  update public.stock_in_drafts
  set status = 'confirmed',
      confirmed_by = auth.uid(),
      confirmed_at = now()
  where id = p_draft_id
  returning * into confirmed_draft;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, before_json, after_json)
  values (auth.uid(), 'stock_in_draft_confirmed', 'stock_in_draft', p_draft_id, to_jsonb(draft_record), to_jsonb(confirmed_draft));

  return jsonb_build_object('draft', to_jsonb(confirmed_draft), 'results', results);
end;
$$;

create or replace function public.cancel_stock_in_draft(
  p_draft_id uuid,
  p_reason text
)
returns public.stock_in_drafts
language plpgsql
security definer
set search_path = public
as $$
declare
  draft_record public.stock_in_drafts%rowtype;
  cancelled_draft public.stock_in_drafts%rowtype;
begin
  perform public.require_role(array['manager', 'admin']);

  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Cancellation reason is required.';
  end if;

  select * into draft_record
  from public.stock_in_drafts
  where id = p_draft_id
  for update;

  if not found then
    raise exception 'Stock In draft not found.';
  end if;

  if draft_record.status <> 'draft' then
    raise exception 'Only draft Stock In records can be cancelled.';
  end if;

  update public.stock_in_drafts
  set status = 'cancelled',
      cancelled_by = auth.uid(),
      cancelled_at = now(),
      cancel_reason = trim(p_reason)
  where id = p_draft_id
  returning * into cancelled_draft;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, before_json, after_json)
  values (auth.uid(), 'stock_in_draft_cancelled', 'stock_in_draft', p_draft_id, to_jsonb(draft_record), to_jsonb(cancelled_draft));

  return cancelled_draft;
end;
$$;

grant select on public.stock_in_drafts to authenticated;
revoke execute on function public.create_stock_in_draft(jsonb, text, text, text, text) from public, anon;
revoke execute on function public.confirm_stock_in_draft(uuid) from public, anon;
revoke execute on function public.cancel_stock_in_draft(uuid, text) from public, anon;
grant execute on function public.create_stock_in_draft(jsonb, text, text, text, text) to authenticated;
grant execute on function public.confirm_stock_in_draft(uuid) to authenticated;
grant execute on function public.cancel_stock_in_draft(uuid, text) to authenticated;
