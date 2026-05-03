create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'cashier' check (role in ('cashier', 'manager', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category_id uuid references public.categories(id),
  price_per_unit numeric(12,2) not null default 0,
  cost_per_unit numeric(12,2),
  carton_size int not null default 24 check (carton_size > 0),
  low_stock_threshold int not null default 0,
  active boolean not null default true,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.inventory_balances (
  product_id uuid primary key references public.products(id),
  quantity_on_hand int not null default 0,
  updated_at timestamptz not null default now()
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id),
  movement_type text not null check (movement_type in ('stock_in', 'sale', 'complimentary', 'void_sale', 'adjustment')),
  quantity_change int not null,
  quantity_before int not null,
  quantity_after int not null,
  unit_input text check (unit_input in ('can', 'carton', 'system')),
  input_quantity int,
  carton_size_at_time int,
  reference_type text,
  reference_id uuid,
  reason text,
  notes text,
  entered_by text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  sale_number text unique not null,
  business_date date not null,
  payment_method text not null check (payment_method in ('cash', 'qr', 'complimentary')),
  status text not null default 'completed' check (status in ('completed', 'voided')),
  total_amount numeric(12,2) not null,
  paid_amount numeric(12,2) not null,
  discount_amount numeric(12,2) not null default 0,
  order_taken_by text,
  complimentary_reason text,
  qr_reference text,
  qr_receipt_image_path text,
  qr_status text not null default 'not_applicable' check (qr_status in ('not_applicable', 'pending', 'verified', 'mismatch')),
  cashier_id uuid references auth.users(id),
  voided_by uuid references auth.users(id),
  void_reason text,
  voided_at timestamptz,
  idempotency_key text unique,
  created_at timestamptz not null default now()
);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid references public.sales(id),
  product_id uuid references public.products(id),
  custom_item_name text,
  quantity int not null check (quantity > 0),
  unit_price numeric(12,2) not null,
  line_total numeric(12,2) not null,
  created_at timestamptz not null default now()
);

create table public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  business_date date unique not null,
  opening_float numeric(12,2) not null default 0,
  actual_cash_counted numeric(12,2),
  expected_cash numeric(12,2),
  cash_variance numeric(12,2),
  opened_by uuid references auth.users(id),
  closed_by uuid references auth.users(id),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  status text not null default 'open' check (status in ('open', 'closed')),
  notes text
);

create table public.daily_reports (
  id uuid primary key default gen_random_uuid(),
  business_date date unique not null,
  report_json jsonb not null,
  total_cash numeric(12,2) not null default 0,
  total_qr numeric(12,2) not null default 0,
  total_complimentary_value numeric(12,2) not null default 0,
  total_sales numeric(12,2) not null default 0,
  actual_cash_counted numeric(12,2),
  expected_cash numeric(12,2),
  cash_variance numeric(12,2),
  closed_by uuid references auth.users(id),
  closed_at timestamptz not null default now(),
  reopened_by uuid references auth.users(id),
  reopened_at timestamptz,
  status text not null default 'closed' check (status in ('closed', 'reopened')),
  notes text
);

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id),
  action text not null,
  entity_type text,
  entity_id uuid,
  before_json jsonb,
  after_json jsonb,
  created_at timestamptz not null default now()
);

insert into storage.buckets (id, name, public)
values ('payment-receipts', 'payment-receipts', false)
on conflict (id) do nothing;

create index sales_business_date_idx on public.sales(business_date, created_at);
create index sale_items_sale_id_idx on public.sale_items(sale_id);
create index stock_movements_product_id_idx on public.stock_movements(product_id, created_at);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at before update on public.profiles
for each row execute function public.touch_updated_at();

create trigger products_touch_updated_at before update on public.products
for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Lovely Paradise Staff'),
    case
      when new.raw_user_meta_data->>'role' in ('cashier', 'manager', 'admin') then new.raw_user_meta_data->>'role'
      else 'admin'
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'admin')
$$;

create or replace function public.require_role(p_roles text[])
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be logged in.';
  end if;
  if public.current_user_role() <> all(p_roles) then
    raise exception 'Your role is not allowed to do this.';
  end if;
end;
$$;

create or replace function public.setting_text(p_key text, p_default text)
returns text
language sql
stable
set search_path = public
as $$
  select coalesce((select value #>> '{}' from public.app_settings where key = p_key), p_default)
$$;

create or replace function public.setting_bool(p_key text, p_default boolean)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce((select (value::text)::boolean from public.app_settings where key = p_key), p_default)
$$;

create or replace function public.get_business_date()
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  close_time time := public.setting_text('business_day_close_time', '05:00')::time;
  local_now timestamp := now() at time zone 'Asia/Kuala_Lumpur';
begin
  if local_now::time < close_time then
    return (local_now::date - 1);
  end if;
  return local_now::date;
end;
$$;

create or replace function public.next_sale_number(p_business_date date)
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  seq int;
begin
  select count(*) + 1 into seq from public.sales where business_date = p_business_date;
  return 'S-' || to_char(p_business_date, 'YYYYMMDD') || '-' || lpad(seq::text, 4, '0');
end;
$$;

create or replace function public.stock_in_product(
  p_product_id uuid,
  p_quantity int,
  p_unit text,
  p_cost_per_unit numeric default null,
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
  product_record public.products%rowtype;
  before_qty int;
  after_qty int;
  cans_to_add int;
begin
  perform public.require_role(array['manager', 'admin']);
  if p_quantity <= 0 then raise exception 'Quantity must be positive.'; end if;
  if p_unit not in ('can', 'carton') then raise exception 'Unit must be can or carton.'; end if;

  select * into product_record from public.products where id = p_product_id;
  if not found then raise exception 'Product not found.'; end if;

  cans_to_add := p_quantity * case when p_unit = 'carton' then product_record.carton_size else 1 end;

  insert into public.inventory_balances (product_id, quantity_on_hand)
  values (p_product_id, 0)
  on conflict (product_id) do nothing;

  select quantity_on_hand into before_qty
  from public.inventory_balances
  where product_id = p_product_id
  for update;

  after_qty := before_qty + cans_to_add;

  update public.inventory_balances
  set quantity_on_hand = after_qty, updated_at = now()
  where product_id = p_product_id;

  if p_cost_per_unit is not null then
    update public.products set cost_per_unit = p_cost_per_unit where id = p_product_id;
  end if;

  insert into public.stock_movements (
    product_id, movement_type, quantity_change, quantity_before, quantity_after,
    unit_input, input_quantity, carton_size_at_time, reference_type, reason, notes, entered_by, created_by
  )
  values (
    p_product_id, 'stock_in', cans_to_add, before_qty, after_qty,
    p_unit, p_quantity, product_record.carton_size, 'stock_in',
    nullif(concat_ws(' / ', p_supplier, p_reference), ''), p_notes, p_entered_by, auth.uid()
  );

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, after_json)
  values (auth.uid(), 'stock_in_product', 'product', p_product_id, jsonb_build_object('quantity_added', cans_to_add, 'quantity_on_hand', after_qty));

  return jsonb_build_object('product_id', p_product_id, 'quantity_added', cans_to_add, 'quantity_on_hand', after_qty);
end;
$$;

create or replace function public.stock_in_products(p_entries jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  entry jsonb;
  result jsonb;
  results jsonb := '[]'::jsonb;
begin
  perform public.require_role(array['manager', 'admin']);

  if jsonb_typeof(p_entries) <> 'array' then
    raise exception 'Stock-in entries must be an array.';
  end if;

  if jsonb_array_length(p_entries) = 0 then
    raise exception 'Add at least one stock-in item.';
  end if;

  for entry in select value from jsonb_array_elements(p_entries)
  loop
    result := public.stock_in_product(
      (entry->>'product_id')::uuid,
      (entry->>'quantity')::int,
      entry->>'unit',
      nullif(entry->>'cost_per_unit', '')::numeric,
      entry->>'supplier',
      entry->>'reference',
      entry->>'notes',
      entry->>'entered_by'
    );
    results := results || jsonb_build_array(result);
  end loop;

  return results;
end;
$$;

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
  total numeric(12,2) := 0;
  subtotal numeric(12,2) := 0;
  paid numeric(12,2) := 0;
  item record;
  product_record public.products%rowtype;
  before_qty int;
  after_qty int;
  updated_stock jsonb := '[]'::jsonb;
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

  create temporary table tmp_sale_items(product_id uuid, item_name text, quantity int not null, custom_price numeric(12,2)) on commit drop;
  insert into tmp_sale_items(product_id, item_name, quantity, custom_price)
  select nullif(value->>'product_id', '')::uuid, nullif(value->>'name', ''), sum((value->>'quantity')::int), max(nullif(value->>'custom_price', '')::numeric)
  from jsonb_array_elements(p_items)
  group by nullif(value->>'product_id', '')::uuid, nullif(value->>'name', '');

  if exists(select 1 from tmp_sale_items where quantity <= 0) then
    raise exception 'Item quantities must be positive.';
  end if;

  insert into public.inventory_balances(product_id, quantity_on_hand)
  select product_id, 0 from tmp_sale_items where product_id is not null
  on conflict (product_id) do nothing;

  perform 1
  from public.inventory_balances
  where product_id in (select product_id from tmp_sale_items where product_id is not null)
  order by product_id
  for update;

  business_date := public.get_business_date();
  perform pg_advisory_xact_lock(hashtext('sale-number-' || business_date::text));
  sale_no := public.next_sale_number(business_date);

  for item in select * from tmp_sale_items loop
    if item.product_id is null then
      if item.custom_price is null or item.custom_price <= 0 then
        raise exception 'Custom order price is required.';
      end if;
      subtotal := subtotal + (item.custom_price * item.quantity);
    else
      select * into product_record from public.products where id = item.product_id and active = true;
      if not found then raise exception 'Product is inactive or missing.'; end if;
      select quantity_on_hand into before_qty from public.inventory_balances where product_id = item.product_id;
      if not allow_negative and before_qty < item.quantity then
        raise exception 'Insufficient stock for %.', product_record.name;
      end if;
      subtotal := subtotal + (product_record.price_per_unit * item.quantity);
    end if;
  end loop;

  if coalesce(p_discount_amount, 0) < 0 or coalesce(p_discount_amount, 0) > subtotal then
    raise exception 'Invalid discount amount.';
  end if;

  total := subtotal - coalesce(p_discount_amount, 0);

  paid := case when p_payment_method = 'complimentary' then 0 else total end;

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

  for item in select * from tmp_sale_items loop
    if item.product_id is null then
      insert into public.sale_items(sale_id, product_id, custom_item_name, quantity, unit_price, line_total)
      values (sale_id, null, coalesce(item.item_name, 'Custom Order'), item.quantity, item.custom_price, item.custom_price * item.quantity);
    else
      select * into product_record from public.products where id = item.product_id;
      insert into public.sale_items(sale_id, product_id, custom_item_name, quantity, unit_price, line_total)
      values (sale_id, item.product_id, null, item.quantity, product_record.price_per_unit, product_record.price_per_unit * item.quantity);

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
    end if;
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

create or replace function public.void_sale(p_sale_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_record public.sales%rowtype;
  item record;
  before_qty int;
  after_qty int;
begin
  perform public.require_role(array['manager', 'admin']);
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Void reason is required.'; end if;

  select * into sale_record from public.sales where id = p_sale_id for update;
  if not found then raise exception 'Sale not found.'; end if;
  if sale_record.status = 'voided' then raise exception 'Sale is already voided.'; end if;

  perform 1
  from public.inventory_balances
  where product_id in (select product_id from public.sale_items where sale_id = p_sale_id)
  order by product_id
  for update;

  update public.sales
  set status = 'voided', voided_by = auth.uid(), void_reason = p_reason, voided_at = now()
  where id = p_sale_id;

  for item in
    select si.*, p.carton_size from public.sale_items si join public.products p on p.id = si.product_id where si.sale_id = p_sale_id
  loop
    select quantity_on_hand into before_qty from public.inventory_balances where product_id = item.product_id;
    after_qty := before_qty + item.quantity;
    update public.inventory_balances set quantity_on_hand = after_qty, updated_at = now() where product_id = item.product_id;
    insert into public.stock_movements(
      product_id, movement_type, quantity_change, quantity_before, quantity_after,
      unit_input, input_quantity, carton_size_at_time, reference_type, reference_id, reason, created_by
    )
    values (item.product_id, 'void_sale', item.quantity, before_qty, after_qty, 'system', item.quantity, item.carton_size, 'sale', p_sale_id, p_reason, auth.uid());
  end loop;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, before_json, after_json)
  values (auth.uid(), 'void_sale', 'sale', p_sale_id, to_jsonb(sale_record), jsonb_build_object('status', 'voided', 'reason', p_reason));

  return (select to_jsonb(s) from public.sales s where s.id = p_sale_id);
end;
$$;

create or replace function public.verify_qr_payment(p_sale_id uuid, p_status text, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  before_sale public.sales%rowtype;
begin
  perform public.require_role(array['manager', 'admin']);
  if p_status not in ('verified', 'mismatch') then raise exception 'QR status must be verified or mismatch.'; end if;
  select * into before_sale from public.sales where id = p_sale_id for update;
  if not found then raise exception 'Sale not found.'; end if;
  if before_sale.payment_method <> 'qr' then raise exception 'Only QR sales can be verified.'; end if;

  update public.sales set qr_status = p_status where id = p_sale_id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, before_json, after_json)
  values (auth.uid(), 'verify_qr_payment', 'sale', p_sale_id, to_jsonb(before_sale), jsonb_build_object('qr_status', p_status, 'notes', p_notes));

  return (select to_jsonb(s) from public.sales s where s.id = p_sale_id);
end;
$$;

create or replace function public.close_daily_report(
  p_business_date date,
  p_actual_cash_counted numeric,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.daily_reports%rowtype;
  report jsonb;
  total_cash numeric(12,2);
  total_qr numeric(12,2);
  total_comp numeric(12,2);
  total_sales numeric(12,2);
  v_opening_float numeric(12,2);
  v_expected_cash numeric(12,2);
  variance numeric(12,2);
  report_id uuid;
begin
  perform public.require_role(array['manager', 'admin']);
  select * into existing from public.daily_reports where business_date = p_business_date for update;
  if found and existing.status = 'closed' then
    raise exception 'Daily report is already closed.';
  end if;
  if exists (
    select 1 from public.sales
    where business_date = p_business_date
      and status = 'completed'
      and payment_method = 'qr'
      and qr_status = 'pending'
  ) then
    raise exception 'Cannot close daily report while QR payments are pending.';
  end if;

  select coalesce(sum(paid_amount) filter (where payment_method = 'cash' and status = 'completed'), 0),
         coalesce(sum(paid_amount) filter (where payment_method = 'qr' and status = 'completed'), 0),
         coalesce(sum(total_amount) filter (where payment_method = 'complimentary' and status = 'completed'), 0),
         coalesce(sum(paid_amount) filter (where payment_method in ('cash', 'qr') and status = 'completed'), 0)
  into total_cash, total_qr, total_comp, total_sales
  from public.sales
  where business_date = p_business_date;

  insert into public.cash_sessions(business_date, opening_float, opened_by)
  values (p_business_date, 0, auth.uid())
  on conflict (business_date) do nothing;

  select cs.opening_float into v_opening_float from public.cash_sessions cs where cs.business_date = p_business_date for update;
  v_expected_cash := v_opening_float + total_cash;
  variance := p_actual_cash_counted - v_expected_cash;

  report := jsonb_build_object(
    'business_date', p_business_date,
    'opening_cash_float', v_opening_float,
    'total_cash_sales', total_cash,
    'total_qr_payment_sales', total_qr,
    'total_complimentary_cost', total_comp,
    'paid_sales_value', total_sales,
    'number_of_transactions', (select count(*) from public.sales where business_date = p_business_date and status = 'completed'),
    'voided_sales', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.sales s where business_date = p_business_date and status = 'voided'),
    'qr_pending_total', (select coalesce(sum(paid_amount),0) from public.sales where business_date = p_business_date and payment_method = 'qr' and qr_status = 'pending' and status = 'completed'),
    'qr_verified_total', (select coalesce(sum(paid_amount),0) from public.sales where business_date = p_business_date and payment_method = 'qr' and qr_status = 'verified' and status = 'completed'),
    'sales_by_product', (
      select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
      from (
        select p.name,
               sum(si.quantity) quantity,
               coalesce(sum(si.line_total) filter (where s.payment_method = 'cash'), 0) cash,
               coalesce(sum(si.line_total) filter (where s.payment_method = 'qr'), 0) qr,
               coalesce(sum(si.line_total) filter (where s.payment_method = 'complimentary'), 0) foc_cost,
               coalesce(sum(si.line_total) filter (where s.payment_method in ('cash', 'qr')), 0) paid_sales
        from public.sale_items si join public.sales s on s.id = si.sale_id join public.products p on p.id = si.product_id
        where s.business_date = p_business_date and s.status = 'completed'
        group by p.name order by p.name
      ) x
    ),
    'sales_by_category', (
      select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
      from (
        select c.name,
               sum(si.quantity) quantity,
               coalesce(sum(si.line_total) filter (where s.payment_method = 'cash'), 0) cash,
               coalesce(sum(si.line_total) filter (where s.payment_method = 'qr'), 0) qr,
               coalesce(sum(si.line_total) filter (where s.payment_method = 'complimentary'), 0) foc_cost,
               coalesce(sum(si.line_total) filter (where s.payment_method in ('cash', 'qr')), 0) paid_sales
        from public.sale_items si
        join public.sales s on s.id = si.sale_id
        join public.products p on p.id = si.product_id
        left join public.categories c on c.id = p.category_id
        where s.business_date = p_business_date and s.status = 'completed'
        group by c.name order by c.name
      ) x
    ),
    'stock_in_summary', (
      select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
      from (
        select p.name, sum(sm.quantity_change) quantity
        from public.stock_movements sm join public.products p on p.id = sm.product_id
        where sm.movement_type = 'stock_in' and sm.created_at::date = p_business_date
        group by p.name order by p.name
      ) x
    ),
    'stock_movements', (select coalesce(jsonb_agg(to_jsonb(sm)), '[]'::jsonb) from public.stock_movements sm where sm.created_at::date = p_business_date),
    'opening_stock', (
      select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
      from (
        select p.name, ib.quantity_on_hand - coalesce(sum(sm.quantity_change) filter (where sm.created_at::date = p_business_date), 0) as quantity
        from public.products p
        left join public.inventory_balances ib on ib.product_id = p.id
        left join public.stock_movements sm on sm.product_id = p.id
        group by p.name, ib.quantity_on_hand
      ) x
    ),
    'closing_stock', (
      select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
      from (
        select p.name, coalesce(ib.quantity_on_hand, 0) quantity_on_hand
        from public.products p left join public.inventory_balances ib on ib.product_id = p.id
        order by p.name
      ) x
    ),
    'low_stock_items', (
      select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
      from (
        select p.name, coalesce(ib.quantity_on_hand,0) quantity_on_hand, p.low_stock_threshold
        from public.products p left join public.inventory_balances ib on ib.product_id = p.id
        where p.active and coalesce(ib.quantity_on_hand,0) <= p.low_stock_threshold
        order by p.name
      ) x
    ),
    'actual_cash_counted', p_actual_cash_counted,
    'expected_cash_in_drawer', v_expected_cash,
    'cash_variance', variance,
    'notes', p_notes
  );

  insert into public.daily_reports(
    business_date, report_json, total_cash, total_qr, total_complimentary_value, total_sales,
    actual_cash_counted, expected_cash, cash_variance, closed_by, notes, status
  )
  values (p_business_date, report, total_cash, total_qr, total_comp, total_sales, p_actual_cash_counted, v_expected_cash, variance, auth.uid(), p_notes, 'closed')
  on conflict (business_date) do update
    set report_json = excluded.report_json,
        total_cash = excluded.total_cash,
        total_qr = excluded.total_qr,
        total_complimentary_value = excluded.total_complimentary_value,
        total_sales = excluded.total_sales,
        actual_cash_counted = excluded.actual_cash_counted,
        expected_cash = excluded.expected_cash,
        cash_variance = excluded.cash_variance,
        closed_by = excluded.closed_by,
        closed_at = now(),
        notes = excluded.notes,
        status = 'closed'
    where public.daily_reports.status = 'reopened'
  returning id into report_id;

  update public.cash_sessions
  set actual_cash_counted = p_actual_cash_counted,
      expected_cash = v_expected_cash,
      cash_variance = variance,
      closed_by = auth.uid(),
      closed_at = now(),
      status = 'closed',
      notes = p_notes
  where business_date = p_business_date;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, after_json)
  values (auth.uid(), 'close_daily_report', 'daily_report', report_id, report);

  return (select to_jsonb(dr) from public.daily_reports dr where dr.business_date = p_business_date);
end;
$$;

create or replace function public.reopen_daily_report(p_business_date date, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  report_row public.daily_reports%rowtype;
begin
  perform public.require_role(array['admin']);

  update public.daily_reports
  set status = 'reopened',
      reopened_by = auth.uid(),
      reopened_at = now(),
      notes = coalesce(nullif(p_reason, ''), notes)
  where business_date = p_business_date
    and status = 'closed'
  returning * into report_row;

  if not found then
    raise exception 'No closed daily report found for this date.';
  end if;

  update public.cash_sessions
  set status = 'open', closed_by = null, closed_at = null
  where business_date = p_business_date;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, after_json)
  values (auth.uid(), 'reopen_daily_report', 'daily_report', report_row.id, jsonb_build_object('business_date', p_business_date, 'reason', p_reason));

  return to_jsonb(report_row);
end;
$$;

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.inventory_balances enable row level security;
alter table public.stock_movements enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.cash_sessions enable row level security;
alter table public.daily_reports enable row level security;
alter table public.app_settings enable row level security;
alter table public.audit_logs enable row level security;

create policy "profiles read self or admin" on public.profiles for select to authenticated using (id = auth.uid() or public.current_user_role() = 'admin');
create policy "profiles admin update" on public.profiles for update to authenticated using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy "categories read authenticated" on public.categories for select to authenticated using (true);
create policy "categories admin write" on public.categories for all to authenticated using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy "products read authenticated" on public.products for select to authenticated using (active or public.current_user_role() in ('manager','admin'));
create policy "products admin write" on public.products for all to authenticated using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy "inventory read authenticated" on public.inventory_balances for select to authenticated using (true);
create policy "stock movements manager read" on public.stock_movements for select to authenticated using (public.current_user_role() in ('manager','admin'));
create policy "sales manager read" on public.sales for select to authenticated using (public.current_user_role() in ('manager','admin') or cashier_id = auth.uid());
create policy "sale items read via sale" on public.sale_items for select to authenticated using (exists(select 1 from public.sales s where s.id = sale_id and (public.current_user_role() in ('manager','admin') or s.cashier_id = auth.uid())));
create policy "cash sessions manager read" on public.cash_sessions for select to authenticated using (public.current_user_role() in ('manager','admin'));
create policy "daily reports manager read" on public.daily_reports for select to authenticated using (public.current_user_role() in ('manager','admin'));
create policy "settings read authenticated" on public.app_settings for select to authenticated using (true);
create policy "settings admin write" on public.app_settings for all to authenticated using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy "audit admin read" on public.audit_logs for select to authenticated using (public.current_user_role() = 'admin');
create policy "payment receipt upload authenticated" on storage.objects for insert to authenticated with check (bucket_id = 'payment-receipts');
create policy "payment receipt read manager" on storage.objects for select to authenticated using (bucket_id = 'payment-receipts' and public.current_user_role() in ('manager','admin'));

grant usage on schema public to authenticated;
grant select on public.categories, public.products, public.inventory_balances, public.app_settings to authenticated;
grant select on public.profiles, public.sales, public.sale_items, public.stock_movements, public.daily_reports, public.cash_sessions to authenticated;
grant insert, update on public.categories, public.products, public.app_settings to authenticated;
grant update on public.profiles to authenticated;
revoke execute on function public.stock_in_product(uuid, int, text, numeric, text, text, text, text) from public, anon;
revoke execute on function public.stock_in_products(jsonb) from public, anon;
revoke execute on function public.complete_sale(jsonb, text, text, text, text, text, numeric, text) from public, anon;
revoke execute on function public.void_sale(uuid, text) from public, anon;
revoke execute on function public.verify_qr_payment(uuid, text, text) from public, anon;
revoke execute on function public.close_daily_report(date, numeric, text) from public, anon;
revoke execute on function public.reopen_daily_report(date, text) from public, anon;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.get_business_date() to authenticated;
grant execute on function public.stock_in_product(uuid, int, text, numeric, text, text, text, text) to authenticated;
grant execute on function public.stock_in_products(jsonb) to authenticated;
grant execute on function public.complete_sale(jsonb, text, text, text, text, text, numeric, text) to authenticated;
grant execute on function public.void_sale(uuid, text) to authenticated;
grant execute on function public.verify_qr_payment(uuid, text, text) to authenticated;
grant execute on function public.close_daily_report(date, numeric, text) to authenticated;
grant execute on function public.reopen_daily_report(date, text) to authenticated;
