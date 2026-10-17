-- Receipt expenses, payments and physical arrivals are separate records.
create table public.purchase_payment_accounts (
  receipt_id uuid primary key, version integer not null default 0
);
create table public.purchase_payments (
  id uuid primary key default gen_random_uuid(), receipt_id uuid not null references public.purchase_payment_accounts(receipt_id),
  amount numeric(12,2) not null check(amount>=0), paid_on date not null,
  method text not null check(method in ('unpaid','bank','qr','cash')), reference text not null default '',
  recorded_by uuid not null references auth.users(id), recorded_by_name text not null,
  created_at timestamptz not null default now(), void_reason text, voided_by uuid references auth.users(id), voided_at timestamptz,
  check((amount=0 and method='unpaid') or (amount>0 and method<>'unpaid'))
);
create index purchase_payments_receipt on public.purchase_payments(receipt_id);
alter table public.purchase_payment_accounts enable row level security;
alter table public.purchase_payments enable row level security;
revoke all on public.purchase_payment_accounts,public.purchase_payments from public,anon,authenticated;

create function public.read_purchase_payments(p_receipt_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare total numeric;result jsonb;
begin
  perform public.require_permission('purchasing.cost.view');perform public.require_permission('purchasing.view');
  select total_cost into total from public.expense_receipts where id=p_receipt_id;
  if not found then select total_cost into total from public.purchase_evidence where record_id=p_receipt_id;end if;
  if total is null then raise exception 'Receipt not found.';end if;
  select jsonb_build_object('version',coalesce((select version from public.purchase_payment_accounts where receipt_id=p_receipt_id),0),
    'checked',count(*) filter(where void_reason is null)>0,'paid',coalesce(sum(amount) filter(where void_reason is null),0),
    'total',total,'payments',coalesce(jsonb_agg(to_jsonb(p) order by created_at desc,id),'[]'::jsonb)) into result
  from public.purchase_payments p where receipt_id=p_receipt_id;
  return result;
end $$;

create function public.record_purchase_payment(p_receipt_id uuid,p_amount numeric,p_paid_on date,p_method text,p_reference text,p_expected_version integer,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare prior public.operation_requests%rowtype;v integer;s jsonb;h text;payment public.purchase_payments%rowtype;actor_name text;
begin
  perform public.require_permission('purchasing.cost.view');perform public.require_permission('purchasing.view');
  if not (public.has_permission('purchasing.fulfil') or public.has_permission('purchasing.cost.manage')) then raise exception 'Purchase payment permission required.' using errcode='42501';end if;
  if auth.uid() is null or p_operation_id is null or p_receipt_id is null then raise exception 'Sign in and provide a submission reference.';end if;
  h:=md5(jsonb_build_array(p_receipt_id,p_amount,p_paid_on,p_method,p_reference,p_expected_version)::text);
  perform pg_advisory_xact_lock(73081,1);
  select * into prior from public.operation_requests where actor_id=auth.uid() and operation='purchase_payment' and request_id=p_operation_id;
  if found then
    if prior.payload_hash<>h then raise exception 'This submission already has different details.';end if;
    return public.read_purchase_payments(p_receipt_id);
  end if;
  if exists(select 1 from public.expense_receipts where id=p_receipt_id and status='void') then raise exception 'Cannot pay a voided receipt.';end if;
  s:=public.read_purchase_payments(p_receipt_id);
  if p_expected_version is distinct from (s->>'version')::integer then raise exception 'Payment records changed on another device. Reopen the receipt.' using errcode='40001';end if;
  if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<0 or p_amount>99999999.99 or p_amount<>round(p_amount,2)
    or p_paid_on is null or p_paid_on>(now() at time zone 'Asia/Kuala_Lumpur')::date
    or p_method is null or p_method not in ('unpaid','bank','qr','cash') or length(coalesce(p_reference,''))>200
    or (p_amount=0 and p_method<>'unpaid') or (p_amount>0 and p_method='unpaid') then raise exception 'Check the payment amount, date, method and reference.';end if;
  if p_amount+(s->>'paid')::numeric>(s->>'total')::numeric then raise exception 'Payment exceeds the outstanding amount.';end if;
  if p_method='unpaid' and (s->>'checked')::boolean then raise exception 'Payment status has already been checked.';end if;
  select nullif(trim(full_name),'') into actor_name from public.profiles where id=auth.uid();if actor_name is null then raise exception 'Your profile needs a staff name.';end if;
  insert into public.purchase_payment_accounts(receipt_id) values(p_receipt_id) on conflict do nothing;
  update public.purchase_payment_accounts set version=version+1 where receipt_id=p_receipt_id returning version into v;
  insert into public.purchase_payments(receipt_id,amount,paid_on,method,reference,recorded_by,recorded_by_name)
    values(p_receipt_id,p_amount,p_paid_on,p_method,trim(coalesce(p_reference,'')),auth.uid(),actor_name) returning * into payment;
  insert into public.operation_requests(actor_id,operation,request_id,payload_hash,result_id) values(auth.uid(),'purchase_payment',p_operation_id,h,payment.id);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_json,after_json) values(auth.uid(),'record_purchase_payment','expense_receipt',p_receipt_id,s,to_jsonb(payment));
  return public.read_purchase_payments(p_receipt_id);
end $$;

create function public.void_purchase_payment(p_id uuid,p_reason text,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path=public as $$
declare payment public.purchase_payments%rowtype;s jsonb;
begin
  perform public.require_permission('purchasing.cost.manage');perform public.require_permission('purchasing.cost.view');
  perform pg_advisory_xact_lock(73081,1);
  select * into payment from public.purchase_payments where id=p_id;
  if not found then raise exception 'Payment not found.';end if;
  s:=public.read_purchase_payments(payment.receipt_id);
  if payment.void_reason is not null then return s;end if;
  if p_expected_version is distinct from (s->>'version')::integer then raise exception 'Payment records changed on another device. Reopen the receipt.' using errcode='40001';end if;
  if coalesce(length(trim(p_reason)),0) not between 1 and 500 then raise exception 'Enter a correction reason, up to 500 characters.';end if;
  update public.purchase_payments set void_reason=trim(p_reason),voided_by=auth.uid(),voided_at=now() where id=p_id;
  update public.purchase_payment_accounts set version=version+1 where receipt_id=payment.receipt_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_json,after_json) values(auth.uid(),'void_purchase_payment','expense_receipt',payment.receipt_id,to_jsonb(payment),jsonb_build_object('reason',trim(p_reason)));
  return public.read_purchase_payments(payment.receipt_id);
end $$;

alter function public.read_expense_receipts(date,date) rename to read_expense_receipts_before_payments;
revoke all on function public.read_expense_receipts_before_payments(date,date) from public,anon,authenticated;
create function public.read_expense_receipts(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  return (select coalesce(jsonb_agg(r || jsonb_build_object('payment_checked',(s->>'checked')::boolean,'paid_amount',(s->>'paid')::numeric)),'[]'::jsonb)
    from jsonb_array_elements(public.read_expense_receipts_before_payments(p_from,p_to)) r
    cross join lateral public.read_purchase_payments((r->>'id')::uuid) s);
end $$;

-- Do not hide a paid receipt in expense totals without reversing its payment record.
alter function public.void_expense_receipt(uuid,text) rename to void_expense_receipt_before_payments;
revoke all on function public.void_expense_receipt_before_payments(uuid,text) from public,anon,authenticated;
create function public.void_expense_receipt(p_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
  perform public.require_permission('purchasing.manage');perform public.require_permission('purchasing.cost.view');
  perform pg_advisory_xact_lock(73081,1);
  if (public.read_purchase_payments(p_id)->>'paid')::numeric>0 then raise exception 'Reverse the payment record before voiding this receipt.';end if;
  return public.void_expense_receipt_before_payments(p_id,p_reason);
end $$;

revoke all on function public.read_purchase_payments(uuid),public.record_purchase_payment(uuid,numeric,date,text,text,integer,uuid),public.void_purchase_payment(uuid,text,integer),public.read_expense_receipts(date,date),public.void_expense_receipt(uuid,text) from public,anon;
grant execute on function public.read_purchase_payments(uuid),public.record_purchase_payment(uuid,numeric,date,text,text,integer,uuid),public.void_purchase_payment(uuid,text,integer),public.read_expense_receipts(date,date),public.void_expense_receipt(uuid,text) to authenticated;
