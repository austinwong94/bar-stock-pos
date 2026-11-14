begin;

create table if not exists public.bar_report_reopen_requests(
 request_id uuid primary key,actor_id uuid not null references public.profiles(id),
 report_id uuid not null references public.daily_reports(id),business_date date not null,
 payload jsonb not null,result jsonb not null,created_at timestamptz not null default now()
);
alter table public.bar_report_reopen_requests enable row level security;
revoke all on public.bar_report_reopen_requests from public,anon,authenticated;
grant all on public.bar_report_reopen_requests to service_role;
create index if not exists bar_reopen_actor_date_idx on public.bar_report_reopen_requests(actor_id,created_at desc);
create index if not exists bar_reopen_report_idx on public.bar_report_reopen_requests(report_id);

create or replace function public.protect_daily_report_write() returns trigger
language plpgsql set search_path=pg_catalog,public,pg_temp as $$begin
 if current_user in ('anon','authenticated') then
   raise exception 'Use the checked closing or report reopening.' using errcode='42501';
 end if;
 if tg_op='DELETE' then return old;end if;
 return new;
end $$;
revoke all on function public.protect_daily_report_write() from public,anon,authenticated;
do $$begin
 if not exists(select 1 from pg_trigger where tgrelid='public.daily_reports'::regclass and tgname='checked_daily_report_write') then
   create trigger checked_daily_report_write before insert or update or delete on public.daily_reports for each row execute function public.protect_daily_report_write();
 end if;
end $$;

create or replace function public.reopen_daily_report_checked(
 p_business_date date,p_report_id uuid,p_expected_version text,p_reason text,p_request_id uuid,p_expected_actor_id uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare previous public.bar_report_reopen_requests%rowtype; source public.daily_reports%rowtype; changed public.daily_reports%rowtype;
 intent jsonb:=jsonb_build_array(p_business_date,p_report_id,p_expected_version,p_reason);result jsonb;
begin
 perform public.require_permission('bar.closing.manage');
 if auth.uid() is null or p_expected_actor_id is distinct from auth.uid() then raise exception 'Use the original account.' using errcode='42501';end if;
 if p_request_id is null then raise exception 'A reopening reference is required.' using errcode='22023';end if;
 perform pg_advisory_xact_lock(77312,1);
 select * into previous from public.bar_report_reopen_requests where request_id=p_request_id;
 if found then
   if previous.actor_id is distinct from auth.uid() or previous.payload is distinct from intent then raise exception 'Check the original reopening details and account.' using errcode='LP001';end if;
   return previous.result;
 end if;
 if not exists(select 1 from public.profiles where id=auth.uid() and admin_access_expires_at>now()) then
   raise exception 'Unlock report editing from Reports, then check this reopening.' using errcode='42501';
 end if;
 if p_business_date is null or p_report_id is null or nullif(trim(p_expected_version),'') is null or nullif(trim(p_reason),'') is null then raise exception 'Review the report reopening details.' using errcode='22023';end if;
 select * into source from public.daily_reports where business_date=p_business_date for update;
 if not found or source.id is distinct from p_report_id or source.status<>'closed'
   or p_expected_version is distinct from public.read_bar_closing(p_business_date)->>'version' then
   raise exception 'This report changed. Reload and review it from Reports.' using errcode='40001';
 end if;
 perform public.reopen_daily_report(p_business_date,p_reason);
 -- Keep the original closing notes. The reason remains in the existing audit and this request.
 update public.daily_reports set notes=source.notes where id=source.id returning * into changed;
 result:=jsonb_build_object('request_id',p_request_id,'actor_id',auth.uid(),'report',to_jsonb(changed));
 insert into public.bar_report_reopen_requests(request_id,actor_id,report_id,business_date,payload,result)
 values(p_request_id,auth.uid(),source.id,p_business_date,intent,result);
 return result;
end $$;
revoke all on function public.reopen_daily_report_checked(date,uuid,text,text,uuid,uuid) from public,anon;
grant execute on function public.reopen_daily_report_checked(date,uuid,text,text,uuid,uuid) to authenticated;
revoke all on function public.reopen_daily_report(date,text) from public,anon,authenticated;

create or replace function public.read_platform_schema_version() returns jsonb
language sql stable security definer set search_path=pg_catalog,public,pg_temp as $$
 select jsonb_build_object('schema_version','202610140073','measured_piece_receiving',true,
   'report_reopen_recovery',has_function_privilege('authenticated','public.reopen_daily_report_checked(date,uuid,text,text,uuid,uuid)','execute')
     and not has_function_privilege('authenticated','public.reopen_daily_report(date,text)','execute'),
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
