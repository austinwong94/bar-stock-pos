-- Financial records never live on the operational booking row.
create table public.referral_parties(
 id uuid primary key default gen_random_uuid(),name text not null check(length(trim(name))>0),
 method text check(method in ('percent','fixed','per_pax')),rate numeric(14,2) check(rate>=0),
 is_default boolean not null default false,active boolean not null default true,
 updated_at timestamptz not null default now(),updated_by uuid references public.profiles(id),
 check((method is null)=(rate is null)),check(method<>'percent' or rate<=100)
);
create unique index referral_party_name on public.referral_parties(lower(name));
create unique index referral_general_rate on public.referral_parties(is_default) where is_default;
insert into public.referral_parties(name,is_default) values('General Commission',true);
create table public.booking_accounts(
 booking_id uuid primary key references public.bookings(id) on delete restrict,
 amount_due numeric(14,2) check(amount_due>=0),invoice_number text not null default '',remarks text not null default '',
 referrer_id uuid references public.referral_parties(id),commission_method text check(commission_method in ('percent','fixed','per_pax')),
 commission_rate numeric(14,2) check(commission_rate>=0),commission_pax int not null default 0 check(commission_pax>=0),
 commission_base numeric(14,2) check(commission_base>=0),commission_paid numeric(14,2) not null default 0 check(commission_paid>=0),
 updated_at timestamptz not null default now(),updated_by uuid references public.profiles(id),
 check((commission_method is null)=(commission_rate is null)),check(commission_method<>'percent' or commission_rate<=100)
);
create table public.booking_payments(
 id uuid primary key default gen_random_uuid(),booking_id uuid not null references public.bookings(id) on delete restrict,
 payment_date date not null,amount numeric(14,2) not null check(amount>0),kind text not null check(kind in ('receipt','refund')),
 reference text not null default '',note text not null default '',recorded_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 voided_at timestamptz,voided_by uuid references public.profiles(id),void_reason text
);
do $$ declare t text; begin
 foreach t in array array['referral_parties','booking_accounts','booking_payments'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 end loop;
end $$;

create function public.read_booking_accounts(p_date date) returns jsonb language plpgsql security definer set search_path=public as $$
begin
 perform public.require_permission('guests.finance.manage');
 return jsonb_build_object('accounts',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('updated_by_name',p.full_name)) from public.booking_accounts a join public.bookings b on b.id=a.booking_id left join public.profiles p on p.id=a.updated_by where b.service_date=p_date),'[]'::jsonb),
 'payments',coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('recorded_by_name',p.full_name) order by x.payment_date,x.created_at) from public.booking_payments x join public.bookings b on b.id=x.booking_id left join public.profiles p on p.id=x.recorded_by where b.service_date=p_date),'[]'::jsonb),
 'referrers',coalesce((select jsonb_agg(to_jsonb(r) order by r.is_default desc,r.name) from public.referral_parties r),'[]'::jsonb));
end $$;

create function public.save_booking_finance(p_action text,p_booking_id uuid,p_expected_updated_at timestamptz,p_values jsonb,p_request_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare prior public.operation_requests%rowtype; fingerprint text; result uuid; a public.booking_accounts%rowtype; party public.referral_parties%rowtype;
paid numeric; amount numeric; calculated numeric; old_payment public.booking_payments%rowtype; original_account jsonb; numeric_key text; numeric_value numeric;
begin
 perform public.require_permission('guests.finance.manage');
 perform pg_advisory_xact_lock(73081,1);
 foreach numeric_key in array array['amount_due','amount','rate','base'] loop
  if nullif(p_values->>numeric_key,'') is not null then
   numeric_value:=(p_values->>numeric_key)::numeric;
   if numeric_value::text in ('NaN','Infinity','-Infinity') or numeric_value<0 or round(numeric_value,2)<>numeric_value then raise exception 'Enter finite, non-negative RM amounts with at most two decimals.';end if;
  end if;
 end loop;
 if p_request_id is null or not exists(select 1 from public.bookings where id=p_booking_id) then raise exception 'Booking and save reference are required.'; end if;
 fingerprint:=md5(jsonb_build_array(p_action,p_booking_id,p_expected_updated_at,p_values)::text);
 select * into prior from public.operation_requests where actor_id=auth.uid() and operation='booking_finance' and request_id=p_request_id;
 if found then if prior.payload_hash<>fingerprint then raise exception 'This saved request has different details.'; end if; return prior.result_id; end if;
 select * into a from public.booking_accounts where booking_id=p_booking_id for update;
 original_account:=to_jsonb(a);
 if (found and a.updated_at is distinct from p_expected_updated_at) or (not found and p_expected_updated_at is not null) then raise exception 'The account changed on another device. Reload before saving.' using errcode='40001'; end if;
 select coalesce(sum(case when p.kind='receipt' then p.amount else -p.amount end),0) into paid from public.booking_payments p where p.booking_id=p_booking_id and p.voided_at is null;
 if p_action='account' then
  if nullif(p_values->>'amount_due','') is null then raise exception 'Enter the agreed booking total.'; end if;
  if (p_values->>'amount_due')::numeric<0 then raise exception 'Booking total cannot be negative.'; end if;
  result:=p_booking_id;
  insert into public.booking_accounts(booking_id) values(p_booking_id) on conflict do nothing;
  update public.booking_accounts set amount_due=(p_values->>'amount_due')::numeric,invoice_number=coalesce(p_values->>'invoice_number',''),remarks=coalesce(p_values->>'remarks','') where booking_id=p_booking_id;
 elsif p_action='commission' then
  if a.booking_id is null then raise exception 'Save the booking total first.'; end if;
  if nullif(p_values->>'referrer_id','') is not null then
   select * into party from public.referral_parties where id=(p_values->>'referrer_id')::uuid and active and not is_default;
   if not found then raise exception 'Choose an active referrer.'; end if;
  end if;
  if p_values->>'use_party_terms'='true' and party.id is not null then
   if party.method is null then select method,rate into party.method,party.rate from public.referral_parties where is_default; end if;
   p_values:=p_values||jsonb_build_object('method',party.method,'rate',party.rate);
  end if;
  if party.id is not null and nullif(p_values->>'method','') is null then raise exception 'Set the general or referrer commission terms first.'; end if;
  update public.booking_accounts set referrer_id=party.id,commission_method=case when party.id is null then null else p_values->>'method' end,
   commission_rate=case when party.id is null then null else (p_values->>'rate')::numeric end,
   commission_pax=coalesce((p_values->>'pax')::int,0),commission_base=nullif(p_values->>'base','')::numeric where booking_id=p_booking_id;
  select * into a from public.booking_accounts where booking_id=p_booking_id;
  if a.commission_method='percent' and a.commission_base is null then raise exception 'Enter the commission base amount.'; end if;
  if a.commission_method='per_pax' and a.commission_pax<1 then raise exception 'Enter the number of commissionable passengers.'; end if;
  calculated:=case a.commission_method when 'fixed' then a.commission_rate when 'per_pax' then a.commission_rate*a.commission_pax when 'percent' then round(a.commission_base*a.commission_rate/100,2) else 0 end;
  if calculated<a.commission_paid then raise exception 'Commission already paid exceeds these terms. Reconcile before changing them.'; end if;
  result:=p_booking_id;
 elsif p_action='commission_paid' then
  if a.commission_method is null then raise exception 'Set commission terms first.'; end if;
  amount:=(p_values->>'amount')::numeric;
  calculated:=case a.commission_method when 'fixed' then a.commission_rate when 'per_pax' then a.commission_rate*a.commission_pax when 'percent' then round(a.commission_base*a.commission_rate/100,2) end;
  if amount is null or amount<=0 or a.commission_paid+amount>calculated then raise exception 'Enter an amount within the outstanding commission.'; end if;
  update public.booking_accounts set commission_paid=commission_paid+amount where booking_id=p_booking_id;
  result:=p_booking_id;
 elsif p_action='payment' then
  amount:=(p_values->>'amount')::numeric;
  if amount is null or amount<=0 or round(amount,2)<>amount then raise exception 'Enter a positive RM amount with at most two decimals.'; end if;
  if nullif(p_values->>'payment_date','') is null or (p_values->>'payment_date')::date>(now() at time zone 'Asia/Kuala_Lumpur')::date then raise exception 'Choose the actual payment date, not a future date.'; end if;
  if p_values->>'kind'='refund' and amount>paid then raise exception 'A refund cannot exceed the receipts remaining.'; end if;
  insert into public.booking_accounts(booking_id) values(p_booking_id) on conflict do nothing;
  insert into public.booking_payments(booking_id,payment_date,amount,kind,reference,note,recorded_by) values(p_booking_id,(p_values->>'payment_date')::date,amount,p_values->>'kind',coalesce(p_values->>'reference',''),coalesce(p_values->>'note',''),auth.uid()) returning id into result;
 elsif p_action='void_payment' then
  select * into old_payment from public.booking_payments where id=(p_values->>'id')::uuid and booking_id=p_booking_id and voided_at is null for update;
  if not found or length(trim(coalesce(p_values->>'reason','')))<3 then raise exception 'Choose an active payment and explain the correction.'; end if;
  if old_payment.kind='receipt' and paid-old_payment.amount<0 then raise exception 'This receipt has been refunded. Reconcile its refund before voiding it.'; end if;
  update public.booking_payments set voided_at=now(),voided_by=auth.uid(),void_reason=trim(p_values->>'reason') where id=old_payment.id;
  result:=old_payment.id;
 else raise exception 'Unknown accounting action.'; end if;
 update public.booking_accounts set updated_at=clock_timestamp(),updated_by=auth.uid() where booking_id=p_booking_id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_json,after_json) values(auth.uid(),'booking_finance_'||p_action,'booking_account',p_booking_id,original_account,p_values||jsonb_build_object('result_id',result));
 insert into public.operation_requests(actor_id,operation,request_id,payload_hash,result_id) values(auth.uid(),'booking_finance',p_request_id,fingerprint,result);
 return result;
end $$;

create function public.save_referral_party(p_id uuid,p_expected_updated_at timestamptz,p_name text,p_method text,p_rate numeric,p_request_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare r public.referral_parties%rowtype; fingerprint text; previous public.operation_requests%rowtype; result uuid;
begin
 perform public.require_permission('guests.finance.manage'); perform pg_advisory_xact_lock(73081,1);
 if p_rate is not null and (p_rate::text in ('NaN','Infinity','-Infinity') or round(p_rate,2)<>p_rate) then raise exception 'Enter a finite rate with at most two decimals.';end if;
 fingerprint:=md5(jsonb_build_array(p_id,p_expected_updated_at,p_name,p_method,p_rate)::text);
 if p_request_id is null then raise exception 'Save reference is required.'; end if;
 select * into previous from public.operation_requests where actor_id=auth.uid() and operation='referral_party' and request_id=p_request_id;
 if found then if previous.payload_hash<>fingerprint then raise exception 'Save reference changed.'; end if; return previous.result_id; end if;
 if p_id is not null then
 select * into r from public.referral_parties where id=p_id for update;
 if not found or r.updated_at is distinct from p_expected_updated_at then raise exception 'Referrer changed. Reload before saving.' using errcode='40001'; end if;
 update public.referral_parties set name=case when is_default then name else trim(p_name) end,method=nullif(p_method,''),rate=p_rate,updated_at=clock_timestamp(),updated_by=auth.uid() where id=p_id returning id into result;
 else insert into public.referral_parties(name,method,rate,updated_by) values(trim(p_name),nullif(p_method,''),p_rate,auth.uid()) returning id into result; end if;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_json,after_json) values(auth.uid(),'referral_terms','referral_party',result,to_jsonb(r),jsonb_build_object('name',p_name,'method',p_method,'rate',p_rate));
 insert into public.operation_requests(actor_id,operation,request_id,payload_hash,result_id) values(auth.uid(),'referral_party',p_request_id,fingerprint,result);
 return result;
end $$;

create function public.read_booking_change_log(p_booking_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare d date; restricted boolean;
begin
 select service_date into d from public.bookings where id=p_booking_id;
 perform public.check_sheet_date(d); restricted:=public.is_external_planner();
 return coalesce((select jsonb_agg(row order by row.created_at desc) from (
 select a.created_at,p.full_name as actor,a.action,
 case when restricted then null else a.after_json end as details
 from public.audit_logs a left join public.profiles p on p.id=a.actor_id where a.entity_id=p_booking_id
 and (not restricted or a.action='departure_assignment')
 and (public.has_permission('guests.finance.manage') or a.action not like 'booking_finance_%')
 order by a.created_at desc limit 100) row),'[]');
end $$;
do $$ declare r record; begin
 for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in ('read_booking_accounts','save_booking_finance','save_referral_party','read_booking_change_log') loop
 execute format('revoke all on function %s from public,anon',r.signature); execute format('grant execute on function %s to authenticated',r.signature); end loop;
end $$;
