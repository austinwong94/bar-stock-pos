-- Validate raw values before numeric casts can round them or fill guessed defaults.
create or replace function public.save_product_checked(
  p_product_id uuid,
  p_payload jsonb,
  p_source_updated_at timestamptz default null
)
returns public.products
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  existing_product public.products%rowtype;
  saved_product public.products%rowtype;
  v_name text;
  v_category_id uuid;
  v_price numeric(12,2);
  v_cost numeric(12,2);
  v_carton_size int;
  v_low_stock_threshold int;
  v_image_url text;
  v_active boolean;
  raw_price text;
  raw_cost text;
  raw_carton text;
  raw_threshold text;
begin
  if auth.uid() is null or not public.has_permission('bar.products.manage') then
    raise exception using errcode = '42501', message = 'Product management access required.';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Product payload is required.';
  end if;
  v_name := btrim(coalesce(p_payload ->> 'name', ''));
  if jsonb_typeof(p_payload -> 'name') is distinct from 'string' or v_name = '' then
    raise exception 'Enter a product name.';
  end if;
  if coalesce(p_payload ->> 'category_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Choose a valid product category.';
  end if;
  v_category_id := (p_payload ->> 'category_id')::uuid;
  if not exists (select 1 from public.categories where id = v_category_id) then
    raise exception 'Choose a valid product category.';
  end if;

  raw_price := btrim(coalesce(p_payload ->> 'price_per_unit', ''));
  raw_cost := btrim(coalesce(p_payload ->> 'cost_per_unit', ''));
  raw_carton := btrim(coalesce(p_payload ->> 'carton_size', ''));
  raw_threshold := coalesce(nullif(btrim(p_payload ->> 'low_stock_threshold'), ''), '0');
  if raw_price !~ '^[0-9]{1,8}(\.[0-9]{1,2})?$' then
    raise exception 'Enter the selling price in RM, with no more than 2 decimal places.';
  end if;
  if raw_cost <> '' and raw_cost !~ '^[0-9]{1,8}(\.[0-9]{1,2})?$' then
    raise exception 'Enter a valid cost in RM, with no more than 2 decimal places.';
  end if;
  if raw_carton !~ '^[0-9]{1,10}$' then
    raise exception 'Enter a whole number of units per carton, or choose No Carton.';
  end if;
  if raw_carton::numeric < 1 or raw_carton::numeric > 2147483647 then
    raise exception 'Enter a whole number of units per carton, or choose No Carton.';
  end if;
  if raw_threshold !~ '^[0-9]{1,10}$' then
    raise exception 'Enter a whole-number stock alert. Use 0 for no alert.';
  end if;
  if raw_threshold::numeric > 2147483647 then
    raise exception 'Enter a whole-number stock alert. Use 0 for no alert.';
  end if;
  v_price := raw_price::numeric;
  v_cost := nullif(raw_cost, '')::numeric;
  v_carton_size := raw_carton::int;
  v_low_stock_threshold := raw_threshold::int;
  v_image_url := nullif(btrim(coalesce(p_payload ->> 'image_url', '')), '');
  if p_payload ? 'active' and jsonb_typeof(p_payload -> 'active') is distinct from 'boolean' then
    raise exception 'Choose whether this product is active.';
  end if;
  v_active := coalesce((p_payload ->> 'active')::boolean, true);

  if p_product_id is null then
    insert into public.products(name, category_id, price_per_unit, cost_per_unit,
      carton_size, low_stock_threshold, image_url, active)
    values (v_name, v_category_id, v_price, v_cost, v_carton_size,
      v_low_stock_threshold, v_image_url, v_active)
    returning * into saved_product;

    -- Product setup never imports physical stock. Receiving remains a separate event.
    insert into public.inventory_balances(product_id, quantity_on_hand, updated_at)
    values (saved_product.id, 0, now()) on conflict (product_id) do nothing;
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, after_json)
    values (auth.uid(), 'save_product_checked_insert', 'product', saved_product.id, to_jsonb(saved_product));
    return saved_product;
  end if;

  select * into existing_product from public.products where id = p_product_id for update;
  if existing_product.id is null then
    raise exception 'Product not found.';
  end if;
  if p_source_updated_at is null or existing_product.updated_at is distinct from p_source_updated_at then
    raise exception using errcode = '40001', message = 'This product was changed on another device or its version is missing. Close and reopen the product to review the latest details.';
  end if;
  update public.products
  set name = v_name, category_id = v_category_id, price_per_unit = v_price,
      cost_per_unit = v_cost, carton_size = v_carton_size,
      low_stock_threshold = v_low_stock_threshold, image_url = v_image_url, active = v_active
  where id = p_product_id returning * into saved_product;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, before_json, after_json)
  values (auth.uid(), 'save_product_checked_update', 'product', saved_product.id, to_jsonb(existing_product), to_jsonb(saved_product));
  return saved_product;
end;
$$;

revoke execute on function public.save_product_checked(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.save_product_checked(uuid, jsonb, timestamptz) to authenticated;
