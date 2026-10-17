begin;

delete from public.access_role_permissions where role_code='purchaser' and permission_code='purchasing.receive';

alter table public.purchase_receipts add column measured_pieces numeric;
alter table public.purchase_receipts add constraint purchase_receipt_measured_pieces check (
  measured_pieces is null or (base_unit='unit' and measured_pieces>0 and measured_pieces<1e12
    and measured_pieces=trunc(measured_pieces) and measured_pieces=base_quantity));

-- Weight and counted stock are two measurements, never an average conversion.
create function public.delivery_stock_measurement(p_unit text,p_base_unit text,p_quantity numeric,p_size numeric,p_pieces numeric,p_fractional boolean,p_decimals integer)
returns jsonb language plpgsql immutable set search_path=public,pg_temp as $$
declare u text:=lower(trim(p_unit));base numeric;fixed_unit text;fixed_size numeric;
begin
  if p_quantity is null or p_quantity<=0 or p_quantity::text in('NaN','Infinity','-Infinity') or p_quantity<>round(p_quantity,p_decimals)
    then raise exception 'Check the actual delivered quantity.';end if;
  if u in('kg','g') and p_base_unit='unit' then
    if p_size is not null or p_pieces is null or p_pieces<=0 or p_pieces>=1e12 or p_pieces::text in('NaN','Infinity','-Infinity') or p_pieces<>trunc(p_pieces)
      then raise exception 'Count and enter the actual pieces received. Do not use an estimated weight conversion.';end if;
    return jsonb_build_object('base_quantity',p_pieces,'base_per_unit',null,'measured_pieces',p_pieces);
  end if;
  if p_pieces is not null then raise exception 'A measured piece count is only for weight purchased and pieces received.';end if;
  if p_size is null or p_size<=0 or p_size::text in('NaN','Infinity','-Infinity') or p_size<>round(p_size,4) then raise exception 'Check the actual pack size.';end if;
  fixed_unit:=case u when 'kg' then 'g' when 'g' then 'g' when 'l' then 'ml' when 'ml' then 'ml' when 'pc' then 'unit' when 'pcs' then 'unit' when 'unit' then 'unit' when 'units' then 'unit' when 'biji' then 'unit' when 'ekor' then 'unit' end;
  fixed_size:=case u when 'kg' then 1000 when 'l' then 1000 else 1 end;
  if fixed_unit is not null and (p_base_unit<>fixed_unit or p_size<>fixed_size) then raise exception 'The inventory unit does not match the purchase unit.';end if;
  base:=p_quantity*p_size;
  if base<=0 or base>=1e12 or base<>round(base,2) or (p_base_unit='unit' and not p_fractional and base<>trunc(base)) then raise exception 'Check the exact stock quantity.';end if;
  return jsonb_build_object('base_quantity',base,'base_per_unit',p_size);
end $$;
revoke all on function public.delivery_stock_measurement(text,text,numeric,numeric,numeric,boolean,integer) from public,anon,authenticated;

create function public.request_delivery_validate(p_request_id uuid,p_items jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.purchase_requests%rowtype;i public.purchase_request_items%rowtype;g public.ingredient_items%rowtype;
  l jsonb;m jsonb;received numeric;qty numeric;saved jsonb:='[]';
begin
  select * into q from public.purchase_requests where id=p_request_id for update;
  if not found or q.status not in('submitted','buying','completed') then raise exception 'This request is not open for receiving.' using errcode='40001';end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 250 then raise exception 'Review between 1 and 250 delivery items.';end if;
  if (select count(distinct value->>'item_id') from jsonb_array_elements(p_items))<>jsonb_array_length(p_items) then raise exception 'Receive each purchase item once.';end if;
  for l in select value from jsonb_array_elements(p_items) order by value->>'ingredient_id',value->>'item_id' loop
    select * into i from public.purchase_request_items where id=(l->>'item_id')::uuid for update;
    if not found or i.request_id<>p_request_id or i.purchase_status<>'bought' or i.updated_at is distinct from (l->>'expected_updated_at')::timestamptz
      then raise exception 'A purchase changed. Reopen the delivery.' using errcode='40001';end if;
    select coalesce(sum(purchase_quantity),0) into received from public.purchase_receipts where purchase_item_id=i.id;
    if received is distinct from (l->>'expected_received_quantity')::numeric then raise exception 'Another delivery was recorded. Reopen the remaining quantities.' using errcode='40001';end if;
    select * into g from public.ingredient_items where id=(l->>'ingredient_id')::uuid and active for update;
    if not found or g.base_unit is distinct from l->>'expected_base_unit' or (l ? 'ingredient_version' and g.updated_at is distinct from (l->>'ingredient_version')::timestamptz)
      then raise exception 'The inventory item changed. Reopen the delivery.' using errcode='40001';end if;
    qty:=(l->>'quantity')::numeric;
    m:=public.delivery_stock_measurement(i.unit,g.base_unit,qty,(l->>'base_per_unit')::numeric,(l->>'measured_pieces')::numeric,public.kitchen_fractional(g),2);
    if i.purchased_quantity is null or qty+received>i.purchased_quantity then raise exception 'Quantity exceeds what is still outstanding.';end if;
    saved:=saved||jsonb_build_array(m||jsonb_build_object('item_id',i.id,'ingredient_id',g.id,'quantity',qty,
      'expected_updated_at',i.updated_at,'expected_received_quantity',received,'expected_base_unit',g.base_unit,'ingredient_version',g.updated_at,
      'purchase_name',i.item_name,'purchase_unit',i.unit,'ingredient_name',coalesce(g.kitchen_label,g.name),
      'display_unit',coalesce(g.kitchen_unit,case when g.base_unit='g' then 'kg' when g.base_unit='unit' then 'pcs' else g.base_unit end),
      'display_factor',case when g.kitchen_key is not null then g.kitchen_factor when g.base_unit='g' then 1000 else 1 end));
  end loop;
  return saved;
end $$;
revoke all on function public.request_delivery_validate(uuid,jsonb) from public,anon,authenticated;

create or replace function public.save_delivery_draft(p_id uuid,p_request_id uuid,p_items jsonb,p_expected_version integer,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.delivery_drafts%rowtype;old public.delivery_drafts%rowtype;previous public.operation_requests%rowtype;
  h text:=md5(jsonb_build_object('id',p_id,'request',p_request_id,'items',p_items,'version',p_expected_version)::text);items jsonb;a uuid;who text;result jsonb;
begin
  perform public.require_permission('purchasing.receive');perform pg_advisory_xact_lock(73081,1);
  if p_id is null or p_request_id is null or p_operation_id is null or p_expected_version is null or p_expected_version<0 then raise exception 'Reopen the delivery before saving.';end if;
  select * into previous from public.operation_requests where actor_id=auth.uid() and operation='save_delivery_draft' and request_id=p_operation_id;
  if found then
    if previous.payload_hash<>h then raise exception 'This draft save was already used for different details.' using errcode='LP001';end if;
    return(select after_json from public.audit_logs where id=previous.result_id);
  end if;
  select * into old from public.delivery_drafts where id=p_id for update;
  if (old.id is null and p_expected_version<>0) or (old.id is not null and (old.request_id<>p_request_id or old.status<>'draft' or old.version<>p_expected_version))
    then raise exception 'This draft changed on another device. Reopen it.' using errcode='40001';end if;
  items:=public.request_delivery_validate(p_request_id,p_items);
  select nullif(trim(full_name),'') into who from public.profiles where id=auth.uid();if who is null then raise exception 'Your profile needs a staff name.';end if;
  insert into public.delivery_drafts(id,request_id,request_no,items,created_by,created_by_name,updated_by,updated_by_name)
    values(p_id,p_request_id,(select request_no from public.purchase_requests where id=p_request_id),items,auth.uid(),who,auth.uid(),who)
    on conflict(id) do update set items=excluded.items,version=delivery_drafts.version+1,updated_by=auth.uid(),updated_by_name=who,updated_at=clock_timestamp() returning * into d;
  result:=to_jsonb(d);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_json,after_json)
    values(auth.uid(),'delivery_draft_saved','delivery_draft',p_id,case when old.id is not null then to_jsonb(old) end,result) returning id into a;
  insert into public.operation_requests(actor_id,operation,request_id,payload_hash,result_id) values(auth.uid(),'save_delivery_draft',p_operation_id,h,a);
  return result;
end $$;

create or replace function public.receive_purchase_batch_checked(p_request_id uuid,p_items jsonb,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare previous public.operation_requests%rowtype;receipt public.purchase_receipts%rowtype;i public.purchase_request_items%rowtype;
  h text:=md5(jsonb_build_object('request',p_request_id,'items',p_items)::text);items jsonb;l jsonb;base numeric;before_qty numeric;
  receipts jsonb:='[]';result jsonb;id uuid:=gen_random_uuid();who text;
begin
  perform public.require_permission('purchasing.receive');perform pg_advisory_xact_lock(73081,1);
  if p_request_id is null or p_operation_id is null then raise exception 'A request and confirmation ID are required.';end if;
  select * into previous from public.operation_requests where actor_id=auth.uid() and operation='receive_purchase_batch' and request_id=p_operation_id;
  if found then
    if previous.payload_hash<>h then raise exception 'This delivery was already confirmed with different details.' using errcode='LP001';end if;
    return(select after_json from public.audit_logs where audit_logs.id=previous.result_id);
  end if;
  items:=public.request_delivery_validate(p_request_id,p_items);
  select nullif(trim(full_name),'') into who from public.profiles where profiles.id=auth.uid();if who is null then raise exception 'Your profile needs a staff name.';end if;
  for l in select value from jsonb_array_elements(items) loop
    if l->>'measured_pieces' is null then
      receipt:=public.receive_purchase_item((l->>'item_id')::uuid,(l->>'ingredient_id')::uuid,(l->>'quantity')::numeric,(l->>'base_per_unit')::numeric,gen_random_uuid(),(l->>'expected_updated_at')::timestamptz);
    else
      base:=(l->>'base_quantity')::numeric;
      select * into i from public.purchase_request_items where purchase_request_items.id=(l->>'item_id')::uuid;
      insert into public.ingredient_balances(ingredient_id,quantity_on_hand) values((l->>'ingredient_id')::uuid,0) on conflict(ingredient_id) do nothing;
      select quantity_on_hand into before_qty from public.ingredient_balances where ingredient_id=(l->>'ingredient_id')::uuid for update;
      insert into public.purchase_receipts(purchase_item_id,ingredient_id,request_id,purchase_quantity,base_quantity,base_unit,received_by,base_per_unit,measured_pieces)
        values(i.id,(l->>'ingredient_id')::uuid,gen_random_uuid(),(l->>'quantity')::numeric,base,'unit',auth.uid(),null,base) returning * into receipt;
      update public.ingredient_balances set quantity_on_hand=before_qty+base,updated_at=clock_timestamp() where ingredient_id=(l->>'ingredient_id')::uuid;
      insert into public.ingredient_movements(ingredient_id,movement_type,quantity_change,quantity_before,quantity_after,unit_input,input_quantity,reference_type,reference_id,reason,entered_by,created_by)
        values((l->>'ingredient_id')::uuid,'stock_in',base,before_qty,before_qty+base,i.unit,(l->>'quantity')::numeric,'purchase_receipt',receipt.id,i.supplier,who,auth.uid());
      insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_json) values(auth.uid(),'receive_purchase_item','purchase_receipt',receipt.id,to_jsonb(receipt));
    end if;
    receipts:=receipts||jsonb_build_array(to_jsonb(receipt));
  end loop;
  result:=jsonb_build_object('id',id,'request_id',p_request_id,'request_no',(select request_no from public.purchase_requests where purchase_requests.id=p_request_id),
    'confirmed_at',clock_timestamp(),'confirmed_by',auth.uid(),'confirmed_by_name',who,'receipts',receipts);
  insert into public.audit_logs(id,actor_id,action,entity_type,entity_id,after_json) values(id,auth.uid(),'receive_purchase_batch','purchase_request',p_request_id,result);
  insert into public.operation_requests(actor_id,operation,request_id,payload_hash,result_id) values(auth.uid(),'receive_purchase_batch',p_operation_id,h,id);
  return result;
end $$;

create or replace function public.receipt_delivery_validate(p_id uuid,p_items jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb;l jsonb;p jsonb;i public.ingredient_items%rowtype;qty numeric;received numeric;m jsonb;result jsonb:='[]';
begin
  perform 1 from public.expense_receipts where id=p_id and status='confirmed' for update;
  if not found then raise exception 'This purchase receipt was voided. Do not receive it.' using errcode='40001';end if;
  r:=public.receipt_delivery_request(p_id);
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 200 then raise exception 'Review between 1 and 200 items.';end if;
  if (select count(distinct value->>'item_id') from jsonb_array_elements(p_items))<>jsonb_array_length(p_items) then raise exception 'Review each receipt item once.';end if;
  for l in select value from jsonb_array_elements(p_items) order by value->>'ingredient_id',value->>'item_id' loop
    select value into p from jsonb_array_elements(r->'purchase_request_items') where value->>'id'=l->>'item_id';
    select coalesce(sum((value->>'purchase_quantity')::numeric),0) into received from jsonb_array_elements(p->'purchase_receipts');
    if p is null or (p->>'updated_at')::timestamptz is distinct from (l->>'expected_updated_at')::timestamptz or received is distinct from (l->>'expected_received_quantity')::numeric
      then raise exception 'Another delivery changed. Reopen and check the remaining quantities.' using errcode='40001';end if;
    select * into i from public.ingredient_items where id=(l->>'ingredient_id')::uuid and active and category in('Food','Seafood','Condiment') for update;
    if not found or i.base_unit is distinct from l->>'expected_base_unit' or (l ? 'ingredient_version' and i.updated_at is distinct from (l->>'ingredient_version')::timestamptz)
      then raise exception 'Inventory item changed. Reopen the delivery.' using errcode='40001';end if;
    qty:=(l->>'quantity')::numeric;
    m:=public.delivery_stock_measurement(p->>'unit',i.base_unit,qty,(l->>'base_per_unit')::numeric,(l->>'measured_pieces')::numeric,public.kitchen_fractional(i),4);
    if qty>(p->>'quantity')::numeric-received then raise exception 'Quantity exceeds what is still outstanding.';end if;
    result:=result||jsonb_build_array(m||jsonb_build_object('item_id',l->>'item_id','ingredient_id',i.id,'quantity',qty,'expected_updated_at',p->>'updated_at',
      'expected_received_quantity',received,'expected_base_unit',i.base_unit,'ingredient_version',i.updated_at,'purchase_name',p->>'item_name','purchase_unit',p->>'unit',
      'ingredient_name',coalesce(i.kitchen_label,i.name),'display_unit',coalesce(i.kitchen_unit,case when i.base_unit='g' then 'kg' when i.base_unit='unit' then 'pcs' else i.base_unit end),
      'display_factor',case when i.kitchen_key is not null then i.kitchen_factor when i.base_unit='g' then 1000 else 1 end));
  end loop;
  return result;
end $$;

create or replace function public.confirm_receipt_delivery_draft(p_id uuid,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare old public.receipt_delivery_drafts%rowtype;d public.receipt_delivery_drafts%rowtype;s public.receipt_delivery_sources%rowtype;items jsonb;l jsonb;
  receipts jsonb:='[]';arrival_lines jsonb:='[]';result jsonb;staff text;stamp timestamptz:=clock_timestamp();qty numeric;balance numeric;i uuid;
begin
  perform public.require_permission('purchasing.receive');perform pg_advisory_xact_lock(73081,1);
  select * into old from public.receipt_delivery_drafts where id=p_id for update;if not found then raise exception 'Draft not found.';end if;
  if old.status='confirmed' and old.version=p_expected_version+1 then return old.confirmed_record;end if;
  if old.status<>'draft' or old.version is distinct from p_expected_version then raise exception 'Draft changed. Reopen it.' using errcode='40001';end if;
  items:=public.receipt_delivery_validate(old.request_id,old.items);
  select * into s from public.receipt_delivery_sources where id=old.request_id;
  select nullif(trim(full_name),'') into staff from public.profiles where id=auth.uid();if staff is null then raise exception 'Your profile needs a staff name.';end if;
  for l in select value from jsonb_array_elements(items) loop
    i:=(l->>'ingredient_id')::uuid;qty:=(l->>'base_quantity')::numeric;
    insert into public.ingredient_balances(ingredient_id,quantity_on_hand) values(i,0) on conflict(ingredient_id) do nothing;
    select quantity_on_hand into balance from public.ingredient_balances where ingredient_id=i for update;
    update public.ingredient_balances set quantity_on_hand=balance+qty,updated_at=stamp where ingredient_id=i;
    insert into public.ingredient_movements(ingredient_id,movement_type,quantity_change,quantity_before,quantity_after,unit_input,input_quantity,reference_type,reference_id,reason,notes,entered_by,created_by)
      values(i,'stock_in',qty,balance,balance+qty,'base',qty,'kitchen_arrival',old.id,'Receipt Delivery',s.supplier||' | '||s.reference,staff,auth.uid());
    receipts:=receipts||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'purchase_item_id',l->>'item_id','ingredient_id',i,'purchase_quantity',l->'quantity','base_quantity',qty,'base_unit',l->>'expected_base_unit',
      'received_by',auth.uid(),'received_at',stamp,'ingredient_name',l->>'ingredient_name','purchase_unit',l->>'purchase_unit','base_per_unit',l->'base_per_unit','measured_pieces',l->'measured_pieces',
      'received_by_name',staff,'display_unit',l->>'display_unit','display_factor',l->'display_factor','details_backfilled',false));
    arrival_lines:=arrival_lines||jsonb_build_array(jsonb_build_object('ingredient_id',i,'name',l->>'ingredient_name','quantity',qty,'unit',l->>'expected_base_unit',
      'entered_quantity',qty/coalesce(nullif((l->>'display_factor')::numeric,0),1),'display_unit',l->>'display_unit'));
  end loop;
  insert into public.kitchen_arrivals(id,date,supplier,reference,lines,created_by,created_by_name) values(old.id,(stamp at time zone 'Asia/Kuala_Lumpur')::date,s.supplier,s.reference,arrival_lines,auth.uid(),staff);
  result:=jsonb_build_object('id',old.id,'request_id',old.request_id,'request_no',old.request_no,'confirmed_at',stamp,'confirmed_by',auth.uid(),'confirmed_by_name',staff,'receipts',receipts);
  update public.receipt_delivery_drafts set status='confirmed',confirmed_record=result,version=version+1,updated_at=stamp,updated_by=auth.uid(),updated_by_name=staff where id=p_id returning * into d;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_json,after_json) values(auth.uid(),'receipt_delivery_confirmed','receipt_delivery',p_id,to_jsonb(old),to_jsonb(d));
  return result;
end $$;

create or replace function public.read_platform_schema_version() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('schema_version','202610140073','measured_piece_receiving',true,
   'private_payment_receipts',coalesce((select not public from storage.buckets where id='payment-receipts'),false),
   'private_purchase_evidence',coalesce((select not public from storage.buckets where id='purchase-evidence'),false),
   'retired_writes_private',not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
     and p.proname in ('complete_sale','create_stock_in_draft','close_daily_report','save_expense_receipt','submit_kitchen_production','record_kitchen_usage_checked','delivery_stock_measurement','request_delivery_validate')
     and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))))
$$;
commit;
