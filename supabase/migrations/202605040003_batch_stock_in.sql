create or replace function public.stock_in_products(p_entries jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  entry jsonb;
  result jsonb;
  results jsonb := '[]'::jsonb;
begin
  perform public.require_role(array['manager', 'admin']);

  if jsonb_typeof(p_entries) <> 'array' then
    raise exception 'Stock-in entries must be an array.';
  end if;

  if jsonb_array_length(p_entries) = 0 then
    raise exception 'Add at least one stock-in item.';
  end if;

  for entry in select value from jsonb_array_elements(p_entries)
  loop
    result := public.stock_in_product(
      (entry->>'product_id')::uuid,
      (entry->>'quantity')::int,
      entry->>'unit',
      nullif(entry->>'cost_per_unit', '')::numeric,
      entry->>'supplier',
      entry->>'reference',
      entry->>'notes',
      entry->>'entered_by'
    );
    results := results || jsonb_build_array(result);
  end loop;

  return results;
end;
$$;

revoke execute on function public.stock_in_products(jsonb) from public, anon;
grant execute on function public.stock_in_products(jsonb) to authenticated;
