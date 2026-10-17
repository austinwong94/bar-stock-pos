-- New standalone kitchen receipts hand over quantities, never prices, to receiving.
-- Intentionally no backfill: older receipts may already have been received manually.
create table public.receipt_delivery_sources (
  id uuid primary key references public.expense_receipts(id), supplier text not null,
  reference text not null, purchase_date date not null, lines jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create table public.receipt_delivery_drafts (
  id uuid primary key, request_id uuid not null references public.receipt_delivery_sources(id),
  request_no text not null, status text not null default 'draft' check(status in('draft','confirmed','cancelled')),
  version integer not null default 1, items jsonb not null,
  created_by uuid not null references auth.users(id), created_by_name text not null, created_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references auth.users(id), updated_by_name text not null, updated_at timestamptz not null default clock_timestamp(),
  confirmed_record jsonb, cancelled_reason text
);
create unique index receipt_delivery_one_draft on public.receipt_delivery_drafts(request_id) where status='draft';
create index receipt_delivery_by_source on public.receipt_delivery_drafts(request_id,status);
alter table public.receipt_delivery_sources enable row level security;
alter table public.receipt_delivery_drafts enable row level security;
revoke all on public.receipt_delivery_sources,public.receipt_delivery_drafts from public,anon,authenticated;

create function public.receipt_delivery_capture() returns trigger language plpgsql security definer set search_path=public as $$
declare lines jsonb;
begin
  if new.status='confirmed' and new.purpose in('guest_meals','staff_meals') and jsonb_array_length(new.lines)>0 then
    select jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'name',v->>'name','quantity',(v->>'quantity')::numeric,'unit',v->>'unit','sort_order',n-1) order by n)
      into lines from jsonb_array_elements(new.lines) with ordinality as x(v,n);
    insert into public.receipt_delivery_sources(id,supplier,reference,purchase_date,lines) values(new.id,new.supplier,new.receipt_no,new.purchase_date,lines);
  end if;
  return new;
end $$;
create trigger receipt_delivery_capture after insert on public.expense_receipts for each row execute function public.receipt_delivery_capture();

create function public.receipt_delivery_guard() returns trigger language plpgsql security definer set search_path=public as $$
declare s public.receipt_delivery_sources%rowtype;a jsonb;b jsonb;
begin
  select * into s from public.receipt_delivery_sources where id=old.id;
  if not found then return new;end if;
  if new.status='void' then
    if exists(select 1 from public.receipt_delivery_drafts where request_id=old.id and status='confirmed') then
      raise exception 'Items were already received. Ask a manager to reconcile stock before correcting this receipt.';
    end if;
    return new;
  end if;
  select jsonb_agg(jsonb_build_object('name',v->>'name','unit',v->>'unit','quantity',(v->>'quantity')::numeric) order by n) into a from jsonb_array_elements(new.lines) with ordinality x(v,n);
  select jsonb_agg(jsonb_build_object('name',v->>'name','unit',v->>'unit','quantity',(v->>'quantity')::numeric) order by n) into b from jsonb_array_elements(s.lines) with ordinality x(v,n);
  if new.purpose not in('guest_meals','staff_meals') or a is distinct from b then
    raise exception 'These item quantities were sent to the kitchen. Only costs and categories can be edited here. Void and replace the receipt before receiving to correct items.';
  end if;
  return new;
end $$;
create trigger receipt_delivery_guard before update on public.expense_receipts for each row execute function public.receipt_delivery_guard();

create function public.receipt_delivery_request(p_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare s public.receipt_delivery_sources%rowtype;items jsonb;
begin
  select * into s from public.receipt_delivery_sources where id=p_id;
  if not found then raise exception 'Receipt delivery not found.';end if;
  select jsonb_agg(jsonb_build_object('id',l->>'id','request_id',s.id,'item_name',l->>'name','unit',l->>'unit','quantity',l->'quantity',
    'purchased_quantity',l->'quantity','purchase_status','bought','supplier',s.supplier,'sort_order',l->'sort_order','updated_at',s.created_at,
    'purchase_receipts',(select coalesce(jsonb_agg(r),'[]') from public.receipt_delivery_drafts d cross join lateral jsonb_array_elements(d.confirmed_record->'receipts') r where d.request_id=s.id and d.status='confirmed' and r->>'purchase_item_id'=l->>'id')) order by (l->>'sort_order')::integer)
    into items from jsonb_array_elements(s.lines) l;
  return jsonb_build_object('id',s.id,'request_no',coalesce(nullif(s.reference,''),left(s.id::text,8)),'supplier',s.supplier,'origin','kitchen','needed_for_date',s.purchase_date,
    'status','completed','created_at',s.created_at,'updated_at',s.created_at,'purchase_request_items',items);
end $$;

create function public.read_receipt_deliveries(p_query text default '',p_limit integer default 10,p_offset integer default 0,p_history boolean default false) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  perform public.require_permission('purchasing.receive');
  if p_limit is null or p_limit not between 1 and 50 or p_offset is null or p_offset<0 or length(p_query)>160 then raise exception 'Invalid delivery page.';end if;
  with eligible as (
    select s.*,public.receipt_delivery_request(s.id) r from public.receipt_delivery_sources s join public.expense_receipts e using(id)
    where e.status='confirmed' and (coalesce(p_query,'')='' or position(lower(trim(p_query)) in lower(s.supplier||' '||s.reference||' '||s.lines::text))>0)
  ), filtered as (
    select * from eligible where exists(select 1 from jsonb_array_elements(r->'purchase_request_items') l where (l->>'quantity')::numeric>(select coalesce(sum((p->>'purchase_quantity')::numeric),0) from jsonb_array_elements(l->'purchase_receipts') p)) is distinct from p_history
  ), page as (select * from filtered order by case when not p_history then created_at end,case when p_history then created_at end desc,id limit p_limit offset p_offset)
  select jsonb_build_object('total',(select count(*) from filtered),'records',coalesce((select jsonb_agg(jsonb_build_object('request',r,'draft',(select to_jsonb(d) from public.receipt_delivery_drafts d where d.request_id=page.id and status='draft'))) from page),'[]')) into result;
  return result;
end $$;
create function public.read_receipt_delivery(p_request_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  perform public.require_permission('purchasing.receive');
  return jsonb_build_object('request',public.receipt_delivery_request(p_request_id),'draft',(select to_jsonb(d) from public.receipt_delivery_drafts d where request_id=p_request_id and status='draft'));
end $$;

create function public.receipt_delivery_validate(p_id uuid,p_items jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb;l jsonb;p jsonb;i public.ingredient_items%rowtype;qty numeric;size numeric;received numeric;base numeric;result jsonb:='[]';fixed_unit text;fixed_size numeric;
begin
  perform 1 from public.expense_receipts where id=p_id and status='confirmed' for update;
  if not found then raise exception 'This purchase receipt was voided. Do not receive it.' using errcode='40001';end if;
  r:=public.receipt_delivery_request(p_id);
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 200 then raise exception 'Review between 1 and 200 items.';end if;
  if (select count(distinct value->>'item_id') from jsonb_array_elements(p_items))<>jsonb_array_length(p_items) then raise exception 'Review each receipt item once.';end if;
  for l in select value from jsonb_array_elements(p_items) order by value->>'ingredient_id',value->>'item_id' loop
    select value into p from jsonb_array_elements(r->'purchase_request_items') where value->>'id'=l->>'item_id';
    select coalesce(sum((value->>'purchase_quantity')::numeric),0) into received from jsonb_array_elements(p->'purchase_receipts');
    if p is null or (p->>'updated_at')::timestamptz is distinct from (l->>'expected_updated_at')::timestamptz or received is distinct from (l->>'expected_received_quantity')::numeric then raise exception 'Another delivery changed. Reopen and check the remaining quantities.' using errcode='40001';end if;
    select * into i from public.ingredient_items where id=(l->>'ingredient_id')::uuid and active and category in('Food','Seafood','Condiment') for update;
    if not found or i.base_unit is distinct from l->>'expected_base_unit' or (l ? 'ingredient_version' and i.updated_at is distinct from (l->>'ingredient_version')::timestamptz) then raise exception 'Inventory item changed. Reopen the delivery.' using errcode='40001';end if;
    qty:=(l->>'quantity')::numeric;size:=(l->>'base_per_unit')::numeric;base:=qty*size;
    if qty is null or size is null or qty<=0 or size<=0 or qty::text in('NaN','Infinity','-Infinity') or size::text in('NaN','Infinity','-Infinity') or qty<>round(qty,4) or size<>round(size,4) or base>=1e12 or base<>round(base,2) or (i.base_unit='unit' and not public.kitchen_fractional(i) and base<>trunc(base)) then raise exception 'Check delivered quantities and pack sizes.';end if;
    if qty>(p->>'quantity')::numeric-received then raise exception 'Quantity exceeds what is still outstanding.';end if;
    fixed_unit:=case lower(trim(p->>'unit')) when 'kg' then 'g' when 'g' then 'g' when 'l' then 'ml' when 'ml' then 'ml' when 'pcs' then 'unit' when 'pc' then 'unit' when 'unit' then 'unit' when 'units' then 'unit' when 'biji' then 'unit' when 'ekor' then 'unit' end;
    fixed_size:=case lower(trim(p->>'unit')) when 'kg' then 1000 when 'l' then 1000 else 1 end;
    if fixed_unit is not null and (i.base_unit<>fixed_unit or size<>fixed_size) then raise exception 'The inventory unit does not match the purchase unit.';end if;
    result:=result||jsonb_build_array(jsonb_build_object('item_id',l->>'item_id','ingredient_id',i.id,'quantity',qty,'base_per_unit',size,'expected_updated_at',p->>'updated_at',
      'expected_received_quantity',received,'expected_base_unit',i.base_unit,'ingredient_version',i.updated_at,'purchase_name',p->>'item_name','purchase_unit',p->>'unit',
      'ingredient_name',coalesce(i.kitchen_label,i.name),'display_unit',coalesce(i.kitchen_unit,case when i.base_unit='g' then 'kg' when i.base_unit='unit' then 'pcs' else i.base_unit end),
      'display_factor',case when i.kitchen_key is not null then i.kitchen_factor when i.base_unit='g' then 1000 else 1 end));
  end loop;
  return result;
end $$;

create function public.save_receipt_delivery_draft(p_id uuid,p_request_id uuid,p_items jsonb,p_expected_version integer,p_operation_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare old public.receipt_delivery_drafts%rowtype;d public.receipt_delivery_drafts%rowtype;op public.operation_requests%rowtype;
  h text:=md5(jsonb_build_object('id',p_id,'receipt',p_request_id,'items',p_items,'version',p_expected_version)::text);a uuid;staff text;items jsonb;
begin
  perform public.require_permission('purchasing.receive');perform pg_advisory_xact_lock(73081,1);
  if p_id is null or p_operation_id is null or p_request_id is null then raise exception 'Submission reference required.';end if;
  select * into op from public.operation_requests where actor_id=auth.uid() and operation='receipt_delivery_save' and request_id=p_operation_id;
  if found then if op.payload_hash<>h then raise exception 'This submission has different details.';end if;return(select after_json from public.audit_logs where id=op.result_id);end if;
  select * into old from public.receipt_delivery_drafts where id=p_id for update;
  if (old.id is null and p_expected_version is distinct from 0) or (old.id is not null and (old.request_id<>p_request_id or old.status<>'draft' or old.version is distinct from p_expected_version)) then raise exception 'Draft changed. Reopen it.' using errcode='40001';end if;
  if exists(select 1 from public.receipt_delivery_drafts where request_id=p_request_id and status='draft' and id<>p_id) then raise exception 'A saved delivery already exists for this receipt. Open it from Items Arrived.' using errcode='40001';end if;
  items:=public.receipt_delivery_validate(p_request_id,p_items);
  select nullif(trim(full_name),'') into staff from public.profiles where id=auth.uid();if staff is null then raise exception 'Your profile needs a staff name.';end if;
  insert into public.receipt_delivery_drafts(id,request_id,request_no,items,created_by,created_by_name,updated_by,updated_by_name)
    values(p_id,p_request_id,public.receipt_delivery_request(p_request_id)->>'request_no',items,auth.uid(),staff,auth.uid(),staff)
    on conflict(id) do update set items=excluded.items,version=receipt_delivery_drafts.version+1,updated_by=auth.uid(),updated_by_name=staff,updated_at=clock_timestamp() returning * into d;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_json,after_json) values(auth.uid(),'receipt_delivery_saved','receipt_delivery',d.id,case when old.id is not null then to_jsonb(old) end,to_jsonb(d)) returning id into a;
  insert into public.operation_requests(actor_id,operation,request_id,payload_hash,result_id) values(auth.uid(),'receipt_delivery_save',p_operation_id,h,a);
  return to_jsonb(d);
end $$;

create function public.confirm_receipt_delivery_draft(p_id uuid,p_expected_version integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare old public.receipt_delivery_drafts%rowtype;d public.receipt_delivery_drafts%rowtype;s public.receipt_delivery_sources%rowtype;items jsonb;l jsonb;receipts jsonb:='[]';arrival_lines jsonb:='[]';result jsonb;staff text;stamp timestamptz:=clock_timestamp();qty numeric;balance numeric;i uuid;
begin
  perform public.require_permission('purchasing.receive');perform pg_advisory_xact_lock(73081,1);
  select * into old from public.receipt_delivery_drafts where id=p_id for update;if not found then raise exception 'Draft not found.';end if;
  if old.status='confirmed' and old.version=p_expected_version+1 then return old.confirmed_record;end if;
  if old.status<>'draft' or old.version is distinct from p_expected_version then raise exception 'Draft changed. Reopen it.' using errcode='40001';end if;
  items:=public.receipt_delivery_validate(old.request_id,old.items);
  select * into s from public.receipt_delivery_sources where id=old.request_id;
  select nullif(trim(full_name),'') into staff from public.profiles where id=auth.uid();if staff is null then raise exception 'Your profile needs a staff name.';end if;
  for l in select value from jsonb_array_elements(items) loop
    i:=(l->>'ingredient_id')::uuid;qty:=(l->>'quantity')::numeric*(l->>'base_per_unit')::numeric;
    insert into public.ingredient_balances(ingredient_id,quantity_on_hand) values(i,0) on conflict(ingredient_id) do nothing;
    select quantity_on_hand into balance from public.ingredient_balances where ingredient_id=i for update;
    update public.ingredient_balances set quantity_on_hand=balance+qty,updated_at=stamp where ingredient_id=i;
    insert into public.ingredient_movements(ingredient_id,movement_type,quantity_change,quantity_before,quantity_after,unit_input,input_quantity,reference_type,reference_id,reason,notes,entered_by,created_by)
      values(i,'stock_in',qty,balance,balance+qty,'base',qty,'kitchen_arrival',old.id,'Receipt Delivery',s.supplier||' | '||s.reference,staff,auth.uid());
    receipts:=receipts||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'purchase_item_id',l->>'item_id','ingredient_id',i,'purchase_quantity',l->'quantity','base_quantity',qty,'base_unit',l->>'expected_base_unit','received_by',auth.uid(),'received_at',stamp,'ingredient_name',l->>'ingredient_name','purchase_unit',l->>'purchase_unit','base_per_unit',l->'base_per_unit','received_by_name',staff,'display_unit',l->>'display_unit','display_factor',l->'display_factor','details_backfilled',false));
    arrival_lines:=arrival_lines||jsonb_build_array(jsonb_build_object('ingredient_id',i,'name',l->>'ingredient_name','quantity',qty,'unit',l->>'expected_base_unit','entered_quantity',qty/coalesce(nullif((l->>'display_factor')::numeric,0),1),'display_unit',case when (l->>'display_factor')::numeric>0 then l->>'display_unit' else l->>'expected_base_unit' end));
  end loop;
  insert into public.kitchen_arrivals(id,date,supplier,reference,lines,created_by,created_by_name) values(old.id,(stamp at time zone 'Asia/Kuala_Lumpur')::date,s.supplier,s.reference,arrival_lines,auth.uid(),staff);
  result:=jsonb_build_object('id',old.id,'request_id',old.request_id,'request_no',old.request_no,'confirmed_at',stamp,'confirmed_by',auth.uid(),'confirmed_by_name',staff,'receipts',receipts);
  update public.receipt_delivery_drafts set status='confirmed',confirmed_record=result,version=version+1,updated_at=stamp,updated_by=auth.uid(),updated_by_name=staff where id=p_id returning * into d;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_json,after_json) values(auth.uid(),'receipt_delivery_confirmed','receipt_delivery',p_id,to_jsonb(old),to_jsonb(d));
  return result;
end $$;

create function public.cancel_receipt_delivery_draft(p_id uuid,p_expected_version integer,p_reason text) returns void language plpgsql security definer set search_path=public as $$
declare old public.receipt_delivery_drafts%rowtype;d public.receipt_delivery_drafts%rowtype;staff text;
begin
  perform public.require_permission('purchasing.receive');perform pg_advisory_xact_lock(73081,1);
  if nullif(trim(p_reason),'') is null or length(p_reason)>300 then raise exception 'Enter a cancellation reason.';end if;
  select * into old from public.receipt_delivery_drafts where id=p_id for update;if not found then raise exception 'Draft not found.';end if;
  if old.status='cancelled' and old.cancelled_reason=trim(p_reason) then return;end if;
  if old.status<>'draft' or old.version is distinct from p_expected_version then raise exception 'Draft changed. Reopen it.' using errcode='40001';end if;
  select nullif(trim(full_name),'') into staff from public.profiles where id=auth.uid();if staff is null then raise exception 'Your profile needs a staff name.';end if;
  update public.receipt_delivery_drafts set status='cancelled',cancelled_reason=trim(p_reason),version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid(),updated_by_name=staff where id=p_id returning * into d;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_json,after_json) values(auth.uid(),'receipt_delivery_cancelled','receipt_delivery',p_id,to_jsonb(old),to_jsonb(d));
end $$;

do $$declare signature text;begin
  foreach signature in array array['receipt_delivery_capture()','receipt_delivery_guard()','receipt_delivery_request(uuid)','receipt_delivery_validate(uuid,jsonb)'] loop
    execute 'revoke all on function public.'||signature||' from public,anon,authenticated';
  end loop;
  foreach signature in array array['read_receipt_deliveries(text,integer,integer,boolean)','read_receipt_delivery(uuid)','save_receipt_delivery_draft(uuid,uuid,jsonb,integer,uuid)','confirm_receipt_delivery_draft(uuid,integer)','cancel_receipt_delivery_draft(uuid,integer,text)'] loop
    execute 'revoke all on function public.'||signature||' from public,anon';
    execute 'grant execute on function public.'||signature||' to authenticated';
  end loop;
end $$;
