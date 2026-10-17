-- Save products atomically and prevent stale Admin screens from
-- overwriting product edits made on another device.
create or replace function public.save_product_checked(
  p_product_id uuid,
  p_payload jsonb,
  p_source_updated_at timestamptz default null
)
returns public.products
language plpgsql
security definer
set search_path = public
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
begin
  if auth.uid() is null then
    raise exception 'Cloud session is not ready. Enter the website access code again.';
  end if;

  if public.current_user_role() <> 'admin' then
    raise exception 'Admin access required. Unlock Admin again before saving products.';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Product payload is required.';
  end if;

  v_name := btrim(coalesce(p_payload ->> 'name', ''));
  v_category_id := nullif(p_payload ->> 'category_id', '')::uuid;
  v_price := coalesce((p_payload ->> 'price_per_unit')::numeric, 0);
  v_cost := case
    when p_payload ? 'cost_per_unit' and nullif(p_payload ->> 'cost_per_unit', '') is not null
      then (p_payload ->> 'cost_per_unit')::numeric
    else null
  end;
  v_carton_size := coalesce((p_payload ->> 'carton_size')::int, 24);
  v_low_stock_threshold := coalesce((p_payload ->> 'low_stock_threshold')::int, 0);
  v_image_url := nullif(btrim(coalesce(p_payload ->> 'image_url', '')), '');
  v_active := coalesce((p_payload ->> 'active')::boolean, true);

  if v_name = '' then
    raise exception 'Enter a product name.';
  end if;

  if v_price < 0 then
    raise exception 'Enter a valid price per unit.';
  end if;

  if v_cost is not null and v_cost < 0 then
    raise exception 'Enter a valid cost per unit.';
  end if;

  if v_carton_size < 1 then
    raise exception 'Units per carton must be at least 1.';
  end if;

  if v_low_stock_threshold < 0 then
    raise exception 'Low stock alert unit balance must be 0 or more.';
  end if;

  if v_category_id is not null and not exists (select 1 from public.categories where id = v_category_id) then
    raise exception 'Choose a valid product category.';
  end if;

  if p_product_id is null then
    insert into public.products(
      name,
      category_id,
      price_per_unit,
      cost_per_unit,
      carton_size,
      low_stock_threshold,
      image_url,
      active
    )
    values (
      v_name,
      v_category_id,
      v_price,
      v_cost,
      v_carton_size,
      v_low_stock_threshold,
      v_image_url,
      v_active
    )
    returning * into saved_product;

    insert into public.inventory_balances(product_id, quantity_on_hand, updated_at)
    values (saved_product.id, 0, now())
    on conflict (product_id) do nothing;

    insert into public.audit_logs(actor_id, action, entity_type, entity_id, after_json)
    values (auth.uid(), 'save_product_checked_insert', 'product', saved_product.id, to_jsonb(saved_product));

    return saved_product;
  end if;

  select *
  into existing_product
  from public.products
  where id = p_product_id
  for update;

  if existing_product.id is null then
    raise exception 'Product not found.';
  end if;

  if p_source_updated_at is not null and existing_product.updated_at <> p_source_updated_at then
    raise exception 'This product was changed on another device. Latest products loaded; review and save again.';
  end if;

  update public.products
  set name = v_name,
      category_id = v_category_id,
      price_per_unit = v_price,
      cost_per_unit = v_cost,
      carton_size = v_carton_size,
      low_stock_threshold = v_low_stock_threshold,
      image_url = v_image_url,
      active = v_active
  where id = p_product_id
  returning * into saved_product;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, before_json, after_json)
  values (auth.uid(), 'save_product_checked_update', 'product', saved_product.id, to_jsonb(existing_product), to_jsonb(saved_product));

  return saved_product;
end;
$$;

revoke execute on function public.save_product_checked(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.save_product_checked(uuid, jsonb, timestamptz) to authenticated;
