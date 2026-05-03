insert into public.app_settings (key, value)
values
  ('beer_bundle_enabled', 'true'::jsonb),
  ('beer_bundle_name', '"Beer Bundle"'::jsonb),
  ('beer_bundle_units_per_set', '4'::jsonb),
  ('beer_bundle_price', '40'::jsonb)
on conflict (key) do nothing;

create or replace function public.complete_sale(
  p_items jsonb,
  p_payment_method text,
  p_qr_reference text default null,
  p_complimentary_reason text default null,
  p_idempotency_key text default null,
  p_qr_receipt_image_path text default null,
  p_discount_amount numeric default 0,
  p_order_taken_by text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_sale public.sales%rowtype;
  business_date date;
  sale_id uuid := gen_random_uuid();
  sale_no text;
  allow_negative boolean := public.setting_bool('allow_negative_stock', false);
  require_qr_ref boolean := public.setting_bool('require_qr_reference', false);
  bundle_enabled boolean := public.setting_bool('beer_bundle_enabled', true);
  bundle_name text := public.setting_text('beer_bundle_name', 'Beer Bundle');
  bundle_units_per_set int := greatest(1, public.setting_text('beer_bundle_units_per_set', '4')::int);
  bundle_price numeric(12,2) := public.setting_text('beer_bundle_price', '40')::numeric(12,2);
  total numeric(12,2) := 0;
  subtotal numeric(12,2) := 0;
  paid numeric(12,2) := 0;
  raw_item jsonb;
  raw_component jsonb;
  product_record public.products%rowtype;
  before_qty int;
  after_qty int;
  updated_stock jsonb := '[]'::jsonb;
  item_line_no int := 0;
  item_quantity int;
  item_product_id uuid;
  item_label text;
  item_custom_price numeric(12,2);
  component_product_id uuid;
  component_quantity int;
  component_total int;
  required_components int;
  bundle_line_total numeric(12,2);
  bundle_cents int;
  remaining_cents int;
  component_rows int;
  component_index int;
  component_line_cents int;
  component_record record;
  item record;
begin
  perform public.require_role(array['cashier', 'manager', 'admin']);
  if p_payment_method not in ('cash', 'qr', 'complimentary') then raise exception 'Invalid payment method.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Cart is empty.'; end if;
  if p_payment_method = 'complimentary' and nullif(trim(coalesce(p_complimentary_reason, '')), '') is null then
    raise exception 'Complimentary reason is required.';
  end if;
  if p_payment_method = 'qr' and require_qr_ref and nullif(trim(coalesce(p_qr_reference, '')), '') is null then
    raise exception 'QR reference is required.';
  end if;

  if p_idempotency_key is not null then
    select * into existing_sale from public.sales where idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object('sale_id', existing_sale.id, 'sale_number', existing_sale.sale_number, 'total_amount', existing_sale.total_amount, 'updated_stock', '[]'::jsonb);
    end if;
  end if;

  create temporary table tmp_custom_sale_items(
    item_name text,
    quantity int not null,
    unit_price numeric(12,2) not null,
    line_total numeric(12,2) not null
  ) on commit drop;

  create temporary table tmp_stock_sale_items(
    product_id uuid not null,
    item_name text,
    quantity int not null,
    unit_price numeric(12,2) not null,
    line_total numeric(12,2) not null
  ) on commit drop;

  create temporary table tmp_bundle_components(
    line_no int not null,
    product_id uuid not null,
    quantity int not null
  ) on commit drop;

  for raw_item in select value from jsonb_array_elements(p_items) loop
    item_line_no := item_line_no + 1;
    item_quantity := coalesce(nullif(raw_item->>'quantity', '')::int, 0);
    item_label := coalesce(nullif(raw_item->>'name', ''), 'Custom Order');

    if item_quantity <= 0 then
      raise exception 'Item quantities must be positive.';
    end if;

    if coalesce((raw_item->>'bundle')::boolean, false) then
      if not bundle_enabled then raise exception 'Beer bundle is disabled.'; end if;
      if bundle_price <= 0 then raise exception 'Beer bundle price must be greater than zero.'; end if;
      if jsonb_typeof(raw_item->'components') <> 'array' then
        raise exception 'Choose the beer types inside the bundle.';
      end if;

      component_total := 0;

      for raw_component in select value from jsonb_array_elements(raw_item->'components') loop
        component_product_id := nullif(raw_component->>'product_id', '')::uuid;
        component_quantity := coalesce(nullif(raw_component->>'quantity', '')::int, 0);
        if component_product_id is null or component_quantity <= 0 then
          raise exception 'Bundle beer quantities must be positive.';
        end if;

        select p.* into product_record
        from public.products p
        left join public.categories c on c.id = p.category_id
        where p.id = component_product_id
          and p.active = true
          and coalesce(c.name, '') = 'Beer';

        if not found then
          raise exception 'Bundle can only include active Beer products.';
        end if;

        insert into tmp_bundle_components(line_no, product_id, quantity)
        values (item_line_no, component_product_id, component_quantity);
        component_total := component_total + component_quantity;
      end loop;

      required_components := item_quantity * bundle_units_per_set;
      if component_total <> required_components then
        raise exception 'Beer bundle requires exactly % beer unit(s).', required_components;
      end if;

      bundle_line_total := bundle_price * item_quantity;
      subtotal := subtotal + bundle_line_total;
      bundle_cents := round(bundle_line_total * 100);
      remaining_cents := bundle_cents;
      component_rows := (select count(distinct product_id) from tmp_bundle_components where tmp_bundle_components.line_no = item_line_no);
      component_index := 0;

      for component_record in
        select product_id, sum(quantity)::int quantity
        from tmp_bundle_components
        where tmp_bundle_components.line_no = item_line_no
        group by product_id
        order by product_id
      loop
        component_index := component_index + 1;
        if component_index = component_rows then
          component_line_cents := remaining_cents;
        else
          component_line_cents := round(bundle_cents * component_record.quantity::numeric / component_total);
          remaining_cents := remaining_cents - component_line_cents;
        end if;

        insert into tmp_stock_sale_items(product_id, item_name, quantity, unit_price, line_total)
        values (
          component_record.product_id,
          bundle_name,
          component_record.quantity,
          round((component_line_cents / 100.0) / component_record.quantity, 2),
          component_line_cents / 100.0
        );
      end loop;
    else
      item_product_id := nullif(raw_item->>'product_id', '')::uuid;
      item_custom_price := nullif(raw_item->>'custom_price', '')::numeric(12,2);

      if item_product_id is null then
        if item_custom_price is null or item_custom_price <= 0 then
          raise exception 'Custom order price is required.';
        end if;
        subtotal := subtotal + (item_custom_price * item_quantity);
        insert into tmp_custom_sale_items(item_name, quantity, unit_price, line_total)
        values (item_label, item_quantity, item_custom_price, item_custom_price * item_quantity);
      else
        select * into product_record from public.products where id = item_product_id and active = true;
        if not found then raise exception 'Product is inactive or missing.'; end if;
        subtotal := subtotal + (product_record.price_per_unit * item_quantity);
        insert into tmp_stock_sale_items(product_id, item_name, quantity, unit_price, line_total)
        values (item_product_id, null, item_quantity, product_record.price_per_unit, product_record.price_per_unit * item_quantity);
      end if;
    end if;
  end loop;

  insert into public.inventory_balances(product_id, quantity_on_hand)
  select distinct product_id, 0 from tmp_stock_sale_items
  on conflict (product_id) do nothing;

  perform 1
  from public.inventory_balances
  where product_id in (select distinct product_id from tmp_stock_sale_items)
  order by product_id
  for update;

  for item in select product_id, sum(quantity)::int quantity from tmp_stock_sale_items group by product_id loop
    select p.* into product_record from public.products p where p.id = item.product_id and p.active = true;
    if not found then raise exception 'Product is inactive or missing.'; end if;
    select quantity_on_hand into before_qty from public.inventory_balances where product_id = item.product_id;
    if not allow_negative and before_qty < item.quantity then
      raise exception 'Insufficient stock for %.', product_record.name;
    end if;
  end loop;

  if coalesce(p_discount_amount, 0) < 0 or coalesce(p_discount_amount, 0) > subtotal then
    raise exception 'Invalid discount amount.';
  end if;

  total := subtotal - coalesce(p_discount_amount, 0);
  paid := case when p_payment_method = 'complimentary' then 0 else total end;

  business_date := public.get_business_date();
  perform pg_advisory_xact_lock(hashtext('sale-number-' || business_date::text));
  sale_no := public.next_sale_number(business_date);

  insert into public.sales (
    id, sale_number, business_date, payment_method, total_amount, paid_amount,
    discount_amount, order_taken_by, complimentary_reason, qr_reference, qr_receipt_image_path, qr_status, cashier_id, idempotency_key
  )
  values (
    sale_id, sale_no, business_date, p_payment_method, total, paid,
    coalesce(p_discount_amount, 0), p_order_taken_by, p_complimentary_reason, p_qr_reference, p_qr_receipt_image_path,
    case when p_payment_method = 'qr' then 'pending' else 'not_applicable' end,
    auth.uid(), p_idempotency_key
  );

  for item in select * from tmp_custom_sale_items loop
    insert into public.sale_items(sale_id, product_id, custom_item_name, quantity, unit_price, line_total)
    values (sale_id, null, coalesce(item.item_name, 'Custom Order'), item.quantity, item.unit_price, item.line_total);
  end loop;

  for item in
    select t.product_id, t.item_name, sum(t.quantity)::int quantity, round(sum(t.line_total) / sum(t.quantity), 2) unit_price, sum(t.line_total)::numeric(12,2) line_total
    from tmp_stock_sale_items t
    group by t.product_id, t.item_name
  loop
    insert into public.sale_items(sale_id, product_id, custom_item_name, quantity, unit_price, line_total)
    values (sale_id, item.product_id, item.item_name, item.quantity, item.unit_price, item.line_total);
  end loop;

  for item in select product_id, sum(quantity)::int quantity from tmp_stock_sale_items group by product_id order by product_id loop
    select * into product_record from public.products where id = item.product_id;
    select quantity_on_hand into before_qty from public.inventory_balances where product_id = item.product_id;
    after_qty := before_qty - item.quantity;
    update public.inventory_balances set quantity_on_hand = after_qty, updated_at = now() where product_id = item.product_id;

    insert into public.stock_movements(
      product_id, movement_type, quantity_change, quantity_before, quantity_after,
      unit_input, input_quantity, carton_size_at_time, reference_type, reference_id, entered_by, created_by
    )
    values (
      item.product_id,
      case when p_payment_method = 'complimentary' then 'complimentary' else 'sale' end,
      item.quantity * -1, before_qty, after_qty, 'system', item.quantity, product_record.carton_size,
      'sale', sale_id, p_order_taken_by, auth.uid()
    );
    updated_stock := updated_stock || jsonb_build_array(jsonb_build_object('product_id', item.product_id, 'quantity_on_hand', after_qty));
  end loop;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, after_json)
  values (auth.uid(), 'complete_sale', 'sale', sale_id, jsonb_build_object('total_amount', total, 'payment_method', p_payment_method));

  return jsonb_build_object('sale_id', sale_id, 'sale_number', sale_no, 'total_amount', total, 'updated_stock', updated_stock);
exception
  when unique_violation then
    if p_idempotency_key is not null then
      select * into existing_sale from public.sales where idempotency_key = p_idempotency_key;
      if found then
        return jsonb_build_object('sale_id', existing_sale.id, 'sale_number', existing_sale.sale_number, 'total_amount', existing_sale.total_amount, 'updated_stock', '[]'::jsonb);
      end if;
    end if;
    raise;
end;
$$;
