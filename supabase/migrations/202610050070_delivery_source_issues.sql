-- Source-scoped lookup prevents duplicate work before a receiver starts a report.
create index delivery_issues_open_request on public.delivery_issues(request_id) where status='open';

create function public.read_delivery_source_issues(p_request_id uuid default null,p_receipt_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  perform public.require_permission('purchasing.view');
  if auth.uid() is null then raise exception 'Sign in first.' using errcode='42501';end if;
  if (p_request_id is null) = (p_receipt_id is null) then raise exception 'Choose one delivery source.';end if;
  select coalesce(jsonb_agg(public.delivery_issue_with_updates(i.id) order by i.created_at,i.id),'[]') into result
    from public.delivery_issues i where i.status='open' and
      ((p_request_id is not null and i.request_id=p_request_id) or (p_receipt_id is not null and i.receipt_id=p_receipt_id));
  return result;
end $$;
revoke all on function public.read_delivery_source_issues(uuid,uuid) from public,anon;
grant execute on function public.read_delivery_source_issues(uuid,uuid) to authenticated;
