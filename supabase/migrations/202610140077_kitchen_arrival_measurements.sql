-- Keep the same arrival authority, locks, actor audit and immutable replay.
-- Accept only exact kg/g or L/ml conversions matching the stored base unit.
create or replace function public.record_kitchen_arrival(p_record jsonb,p_operation_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare op public.operation_requests%rowtype;i public.ingredient_items%rowtype;l jsonb;r public.kitchen_arrivals%rowtype;
  h text:=md5(p_record::text);d date:=(p_record->>'date')::date;qty numeric;entered numeric;balance numeric;factor numeric;display text;lines jsonb:='[]';staff text;
begin
  perform public.require_permission('purchasing.receive');perform pg_advisory_xact_lock(73081,1);
  if p_operation_id is null then raise exception 'Submission reference required.';end if;
  select * into op from public.operation_requests where actor_id=auth.uid() and operation='kitchen_arrival' and request_id=p_operation_id;
  if found then if op.payload_hash<>h then raise exception 'This delivery already has different details.';end if;return(select to_jsonb(a) from public.kitchen_arrivals a where id=op.result_id);end if;
  if d is null or d>(now() at time zone 'Asia/Kuala_Lumpur')::date or coalesce(length(trim(p_record->>'supplier')),0) not between 1 and 160 or length(coalesce(p_record->>'reference',''))>120 or jsonb_typeof(p_record->'lines') is distinct from 'array' or jsonb_array_length(p_record->'lines') not between 1 and 200 then raise exception 'Check date, supplier and delivered items.';end if;
  if (select count(distinct value->>'ingredient_id') from jsonb_array_elements(p_record->'lines'))<>jsonb_array_length(p_record->'lines') then raise exception 'An item appears twice.';end if;
  select nullif(trim(full_name),'') into staff from public.profiles where id=auth.uid();if staff is null then raise exception 'Your profile needs a staff name.';end if;
  r.id:=gen_random_uuid();
  for l in select value from jsonb_array_elements(p_record->'lines') order by value->>'ingredient_id' loop
    select * into i from public.ingredient_items where id=(l->>'ingredient_id')::uuid and active and category in('Food','Seafood','Condiment') for update;
    if not found or i.base_unit is distinct from l->>'unit' or i.updated_at is distinct from (l->>'expected_version')::timestamptz then raise exception 'Item changed. Refresh this delivery.' using errcode='40001';end if;
    qty:=(l->>'quantity')::numeric;entered:=(l->>'entered_quantity')::numeric;
    display:=coalesce(l->>'display_unit',i.kitchen_unit,case when i.base_unit='g' then 'kg' when i.base_unit='unit' then 'pcs' else i.base_unit end);
    factor:=case when i.base_unit='g' and display='kg' or i.base_unit='ml' and display='L' then 1000
      when i.base_unit='g' and display='g' or i.base_unit='ml' and display='ml' then 1
      when display=coalesce(i.kitchen_unit,case when i.base_unit='g' then 'kg' when i.base_unit='unit' then 'pcs' else i.base_unit end) then
        case when i.kitchen_key is not null then i.kitchen_factor else case when i.base_unit='g' then 1000 else 1 end end else null end;
    if qty is null or entered is null or qty<=0 or qty>1e9 or qty<>round(qty,2) or qty::text in('NaN','Infinity','-Infinity') or (i.base_unit='unit' and not public.kitchen_fractional(i) and qty<>trunc(qty)) or factor is null or entered<=0 or entered::text in('NaN','Infinity','-Infinity') or qty<>entered*factor then raise exception 'Check delivered quantities and unit setup.';end if;
    insert into public.ingredient_balances(ingredient_id,quantity_on_hand) values(i.id,0) on conflict(ingredient_id) do nothing;
    select quantity_on_hand into balance from public.ingredient_balances where ingredient_id=i.id for update;
    update public.ingredient_balances set quantity_on_hand=balance+qty,updated_at=clock_timestamp() where ingredient_id=i.id;
    insert into public.ingredient_movements(ingredient_id,movement_type,quantity_change,quantity_before,quantity_after,unit_input,input_quantity,reference_type,reference_id,reason,notes,entered_by,created_by)
      values(i.id,'stock_in',qty,balance,balance+qty,'base',qty,'kitchen_arrival',r.id,'Kitchen Delivery',d::text||' | '||trim(p_record->>'supplier')||' | '||coalesce(p_record->>'reference',''),staff,auth.uid());
    lines:=lines||jsonb_build_array(jsonb_build_object('ingredient_id',i.id,'name',coalesce(i.kitchen_label,i.name),'quantity',qty,'entered_quantity',entered,'display_unit',display,'unit',i.base_unit));
  end loop;
  insert into public.kitchen_arrivals(id,date,supplier,reference,lines,created_by,created_by_name) values(r.id,d,trim(p_record->>'supplier'),coalesce(p_record->>'reference',''),lines,auth.uid(),staff) returning * into r;
  insert into public.operation_requests(actor_id,operation,request_id,payload_hash,result_id) values(auth.uid(),'kitchen_arrival',p_operation_id,h,r.id);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_json) values(auth.uid(),'kitchen_arrival','kitchen_arrival',r.id,to_jsonb(r));
  return to_jsonb(r);
end $$;
