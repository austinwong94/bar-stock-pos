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

with category_ids as (
  select name, id from public.categories
)
insert into public.products (name, category_id, price_per_unit, carton_size, low_stock_threshold, active, image_url)
select *
from (
  values
    ('1602 Lager', (select id from category_ids where name = 'Beer'), 0::numeric, 24, 12, true, 'https://images.unsplash.com/photo-1608270586620-248524c67de9?auto=format&fit=crop&w=900&q=80'),
    ('1602 Pale Ale', (select id from category_ids where name = 'Beer'), 0::numeric, 24, 12, true, 'https://images.unsplash.com/photo-1571613316887-6f8d5cbf7ef7?auto=format&fit=crop&w=900&q=80'),
    ('1602 Extra Dark', (select id from category_ids where name = 'Beer'), 0::numeric, 24, 12, true, 'https://images.unsplash.com/photo-1584225064785-c62a8b43d148?auto=format&fit=crop&w=900&q=80'),
    ('Coke', (select id from category_ids where name = 'Soft Drink'), 0::numeric, 24, 12, true, 'https://images.unsplash.com/photo-1554866585-cd94860890b7?auto=format&fit=crop&w=900&q=80'),
    ('7Up', (select id from category_ids where name = 'Soft Drink'), 0::numeric, 24, 12, true, 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=900&q=80'),
    ('Fanta', (select id from category_ids where name = 'Soft Drink'), 0::numeric, 24, 12, true, 'https://images.unsplash.com/photo-1581636625402-29b2a704ef13?auto=format&fit=crop&w=900&q=80')
) as seed_products(name, category_id, price_per_unit, carton_size, low_stock_threshold, active, image_url)
where not exists (
  select 1 from public.products p where lower(p.name) = lower(seed_products.name)
);

insert into public.inventory_balances (product_id, quantity_on_hand)
select id, 0 from public.products
on conflict (product_id) do nothing;

insert into public.app_settings (key, value)
values
  ('business_name', '"Lovely Paradise Bar"'::jsonb),
  ('currency_symbol', '"MYR"'::jsonb),
  ('secondary_currency_symbol', '"RMB"'::jsonb),
  ('rmb_exchange_rate', '1.52'::jsonb),
  ('business_day_close_time', '"05:00"'::jsonb),
  ('default_carton_size', '24'::jsonb),
  ('allow_negative_stock', 'false'::jsonb),
  ('require_qr_reference', 'false'::jsonb),
  ('require_manager_approval_for_complimentary', 'false'::jsonb),
  ('staff_names', '"Chloe, Happy, Elle, NekoMiao"'::jsonb),
  ('receipt_footer_text', '""'::jsonb)
on conflict (key) do update set value = excluded.value;
