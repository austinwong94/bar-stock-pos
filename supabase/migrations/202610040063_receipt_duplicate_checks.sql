-- Cross-screen checks run under the same transaction lock as both purchase writers.
-- Pending reviews never reserve a receipt: the first verified confirmation wins.
create index purchase_evidence_receipt_hash on public.purchase_evidence(receipt_hash);
create index receipt_reviews_pending_photo on public.receipt_reviews((data#>>'{receipt,hash}')) where status='pending';
create index receipt_reviews_pending_number on public.receipt_reviews(lower(trim(data->>'supplier')),lower(trim(data->>'receipt_no'))) where status='pending';

create function public.receipt_duplicate_matches(p_supplier text,p_receipt_no text,p_receipt_hash text,p_exclude_review_id uuid default null) returns jsonb
language sql stable security definer set search_path=public as $$
  with candidates as (
    select e.id,'receipt' as source,'confirmed' as status,e.supplier,e.receipt_no,e.receipt_hash,e.purchase_date::text,e.total_cost,e.created_by_name,e.created_at,e.receipt_path,e.items_path
      from expense_receipts e where e.status='confirmed'
    union all
    select e.record_id,'request','confirmed',coalesce(a.after_json->>'supplier',''),coalesce(a.after_json->>'reference',''),e.receipt_hash,e.purchase_date::text,e.total_cost,coalesce(a.after_json->>'confirmed_by_name','Name Not Recorded'),e.created_at,e.receipt_path,e.items_path
      from purchase_evidence e join audit_logs a on a.id=e.record_id
    union all
    select r.id,'review','pending',r.data->>'supplier',r.data->>'receipt_no',r.data#>>'{receipt,hash}',r.data->>'purchase_date',
      case when r.data->>'total_cost' ~ '^\d{1,8}(\.\d{1,2})?$' then (r.data->>'total_cost')::numeric end,r.created_by_name,r.created_at,r.data#>>'{receipt,path}',r.data#>>'{items,path}'
      from receipt_reviews r where r.status='pending' and r.id is distinct from p_exclude_review_id
  ), matches as (
    select c.*,case when nullif(p_receipt_hash,'')=c.receipt_hash then 'photo' else 'number' end as match from candidates c
      where (nullif(p_receipt_hash,'')=c.receipt_hash)
        or (nullif(trim(p_supplier),'') is not null and nullif(trim(p_receipt_no),'') is not null
          and lower(trim(c.supplier))=lower(trim(p_supplier)) and lower(trim(c.receipt_no))=lower(trim(p_receipt_no)))
    order by status,created_at desc,id limit 20
  ) select coalesce(jsonb_agg(to_jsonb(m) order by status,created_at desc,id),'[]') from matches m;
$$;
revoke all on function public.receipt_duplicate_matches(text,text,text,uuid) from public,anon,authenticated;

create function public.check_purchase_receipt_duplicates(p_supplier text,p_receipt_no text,p_receipt_hash text,p_exclude_review_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public as $$begin
  perform public.require_permission('purchasing.view');perform public.require_permission('purchasing.cost.view');
  if length(p_supplier)>160 or length(p_receipt_no)>120 or (coalesce(p_receipt_hash,'')<>'' and p_receipt_hash!~'^[a-f0-9]{64}$') then raise exception 'Check receipt details.';end if;
  return public.receipt_duplicate_matches(p_supplier,p_receipt_no,p_receipt_hash,p_exclude_review_id);
end$$;
revoke all on function public.check_purchase_receipt_duplicates(text,text,text,uuid) from public,anon;
grant execute on function public.check_purchase_receipt_duplicates(text,text,text,uuid) to authenticated;

create function public.assert_purchase_receipt_unique(p_supplier text,p_receipt_no text,p_receipt_hash text) returns void
language plpgsql security definer set search_path=public as $$begin
  if exists(select 1 from jsonb_array_elements(public.receipt_duplicate_matches(p_supplier,p_receipt_no,p_receipt_hash)) m where m->>'status'='confirmed') then
    raise exception 'This receipt is already recorded. Check the matching receipt before continuing.' using errcode='23505';
  end if;
end$$;
revoke all on function public.assert_purchase_receipt_unique(text,text,text) from public,anon,authenticated;

alter function public.save_expense_receipt(jsonb,uuid) rename to save_expense_receipt_before_duplicate_check;
revoke all on function public.save_expense_receipt_before_duplicate_check(jsonb,uuid) from public,anon,authenticated;
create function public.save_expense_receipt(p_receipt jsonb,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$begin
  perform public.require_permission('purchasing.fulfil');perform public.require_permission('purchasing.cost.view');
  perform pg_advisory_xact_lock(73081,1);
  if not exists(select 1 from operation_requests where actor_id=auth.uid() and operation='expense_receipt' and request_id=p_operation_id) then
    perform public.assert_purchase_receipt_unique(p_receipt->>'supplier',p_receipt->>'receipt_no',p_receipt->>'receipt_hash');
  end if;
  return public.save_expense_receipt_before_duplicate_check(p_receipt,p_operation_id);
end$$;
revoke all on function public.save_expense_receipt(jsonb,uuid) from public,anon,authenticated;

alter function public.record_purchase_batch_checked(uuid,jsonb,text,text,uuid,jsonb) rename to record_purchase_batch_before_duplicate_check;
revoke all on function public.record_purchase_batch_before_duplicate_check(uuid,jsonb,text,text,uuid,jsonb) from public,anon,authenticated;
create function public.record_purchase_batch_checked(p_request_id uuid,p_items jsonb,p_supplier text,p_reference text,p_operation_id uuid,p_evidence jsonb default null) returns jsonb
language plpgsql security definer set search_path=public as $$begin
  perform public.require_permission('purchasing.fulfil');perform public.require_permission('purchasing.cost.view');
  perform pg_advisory_xact_lock(73081,1);
  if not exists(select 1 from operation_requests where actor_id=auth.uid() and operation='record_purchase_batch' and request_id=p_operation_id) then
    perform public.assert_purchase_receipt_unique(p_supplier,p_reference,p_evidence->>'receipt_hash');
  end if;
  return public.record_purchase_batch_before_duplicate_check(p_request_id,p_items,p_supplier,p_reference,p_operation_id,p_evidence);
end$$;
revoke all on function public.record_purchase_batch_checked(uuid,jsonb,text,text,uuid,jsonb) from public,anon;
grant execute on function public.record_purchase_batch_checked(uuid,jsonb,text,text,uuid,jsonb) to authenticated;
