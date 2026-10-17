-- Receipt shortages use the same follow-up inbox, without changing stock or costs.
alter table public.delivery_issues
  alter column request_id drop not null,
  alter column item_id drop not null,
  add column receipt_id uuid references public.receipt_delivery_sources(id),
  add column receipt_line_id uuid,
  drop constraint delivery_issues_quantity_check,
  add constraint delivery_issue_source check (
    (request_id is not null and item_id is not null and receipt_id is null and receipt_line_id is null)
    or (request_id is null and item_id is null and receipt_id is not null and receipt_line_id is not null)),
  add constraint delivery_issues_quantity_check check (
    quantity > 0 and quantity <= 999999 and quantity = round(quantity,case when receipt_id is null then 2 else 4 end));
create unique index delivery_issue_one_open_receipt_line on public.delivery_issues(receipt_id,receipt_line_id)
  where status='open' and receipt_id is not null;

create function public.read_receipt_delivery_issue(p_receipt_id uuid,p_draft_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  perform public.require_permission('purchasing.receive');
  if auth.uid() is null then raise exception 'Sign in first.' using errcode='42501';end if;
  return public.receipt_delivery_request(p_receipt_id)||jsonb_build_object(
    'saved_issue',(select to_jsonb(i)-'payload' from public.delivery_issues i where i.id=p_draft_id and i.receipt_id=p_receipt_id),
    'removed_draft',(select a.after_json from public.audit_logs a where a.entity_id=p_draft_id
      and a.entity_type='delivery_issue_draft' and a.action='delivery_issue_draft_removed' and a.actor_id=auth.uid()));
end $$;

create function public.report_receipt_delivery_issue(p_id uuid,p_receipt_id uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare prior public.delivery_issues%rowtype;result public.delivery_issues%rowtype;
  r jsonb;item jsonb;qty numeric;received numeric;expected_received numeric;kind text;note text;
begin
  perform public.require_permission('purchasing.receive');
  if auth.uid() is null then raise exception 'Sign in first.' using errcode='42501';end if;
  if p_id is null or p_receipt_id is null or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Check the issue details.';end if;
  -- Same ordering as receipt confirmation, followed by the report retry lock.
  perform pg_advisory_xact_lock(73081,1);
  perform pg_advisory_xact_lock(hashtextextended('delivery-issue:'||p_id::text,0));
  if exists(select 1 from public.audit_logs where entity_type='delivery_issue_draft' and entity_id=p_id and action='delivery_issue_draft_removed') then
    raise exception 'This unsent report was removed. Start a new report.' using errcode='40001';end if;
  select * into prior from public.delivery_issues where id=p_id;
  if found then
    if prior.receipt_id is distinct from p_receipt_id or prior.created_by<>auth.uid() or prior.payload<>p_data then raise exception 'This report ID was already used. Reopen the issue.';end if;
    return to_jsonb(prior)-'payload';
  end if;
  kind:=p_data->>'kind';note:=trim(coalesce(p_data->>'note',''));
  if kind is null or kind not in('delayed','missing','damaged') or length(note)>500
    or (p_data ? 'note' and jsonb_typeof(p_data->'note') is distinct from 'string')
    or jsonb_typeof(p_data->'quantity') is distinct from 'number'
    or jsonb_typeof(p_data->'expected_received_quantity') is distinct from 'number'
    then raise exception 'Check the issue type, quantity and note.';end if;
  qty:=(p_data->>'quantity')::numeric;expected_received:=(p_data->>'expected_received_quantity')::numeric;
  if qty<=0 or qty>999999 or qty<>round(qty,4) or expected_received<0 then raise exception 'Enter a positive quantity with up to 4 decimal places.';end if;
  perform 1 from public.expense_receipts where id=p_receipt_id and status='confirmed' for update;
  if not found then raise exception 'Delivery changed. Reopen the receipt before reporting.' using errcode='40001';end if;
  r:=public.receipt_delivery_request(p_receipt_id);
  select value into item from jsonb_array_elements(r->'purchase_request_items') where value->>'id'=p_data->>'item_id';
  select coalesce(sum((value->>'purchase_quantity')::numeric),0) into received from jsonb_array_elements(item->'purchase_receipts');
  if item is null or (item->>'updated_at')::timestamptz is distinct from (p_data->>'expected_updated_at')::timestamptz
    or received<>expected_received then raise exception 'Delivery changed. Reopen the receipt before reporting.' using errcode='40001';end if;
  if qty>(item->>'purchased_quantity')::numeric-received then raise exception 'Issue quantity cannot exceed the goods still to receive.';end if;
  if exists(select 1 from public.delivery_issues where receipt_id=p_receipt_id and receipt_line_id=(item->>'id')::uuid and status='open') then
    raise exception 'This item already has an open issue. Check Delivery Issues.' using errcode='40001';end if;
  insert into public.delivery_issues(id,receipt_id,receipt_line_id,request_no,item_name,unit,supplier,kind,quantity,note,created_by,created_by_name,payload)
    values(p_id,p_receipt_id,(item->>'id')::uuid,r->>'request_no',item->>'item_name',item->>'unit',r->>'supplier',kind,qty,note,auth.uid(),
      coalesce((select full_name from public.profiles where id=auth.uid()),'Staff'),p_data) returning * into result;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_json)
    values(auth.uid(),'delivery_issue_reported','delivery_issue',p_id,to_jsonb(result)-'payload');
  return to_jsonb(result)-'payload';
end $$;

-- Keep request reporting intact while preventing an ID from switching source types.
alter function public.report_delivery_issue(uuid,jsonb) rename to report_request_delivery_issue_internal;
revoke all on function public.report_request_delivery_issue_internal(uuid,jsonb) from public,anon,authenticated;
create function public.report_delivery_issue(p_id uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public.require_permission('purchasing.receive');
  if auth.uid() is null then raise exception 'Sign in first.' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended('delivery-issue:'||p_id::text,0));
  if exists(select 1 from public.delivery_issues where id=p_id and receipt_id is not null) then raise exception 'This report ID was already used. Reopen the issue.';end if;
  return public.report_request_delivery_issue_internal(p_id,p_data);
end $$;
revoke all on function public.read_receipt_delivery_issue(uuid,uuid),public.report_receipt_delivery_issue(uuid,uuid,jsonb),public.report_delivery_issue(uuid,jsonb) from public,anon;
grant execute on function public.read_receipt_delivery_issue(uuid,uuid),public.report_receipt_delivery_issue(uuid,uuid,jsonb),public.report_delivery_issue(uuid,jsonb) to authenticated;
