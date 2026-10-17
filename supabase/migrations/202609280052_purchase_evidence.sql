-- Purchases are evidence-backed spending records. Receiving remains a separate stock event.
create table public.purchase_suppliers (
  id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 160),
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create unique index purchase_suppliers_name_key on public.purchase_suppliers(lower(trim(name)));
alter table public.purchase_suppliers enable row level security;
revoke all on public.purchase_suppliers from anon, authenticated;

create function public.read_purchase_suppliers() returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  perform public.require_permission('purchasing.view');
  return coalesce((select jsonb_agg(name order by lower(name)) from (
    select min(name) name from (
      select trim(name) name from public.purchase_suppliers
      union all select trim(supplier) from public.purchase_request_items where nullif(trim(supplier),'') is not null
    ) s group by lower(name)
  ) names),'[]'::jsonb);
end $$;
create function public.save_purchase_supplier(p_name text) returns text
language plpgsql security definer set search_path=public as $$
declare v_name text:=trim(p_name); v_saved text;
begin
  perform public.require_permission('purchasing.fulfil');
  if v_name is null or length(v_name) not between 1 and 160 then raise exception 'Enter a supplier name up to 160 characters.'; end if;
  insert into public.purchase_suppliers(name,created_by) values(v_name,auth.uid()) on conflict do nothing;
  select name into v_saved from public.purchase_suppliers where lower(trim(name))=lower(v_name);
  return v_saved;
end $$;
revoke all on function public.read_purchase_suppliers(),public.save_purchase_supplier(text) from public,anon;
grant execute on function public.read_purchase_suppliers(),public.save_purchase_supplier(text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('purchase-evidence','purchase-evidence',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=excluded.allowed_mime_types;
create policy purchase_evidence_upload on storage.objects for insert to authenticated with check (
  bucket_id='purchase-evidence' and (storage.foldername(name))[1]=auth.uid()::text
  and public.has_permission('purchasing.fulfil') and public.has_permission('purchasing.cost.view')
);
create policy purchase_evidence_read on storage.objects for select to authenticated using (
  bucket_id='purchase-evidence' and public.has_permission('purchasing.view') and public.has_permission('purchasing.cost.view')
);
-- No client UPDATE/DELETE policy: confirmed proof cannot silently be replaced.
create table public.purchase_evidence (
  record_id uuid primary key references public.audit_logs(id),
  request_id uuid not null references public.purchase_requests(id),
  actor_id uuid not null references auth.users(id),
  purchase_date date not null, total_cost numeric(12,2) not null check(total_cost>=0),
  receipt_path text not null unique, items_path text not null unique,
  receipt_hash text not null, items_hash text not null,
  created_at timestamptz not null default now(),
  check(receipt_path<>items_path and receipt_hash<>items_hash)
);
alter table public.purchase_evidence enable row level security;
revoke all on public.purchase_evidence from anon,authenticated;
grant select on public.purchase_evidence to authenticated;
create policy purchase_evidence_records_read on public.purchase_evidence for select to authenticated using (
  public.has_permission('purchasing.view') and public.has_permission('purchasing.cost.view')
);

alter function public.record_purchase_batch_checked(uuid,jsonb,text,text,uuid) rename to record_purchase_batch_internal;
revoke all on function public.record_purchase_batch_internal(uuid,jsonb,text,text,uuid) from public,anon,authenticated;

create or replace function public.purchase_batch_visible_record(p_record jsonb)
returns jsonb language sql stable security definer set search_path=public as $$
  select case when public.has_permission('purchasing.cost.view') then p_record
    else jsonb_set(p_record-'evidence','{items}',coalesce((
      select jsonb_agg(item-'actual_cost') from jsonb_array_elements(p_record->'items') item
    ),'[]'::jsonb)) end;
$$;

create function public.require_purchase_evidence() returns trigger
language plpgsql set search_path=public as $$
begin
  if new.purchase_status='bought' and (tg_op='INSERT' or old.purchase_status is distinct from new.purchase_status
    or old.purchased_quantity is distinct from new.purchased_quantity or old.actual_cost is distinct from new.actual_cost or old.supplier is distinct from new.supplier)
    and current_setting('app.purchase_evidence',true) is distinct from 'verified' then
    raise exception 'Use Record Purchases with a receipt photo, items photo and total.';
  end if;
  return new;
end $$;
create trigger purchase_evidence_required before insert or update on public.purchase_request_items
for each row execute function public.require_purchase_evidence();

create function public.record_purchase_batch_checked(
  p_request_id uuid,p_items jsonb,p_supplier text,p_reference text,p_operation_id uuid,p_evidence jsonb default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_record jsonb; v_date date; v_total numeric; v_hash text;
  v_previous public.operation_requests%rowtype;
  v_receipt text:=p_evidence->>'receipt_path'; v_items text:=p_evidence->>'items_path';
begin
  perform public.require_permission('purchasing.fulfil');
  perform public.require_permission('purchasing.cost.view');
  if auth.uid() is null or p_operation_id is null then raise exception 'Sign in before recording a purchase.'; end if;
  v_hash:=md5(jsonb_build_object('request',p_request_id,'items',p_items,'supplier',p_supplier,'reference',p_reference,'evidence',p_evidence)::text);
  perform pg_advisory_xact_lock(73081,1);
  select * into v_previous from public.operation_requests where actor_id=auth.uid() and operation='purchase_with_evidence' and request_id=p_operation_id;
  if found then
    if v_previous.payload_hash<>v_hash then raise exception 'This confirmation was already used with different details.'; end if;
    select after_json into v_record from public.audit_logs where id=v_previous.result_id;
    return public.purchase_batch_visible_record(v_record);
  end if;
  if nullif(trim(p_supplier),'') is null then raise exception 'Choose a supplier.'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence)<>'object' or nullif(p_evidence->>'purchase_date','') is null
    or jsonb_typeof(p_evidence->'total_cost') is distinct from 'number' then
    raise exception 'Enter the receipt date and purchase total.';
  end if;
  v_date:=(p_evidence->>'purchase_date')::date;
  v_total:=(p_evidence->>'total_cost')::numeric;
  if v_date>(now() at time zone 'Asia/Kuala_Lumpur')::date or v_total<0 or v_total>99999999.99
    or v_total::text in ('NaN','Infinity','-Infinity') or round(v_total,2)<>v_total then
    raise exception 'Check the receipt date and total.';
  end if;
  if v_receipt is null or v_items is null or v_receipt=v_items
    or split_part(v_receipt,'/',1)<>auth.uid()::text or split_part(v_items,'/',1)<>auth.uid()::text
    or coalesce(p_evidence->>'receipt_hash','')!~'^[a-f0-9]{64}$'
    or coalesce(p_evidence->>'items_hash','')!~'^[a-f0-9]{64}$'
    or p_evidence->>'receipt_hash'=p_evidence->>'items_hash' then
    raise exception 'Attach a receipt photo and a different photo of the purchased items.';
  end if;
  if (select count(*) from storage.objects where bucket_id='purchase-evidence' and name in(v_receipt,v_items))<>2 then
    raise exception 'Both photos must finish uploading before confirmation.';
  end if;
  perform set_config('app.purchase_evidence','verified',true);
  v_record:=public.record_purchase_batch_internal(p_request_id,p_items,p_supplier,p_reference,p_operation_id);
  perform set_config('app.purchase_evidence','',true);
  insert into public.purchase_evidence(record_id,request_id,actor_id,purchase_date,total_cost,receipt_path,items_path,receipt_hash,items_hash)
    values((v_record->>'id')::uuid,p_request_id,auth.uid(),v_date,v_total,v_receipt,v_items,p_evidence->>'receipt_hash',p_evidence->>'items_hash');
  v_record:=v_record||jsonb_build_object('evidence',jsonb_build_object('purchase_date',v_date,'total_cost',v_total,
    'receipt_path',v_receipt,'items_path',v_items,'receipt_hash',p_evidence->>'receipt_hash','items_hash',p_evidence->>'items_hash'));
  update public.audit_logs set after_json=v_record where id=(v_record->>'id')::uuid;
  insert into public.operation_requests(actor_id,operation,request_id,payload_hash,result_id)
    values(auth.uid(),'purchase_with_evidence',p_operation_id,v_hash,(v_record->>'id')::uuid);
  return public.purchase_batch_visible_record(v_record);
end $$;
revoke all on function public.record_purchase_batch_checked(uuid,jsonb,text,text,uuid,jsonb) from public,anon;
grant execute on function public.record_purchase_batch_checked(uuid,jsonb,text,text,uuid,jsonb) to authenticated;

-- Separate AI test results. Never used by inventory or the manual accounting record.
create table public.purchase_receipt_scans (
  record_id uuid primary key references public.purchase_evidence(record_id),
  status text not null check(status in ('scanning','complete','failed')),
  extraction jsonb, model text, usage jsonb, error text,
  requested_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.purchase_receipt_scans enable row level security;
revoke all on public.purchase_receipt_scans from anon,authenticated;
grant select on public.purchase_receipt_scans to authenticated;
grant select,update on public.purchase_receipt_scans to service_role;
create policy receipt_scan_read on public.purchase_receipt_scans for select to authenticated using (
  public.has_permission('purchasing.view') and public.has_permission('purchasing.cost.view')
);

create function public.begin_purchase_receipt_scan(p_record_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_scan public.purchase_receipt_scans%rowtype; v_proof public.purchase_evidence%rowtype;
begin
  perform public.require_permission('purchasing.fulfil');
  perform public.require_permission('purchasing.cost.view');
  perform pg_advisory_xact_lock(73081,2);
  select * into v_proof from public.purchase_evidence where record_id=p_record_id;
  if not found then raise exception 'Purchase evidence not found.'; end if;
  select * into v_scan from public.purchase_receipt_scans where record_id=p_record_id;
  if found then
    if v_scan.status='complete' then return jsonb_build_object('cached',v_scan.extraction); end if;
    -- Do not automatically repeat a potentially billed request after a timeout.
    raise exception 'This scan has already been attempted. Ask an administrator to review it before retrying.';
  end if;
  if (select count(*) from public.purchase_receipt_scans where created_at>now()-interval '1 day')>=100 then
    raise exception 'The daily receipt scan limit has been reached.';
  end if;
  insert into public.purchase_receipt_scans(record_id,status,requested_by) values(p_record_id,'scanning',auth.uid());
  return jsonb_build_object('receipt_path',v_proof.receipt_path);
end $$;
revoke all on function public.begin_purchase_receipt_scan(uuid) from public,anon;
grant execute on function public.begin_purchase_receipt_scan(uuid) to authenticated;
