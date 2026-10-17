-- Lock and compare the received totals, not only the purchase row's version.
-- Receiving does not update that purchase version, so it cannot detect another
-- device's partial delivery on its own.
create function public.receive_purchase_batch_checked(p_request_id uuid,p_items jsonb,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_request public.purchase_requests%rowtype;
  v_item public.purchase_request_items%rowtype;
  v_ingredient public.ingredient_items%rowtype;
  v_receipt public.purchase_receipts%rowtype;
  v_previous public.operation_requests%rowtype;
  v_line jsonb;
  v_ids uuid[];
  v_received numeric;
  v_quantity numeric;
  v_size numeric;
  v_base numeric;
  v_fixed_unit text;
  v_fixed_size numeric;
  v_unit text;
  v_hash text;
  v_receipts jsonb := '[]'::jsonb;
  v_record jsonb;
  v_id uuid := gen_random_uuid();
begin
  perform public.require_permission('purchasing.receive');
  if p_request_id is null or p_operation_id is null then raise exception 'A request and confirmation ID are required.'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'Enter the quantities delivered.'; end if;
  if jsonb_array_length(p_items) not between 1 and 250 then raise exception 'Confirm between 1 and 250 delivery items.'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x)<>'object'
    or nullif(x->>'item_id','') is null or nullif(x->>'ingredient_id','') is null
    or nullif(x->>'expected_updated_at','') is null or x->>'expected_received_quantity' is null
    or x->>'expected_base_unit' is null or x->>'expected_base_unit' not in ('g','ml','unit')
    or (x->>'expected_received_quantity')::numeric<0
    or (x->>'expected_received_quantity')::numeric::text in ('NaN','Infinity','-Infinity'))
    then raise exception 'Reopen the delivery to load its latest details.' using errcode='40001'; end if;
  select array_agg((x->>'item_id')::uuid) into v_ids from jsonb_array_elements(p_items) x;
  if cardinality(v_ids)<>(select count(distinct id) from unnest(v_ids) id) then
    raise exception 'Receive each purchase item once per confirmation. Different pack sizes need separate deliveries.';
  end if;
  v_hash := md5(jsonb_build_object('request',p_request_id,'items',p_items)::text);
  perform pg_advisory_xact_lock(73081,1);
  select * into v_previous from public.operation_requests where actor_id=auth.uid()
    and operation='receive_purchase_batch' and request_id=p_operation_id;
  if found then
    if v_previous.payload_hash<>v_hash then raise exception 'This delivery was already confirmed with different details.'; end if;
    select after_json into v_record from public.audit_logs where id=v_previous.result_id;
    if v_record is null then raise exception 'The saved delivery record could not be found.'; end if;
    return v_record;
  end if;
  select * into v_request from public.purchase_requests where id=p_request_id for update;
  if not found or v_request.status not in ('submitted','buying','completed') then
    raise exception 'This request is not open for receiving.' using errcode='40001'; end if;
  perform 1 from public.purchase_request_items where id=any(v_ids) order by id for update;
  perform 1 from public.ingredient_items where id in (
    select (x->>'ingredient_id')::uuid from jsonb_array_elements(p_items) x
  ) order by id for update;
  -- Validate every delivery, including fixed unit conversions, before stock moves.
  for v_line in select value from jsonb_array_elements(p_items) loop
    select * into v_item from public.purchase_request_items where id=(v_line->>'item_id')::uuid;
    if not found or v_item.request_id<>p_request_id or v_item.purchase_status<>'bought'
      or v_item.purchased_quantity is null or v_item.purchased_quantity<=0
      or v_item.purchased_quantity::text in ('NaN','Infinity','-Infinity')
      or v_item.updated_at is distinct from (v_line->>'expected_updated_at')::timestamptz then
      raise exception 'A purchase changed on another device. No stock was added. Reopen the delivery.' using errcode='40001'; end if;
    select coalesce(sum(purchase_quantity),0) into v_received from public.purchase_receipts where purchase_item_id=v_item.id;
    if v_received is distinct from (v_line->>'expected_received_quantity')::numeric then
      raise exception 'Another delivery was recorded. No stock was added by this confirmation. Reopen and check what is still outstanding.' using errcode='40001'; end if;
    select * into v_ingredient from public.ingredient_items where id=(v_line->>'ingredient_id')::uuid and active;
    if not found then raise exception 'Choose an active inventory item for every delivery.'; end if;
    if v_ingredient.base_unit is distinct from v_line->>'expected_base_unit' then
      raise exception 'The inventory unit changed. No stock was added. Reopen the delivery.' using errcode='40001'; end if;
    v_quantity := (v_line->>'quantity')::numeric;
    v_size := (v_line->>'base_per_unit')::numeric;
    if v_quantity is null or v_quantity<=0 or v_quantity::text in ('NaN','Infinity','-Infinity') or round(v_quantity,2)<>v_quantity then
      raise exception 'Delivered quantity must be positive, with up to two decimal places.'; end if;
    if v_received+v_quantity>v_item.purchased_quantity then raise exception 'Delivered quantity exceeds the amount still outstanding.'; end if;
    if v_size is null or v_size<=0 or v_size::text in ('NaN','Infinity','-Infinity') or round(v_size,4)<>v_size then
      raise exception 'Enter a positive pack size with up to four decimal places.'; end if;
    v_unit := lower(trim(v_item.unit));
    v_fixed_unit := case when v_unit in ('kg','g') then 'g' when v_unit in ('l','ml') then 'ml' when v_unit in ('pc','pcs','unit','units') then 'unit' else null end;
    v_fixed_size := case when v_unit in ('kg','l') then 1000 else 1 end;
    if v_fixed_unit is not null and (v_ingredient.base_unit<>v_fixed_unit or v_size<>v_fixed_size) then
      raise exception 'The inventory unit or conversion does not match the purchase unit.'; end if;
    v_base := v_quantity*v_size;
    if v_base<=0 or v_base>=1e12 or round(v_base,2)<>v_base then raise exception 'Stock added must be greater than zero and exact to two decimal places.'; end if;
    if v_ingredient.base_unit='unit' and trunc(v_base)<>v_base then raise exception 'Individual stock must add up to whole units.'; end if;
  end loop;
  for v_line in select value from jsonb_array_elements(p_items) loop
    v_receipt := public.receive_purchase_item((v_line->>'item_id')::uuid,(v_line->>'ingredient_id')::uuid,
      (v_line->>'quantity')::numeric,(v_line->>'base_per_unit')::numeric,gen_random_uuid(),(v_line->>'expected_updated_at')::timestamptz);
    v_receipts := v_receipts || jsonb_build_array(to_jsonb(v_receipt));
  end loop;
  v_record := jsonb_build_object('id',v_id,'request_id',p_request_id,'request_no',v_request.request_no,
    'confirmed_at',now(),'confirmed_by',auth.uid(),'confirmed_by_name',
    (select full_name from public.profiles where id=auth.uid()),'receipts',v_receipts);
  insert into public.audit_logs(id,actor_id,action,entity_type,entity_id,after_json)
    values(v_id,auth.uid(),'receive_purchase_batch','purchase_request',p_request_id,v_record);
  insert into public.operation_requests(actor_id,operation,request_id,payload_hash,result_id)
    values(auth.uid(),'receive_purchase_batch',p_operation_id,v_hash,v_id);
  return v_record;
end $$;
revoke all on function public.receive_purchase_batch_checked(uuid,jsonb,uuid) from public,anon;
grant execute on function public.receive_purchase_batch_checked(uuid,jsonb,uuid) to authenticated;
-- The old endpoint cannot check the received-total snapshot. Both single-item
-- and multi-item screens must use the checked wrapper after this migration.
revoke all on function public.receive_purchase_item(uuid,uuid,numeric,numeric,uuid,timestamptz) from public,anon,authenticated;
