-- Purchase confirmation records spending; only receiving adds inventory.
create function public.purchase_batch_visible_record(p_record jsonb)
returns jsonb language sql stable security definer set search_path=public as $$
  select case when public.has_permission('purchasing.cost.view') then p_record
    else jsonb_set(p_record,'{items}',coalesce((
      select jsonb_agg(item-'actual_cost') from jsonb_array_elements(p_record->'items') item
    ),'[]'::jsonb)) end;
$$;
revoke all on function public.purchase_batch_visible_record(jsonb) from public,anon,authenticated;

create function public.record_purchase_batch_checked(
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
  if not found or v_request.status not in ('submitted','buying') then
    raise exception 'This request is no longer open for purchases. Reopen Purchasing to check its status.' using errcode='40001';
  end if;
  -- Validate the entire list before delegating any line to the existing writer.
  for v_line in select value from jsonb_array_elements(p_items) loop
    select * into v_item from public.purchase_request_items where id=(v_line->>'id')::uuid for update;
    if not found or v_item.request_id<>p_request_id or v_item.purchase_status<>'pending'
      or v_item.updated_at is distinct from (v_line->>'expected_updated_at')::timestamptz then
      raise exception 'An item changed on another device. No purchases were recorded. Reopen the request and review it again.' using errcode='40001';
    end if;
  end loop;
  select jsonb_agg(to_jsonb(i) order by sort_order,id) into v_before
    from public.purchase_request_items i where id=any(v_ids);
  for v_line in select value from jsonb_array_elements(p_items) loop
    select * into v_item from public.purchase_request_items where id=(v_line->>'id')::uuid;
    perform public.set_purchase_item_status_checked(v_item.id,v_item.updated_at,'bought',
      (v_line->>'quantity')::numeric,(v_line->>'actual_cost')::numeric,v_supplier,v_item.purchase_note);
  end loop;
  select jsonb_build_object('id',v_id,'request_id',v_request.id,'request_no',v_request.request_no,
    'supplier',v_supplier,'reference',v_reference,'confirmed_at',now(),'confirmed_by',auth.uid(),
    'confirmed_by_name',(select full_name from public.profiles where id=auth.uid()),
    'items',jsonb_agg(jsonb_build_object('id',i.id,'item_name',i.item_name,'unit',i.unit,
      'requested_quantity',i.quantity,'quantity',i.purchased_quantity,'actual_cost',i.actual_cost) order by i.sort_order,i.id))
    into v_record from public.purchase_request_items i where i.id=any(v_ids);
  insert into public.audit_logs(id,actor_id,action,entity_type,entity_id,before_json,after_json)
    values(v_id,auth.uid(),'record_purchase_batch','purchase_request',p_request_id,v_before,v_record);
  insert into public.operation_requests(actor_id,operation,request_id,payload_hash,result_id)
    values(auth.uid(),'record_purchase_batch',p_operation_id,v_hash,v_id);
  return public.purchase_batch_visible_record(v_record);
end $$;
revoke all on function public.record_purchase_batch_checked(uuid,jsonb,text,text,uuid) from public,anon;
grant execute on function public.record_purchase_batch_checked(uuid,jsonb,text,text,uuid) to authenticated;

create function public.read_purchase_batch_records(p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  perform public.require_permission('purchasing.view');
  return jsonb_build_object('total',(
    select count(*) from public.audit_logs where entity_type='purchase_request' and entity_id=p_request_id and action='record_purchase_batch'
  ),'records',coalesce((
    select jsonb_agg(public.purchase_batch_visible_record(a.after_json) order by a.created_at desc,a.id)
    from (select id,created_at,after_json from public.audit_logs
      where entity_type='purchase_request' and entity_id=p_request_id and action='record_purchase_batch'
      order by created_at desc,id limit 100) a
  ),'[]'::jsonb));
end $$;
revoke all on function public.read_purchase_batch_records(uuid) from public,anon;
grant execute on function public.read_purchase_batch_records(uuid) to authenticated;
