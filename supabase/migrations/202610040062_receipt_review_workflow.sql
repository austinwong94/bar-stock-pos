-- Receipt capture is not an expense until explicitly reviewed and confirmed.
-- Client roles cannot delete evidence or rewrite the append-only event history.
revoke execute on function public.save_expense_receipt(jsonb,uuid) from public,anon,authenticated;
alter table public.purchase_suppliers add column address text not null default '', add column tax_id text not null default '',
  add column phone text not null default '', add column version integer not null default 1;
alter table public.expense_receipts add column accounting_details jsonb;
create table public.receipt_ai_settings (
  singleton boolean primary key default true check(singleton), enabled boolean not null default false,
  daily_limit integer not null default 100 check(daily_limit between 1 and 1000), model text not null default 'gpt-6-luna' check(model='gpt-6-luna'),
  version integer not null default 1
);
insert into public.receipt_ai_settings(singleton) values(true);
create table public.receipt_reviews (
  id uuid primary key, data jsonb not null, version integer not null default 1,
  status text not null default 'pending' check(status in ('pending','confirmed','deleted')),
  created_by uuid not null references auth.users(id),created_by_name text not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  scan_status text not null default 'idle' check(scan_status in ('idle','scanning','complete','failed')),
  scan_token uuid,scan_started_at timestamptz,scan_error text,extraction jsonb,model text,usage jsonb,
  result_id uuid references public.expense_receipts(id),confirmed_at timestamptz,deleted_at timestamptz,delete_reason text
);
create index receipt_reviews_status_time on public.receipt_reviews(status,updated_at desc);
create table public.receipt_review_events (
  id uuid primary key default gen_random_uuid(),review_id uuid references public.receipt_reviews(id),
  action text not null,actor_id uuid references auth.users(id),actor_name text not null,
  created_at timestamptz not null default now(),before_json jsonb,after_json jsonb
);
create index receipt_review_events_record on public.receipt_review_events(review_id,created_at);
alter table public.receipt_ai_settings enable row level security;
alter table public.receipt_reviews enable row level security;
alter table public.receipt_review_events enable row level security;
revoke all on public.receipt_ai_settings,public.receipt_reviews,public.receipt_review_events from anon,authenticated;

create function public.receipt_review_event(p_id uuid,p_action text,p_before jsonb,p_after jsonb) returns void
language plpgsql security definer set search_path=public as $$begin
  insert into receipt_review_events(review_id,action,actor_id,actor_name,before_json,after_json)
  values(p_id,p_action,auth.uid(),coalesce((select nullif(trim(full_name),'') from profiles where id=auth.uid()),'Receipt Scanner'),p_before,p_after);
end$$;
revoke all on function public.receipt_review_event(uuid,text,jsonb,jsonb) from public,anon,authenticated;

create function public.read_receipt_ai_settings() returns jsonb language plpgsql stable security definer set search_path=public as $$begin
  if not (public.has_permission('purchasing.view') or public.has_permission('platform.settings.manage')) then raise exception 'Permission denied' using errcode='42501';end if;
  return (select to_jsonb(s)-'singleton' from receipt_ai_settings s);
end$$;
create function public.save_receipt_ai_settings(p_enabled boolean,p_daily_limit integer,p_version integer) returns jsonb
language plpgsql security definer set search_path=public as $$declare old receipt_ai_settings%rowtype;r receipt_ai_settings%rowtype;begin
  perform public.require_permission('platform.settings.manage');select * into old from receipt_ai_settings for update;
  if old.version is distinct from p_version then raise exception 'Settings changed. Reload before saving.' using errcode='40001';end if;
  update receipt_ai_settings set enabled=p_enabled,daily_limit=p_daily_limit,version=version+1 returning * into r;
  perform receipt_review_event(null,'scan_settings_changed',to_jsonb(old),to_jsonb(r));return to_jsonb(r)-'singleton';
end$$;
create function public.read_purchase_supplier_profiles() returns jsonb language plpgsql stable security definer set search_path=public as $$begin
  perform public.require_permission('purchasing.view');perform public.require_permission('purchasing.cost.view');
  return coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'address',address,'tax_id',tax_id,'phone',phone,'version',version) order by lower(name)) from purchase_suppliers),'[]');
end$$;
create function public.save_purchase_supplier_profile(p_profile jsonb,p_version integer) returns jsonb
language plpgsql security definer set search_path=public as $$declare old purchase_suppliers%rowtype;r purchase_suppliers%rowtype;n text:=trim(p_profile->>'name');begin
  perform public.require_permission('purchasing.fulfil');perform public.require_permission('purchasing.cost.view');perform pg_advisory_xact_lock(73082,1);
  if coalesce(length(n),0) not between 1 and 160 or length(coalesce(p_profile->>'address',''))>1000 or length(coalesce(p_profile->>'tax_id',''))>120 or length(coalesce(p_profile->>'phone',''))>100 then raise exception 'Check supplier details.';end if;
  select * into old from purchase_suppliers where lower(trim(name))=lower(n) for update;
  if coalesce(old.version,0) is distinct from p_version then raise exception 'Supplier changed. Reload before saving.' using errcode='40001';end if;
  if old.id is null then
    insert into purchase_suppliers(name,address,tax_id,phone,created_by) values(n,coalesce(p_profile->>'address',''),coalesce(p_profile->>'tax_id',''),coalesce(p_profile->>'phone',''),auth.uid()) returning * into r;
  else update purchase_suppliers set address=coalesce(p_profile->>'address',''),tax_id=coalesce(p_profile->>'tax_id',''),phone=coalesce(p_profile->>'phone',''),version=version+1 where id=old.id returning * into r;end if;
  perform receipt_review_event(null,'supplier_details_saved',to_jsonb(old),to_jsonb(r));return to_jsonb(r);
end$$;

create function public.read_receipt_reviews(p_status text default 'pending',p_id uuid default null,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path=public as $$begin
  perform public.require_permission('purchasing.view');perform public.require_permission('purchasing.cost.view');
  if p_id is not null then return (select to_jsonb(r)-'scan_token' from receipt_reviews r where id=p_id);end if;
  if p_status not in ('pending','confirmed','deleted') or p_offset<0 then raise exception 'Invalid filter.';end if;
  return jsonb_build_object('total',(select count(*) from receipt_reviews where status=p_status),'records',coalesce((select jsonb_agg(row) from (select to_jsonb(r)-'scan_token' as row from receipt_reviews r where status=p_status order by updated_at desc,id limit 50 offset p_offset) rows),'[]'));
end$$;
create function public.read_receipt_review_events(p_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$begin
  perform public.require_permission('purchasing.view');perform public.require_permission('purchasing.cost.view');
  return coalesce((select jsonb_agg(to_jsonb(e) order by created_at,id) from receipt_review_events e where review_id=p_id),'[]');
end$$;
create function public.save_receipt_review(p_id uuid,p_version integer,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$declare old receipt_reviews%rowtype;r receipt_reviews%rowtype;k text;p jsonb;l jsonb;n text;begin
  perform public.require_permission('purchasing.fulfil');perform public.require_permission('purchasing.cost.view');
  if p_id is null or auth.uid() is null or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>250000 then raise exception 'Invalid receipt draft.';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,62));select * into old from receipt_reviews where id=p_id for update;
  if old.id is not null and (old.created_by<>auth.uid() or old.status<>'pending') then raise exception 'Only the purchaser can edit this pending receipt.' using errcode='42501';end if;
  if old.data=p_data then return to_jsonb(old)-'scan_token';end if;
  if coalesce(old.version,0) is distinct from p_version then raise exception 'Receipt changed on another device. Reopen it before editing.' using errcode='40001';end if;
  if old.scan_status='scanning' then raise exception 'The receipt is being scanned. Check again shortly.';end if;
  foreach k in array array['purpose','supplier','address','tax_id','phone','receipt_no','purchase_date','currency','total_cost','subtotal','tax','discount','notes','review_note'] loop
    if jsonb_typeof(p_data->k) is distinct from 'string' or length(p_data->>k)>(case when k in ('notes','review_note') then 2000 when k='address' then 1000 when k='supplier' then 160 when k='phone' then 100 when k in ('purchase_date','currency') then 10 when k in ('total_cost','subtotal','tax','discount') then 40 else 120 end) then raise exception 'Check receipt field: %',k;end if;
  end loop;
  if coalesce(p_data->>'purpose','') not in ('','guest_meals','staff_meals','bar') or jsonb_typeof(p_data->'lines') is distinct from 'array' or jsonb_array_length(p_data->'lines')>200 then raise exception 'Check receipt lines.';end if;
  for l in select value from jsonb_array_elements(p_data->'lines') loop
    foreach k in array array['id','name','category','quantity','unit','amount'] loop
      if jsonb_typeof(l->k) is distinct from 'string' or length(l->>k)>120 then raise exception 'Invalid item field.';end if;
    end loop;
  end loop;
  foreach k in array array['receipt','items'] loop
    p:=p_data->k;
    if p is null then raise exception 'Missing photo field.';end if;
    if p<>'null'::jsonb and (jsonb_typeof(p) is distinct from 'object' or coalesce(split_part(p->>'path','/',1),'')<>auth.uid()::text or coalesce(p->>'hash','')!~'^[a-f0-9]{64}$' or not exists(select 1 from storage.objects where bucket_id='purchase-evidence' and name=p->>'path')) then raise exception 'Photo has not finished uploading.';end if;
  end loop;
  select nullif(trim(full_name),'') into n from profiles where id=auth.uid();if n is null then raise exception 'Staff name required.';end if;
  if old.id is null then insert into receipt_reviews(id,data,created_by,created_by_name) values(p_id,p_data,auth.uid(),n) returning * into r;
  else
    if old.extraction is not null and old.data->'receipt' is distinct from p_data->'receipt' then raise exception 'Keep the original scanned receipt. Remove this review with a reason and create a replacement.';end if;
    update receipt_reviews set data=p_data,version=version+1,updated_at=clock_timestamp() where id=p_id returning * into r;
  end if;
  perform receipt_review_event(p_id,case when old.id is null then 'created' else 'edited' end,old.data,r.data);return to_jsonb(r)-'scan_token';
end$$;
create function public.delete_receipt_review(p_id uuid,p_version integer,p_reason text) returns jsonb
language plpgsql security definer set search_path=public as $$declare r receipt_reviews%rowtype;begin
  perform public.require_permission('purchasing.fulfil');perform public.require_permission('purchasing.cost.view');
  select * into r from receipt_reviews where id=p_id for update;
  if r.id is null or (r.created_by<>auth.uid() and not public.has_permission('purchasing.manage')) then raise exception 'Permission denied' using errcode='42501';end if;
  if r.status='deleted' then return to_jsonb(r)-'scan_token';end if;
  if r.status<>'pending' or r.scan_status='scanning' or r.version is distinct from p_version then raise exception 'Receipt changed or is being scanned. Reopen it.' using errcode='40001';end if;
  if coalesce(length(trim(p_reason)),0) not between 1 and 2000 then raise exception 'A removal reason is required.';end if;
  update receipt_reviews set status='deleted',deleted_at=clock_timestamp(),updated_at=clock_timestamp(),delete_reason=trim(p_reason),version=version+1 where id=p_id returning * into r;
  perform receipt_review_event(p_id,'removed',null,jsonb_build_object('reason',r.delete_reason,'deleted_at',r.deleted_at));return to_jsonb(r)-'scan_token';
end$$;
create function public.confirm_receipt_review(p_id uuid,p_version integer,p_verified boolean) returns jsonb
language plpgsql security definer set search_path=public as $$declare r receipt_reviews%rowtype;d jsonb;p jsonb;result jsonb;lines jsonb;needs_note boolean;k text;begin
  perform public.require_permission('purchasing.fulfil');perform public.require_permission('purchasing.cost.view');
  select * into r from receipt_reviews where id=p_id for update;
  if r.id is null or r.created_by<>auth.uid() then raise exception 'Only the purchaser can confirm this receipt.' using errcode='42501';end if;
  if r.status='confirmed' then return (select to_jsonb(e) from expense_receipts e where id=r.result_id);end if;
  if r.status<>'pending' or r.scan_status='scanning' or r.version is distinct from p_version then raise exception 'Receipt changed. Reopen and review it.' using errcode='40001';end if;
  if p_verified is distinct from true then raise exception 'Review and verify the receipt before confirming.';end if;
  d:=r.data;
  if d->>'currency'<>'MYR' then raise exception 'Only MYR receipts can be confirmed here.';end if;
  foreach k in array array['subtotal','tax','discount'] loop
    if d->>k<>'' and (d->>k !~ '^\d{1,8}(\.\d{1,2})?$' or (d->>k)::numeric>99999999.99) then raise exception 'Check tax, subtotal and discounts.';end if;
  end loop;
  needs_note:=trim(coalesce(d->>'receipt_no',''))='' or trim(coalesce(d->>'address',''))='' or trim(coalesce(d->>'tax_id',''))='' or jsonb_array_length(d->'lines')=0 or r.scan_status='failed' or coalesce(jsonb_array_length(r.extraction->'unreadable'),0)>0 or coalesce(jsonb_array_length(r.extraction->'warnings'),0)>0;
  if jsonb_array_length(d->'lines')>0 and (d->>'total_cost')::numeric-(select sum((l->>'amount')::numeric) from jsonb_array_elements(d->'lines') l)-coalesce(nullif(d->>'tax','')::numeric,0)+coalesce(nullif(d->>'discount','')::numeric,0)<>0 then needs_note:=true;end if;
  if needs_note and nullif(trim(d->>'review_note'),'') is null then raise exception 'Record how you checked the missing or unreadable details.';end if;
  select coalesce(jsonb_agg(jsonb_build_object('name',l->>'name','category',l->>'category','unit',l->>'unit','quantity',(l->>'quantity')::numeric,'amount',(l->>'amount')::numeric)),'[]') into lines from jsonb_array_elements(d->'lines') l;
  p:=jsonb_build_object('purpose',d->>'purpose','supplier',d->>'supplier','purchase_date',d->>'purchase_date','receipt_no',d->>'receipt_no','total_cost',(d->>'total_cost')::numeric,'receipt_path',d#>>'{receipt,path}','receipt_hash',d#>>'{receipt,hash}','items_path',d#>>'{items,path}','items_hash',d#>>'{items,hash}','lines',lines,'notes',d->>'notes');
  result:=public.save_expense_receipt(p,p_id);
  update expense_receipts set accounting_details=jsonb_build_object('review_id',p_id,'address',d->>'address','tax_id',d->>'tax_id','phone',d->>'phone','currency',d->>'currency','subtotal',d->>'subtotal','tax',d->>'tax','discount',d->>'discount','review_note',d->>'review_note','extraction',r.extraction,'scan_status',r.scan_status,'model',r.model) where id=(result->>'id')::uuid;
  update receipt_reviews set status='confirmed',result_id=(result->>'id')::uuid,confirmed_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 where id=p_id;
  perform receipt_review_event(p_id,'confirmed',null,jsonb_build_object('receipt_id',result->>'id','verified',true,'review_note',d->>'review_note'));
  return (select to_jsonb(e) from expense_receipts e where id=(result->>'id')::uuid);
end$$;

create function public.begin_receipt_review_scan(p_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$declare r receipt_reviews%rowtype;s receipt_ai_settings%rowtype;begin
  perform public.require_permission('purchasing.fulfil');perform public.require_permission('purchasing.cost.view');
  perform pg_advisory_xact_lock(73082,2);select * into s from receipt_ai_settings for share;
  if not s.enabled then raise exception 'AI receipt scanning is switched off by Admin.';end if;
  select * into r from receipt_reviews where id=p_id for update;
  if r.id is null or r.created_by<>auth.uid() or r.status<>'pending' then raise exception 'Scan your own pending receipt.' using errcode='42501';end if;
  if r.scan_status='complete' then return jsonb_build_object('cached',true,'review',to_jsonb(r)-'scan_token');end if;
  if r.scan_status<>'idle' then raise exception 'This scan has already started. Reopen the review; ask Admin to reset a failed scan.';end if;
  if r.data->'receipt'='null'::jsonb then raise exception 'Upload the receipt first.';end if;
  if (select count(*) from receipt_review_events where action='scan_started' and created_at>now()-interval '24 hours')>=s.daily_limit then raise exception 'The daily scan limit has been reached.';end if;
  update receipt_reviews set scan_status='scanning',scan_token=gen_random_uuid(),scan_started_at=clock_timestamp(),scan_error=null,version=version+1,updated_at=clock_timestamp(),model=s.model where id=p_id returning * into r;
  perform receipt_review_event(p_id,'scan_started',null,jsonb_build_object('model',s.model));
  return jsonb_build_object('token',r.scan_token,'receipt_path',r.data#>>'{receipt,path}','model',s.model);
end$$;
create function public.finish_receipt_review_scan(p_id uuid,p_token uuid,p_extraction jsonb,p_usage jsonb,p_error text) returns jsonb
language plpgsql security definer set search_path=public as $$declare r receipt_reviews%rowtype;d jsonb;k text;source text;lines jsonb;begin
  select * into r from receipt_reviews where id=p_id for update;
  if r.id is null or p_token is null or r.scan_status<>'scanning' or r.scan_token is distinct from p_token then raise exception 'Scan claim is no longer valid.';end if;
  d:=r.data;
  if p_error is null then
    if jsonb_typeof(p_extraction) is distinct from 'object' or octet_length(p_extraction::text)>200000 or jsonb_typeof(p_extraction->'items') is distinct from 'array' or jsonb_array_length(p_extraction->'items')>200 then raise exception 'Invalid extraction.';end if;
    foreach k in array array['supplier','address','tax_id','phone','receipt_no','purchase_date','total_cost','subtotal','tax','discount'] loop
      source:=case k when 'purchase_date' then 'date' when 'total_cost' then 'total' else k end;
      if d->>k='' and p_extraction->>source is not null then d:=jsonb_set(d,array[k],to_jsonb(left(p_extraction->>source,case when k='address' then 1000 when k='supplier' then 160 when k='phone' then 100 when k='purchase_date' then 10 when k in ('total_cost','subtotal','tax','discount') then 40 else 120 end)));end if;
    end loop;
    d:=jsonb_set(d,'{currency}',to_jsonb(left(coalesce(p_extraction->>'currency',''),10)));
    if jsonb_array_length(d->'lines')=0 then
      select coalesce(jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'name',left(l->>'description',120),'category','Other','quantity',coalesce(l->>'quantity',''),'unit',coalesce((select u from unnest(array['kg','g','L','ml','pcs','biji','ekor','pack','bag','gelen','botol','bottle','tin','cylinder','carton']) u where lower(u)=lower(trim(l->>'unit'))),left(coalesce(l->>'unit',''),40)),'amount',coalesce(l->>'amount',''))),'[]') into lines from jsonb_array_elements(p_extraction->'items') l;
      d:=jsonb_set(d,'{lines}',lines);
    end if;
  end if;
  update receipt_reviews set data=d,extraction=p_extraction,usage=p_usage,scan_error=p_error,scan_status=case when p_error is null then 'complete' else 'failed' end,version=version+1,updated_at=clock_timestamp() where id=p_id returning * into r;
  perform receipt_review_event(p_id,case when p_error is null then 'scan_completed' else 'scan_failed' end,null,jsonb_build_object('extraction',p_extraction,'error',p_error,'usage',p_usage));return to_jsonb(r)-'scan_token';
end$$;
create function public.reset_receipt_review_scan(p_id uuid,p_version integer) returns jsonb language plpgsql security definer set search_path=public as $$declare r receipt_reviews%rowtype;begin
  perform public.require_permission('platform.settings.manage');select * into r from receipt_reviews where id=p_id for update;
  if r.id is null or r.status<>'pending' or r.version is distinct from p_version or r.scan_status not in ('failed','scanning') or (r.scan_status='scanning' and r.scan_started_at>now()-interval '2 minutes') then raise exception 'Only failed or timed-out scans can be reset.';end if;
  update receipt_reviews set scan_status='idle',scan_token=null,version=version+1,updated_at=clock_timestamp() where id=p_id returning * into r;
  perform receipt_review_event(p_id,'scan_reset',null,jsonb_build_object('previous_error',r.scan_error));return to_jsonb(r)-'scan_token';
end$$;
revoke all on function public.finish_receipt_review_scan(uuid,uuid,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.finish_receipt_review_scan(uuid,uuid,jsonb,jsonb,text) to service_role;
do $$declare f text;begin foreach f in array array[
 'read_receipt_ai_settings()','save_receipt_ai_settings(boolean,integer,integer)','read_purchase_supplier_profiles()','save_purchase_supplier_profile(jsonb,integer)',
 'read_receipt_reviews(text,uuid,integer)','read_receipt_review_events(uuid)','save_receipt_review(uuid,integer,jsonb)','delete_receipt_review(uuid,integer,text)',
 'confirm_receipt_review(uuid,integer,boolean)','begin_receipt_review_scan(uuid)','reset_receipt_review_scan(uuid,integer)'] loop
 execute 'revoke all on function public.'||f||' from public,anon';execute 'grant execute on function public.'||f||' to authenticated';end loop;end$$;

-- The older comparison scanner obeys the same Admin switch.
alter function public.begin_purchase_receipt_scan(uuid) rename to begin_purchase_receipt_scan_internal;
revoke all on function public.begin_purchase_receipt_scan_internal(uuid) from public,anon,authenticated;
create function public.begin_purchase_receipt_scan(p_record_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$begin
  perform public.require_permission('purchasing.fulfil');
  if not (select enabled from receipt_ai_settings) then raise exception 'AI receipt scanning is switched off by Admin.';end if;
  return public.begin_purchase_receipt_scan_internal(p_record_id);
end$$;
revoke all on function public.begin_purchase_receipt_scan(uuid) from public,anon;
grant execute on function public.begin_purchase_receipt_scan(uuid) to authenticated;
