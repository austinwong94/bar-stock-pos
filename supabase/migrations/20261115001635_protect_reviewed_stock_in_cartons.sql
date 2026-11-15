create or replace function public.confirm_stock_in_draft(p_draft_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  draft public.stock_in_drafts%rowtype;
  product public.products%rowtype;
  entry jsonb;
  expected_units numeric;
  total_units numeric := 0;
begin
  perform public.require_permission('bar.stock.manage');
  perform pg_advisory_xact_lock(77312, 1);
  perform public.require_permission('bar.stock.manage');
  select * into draft from public.stock_in_drafts where id = p_draft_id for update;
  if not found then raise exception 'Stock In draft not found.'; end if;
  -- A committed retry must not reinterpret the original stock after a later product edit.
  if draft.status = 'confirmed' then
    return jsonb_build_object('draft', to_jsonb(draft), 'results', '[]'::jsonb);
  end if;
  if draft.status <> 'draft' then raise exception 'This Stock In draft is no longer awaiting confirmation.'; end if;
  if jsonb_typeof(draft.entries) is distinct from 'array' or jsonb_array_length(draft.entries) = 0 then
    raise exception 'This Stock In draft has no valid entries. Ask the owner to check it.';
  end if;

  -- Lock products before balances, in stable order, including products whose cost is updated.
  perform 1 from public.products
  where id in (select (value->>'product_id')::uuid from jsonb_array_elements(draft.entries))
  order by id for update;
  perform public.require_permission('bar.stock.manage');
  for entry in select value from jsonb_array_elements(draft.entries) loop
    select * into product from public.products where id = (entry->>'product_id')::uuid;
    if not found or not product.active
      or product.name is distinct from entry->>'product_name'
      or product.carton_size is distinct from (entry->>'carton_size')::int then
      raise exception using errcode = '40001',
        message = 'Product setup changed. No stock was added. Cancel this draft and re-enter the actual quantity using the latest product setup.';
    end if;
    if entry->>'unit' is null or entry->>'unit' not in ('can', 'carton')
      or coalesce(entry->>'quantity', '') !~ '^[0-9]+$' or (entry->>'quantity')::numeric <= 0 then
      raise exception 'This Stock In draft has invalid units or quantities. Ask the owner to check it.';
    end if;
    expected_units := (entry->>'quantity')::numeric * case when entry->>'unit' = 'carton' then product.carton_size else 1 end;
    if expected_units is distinct from (entry->>'cans')::numeric then
      raise exception 'This Stock In draft has inconsistent quantities. Ask the owner to check it.';
    end if;
    total_units := total_units + expected_units;
  end loop;
  if total_units is distinct from draft.total_units::numeric then
    raise exception 'This Stock In draft has an inconsistent total. Ask the owner to check it.';
  end if;
  return public.confirm_stock_in_draft_internal(p_draft_id);
end;
$$;
revoke all on function public.confirm_stock_in_draft(uuid) from public, anon;
grant execute on function public.confirm_stock_in_draft(uuid) to authenticated;
revoke all on function public.confirm_stock_in_draft_internal(uuid) from public, anon, authenticated;
