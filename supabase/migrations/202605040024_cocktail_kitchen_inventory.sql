-- Cocktail recipes, ingredient inventory, table numbers, and kitchen production foundation.
-- Base inventory units: ml, g, unit.

alter table public.sales add column if not exists table_number text;

create table if not exists public.ingredient_items (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  category text not null default 'Other' check (category in ('Liquor', 'Mixer', 'Seafood', 'Condiment', 'Food', 'Other')),
  base_unit text not null default 'unit' check (base_unit in ('ml', 'g', 'unit')),
  default_pack_size numeric(14,2) not null default 1 check (default_pack_size > 0),
  pack_label text not null default 'Pack',
  cost_per_base_unit numeric(14,4),
  low_stock_threshold numeric(14,2) not null default 0 check (low_stock_threshold >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ingredient_balances (
  ingredient_id uuid primary key references public.ingredient_items(id),
  quantity_on_hand numeric(14,2) not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.ingredient_movements (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredient_items(id),
  movement_type text not null check (movement_type in ('stock_in', 'sale', 'complimentary', 'void_sale', 'kitchen_production', 'waste', 'adjustment', 'count')),
  quantity_change numeric(14,2) not null,
  quantity_before numeric(14,2) not null,
  quantity_after numeric(14,2) not null,
  unit_input text,
  input_quantity numeric(14,2),
  pack_size_at_time numeric(14,2),
  reference_type text,
  reference_id uuid,
  reason text,
  notes text,
  entered_by text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  ingredient_id uuid not null references public.ingredient_items(id),
  quantity_per_unit numeric(14,2) not null check (quantity_per_unit > 0),
  unit text not null check (unit in ('ml', 'g', 'unit')),
  created_at timestamptz not null default now(),
  unique (product_id, ingredient_id)
);

create table if not exists public.kitchen_daily_pax (
  id uuid primary key default gen_random_uuid(),
  business_date date unique not null,
  pax_count int not null check (pax_count >= 0),
  entered_by text,
  notes text,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kitchen_production_reports (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  platter_name text not null,
  platter_count numeric(12,2) not null check (platter_count > 0),
  serving_basis text not null default 'pax' check (serving_basis in ('pax', 'table', 'batch')),
  submitted_by text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kitchen_production_items (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.kitchen_production_reports(id) on delete cascade,
  ingredient_id uuid not null references public.ingredient_items(id),
  quantity_per_platter numeric(14,2) not null check (quantity_per_platter >= 0),
  total_quantity numeric(14,2) not null check (total_quantity >= 0),
  unit text not null check (unit in ('ml', 'g', 'unit')),
  notes text
);

create index if not exists ingredient_movements_ingredient_created_idx on public.ingredient_movements(ingredient_id, created_at desc);
create index if not exists recipe_ingredients_product_idx on public.recipe_ingredients(product_id);
create index if not exists kitchen_production_reports_date_idx on public.kitchen_production_reports(business_date, created_at desc);

drop trigger if exists ingredient_items_touch_updated_at on public.ingredient_items;
create trigger ingredient_items_touch_updated_at before update on public.ingredient_items
for each row execute function public.touch_updated_at();

drop trigger if exists kitchen_daily_pax_touch_updated_at on public.kitchen_daily_pax;
create trigger kitchen_daily_pax_touch_updated_at before update on public.kitchen_daily_pax
for each row execute function public.touch_updated_at();

drop trigger if exists kitchen_production_reports_touch_updated_at on public.kitchen_production_reports;
create trigger kitchen_production_reports_touch_updated_at before update on public.kitchen_production_reports
for each row execute function public.touch_updated_at();

alter table public.ingredient_items enable row level security;
alter table public.ingredient_balances enable row level security;
alter table public.ingredient_movements enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.kitchen_daily_pax enable row level security;
alter table public.kitchen_production_reports enable row level security;
alter table public.kitchen_production_items enable row level security;

drop policy if exists "ingredient items read authenticated" on public.ingredient_items;
create policy "ingredient items read authenticated" on public.ingredient_items
for select to authenticated using (true);

drop policy if exists "ingredient items admin write" on public.ingredient_items;
create policy "ingredient items admin write" on public.ingredient_items
for all to authenticated using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');

drop policy if exists "ingredient balances read authenticated" on public.ingredient_balances;
create policy "ingredient balances read authenticated" on public.ingredient_balances
for select to authenticated using (true);

drop policy if exists "ingredient balances admin write" on public.ingredient_balances;
create policy "ingredient balances admin write" on public.ingredient_balances
for all to authenticated using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');

drop policy if exists "ingredient movements read authenticated" on public.ingredient_movements;
create policy "ingredient movements read authenticated" on public.ingredient_movements
for select to authenticated using (true);

drop policy if exists "ingredient movements no direct write" on public.ingredient_movements;
create policy "ingredient movements no direct write" on public.ingredient_movements
for all to authenticated using (false) with check (false);

drop policy if exists "recipe ingredients read authenticated" on public.recipe_ingredients;
create policy "recipe ingredients read authenticated" on public.recipe_ingredients
for select to authenticated using (true);

drop policy if exists "recipe ingredients admin write" on public.recipe_ingredients;
create policy "recipe ingredients admin write" on public.recipe_ingredients
for all to authenticated using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');

drop policy if exists "kitchen pax read authenticated" on public.kitchen_daily_pax;
create policy "kitchen pax read authenticated" on public.kitchen_daily_pax
for select to authenticated using (true);

drop policy if exists "kitchen pax staff write" on public.kitchen_daily_pax;
create policy "kitchen pax staff write" on public.kitchen_daily_pax
for all to authenticated using (public.current_user_role() in ('cashier', 'manager', 'admin')) with check (public.current_user_role() in ('cashier', 'manager', 'admin'));

drop policy if exists "kitchen production read authenticated" on public.kitchen_production_reports;
create policy "kitchen production read authenticated" on public.kitchen_production_reports
for select to authenticated using (true);

drop policy if exists "kitchen production staff write" on public.kitchen_production_reports;
create policy "kitchen production staff write" on public.kitchen_production_reports
for insert to authenticated with check (public.current_user_role() in ('cashier', 'manager', 'admin'));

drop policy if exists "kitchen production items read authenticated" on public.kitchen_production_items;
create policy "kitchen production items read authenticated" on public.kitchen_production_items
for select to authenticated using (true);

drop policy if exists "kitchen production items staff write" on public.kitchen_production_items;
create policy "kitchen production items staff write" on public.kitchen_production_items
for insert to authenticated with check (public.current_user_role() in ('cashier', 'manager', 'admin'));

grant select on public.ingredient_items, public.ingredient_balances, public.ingredient_movements, public.recipe_ingredients, public.kitchen_daily_pax, public.kitchen_production_reports, public.kitchen_production_items to authenticated;
grant insert, update on public.ingredient_items, public.ingredient_balances, public.recipe_ingredients, public.kitchen_daily_pax to authenticated;
grant insert on public.kitchen_production_reports, public.kitchen_production_items to authenticated;

create or replace function public.save_product_recipe(
  p_product_id uuid,
  p_items jsonb
)
returns setof public.recipe_ingredients
language plpgsql
security definer
set search_path = public
as $$
declare
  row_item jsonb;
  ingredient_record public.ingredient_items%rowtype;
  product_record record;
  amount numeric(14,2);
  ingredient_id uuid;
begin
  perform public.require_role(array['admin']);

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'Recipe items must be a list.';
  end if;

  select p.id, p.name, c.name as category_name
  into product_record
  from public.products p
  left join public.categories c on c.id = p.category_id
  where p.id = p_product_id
  for update;

  if product_record.id is null then
    raise exception 'Cocktail product not found.';
  end if;

  if coalesce(product_record.category_name, '') <> 'Cocktail' then
    raise exception 'Recipes are only for Cocktail products.';
  end if;

  delete from public.recipe_ingredients where product_id = p_product_id;

  for row_item in select value from jsonb_array_elements(p_items)
  loop
    ingredient_id := nullif(row_item ->> 'ingredient_id', '')::uuid;
    amount := coalesce(nullif(row_item ->> 'quantity_per_unit', '')::numeric, 0);

    if ingredient_id is null or amount <= 0 then
      raise exception 'Each recipe line needs an ingredient and amount.';
    end if;

    select * into ingredient_record
    from public.ingredient_items
    where id = ingredient_id and active = true;

    if ingredient_record.id is null then
      raise exception 'Recipe ingredient is inactive or missing.';
    end if;

    insert into public.recipe_ingredients(product_id, ingredient_id, quantity_per_unit, unit)
    values (p_product_id, ingredient_id, amount, ingredient_record.base_unit);
  end loop;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, after_json)
  values (auth.uid(), 'save_product_recipe', 'product', p_product_id, p_items);

  return query
  select *
  from public.recipe_ingredients
  where product_id = p_product_id
  order by created_at;
end;
$$;

create or replace function public.stock_in_ingredient(
  p_ingredient_id uuid,
  p_input_quantity numeric,
  p_unit_type text,
  p_pack_size numeric default null,
  p_supplier text default null,
  p_reference text default null,
  p_notes text default null,
  p_entered_by text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ingredient_record public.ingredient_items%rowtype;
  before_qty numeric(14,2);
  after_qty numeric(14,2);
  quantity_added numeric(14,2);
  pack_size numeric(14,2);
begin
  perform public.require_role(array['manager', 'admin']);

  if p_unit_type not in ('base', 'pack') then
    raise exception 'Ingredient stock-in unit must be base or pack.';
  end if;
  if coalesce(p_input_quantity, 0) <= 0 then
    raise exception 'Ingredient stock-in quantity must be positive.';
  end if;

  select * into ingredient_record
  from public.ingredient_items
  where id = p_ingredient_id and active = true
  for update;

  if ingredient_record.id is null then
    raise exception 'Ingredient is inactive or missing.';
  end if;

  pack_size := coalesce(p_pack_size, ingredient_record.default_pack_size);
  if p_unit_type = 'pack' and pack_size <= 0 then
    raise exception 'Bottle/pack size must be positive.';
  end if;

  quantity_added := case when p_unit_type = 'pack' then p_input_quantity * pack_size else p_input_quantity end;

  insert into public.ingredient_balances(ingredient_id, quantity_on_hand)
  values (p_ingredient_id, 0)
  on conflict (ingredient_id) do nothing;

  select quantity_on_hand into before_qty
  from public.ingredient_balances
  where ingredient_id = p_ingredient_id
  for update;

  after_qty := before_qty + quantity_added;

  update public.ingredient_balances
  set quantity_on_hand = after_qty, updated_at = now()
  where ingredient_id = p_ingredient_id;

  insert into public.ingredient_movements(
    ingredient_id, movement_type, quantity_change, quantity_before, quantity_after,
    unit_input, input_quantity, pack_size_at_time, reference_type, reason, notes, entered_by, created_by
  )
  values (
    p_ingredient_id, 'stock_in', quantity_added, before_qty, after_qty,
    p_unit_type, p_input_quantity, pack_size, 'ingredient_stock_in',
    nullif(trim(coalesce(p_supplier, '')), '') || case when nullif(trim(coalesce(p_reference, '')), '') is null then '' else ' / ' || p_reference end,
    p_notes, p_entered_by, auth.uid()
  );

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, after_json)
  values (auth.uid(), 'stock_in_ingredient', 'ingredient', p_ingredient_id, jsonb_build_object('quantity_added', quantity_added, 'entered_by', p_entered_by));

  return jsonb_build_object('ingredient_id', p_ingredient_id, 'quantity_added', quantity_added, 'quantity_on_hand', after_qty);
end;
$$;

drop function if exists public.complete_sale_with_qr_type(jsonb, text, text, text, text, text, numeric, text, text);
drop function if exists public.complete_sale(jsonb, text, text, text, text, text, numeric, text);

create or replace function public.complete_sale(
  p_items jsonb,
  p_payment_method text,
  p_qr_reference text default null,
  p_complimentary_reason text default null,
  p_idempotency_key text default null,
  p_qr_receipt_image_path text default null,
  p_discount_amount numeric default 0,
  p_order_taken_by text default null,
  p_table_number text default null
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
  before_ingredient_qty numeric(14,2);
  after_ingredient_qty numeric(14,2);
  updated_stock jsonb := '[]'::jsonb;
  updated_ingredients jsonb := '[]'::jsonb;
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
  sale_item record;
  ingredient_usage record;
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
  if p_payment_method = 'qr' and nullif(trim(coalesce(p_qr_receipt_image_path, '')), '') is null then
    raise exception 'QR receipt photo is required.';
  end if;

  if p_idempotency_key is not null then
    select * into existing_sale from public.sales where idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object('sale_id', existing_sale.id, 'sale_number', existing_sale.sale_number, 'total_amount', existing_sale.total_amount, 'updated_stock', '[]'::jsonb, 'updated_ingredients', '[]'::jsonb);
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

  create temporary table tmp_recipe_usage(
    ingredient_id uuid not null,
    quantity numeric(14,2) not null,
    source_products text
  ) on commit drop;

  insert into tmp_recipe_usage(ingredient_id, quantity, source_products)
  select
    ri.ingredient_id,
    sum(t.quantity * ri.quantity_per_unit)::numeric(14,2),
    string_agg(distinct p.name, ', ' order by p.name)
  from tmp_stock_sale_items t
  join public.recipe_ingredients ri on ri.product_id = t.product_id
  join public.products p on p.id = t.product_id
  group by ri.ingredient_id;

  insert into public.inventory_balances(product_id, quantity_on_hand)
  select distinct product_id, 0
  from tmp_stock_sale_items t
  where not exists (select 1 from public.recipe_ingredients ri where ri.product_id = t.product_id)
  on conflict (product_id) do nothing;

  perform 1
  from public.inventory_balances
  where product_id in (
    select distinct t.product_id
    from tmp_stock_sale_items t
    where not exists (select 1 from public.recipe_ingredients ri where ri.product_id = t.product_id)
  )
  order by product_id
  for update;

  insert into public.ingredient_balances(ingredient_id, quantity_on_hand)
  select distinct ingredient_id, 0 from tmp_recipe_usage
  on conflict (ingredient_id) do nothing;

  perform 1
  from public.ingredient_balances
  where ingredient_id in (select distinct ingredient_id from tmp_recipe_usage)
  order by ingredient_id
  for update;

  for sale_item in
    select t.product_id, sum(t.quantity)::int quantity
    from tmp_stock_sale_items t
    where not exists (select 1 from public.recipe_ingredients ri where ri.product_id = t.product_id)
    group by t.product_id
  loop
    select p.* into product_record from public.products p where p.id = sale_item.product_id and p.active = true;
    if not found then raise exception 'Product is inactive or missing.'; end if;
    select quantity_on_hand into before_qty from public.inventory_balances where product_id = sale_item.product_id;
    if not allow_negative and before_qty < sale_item.quantity then
      raise exception 'Insufficient stock for %.', product_record.name;
    end if;
  end loop;

  for ingredient_usage in
    select u.ingredient_id, i.name, i.base_unit, sum(u.quantity)::numeric(14,2) quantity
    from tmp_recipe_usage u
    join public.ingredient_items i on i.id = u.ingredient_id and i.active = true
    group by u.ingredient_id, i.name, i.base_unit
  loop
    select quantity_on_hand into before_ingredient_qty from public.ingredient_balances where ingredient_id = ingredient_usage.ingredient_id;
    if not allow_negative and before_ingredient_qty < ingredient_usage.quantity then
      raise exception 'Insufficient ingredient stock for %. Need % %, have % %.',
        ingredient_usage.name, ingredient_usage.quantity, ingredient_usage.base_unit, before_ingredient_qty, ingredient_usage.base_unit;
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
    discount_amount, order_taken_by, table_number, complimentary_reason, qr_reference, qr_receipt_image_path, qr_status, cashier_id, idempotency_key
  )
  values (
    sale_id, sale_no, business_date, p_payment_method, total, paid,
    coalesce(p_discount_amount, 0), p_order_taken_by, nullif(trim(coalesce(p_table_number, '')), ''), p_complimentary_reason, p_qr_reference, p_qr_receipt_image_path,
    case when p_payment_method = 'qr' then 'pending' else 'not_applicable' end,
    auth.uid(), p_idempotency_key
  );

  for sale_item in select * from tmp_custom_sale_items loop
    insert into public.sale_items(sale_id, product_id, custom_item_name, quantity, unit_price, line_total)
    values (sale_id, null, coalesce(sale_item.item_name, 'Custom Order'), sale_item.quantity, sale_item.unit_price, sale_item.line_total);
  end loop;

  for sale_item in
    select t.product_id, t.item_name, sum(t.quantity)::int quantity, round(sum(t.line_total) / sum(t.quantity), 2) unit_price, sum(t.line_total)::numeric(12,2) line_total
    from tmp_stock_sale_items t
    group by t.product_id, t.item_name
  loop
    insert into public.sale_items(sale_id, product_id, custom_item_name, quantity, unit_price, line_total)
    values (sale_id, sale_item.product_id, sale_item.item_name, sale_item.quantity, sale_item.unit_price, sale_item.line_total);
  end loop;

  for sale_item in
    select t.product_id, sum(t.quantity)::int quantity
    from tmp_stock_sale_items t
    where not exists (select 1 from public.recipe_ingredients ri where ri.product_id = t.product_id)
    group by t.product_id
    order by t.product_id
  loop
    select * into product_record from public.products where id = sale_item.product_id;
    select quantity_on_hand into before_qty from public.inventory_balances where product_id = sale_item.product_id;
    after_qty := before_qty - sale_item.quantity;
    update public.inventory_balances set quantity_on_hand = after_qty, updated_at = now() where product_id = sale_item.product_id;

    insert into public.stock_movements(
      product_id, movement_type, quantity_change, quantity_before, quantity_after,
      unit_input, input_quantity, carton_size_at_time, reference_type, reference_id, entered_by, created_by
    )
    values (
      sale_item.product_id,
      case when p_payment_method = 'complimentary' then 'complimentary' else 'sale' end,
      sale_item.quantity * -1, before_qty, after_qty, 'system', sale_item.quantity, product_record.carton_size,
      'sale', sale_id, p_order_taken_by, auth.uid()
    );
    updated_stock := updated_stock || jsonb_build_array(jsonb_build_object('product_id', sale_item.product_id, 'quantity_on_hand', after_qty));
  end loop;

  for ingredient_usage in
    select u.ingredient_id, i.name, i.base_unit, sum(u.quantity)::numeric(14,2) quantity, string_agg(distinct u.source_products, ', ') as source_products
    from tmp_recipe_usage u
    join public.ingredient_items i on i.id = u.ingredient_id
    group by u.ingredient_id, i.name, i.base_unit
    order by u.ingredient_id
  loop
    select quantity_on_hand into before_ingredient_qty from public.ingredient_balances where ingredient_id = ingredient_usage.ingredient_id;
    after_ingredient_qty := before_ingredient_qty - ingredient_usage.quantity;
    update public.ingredient_balances set quantity_on_hand = after_ingredient_qty, updated_at = now() where ingredient_id = ingredient_usage.ingredient_id;

    insert into public.ingredient_movements(
      ingredient_id, movement_type, quantity_change, quantity_before, quantity_after,
      unit_input, input_quantity, reference_type, reference_id, reason, notes, entered_by, created_by
    )
    values (
      ingredient_usage.ingredient_id,
      case when p_payment_method = 'complimentary' then 'complimentary' else 'sale' end,
      ingredient_usage.quantity * -1,
      before_ingredient_qty,
      after_ingredient_qty,
      'recipe',
      ingredient_usage.quantity,
      'sale',
      sale_id,
      case when p_payment_method = 'complimentary' then p_complimentary_reason else null end,
      ingredient_usage.source_products,
      p_order_taken_by,
      auth.uid()
    );

    updated_ingredients := updated_ingredients || jsonb_build_array(
      jsonb_build_object('ingredient_id', ingredient_usage.ingredient_id, 'quantity_on_hand', after_ingredient_qty)
    );
  end loop;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, after_json)
  values (auth.uid(), 'complete_sale', 'sale', sale_id, jsonb_build_object('total_amount', total, 'payment_method', p_payment_method, 'table_number', p_table_number));

  return jsonb_build_object('sale_id', sale_id, 'sale_number', sale_no, 'total_amount', total, 'updated_stock', updated_stock, 'updated_ingredients', updated_ingredients);
exception
  when unique_violation then
    if p_idempotency_key is not null then
      select * into existing_sale from public.sales where idempotency_key = p_idempotency_key;
      if found then
        return jsonb_build_object('sale_id', existing_sale.id, 'sale_number', existing_sale.sale_number, 'total_amount', existing_sale.total_amount, 'updated_stock', '[]'::jsonb, 'updated_ingredients', '[]'::jsonb);
      end if;
    end if;
    raise;
end;
$$;

create or replace function public.complete_sale_with_qr_type(
  p_items jsonb,
  p_payment_method text,
  p_qr_reference text default null,
  p_complimentary_reason text default null,
  p_idempotency_key text default null,
  p_qr_receipt_image_path text default null,
  p_discount_amount numeric default 0,
  p_order_taken_by text default null,
  p_qr_payment_type text default null,
  p_table_number text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  sale_id uuid;
begin
  if p_payment_method = 'qr' and coalesce(p_qr_payment_type, '') not in ('WeChat Pay', 'AliPay', 'TnGo', 'Grab', 'Others') then
    raise exception 'Select a QR Payment type.';
  end if;

  if p_payment_method <> 'qr' then
    p_qr_payment_type := null;
  end if;

  result := public.complete_sale(
    p_items,
    p_payment_method,
    p_qr_reference,
    p_complimentary_reason,
    p_idempotency_key,
    p_qr_receipt_image_path,
    p_discount_amount,
    p_order_taken_by,
    p_table_number
  );

  sale_id := (result->>'sale_id')::uuid;

  update public.sales
  set qr_payment_type = p_qr_payment_type
  where id = sale_id;

  return result || jsonb_build_object('qr_payment_type', p_qr_payment_type);
end;
$$;

create or replace function public.void_sale(p_sale_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_record public.sales%rowtype;
  sale_item record;
  ingredient_usage record;
  before_qty int;
  after_qty int;
  before_ingredient_qty numeric(14,2);
  after_ingredient_qty numeric(14,2);
begin
  perform public.require_role(array['manager', 'admin']);
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Void reason is required.'; end if;

  select * into sale_record from public.sales where id = p_sale_id for update;
  if not found then raise exception 'Sale not found.'; end if;
  if sale_record.status = 'voided' then raise exception 'Sale is already voided.'; end if;

  perform 1
  from public.inventory_balances
  where product_id in (
    select si.product_id
    from public.sale_items si
    where si.sale_id = p_sale_id
      and si.product_id is not null
      and not exists (select 1 from public.recipe_ingredients ri where ri.product_id = si.product_id)
  )
  order by product_id
  for update;

  insert into public.ingredient_balances(ingredient_id, quantity_on_hand)
  select distinct ri.ingredient_id, 0
  from public.sale_items si
  join public.recipe_ingredients ri on ri.product_id = si.product_id
  where si.sale_id = p_sale_id
  on conflict (ingredient_id) do nothing;

  perform 1
  from public.ingredient_balances
  where ingredient_id in (
    select distinct ri.ingredient_id
    from public.sale_items si
    join public.recipe_ingredients ri on ri.product_id = si.product_id
    where si.sale_id = p_sale_id
  )
  order by ingredient_id
  for update;

  update public.sales
  set status = 'voided', voided_by = auth.uid(), void_reason = p_reason, voided_at = now()
  where id = p_sale_id;

  for sale_item in
    select si.*, p.carton_size
    from public.sale_items si
    join public.products p on p.id = si.product_id
    where si.sale_id = p_sale_id
      and not exists (select 1 from public.recipe_ingredients ri where ri.product_id = si.product_id)
  loop
    select quantity_on_hand into before_qty from public.inventory_balances where product_id = sale_item.product_id;
    after_qty := before_qty + sale_item.quantity;
    update public.inventory_balances set quantity_on_hand = after_qty, updated_at = now() where product_id = sale_item.product_id;
    insert into public.stock_movements(
      product_id, movement_type, quantity_change, quantity_before, quantity_after,
      unit_input, input_quantity, carton_size_at_time, reference_type, reference_id, reason, entered_by, created_by
    )
    values (sale_item.product_id, 'void_sale', sale_item.quantity, before_qty, after_qty, 'system', sale_item.quantity, sale_item.carton_size, 'sale', p_sale_id, p_reason, sale_record.order_taken_by, auth.uid());
  end loop;

  for ingredient_usage in
    select ri.ingredient_id, i.name, i.base_unit, sum(si.quantity * ri.quantity_per_unit)::numeric(14,2) quantity
    from public.sale_items si
    join public.recipe_ingredients ri on ri.product_id = si.product_id
    join public.ingredient_items i on i.id = ri.ingredient_id
    where si.sale_id = p_sale_id
    group by ri.ingredient_id, i.name, i.base_unit
    order by ri.ingredient_id
  loop
    select quantity_on_hand into before_ingredient_qty from public.ingredient_balances where ingredient_id = ingredient_usage.ingredient_id;
    after_ingredient_qty := before_ingredient_qty + ingredient_usage.quantity;
    update public.ingredient_balances set quantity_on_hand = after_ingredient_qty, updated_at = now() where ingredient_id = ingredient_usage.ingredient_id;
    insert into public.ingredient_movements(
      ingredient_id, movement_type, quantity_change, quantity_before, quantity_after,
      unit_input, input_quantity, reference_type, reference_id, reason, notes, entered_by, created_by
    )
    values (
      ingredient_usage.ingredient_id,
      'void_sale',
      ingredient_usage.quantity,
      before_ingredient_qty,
      after_ingredient_qty,
      'recipe',
      ingredient_usage.quantity,
      'sale',
      p_sale_id,
      p_reason,
      'Void sale recipe reversal',
      sale_record.order_taken_by,
      auth.uid()
    );
  end loop;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, before_json, after_json)
  values (auth.uid(), 'void_sale', 'sale', p_sale_id, to_jsonb(sale_record), jsonb_build_object('status', 'voided', 'reason', p_reason));

  return (select to_jsonb(s) from public.sales s where s.id = p_sale_id);
end;
$$;

create or replace function public.save_kitchen_pax(
  p_business_date date,
  p_pax_count int,
  p_entered_by text default null,
  p_notes text default null
)
returns public.kitchen_daily_pax
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_row public.kitchen_daily_pax%rowtype;
begin
  perform public.require_role(array['cashier', 'manager', 'admin']);
  if p_business_date is null then raise exception 'Business date is required.'; end if;
  if coalesce(p_pax_count, -1) < 0 then raise exception 'Pax count must be 0 or more.'; end if;

  insert into public.kitchen_daily_pax(business_date, pax_count, entered_by, notes, updated_by, updated_at)
  values (p_business_date, p_pax_count, p_entered_by, p_notes, auth.uid(), now())
  on conflict (business_date) do update
    set pax_count = excluded.pax_count,
        entered_by = excluded.entered_by,
        notes = excluded.notes,
        updated_by = auth.uid(),
        updated_at = now()
  returning * into saved_row;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, after_json)
  values (auth.uid(), 'save_kitchen_pax', 'kitchen_daily_pax', saved_row.id, to_jsonb(saved_row));

  return saved_row;
end;
$$;

create or replace function public.submit_kitchen_production(
  p_business_date date,
  p_platter_name text,
  p_platter_count numeric,
  p_submitted_by text,
  p_items jsonb,
  p_serving_basis text default 'pax',
  p_notes text default null
)
returns public.kitchen_production_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  report_row public.kitchen_production_reports%rowtype;
  row_item jsonb;
  ingredient_record public.ingredient_items%rowtype;
  ingredient_id uuid;
  quantity_per_platter numeric(14,2);
  total_quantity numeric(14,2);
  before_qty numeric(14,2);
  after_qty numeric(14,2);
begin
  perform public.require_role(array['cashier', 'manager', 'admin']);
  if p_business_date is null then raise exception 'Business date is required.'; end if;
  if nullif(trim(coalesce(p_platter_name, '')), '') is null then raise exception 'Platter name is required.'; end if;
  if coalesce(p_platter_count, 0) <= 0 then raise exception 'Platter count must be positive.'; end if;
  if p_serving_basis not in ('pax', 'table', 'batch') then raise exception 'Serving basis must be pax, table, or batch.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Kitchen items are required.'; end if;

  create temporary table tmp_kitchen_usage(
    ingredient_id uuid not null,
    quantity_per_platter numeric(14,2) not null,
    total_quantity numeric(14,2) not null,
    unit text not null,
    notes text
  ) on commit drop;

  for row_item in select value from jsonb_array_elements(p_items)
  loop
    ingredient_id := nullif(row_item ->> 'ingredient_id', '')::uuid;
    quantity_per_platter := coalesce(nullif(row_item ->> 'quantity_per_platter', '')::numeric, 0);
    if ingredient_id is null or quantity_per_platter < 0 then
      raise exception 'Each kitchen item needs an ingredient and quantity.';
    end if;

    select * into ingredient_record
    from public.ingredient_items
    where id = ingredient_id and active = true;

    if ingredient_record.id is null then raise exception 'Kitchen ingredient is inactive or missing.'; end if;
    total_quantity := quantity_per_platter * p_platter_count;

    insert into tmp_kitchen_usage(ingredient_id, quantity_per_platter, total_quantity, unit, notes)
    values (ingredient_id, quantity_per_platter, total_quantity, ingredient_record.base_unit, row_item ->> 'notes');
  end loop;

  insert into public.ingredient_balances(ingredient_id, quantity_on_hand)
  select distinct ingredient_id, 0 from tmp_kitchen_usage
  on conflict (ingredient_id) do nothing;

  perform 1
  from public.ingredient_balances
  where ingredient_id in (select distinct ingredient_id from tmp_kitchen_usage)
  order by ingredient_id
  for update;

  if exists (
    select 1
    from tmp_kitchen_usage usage
    join public.ingredient_balances balance on balance.ingredient_id = usage.ingredient_id
    where balance.quantity_on_hand < usage.total_quantity
  ) then
    raise exception 'Kitchen ingredient stock is insufficient. Receive stock or correct the usage before submitting.';
  end if;

  insert into public.kitchen_production_reports(business_date, platter_name, platter_count, serving_basis, submitted_by, notes, created_by)
  values (p_business_date, trim(p_platter_name), p_platter_count, p_serving_basis, p_submitted_by, p_notes, auth.uid())
  returning * into report_row;

  for row_item in select to_jsonb(t) from tmp_kitchen_usage t
  loop
    ingredient_id := (row_item ->> 'ingredient_id')::uuid;
    quantity_per_platter := (row_item ->> 'quantity_per_platter')::numeric;
    total_quantity := (row_item ->> 'total_quantity')::numeric;

    insert into public.kitchen_production_items(report_id, ingredient_id, quantity_per_platter, total_quantity, unit, notes)
    values (report_row.id, ingredient_id, quantity_per_platter, total_quantity, row_item ->> 'unit', row_item ->> 'notes');

    select quantity_on_hand into before_qty from public.ingredient_balances where public.ingredient_balances.ingredient_id = (row_item ->> 'ingredient_id')::uuid;
    after_qty := before_qty - total_quantity;
    update public.ingredient_balances set quantity_on_hand = after_qty, updated_at = now() where ingredient_balances.ingredient_id = (row_item ->> 'ingredient_id')::uuid;

    insert into public.ingredient_movements(
      ingredient_id, movement_type, quantity_change, quantity_before, quantity_after,
      unit_input, input_quantity, reference_type, reference_id, reason, notes, entered_by, created_by
    )
    values (
      (row_item ->> 'ingredient_id')::uuid,
      'kitchen_production',
      total_quantity * -1,
      before_qty,
      after_qty,
      'kitchen',
      total_quantity,
      'kitchen_production',
      report_row.id,
      p_platter_name,
      p_notes,
      p_submitted_by,
      auth.uid()
    );
  end loop;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, after_json)
  values (auth.uid(), 'submit_kitchen_production', 'kitchen_production_report', report_row.id, to_jsonb(report_row));

  return report_row;
end;
$$;

revoke execute on function public.save_product_recipe(uuid, jsonb) from public, anon;
revoke execute on function public.stock_in_ingredient(uuid, numeric, text, numeric, text, text, text, text) from public, anon;
revoke execute on function public.complete_sale(jsonb, text, text, text, text, text, numeric, text, text) from public, anon;
revoke execute on function public.complete_sale_with_qr_type(jsonb, text, text, text, text, text, numeric, text, text, text) from public, anon;
revoke execute on function public.save_kitchen_pax(date, int, text, text) from public, anon;
revoke execute on function public.submit_kitchen_production(date, text, numeric, text, jsonb, text, text) from public, anon;

grant execute on function public.save_product_recipe(uuid, jsonb) to authenticated;
grant execute on function public.stock_in_ingredient(uuid, numeric, text, numeric, text, text, text, text) to authenticated;
grant execute on function public.complete_sale(jsonb, text, text, text, text, text, numeric, text, text) to authenticated;
grant execute on function public.complete_sale_with_qr_type(jsonb, text, text, text, text, text, numeric, text, text, text) to authenticated;
grant execute on function public.save_kitchen_pax(date, int, text, text) to authenticated;
grant execute on function public.submit_kitchen_production(date, text, numeric, text, jsonb, text, text) to authenticated;

do $$
begin
  begin alter publication supabase_realtime add table public.ingredient_items; exception when duplicate_object then null; when undefined_object then null; end;
  begin alter publication supabase_realtime add table public.ingredient_balances; exception when duplicate_object then null; when undefined_object then null; end;
  begin alter publication supabase_realtime add table public.ingredient_movements; exception when duplicate_object then null; when undefined_object then null; end;
  begin alter publication supabase_realtime add table public.recipe_ingredients; exception when duplicate_object then null; when undefined_object then null; end;
  begin alter publication supabase_realtime add table public.kitchen_daily_pax; exception when duplicate_object then null; when undefined_object then null; end;
  begin alter publication supabase_realtime add table public.kitchen_production_reports; exception when duplicate_object then null; when undefined_object then null; end;
  begin alter publication supabase_realtime add table public.kitchen_production_items; exception when duplicate_object then null; when undefined_object then null; end;
end;
$$;
