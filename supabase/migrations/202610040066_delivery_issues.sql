-- Delivery exceptions are attributed reports, not receipts or stock adjustments.
create table public.delivery_issues (
  id uuid primary key,
  request_id uuid not null references public.purchase_requests(id),
  item_id uuid not null references public.purchase_request_items(id),
  request_no text not null,
  item_name text not null,
  unit text not null,
  supplier text,
  kind text not null check (kind in ('delayed','missing','damaged')),
  quantity numeric not null check (quantity > 0 and quantity <= 999999 and quantity = round(quantity,2)),
  note text not null check (length(note) <= 500),
  status text not null default 'open' check (status in ('open','closed')),
  version integer not null default 1,
  created_by uuid not null references public.profiles(id),
  created_by_name text not null,
  created_at timestamptz not null default now(),
  closed_by uuid references public.profiles(id),
  closed_by_name text,
  closed_at timestamptz,
  resolution text,
  payload jsonb not null,
  check ((status='open' and closed_at is null and closed_by is null and resolution is null)
    or (status='closed' and closed_at is not null and closed_by is not null and length(trim(resolution)) between 1 and 500))
);
create unique index delivery_issue_one_open_item on public.delivery_issues(item_id) where status='open';
create index delivery_issue_inbox on public.delivery_issues(status,created_at desc,id desc);
alter table public.delivery_issues enable row level security;
revoke all on public.delivery_issues from anon,authenticated;

create function public.report_delivery_issue(p_id uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  prior public.delivery_issues%rowtype;
  item public.purchase_request_items%rowtype;
  req public.purchase_requests%rowtype;
  result public.delivery_issues%rowtype;
  qty numeric; received numeric; expected_received numeric; kind text; note text;
begin
  perform public.require_permission('purchasing.receive');
  if auth.uid() is null then raise exception 'Sign in first.' using errcode='42501'; end if;
  if p_id is null or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Check the issue details.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('delivery-issue:'||p_id::text,0));
  if exists(select 1 from public.audit_logs where entity_type='delivery_issue_draft' and entity_id=p_id and action='delivery_issue_draft_removed') then
    raise exception 'This unsent report was removed. Start a new report.' using errcode='40001'; end if;
  select * into prior from public.delivery_issues where id=p_id;
  if found then
    if prior.created_by<>auth.uid() or prior.payload<>p_data then raise exception 'This report ID was already used. Reopen the issue.'; end if;
    return to_jsonb(prior)-'payload';
  end if;
  kind:=p_data->>'kind'; note:=trim(coalesce(p_data->>'note',''));
  if kind is null or kind not in ('delayed','missing','damaged') or length(note)>500
    or (p_data ? 'note' and jsonb_typeof(p_data->'note') is distinct from 'string')
    or jsonb_typeof(p_data->'quantity') is distinct from 'number'
    or jsonb_typeof(p_data->'expected_received_quantity') is distinct from 'number'
    then raise exception 'Check the issue type, quantity and note.'; end if;
  qty:=(p_data->>'quantity')::numeric; expected_received:=(p_data->>'expected_received_quantity')::numeric;
  if qty<=0 or qty>999999 or qty<>round(qty,2) or expected_received<0 then raise exception 'Enter a positive quantity with up to 2 decimal places.'; end if;
  select * into item from public.purchase_request_items where id=(p_data->>'item_id')::uuid for update;
  if not found then raise exception 'Purchase item not found.' using errcode='40001'; end if;
  select * into req from public.purchase_requests where id=item.request_id;
  select coalesce(sum(purchase_quantity),0) into received from public.purchase_receipts where purchase_item_id=item.id;
  if req.status not in ('submitted','buying','completed') or item.purchase_status<>'bought'
    or item.updated_at is distinct from (p_data->>'expected_updated_at')::timestamptz
    or received<>expected_received then raise exception 'Delivery changed. Reopen the request before reporting.' using errcode='40001'; end if;
  if qty>coalesce(item.purchased_quantity,0)-received then raise exception 'Issue quantity cannot exceed the goods still to receive.'; end if;
  if exists(select 1 from public.delivery_issues where item_id=item.id and status='open') then
    raise exception 'This item already has an open issue. Check Delivery Issues.' using errcode='40001';
  end if;
  insert into public.delivery_issues(id,request_id,item_id,request_no,item_name,unit,supplier,kind,quantity,note,created_by,created_by_name,payload)
  values(p_id,item.request_id,item.id,req.request_no,item.item_name,item.unit,item.supplier,kind,qty,note,auth.uid(),
    coalesce((select full_name from public.profiles where id=auth.uid()),'Staff'),p_data) returning * into result;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_json)
  values(auth.uid(),'delivery_issue_reported','delivery_issue',p_id,to_jsonb(result)-'payload');
  return to_jsonb(result)-'payload';
end $$;

create function public.close_delivery_issue(p_id uuid,p_version integer,p_resolution text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare previous public.delivery_issues%rowtype; result public.delivery_issues%rowtype;
begin
  if auth.uid() is null or not (public.has_permission('purchasing.fulfil') or public.has_permission('purchasing.manage')) then
    raise exception 'Purchasing access required.' using errcode='42501'; end if;
  if p_resolution is null or length(trim(p_resolution)) not between 1 and 500 then raise exception 'Record the follow-up (up to 500 characters).'; end if;
  select * into previous from public.delivery_issues where id=p_id for update;
  if not found then raise exception 'Delivery issue not found.'; end if;
  if previous.status='closed' and previous.closed_by=auth.uid() and previous.resolution=trim(p_resolution) then return to_jsonb(previous)-'payload'; end if;
  if previous.status<>'open' or previous.version is distinct from p_version then raise exception 'This issue changed. Reopen it before closing.' using errcode='40001'; end if;
  update public.delivery_issues set status='closed',version=version+1,closed_at=now(),closed_by=auth.uid(),
    closed_by_name=coalesce((select full_name from public.profiles where id=auth.uid()),'Staff'),resolution=trim(p_resolution)
    where id=p_id returning * into result;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_json,after_json)
  values(auth.uid(),'delivery_issue_closed','delivery_issue',p_id,to_jsonb(previous)-'payload',to_jsonb(result)-'payload');
  return to_jsonb(result)-'payload';
end $$;

create function public.read_delivery_issues(p_status text default 'open',p_limit integer default 5,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  perform public.require_permission('purchasing.view');
  if auth.uid() is null then raise exception 'Sign in first.' using errcode='42501'; end if;
  if p_status is null or p_status not in ('open','closed') or p_limit is null or p_limit not between 1 and 50 or p_offset is null or p_offset<0 then raise exception 'Invalid issue page.'; end if;
  select jsonb_build_object('total',(select count(*) from public.delivery_issues where status=p_status),
    'open',(select count(*) from public.delivery_issues where status='open'),
    'closed',(select count(*) from public.delivery_issues where status='closed'),
    'records',coalesce(jsonb_agg(to_jsonb(r)-'payload' order by r.created_at desc,r.id desc),'[]'::jsonb)) into result
    from (select * from public.delivery_issues where status=p_status order by created_at desc,id desc limit p_limit offset p_offset) r;
  return result;
end $$;
create function public.read_delivery_issue_request(p_request_id uuid,p_draft_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  perform public.require_permission('purchasing.view');
  if auth.uid() is null then raise exception 'Sign in first.' using errcode='42501'; end if;
  select jsonb_build_object('id',r.id,'request_no',r.request_no,'status',r.status,'needed_for_date',r.needed_for_date,
    'purchase_request_items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'request_id',i.request_id,
      'item_name',i.item_name,'unit',i.unit,'quantity',i.quantity,'purchased_quantity',i.purchased_quantity,
      'purchase_status',i.purchase_status,'supplier',i.supplier,'sort_order',i.sort_order,'updated_at',i.updated_at,
      'purchase_receipts',coalesce((select jsonb_agg(jsonb_build_object('purchase_quantity',p.purchase_quantity))
        from public.purchase_receipts p where p.purchase_item_id=i.id),'[]'::jsonb)) order by i.sort_order,i.id)
      from public.purchase_request_items i where i.request_id=r.id),'[]'::jsonb)) into result
    from public.purchase_requests r where r.id=p_request_id;
  if result is null then raise exception 'Purchase request not found.'; end if;
  result:=result||jsonb_build_object('saved_issue',(select to_jsonb(i)-'payload' from public.delivery_issues i where i.id=p_draft_id and i.request_id=p_request_id),
    'removed_draft',(select a.after_json from public.audit_logs a where a.entity_id=p_draft_id and a.entity_type='delivery_issue_draft' and a.action='delivery_issue_draft_removed' and a.actor_id=auth.uid()));
  return result;
end $$;
revoke all on function public.read_delivery_issue_request(uuid,uuid) from public,anon;
grant execute on function public.read_delivery_issue_request(uuid,uuid) to authenticated;
create function public.remove_delivery_issue_draft(p_id uuid,p_data jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare previous public.audit_logs%rowtype; result jsonb;
begin
  perform public.require_permission('purchasing.receive');
  if auth.uid() is null then raise exception 'Sign in first.' using errcode='42501'; end if;
  if p_id is null or jsonb_typeof(p_data) is distinct from 'object' or length(p_data::text)>16000 or p_reason is null or length(trim(p_reason)) not between 1 and 500 then raise exception 'Enter a removal reason (up to 500 characters).'; end if;
  perform pg_advisory_xact_lock(hashtextextended('delivery-issue:'||p_id::text,0));
  if exists(select 1 from public.delivery_issues where id=p_id) then raise exception 'This report was sent. Use the recorded issue and follow-up instead.' using errcode='40001'; end if;
  select * into previous from public.audit_logs where entity_type='delivery_issue_draft' and entity_id=p_id and action='delivery_issue_draft_removed';
  if found then
    if previous.actor_id<>auth.uid() or previous.before_json<>p_data or previous.after_json->>'reason'<>trim(p_reason) then raise exception 'This removal was already recorded with different details.' using errcode='40001'; end if;
    return previous.after_json;
  end if;
  result:=jsonb_build_object('removed_at',now(),'removed_by',auth.uid(),'removed_by_name',coalesce((select full_name from public.profiles where id=auth.uid()),'Staff'),'reason',trim(p_reason),'request_no',p_data->>'request_no');
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_json,after_json)
  values(auth.uid(),'delivery_issue_draft_removed','delivery_issue_draft',p_id,p_data,result);
  return result;
end $$;
revoke all on function public.remove_delivery_issue_draft(uuid,jsonb,text) from public,anon;
grant execute on function public.remove_delivery_issue_draft(uuid,jsonb,text) to authenticated;
revoke all on function public.report_delivery_issue(uuid,jsonb),public.close_delivery_issue(uuid,integer,text),public.read_delivery_issues(text,integer,integer) from public,anon;
grant execute on function public.report_delivery_issue(uuid,jsonb),public.close_delivery_issue(uuid,integer,text),public.read_delivery_issues(text,integer,integer) to authenticated;
