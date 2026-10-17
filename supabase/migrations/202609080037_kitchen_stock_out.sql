-- Reuse the ingredient ledger. Meal preparation must never be deducted twice.
create function public.read_kitchen_stock() returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  perform public.require_permission('kitchen.production.manage');
  return jsonb_build_object(
    'items',(select coalesce(jsonb_agg((to_jsonb(i)-'cost_per_base_unit')||jsonb_build_object('ingredient_balances',jsonb_build_object('quantity_on_hand',coalesce(b.quantity_on_hand,0))) order by i.category,i.name),'[]') from public.ingredient_items i left join public.ingredient_balances b on b.ingredient_id=i.id where i.category in ('Food','Seafood','Condiment')),
    'movements',(select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at desc),'[]') from (
      select im.*,jsonb_build_object('name',i.name,'base_unit',i.base_unit) as ingredient_items from public.ingredient_movements im join public.ingredient_items i on i.id=im.ingredient_id where i.category in ('Food','Seafood','Condiment') order by im.created_at desc limit 200
    ) m)
  );
end; $$;

create function public.record_kitchen_stock_out(p_items jsonb,p_reason text,p_notes text,p_request_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare previous public.operation_requests%rowtype; item jsonb; ingredient public.ingredient_items%rowtype;
  before_qty numeric; amount numeric; after_qty numeric; staff text;
  hash text:=md5(p_items::text||coalesce(p_reason,'')||coalesce(p_notes,''));
begin
  perform public.require_permission('kitchen.production.manage');
  perform pg_advisory_xact_lock(73081,1);
  if p_request_id is null then raise exception 'A stock-out reference is required.'; end if;
  select * into previous from public.operation_requests where actor_id=auth.uid() and operation='kitchen_stock_out' and request_id=p_request_id;
  if found then
    if previous.payload_hash<>hash then raise exception 'This stock-out already succeeded with different details. Reload the records.'; end if;
    return previous.result_id;
  end if;
  if p_reason is null or p_reason not in ('Spoilage','Wastage','Missing','Other Use') then raise exception 'Choose a stock-out reason.'; end if;
  if nullif(trim(p_notes),'') is null or length(p_notes)>2000 then raise exception 'Enter a short explanation for this stock-out.'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 200 then raise exception 'Choose between 1 and 200 food items.'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) j group by j->>'ingredient_id' having count(*)>1) then raise exception 'A food item appears twice.'; end if;
  select full_name into staff from public.profiles where id=auth.uid();
  for item in select j from jsonb_array_elements(p_items) j order by j->>'ingredient_id' loop
    select * into ingredient from public.ingredient_items where id=(item->>'ingredient_id')::uuid and active and category in ('Food','Seafood','Condiment') for update;
    if not found then raise exception 'A food item is unavailable. Refresh the stock list.'; end if;
    if ingredient.base_unit is distinct from item->>'expected_base_unit' then raise exception 'The inventory unit changed. Refresh and review the quantities.'; end if;
    amount:=(item->>'quantity')::numeric;
    if amount is null or amount<=0 or amount::text in ('NaN','Infinity','-Infinity') or amount<>round(amount,2) or (ingredient.base_unit='unit' and amount<>trunc(amount)) then raise exception 'Enter a positive quantity in the displayed unit.'; end if;
    insert into public.ingredient_balances(ingredient_id,quantity_on_hand) values(ingredient.id,0) on conflict do nothing;
    select quantity_on_hand into before_qty from public.ingredient_balances where ingredient_id=ingredient.id for update;
    if before_qty is distinct from (item->>'expected_balance')::numeric then raise exception 'Food stock changed on another device. Refresh and review the quantities.'; end if;
    after_qty:=before_qty-amount;
    if after_qty<0 then raise exception 'Insufficient food stock for %.',ingredient.name; end if;
    update public.ingredient_balances set quantity_on_hand=after_qty,updated_at=now() where ingredient_id=ingredient.id;
    insert into public.ingredient_movements(ingredient_id,movement_type,quantity_change,quantity_before,quantity_after,unit_input,input_quantity,reference_type,reference_id,reason,notes,entered_by,created_by)
    values(ingredient.id,case when p_reason='Other Use' then 'adjustment' else 'waste' end,-amount,before_qty,after_qty,ingredient.base_unit,amount,'kitchen_stock_out',p_request_id,p_reason,trim(p_notes),staff,auth.uid());
  end loop;
  insert into public.operation_requests(actor_id,operation,request_id,payload_hash,result_id) values(auth.uid(),'kitchen_stock_out',p_request_id,hash,p_request_id);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_json) values(auth.uid(),'kitchen_stock_out','ingredient_movement',p_request_id,jsonb_build_object('items',p_items,'reason',p_reason,'notes',p_notes));
  return p_request_id;
end; $$;
revoke all on function public.read_kitchen_stock(),public.record_kitchen_stock_out(jsonb,text,text,uuid) from public,anon;
grant execute on function public.read_kitchen_stock(),public.record_kitchen_stock_out(jsonb,text,text,uuid) to authenticated;
