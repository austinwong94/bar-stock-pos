-- Absolute physical counts use the existing ledger and stock-management permission.
create or replace function public.read_kitchen_stock() returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  perform public.require_permission('kitchen.production.manage');
  return jsonb_build_object(
    'items',(select coalesce(jsonb_agg((to_jsonb(i)-'cost_per_base_unit')||jsonb_build_object('balance_version',b.updated_at,'ingredient_balances',jsonb_build_object('quantity_on_hand',coalesce(b.quantity_on_hand,0))) order by i.category,i.name),'[]') from public.ingredient_items i left join public.ingredient_balances b on b.ingredient_id=i.id where i.category in ('Food','Seafood','Condiment')),
    'movements',(select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at desc),'[]') from (
      select im.*,jsonb_build_object('name',i.name,'base_unit',i.base_unit) as ingredient_items from public.ingredient_movements im join public.ingredient_items i on i.id=im.ingredient_id where i.category in ('Food','Seafood','Condiment') order by im.created_at desc limit 200
    ) m)
  );
end; $$;

create function public.record_kitchen_stock_count(p_items jsonb,p_notes text,p_request_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare previous public.operation_requests%rowtype; item jsonb; ingredient public.ingredient_items%rowtype;
  before_qty numeric; actual_qty numeric; before_version timestamptz; staff text;
  v_payload_hash text:=md5(coalesce(p_items::text,'')||coalesce(p_notes,''));
begin
  perform public.require_permission('kitchen.production.manage');
  perform public.require_permission('bar.stock.manage');
  if p_request_id is null then raise exception 'A count reference is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('kitchen_stock_count:'||auth.uid()::text||':'||p_request_id::text,0));
  select * into previous from public.operation_requests where actor_id=auth.uid() and operation='kitchen_stock_count' and request_id=p_request_id;
  if found then
    if previous.payload_hash<>v_payload_hash then raise exception 'This count already succeeded with different details. Check stock history.'; end if;
    return previous.result_id;
  end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 200 then raise exception 'Count between 1 and 200 food items.'; end if;
  if length(coalesce(p_notes,''))>2000 then raise exception 'Keep count notes within 2000 characters.'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) j group by j->>'ingredient_id' having count(*)>1) then raise exception 'A food item appears twice.'; end if;
  select full_name into staff from public.profiles where id=auth.uid();
  for item in select j from jsonb_array_elements(p_items) j order by j->>'ingredient_id' loop
    select * into ingredient from public.ingredient_items where id=(item->>'ingredient_id')::uuid and active and category in ('Food','Seafood','Condiment') for update;
    if not found then raise exception 'A food item is unavailable. Refresh and recount.'; end if;
    if ingredient.base_unit is distinct from item->>'expected_base_unit' then raise exception 'The stock unit changed. Refresh and recount %.',ingredient.name; end if;
    actual_qty:=(item->>'counted_quantity')::numeric;
    if actual_qty is null or actual_qty<0 or actual_qty>1000000000 or actual_qty::text in ('NaN','Infinity','-Infinity') or actual_qty<>round(actual_qty,2) or (ingredient.base_unit='unit' and actual_qty<>trunc(actual_qty)) then raise exception 'Enter a valid physical count in the displayed unit.'; end if;
    select quantity_on_hand,updated_at into before_qty,before_version from public.ingredient_balances where ingredient_id=ingredient.id for update;
    before_qty:=coalesce(before_qty,0);
    if not (item ? 'expected_version') or before_qty is distinct from (item->>'expected_balance')::numeric or before_version is distinct from (item->>'expected_version')::timestamptz then
      raise exception 'Stock changed after counting %. Refresh and recount this item.',ingredient.name;
    end if;
    insert into public.ingredient_balances(ingredient_id,quantity_on_hand,updated_at) values(ingredient.id,actual_qty,clock_timestamp())
    on conflict(ingredient_id) do update set quantity_on_hand=excluded.quantity_on_hand,updated_at=excluded.updated_at;
    insert into public.ingredient_movements(ingredient_id,movement_type,quantity_change,quantity_before,quantity_after,unit_input,input_quantity,reference_type,reference_id,reason,notes,entered_by,created_by)
    values(ingredient.id,'count',actual_qty-before_qty,before_qty,actual_qty,ingredient.base_unit,actual_qty,'kitchen_stock_count',p_request_id,'Physical Stock Count',nullif(trim(p_notes),''),staff,auth.uid());
  end loop;
  insert into public.operation_requests(actor_id,operation,request_id,payload_hash,result_id) values(auth.uid(),'kitchen_stock_count',p_request_id,v_payload_hash,p_request_id);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_json) values(auth.uid(),'kitchen_stock_count','ingredient_movement',p_request_id,jsonb_build_object('items',p_items,'notes',p_notes,'counted_by',staff));
  return p_request_id;
end; $$;
revoke all on function public.read_kitchen_stock(),public.record_kitchen_stock_count(jsonb,text,uuid) from public,anon;
grant execute on function public.read_kitchen_stock(),public.record_kitchen_stock_count(jsonb,text,uuid) to authenticated;
