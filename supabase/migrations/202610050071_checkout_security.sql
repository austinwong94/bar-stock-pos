-- Keep payment recovery bound to the original account and immutable request.
begin;

create table public.pos_checkout_requests (
  request_key text primary key,
  actor_id uuid not null references public.profiles(id),
  payload jsonb not null,
  sale_id uuid not null references public.sales(id),
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.pos_checkout_requests enable row level security;
revoke all on public.pos_checkout_requests from public, anon, authenticated;

alter function public.complete_sale_with_qr_type(jsonb,text,text,text,text,text,numeric,text,text,text)
  rename to complete_sale_with_qr_type_internal;
revoke all on function public.complete_sale_with_qr_type_internal(jsonb,text,text,text,text,text,numeric,text,text,text) from public,anon,authenticated;
revoke all on function public.complete_sale(jsonb,text,text,text,text,text,numeric,text,text) from public,anon,authenticated;

create function public.complete_sale_with_qr_type(
  p_items jsonb, p_payment_method text, p_qr_reference text default null,
  p_complimentary_reason text default null, p_idempotency_key text default null,
  p_qr_receipt_image_path text default null, p_discount_amount numeric default 0,
  p_order_taken_by text default null, p_qr_payment_type text default null,
  p_table_number text default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  request public.pos_checkout_requests%rowtype;
  intent jsonb;
  result jsonb;
  current_status text;
begin
  perform public.require_permission('bar.pos.use');
  if nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key)>128 then
    raise exception 'A payment request ID is required. Refresh before taking payment.';
  end if;
  intent:=jsonb_build_object('items',p_items,'method',p_payment_method,'reference',p_qr_reference,
    'reason',p_complimentary_reason,'receipt',p_qr_receipt_image_path,'discount',p_discount_amount,
    'staff',p_order_taken_by,'qr_type',p_qr_payment_type,'table',p_table_number);
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key,0));
  select * into request from public.pos_checkout_requests where request_key=p_idempotency_key;
  if found then
    if request.actor_id is distinct from auth.uid() or request.payload is distinct from intent then
      raise exception 'This payment already has different saved details or belongs to another account. Do not take payment again. Ask a manager to check Sales.' using errcode='LP001';
    end if;
    select status into current_status from public.sales where id=request.sale_id;
    return request.result || jsonb_build_object('status',current_status);
  end if;
  -- Old payments have no complete request snapshot: never guess that a retry matches.
  if exists(select 1 from public.sales where idempotency_key=p_idempotency_key) then
    raise exception 'This payment was recorded before the security update. Do not take payment again. Ask a manager to check Sales.' using errcode='LP001';
  end if;
  if p_payment_method is null or p_payment_method not in ('cash','qr','complimentary') then
    raise exception 'Select a payment method.';
  end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'Cart is empty.'; end if;
  if jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>200 then raise exception 'Choose between 1 and 200 sale lines.'; end if;
  if coalesce(p_discount_amount,0)::text in ('NaN','Infinity','-Infinity') then raise exception 'Enter a valid discount.'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) i where i->>'custom_price' in ('NaN','Infinity','-Infinity')) then
    raise exception 'Enter a valid price.';
  end if;
  if nullif(trim(p_order_taken_by),'') is null then raise exception 'Select who took the order.'; end if;
  if p_payment_method='qr' then
    if coalesce(p_qr_payment_type,'') not in ('WeChat Pay','AliPay','TnGo','Grab','Others') then raise exception 'Select a QR Payment type.'; end if;
    if nullif(trim(p_qr_receipt_image_path),'') is null then raise exception 'QR receipt photo is required.'; end if;
    perform pg_advisory_xact_lock(hashtextextended('payment-receipt:'||p_qr_receipt_image_path,0));
    -- Lock the object until the sale commits so cleanup cannot remove its proof mid-save.
    perform 1 from storage.objects where bucket_id='payment-receipts'
      and name=p_qr_receipt_image_path and owner=auth.uid() for key share;
    if not found then raise exception 'Upload your QR receipt photo before confirming payment.'; end if;
    if exists(select 1 from public.sales where qr_receipt_image_path=p_qr_receipt_image_path) then
      raise exception 'This QR receipt is already linked to a sale. Check Sales before taking payment again.' using errcode='LP001';
    end if;
  elsif p_qr_receipt_image_path is not null or p_qr_payment_type is not null then
    raise exception 'QR receipt details can only be used for QR payments.';
  end if;
  result:=public.complete_sale_with_qr_type_internal(p_items,p_payment_method,p_qr_reference,
    p_complimentary_reason,p_idempotency_key,p_qr_receipt_image_path,p_discount_amount,
    p_order_taken_by,p_qr_payment_type,p_table_number);
  if public.setting_bool('require_manager_approval_for_complimentary',false)
    and (p_payment_method='complimentary' or (p_discount_amount>0 and (result->>'total_amount')::numeric=0))
    and not (public.has_permission('bar.pos.void') and exists(select 1 from public.profiles
      where id=auth.uid() and not is_anonymous and admin_access_expires_at>now())) then
    raise exception 'Manager approval is required. Sign in with an approved manager account and confirm the admin password.';
  end if;
  insert into public.pos_checkout_requests(request_key,actor_id,payload,sale_id,result)
    values(p_idempotency_key,auth.uid(),intent,(result->>'sale_id')::uuid,result);
  return result || jsonb_build_object('status','completed');
end $$;
revoke all on function public.complete_sale_with_qr_type(jsonb,text,text,text,text,text,numeric,text,text,text) from public,anon;
grant execute on function public.complete_sale_with_qr_type(jsonb,text,text,text,text,text,numeric,text,text,text) to authenticated;

create function public.protect_payment_receipt() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if old.bucket_id='payment-receipts' and exists(select 1 from public.sales where qr_receipt_image_path=old.name) then
    raise exception 'This receipt is linked to a sale and must be retained.' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.protect_payment_receipt() from public,anon,authenticated;
create trigger retain_payment_receipts before update or delete on storage.objects
  for each row execute function public.protect_payment_receipt();

drop policy if exists "payment receipt read manager" on storage.objects;
create policy "payment receipt read manager" on storage.objects for select to authenticated
  using (bucket_id='payment-receipts' and (public.has_permission('bar.reports.view')
    or (owner=auth.uid() and public.has_permission('bar.pos.use'))));
drop policy if exists "payment receipt upload authenticated" on storage.objects;
create policy "payment receipt upload authenticated" on storage.objects for insert to authenticated
  with check (bucket_id='payment-receipts' and owner=auth.uid() and public.has_permission('bar.pos.use'));
drop policy if exists "payment receipt delete own upload" on storage.objects;
create policy "payment receipt delete own upload" on storage.objects for delete to authenticated
  using (bucket_id='payment-receipts' and owner=auth.uid() and public.has_permission('bar.pos.use'));

-- These helpers are called only by guarded server functions, never directly by clients.
revoke all on function public.purchase_request_message(uuid) from public,anon,authenticated;
revoke all on function public.order_pickup_run(uuid) from public,anon,authenticated;
revoke all on function public.submit_kitchen_production(date,text,numeric,text,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.record_kitchen_stock_out(jsonb,text,text,uuid) from public,anon,authenticated;

-- A PIN may confirm existing rights, but cannot confer new rights on a shared tablet.
do $$declare definition text; elevation text;begin
  definition:=pg_get_functiondef('public.user_has_permission_before_supply_rollout(uuid,text)'::regprocedure);
  elevation:=$branch$    when p_code in ('bar.products.manage','bar.settings.manage','bar.pos.void','bar.stock.manage','bar.closing.manage','bar.reports.view')
      and exists (select 1 from public.profiles p join public.access_role_permissions rp on rp.role_code=p.access_role_code
        where p.id=p_user_id and rp.permission_code='bar.pos.use' and p.admin_access_expires_at>now()) then true
$branch$;
  if position(elevation in definition)=0 then raise exception 'Admin permission function changed. Review migration before applying.';end if;
  execute replace(definition,elevation,'');
end $$;

create or replace function public.user_has_permission(p_user_id uuid,p_code text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select (p_code like 'bar.%' or p_code like 'kitchen.%' or p_code like 'purchasing.%'
    or p_code in ('platform.users.manage','platform.roles.manage','platform.audit.view','platform.settings.manage'))
    and (p_code in ('bar.pos.use','bar.stock.view') or not exists(
      select 1 from public.profiles where id=p_user_id and is_anonymous))
    and public.user_has_permission_before_supply_rollout(p_user_id,p_code)
$$;
revoke all on function public.user_has_permission(uuid,text) from public,anon,authenticated;

create or replace function public.verify_admin_access(p_admin_password text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare expiry timestamptz:=now()+interval '2 hours';begin
  if not exists(select 1 from public.profiles where id=auth.uid() and status='active' and not is_anonymous)
    or not (public.has_permission('bar.products.manage') or public.has_permission('bar.settings.manage')
      or public.has_permission('bar.pos.void') or public.has_permission('bar.stock.manage')
      or public.has_permission('bar.closing.manage') or public.has_permission('bar.reports.view')) then
    raise exception 'Sign in with an approved manager account. The shared bar code cannot unlock admin access.' using errcode='42501';
  end if;
  if encode(digest(coalesce(p_admin_password,''),'sha256'),'hex')<>'90727dcc85c0513b949e872edf5434fe14e7a8a17f64fdb3271d721e73d74911' then
    raise exception 'Wrong admin password.' using errcode='42501';
  end if;
  update public.profiles set admin_access_expires_at=expiry where id=auth.uid();
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_json)
    values(auth.uid(),'verify_admin_access','profile',auth.uid(),jsonb_build_object('expires_at',expiry));
  return jsonb_build_object('admin_access_expires_at',expiry);
end $$;
revoke all on function public.verify_admin_access(text) from public,anon;
grant execute on function public.verify_admin_access(text) to authenticated;
commit;
