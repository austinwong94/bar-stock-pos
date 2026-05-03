create extension if not exists pgcrypto;

alter table public.products add column if not exists image_url text;
alter table public.stock_movements add column if not exists entered_by text;
alter table public.sales add column if not exists discount_amount numeric(12,2) not null default 0;
alter table public.sales add column if not exists order_taken_by text;
alter table public.sales add column if not exists qr_payment_type text;
alter table public.sales add column if not exists qr_receipt_image_path text;
alter table public.sale_items add column if not exists custom_item_name text;

create or replace function public.get_business_date()
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  close_time time := public.setting_text('business_day_close_time', '00:00')::time;
  local_now timestamp := now() at time zone 'Asia/Kuala_Lumpur';
begin
  if local_now::time < close_time then
    return (local_now::date - 1);
  end if;
  return local_now::date;
end;
$$;

update public.sales
set business_date = (created_at at time zone 'Asia/Kuala_Lumpur')::date
where business_date is distinct from (created_at at time zone 'Asia/Kuala_Lumpur')::date;

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
  on conflict (id) do update
    set full_name = coalesce(public.profiles.full_name, excluded.full_name),
        role = case when public.profiles.role = 'cashier' then 'admin' else public.profiles.role end;
  return new;
end;
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'admin')
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

update public.categories
set name = 'Others', sort_order = 50
where name = 'Other';

insert into public.categories (name, sort_order)
values
  ('Beer', 10),
  ('Soft Drink', 20),
  ('Food', 30),
  ('Cocktail', 40),
  ('Others', 50)
on conflict (name) do update set sort_order = excluded.sort_order;

with seed_products(name, category_name, price_per_unit, carton_size, low_stock_threshold, active, image_url) as (
  values
    ('1602 Lager', 'Beer', 12::numeric, 24, 12, true, 'https://images.unsplash.com/photo-1608270586620-248524c67de9?auto=format&fit=crop&w=900&q=80'),
    ('1602 Pale Ale', 'Beer', 14::numeric, 24, 12, true, 'https://images.unsplash.com/photo-1571613316887-6f8d5cbf7ef7?auto=format&fit=crop&w=900&q=80'),
    ('1602 Extra Dark', 'Beer', 16::numeric, 24, 12, true, 'https://images.unsplash.com/photo-1584225064785-c62a8b43d148?auto=format&fit=crop&w=900&q=80'),
    ('Coke', 'Soft Drink', 5::numeric, 24, 12, true, 'https://images.unsplash.com/photo-1554866585-cd94860890b7?auto=format&fit=crop&w=900&q=80'),
    ('7Up', 'Soft Drink', 5::numeric, 24, 12, true, 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=900&q=80'),
    ('Fanta', 'Soft Drink', 5::numeric, 24, 12, true, 'https://images.unsplash.com/photo-1581636625402-29b2a704ef13?auto=format&fit=crop&w=900&q=80')
)
insert into public.products (name, category_id, price_per_unit, carton_size, low_stock_threshold, active, image_url)
select
  sp.name,
  c.id,
  sp.price_per_unit,
  sp.carton_size,
  sp.low_stock_threshold,
  sp.active,
  sp.image_url
from seed_products sp
join public.categories c on c.name = sp.category_name
where not exists (
  select 1 from public.products p where lower(p.name) = lower(sp.name)
);

with seed_products(name, category_name, price_per_unit, carton_size, low_stock_threshold, active, image_url) as (
  values
    ('1602 Lager', 'Beer', 12::numeric, 24, 12, true, 'https://images.unsplash.com/photo-1608270586620-248524c67de9?auto=format&fit=crop&w=900&q=80'),
    ('1602 Pale Ale', 'Beer', 14::numeric, 24, 12, true, 'https://images.unsplash.com/photo-1571613316887-6f8d5cbf7ef7?auto=format&fit=crop&w=900&q=80'),
    ('1602 Extra Dark', 'Beer', 16::numeric, 24, 12, true, 'https://images.unsplash.com/photo-1584225064785-c62a8b43d148?auto=format&fit=crop&w=900&q=80'),
    ('Coke', 'Soft Drink', 5::numeric, 24, 12, true, 'https://images.unsplash.com/photo-1554866585-cd94860890b7?auto=format&fit=crop&w=900&q=80'),
    ('7Up', 'Soft Drink', 5::numeric, 24, 12, true, 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=900&q=80'),
    ('Fanta', 'Soft Drink', 5::numeric, 24, 12, true, 'https://images.unsplash.com/photo-1581636625402-29b2a704ef13?auto=format&fit=crop&w=900&q=80')
)
update public.products p
set
  category_id = c.id,
  price_per_unit = sp.price_per_unit,
  carton_size = sp.carton_size,
  low_stock_threshold = sp.low_stock_threshold,
  active = sp.active,
  image_url = sp.image_url
from seed_products sp
join public.categories c on c.name = sp.category_name
where lower(p.name) = lower(sp.name);

insert into public.inventory_balances (product_id, quantity_on_hand)
select id, 0 from public.products
on conflict (product_id) do nothing;

insert into public.app_settings (key, value)
values
  ('business_name', '"Lovely Paradise Bar"'::jsonb),
  ('currency_symbol', '"MYR"'::jsonb),
  ('secondary_currency_symbol', '"RMB"'::jsonb),
  ('rmb_exchange_rate', '1.52'::jsonb),
  ('business_day_close_time', '"00:00"'::jsonb),
  ('default_carton_size', '24'::jsonb),
  ('allow_negative_stock', 'false'::jsonb),
  ('require_qr_reference', 'false'::jsonb),
  ('require_manager_approval_for_complimentary', 'false'::jsonb),
  ('staff_names', '"Chloe, Happy, Elle, NekoMiao"'::jsonb),
  ('receipt_footer_text', '""'::jsonb)
on conflict (key) do update set value = excluded.value;

alter table public.sales drop constraint if exists sales_qr_payment_type_check;
alter table public.sales
  add constraint sales_qr_payment_type_check
  check (
    qr_payment_type is null
    or qr_payment_type in ('WeChat Pay', 'AliPay', 'TnGo', 'Grab', 'Others')
  );

create or replace function public.complete_sale_with_qr_type(
  p_items jsonb,
  p_payment_method text,
  p_qr_reference text default null,
  p_complimentary_reason text default null,
  p_idempotency_key text default null,
  p_qr_receipt_image_path text default null,
  p_discount_amount numeric default 0,
  p_order_taken_by text default null,
  p_qr_payment_type text default null
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
    p_order_taken_by
  );

  sale_id := (result->>'sale_id')::uuid;

  update public.sales
  set qr_payment_type = p_qr_payment_type
  where id = sale_id;

  return result || jsonb_build_object('qr_payment_type', p_qr_payment_type);
end;
$$;

grant usage on schema public to authenticated;
grant select on public.categories, public.products, public.inventory_balances, public.app_settings to authenticated;
grant select on public.profiles, public.sales, public.sale_items, public.stock_movements, public.daily_reports, public.cash_sessions to authenticated;
grant insert, update on public.categories, public.products, public.app_settings to authenticated;
grant update on public.profiles to authenticated;
grant execute on function public.current_user_role() to authenticated;
revoke execute on function public.stock_in_products(jsonb) from public, anon;
grant execute on function public.stock_in_products(jsonb) to authenticated;
revoke execute on function public.complete_sale_with_qr_type(jsonb, text, text, text, text, text, numeric, text, text) from public, anon;
grant execute on function public.complete_sale_with_qr_type(jsonb, text, text, text, text, text, numeric, text, text) to authenticated;

select 'categories' as table_name, count(*) as rows from public.categories
union all
select 'products', count(*) from public.products
union all
select 'inventory_balances', count(*) from public.inventory_balances
union all
select 'app_settings', count(*) from public.app_settings;
