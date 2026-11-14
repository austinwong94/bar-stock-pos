-- Validate new payments before monetary casts; original committed requests still recover first.
begin;
select pg_advisory_xact_lock(77312,1);
create or replace function public.complete_sale_with_qr_type(
 p_items jsonb,p_payment_method text,p_qr_reference text default null,p_complimentary_reason text default null,
 p_idempotency_key text default null,p_qr_receipt_image_path text default null,p_discount_amount numeric default 0,
 p_order_taken_by text default null,p_qr_payment_type text default null,p_table_number text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare item jsonb; price numeric; config jsonb; raw_price text;begin
 perform public.require_permission('bar.pos.use');
 perform pg_advisory_xact_lock(77312,1);
 if exists(select 1 from public.pos_checkout_requests where request_key=p_idempotency_key)
   or exists(select 1 from public.sales where idempotency_key=p_idempotency_key) then
   return public.complete_sale_with_qr_type_before_review(p_items,p_payment_method,p_qr_reference,p_complimentary_reason,p_idempotency_key,p_qr_receipt_image_path,p_discount_amount,p_order_taken_by,p_qr_payment_type,p_table_number);
 end if;
 if coalesce(p_discount_amount,0)::text in ('NaN','Infinity','-Infinity') or coalesce(p_discount_amount,0)<0
   or coalesce(p_discount_amount,0)>9999999999.99 or coalesce(p_discount_amount,0)<>round(coalesce(p_discount_amount,0),2) then
   raise exception 'Enter a valid discount with no more than 2 decimal places.' using errcode='22023';end if;
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
   else
     perform public.require_permission('bar.pos.custom');
     raw_price:=item->>'custom_price';
     if left(raw_price,1)='.' then raw_price:='0'||raw_price;end if;
     if raw_price is null or length(raw_price)>32 or raw_price!~'^[0-9]{1,8}(\.[0-9]+)?$' then
       raise exception 'Enter a custom price above RM 0, with no more than 2 decimal places.' using errcode='22023';end if;
     if raw_price::numeric<=0 or raw_price::numeric<>round(raw_price::numeric,2) then
       raise exception 'Enter a custom price above RM 0, with no more than 2 decimal places.' using errcode='22023';end if;
   end if;
 end loop;
 return public.complete_sale_with_qr_type_before_review(p_items,p_payment_method,p_qr_reference,p_complimentary_reason,p_idempotency_key,p_qr_receipt_image_path,p_discount_amount,p_order_taken_by,p_qr_payment_type,p_table_number);
end $$;
revoke all on function public.complete_sale_with_qr_type(jsonb,text,text,text,text,text,numeric,text,text,text) from public,anon;
grant execute on function public.complete_sale_with_qr_type(jsonb,text,text,text,text,text,numeric,text,text,text) to authenticated;
-- Older open requests also reach this existing private recovery authority.
do $$declare definition text; anchor text; guard text;begin
 definition:=pg_get_functiondef('public.complete_sale_with_qr_type_before_review(jsonb,text,text,text,text,text,numeric,text,text,text)'::regprocedure);
 if position('-- Strict cents before legacy money casts.' in definition)=0 then
   anchor:='result:=public.complete_sale_with_qr_type_internal(';
   if position(anchor in definition)=0 or position('  current_status text;' in definition)=0 then raise exception 'Payment recovery authority changed. Review the money upgrade before applying.';end if;
   definition:=replace(definition,'  current_status text;',E'  current_status text;\n  money_item jsonb; money_price text;');
   guard:=$guard$-- Strict cents before legacy money casts.
  if coalesce(p_discount_amount,0)::text in ('NaN','Infinity','-Infinity') or coalesce(p_discount_amount,0)<0
    or coalesce(p_discount_amount,0)>9999999999.99 or coalesce(p_discount_amount,0)<>round(coalesce(p_discount_amount,0),2) then
    raise exception 'Enter a valid discount with no more than 2 decimal places.' using errcode='22023';end if;
  for money_item in select value from jsonb_array_elements(p_items) loop
    if not coalesce((money_item->>'bundle')::boolean,false) and nullif(money_item->>'product_id','') is null then
      perform public.require_permission('bar.pos.custom');
      money_price:=money_item->>'custom_price';
      if left(money_price,1)='.' then money_price:='0'||money_price;end if;
      if money_price is null or length(money_price)>32 or money_price!~'^[0-9]{1,8}(\.[0-9]+)?$' then
        raise exception 'Enter a custom price above RM 0, with no more than 2 decimal places.' using errcode='22023';end if;
      if money_price::numeric<=0 or money_price::numeric<>round(money_price::numeric,2) then
        raise exception 'Enter a custom price above RM 0, with no more than 2 decimal places.' using errcode='22023';end if;
    end if;
  end loop;
  $guard$;
   execute replace(definition,anchor,guard||anchor);
 end if;
end $$;
alter function public.complete_sale_with_qr_type_before_review(jsonb,text,text,text,text,text,numeric,text,text,text) set search_path=pg_catalog,public,pg_temp;
revoke all on function public.complete_sale_with_qr_type_before_review(jsonb,text,text,text,text,text,numeric,text,text,text) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
