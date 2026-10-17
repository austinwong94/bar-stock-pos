create table public.delivery_drafts (
  id uuid primary key,
  request_id uuid not null references public.purchase_requests(id),
  request_no text not null,
  status text not null default 'draft' check(status in ('draft','confirmed','cancelled')),
  version integer not null default 1,
  items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 250),
  created_by uuid not null references public.profiles(id),
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id),
  updated_by_name text,
  updated_at timestamptz not null default now(),
  confirmed_record jsonb,
  cancelled_reason text
);
alter table public.delivery_drafts enable row level security;
revoke all on public.delivery_drafts from public,anon,authenticated;
grant select on public.delivery_drafts to authenticated;
create policy delivery_draft_read on public.delivery_drafts for select to authenticated using(public.has_permission('purchasing.view'));
create index delivery_drafts_pending_idx on public.delivery_drafts(updated_at,id) where status='draft';

create function public.save_delivery_draft(p_id uuid,p_request_id uuid,p_items jsonb,p_expected_version integer,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.delivery_drafts%rowtype; q public.purchase_requests%rowtype; i public.purchase_request_items%rowtype;
  g public.ingredient_items%rowtype; line jsonb; saved jsonb:='[]'; before_json jsonb; result jsonb;
  previous public.operation_requests%rowtype; digest text; audit_id uuid:=gen_random_uuid(); who text;
  qty numeric; size numeric; received numeric;
begin
  perform public.require_permission('purchasing.receive');
  if p_id is null or p_request_id is null or p_operation_id is null or p_expected_version is null or p_expected_version<0 then raise exception 'Reopen the delivery before saving.'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'Enter delivery items before reviewing.'; end if;
  if jsonb_array_length(p_items) not between 1 and 250 then raise exception 'Review between 1 and 250 items.'; end if;
  digest:=md5(jsonb_build_object('id',p_id,'request',p_request_id,'items',p_items,'version',p_expected_version)::text);
  perform pg_advisory_xact_lock(73081,1);
  select * into previous from public.operation_requests where actor_id=auth.uid() and operation='save_delivery_draft' and request_id=p_operation_id;
  if found then
    if previous.payload_hash<>digest then raise exception 'This draft save was already used for different details.'; end if;
    select a.after_json into result from public.audit_logs a where a.id=previous.result_id;
    return result;
  end if;
  select * into d from public.delivery_drafts where id=p_id for update;
  if (found and (d.request_id<>p_request_id or d.status<>'draft' or d.version<>p_expected_version)) or (not found and p_expected_version<>0) then
    raise exception 'This draft changed on another device. Reopen it before editing.' using errcode='40001'; end if;
  before_json:=case when d.id is null then null else to_jsonb(d) end;
  select * into q from public.purchase_requests where id=p_request_id for update;
  if not found or q.status not in ('submitted','buying','completed') then raise exception 'This request is not open for receiving.' using errcode='40001'; end if;
  if (select count(distinct x->>'item_id') from jsonb_array_elements(p_items) x)<>jsonb_array_length(p_items) then raise exception 'Include each purchase item once.'; end if;
  for line in select value from jsonb_array_elements(p_items) loop
    select * into i from public.purchase_request_items where id=(line->>'item_id')::uuid for update;
    if not found or i.request_id<>p_request_id or i.purchase_status<>'bought' or i.updated_at is distinct from (line->>'expected_updated_at')::timestamptz then
      raise exception 'A purchase changed. Reopen the delivery before reviewing.' using errcode='40001'; end if;
    select coalesce(sum(purchase_quantity),0) into received from public.purchase_receipts where purchase_item_id=i.id;
    if received is distinct from (line->>'expected_received_quantity')::numeric then raise exception 'Another delivery was recorded. Reopen and check the remaining quantity.' using errcode='40001'; end if;
    select * into g from public.ingredient_items where id=(line->>'ingredient_id')::uuid and active for update;
    if not found or g.base_unit is distinct from line->>'expected_base_unit' then raise exception 'The inventory item or unit changed. Reopen the delivery.' using errcode='40001'; end if;
    qty:=(line->>'quantity')::numeric; size:=(line->>'base_per_unit')::numeric;
    if qty is null or size is null or qty<=0 or size<=0 or qty::text in ('NaN','Infinity','-Infinity') or size::text in ('NaN','Infinity','-Infinity')
      or round(qty,2)<>qty or round(size,4)<>size or qty+received>i.purchased_quantity or qty*size>=1e12 or round(qty*size,2)<>qty*size then raise exception 'Check the delivered quantity and pack size.'; end if;
    if (lower(trim(i.unit)) in ('kg','g') and (g.base_unit<>'g' or size<>case when lower(trim(i.unit))='kg' then 1000 else 1 end))
      or (lower(trim(i.unit)) in ('l','ml') and (g.base_unit<>'ml' or size<>case when lower(trim(i.unit))='l' then 1000 else 1 end))
      or (lower(trim(i.unit)) in ('pc','pcs','unit','units') and (g.base_unit<>'unit' or size<>1))
      or (g.base_unit='unit' and trunc(qty*size)<>qty*size) then raise exception 'The stock conversion does not match the purchase unit.'; end if;
    saved:=saved||jsonb_build_array(jsonb_build_object('item_id',i.id,'ingredient_id',g.id,'quantity',qty,'base_per_unit',size,
      'expected_updated_at',i.updated_at,'expected_received_quantity',received,'expected_base_unit',g.base_unit,
      'purchase_name',i.item_name,'purchase_unit',i.unit,'ingredient_name',g.name));
  end loop;
  select full_name into who from public.profiles where id=auth.uid();
  if d.id is null then
    insert into public.delivery_drafts(id,request_id,request_no,items,created_by,created_by_name,updated_by,updated_by_name)
      values(p_id,p_request_id,q.request_no,saved,auth.uid(),who,auth.uid(),who) returning * into d;
  else
    update public.delivery_drafts set items=saved,version=version+1,updated_by=auth.uid(),updated_by_name=who,updated_at=now() where id=p_id returning * into d;
  end if;
  result:=to_jsonb(d);
  insert into public.audit_logs(id,actor_id,action,entity_type,entity_id,before_json,after_json)
    values(audit_id,auth.uid(),'delivery_draft_saved','delivery_draft',p_id,before_json,result);
  insert into public.operation_requests(actor_id,operation,request_id,payload_hash,result_id) values(auth.uid(),'save_delivery_draft',p_operation_id,digest,audit_id);
  return result;
end $$;

create function public.confirm_delivery_draft(p_id uuid,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.delivery_drafts%rowtype; result jsonb;
begin
  perform public.require_permission('purchasing.receive');
  perform pg_advisory_xact_lock(73081,1);
  select * into d from public.delivery_drafts where id=p_id for update;
  if not found then raise exception 'Delivery draft not found.'; end if;
  if d.status='confirmed' then return d.confirmed_record; end if;
  if d.status<>'draft' or d.version is distinct from p_expected_version then raise exception 'This draft changed on another device. Reopen it before confirming.' using errcode='40001'; end if;
  result:=public.receive_purchase_batch_checked(d.request_id,d.items,d.id);
  update public.delivery_drafts set status='confirmed',confirmed_record=result,version=version+1,updated_at=now(),updated_by=auth.uid(),
    updated_by_name=(select full_name from public.profiles where id=auth.uid()) where id=d.id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_json,after_json)
    values(auth.uid(),'delivery_draft_confirmed','delivery_draft',d.id,to_jsonb(d),result);
  return result;
end $$;

create function public.cancel_delivery_draft(p_id uuid,p_expected_version integer,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare d public.delivery_drafts%rowtype;
begin
  perform public.require_permission('purchasing.receive');
  if nullif(trim(p_reason),'') is null or length(p_reason)>300 then raise exception 'Enter a cancellation reason (up to 300 characters).'; end if;
  perform pg_advisory_xact_lock(73081,1);
  select * into d from public.delivery_drafts where id=p_id for update;
  if not found then raise exception 'Delivery draft not found.'; end if;
  if d.status='cancelled' and d.cancelled_reason=trim(p_reason) then return; end if;
  if d.status<>'draft' or d.version is distinct from p_expected_version then raise exception 'This draft changed on another device. Reopen it.' using errcode='40001'; end if;
  update public.delivery_drafts set status='cancelled',cancelled_reason=trim(p_reason),version=version+1,updated_at=now(),updated_by=auth.uid(),
    updated_by_name=(select full_name from public.profiles where id=auth.uid()) where id=d.id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_json,after_json)
    values(auth.uid(),'delivery_draft_cancelled','delivery_draft',d.id,to_jsonb(d),jsonb_build_object('reason',trim(p_reason)));
end $$;

create function public.read_delivery_drafts(p_limit integer default 10,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  perform public.require_permission('purchasing.view');
  if p_limit is null or p_limit<1 or p_limit>50 or p_offset is null or p_offset<0 then raise exception 'Invalid draft page.'; end if;
  return jsonb_build_object('total',(select count(*) from public.delivery_drafts where status='draft'),
    'drafts',coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at,x.id) from (
      select id,request_id,request_no,version,created_by_name,created_at,updated_by_name,updated_at,jsonb_array_length(items) as item_count
      from public.delivery_drafts where status='draft' order by updated_at,id limit p_limit offset p_offset
    ) x),'[]'::jsonb));
end $$;

create function public.read_delivery_draft(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare d public.delivery_drafts%rowtype; request jsonb;
begin
  perform public.require_permission('purchasing.view');
  select * into d from public.delivery_drafts where id=p_id;
  if not found then raise exception 'Delivery draft not found.'; end if;
  select to_jsonb(q)||jsonb_build_object('purchase_request_items',coalesce((select jsonb_agg(
    (case when public.has_permission('purchasing.cost.view') then to_jsonb(i) else to_jsonb(i)-'actual_cost' end)||
    jsonb_build_object('purchase_receipts',coalesce((select jsonb_agg(to_jsonb(r)) from public.purchase_receipts r where r.purchase_item_id=i.id),'[]'::jsonb))
    order by i.sort_order,i.id) from public.purchase_request_items i where i.request_id=q.id),'[]'::jsonb)) into request
    from public.purchase_requests q where q.id=d.request_id;
  return jsonb_build_object('draft',to_jsonb(d),'request',request);
end $$;

revoke all on function public.save_delivery_draft(uuid,uuid,jsonb,integer,uuid), public.confirm_delivery_draft(uuid,integer),
  public.cancel_delivery_draft(uuid,integer,text), public.read_delivery_drafts(integer,integer), public.read_delivery_draft(uuid) from public,anon;
grant execute on function public.save_delivery_draft(uuid,uuid,jsonb,integer,uuid), public.confirm_delivery_draft(uuid,integer),
  public.cancel_delivery_draft(uuid,integer,text), public.read_delivery_drafts(integer,integer), public.read_delivery_draft(uuid) to authenticated;
