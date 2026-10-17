-- One pending review connects the buying list, evidence, accounting and delivery.
-- Confirmation never changes inventory; the existing receiving transaction does that.
alter table public.receipt_reviews add column request_id uuid references public.purchase_requests(id),
  add column request_snapshot jsonb, add column purchase_result jsonb;
create unique index receipt_review_one_pending_request on public.receipt_reviews(created_by,request_id)
  where status='pending' and request_id is not null;

-- Snapshot names/units in each new event, so later renames cannot relabel old quantities.
create or replace function public.receipt_review_event(p_id uuid,p_action text,p_before jsonb,p_after jsonb) returns void
language plpgsql security definer set search_path=public as $$declare labels jsonb;begin
  select jsonb_object_agg(i->>'id',(i->>'item_name')||' ('||(i->>'unit')||')') into labels
    from receipt_reviews r cross join jsonb_array_elements(r.request_snapshot->'purchase_request_items') i where r.id=p_id;
  if labels is not null and p_action in ('created','edited','buying_list_refreshed') then
    if p_before is not null then p_before:=jsonb_build_object('request_labels',labels)||p_before;end if;
    if p_after is not null then p_after:=jsonb_build_object('request_labels',labels)||p_after;end if;
  end if;
  insert into receipt_review_events(review_id,action,actor_id,actor_name,before_json,after_json)
    values(p_id,p_action,auth.uid(),coalesce((select nullif(trim(full_name),'') from profiles where id=auth.uid()),'Receipt Scanner'),p_before,p_after);
end$$;

create function public.receipt_request_snapshot(p_request_id uuid) returns jsonb
language sql stable security definer set search_path=public as $$
  select to_jsonb(r)||jsonb_build_object('purchase_request_items',coalesce((select jsonb_agg(to_jsonb(i) order by i.sort_order,i.id)
    from purchase_request_items i where i.request_id=r.id),'[]')) from purchase_requests r where r.id=p_request_id;
$$;
revoke all on function public.receipt_request_snapshot(uuid) from public,anon,authenticated;

create function public.start_request_receipt_review(p_id uuid,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r receipt_reviews%rowtype;s jsonb;d jsonb;purpose text;
begin
  perform public.require_permission('purchasing.fulfil');perform public.require_permission('purchasing.cost.view');
  if auth.uid() is null or p_id is null or p_request_id is null then raise exception 'A request and review ID are required.';end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,65));
  select * into r from receipt_reviews where id=p_id;
  if found then
    if r.created_by<>auth.uid() or r.request_id is distinct from p_request_id then raise exception 'Review belongs to another purchase.' using errcode='42501';end if;
    return to_jsonb(r)-'scan_token';
  end if;
  select * into r from receipt_reviews where request_id=p_request_id and created_by=auth.uid() and status='pending';
  if found then return to_jsonb(r)-'scan_token';end if;
  s:=public.receipt_request_snapshot(p_request_id);
  if s is null or s->>'status' not in ('submitted','buying','completed') then raise exception 'Request is not open for purchasing.';end if;
  purpose:=case lower(trim(s->>'purpose')) when 'guest meals' then 'guest_meals' when 'staff meals' then 'staff_meals' when 'bar' then 'bar' when 'guest_meals' then 'guest_meals' when 'staff_meals' then 'staff_meals' else '' end;
  d:=jsonb_build_object('purpose',purpose,'supplier','','address','','tax_id','','phone','','receipt_no','','purchase_date','','currency','MYR','total_cost','','subtotal','','tax','','discount','','receipt',null,'items',null,'lines','[]'::jsonb,'notes','','review_note','');
  perform public.save_receipt_review(p_id,0,d);
  update receipt_reviews set request_id=p_request_id,request_snapshot=s,data=d||jsonb_build_object('request_entries','{}'::jsonb) where id=p_id returning * into r;
  perform public.receipt_review_event(p_id,'request_linked',null,jsonb_build_object('request_id',p_request_id,'request_no',s->>'request_no'));
  return to_jsonb(r)-'scan_token';
end$$;

alter function public.save_receipt_review(uuid,integer,jsonb) rename to save_receipt_review_before_request;
revoke all on function public.save_receipt_review_before_request(uuid,integer,jsonb) from public,anon,authenticated;
create function public.save_receipt_review(p_id uuid,p_version integer,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r receipt_reviews%rowtype;e record;
begin
  perform public.require_permission('purchasing.fulfil');perform public.require_permission('purchasing.cost.view');
  select * into r from receipt_reviews where id=p_id;
  if r.request_id is not null then
    if jsonb_typeof(p_data->'request_entries') is distinct from 'object' then raise exception 'Check bought quantities.';end if;
    for e in select * from jsonb_each(p_data->'request_entries') loop
      if not exists(select 1 from jsonb_array_elements(r.request_snapshot->'purchase_request_items') i where i->>'id'=e.key)
        or jsonb_typeof(e.value->'quantity') is distinct from 'string' or jsonb_typeof(e.value->'cost') is distinct from 'string'
        or length(e.value->>'quantity')>40 or length(e.value->>'cost')>40 then raise exception 'Invalid buying list entry.';end if;
    end loop;
  elsif coalesce(p_data->'request_entries','{}')<>'{}'::jsonb then raise exception 'Open this purchase from the buying list first.';
  end if;
  return public.save_receipt_review_before_request(p_id,p_version,p_data);
end$$;

create function public.refresh_request_receipt_review(p_id uuid,p_version integer) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r receipt_reviews%rowtype;s jsonb;entries jsonb;before_data jsonb;
begin
  perform public.require_permission('purchasing.fulfil');perform public.require_permission('purchasing.cost.view');
  select * into r from receipt_reviews where id=p_id for update;
  if r.id is null or r.created_by<>auth.uid() or r.request_id is null then raise exception 'Permission denied' using errcode='42501';end if;
  if r.status<>'pending' or r.scan_status='scanning' or r.version is distinct from p_version then raise exception 'Review changed. Reopen it.' using errcode='40001';end if;
  s:=public.receipt_request_snapshot(r.request_id);
  if s->>'status' not in ('submitted','buying','completed') then raise exception 'Request is no longer open. Keep or remove this pending receipt with a reason.';end if;
  select coalesce(jsonb_object_agg(e.key,e.value),'{}') into entries from jsonb_each(r.data->'request_entries') e
    join jsonb_array_elements(r.request_snapshot->'purchase_request_items') old on old->>'id'=e.key
    join jsonb_array_elements(s->'purchase_request_items') fresh on fresh->>'id'=e.key
    where old->>'item_name'=fresh->>'item_name' and old->>'unit'=fresh->>'unit';
  before_data:=r.data||jsonb_build_object('request_labels',(select jsonb_object_agg(i->>'id',(i->>'item_name')||' ('||(i->>'unit')||')') from jsonb_array_elements(r.request_snapshot->'purchase_request_items') i));
  update receipt_reviews set request_snapshot=s,data=jsonb_set(data,'{request_entries}',entries),version=version+1,updated_at=clock_timestamp() where id=p_id returning * into r;
  perform public.receipt_review_event(p_id,'buying_list_refreshed',before_data,r.data);
  return to_jsonb(r)-'scan_token';
end$$;

-- Keep the existing finance aggregation, payment metadata and cost permissions.
alter function public.read_expense_receipts(date,date) rename to read_expense_receipts_before_request_review;
revoke all on function public.read_expense_receipts_before_request_review(date,date) from public,anon,authenticated;
create function public.read_expense_receipts(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare rows jsonb;
begin
  rows:=public.read_expense_receipts_before_request_review(p_from,p_to);
  return coalesce((select jsonb_agg(e||case when r.id is null then '{}'::jsonb else jsonb_build_object('accounting_details',
    jsonb_build_object('review_id',r.id,'address',r.data->>'address','tax_id',r.data->>'tax_id','phone',r.data->>'phone','currency',r.data->>'currency','subtotal',r.data->>'subtotal','tax',r.data->>'tax','discount',r.data->>'discount','review_note',r.data->>'review_note','extraction',r.extraction,'scan_status',r.scan_status,'model',r.model)) end order by ord)
    from jsonb_array_elements(rows) with ordinality q(e,ord) left join receipt_reviews r on r.purchase_result->>'id'=e->>'id' and r.status='confirmed'),'[]');
end$$;

alter function public.confirm_receipt_review(uuid,integer,boolean) rename to confirm_receipt_review_before_request;
revoke all on function public.confirm_receipt_review_before_request(uuid,integer,boolean) from public,anon,authenticated;
create function public.confirm_receipt_review(p_id uuid,p_version integer,p_verified boolean) returns jsonb
language plpgsql security definer set search_path=public as $$
<<review_confirm>>
declare r receipt_reviews%rowtype;d jsonb;e record;i jsonb;l jsonb;items jsonb:='[]';lines jsonb:='[]';result jsonb;receipt jsonb;needs_note boolean;k text;v_quantity numeric;v_cost numeric;
begin
  perform public.require_permission('purchasing.fulfil');perform public.require_permission('purchasing.cost.view');
  perform pg_advisory_xact_lock(73081,1);
  select * into r from receipt_reviews where id=p_id for update;
  if r.id is null or r.created_by<>auth.uid() then raise exception 'Only the purchaser can confirm this receipt.' using errcode='42501';end if;
  if r.request_id is null then return public.confirm_receipt_review_before_request(p_id,p_version,p_verified);end if;
  if r.status='confirmed' then return r.purchase_result;end if;
  if r.status<>'pending' or r.scan_status='scanning' or r.version is distinct from p_version then raise exception 'Receipt changed. Reopen and review it.' using errcode='40001';end if;
  if p_verified is distinct from true then raise exception 'Review and verify the receipt before confirming.';end if;
  d:=r.data;
  if d->>'currency'<>'MYR' then raise exception 'Only MYR receipts can be confirmed here.';end if;
  foreach k in array array['total_cost','subtotal','tax','discount'] loop
    if (k='total_cost' or d->>k<>'') and (d->>k !~ '^\d{1,8}(\.\d{1,2})?$' or (d->>k)::numeric>99999999.99) then raise exception 'Check the receipt total, tax and discounts.';end if;
  end loop;
  for l in select value from jsonb_array_elements(d->'lines') loop
    if coalesce(length(trim(l->>'name')),0) not between 1 and 120 or coalesce(l->>'category','') not in ('Vegetables','Seafood','Meat & Eggs','Rice & Dry Goods','Seasoning & Oil','Cooking Gas','Bar Drinks','Other')
      or coalesce(l->>'unit','') not in ('kg','g','L','ml','pcs','biji','ekor','pack','bag','gelen','botol','bottle','tin','cylinder','carton')
      or coalesce(l->>'quantity','') !~ '^\d+(\.\d{1,4})?$' or (l->>'quantity')::numeric<=0 or (l->>'quantity')::numeric>1e9
      or coalesce(l->>'amount','') !~ '^\d{1,8}(\.\d{1,2})?$' then raise exception 'Check receipt item details.';end if;
    lines:=lines||jsonb_build_array(jsonb_build_object('name',l->>'name','category',l->>'category','unit',l->>'unit','quantity',(l->>'quantity')::numeric,'amount',(l->>'amount')::numeric));
  end loop;
  needs_note:=trim(coalesce(d->>'receipt_no',''))='' or trim(coalesce(d->>'address',''))='' or trim(coalesce(d->>'tax_id',''))='' or jsonb_array_length(lines)=0 or r.scan_status='failed' or coalesce(jsonb_array_length(r.extraction->'unreadable'),0)>0 or coalesce(jsonb_array_length(r.extraction->'warnings'),0)>0;
  if jsonb_array_length(lines)>0 and (d->>'total_cost')::numeric-(select sum((entry.value->>'amount')::numeric) from jsonb_array_elements(lines) entry)-coalesce(nullif(d->>'tax','')::numeric,0)+coalesce(nullif(d->>'discount','')::numeric,0)<>0 then needs_note:=true;end if;
  if needs_note and nullif(trim(d->>'review_note'),'') is null then raise exception 'Record how you checked the missing or unreadable details.';end if;
  for e in select * from jsonb_each(d->'request_entries') order by key loop
    if trim(e.value->>'quantity')='' and trim(e.value->>'cost')='' then continue;end if;
    select value into i from jsonb_array_elements(r.request_snapshot->'purchase_request_items') where value->>'id'=e.key;
    if i is null or coalesce(trim(e.value->>'quantity'),'') !~ '^\d+(\.\d{1,2})?$' or (e.value->>'quantity')::numeric<=0
      or (trim(e.value->>'cost')<>'' and trim(e.value->>'cost') !~ '^\d{1,8}(\.\d{1,2})?$') then raise exception 'Check bought quantities and costs.';end if;
    if not exists(select 1 from purchase_request_items current where current.id=e.key::uuid and current.request_id=r.request_id and current.item_name=i->>'item_name' and current.unit=i->>'unit') then raise exception 'An item or unit changed. Refresh the buying list.' using errcode='40001';end if;
    v_quantity:=(e.value->>'quantity')::numeric;v_cost:=nullif(trim(e.value->>'cost'),'')::numeric;
    items:=items||jsonb_build_array(jsonb_build_object('id',e.key,'expected_updated_at',i->'updated_at','quantity',v_quantity,'actual_cost',v_cost));
  end loop;
  result:=public.record_purchase_batch_checked(r.request_id,items,trim(d->>'supplier'),trim(d->>'receipt_no'),p_id,jsonb_build_object('purpose',d->>'purpose','purchase_date',d->>'purchase_date','total_cost',(d->>'total_cost')::numeric,'receipt_path',d#>>'{receipt,path}','receipt_hash',d#>>'{receipt,hash}','items_path',d#>>'{items,path}','items_hash',d#>>'{items,hash}'));
  update purchase_evidence set lines=review_confirm.lines where record_id=(result->>'id')::uuid;
  select value into receipt from jsonb_array_elements(public.read_expense_receipts((d->>'purchase_date')::date,(d->>'purchase_date')::date)) where value->>'id'=result->>'id';
  update receipt_reviews set status='confirmed',purchase_result=receipt,confirmed_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 where id=p_id;
  select value into receipt from jsonb_array_elements(public.read_expense_receipts((d->>'purchase_date')::date,(d->>'purchase_date')::date)) where value->>'id'=result->>'id';
  update receipt_reviews set purchase_result=receipt where id=p_id;
  perform public.receipt_review_event(p_id,'confirmed',null,jsonb_build_object('receipt_id',result->>'id','request_id',r.request_id,'verified',true,'review_note',d->>'review_note'));
  return receipt;
end$$;

do $$declare f text;begin foreach f in array array['start_request_receipt_review(uuid,uuid)','refresh_request_receipt_review(uuid,integer)','save_receipt_review(uuid,integer,jsonb)','read_expense_receipts(date,date)','confirm_receipt_review(uuid,integer,boolean)'] loop
  execute 'revoke all on function public.'||f||' from public,anon';execute 'grant execute on function public.'||f||' to authenticated';end loop;end$$;
