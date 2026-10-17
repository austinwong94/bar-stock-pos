-- Keep partial orders open; retain immutable per-purchase evidence and receiving records.
-- No quantities or historical costs are rewritten.
create or replace function public.record_purchase_batch_internal(
  p_request_id uuid, p_items jsonb, p_supplier text, p_reference text, p_operation_id uuid
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_request public.purchase_requests%rowtype;
  v_item public.purchase_request_items%rowtype;
  v_previous public.operation_requests%rowtype;
  v_line jsonb;
  v_before jsonb;
  v_record jsonb;
  v_id uuid := gen_random_uuid();
  v_ids uuid[];
  v_supplier text := nullif(trim(p_supplier),'');
  v_reference text := nullif(trim(p_reference),'');
  v_hash text;
begin
  perform public.require_permission('purchasing.fulfil');
  if p_request_id is null or p_operation_id is null then raise exception 'A request and confirmation ID are required.'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'Enter the quantities bought.'; end if;
  if jsonb_array_length(p_items) not between 1 and 250 then raise exception 'Confirm between 1 and 250 items at once.'; end if;
  if length(v_supplier)>160 or length(v_reference)>120 then raise exception 'The supplier or reference is too long.'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) x where
    jsonb_typeof(x)<>'object' or nullif(x->>'id','') is null or nullif(x->>'expected_updated_at','') is null
    or (x->>'quantity') is null or (x->>'quantity')::numeric<=0
    or (x->>'quantity')::numeric::text in ('NaN','Infinity','-Infinity')
    or round((x->>'quantity')::numeric,2)<>(x->>'quantity')::numeric
    or ((x->>'actual_cost') is not null and ((x->>'actual_cost')::numeric<0
      or (x->>'actual_cost')::numeric::text in ('NaN','Infinity','-Infinity')
      or round((x->>'actual_cost')::numeric,2)<>(x->>'actual_cost')::numeric)))
    then raise exception 'Check each bought quantity and cost. Use positive quantities and up to two decimal places.'; end if;
  if not public.has_permission('purchasing.cost.view') and exists(
    select 1 from jsonb_array_elements(p_items) x where x->>'actual_cost' is not null
  ) then raise exception 'You do not have permission to record purchase costs.' using errcode='42501'; end if;
  select array_agg((x->>'id')::uuid) into v_ids from jsonb_array_elements(p_items) x;
  if cardinality(v_ids)<>(select count(distinct id) from unnest(v_ids) id) then
    raise exception 'A purchase item was included more than once.';
  end if;
  v_hash := md5(jsonb_build_object('request',p_request_id,'items',p_items,'supplier',v_supplier,'reference',v_reference)::text);
  perform pg_advisory_xact_lock(73081,1);
  select * into v_previous from public.operation_requests where actor_id=auth.uid()
    and operation='record_purchase_batch' and request_id=p_operation_id;
  if found then
    if v_previous.payload_hash<>v_hash then raise exception 'This confirmation was already used with different details.'; end if;
    select after_json into v_record from public.audit_logs where id=v_previous.result_id;
    if v_record is null then raise exception 'The saved purchase record could not be found.'; end if;
    return public.purchase_batch_visible_record(v_record);
  end if;
  select * into v_request from public.purchase_requests where id=p_request_id for update;
  if not found or v_request.status not in ('submitted','buying','completed') then
    raise exception 'This request is no longer open for purchases. Reopen Purchasing to check its status.' using errcode='40001';
  end if;
  -- Validate the entire list before delegating any line to the existing writer.
  for v_line in select value from jsonb_array_elements(p_items) loop
    select * into v_item from public.purchase_request_items where id=(v_line->>'id')::uuid for update;
    if not found or v_item.request_id<>p_request_id or v_item.purchase_status not in ('pending','bought')
      or v_item.updated_at is distinct from (v_line->>'expected_updated_at')::timestamptz then
      raise exception 'An item changed on another device. No purchases were recorded. Reopen the request and review it again.' using errcode='40001';
    end if;
    if (v_line->>'quantity')::numeric > v_item.quantity-coalesce(v_item.purchased_quantity,0) then raise exception 'Bought quantity exceeds what is still requested. Update the request first.';end if;
  end loop;
  select jsonb_agg(to_jsonb(i) order by sort_order,id) into v_before
    from public.purchase_request_items i where id=any(v_ids);
  for v_line in select value from jsonb_array_elements(p_items) loop
    select * into v_item from public.purchase_request_items where id=(v_line->>'id')::uuid;
    update public.purchase_request_items set purchase_status='bought',
      purchased_quantity=coalesce(v_item.purchased_quantity,0)+(v_line->>'quantity')::numeric,
      actual_cost=case when v_line->>'actual_cost' is null or (v_item.purchased_quantity>0 and v_item.actual_cost is null) then null else coalesce(v_item.actual_cost,0)+(v_line->>'actual_cost')::numeric end,
      supplier=v_supplier,purchased_by=auth.uid(),purchased_at=clock_timestamp(),updated_at=clock_timestamp() where id=v_item.id;
  end loop;
  select jsonb_build_object('id',v_id,'request_id',v_request.id,'request_no',v_request.request_no,
    'supplier',v_supplier,'reference',v_reference,'confirmed_at',now(),'confirmed_by',auth.uid(),
    'confirmed_by_name',(select full_name from public.profiles where id=auth.uid()),
    'items',jsonb_agg(jsonb_build_object('id',i.id,'item_name',i.item_name,'unit',i.unit,
      'requested_quantity',i.quantity,'quantity',(select (x->>'quantity')::numeric from jsonb_array_elements(p_items) x where x->>'id'=i.id::text),'actual_cost',(select (x->>'actual_cost')::numeric from jsonb_array_elements(p_items) x where x->>'id'=i.id::text)) order by i.sort_order,i.id))
    into v_record from public.purchase_request_items i where i.id=any(v_ids);
  insert into public.audit_logs(id,actor_id,action,entity_type,entity_id,before_json,after_json)
    values(v_id,auth.uid(),'record_purchase_batch','purchase_request',p_request_id,v_before,v_record);
  insert into public.operation_requests(actor_id,operation,request_id,payload_hash,result_id)
    values(auth.uid(),'record_purchase_batch',p_operation_id,v_hash,v_id);
  update public.purchase_requests set status=case when exists(select 1 from public.purchase_request_items i where i.request_id=p_request_id and (i.purchase_status<>'bought' or coalesce(i.purchased_quantity,0)<i.quantity)) then 'buying' else 'completed' end,updated_at=clock_timestamp() where id=p_request_id;
  update public.purchase_requests set completed_at=case when status='completed' then clock_timestamp() else null end where id=p_request_id;
  return public.purchase_batch_visible_record(v_record);
end $$;

revoke all on function public.record_purchase_batch_internal(uuid,jsonb,text,text,uuid) from public,anon,authenticated;

do $$declare d text;updated text;begin
  d:=pg_get_functiondef('public.read_purchasing_queue(text,text,integer,integer)'::regprocedure);
  updated:=replace(d,'i.purchase_status=''pending''','(i.purchase_status<>''bought'' or coalesce(i.purchased_quantity,0)<i.quantity)');
  if updated=d then raise exception 'Expected purchasing queue definition not found';end if;
  execute updated;
  if to_regprocedure('public.department_badges(date)') is not null then
    d:=pg_get_functiondef('public.department_badges(date)'::regprocedure);
    execute replace(d,'i.purchase_status=''pending''','(i.purchase_status<>''bought'' or coalesce(i.purchased_quantity,0)<i.quantity)');
  end if;
end $$;

-- A confirmed purchase must not be erased by the quick unavailable/undo buttons.
create function public.protect_recorded_purchase() returns trigger language plpgsql set search_path=public as $$
begin
  if new.purchase_status='bought' and new.purchased_quantity is distinct from old.purchased_quantity and current_setting('app.purchase_evidence',true) is distinct from 'verified' then
    raise exception 'Use the receipt-confirmed purchase form to record additional purchases.';
  end if;
  if old.purchase_status='bought' and coalesce(old.purchased_quantity,0)>0 and
    (new.purchase_status<>'bought' or new.purchased_quantity<old.purchased_quantity or new.purchased_quantity is null)
    then raise exception 'Recorded purchases cannot be cleared. Keep the remaining request open or ask accounts to correct it.';end if;
  return new;
end $$;
create trigger protect_recorded_purchase before update on public.purchase_request_items for each row execute function public.protect_recorded_purchase();

create or replace function public.protect_received_purchase()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from public.purchase_receipts where purchase_item_id=old.id) and
    (tg_op='DELETE' or new.purchase_status is distinct from old.purchase_status
      or new.purchased_quantity is null or new.purchased_quantity<old.purchased_quantity
      or new.unit is distinct from old.unit or new.item_name is distinct from old.item_name)
    then raise exception 'This purchase has received stock. Use an inventory correction with a reason.';end if;
  return case when tg_op='DELETE' then old else new end;
end $$;

insert into public.permissions(code,department_code,name,sensitive) values('kitchen.stock.count','kitchen','Count Kitchen Stock',false) on conflict do nothing;
insert into public.access_role_permissions(role_code,permission_code)
select distinct role_code,'kitchen.stock.count' from public.access_role_permissions where permission_code='kitchen.manage'
on conflict do nothing;

create function public.kitchen_fractional(i public.ingredient_items) returns boolean language sql immutable set search_path=public as $$
select coalesce(i.base_unit='unit' and i.kitchen_key is not null and i.kitchen_factor=1 and i.kitchen_unit in('pack','bag','gelen','tin'),false)
$$;
revoke all on function public.kitchen_fractional(public.ingredient_items) from public,anon;
grant execute on function public.kitchen_fractional(public.ingredient_items) to authenticated;

-- Only container-based units may be fractional. Eggs, bottles and individual pieces stay whole.
do $$declare signature text;d text;begin
  foreach signature in array array['public.save_daily_kitchen_usage(jsonb,timestamptz,uuid)','public.record_kitchen_arrival(jsonb,uuid)','public.record_kitchen_stock_count(jsonb,text,uuid)','public.record_kitchen_stock_out(jsonb,text,text,uuid)','public.record_kitchen_stock_out_checked(jsonb,text,text,uuid)'] loop
    if to_regprocedure(signature) is null then continue;end if;
    d:=pg_get_functiondef(signature::regprocedure);
    d:=replace(d,'i.base_unit=''unit'' and (gq<>trunc(gq) or sq<>trunc(sq))','i.base_unit=''unit'' and not public.kitchen_fractional(i) and (gq<>trunc(gq) or sq<>trunc(sq))');
    d:=replace(d,'i.base_unit=''unit'' and qty<>trunc(qty)','i.base_unit=''unit'' and not public.kitchen_fractional(i) and qty<>trunc(qty)');
    d:=replace(d,'ingredient.base_unit=''unit'' and actual_qty<>trunc(actual_qty)','ingredient.base_unit=''unit'' and not public.kitchen_fractional(ingredient) and actual_qty<>trunc(actual_qty)');
    d:=replace(d,'ingredient.base_unit=''unit'' and amount<>trunc(amount)','ingredient.base_unit=''unit'' and not public.kitchen_fractional(ingredient) and amount<>trunc(amount)');
    if signature like '%stock_count%' then
      d:=replace(d,'''bar.stock.manage''','''kitchen.stock.count''');
      d:=replace(d,'perform public.require_permission(''kitchen.production.manage'');','');
    end if;
    execute d;
  end loop;
end $$;

-- Checkers may inspect the stock ledger, without purchase prices or usage-write access.
do $$declare d text;begin
  d:=pg_get_functiondef('public.read_kitchen_stock()'::regprocedure);
  d:=replace(d,'public.has_permission(''purchasing.receive'')','public.has_permission(''purchasing.receive'') or public.has_permission(''kitchen.stock.count'')');
  execute d;
  d:=pg_get_functiondef('public.read_food_stock_history(date,date,text,text,timestamptz,uuid,integer)'::regprocedure);
  d:=replace(d,'perform public.require_permission(''kitchen.production.manage'');',
    'if not(public.has_permission(''kitchen.production.manage'') or public.has_permission(''purchasing.receive'') or public.has_permission(''kitchen.stock.count'')) then raise exception ''Kitchen access required.'' using errcode=''42501'';end if;');
  execute d;
end $$;

alter table public.purchase_receipts add column display_unit text,add column display_factor numeric;
do $$declare signature text;d text;begin
  foreach signature in array array['public.save_delivery_draft(uuid,uuid,jsonb,integer,uuid)','public.receive_purchase_batch_checked(uuid,jsonb,uuid)','public.receive_purchase_item(uuid,uuid,numeric,numeric,uuid,timestamptz)'] loop
    if to_regprocedure(signature) is null then continue;end if;
    d:=pg_get_functiondef(signature::regprocedure);
    d:=replace(d,'g.base_unit=''unit'' and trunc(qty*size)<>qty*size','g.base_unit=''unit'' and not public.kitchen_fractional(g) and trunc(qty*size)<>qty*size');
    d:=replace(d,'v_ingredient.base_unit=''unit'' and trunc(v_base)<>v_base','v_ingredient.base_unit=''unit'' and not public.kitchen_fractional(v_ingredient) and trunc(v_base)<>v_base');
    d:=replace(d,'v_ingredient.base_unit=''unit'' and v_base<>trunc(v_base)','v_ingredient.base_unit=''unit'' and not public.kitchen_fractional(v_ingredient) and v_base<>trunc(v_base)');
    if signature like '%save_delivery_draft%' then
      d:=replace(d,'''ingredient_name'',g.name','''ingredient_name'',g.name,''display_unit'',g.kitchen_unit,''display_factor'',g.kitchen_factor');
    end if;
    if signature like '%receive_purchase_item%' then
      d:=replace(d,'returning * into v_receipt;','returning * into v_receipt; update public.purchase_receipts set display_unit=v_ingredient.kitchen_unit,display_factor=v_ingredient.kitchen_factor where id=v_receipt.id returning * into v_receipt;');
    end if;
    execute d;
  end loop;
end $$;
