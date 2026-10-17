alter table public.purchase_requests
  add column submitted_by uuid references public.profiles(id),
  add column submitted_by_name text;

-- Earlier records retain null names rather than claiming a historical identity.
create function public.capture_request_submitter()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.status='draft' and new.status='submitted' then
    new.submitted_by := auth.uid();
    new.submitted_by_name := (select full_name from public.profiles where id=auth.uid());
  else
    new.submitted_by := old.submitted_by;
    new.submitted_by_name := old.submitted_by_name;
  end if;
  return new;
end $$;
create trigger capture_request_submitter before update on public.purchase_requests
for each row execute function public.capture_request_submitter();
revoke all on function public.capture_request_submitter() from public,anon,authenticated;

create or replace function public.submit_purchase_request_checked(p_request_id uuid,p_expected_updated_at timestamptz)
returns public.purchase_requests language plpgsql security definer set search_path=public as $$
declare v_request public.purchase_requests%rowtype; v_previous public.operation_requests%rowtype;
  v_hash text := md5(coalesce(extract(epoch from p_expected_updated_at)::text,''));
begin
  perform public.require_permission('kitchen.request.submit');
  perform pg_advisory_xact_lock(73081,1);
  select * into v_request from public.purchase_requests where id=p_request_id for update;
  if not found then raise exception 'Request not found.'; end if;
  select * into v_previous from public.operation_requests where actor_id=auth.uid()
    and operation='submit_purchase_request' and request_id=p_request_id;
  if found and v_previous.payload_hash=v_hash and v_request.status in ('submitted','buying','completed') then
    return v_request;
  end if;
  if v_request.updated_at is distinct from p_expected_updated_at or v_request.status<>'draft' then
    raise exception 'The request changed. Reopen it and check the updated details before confirming.' using errcode='40001';
  end if;
  if not exists(select 1 from public.purchase_request_items where request_id=p_request_id)
    or exists(select 1 from public.purchase_request_items where request_id=p_request_id
      and (quantity<=0 or quantity::text in ('NaN','Infinity','-Infinity')
        or nullif(trim(item_name),'') is null or nullif(trim(unit),'') is null)) then
    raise exception 'Every item needs a name, unit and quantity greater than zero before sending.';
  end if;
  v_request := public.submit_purchase_request(p_request_id);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_json)
    values(auth.uid(),'submit_purchase_request','purchase_request',p_request_id,
      jsonb_build_object('request',to_jsonb(v_request),'items',
        (select jsonb_agg(to_jsonb(i) order by sort_order,id) from public.purchase_request_items i where request_id=p_request_id)));
  insert into public.operation_requests(actor_id,operation,request_id,payload_hash,result_id)
    values(auth.uid(),'submit_purchase_request',p_request_id,v_hash,p_request_id);
  return v_request;
end $$;

-- Save incomplete quantities as zero in drafts, but never round entered values
-- silently. Each successful save leaves a snapshot; retries reuse that save.
do $$
declare definition text; updated text;
begin
  definition := pg_get_functiondef('public.save_purchase_request(jsonb,jsonb)'::regprocedure);
  updated := replace(definition,
    'if v_date is null then raise exception ''Say which date the items are needed for.''; end if;',
    'if v_date is null then raise exception ''Say which date the items are needed for.''; end if;
  if p_items is null or jsonb_typeof(p_items)<>''array'' then raise exception ''Add request items.''; end if;
  if exists(select 1 from jsonb_array_elements(p_items) x where
    nullif(trim(x->>''item_name''),'''') is null or nullif(trim(x->>''unit''),'''') is null
    or (x->>''quantity'') is null or (x->>''quantity'')::numeric<0
    or (x->>''quantity'')::numeric::text in (''NaN'',''Infinity'',''-Infinity'')
    or round((x->>''quantity'')::numeric,2)<>(x->>''quantity'')::numeric)
    then raise exception ''Check each item name, unit and quantity (zero or greater, up to two decimal places).''; end if;
  if exists(select 1 from jsonb_array_elements(p_items) x where nullif(x->>''id'','''') is not null
    and not exists(select 1 from public.purchase_request_items i where i.id=(x->>''id'')::uuid and i.request_id=v_id))
    then raise exception ''Request item not found. Reopen the request.''; end if;
  if exists(select x->>''id'' from jsonb_array_elements(p_items) x where nullif(x->>''id'','''') is not null
    group by x->>''id'' having count(*)>1) then raise exception ''A request item was included more than once.''; end if;');
  if updated=definition then raise exception 'Expected request validation was not found'; end if;
  definition := updated;
  updated := replace(definition,'return v_id;',
    'insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_json)
    select auth.uid(),''save_purchase_request'',''purchase_request'',v_id,
      jsonb_build_object(''request'',to_jsonb(r),''items'',
        (select jsonb_agg(to_jsonb(i) order by sort_order,id) from public.purchase_request_items i where request_id=v_id),
        ''saved_by_name'',(select full_name from public.profiles where id=auth.uid()))
    from public.purchase_requests r where r.id=v_id;
  return v_id;');
  if updated=definition then raise exception 'Expected request save return was not found'; end if;
  execute updated;
end $$;
