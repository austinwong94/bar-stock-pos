-- Updates are append-only audit entries. A supplier promise is not a resolution.
create index delivery_issue_update_history on public.audit_logs(entity_id,created_at desc,id desc)
  where entity_type='delivery_issue' and action='delivery_issue_updated';

create function public.add_delivery_issue_update(p_id uuid,p_issue_id uuid,p_version integer,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare prior public.audit_logs%rowtype;issue public.delivery_issues%rowtype;result jsonb;
begin
  if auth.uid() is null or not(public.has_permission('purchasing.fulfil') or public.has_permission('purchasing.manage')) then
    raise exception 'Purchasing access required.' using errcode='42501';end if;
  if p_id is null or p_issue_id is null or p_version is null or p_version<1 or p_note is null or length(trim(p_note)) not between 1 and 500 then
    raise exception 'Enter an update (up to 500 characters).';end if;
  perform pg_advisory_xact_lock(hashtextextended('delivery-issue-update:'||p_id::text,0));
  select * into prior from public.audit_logs where id=p_id;
  if found then
    if prior.actor_id is distinct from auth.uid() or prior.entity_type is distinct from 'delivery_issue'
      or prior.entity_id is distinct from p_issue_id or prior.action is distinct from 'delivery_issue_updated'
      or (prior.before_json->>'version')::integer is distinct from p_version or prior.after_json->>'note' is distinct from trim(p_note) then
      raise exception 'This update ID was already used with different details.' using errcode='40001';end if;
    return prior.after_json;
  end if;
  select * into issue from public.delivery_issues where id=p_issue_id for update;
  if not found or issue.status<>'open' or issue.version<>p_version then
    raise exception 'This issue changed. Reopen it before adding an update.' using errcode='40001';end if;
  update public.delivery_issues set version=version+1 where id=issue.id;
  result:=jsonb_build_object('id',p_id,'issue_id',issue.id,'version',issue.version+1,'note',trim(p_note),
    'created_by',auth.uid(),'created_by_name',coalesce((select full_name from public.profiles where id=auth.uid()),'Staff'),'created_at',clock_timestamp());
  insert into public.audit_logs(id,actor_id,action,entity_type,entity_id,before_json,after_json)
    values(p_id,auth.uid(),'delivery_issue_updated','delivery_issue',issue.id,to_jsonb(issue)-'payload',result);
  return result;
end $$;

create function public.delivery_issue_with_updates(p_id uuid) returns jsonb
language sql stable security definer set search_path=public as $$
  select (to_jsonb(i)-'payload')||jsonb_build_object(
    'update_count',(select count(*) from public.audit_logs a where a.entity_id=i.id and a.entity_type='delivery_issue' and a.action='delivery_issue_updated'),
    'latest_update',(select a.after_json from public.audit_logs a where a.entity_id=i.id and a.entity_type='delivery_issue' and a.action='delivery_issue_updated'
      order by (a.after_json->>'version')::integer desc limit 1)) from public.delivery_issues i where i.id=p_id;
$$;

create function public.read_delivery_issue_updates(p_issue_id uuid,p_limit integer default 5,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare issue jsonb;records jsonb;
begin
  perform public.require_permission('purchasing.view');
  if auth.uid() is null then raise exception 'Sign in first.' using errcode='42501';end if;
  if p_limit is null or p_limit not between 1 and 50 or p_offset is null or p_offset<0 then raise exception 'Invalid update page.';end if;
  issue:=public.delivery_issue_with_updates(p_issue_id);
  if issue is null then raise exception 'Delivery issue not found.';end if;
  select coalesce(jsonb_agg(r.after_json order by (r.after_json->>'version')::integer desc),'[]') into records from
    (select a.after_json from public.audit_logs a where a.entity_id=p_issue_id and a.entity_type='delivery_issue' and a.action='delivery_issue_updated'
      order by (a.after_json->>'version')::integer desc limit p_limit offset p_offset) r;
  return jsonb_build_object('issue',issue,'total',issue->'update_count','records',records);
end $$;

create or replace function public.read_delivery_issues(p_status text default 'open',p_limit integer default 5,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  perform public.require_permission('purchasing.view');
  if auth.uid() is null then raise exception 'Sign in first.' using errcode='42501';end if;
  if p_status is null or p_status not in('open','closed') or p_limit is null or p_limit not between 1 and 50 or p_offset is null or p_offset<0 then raise exception 'Invalid issue page.';end if;
  select jsonb_build_object('total',(select count(*) from public.delivery_issues where status=p_status),
    'open',(select count(*) from public.delivery_issues where status='open'),
    'closed',(select count(*) from public.delivery_issues where status='closed'),
    'records',coalesce(jsonb_agg(public.delivery_issue_with_updates(r.id) order by r.created_at desc,r.id desc),'[]')) into result
    from(select * from public.delivery_issues where status=p_status order by created_at desc,id desc limit p_limit offset p_offset) r;
  return result;
end $$;
revoke all on function public.delivery_issue_with_updates(uuid) from public,anon,authenticated;
revoke all on function public.add_delivery_issue_update(uuid,uuid,integer,text),public.read_delivery_issue_updates(uuid,integer,integer) from public,anon;
grant execute on function public.add_delivery_issue_update(uuid,uuid,integer,text),public.read_delivery_issue_updates(uuid,integer,integer) to authenticated;
