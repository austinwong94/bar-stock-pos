-- Keep the established ledger and retry IDs. Check balance versions as well as quantities.
create function public.record_kitchen_stock_out_checked(p_items jsonb,p_reason text,p_notes text,p_request_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare previous public.operation_requests%rowtype; item jsonb; ingredient public.ingredient_items%rowtype;
  before_version timestamptz; v_payload_hash text:=md5(p_items::text||coalesce(p_reason,'')||coalesce(p_notes,''));
begin
  perform public.require_permission('kitchen.production.manage');
  perform pg_advisory_xact_lock(73081,1);
  if p_request_id is null then raise exception 'A stock-out reference is required.'; end if;
  select * into previous from public.operation_requests where actor_id=auth.uid() and operation='kitchen_stock_out' and request_id=p_request_id;
  if found then
    if previous.payload_hash is distinct from v_payload_hash then raise exception 'This stock-out already succeeded with different details. Check stock history.'; end if;
    return previous.result_id;
  end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 200 then raise exception 'Choose between 1 and 200 food items.'; end if;
  for item in select j from jsonb_array_elements(p_items) j order by j->>'ingredient_id' loop
    select * into ingredient from public.ingredient_items where id=(item->>'ingredient_id')::uuid and active and category in ('Food','Seafood','Condiment') for update;
    if not found then raise exception 'A food item is unavailable. Refresh and review.'; end if;
    select updated_at into before_version from public.ingredient_balances where ingredient_id=ingredient.id for update;
    if not (item ? 'expected_version') or before_version is distinct from (item->>'expected_version')::timestamptz then
      raise exception 'Stock changed for %. Clear its quantity and review again.',ingredient.name;
    end if;
  end loop;
  return public.record_kitchen_stock_out(p_items,p_reason,p_notes,p_request_id);
end; $$;
revoke all on function public.record_kitchen_stock_out_checked(jsonb,text,text,uuid) from public,anon;
grant execute on function public.record_kitchen_stock_out_checked(jsonb,text,text,uuid) to authenticated;
