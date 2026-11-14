begin;

-- Version metadata only; existing money, stock, receipts and audit rows are retained.
alter table public.sales add column if not exists review_version bigint not null default 0 check (review_version >= 0);
create or replace function public.protect_sale_review() returns trigger
language plpgsql set search_path=pg_catalog,public,pg_temp as $$
begin
 if current_user in ('anon','authenticated') then
   raise exception 'Use the checked sale action.' using errcode='42501';
 end if;
 new.review_version:=old.review_version+1;
 return new;
end $$;
revoke all on function public.protect_sale_review() from public,anon,authenticated;
do $$begin
 if not exists(select 1 from pg_trigger where tgrelid='public.sales'::regclass and tgname='checked_sale_review') then
   create trigger checked_sale_review before update on public.sales for each row execute function public.protect_sale_review();
 end if;
end $$;

create table if not exists public.bar_sale_action_requests(
 request_id uuid primary key,actor_id uuid not null references public.profiles(id),sale_id uuid not null references public.sales(id),
 action text not null check(action in ('void','verified','mismatch')),payload jsonb not null,result jsonb not null,created_at timestamptz not null default now()
);
alter table public.bar_sale_action_requests enable row level security;
revoke all on public.bar_sale_action_requests from public,anon,authenticated;
grant all on public.bar_sale_action_requests to service_role;
create index if not exists bar_sale_action_actor_date_idx on public.bar_sale_action_requests(actor_id,created_at desc);
create index if not exists bar_sale_action_sale_date_idx on public.bar_sale_action_requests(sale_id,created_at desc);

create or replace function public.review_bar_sale_action(
 p_sale_id uuid,p_action text,p_reason text,p_expected_version bigint,p_request_id uuid,p_expected_actor_id uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare previous public.bar_sale_action_requests%rowtype; sale public.sales%rowtype; result jsonb;
 intent jsonb:=jsonb_build_array(p_sale_id,p_action,p_reason,p_expected_version);begin
 if p_action='void' then perform public.require_permission('bar.pos.void');
 elsif p_action in ('verified','mismatch') then perform public.require_permission('bar.closing.manage');
 else raise exception 'Choose a sale action.' using errcode='22023';end if;
 if auth.uid() is null or p_expected_actor_id is distinct from auth.uid() then raise exception 'Account changed. Use the original account.' using errcode='42501';end if;
 if p_request_id is null then raise exception 'An action reference is required.' using errcode='22023';end if;
 perform pg_advisory_xact_lock(77312,1);
 select * into previous from public.bar_sale_action_requests where request_id=p_request_id;
 if found then
   if previous.actor_id is distinct from auth.uid() or previous.payload is distinct from intent then
     raise exception 'This action belongs to different original details or another account.' using errcode='LP001';end if;
   return previous.result;
 end if;
 if p_expected_version is null or p_expected_version<0 or (p_action='void' and nullif(trim(p_reason),'') is null)
   or (p_action<>'void' and p_reason is not null) then raise exception 'Review the sale action details.' using errcode='22023';end if;
 select * into sale from public.sales where id=p_sale_id for update;
 if not found then raise exception 'Sale not found.' using errcode='22023';end if;
 if sale.review_version<>p_expected_version then raise exception 'This sale changed on another device. Reload and review it again.' using errcode='40001';end if;
 if sale.status<>'completed' then raise exception 'This sale is already voided. Reload sales.' using errcode='40001';end if;
 if p_action<>'void' and (sale.payment_method<>'qr' or sale.qr_status=p_action) then raise exception 'This QR payment changed. Reload sales.' using errcode='40001';end if;
 if p_action='void' then result:=public.void_sale(p_sale_id,p_reason);
 else result:=public.verify_qr_payment(p_sale_id,p_action,null);end if;
 result:=jsonb_build_object('request_id',p_request_id,'actor_id',auth.uid(),'action',p_action,'sale',result);
 insert into public.bar_sale_action_requests(request_id,actor_id,sale_id,action,payload,result) values(p_request_id,auth.uid(),p_sale_id,p_action,intent,result);
 return result;
end $$;
revoke all on function public.review_bar_sale_action(uuid,text,text,bigint,uuid,uuid) from public,anon;
grant execute on function public.review_bar_sale_action(uuid,text,text,bigint,uuid,uuid) to authenticated;
-- Retain the existing engines and closed-day lock, but expose one mutation authority.
revoke all on function public.void_sale(uuid,text) from public,anon,authenticated;
revoke all on function public.verify_qr_payment(uuid,text,text) from public,anon,authenticated;
create or replace function public.read_platform_schema_version() returns jsonb
language sql stable security definer set search_path=pg_catalog,public,pg_temp as $$
 select jsonb_build_object('schema_version','202610140073','measured_piece_receiving',true,
   'sale_action_recovery',has_function_privilege('authenticated','public.review_bar_sale_action(uuid,text,text,bigint,uuid,uuid)','execute')
     and not has_function_privilege('authenticated','public.void_sale(uuid,text)','execute')
     and not has_function_privilege('authenticated','public.verify_qr_payment(uuid,text,text)','execute'),
   'private_payment_receipts',coalesce((select not public from storage.buckets where id='payment-receipts'),false),
   'private_purchase_evidence',coalesce((select not public from storage.buckets where id='purchase-evidence'),false),
   'retired_writes_private',not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
     and p.proname in ('complete_sale','create_stock_in_draft','close_daily_report','save_expense_receipt','submit_kitchen_production','record_kitchen_usage_checked','delivery_stock_measurement','request_delivery_validate')
     and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))))
$$;
revoke all on function public.read_platform_schema_version() from public;
grant execute on function public.read_platform_schema_version() to anon,authenticated;
notify pgrst,'reload schema';
commit;
