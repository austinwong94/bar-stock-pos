-- No business values are seeded or replaced by this migration.
begin;
create or replace function public.validate_beer_bundle(p_config jsonb) returns jsonb
language plpgsql immutable set search_path=pg_catalog,public,pg_temp as $$
declare units text:=p_config->>'beer_bundle_units_per_set'; price text:=p_config->>'beer_bundle_price'; name text:=trim(p_config->>'beer_bundle_name'); enabled text:=p_config->>'beer_bundle_enabled';begin
 if jsonb_typeof(p_config) is distinct from 'object' or enabled is null or enabled not in ('true','false')
   or jsonb_typeof(p_config->'beer_bundle_name') is distinct from 'string' or coalesce(name,'')='' then
   raise exception 'Enter a bundle name and select its status.' using errcode='22023';end if;
 if units is null or units!~'^[0-9]{1,10}$' then raise exception 'Enter a whole number of beers per set.' using errcode='22023';end if;
 if units::numeric<1 or units::numeric>2147483647 then raise exception 'Enter a whole number of beers per set.' using errcode='22023';end if;
 if price is null or price!~'^[0-9]{1,8}(\.[0-9]{1,2})?$' then raise exception 'Enter a bundle price above RM 0, with no more than 2 decimal places.' using errcode='22023';end if;
 if price::numeric<=0 then raise exception 'Enter a bundle price above RM 0, with no more than 2 decimal places.' using errcode='22023';end if;
 return jsonb_build_object('beer_bundle_enabled',enabled::boolean,'beer_bundle_name',name,'beer_bundle_units_per_set',units::integer,'beer_bundle_price',price::numeric);
end $$;
revoke all on function public.validate_beer_bundle(jsonb) from public,anon,authenticated;

create table if not exists public.settings_save_requests(
 request_id uuid primary key,actor_id uuid not null references public.profiles(id),intent jsonb not null,result jsonb not null,created_at timestamptz not null default now()
);
alter table public.settings_save_requests enable row level security;
revoke all on public.settings_save_requests from public,anon,authenticated;
grant all on public.settings_save_requests to service_role;
do $$begin
 if to_regprocedure('public.save_app_settings_checked_before_recovery(jsonb,jsonb)') is null then
   alter function public.save_app_settings_checked(jsonb,jsonb) rename to save_app_settings_checked_before_recovery;
 end if;
end $$;
revoke all on function public.save_app_settings_checked_before_recovery(jsonb,jsonb) from public,anon,authenticated;
create or replace function public.save_app_settings_checked(p_rows jsonb,p_versions jsonb default '{}',p_request_id uuid default null,p_expected_actor_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare previous public.settings_save_requests%rowtype; intent jsonb:=jsonb_build_array(p_rows,p_versions); result jsonb; row_item jsonb; current_stamp timestamptz; source_stamp text; config jsonb;begin
 perform public.require_permission('bar.settings.manage');
 perform pg_advisory_xact_lock(77312,1);
 if p_request_id is not null then
   if p_expected_actor_id is distinct from auth.uid() then raise exception 'Account changed. Sign in with the original account.' using errcode='42501';end if;
   select * into previous from public.settings_save_requests where request_id=p_request_id;
   if found then
     if previous.actor_id is distinct from auth.uid() or previous.intent is distinct from intent then raise exception 'This save belongs to different original details or another account.' using errcode='LP001';end if;
     return previous.result;
   end if;
 end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_typeof(p_versions) is distinct from 'object' then raise exception 'Settings and reviewed versions are required.' using errcode='22023';end if;
 if jsonb_array_length(p_rows)<1 or jsonb_array_length(p_rows)>1000 then raise exception 'Choose settings to save.' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p_rows) r where jsonb_typeof(r) is distinct from 'object' or jsonb_typeof(r->'key') is distinct from 'string' or trim(r->>'key')='' or not (r ? 'value') or r->'value'='null'::jsonb)
   or (select count(distinct r->>'key') from jsonb_array_elements(p_rows) r)<>jsonb_array_length(p_rows) then raise exception 'Settings contain missing or repeated details.' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p_rows) r where r->>'key' in ('beer_bundle_enabled','beer_bundle_name','beer_bundle_units_per_set','beer_bundle_price')) then
   select jsonb_object_agg(r->>'key',r->'value') into config from jsonb_array_elements(p_rows) r where r->>'key' in ('beer_bundle_enabled','beer_bundle_name','beer_bundle_units_per_set','beer_bundle_price');
   perform public.validate_beer_bundle(config);
 end if;
 for row_item in select value from jsonb_array_elements(p_rows) order by value->>'key' loop
   select updated_at into current_stamp from public.app_settings where key=row_item->>'key' for update;
   source_stamp:=p_versions->>(row_item->>'key');
   if (found and (nullif(source_stamp,'') is null or current_stamp is distinct from source_stamp::timestamptz))
     or (not found and source_stamp is not null) then raise exception 'Settings changed on another device. Load the latest values before saving.' using errcode='40001';end if;
 end loop;
 result:=public.save_app_settings_checked_before_recovery(p_rows,p_versions);
 if p_request_id is not null then insert into public.settings_save_requests(request_id,actor_id,intent,result) values(p_request_id,auth.uid(),intent,result);end if;
 return result;
end $$;
revoke all on function public.save_app_settings_checked(jsonb,jsonb,uuid,uuid) from public,anon;
grant execute on function public.save_app_settings_checked(jsonb,jsonb,uuid,uuid) to authenticated;
-- Only the checked server authority may change bundle fields from the browser.
-- Other, unrelated platform-setting fields retain their existing access rules.
create or replace function public.protect_bundle_settings() returns trigger
language plpgsql set search_path=pg_catalog,public,pg_temp as $$
begin
 if current_user in ('anon','authenticated') and (
   (tg_op<>'INSERT' and old.key in ('beer_bundle_enabled','beer_bundle_name','beer_bundle_units_per_set','beer_bundle_price')) or
   (tg_op<>'DELETE' and new.key in ('beer_bundle_enabled','beer_bundle_name','beer_bundle_units_per_set','beer_bundle_price'))
 ) then raise exception 'Save bundle settings through the checked Admin form.' using errcode='42501';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function public.protect_bundle_settings() from public,anon,authenticated;
drop trigger if exists checked_bundle_settings on public.app_settings;
create trigger checked_bundle_settings before insert or update or delete on public.app_settings for each row execute function public.protect_bundle_settings();

-- The private sale engine must not parse unrelated bundle settings for a single drink.
-- Guard exact source snippets before rewriting; replay sees the already repaired engine.
do $$declare definition text; old_declarations text; new_declarations text; old_branch text; new_branch text;begin
 definition:=pg_get_functiondef('public.complete_sale(jsonb,text,text,text,text,text,numeric,text,text)'::regprocedure);
 old_declarations:=$old$  bundle_enabled boolean := public.setting_bool('beer_bundle_enabled', true);
  bundle_name text := public.setting_text('beer_bundle_name', 'Beer Bundle');
  bundle_units_per_set int := greatest(1, public.setting_text('beer_bundle_units_per_set', '4')::int);
  bundle_price numeric(12,2) := public.setting_text('beer_bundle_price', '40')::numeric(12,2);$old$;
 new_declarations:=$new$  bundle_config jsonb;
  bundle_enabled boolean;
  bundle_name text;
  bundle_units_per_set int;
  bundle_price numeric(12,2);$new$;
 old_branch:=$old$    if coalesce((raw_item->>'bundle')::boolean, false) then
      if not bundle_enabled then$old$;
 new_branch:=$new$    if coalesce((raw_item->>'bundle')::boolean, false) then
      select jsonb_object_agg(key,value) into bundle_config from public.app_settings where key in ('beer_bundle_enabled','beer_bundle_name','beer_bundle_units_per_set','beer_bundle_price');
      bundle_config:=public.validate_beer_bundle(bundle_config);
      bundle_enabled:=(bundle_config->>'beer_bundle_enabled')::boolean;
      bundle_name:=bundle_config->>'beer_bundle_name';
      bundle_units_per_set:=(bundle_config->>'beer_bundle_units_per_set')::integer;
      bundle_price:=(bundle_config->>'beer_bundle_price')::numeric;
      if not bundle_enabled then$new$;
 if position(old_declarations in definition)>0 and position(old_branch in definition)>0 then
   execute replace(replace(definition,old_declarations,new_declarations),old_branch,new_branch);
 elsif position(new_declarations in definition)=0 or position(new_branch in definition)=0 then raise exception 'Sale engine changed. Review bundle repair before applying.';end if;
end $$;
revoke all on function public.complete_sale(jsonb,text,text,text,text,text,numeric,text,text) from public,anon,authenticated;

create or replace function public.complete_sale_with_qr_type(
 p_items jsonb,p_payment_method text,p_qr_reference text default null,p_complimentary_reason text default null,
 p_idempotency_key text default null,p_qr_receipt_image_path text default null,p_discount_amount numeric default 0,
 p_order_taken_by text default null,p_qr_payment_type text default null,p_table_number text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare item jsonb; price numeric; config jsonb;begin
 perform public.require_permission('bar.pos.use');
 perform pg_advisory_xact_lock(77312,1);
 if exists(select 1 from public.pos_checkout_requests where request_key=p_idempotency_key)
   or exists(select 1 from public.sales where idempotency_key=p_idempotency_key) then
   return public.complete_sale_with_qr_type_before_review(p_items,p_payment_method,p_qr_reference,p_complimentary_reason,p_idempotency_key,p_qr_receipt_image_path,p_discount_amount,p_order_taken_by,p_qr_payment_type,p_table_number);
 end if;
 if exists(select 1 from public.daily_reports where business_date=public.get_business_date() and status='closed') then raise exception 'This day is closed. Ask a manager to reopen it before taking another payment.';end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'Cart is empty.';end if;
 lock table public.app_settings in share mode;
 perform 1 from public.products where id in (select nullif(value->>'product_id','')::uuid from jsonb_array_elements(p_items)) order by id for share;
 for item in select value from jsonb_array_elements(p_items) loop
   if coalesce((item->>'bundle')::boolean,false) then
     begin
       select jsonb_object_agg(key,value) into config from public.app_settings where key in ('beer_bundle_enabled','beer_bundle_name','beer_bundle_units_per_set','beer_bundle_price');
       config:=public.validate_beer_bundle(config);
     exception when sqlstate '22023' then raise exception 'Beer bundle settings are incomplete. Ask a manager to check them.' using errcode='40001';end;
     if not (config->>'beer_bundle_enabled')::boolean then raise exception 'Beer bundles are disabled. Refresh and review the order.' using errcode='40001';end if;
     if (item->>'expected_bundle_price')::numeric is distinct from (config->>'beer_bundle_price')::numeric
       or (item->>'expected_bundle_units')::numeric is distinct from (config->>'beer_bundle_units_per_set')::integer then raise exception 'Beer bundle price or size changed. Refresh and review the order again.' using errcode='40001';end if;
   elsif nullif(item->>'product_id','') is not null then
     select price_per_unit into price from public.products where id=(item->>'product_id')::uuid and active;
     if not found then raise exception 'Product is inactive or missing.';end if;
     if (item->>'expected_unit_price')::numeric is distinct from price then raise exception 'A product price changed. Refresh and review the order again.' using errcode='40001';end if;
     if exists(select 1 from public.products p join public.categories c on c.id=p.category_id where p.id=(item->>'product_id')::uuid and c.name='Cocktail') and not exists(select 1 from public.recipe_ingredients where product_id=(item->>'product_id')::uuid) then raise exception 'This cocktail needs a recipe before it can be sold.';end if;
   else perform public.require_permission('bar.pos.custom');end if;
 end loop;
 return public.complete_sale_with_qr_type_before_review(p_items,p_payment_method,p_qr_reference,p_complimentary_reason,p_idempotency_key,p_qr_receipt_image_path,p_discount_amount,p_order_taken_by,p_qr_payment_type,p_table_number);
end $$;
revoke all on function public.complete_sale_with_qr_type(jsonb,text,text,text,text,text,numeric,text,text,text) from public,anon;
grant execute on function public.complete_sale_with_qr_type(jsonb,text,text,text,text,text,numeric,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
