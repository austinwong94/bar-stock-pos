-- Reviewed rollout: receipts are expenses; receiving is stock in; daily usage is stock out.
-- Apply with the matching frontend. No existing operational records are deleted.
-- Gas is measured as net gas mass, not an assumed cylinder size. Opening balance stays zero.
insert into public.ingredient_items(name,category,base_unit,default_pack_size,pack_label,active)
select 'Cooking Gas','Food','g',1000,'kg',true
where not exists(select 1 from public.ingredient_items where lower(name) in ('cooking gas','gas memasak','lpg'));
alter table public.purchase_evidence add column purpose text check(purpose in ('guest_meals','staff_meals','bar'));
alter table public.purchase_evidence add column lines jsonb not null default '[]', add column coding_version integer not null default 1;
insert into public.permissions(code,department_code,name,sensitive) values('purchasing.cost.manage','purchasing','Code Receipt Items',true) on conflict do nothing;
insert into public.access_role_permissions(role_code,permission_code) values('accountant','purchasing.cost.manage') on conflict do nothing;
alter function public.record_purchase_batch_checked(uuid,jsonb,text,text,uuid,jsonb) rename to record_purchase_batch_with_evidence;
revoke all on function public.record_purchase_batch_with_evidence(uuid,jsonb,text,text,uuid,jsonb) from public,anon,authenticated;
create table public.expense_receipts (
  id uuid primary key default gen_random_uuid(), purchase_date date not null,
  purpose text not null check(purpose in ('guest_meals','staff_meals','bar')),
  supplier text not null, receipt_no text not null default '', total_cost numeric(12,2) not null check(total_cost>=0),
  receipt_path text not null, items_path text not null, receipt_hash text not null, items_hash text not null,
  lines jsonb not null default '[]', notes text not null default '', coding_version integer not null default 1,
  status text not null default 'confirmed' check(status in ('confirmed','void')), void_reason text,
  created_by uuid not null references auth.users(id), created_by_name text not null, created_at timestamptz not null default now(),
  check(receipt_path<>items_path and receipt_hash<>items_hash)
);
create unique index expense_receipt_photo_once on public.expense_receipts(receipt_hash) where status='confirmed';
create unique index expense_receipt_number_once on public.expense_receipts(lower(trim(supplier)),lower(trim(receipt_no))) where status='confirmed' and receipt_no<>'';
create index expense_receipts_date on public.expense_receipts(purchase_date,purpose);
alter table public.expense_receipts enable row level security;
revoke all on public.expense_receipts from anon,authenticated;
grant select on public.expense_receipts to authenticated;
create policy expense_read on public.expense_receipts for select to authenticated using(public.has_permission('purchasing.cost.view') and public.has_permission('purchasing.view'));

create table public.kitchen_usage_templates (
  id uuid primary key default gen_random_uuid(), name text not null, ingredient_ids uuid[] not null,
  created_by uuid not null references auth.users(id), updated_at timestamptz not null default now()
);
create table public.kitchen_daily_usage (
  id uuid primary key default gen_random_uuid(), business_date date not null unique,
  guest_meals integer not null check(guest_meals between 0 and 100000), staff_meals integer not null check(staff_meals between 0 and 100000),
  template_ids jsonb not null default '[]', lines jsonb not null, notes text not null default '',
  revision integer not null default 1, created_by uuid not null references auth.users(id), created_by_name text not null,
  updated_at timestamptz not null default now()
);
alter table public.kitchen_usage_templates enable row level security;
alter table public.kitchen_daily_usage enable row level security;
revoke all on public.kitchen_usage_templates,public.kitchen_daily_usage from anon,authenticated;

create function public.save_expense_receipt(p_receipt jsonb,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r public.expense_receipts%rowtype; previous public.operation_requests%rowtype;
  h text:=md5(p_receipt::text); d date; amount numeric; l jsonb; actor_name text;
  receipt text:=p_receipt->>'receipt_path'; photo text:=p_receipt->>'items_path';
begin
  perform public.require_permission('purchasing.fulfil');perform public.require_permission('purchasing.cost.view');
  if auth.uid() is null or p_operation_id is null then raise exception 'Sign in and provide a submission reference.';end if;
  perform pg_advisory_xact_lock(73081,1);
  select * into previous from public.operation_requests where actor_id=auth.uid() and operation='expense_receipt' and request_id=p_operation_id;
  if found then
    if previous.payload_hash is distinct from h then raise exception 'This receipt was already confirmed with different details.';end if;
    return (select to_jsonb(e) from public.expense_receipts e where id=previous.result_id);
  end if;
  if coalesce(p_receipt->>'purpose','') not in ('guest_meals','staff_meals','bar') or coalesce(length(trim(p_receipt->>'supplier')),0) not between 1 and 160
    or length(coalesce(p_receipt->>'receipt_no',''))>120 or length(coalesce(p_receipt->>'notes',''))>2000 then raise exception 'Check the purchase purpose, supplier, receipt number and notes.';end if;
  d:=(p_receipt->>'purchase_date')::date;amount:=(p_receipt->>'total_cost')::numeric;
  if d is null or d>(now() at time zone 'Asia/Kuala_Lumpur')::date or amount is null or amount::text in ('NaN','Infinity','-Infinity') or amount<0 or amount>99999999.99 or amount<>round(amount,2) then raise exception 'Check the receipt date and total.';end if;
  if receipt is null or photo is null or receipt=photo or split_part(receipt,'/',1)<>auth.uid()::text or split_part(photo,'/',1)<>auth.uid()::text
    or coalesce(p_receipt->>'receipt_hash','')!~'^[a-f0-9]{64}$' or coalesce(p_receipt->>'items_hash','')!~'^[a-f0-9]{64}$' or p_receipt->>'receipt_hash'=p_receipt->>'items_hash' then raise exception 'Attach the receipt and a different purchased-items photo.';end if;
  if (select count(*) from storage.objects where bucket_id='purchase-evidence' and name in(receipt,photo))<>2 then raise exception 'Both photos must finish uploading.';end if;
  if exists(select 1 from public.expense_receipts e where e.status='confirmed' and (e.receipt_hash=p_receipt->>'receipt_hash' or (nullif(trim(p_receipt->>'receipt_no'),'') is not null and lower(trim(e.supplier))=lower(trim(p_receipt->>'supplier')) and lower(trim(e.receipt_no))=lower(trim(p_receipt->>'receipt_no')))))
    or exists(select 1 from public.purchase_evidence e where e.receipt_hash=p_receipt->>'receipt_hash') then raise exception 'This receipt has already been recorded. Open the existing record.';end if;
  if jsonb_typeof(p_receipt->'lines') is distinct from 'array' or jsonb_array_length(p_receipt->'lines')>200 then raise exception 'Check the receipt item list.';end if;
  for l in select value from jsonb_array_elements(p_receipt->'lines') loop
    if coalesce(length(trim(l->>'name')),0) not between 1 and 120 or coalesce(l->>'category','') not in ('Vegetables','Seafood','Meat & Eggs','Rice & Dry Goods','Seasoning & Oil','Cooking Gas','Bar Drinks','Other')
      or coalesce(l->>'unit','') not in ('kg','g','L','ml','pcs','pack','bag','bottle','tin','cylinder','carton')
      or jsonb_typeof(l->'quantity') is distinct from 'number' or (l->>'quantity')::numeric<=0 or (l->>'quantity')::numeric>1e9
      or jsonb_typeof(l->'amount') is distinct from 'number' or (l->>'amount')::numeric<0 or (l->>'amount')::numeric>99999999.99 or (l->>'amount')::numeric<>round((l->>'amount')::numeric,2) then raise exception 'Check each item name, category, quantity, unit and cost.';end if;
  end loop;
  select nullif(trim(full_name),'') into actor_name from public.profiles where id=auth.uid();if actor_name is null then raise exception 'Your profile needs a staff name.';end if;
  insert into public.expense_receipts(purchase_date,purpose,supplier,receipt_no,total_cost,receipt_path,items_path,receipt_hash,items_hash,lines,notes,created_by,created_by_name)
    values(d,p_receipt->>'purpose',trim(p_receipt->>'supplier'),trim(coalesce(p_receipt->>'receipt_no','')),amount,receipt,photo,p_receipt->>'receipt_hash',p_receipt->>'items_hash',p_receipt->'lines',coalesce(p_receipt->>'notes',''),auth.uid(),actor_name) returning * into r;
  insert into public.operation_requests(actor_id,operation,request_id,payload_hash,result_id) values(auth.uid(),'expense_receipt',p_operation_id,h,r.id);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_json) values(auth.uid(),'record_expense_receipt','expense_receipt',r.id,to_jsonb(r));
  return to_jsonb(r);
end $$;

create function public.read_expense_receipts(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  perform public.require_permission('purchasing.cost.view');perform public.require_permission('purchasing.view');
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>370 then raise exception 'Select a period up to one year.';end if;
  return coalesce((select jsonb_agg(record order by purchase_date desc) from (
    select e.purchase_date,to_jsonb(e) record from public.expense_receipts e where e.purchase_date between p_from and p_to
    union all
    select e.purchase_date,jsonb_build_object('id',e.record_id,'purchase_date',e.purchase_date,'purpose',coalesce(e.purpose,'unclassified'),'supplier',coalesce(a.after_json->>'supplier','Unknown Supplier'),'receipt_no',coalesce(a.after_json->>'reference',''),
      'total_cost',e.total_cost,'receipt_path',e.receipt_path,'items_path',e.items_path,'receipt_hash',e.receipt_hash,'items_hash',e.items_hash,'lines',e.lines,'coding_version',e.coding_version,'notes','Earlier purchasing record','status','confirmed','legacy',true,
      'created_at',e.created_at,'created_by',e.actor_id,'created_by_name',coalesce(a.after_json->>'confirmed_by_name','Name Not Recorded'))
    from public.purchase_evidence e join public.audit_logs a on a.id=e.record_id where e.purchase_date between p_from and p_to
  ) records),'[]'::jsonb);
end $$;

create function public.void_expense_receipt(p_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare old public.expense_receipts%rowtype;r public.expense_receipts%rowtype;
begin
  perform public.require_permission('purchasing.manage');perform public.require_permission('purchasing.cost.view');
  if coalesce(length(trim(p_reason)),0) not between 1 and 2000 then raise exception 'Enter a correction reason.';end if;
  select * into old from public.expense_receipts where id=p_id for update;if not found then raise exception 'Receipt not found.';end if;
  if old.status='void' then return to_jsonb(old);end if;
  update public.expense_receipts set status='void',void_reason=trim(p_reason) where id=p_id returning * into r;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_json,after_json) values(auth.uid(),'void_expense_receipt','expense_receipt',p_id,to_jsonb(old),to_jsonb(r));return to_jsonb(r);
end $$;

create function public.record_purchase_batch_checked(p_request_id uuid,p_items jsonb,p_supplier text,p_reference text,p_operation_id uuid,p_evidence jsonb default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r jsonb;
begin
  perform public.require_permission('purchasing.fulfil');perform public.require_permission('purchasing.cost.view');
  perform pg_advisory_xact_lock(73081,1);
  if coalesce(p_evidence->>'purpose','') not in ('guest_meals','staff_meals','bar') then raise exception 'Choose Guest Meals, Staff Meals or Bar.';end if;
  if exists(select 1 from public.expense_receipts where status='confirmed' and receipt_hash=p_evidence->>'receipt_hash') then raise exception 'This receipt has already been recorded.';end if;
  if not exists(select 1 from public.operation_requests where actor_id=auth.uid() and operation='record_purchase_batch' and request_id=p_operation_id)
    and exists(select 1 from public.purchase_evidence where receipt_hash=p_evidence->>'receipt_hash') then raise exception 'This receipt has already been recorded.';end if;
  r:=public.record_purchase_batch_with_evidence(p_request_id,p_items,p_supplier,p_reference,p_operation_id,p_evidence);
  update public.purchase_evidence set purpose=p_evidence->>'purpose' where record_id=(r->>'id')::uuid;
  return jsonb_set(r,'{evidence,purpose}',p_evidence->'purpose');
end $$;
revoke all on function public.record_purchase_batch_checked(uuid,jsonb,text,text,uuid,jsonb) from public,anon;
grant execute on function public.record_purchase_batch_checked(uuid,jsonb,text,text,uuid,jsonb) to authenticated;

create function public.read_kitchen_templates() returns jsonb language plpgsql stable security definer set search_path=public as $$
begin perform public.require_permission('kitchen.production.manage');return coalesce((select jsonb_agg(to_jsonb(t) order by name) from public.kitchen_usage_templates t),'[]'::jsonb);end $$;
create function public.save_kitchen_template(p_template jsonb,p_expected_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path=public as $$
declare old public.kitchen_usage_templates%rowtype;r public.kitchen_usage_templates%rowtype;ids uuid[];v_id uuid:=coalesce(nullif(p_template->>'id','')::uuid,gen_random_uuid());
begin
  perform public.require_permission('kitchen.manage');perform pg_advisory_xact_lock(73081,1);
  select * into old from public.kitchen_usage_templates t where t.id=v_id;
  if old.updated_at is distinct from p_expected_updated_at then raise exception 'The template changed on another device. Reload it.' using errcode='40001';end if;
  if coalesce(length(trim(p_template->>'name')),0) not between 1 and 100 or jsonb_typeof(p_template->'ingredient_ids') is distinct from 'array' or jsonb_array_length(p_template->'ingredient_ids') not between 1 and 200 then raise exception 'Choose a name and ingredients.';end if;
  select array_agg(value::uuid) into ids from jsonb_array_elements_text(p_template->'ingredient_ids');
  if (select count(*) from public.ingredient_items where ingredient_items.id=any(ids) and active and category in ('Food','Seafood','Condiment'))<>cardinality(ids) then raise exception 'Choose distinct active kitchen ingredients.';end if;
  insert into public.kitchen_usage_templates(id,name,ingredient_ids,created_by) values(v_id,trim(p_template->>'name'),ids,auth.uid())
    on conflict on constraint kitchen_usage_templates_pkey do update set name=excluded.name,ingredient_ids=excluded.ingredient_ids,updated_at=clock_timestamp() returning * into r;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_json,after_json) values(auth.uid(),'save_kitchen_template','kitchen_template',r.id,to_jsonb(old),to_jsonb(r));return to_jsonb(r);
end $$;

create function public.read_daily_kitchen_usage(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  if not public.has_permission('kitchen.production.manage') and not public.has_permission('purchasing.cost.view') then raise exception 'Kitchen access required.' using errcode='42501';end if;
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>370 then raise exception 'Select a period up to one year.';end if;
  return coalesce((select jsonb_agg(case when public.has_permission('purchasing.cost.view') then to_jsonb(d)
    else jsonb_set(to_jsonb(d),'{lines}',coalesce((select jsonb_agg(l-'unit_cost') from jsonb_array_elements(d.lines) l),'[]'::jsonb)) end order by business_date)
    from public.kitchen_daily_usage d where business_date between p_from and p_to),'[]'::jsonb);
end $$;

create function public.save_daily_kitchen_usage(p_record jsonb,p_expected_updated_at timestamptz,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare old public.kitchen_daily_usage%rowtype;r public.kitchen_daily_usage%rowtype;previous public.operation_requests%rowtype;
  h text:=md5(jsonb_build_array(p_record,p_expected_updated_at)::text);d date;g integer;s integer;actor_name text;
  l jsonb;i public.ingredient_items%rowtype;old_line jsonb;new_line jsonb;ids uuid[];ingredient uuid;balance numeric;credit numeric;debit numeric;delta numeric;
  gq numeric;sq numeric;cost numeric;lines jsonb:='[]';record_id uuid;revision integer;result jsonb;
begin
  perform public.require_permission('kitchen.production.manage');
  if auth.uid() is null or p_operation_id is null then raise exception 'Sign in and provide a submission reference.';end if;
  perform pg_advisory_xact_lock(73081,1);
  select * into previous from public.operation_requests where actor_id=auth.uid() and operation='daily_kitchen_usage' and request_id=p_operation_id;
  if found then
    if previous.payload_hash is distinct from h then raise exception 'This confirmation already has different details.';end if;
    select business_date into d from public.kitchen_daily_usage where id=previous.result_id;
    return public.read_daily_kitchen_usage(d,d)->0;
  end if;
  d:=(p_record->>'business_date')::date;g:=(p_record->>'guest_meals')::integer;s:=(p_record->>'staff_meals')::integer;
  if d is null or d>(now() at time zone 'Asia/Kuala_Lumpur')::date or g is null or s is null or g not between 0 and 100000 or s not between 0 and 100000
    or (p_record->>'guest_meals')::numeric<>g or (p_record->>'staff_meals')::numeric<>s then raise exception 'Check the date and whole meal counts.';end if;
  select * into old from public.kitchen_daily_usage where business_date=d for update;
  if old.updated_at is distinct from p_expected_updated_at then raise exception 'This day changed on another device. Reload before editing.' using errcode='40001';end if;
  if old.id is not null then
    perform public.require_permission('kitchen.manage');
    if nullif(trim(p_record->>'notes'),'') is null then raise exception 'Enter a reason for correcting this day.';end if;
  end if;
  if length(coalesce(p_record->>'notes',''))>2000 or jsonb_typeof(p_record->'lines') is distinct from 'array' or jsonb_array_length(p_record->'lines')>200
    or jsonb_typeof(p_record->'template_ids') is distinct from 'array' then raise exception 'Check the ingredient list and notes.';end if;
  if (select count(distinct entry.value->>'ingredient_id') from jsonb_array_elements(p_record->'lines') entry)<>jsonb_array_length(p_record->'lines') then raise exception 'An ingredient appears twice.';end if;
  if (g>0 and not exists(select 1 from jsonb_array_elements(p_record->'lines') entry where (entry.value->>'guest_quantity')::numeric>0))
    or (s>0 and not exists(select 1 from jsonb_array_elements(p_record->'lines') entry where (entry.value->>'staff_quantity')::numeric>0)) then raise exception 'Enter ingredients used for the recorded meals.';end if;
  select array_agg(distinct (entry.value->>'ingredient_id')::uuid) into ids from jsonb_array_elements((p_record->'lines')||coalesce(old.lines,'[]')) entry;
  perform 1 from public.ingredient_items where id=any(ids) order by id for update;
  perform 1 from public.ingredient_balances where ingredient_id=any(ids) order by ingredient_id for update;
  for l in select value from jsonb_array_elements(p_record->'lines') loop
    select * into i from public.ingredient_items where id=(l->>'ingredient_id')::uuid and active and category in ('Food','Seafood','Condiment');
    if not found or i.base_unit is distinct from l->>'unit' then raise exception 'An ingredient or its unit changed. Refresh the list.';end if;
    gq:=(l->>'guest_quantity')::numeric;sq:=(l->>'staff_quantity')::numeric;
    if gq is null or sq is null or gq::text in ('NaN','Infinity','-Infinity') or sq::text in ('NaN','Infinity','-Infinity') or gq<0 or sq<0 or gq+sq>1e9
      or gq<>round(gq,2) or sq<>round(sq,2) or (i.base_unit='unit' and (gq<>trunc(gq) or sq<>trunc(sq))) then raise exception 'Enter nonnegative quantities in the displayed units.';end if;
    if (g=0 and gq>0) or (s=0 and sq>0) then raise exception 'Enter the meal counts for the ingredients used.';end if;
    select value into old_line from jsonb_array_elements(coalesce(old.lines,'[]')) where value->>'ingredient_id'=i.id::text;
    cost:=case when old_line ? 'unit_cost' then (old_line->>'unit_cost')::numeric when i.cost_per_base_unit>0 then i.cost_per_base_unit else null end;
    lines:=lines||jsonb_build_array(jsonb_build_object('ingredient_id',i.id,'name',i.name,'unit',i.base_unit,'guest_quantity',gq,'staff_quantity',sq,'unit_cost',cost));
  end loop;
  select nullif(trim(full_name),'') into actor_name from public.profiles where id=auth.uid();if actor_name is null then raise exception 'Your profile needs a staff name.';end if;
  record_id:=coalesce(old.id,gen_random_uuid());revision:=coalesce(old.revision,0)+1;
  foreach ingredient in array coalesce(ids,array[]::uuid[]) loop
    select value into old_line from jsonb_array_elements(coalesce(old.lines,'[]')) where value->>'ingredient_id'=ingredient::text;
    select value into new_line from jsonb_array_elements(lines) where value->>'ingredient_id'=ingredient::text;
    credit:=coalesce((old_line->>'guest_quantity')::numeric,0)+coalesce((old_line->>'staff_quantity')::numeric,0);
    debit:=coalesce((new_line->>'guest_quantity')::numeric,0)+coalesce((new_line->>'staff_quantity')::numeric,0);delta:=credit-debit;
    insert into public.ingredient_balances(ingredient_id,quantity_on_hand) values(ingredient,0) on conflict(ingredient_id) do nothing;
    select quantity_on_hand into balance from public.ingredient_balances where ingredient_id=ingredient for update;
    if balance+delta<0 then raise exception 'Not enough shared stock: %',(select name from public.ingredient_items where id=ingredient);end if;
    if delta<>0 then
      update public.ingredient_balances set quantity_on_hand=balance+delta,updated_at=clock_timestamp() where ingredient_id=ingredient;
      insert into public.ingredient_movements(ingredient_id,movement_type,quantity_change,quantity_before,quantity_after,unit_input,input_quantity,reference_type,reference_id,reason,notes,entered_by,created_by)
        values(ingredient,'kitchen_production',delta,balance,balance+delta,'base',abs(delta),'daily_kitchen_usage',record_id,'Daily Kitchen Usage',d::text||' | '||coalesce(p_record->>'notes',''),actor_name,auth.uid());
    end if;
  end loop;
  insert into public.kitchen_daily_usage(id,business_date,guest_meals,staff_meals,template_ids,lines,notes,revision,created_by,created_by_name)
    values(record_id,d,g,s,p_record->'template_ids',lines,coalesce(p_record->>'notes',''),revision,auth.uid(),actor_name)
    on conflict(business_date) do update set guest_meals=excluded.guest_meals,staff_meals=excluded.staff_meals,template_ids=excluded.template_ids,lines=excluded.lines,notes=excluded.notes,revision=excluded.revision,created_by=excluded.created_by,created_by_name=excluded.created_by_name,updated_at=clock_timestamp() returning * into r;
  insert into public.operation_requests(actor_id,operation,request_id,payload_hash,result_id) values(auth.uid(),'daily_kitchen_usage',p_operation_id,h,r.id);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_json,after_json) values(auth.uid(),'save_daily_kitchen_usage','daily_kitchen_usage',r.id,to_jsonb(old),to_jsonb(r));
  return public.read_daily_kitchen_usage(d,d)->0;
end $$;

revoke all on function public.save_expense_receipt(jsonb,uuid),public.read_expense_receipts(date,date),public.void_expense_receipt(uuid,text),public.read_kitchen_templates(),public.save_kitchen_template(jsonb,timestamptz),public.read_daily_kitchen_usage(date,date),public.save_daily_kitchen_usage(jsonb,timestamptz,uuid) from public,anon;
grant execute on function public.save_expense_receipt(jsonb,uuid),public.read_expense_receipts(date,date),public.void_expense_receipt(uuid,text),public.read_kitchen_templates(),public.save_kitchen_template(jsonb,timestamptz),public.read_daily_kitchen_usage(date,date),public.save_daily_kitchen_usage(jsonb,timestamptz,uuid) to authenticated;

-- Preserve existing role/privacy rules; apply the temporary release lock before them.
create function public.code_expense_receipt(p_id uuid,p_purpose text,p_lines jsonb,p_expected_version integer,p_reason text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare original jsonb;result jsonb;l jsonb;legacy boolean:=false;
begin
  perform public.require_permission('purchasing.cost.view');
  if not(public.has_permission('purchasing.cost.manage') or public.has_permission('purchasing.manage')) then raise exception 'Accounts editing permission required.' using errcode='42501';end if;
  perform pg_advisory_xact_lock(73081,1);
  select to_jsonb(e) into original from public.expense_receipts e where id=p_id and status='confirmed' for update;
  if original is null then select to_jsonb(e) into original from public.purchase_evidence e where record_id=p_id for update;legacy:=true;end if;
  if original is null then raise exception 'Receipt is unavailable.';end if;
  if (original->>'coding_version')::integer is distinct from p_expected_version then raise exception 'Receipt breakdown changed on another device. Reopen the receipt.' using errcode='40001';end if;
  if p_purpose is null or p_purpose not in ('guest_meals','staff_meals','bar') or coalesce(length(trim(p_reason)),0) not between 1 and 2000 or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines)>200 then raise exception 'Check the purpose, items and correction note.';end if;
  for l in select value from jsonb_array_elements(p_lines) loop
    if coalesce(length(trim(l->>'name')),0) not between 1 and 120 or coalesce(l->>'category','') not in ('Vegetables','Seafood','Meat & Eggs','Rice & Dry Goods','Seasoning & Oil','Cooking Gas','Bar Drinks','Other')
      or coalesce(l->>'unit','') not in ('kg','g','L','ml','pcs','pack','bag','bottle','tin','cylinder','carton')
      or jsonb_typeof(l->'quantity') is distinct from 'number' or (l->>'quantity')::numeric<=0 or (l->>'quantity')::numeric>1e9
      or jsonb_typeof(l->'amount') is distinct from 'number' or (l->>'amount')::numeric<0 or (l->>'amount')::numeric>99999999.99 or (l->>'amount')::numeric<>round((l->>'amount')::numeric,2) then raise exception 'Check each item name, category, quantity, unit and cost.';end if;
  end loop;
  if legacy then update public.purchase_evidence set purpose=p_purpose,lines=p_lines,coding_version=coding_version+1 where record_id=p_id returning to_jsonb(purchase_evidence) into result;
  else update public.expense_receipts set purpose=p_purpose,lines=p_lines,coding_version=coding_version+1 where id=p_id returning to_jsonb(expense_receipts) into result;end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_json,after_json) values(auth.uid(),'code_expense_receipt','expense_receipt',p_id,original,result||jsonb_build_object('correction_reason',p_reason));
  return result;
end $$;
revoke all on function public.code_expense_receipt(uuid,text,jsonb,integer,text) from public,anon;
grant execute on function public.code_expense_receipt(uuid,text,jsonb,integer,text) to authenticated;

do $$declare definition text;begin
  definition:=pg_get_functiondef('public.user_has_permission(uuid,text)'::regprocedure);
  definition:=replace(definition,'public.user_has_permission(', 'public.user_has_permission_before_supply_rollout(');
  execute definition;
end $$;
revoke all on function public.user_has_permission_before_supply_rollout(uuid,text) from public,anon,authenticated;
create or replace function public.user_has_permission(p_user_id uuid,p_code text) returns boolean
language sql stable security definer set search_path=public as $$
  select (p_code like 'bar.%' or p_code like 'kitchen.%' or p_code like 'purchasing.%' or p_code in ('platform.users.manage','platform.roles.manage','platform.audit.view','platform.settings.manage'))
    and public.user_has_permission_before_supply_rollout(p_user_id,p_code)
$$;

do $$declare t text;begin
  foreach t in array array['expense_receipts','kitchen_daily_usage','kitchen_usage_templates'] loop
    begin execute format('alter publication supabase_realtime add table public.%I',t);exception when duplicate_object or undefined_object then null;end;
  end loop;
end $$;
