-- Forward-only repair: reviewed prices, complete reads, and one closing authority.
begin;

insert into public.permissions(code,department_code,name,sensitive) values('bar.pos.custom','bar','Record Custom Orders',true) on conflict do nothing;
insert into public.access_role_permissions(role_code,permission_code) values('bar_manager','bar.pos.custom') on conflict do nothing;

alter function public.complete_sale_with_qr_type(jsonb,text,text,text,text,text,numeric,text,text,text) rename to complete_sale_with_qr_type_before_review;
revoke all on function public.complete_sale_with_qr_type_before_review(jsonb,text,text,text,text,text,numeric,text,text,text) from public,anon,authenticated;
create function public.complete_sale_with_qr_type(
 p_items jsonb,p_payment_method text,p_qr_reference text default null,p_complimentary_reason text default null,
 p_idempotency_key text default null,p_qr_receipt_image_path text default null,p_discount_amount numeric default 0,
 p_order_taken_by text default null,p_qr_payment_type text default null,p_table_number text default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare item jsonb; price numeric; bundle_price numeric; bundle_size integer;begin
 perform public.require_permission('bar.pos.use');
 perform pg_advisory_xact_lock(77312,1);
 -- Recovery uses the original stored request even if today's prices/day have changed.
 if exists(select 1 from public.pos_checkout_requests where request_key=p_idempotency_key)
   or exists(select 1 from public.sales where idempotency_key=p_idempotency_key) then
   return public.complete_sale_with_qr_type_before_review(p_items,p_payment_method,p_qr_reference,p_complimentary_reason,p_idempotency_key,p_qr_receipt_image_path,p_discount_amount,p_order_taken_by,p_qr_payment_type,p_table_number);
 end if;
 if exists(select 1 from public.daily_reports where business_date=public.get_business_date() and status='closed') then
   raise exception 'This day is closed. Ask a manager to reopen it before taking another payment.';
 end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'Cart is empty.';end if;
 -- Keep reviewed catalogue/configuration stable through the transaction.
 lock table public.app_settings in share mode;
 perform 1 from public.products where id in (
   select nullif(value->>'product_id','')::uuid from jsonb_array_elements(p_items)
 ) order by id for share;
 bundle_price:=public.setting_text('beer_bundle_price','40')::numeric;
 bundle_size:=greatest(1,public.setting_text('beer_bundle_units_per_set','4')::integer);
 for item in select value from jsonb_array_elements(p_items) loop
   if coalesce((item->>'bundle')::boolean,false) then
     if (item->>'expected_bundle_price')::numeric is distinct from bundle_price
       or (item->>'expected_bundle_units')::integer is distinct from bundle_size then
       raise exception 'Beer bundle price or size changed. Refresh and review the order again.' using errcode='40001';
     end if;
   elsif nullif(item->>'product_id','') is not null then
     select price_per_unit into price from public.products where id=(item->>'product_id')::uuid and active;
     if not found then raise exception 'Product is inactive or missing.';end if;
     if (item->>'expected_unit_price')::numeric is distinct from price then
       raise exception 'A product price changed. Refresh and review the order again.' using errcode='40001';
     end if;
     if exists(select 1 from public.products p join public.categories c on c.id=p.category_id where p.id=(item->>'product_id')::uuid and c.name='Cocktail')
       and not exists(select 1 from public.recipe_ingredients where product_id=(item->>'product_id')::uuid) then
       raise exception 'This cocktail needs a recipe before it can be sold.';end if;
   else
     perform public.require_permission('bar.pos.custom');
   end if;
 end loop;
 return public.complete_sale_with_qr_type_before_review(p_items,p_payment_method,p_qr_reference,p_complimentary_reason,p_idempotency_key,p_qr_receipt_image_path,p_discount_amount,p_order_taken_by,p_qr_payment_type,p_table_number);
end $$;
revoke all on function public.complete_sale_with_qr_type(jsonb,text,text,text,text,text,numeric,text,text,text) from public,anon;
grant execute on function public.complete_sale_with_qr_type(jsonb,text,text,text,text,text,numeric,text,text,text) to authenticated;

-- One SQL snapshot avoids API row caps and mixed generations of financial data.
create function public.bar_sales_snapshot(p_date date default null) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('sale_items',coalesce(lines.rows,'[]')) order by s.created_at,s.id),'[]')
 from public.sales s left join lateral (
   select jsonb_agg(to_jsonb(si)||jsonb_build_object('products',jsonb_build_object('name',p.name)) order by si.id) rows
   from public.sale_items si left join public.products p on p.id=si.product_id where si.sale_id=s.id
 ) lines on true where p_date is null or s.business_date=p_date
$$;
revoke all on function public.bar_sales_snapshot(date) from public,anon,authenticated;

create function public.read_bar_closing(p_business_date date) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare snapshot jsonb;begin
 if not (public.has_permission('bar.closing.manage') or public.has_permission('bar.reports.view')) then
   raise exception 'Bar closing or report access is required.' using errcode='42501';end if;
 if p_business_date is null then raise exception 'Choose a business date.';end if;
 select jsonb_build_object('business_date',p_business_date,'sales',public.bar_sales_snapshot(p_business_date),
   'report',(select to_jsonb(r) from public.daily_reports r where business_date=p_business_date),
   'cash_session',(select to_jsonb(c) from public.cash_sessions c where business_date=p_business_date)) into snapshot;
 return snapshot||jsonb_build_object('version',md5(snapshot::text));
end $$;
revoke all on function public.read_bar_closing(date) from public,anon;
grant execute on function public.read_bar_closing(date) to authenticated;

create function public.read_bar_reporting_source() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare snapshot jsonb;begin
 perform public.require_permission('bar.reports.view');
 select jsonb_build_object(
   'reports',coalesce((select jsonb_agg(to_jsonb(r) order by business_date desc,id) from public.daily_reports r),'[]'),
   'sales',public.bar_sales_snapshot(),
   'movements',coalesce((select jsonb_agg(to_jsonb(m)||jsonb_build_object('products',jsonb_build_object('name',p.name)) order by m.created_at,m.id) from public.stock_movements m left join public.products p on p.id=m.product_id),'[]'),
   'drafts',coalesce((select jsonb_agg(to_jsonb(d) order by created_at,id) from public.stock_in_drafts d),'[]'),
   'products',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('categories',to_jsonb(c),'inventory_balances',jsonb_build_object('quantity_on_hand',coalesce(b.quantity_on_hand,0))) order by p.name,p.id) from public.products p left join public.categories c on c.id=p.category_id left join public.inventory_balances b on b.product_id=p.id),'[]'),
   'cash_sessions',coalesce((select jsonb_agg(to_jsonb(c) order by business_date,id) from public.cash_sessions c),'[]'),
   'archives',coalesce((select jsonb_agg(to_jsonb(a) order by generated_at desc,id) from public.account_report_archives a),'[]')
 ) into snapshot;
 return snapshot;
end $$;
revoke all on function public.read_bar_reporting_source() from public,anon;
grant execute on function public.read_bar_reporting_source() to authenticated;

create table public.bar_closing_requests(
 actor_id uuid not null references public.profiles(id),request_id uuid not null,payload jsonb not null,
 result jsonb not null,created_at timestamptz not null default now(),primary key(actor_id,request_id)
);
alter table public.bar_closing_requests enable row level security;
revoke all on public.bar_closing_requests from public,anon,authenticated;
alter function public.close_daily_report(date,numeric,text) rename to close_daily_report_internal;
revoke all on function public.close_daily_report_internal(date,numeric,text) from public,anon,authenticated;
create function public.close_daily_report_checked(p_business_date date,p_actual_cash_counted numeric,p_notes text,p_expected_version text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare request public.bar_closing_requests%rowtype;intent jsonb;result jsonb;begin
 perform public.require_permission('bar.closing.manage');perform pg_advisory_xact_lock(77312,1);
 if p_request_id is null then raise exception 'A closing reference is required.';end if;
 intent:=jsonb_build_array(p_business_date,p_actual_cash_counted,p_notes,p_expected_version);
 select * into request from public.bar_closing_requests where actor_id=auth.uid() and request_id=p_request_id;
 if found then
   if request.payload is distinct from intent then raise exception 'This closing already has different saved details. Check the original closing.' using errcode='LP001';end if;
   return request.result;
 end if;
 if p_business_date is null or p_business_date>public.get_business_date() then raise exception 'Choose today or a past closing date.';end if;
 if p_actual_cash_counted is null or p_actual_cash_counted::text in ('NaN','Infinity','-Infinity') or p_actual_cash_counted<0 or p_actual_cash_counted<>round(p_actual_cash_counted,2) then raise exception 'Enter a valid cash amount with up to two decimal places.';end if;
 if p_expected_version is distinct from public.read_bar_closing(p_business_date)->>'version' then
   raise exception 'This day changed after review. Reload and check the closing again.' using errcode='40001';end if;
 result:=public.close_daily_report_internal(p_business_date,p_actual_cash_counted,p_notes);
 insert into public.bar_closing_requests(actor_id,request_id,payload,result) values(auth.uid(),p_request_id,intent,result);
 return result;
end $$;
revoke all on function public.close_daily_report_checked(date,numeric,text,text,uuid) from public,anon;
grant execute on function public.close_daily_report_checked(date,numeric,text,text,uuid) to authenticated;

-- All changes to a day's sales share the same lock and respect a closed day.
alter function public.void_sale(uuid,text) rename to void_sale_internal;
revoke all on function public.void_sale_internal(uuid,text) from public,anon,authenticated;
create function public.void_sale(p_sale_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$begin
 perform public.require_permission('bar.pos.void');perform pg_advisory_xact_lock(77312,1);
 if exists(select 1 from public.sales s join public.daily_reports r on r.business_date=s.business_date where s.id=p_sale_id and s.status<>'voided' and r.status='closed') then
   raise exception 'This day is closed. Reopen it before voiding a sale.';end if;
 return public.void_sale_internal(p_sale_id,p_reason);
end $$;
revoke all on function public.void_sale(uuid,text) from public,anon;
grant execute on function public.void_sale(uuid,text) to authenticated;
alter function public.verify_qr_payment(uuid,text,text) rename to verify_qr_payment_internal;
revoke all on function public.verify_qr_payment_internal(uuid,text,text) from public,anon,authenticated;
create function public.verify_qr_payment(p_sale_id uuid,p_status text,p_notes text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$begin
 perform public.require_permission('bar.closing.manage');perform pg_advisory_xact_lock(77312,1);
 if exists(select 1 from public.sales s join public.daily_reports r on r.business_date=s.business_date where s.id=p_sale_id and r.status='closed') then raise exception 'This day is closed. Reopen it before changing QR verification.';end if;
 return public.verify_qr_payment_internal(p_sale_id,p_status,p_notes);
end $$;
revoke all on function public.verify_qr_payment(uuid,text,text) from public,anon;
grant execute on function public.verify_qr_payment(uuid,text,text) to authenticated;

-- Meal usage must enter the current daily journal consumed by finance.
revoke all on function public.record_kitchen_usage_checked(jsonb,date,text,text,integer,text,uuid) from public,anon,authenticated;
revoke all on function public.submit_kitchen_production_checked(date,text,numeric,text,jsonb,text,text,uuid) from public,anon,authenticated;
revoke all on function public.save_expense_receipt(jsonb,uuid) from public,anon,authenticated;

create table public.bar_stock_draft_requests(
 actor_id uuid not null references public.profiles(id),request_id uuid not null,payload jsonb not null,
 draft_id uuid not null references public.stock_in_drafts(id),created_at timestamptz not null default now(),primary key(actor_id,request_id)
);
alter table public.bar_stock_draft_requests enable row level security;
revoke all on public.bar_stock_draft_requests from public,anon,authenticated;
alter function public.create_stock_in_draft(jsonb,text,text,text,text) rename to create_stock_in_draft_internal;
revoke all on function public.create_stock_in_draft_internal(jsonb,text,text,text,text) from public,anon,authenticated;
create function public.create_stock_in_draft_checked(p_entries jsonb,p_entered_by text,p_supplier text,p_reference text,p_notes text,p_request_id uuid)
returns public.stock_in_drafts language plpgsql security definer set search_path=public,pg_temp as $$
declare request public.bar_stock_draft_requests%rowtype;intent jsonb;draft public.stock_in_drafts%rowtype;begin
 perform public.require_permission('bar.stock.manage');
 if p_request_id is null then raise exception 'A stock-in submission reference is required.';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':stock-draft:'||p_request_id::text,0));
 intent:=jsonb_build_array(p_entries,p_entered_by,p_supplier,p_reference,p_notes);
 select * into request from public.bar_stock_draft_requests where actor_id=auth.uid() and request_id=p_request_id;
 if found then
   if request.payload is distinct from intent then raise exception 'This stock-in draft has different saved details. Check the original draft.' using errcode='LP001';end if;
   select * into draft from public.stock_in_drafts where id=request.draft_id;return draft;
 end if;
 draft:=public.create_stock_in_draft_internal(p_entries,p_entered_by,p_supplier,p_reference,p_notes);
 insert into public.bar_stock_draft_requests(actor_id,request_id,payload,draft_id) values(auth.uid(),p_request_id,intent,draft.id);
 return draft;
end $$;
revoke all on function public.create_stock_in_draft_checked(jsonb,text,text,text,text,uuid) from public,anon;
grant execute on function public.create_stock_in_draft_checked(jsonb,text,text,text,text,uuid) to authenticated;
alter function public.confirm_stock_in_draft(uuid) rename to confirm_stock_in_draft_internal;
revoke all on function public.confirm_stock_in_draft_internal(uuid) from public,anon,authenticated;
create function public.confirm_stock_in_draft(p_draft_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare draft public.stock_in_drafts%rowtype;begin
 perform public.require_permission('bar.stock.manage');perform pg_advisory_xact_lock(77312,1);
 select * into draft from public.stock_in_drafts where id=p_draft_id for update;
 if not found then raise exception 'Stock In draft not found.';end if;
 if draft.status='confirmed' then return jsonb_build_object('draft',to_jsonb(draft),'results','[]'::jsonb);end if;
 return public.confirm_stock_in_draft_internal(p_draft_id);
end $$;
revoke all on function public.confirm_stock_in_draft(uuid) from public,anon;
grant execute on function public.confirm_stock_in_draft(uuid) to authenticated;
revoke all on function public.stock_in_product(uuid,integer,text,numeric,text,text,text,text),public.stock_in_products(jsonb) from public,anon,authenticated;

-- Preserve older preparation rows while including the current daily meal journal.
alter function public.account_report_archive_kitchen_sections(date,date) rename to account_report_archive_kitchen_sections_legacy;
revoke all on function public.account_report_archive_kitchen_sections_legacy(date,date) from public,anon,authenticated;
create function public.account_report_archive_kitchen_sections(p_period_start date,p_period_end date) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare legacy jsonb;meals jsonb;summary jsonb;begin
 legacy:=public.account_report_archive_kitchen_sections_legacy(p_period_start,p_period_end);
 select coalesce(jsonb_agg(jsonb_build_object('business_date',d.business_date,'time',d.updated_at,
   'platter',case when kind='guest_quantity' then 'Guest Meals' else 'Staff Meals' end,'serving_basis','meals',
   'prepared_count',case when kind='guest_quantity' then d.guest_meals else d.staff_meals end,
   'submitted_by',d.created_by_name,'ingredients_deducted',coalesce((select string_agg((l->>'name')||' '||(l->>kind)||' '||(l->>'unit'),', ' order by l->>'name') from jsonb_array_elements(d.lines) l where (l->>kind)::numeric>0),''),
   'notes',d.notes) order by d.business_date,kind),'[]') into meals
 from public.kitchen_daily_usage d cross join unnest(array['guest_quantity','staff_quantity']) kind
 where d.business_date between p_period_start and p_period_end and (case when kind='guest_quantity' then d.guest_meals else d.staff_meals end)>0;
 select jsonb_build_object('kitchen_guest_meals',coalesce(sum(guest_meals),0),'kitchen_staff_meals',coalesce(sum(staff_meals),0)) into summary from public.kitchen_daily_usage where business_date between p_period_start and p_period_end;
 return legacy||jsonb_build_object('kitchen_production',coalesce(legacy->'kitchen_production','[]')||meals,
   'summary',coalesce(legacy->'summary','{}')||summary);
end $$;
revoke all on function public.account_report_archive_kitchen_sections(date,date) from public,anon,authenticated;

-- Public deployment probe exposes configuration booleans only, never records or secrets.
create function public.read_platform_schema_version() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('schema_version','202610140072',
   'private_payment_receipts',coalesce((select not public from storage.buckets where id='payment-receipts'),false),
   'private_purchase_evidence',coalesce((select not public from storage.buckets where id='purchase-evidence'),false),
   'retired_writes_private',not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
     and p.proname in ('complete_sale','create_stock_in_draft','close_daily_report','save_expense_receipt','submit_kitchen_production','record_kitchen_usage_checked')
     and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))))
$$;
revoke all on function public.read_platform_schema_version() from public;
grant execute on function public.read_platform_schema_version() to anon,authenticated;
commit;
