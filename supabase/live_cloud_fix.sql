create extension if not exists pgcrypto;

alter table public.products add column if not exists image_url text;
alter table public.stock_movements add column if not exists entered_by text;
alter table public.sales add column if not exists discount_amount numeric(12,2) not null default 0;
alter table public.sales add column if not exists order_taken_by text;
alter table public.sales add column if not exists qr_payment_type text;
alter table public.sales add column if not exists qr_receipt_image_path text;
alter table public.sale_items add column if not exists custom_item_name text;

alter table public.profiles
  add column if not exists app_access_granted boolean not null default false,
  add column if not exists app_access_granted_at timestamptz,
  add column if not exists admin_access_expires_at timestamptz;

create table if not exists public.product_price_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  product_name text not null,
  old_price_per_unit numeric(12,2),
  new_price_per_unit numeric(12,2),
  old_cost_per_unit numeric(12,2),
  new_cost_per_unit numeric(12,2),
  changed_by uuid references public.profiles(id),
  changed_at timestamptz not null default now()
);

create index if not exists product_price_history_product_changed_idx
on public.product_price_history(product_id, changed_at desc);

create or replace function public.record_product_price_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.price_per_unit is distinct from new.price_per_unit
     or old.cost_per_unit is distinct from new.cost_per_unit then
    insert into public.product_price_history(
      product_id,
      product_name,
      old_price_per_unit,
      new_price_per_unit,
      old_cost_per_unit,
      new_cost_per_unit,
      changed_by
    )
    values (
      new.id,
      new.name,
      old.price_per_unit,
      new.price_per_unit,
      old.cost_per_unit,
      new.cost_per_unit,
      auth.uid()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists products_record_price_change on public.products;
create trigger products_record_price_change
after update of price_per_unit, cost_per_unit on public.products
for each row execute function public.record_product_price_change();

alter table public.product_price_history enable row level security;

drop policy if exists "product price history admin read" on public.product_price_history;
create policy "product price history admin read"
on public.product_price_history
for select
to authenticated
using (public.current_user_role() = 'admin');

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

-- Align sales, stock activity, saved closing snapshots, and PDFs on the same business-date rule.
create or replace function public.business_date_for_timestamp(p_created_at timestamptz)
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  close_time time := public.setting_text('business_day_close_time', '00:00')::time;
  local_created_at timestamp := p_created_at at time zone 'Asia/Kuala_Lumpur';
begin
  if local_created_at::time < close_time then
    return (local_created_at::date - 1);
  end if;
  return local_created_at::date;
end;
$$;

update public.sales
set business_date = public.business_date_for_timestamp(created_at)
where business_date is distinct from public.business_date_for_timestamp(created_at)
  and not exists (
    select 1 from public.daily_reports dr
    where dr.business_date = public.sales.business_date
      and dr.status = 'closed'
  );


-- Repair older access-code sessions that were accidentally promoted to admin.
update public.profiles
set role = 'manager', admin_access_expires_at = null, updated_at = now()
where role = 'admin'
  and app_access_granted = true
  and coalesce(full_name, 'Lovely Paradise Staff') = 'Lovely Paradise Staff';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role, app_access_granted, app_access_granted_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Lovely Paradise Staff'),
    case
      when new.raw_user_meta_data->>'role' in ('cashier', 'manager', 'admin') then new.raw_user_meta_data->>'role'
      else 'cashier'
    end,
    false,
    null
  )
  on conflict (id) do update
    set full_name = coalesce(public.profiles.full_name, excluded.full_name);
  return new;
end;
$$;


drop trigger if exists on_auth_user_created on auth.users;
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
  select coalesce((
    select case
      when not app_access_granted then 'locked'
      when role = 'admin' and coalesce(admin_access_expires_at, 'infinity'::timestamptz) > now() then 'admin'
      when role = 'admin' then 'manager'
      else role
    end
    from public.profiles
    where id = auth.uid()
  ), 'locked')
$$;

create or replace function public.verify_app_access(p_access_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_hash constant text := '615ed7fb1504b0c724a296d7a69e6c7b2f9ea2c57c1d8206c5afdf392ebdfd25';
  profile_row public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Cloud session is not ready. Try entering the access code again.';
  end if;

  if encode(digest(coalesce(p_access_code, ''), 'sha256'), 'hex') <> expected_hash then
    raise exception 'Wrong access code.';
  end if;

  insert into public.profiles (id, full_name, role, app_access_granted, app_access_granted_at)
  values (auth.uid(), 'Lovely Paradise Staff', 'manager', true, now())
  on conflict (id) do update
    set role = case when public.profiles.role = 'admin' then 'admin' else 'manager' end,
        app_access_granted = true,
        app_access_granted_at = now(),
        updated_at = now()
  returning * into profile_row;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, after_json)
  values (auth.uid(), 'verify_app_access', 'profile', auth.uid(), jsonb_build_object('app_access_granted', true, 'role', profile_row.role));

  return to_jsonb(profile_row);
end;
$$;


create or replace function public.verify_admin_access(p_admin_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_hash constant text := '90727dcc85c0513b949e872edf5434fe14e7a8a17f64fdb3271d721e73d74911';
  profile_row public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Cloud session is not ready. Enter the website access code first.';
  end if;

  if encode(digest(coalesce(p_admin_password, ''), 'sha256'), 'hex') <> expected_hash then
    raise exception 'Wrong admin password.';
  end if;

  insert into public.profiles (id, full_name, role, app_access_granted, app_access_granted_at, admin_access_expires_at)
  values (auth.uid(), 'Lovely Paradise Staff', 'admin', true, now(), now() + interval '2 hours')
  on conflict (id) do update
    set role = 'admin',
        app_access_granted = true,
        app_access_granted_at = coalesce(public.profiles.app_access_granted_at, now()),
        admin_access_expires_at = now() + interval '2 hours',
        updated_at = now()
  returning * into profile_row;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, after_json)
  values (auth.uid(), 'verify_admin_access', 'profile', auth.uid(), jsonb_build_object('role', 'admin', 'expires_at', profile_row.admin_access_expires_at));

  return to_jsonb(profile_row);
end;
$$;

drop function if exists public.stock_in_product(uuid, int, text, numeric, text, text, text);

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

-- Do not update existing products here. Live repair SQL must never overwrite
-- real product prices, images, active status, categories, or low-stock settings.
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
on conflict (key) do nothing;

-- Earlier builds seeded 05:00. Move only that old default to calendar-day
-- reporting so May 4 entries do not appear under May 3. Custom times are left alone.
update public.app_settings
set value = '"00:00"'::jsonb,
    updated_at = now()
where key = 'business_day_close_time'
  and value = '"05:00"'::jsonb;

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

  if p_business_date is null then
    raise exception 'Business date is required.';
  end if;

  if p_actual_cash_counted is null or p_actual_cash_counted < 0 then
    raise exception 'Actual cash counted must be 0 or more.';
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
    'qr_mismatch_total', (select coalesce(sum(paid_amount),0) from public.sales where business_date = p_business_date and payment_method = 'qr' and qr_status = 'mismatch' and status = 'completed'),
    'sales_by_product', (
      select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
      from (
        with item_values as (
          select coalesce(p.name, si.custom_item_name, 'Custom Order') as name,
                 si.quantity,
                 s.payment_method,
                 case
                   when sum(si.line_total) over (partition by s.id) > 0
                   then (si.line_total / sum(si.line_total) over (partition by s.id)) * s.total_amount
                   else 0
                 end as adjusted_total,
                 case
                   when sum(si.line_total) over (partition by s.id) > 0
                   then (si.line_total / sum(si.line_total) over (partition by s.id)) * coalesce(s.discount_amount, 0)
                   else 0
                 end as discount_allocated
          from public.sale_items si
          join public.sales s on s.id = si.sale_id
          left join public.products p on p.id = si.product_id
          where s.business_date = p_business_date and s.status = 'completed'
        )
        select name,
               sum(quantity) quantity,
               coalesce(sum(adjusted_total) filter (where payment_method = 'cash'), 0)::numeric(12,2) cash,
               coalesce(sum(adjusted_total) filter (where payment_method = 'qr'), 0)::numeric(12,2) qr,
               coalesce(sum(adjusted_total) filter (where payment_method = 'complimentary'), 0)::numeric(12,2) foc_cost,
               coalesce(sum(discount_allocated), 0)::numeric(12,2) discount,
               coalesce(sum(adjusted_total) filter (where payment_method in ('cash', 'qr')), 0)::numeric(12,2) paid_sales
        from item_values
        group by name order by name
      ) x
    ),
    'sales_by_category', (
      select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
      from (
        with item_values as (
          select coalesce(c.name, 'Others') as name,
                 si.quantity,
                 s.payment_method,
                 case
                   when sum(si.line_total) over (partition by s.id) > 0
                   then (si.line_total / sum(si.line_total) over (partition by s.id)) * s.total_amount
                   else 0
                 end as adjusted_total,
                 case
                   when sum(si.line_total) over (partition by s.id) > 0
                   then (si.line_total / sum(si.line_total) over (partition by s.id)) * coalesce(s.discount_amount, 0)
                   else 0
                 end as discount_allocated
          from public.sale_items si
          join public.sales s on s.id = si.sale_id
          left join public.products p on p.id = si.product_id
          left join public.categories c on c.id = p.category_id
          where s.business_date = p_business_date and s.status = 'completed'
        )
        select name,
               sum(quantity) quantity,
               coalesce(sum(adjusted_total) filter (where payment_method = 'cash'), 0)::numeric(12,2) cash,
               coalesce(sum(adjusted_total) filter (where payment_method = 'qr'), 0)::numeric(12,2) qr,
               coalesce(sum(adjusted_total) filter (where payment_method = 'complimentary'), 0)::numeric(12,2) foc_cost,
               coalesce(sum(discount_allocated), 0)::numeric(12,2) discount,
               coalesce(sum(adjusted_total) filter (where payment_method in ('cash', 'qr')), 0)::numeric(12,2) paid_sales
        from item_values
        group by name order by name
      ) x
    ),
    'stock_in_summary', (
      select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
      from (
        select p.name, sum(sm.quantity_change) quantity
        from public.stock_movements sm join public.products p on p.id = sm.product_id
        where sm.movement_type = 'stock_in'
          and public.business_date_for_timestamp(sm.created_at) = p_business_date
        group by p.name order by p.name
      ) x
    ),
    'stock_movements', (
      select coalesce(jsonb_agg(to_jsonb(sm)), '[]'::jsonb)
      from public.stock_movements sm
      where public.business_date_for_timestamp(sm.created_at) = p_business_date
    ),
    'opening_stock', (
      select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
      from (
        with stock_as_of as (
          select p.id,
                 p.name,
                 coalesce(ib.quantity_on_hand, 0)
                   - coalesce(sum(sm.quantity_change) filter (where public.business_date_for_timestamp(sm.created_at) > p_business_date), 0) as closing_quantity,
                 coalesce(sum(sm.quantity_change) filter (where public.business_date_for_timestamp(sm.created_at) = p_business_date), 0) as day_change
          from public.products p
          left join public.inventory_balances ib on ib.product_id = p.id
          left join public.stock_movements sm on sm.product_id = p.id
          group by p.id, p.name, ib.quantity_on_hand
        )
        select name, closing_quantity - day_change as quantity
        from stock_as_of
        order by name
      ) x
    ),
    'closing_stock', (
      select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
      from (
        with stock_as_of as (
          select p.id,
                 p.name,
                 coalesce(ib.quantity_on_hand, 0)
                   - coalesce(sum(sm.quantity_change) filter (where public.business_date_for_timestamp(sm.created_at) > p_business_date), 0) as quantity_on_hand
          from public.products p
          left join public.inventory_balances ib on ib.product_id = p.id
          left join public.stock_movements sm on sm.product_id = p.id
          group by p.id, p.name, ib.quantity_on_hand
        )
        select name, quantity_on_hand
        from stock_as_of
        order by name
      ) x
    ),
    'low_stock_items', (
      select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
      from (
        with stock_as_of as (
          select p.id,
                 p.name,
                 p.active,
                 p.low_stock_threshold,
                 coalesce(ib.quantity_on_hand, 0)
                   - coalesce(sum(sm.quantity_change) filter (where public.business_date_for_timestamp(sm.created_at) > p_business_date), 0) as quantity_on_hand
          from public.products p
          left join public.inventory_balances ib on ib.product_id = p.id
          left join public.stock_movements sm on sm.product_id = p.id
          group by p.id, p.name, p.active, p.low_stock_threshold, ib.quantity_on_hand
        )
        select name, quantity_on_hand, low_stock_threshold
        from stock_as_of
        where active and quantity_on_hand <= low_stock_threshold
        order by name
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

revoke execute on function public.close_daily_report(date, numeric, text) from public, anon;
grant execute on function public.close_daily_report(date, numeric, text) to authenticated;


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
  if p_payment_method = 'qr' and nullif(trim(coalesce(p_qr_receipt_image_path, '')), '') is null then
    raise exception 'QR receipt photo is required.';
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
grant select on public.profiles, public.sales, public.sale_items, public.stock_movements, public.daily_reports, public.cash_sessions, public.product_price_history, public.audit_logs to authenticated;
grant insert, update on public.categories, public.products, public.app_settings to authenticated;
grant update on public.profiles to authenticated;
grant execute on function public.current_user_role() to authenticated;

insert into storage.buckets (id, name, public)
values ('payment-receipts', 'payment-receipts', false)
on conflict (id) do update set public = false;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  4194304,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = true,
    file_size_limit = 4194304,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

drop policy if exists "product image read public" on storage.objects;
create policy "product image read public" on storage.objects
for select to anon, authenticated
using (bucket_id = 'product-images');

drop policy if exists "product image admin upload" on storage.objects;
create policy "product image admin upload" on storage.objects
for insert to authenticated
with check (bucket_id = 'product-images' and public.current_user_role() = 'admin');

drop policy if exists "product image admin update" on storage.objects;
create policy "product image admin update" on storage.objects
for update to authenticated
using (bucket_id = 'product-images' and public.current_user_role() = 'admin')
with check (bucket_id = 'product-images' and public.current_user_role() = 'admin');

drop policy if exists "product image admin delete" on storage.objects;
create policy "product image admin delete" on storage.objects
for delete to authenticated
using (bucket_id = 'product-images' and public.current_user_role() = 'admin');

-- Keep cloud data behind the verified app access role, not just anonymous Auth.
drop policy if exists "categories read authenticated" on public.categories;
create policy "categories read authenticated" on public.categories
for select to authenticated
using (public.current_user_role() in ('cashier', 'manager', 'admin'));

drop policy if exists "products read authenticated" on public.products;
create policy "products read authenticated" on public.products
for select to authenticated
using (public.current_user_role() in ('cashier', 'manager', 'admin'));

drop policy if exists "inventory read authenticated" on public.inventory_balances;
create policy "inventory read authenticated" on public.inventory_balances
for select to authenticated
using (public.current_user_role() in ('cashier', 'manager', 'admin'));

drop policy if exists "settings read authenticated" on public.app_settings;
create policy "settings read authenticated" on public.app_settings
for select to authenticated
using (public.current_user_role() in ('cashier', 'manager', 'admin'));

drop policy if exists "profiles admin update" on public.profiles;
create policy "profiles admin update" on public.profiles
for update to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

drop policy if exists "categories admin write" on public.categories;
create policy "categories admin write" on public.categories
for all to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

drop policy if exists "products admin write" on public.products;
create policy "products admin write" on public.products
for all to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

drop policy if exists "settings admin write" on public.app_settings;
create policy "settings admin write" on public.app_settings
for all to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

drop policy if exists "audit admin read" on public.audit_logs;
create policy "audit admin read" on public.audit_logs
for select to authenticated
using (public.current_user_role() = 'admin');

drop policy if exists "payment receipt upload authenticated" on storage.objects;
create policy "payment receipt upload authenticated" on storage.objects
for insert to authenticated
with check (bucket_id = 'payment-receipts' and public.current_user_role() in ('cashier', 'manager', 'admin'));

drop policy if exists "payment receipt read manager" on storage.objects;
create policy "payment receipt read manager" on storage.objects
for select to authenticated
using (bucket_id = 'payment-receipts' and public.current_user_role() in ('manager', 'admin'));

drop policy if exists "payment receipt delete own upload" on storage.objects;
create policy "payment receipt delete own upload" on storage.objects
for delete to authenticated
using (bucket_id = 'payment-receipts' and owner = auth.uid());

revoke execute on function public.verify_app_access(text) from public, anon;
revoke execute on function public.verify_admin_access(text) from public, anon;
grant execute on function public.verify_app_access(text) to authenticated;
grant execute on function public.verify_admin_access(text) to authenticated;
revoke execute on function public.stock_in_product(uuid, int, text, numeric, text, text, text, text) from public, anon;
revoke execute on function public.stock_in_products(jsonb) from public, anon;
grant execute on function public.stock_in_product(uuid, int, text, numeric, text, text, text, text) to authenticated;
grant execute on function public.stock_in_products(jsonb) to authenticated;
revoke execute on function public.complete_sale(jsonb, text, text, text, text, text, numeric, text) from public, anon;
revoke execute on function public.complete_sale_with_qr_type(jsonb, text, text, text, text, text, numeric, text, text) from public, anon;
grant execute on function public.complete_sale(jsonb, text, text, text, text, text, numeric, text) to authenticated;
grant execute on function public.complete_sale_with_qr_type(jsonb, text, text, text, text, text, numeric, text, text) to authenticated;

select 'categories' as table_name, count(*) as rows from public.categories
union all
select 'products', count(*) from public.products
union all
select 'inventory_balances', count(*) from public.inventory_balances
union all
select 'app_settings', count(*) from public.app_settings;

-- Generated account report archives for Daily / Weekly / Monthly / Annual reports.
-- The cron schedule is 16:00 UTC, which is 00:00 Asia/Kuala_Lumpur the next day.

create table if not exists public.account_report_archives (
  id uuid primary key default gen_random_uuid(),
  report_kind text not null check (report_kind in ('daily', 'weekly', 'monthly', 'annual')),
  period_start date not null,
  period_end date not null,
  title text not null,
  file_name text not null,
  report_json jsonb not null,
  generated_by uuid references auth.users(id),
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (report_kind, period_start, period_end),
  check (period_start <= period_end)
);

alter table public.account_report_archives enable row level security;

drop policy if exists "account report archives manager read" on public.account_report_archives;
create policy "account report archives manager read" on public.account_report_archives
for select to authenticated
using (public.current_user_role() in ('manager', 'admin'));

create or replace function public.account_report_archive_file_name(
  p_report_kind text,
  p_period_start date,
  p_period_end date
)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  date_part text;
begin
  if p_report_kind = 'monthly' then
    date_part := to_char(p_period_start, 'YYYY-MM');
  elsif p_report_kind = 'annual' then
    date_part := to_char(p_period_start, 'YYYY');
  elsif p_period_start = p_period_end then
    date_part := to_char(p_period_start, 'YYYY-MM-DD');
  else
    date_part := to_char(p_period_start, 'YYYY-MM-DD') || '_to_' || to_char(p_period_end, 'YYYY-MM-DD');
  end if;

  return 'lovely-paradise-bar_' || p_report_kind || '_account-report_' || date_part || '.pdf';
end;
$$;

create or replace function public.generate_account_report_archive(
  p_report_kind text,
  p_period_start date,
  p_period_end date
)
returns public.account_report_archives
language plpgsql
security definer
set search_path = public
as $$
declare
  snapshot jsonb;
  result_row public.account_report_archives%rowtype;
  report_title text;
  report_file_name text;
begin
  if p_report_kind not in ('daily', 'weekly', 'monthly', 'annual') then
    raise exception 'Report kind must be daily, weekly, monthly, or annual.';
  end if;

  if p_period_start is null or p_period_end is null or p_period_start > p_period_end then
    raise exception 'Report period is invalid.';
  end if;

  if auth.uid() is not null and public.current_user_role() not in ('manager', 'admin') then
    raise exception 'Manager or admin permission is required.';
  end if;

  report_title := 'Lovely Paradise Bar ' || initcap(p_report_kind) || ' Account Report ' ||
    case
      when p_report_kind = 'monthly' then to_char(p_period_start, 'YYYY-MM')
      when p_report_kind = 'annual' then to_char(p_period_start, 'YYYY')
      when p_period_start = p_period_end then to_char(p_period_start, 'YYYY-MM-DD')
      else to_char(p_period_start, 'YYYY-MM-DD') || ' to ' || to_char(p_period_end, 'YYYY-MM-DD')
    end;
  report_file_name := public.account_report_archive_file_name(p_report_kind, p_period_start, p_period_end);

  with completed_sales as (
    select *
    from public.sales s
    where s.status = 'completed'
      and s.business_date between p_period_start and p_period_end
  ),
  all_period_sales as (
    select *
    from public.sales s
    where s.business_date between p_period_start and p_period_end
  ),
  line_base as (
    select
      s.id as sale_id,
      s.sale_number,
      s.business_date,
      s.created_at,
      s.payment_method,
      s.order_taken_by,
      s.qr_payment_type,
      s.qr_reference,
      s.qr_status,
      si.id as sale_item_id,
      coalesce(p.name, si.custom_item_name, 'Custom Order') as item_name,
      coalesce(c.name, 'Others') as category_name,
      si.quantity,
      si.unit_price,
      si.line_total,
      coalesce(s.discount_amount, 0) as sale_discount,
      nullif(sum(si.line_total) over (partition by s.id), 0) as sale_line_total
    from completed_sales s
    join public.sale_items si on si.sale_id = s.id
    left join public.products p on p.id = si.product_id
    left join public.categories c on c.id = p.category_id
  ),
  sale_lines as (
    select
      lb.*,
      round(case when lb.sale_line_total is null then 0 else lb.sale_discount * lb.line_total / lb.sale_line_total end, 2) as discount_share,
      greatest(0, lb.line_total - round(case when lb.sale_line_total is null then 0 else lb.sale_discount * lb.line_total / lb.sale_line_total end, 2)) as net_line_total
    from line_base lb
  ),
  period_movements as (
    select
      sm.*,
      public.business_date_for_timestamp(sm.created_at) as movement_business_date,
      p.name as product_name
    from public.stock_movements sm
    left join public.products p on p.id = sm.product_id
    where public.business_date_for_timestamp(sm.created_at) between p_period_start and p_period_end
  ),
  period_stock_in_drafts as (
    select
      sid.*,
      public.business_date_for_timestamp(sid.created_at) as draft_business_date
    from public.stock_in_drafts sid
    where public.business_date_for_timestamp(sid.created_at) between p_period_start and p_period_end
  ),
  product_stock as (
    select
      p.id,
      p.name,
      coalesce(c.name, 'Others') as category_name,
      p.active,
      p.low_stock_threshold,
      coalesce(ib.quantity_on_hand, 0) as current_units,
      coalesce((
        select sum(sm.quantity_change)
        from public.stock_movements sm
        where sm.product_id = p.id
          and public.business_date_for_timestamp(sm.created_at) > p_period_end
      ), 0) as after_period_change,
      coalesce((
        select sum(sm.quantity_change)
        from public.stock_movements sm
        where sm.product_id = p.id
          and public.business_date_for_timestamp(sm.created_at) between p_period_start and p_period_end
      ), 0) as period_net,
      coalesce((
        select sum(sm.quantity_change)
        from public.stock_movements sm
        where sm.product_id = p.id
          and sm.movement_type = 'stock_in'
          and public.business_date_for_timestamp(sm.created_at) between p_period_start and p_period_end
      ), 0) as stock_in_units,
      coalesce((
        select abs(sum(sm.quantity_change))
        from public.stock_movements sm
        where sm.product_id = p.id
          and sm.quantity_change < 0
          and public.business_date_for_timestamp(sm.created_at) between p_period_start and p_period_end
      ), 0) as stock_out_units,
      coalesce((
        select sum(sm.quantity_change)
        from public.stock_movements sm
        where sm.product_id = p.id
          and sm.movement_type = 'void_sale'
          and public.business_date_for_timestamp(sm.created_at) between p_period_start and p_period_end
      ), 0) as void_return_units,
      coalesce((
        select sum(sm.quantity_change)
        from public.stock_movements sm
        where sm.product_id = p.id
          and sm.movement_type = 'adjustment'
          and public.business_date_for_timestamp(sm.created_at) between p_period_start and p_period_end
      ), 0) as adjustment_units
    from public.products p
    left join public.categories c on c.id = p.category_id
    left join public.inventory_balances ib on ib.product_id = p.id
  ),
  inventory_rows as (
    select
      ps.*,
      (ps.current_units - ps.after_period_change) as closing_units,
      (ps.current_units - ps.after_period_change - ps.period_net) as opening_units
    from product_stock ps
  )
  select jsonb_build_object(
    'schema_version', 1,
    'report_kind', p_report_kind,
    'period_start', p_period_start,
    'period_end', p_period_end,
    'title', report_title,
    'file_name', report_file_name,
    'generated_at', now(),
    'summary', jsonb_build_object(
      'cash_payment', coalesce((select sum(paid_amount) from completed_sales where payment_method = 'cash'), 0),
      'qr_payment', coalesce((select sum(paid_amount) from completed_sales where payment_method = 'qr'), 0),
      'foc_cost', coalesce((select sum(total_amount) from completed_sales where payment_method = 'complimentary'), 0),
      'total_revenue', coalesce((select sum(case when payment_method = 'complimentary' then 0 else paid_amount end) from completed_sales), 0),
      'discount_given', coalesce((select sum(coalesce(discount_amount, 0)) from completed_sales), 0),
      'transactions', coalesce((select count(*) from completed_sales), 0),
      'voided_sales', coalesce((select count(*) from all_period_sales where status = 'voided'), 0),
      'qr_pending', coalesce((select sum(paid_amount) from completed_sales where payment_method = 'qr' and qr_status = 'pending'), 0),
      'qr_verified', coalesce((select sum(paid_amount) from completed_sales where payment_method = 'qr' and qr_status = 'verified'), 0),
      'qr_mismatch', coalesce((select sum(paid_amount) from completed_sales where payment_method = 'qr' and qr_status = 'mismatch'), 0),
      'stock_in_drafts_pending', coalesce((select count(*) from period_stock_in_drafts where status = 'draft'), 0),
      'stock_in_drafts_cancelled', coalesce((select count(*) from period_stock_in_drafts where status = 'cancelled'), 0),
      'stock_in_drafts_confirmed', coalesce((select count(*) from period_stock_in_drafts where status = 'confirmed'), 0)
    ),
    'daily_closing', coalesce((
      select jsonb_agg(jsonb_build_object(
        'business_date', d.day::date,
        'status', case when dr.status = 'closed' then 'Closed' else 'Not closed' end,
        'opening_float', coalesce(cs.opening_float, (dr.report_json->>'opening_cash_float')::numeric, 0),
        'cash_payment', coalesce(dr.total_cash, (select sum(s.paid_amount) from completed_sales s where s.business_date = d.day::date and s.payment_method = 'cash'), 0),
        'qr_payment', coalesce(dr.total_qr, (select sum(s.paid_amount) from completed_sales s where s.business_date = d.day::date and s.payment_method = 'qr'), 0),
        'foc_cost', coalesce(dr.total_complimentary_value, (select sum(s.total_amount) from completed_sales s where s.business_date = d.day::date and s.payment_method = 'complimentary'), 0),
        'total_revenue', coalesce(dr.total_sales, (select sum(case when s.payment_method = 'complimentary' then 0 else s.paid_amount end) from completed_sales s where s.business_date = d.day::date), 0),
        'actual_cash_counted', dr.actual_cash_counted,
        'expected_cash', coalesce(
          dr.expected_cash,
          cs.expected_cash,
          coalesce(cs.opening_float, (dr.report_json->>'opening_cash_float')::numeric, 0) + coalesce((select sum(s.paid_amount) from completed_sales s where s.business_date = d.day::date and s.payment_method = 'cash'), 0)
        ),
        'cash_variance', dr.cash_variance,
        'closed_at', dr.closed_at,
        'notes', coalesce(dr.notes, cs.notes)
      ) order by d.day)
      from generate_series(p_period_start, p_period_end, interval '1 day') d(day)
      left join public.daily_reports dr on dr.business_date = d.day::date and dr.status = 'closed'
      left join public.cash_sessions cs on cs.business_date = d.day::date
    ), '[]'::jsonb),
    'item_sales', coalesce((
      select jsonb_agg(jsonb_build_object(
        'item', item_name,
        'quantity', quantity,
        'cash_payment', cash_payment,
        'qr_payment', qr_payment,
        'discount', discount,
        'foc_cost', foc_cost,
        'total_revenue', cash_payment + qr_payment
      ) order by item_name)
      from (
        select
          item_name,
          sum(quantity) as quantity,
          sum(case when payment_method = 'cash' then net_line_total else 0 end) as cash_payment,
          sum(case when payment_method = 'qr' then net_line_total else 0 end) as qr_payment,
          sum(discount_share) as discount,
          sum(case when payment_method = 'complimentary' then net_line_total else 0 end) as foc_cost
        from sale_lines
        group by item_name
      ) x
    ), '[]'::jsonb),
    'category_sales', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category', category_name,
        'quantity', quantity,
        'cash_payment', cash_payment,
        'qr_payment', qr_payment,
        'discount', discount,
        'foc_cost', foc_cost,
        'total_revenue', cash_payment + qr_payment
      ) order by category_name)
      from (
        select
          category_name,
          sum(quantity) as quantity,
          sum(case when payment_method = 'cash' then net_line_total else 0 end) as cash_payment,
          sum(case when payment_method = 'qr' then net_line_total else 0 end) as qr_payment,
          sum(discount_share) as discount,
          sum(case when payment_method = 'complimentary' then net_line_total else 0 end) as foc_cost
        from sale_lines
        group by category_name
      ) x
    ), '[]'::jsonb),
    'sales_transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'business_date', business_date,
        'time', created_at,
        'sale_number', sale_number,
        'staff', order_taken_by,
        'method', case payment_method when 'cash' then 'Cash Payment' when 'qr' then 'QR Payment' when 'complimentary' then 'FOC' else payment_method end,
        'qr_type', qr_payment_type,
        'qr_reference', qr_reference,
        'qr_status', case qr_status when 'pending' then 'Pending' when 'verified' then 'Verified' when 'mismatch' then 'Mismatch' when 'not_applicable' then 'Not applicable' else qr_status end,
        'discount', coalesce(discount_amount, 0),
        'sale_value', total_amount,
        'paid', paid_amount
      ) order by created_at)
      from completed_sales
    ), '[]'::jsonb),
    'sale_item_details', coalesce((
      select jsonb_agg(jsonb_build_object(
        'business_date', business_date,
        'time', created_at,
        'sale_number', sale_number,
        'staff', order_taken_by,
        'item', item_name,
        'quantity', quantity,
        'unit_price_at_sale', unit_price,
        'line_total', line_total,
        'discount_share', discount_share,
        'method', case payment_method when 'cash' then 'Cash Payment' when 'qr' then 'QR Payment' when 'complimentary' then 'FOC' else payment_method end,
        'paid_or_foc_value', case when payment_method = 'complimentary' then -net_line_total else net_line_total end
      ) order by created_at, sale_item_id)
      from sale_lines
    ), '[]'::jsonb),
    'qr_verification', coalesce((
      select jsonb_agg(jsonb_build_object(
        'business_date', business_date,
        'time', created_at,
        'sale_number', sale_number,
        'staff', order_taken_by,
        'qr_type', qr_payment_type,
        'reference', qr_reference,
        'status', case qr_status when 'pending' then 'Pending' when 'verified' then 'Verified' when 'mismatch' then 'Mismatch' when 'not_applicable' then 'Not applicable' else qr_status end,
        'receipt_image_path', qr_receipt_image_path,
        'amount', paid_amount
      ) order by created_at)
      from completed_sales
      where payment_method = 'qr'
    ), '[]'::jsonb),
    'voided_sales', coalesce((
      select jsonb_agg(jsonb_build_object(
        'business_date', business_date,
        'sale_time', created_at,
        'sale_number', sale_number,
        'voided_at', voided_at,
        'staff', order_taken_by,
        'method', case payment_method when 'cash' then 'Cash Payment' when 'qr' then 'QR Payment' when 'complimentary' then 'FOC' else payment_method end,
        'original_value', total_amount,
        'reason', void_reason
      ) order by coalesce(voided_at, created_at))
      from all_period_sales
      where status = 'voided'
    ), '[]'::jsonb),
    'stock_in', coalesce((
      select jsonb_agg(jsonb_build_object(
        'business_date', movement_business_date,
        'time', created_at,
        'product', coalesce(product_name, '-'),
        'units_added', quantity_change,
        'input', case when unit_input = 'carton' then coalesce(input_quantity::text, '-') || ' CARTON(S) x ' || coalesce(carton_size_at_time::text, '-') || ' units' else coalesce(input_quantity::text, abs(quantity_change)::text) || ' UNIT(S)' end,
        'entered_by', entered_by,
        'reference', reason,
        'notes', notes
      ) order by created_at)
      from period_movements
      where movement_type = 'stock_in'
    ), '[]'::jsonb),
    'stock_in_draft_proof', coalesce((
      select jsonb_agg(jsonb_build_object(
        'business_date', draft_business_date,
        'time', created_at,
        'draft_number', draft_number,
        'status', case status when 'confirmed' then 'Confirmed - Stock Added' when 'cancelled' then 'Cancelled' else 'Draft Only - Stock Not Added' end,
        'entered_by', entered_by,
        'total_units', total_units,
        'item_count', jsonb_array_length(entries),
        'items', coalesce((
          select string_agg(
            coalesce(entry->>'product_name', 'Product') || ' ' ||
            coalesce(entry->>'quantity', '-') || ' ' ||
            case when entry->>'unit' = 'carton' then 'CARTON(S) x' || coalesce(entry->>'carton_size', '-') else 'UNIT(S)' end,
            ', '
          )
          from jsonb_array_elements(entries) entry
        ), '-'),
        'supplier', supplier,
        'reference', reference,
        'notes', notes,
        'cancel_reason', cancel_reason,
        'confirmed_at', confirmed_at,
        'cancelled_at', cancelled_at
      ) order by created_at)
      from period_stock_in_drafts
    ), '[]'::jsonb),
    'stock_out_adjustments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'business_date', movement_business_date,
        'time', created_at,
        'product', coalesce(product_name, '-'),
        'type', case movement_type when 'sale' then 'Stock out' when 'complimentary' then 'FOC' when 'void_sale' then 'Void sale' when 'adjustment' then 'Adjustment' when 'stock_in' then 'Stock in' else replace(movement_type, '_', ' ') end,
        'quantity_change_units', quantity_change,
        'entered_by', entered_by,
        'reference', reference_type,
        'reason_or_notes', coalesce(reason, notes)
      ) order by created_at)
      from period_movements
      where movement_type <> 'stock_in'
    ), '[]'::jsonb),
    'inventory_balance', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product', name,
        'category', category_name,
        'opening_units', opening_units,
        'stock_in_units', stock_in_units,
        'stock_out_units', stock_out_units,
        'void_return_units', void_return_units,
        'adjustment_units', adjustment_units,
        'closing_units', closing_units,
        'status', case when active and closing_units <= low_stock_threshold then 'Low unit stock' else 'OK' end
      ) order by name)
      from inventory_rows
    ), '[]'::jsonb),
    'low_stock_items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product', name,
        'closing_balance_units', closing_units,
        'low_alert_at_units', low_stock_threshold,
        'status', case when active then 'Active' else 'Inactive' end
      ) order by name)
      from inventory_rows
      where active and closing_units <= low_stock_threshold
    ), '[]'::jsonb)
  ) into snapshot;

  insert into public.account_report_archives (
    report_kind,
    period_start,
    period_end,
    title,
    file_name,
    report_json,
    generated_by,
    generated_at
  ) values (
    p_report_kind,
    p_period_start,
    p_period_end,
    report_title,
    report_file_name,
    snapshot,
    auth.uid(),
    now()
  )
  on conflict (report_kind, period_start, period_end) do update
  set title = excluded.title,
      file_name = excluded.file_name,
      report_json = excluded.report_json,
      generated_by = excluded.generated_by,
      generated_at = excluded.generated_at
  returning * into result_row;

  return result_row;
end;
$$;

create or replace function public.refresh_due_account_report_archives()
returns setof public.account_report_archives
language plpgsql
security definer
set search_path = public
as $$
declare
  local_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  d date;
  period_start date;
begin
  if auth.uid() is not null and public.current_user_role() not in ('manager', 'admin') then
    raise exception 'Manager or admin permission is required.';
  end if;

  for d in
    with source_dates as (
      select business_date::date as business_date from public.sales
      union
      select business_date::date from public.daily_reports
      union
      select public.business_date_for_timestamp(created_at)::date from public.stock_movements
      union
      select public.business_date_for_timestamp(created_at)::date from public.stock_in_drafts
    )
    select distinct business_date
    from source_dates
    where business_date is not null and business_date < local_today
    order by business_date
  loop
    perform public.generate_account_report_archive('daily', d, d);
  end loop;

  for period_start in
    with source_dates as (
      select business_date::date as business_date from public.sales
      union
      select business_date::date from public.daily_reports
      union
      select public.business_date_for_timestamp(created_at)::date from public.stock_movements
      union
      select public.business_date_for_timestamp(created_at)::date from public.stock_in_drafts
    )
    select distinct date_trunc('week', business_date)::date
    from source_dates
    where business_date is not null and (date_trunc('week', business_date)::date + 6) < local_today
    order by 1
  loop
    perform public.generate_account_report_archive('weekly', period_start, period_start + 6);
  end loop;

  for period_start in
    with source_dates as (
      select business_date::date as business_date from public.sales
      union
      select business_date::date from public.daily_reports
      union
      select public.business_date_for_timestamp(created_at)::date from public.stock_movements
      union
      select public.business_date_for_timestamp(created_at)::date from public.stock_in_drafts
    )
    select distinct date_trunc('month', business_date)::date
    from source_dates
    where business_date is not null and (date_trunc('month', business_date)::date + interval '1 month')::date <= local_today
    order by 1
  loop
    perform public.generate_account_report_archive('monthly', period_start, (period_start + interval '1 month - 1 day')::date);
  end loop;

  for period_start in
    with source_dates as (
      select business_date::date as business_date from public.sales
      union
      select business_date::date from public.daily_reports
      union
      select public.business_date_for_timestamp(created_at)::date from public.stock_movements
      union
      select public.business_date_for_timestamp(created_at)::date from public.stock_in_drafts
    )
    select distinct date_trunc('year', business_date)::date
    from source_dates
    where business_date is not null and (date_trunc('year', business_date)::date + interval '1 year')::date <= local_today
    order by 1
  loop
    perform public.generate_account_report_archive('annual', period_start, (period_start + interval '1 year - 1 day')::date);
  end loop;

  return query
  select ara.*
  from public.account_report_archives ara
  order by ara.generated_at desc
  limit 240;
end;
$$;

revoke all on public.account_report_archives from public, anon;
grant select on public.account_report_archives to authenticated;
grant execute on function public.account_report_archive_file_name(text, date, date) to authenticated;
grant execute on function public.generate_account_report_archive(text, date, date) to authenticated;
grant execute on function public.refresh_due_account_report_archives() to authenticated;

-- Optional Supabase Cron setup. If pg_cron is unavailable, this block safely leaves the RPC/manual refresh in place.
do $cron_setup$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron is not enabled in this Supabase project: %', sqlerrm;
end;
$cron_setup$;

do $cron_schedule$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule(
      'lovely-paradise-account-reports-midnight-my',
      '0 16 * * *',
      'select public.refresh_due_account_report_archives();'
    );
  end if;
exception when others then
  raise notice 'Could not schedule generated account reports cron job: %', sqlerrm;
end;
$cron_schedule$;

-- Enable Supabase Realtime for tables that are watched by the app.
-- This keeps boss/manager/bar devices fresh when another device records sales,
-- stock activity, closing, products, settings, or report archives.
do $$
declare
  v_table text;
  v_tables text[] := array[
    'app_settings',
    'categories',
    'products',
    'inventory_balances',
    'stock_movements',
    'sales',
    'sale_items',
    'cash_sessions',
    'daily_reports',
    'account_report_archives',
    'product_price_history',
    'audit_logs'
  ];
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;

  foreach v_table in array v_tables loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    exception
      when duplicate_object then
        null;
      when undefined_table then
        null;
    end;
  end loop;
end $$;

-- Save settings atomically and prevent stale screens on another device
-- from overwriting newer cloud settings.
drop trigger if exists app_settings_touch_updated_at on public.app_settings;
create trigger app_settings_touch_updated_at before update on public.app_settings
for each row execute function public.touch_updated_at();

create or replace function public.save_app_settings_checked(
  p_rows jsonb,
  p_versions jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_item jsonb;
  setting_key text;
  setting_value jsonb;
  source_version text;
  source_updated_at timestamptz;
  current_row public.app_settings%rowtype;
  saved_rows jsonb;
begin
  if auth.uid() is null then
    raise exception 'Cloud session is not ready. Enter the website access code again.';
  end if;

  if public.current_user_role() <> 'admin' then
    raise exception 'Admin access required. Unlock Admin again before saving settings.';
  end if;

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Settings payload must be a list.';
  end if;

  for row_item in select value from jsonb_array_elements(p_rows)
  loop
    setting_key := row_item ->> 'key';
    setting_value := row_item -> 'value';

    if setting_key is null or setting_key = '' then
      raise exception 'Setting key is required.';
    end if;

    if setting_value is null then
      raise exception 'Setting value is required for %.', setting_key;
    end if;

    select *
    into current_row
    from public.app_settings
    where key = setting_key
    for update;

    source_version := p_versions ->> setting_key;
    if current_row.key is not null and source_version is not null and source_version <> '' then
      source_updated_at := source_version::timestamptz;
      if current_row.updated_at <> source_updated_at then
        raise exception 'Settings changed on another device. Latest values loaded; review and save again.';
      end if;
    end if;

    insert into public.app_settings(key, value, updated_by, updated_at)
    values (setting_key, setting_value, auth.uid(), now())
    on conflict (key) do update
      set value = excluded.value,
          updated_by = auth.uid(),
          updated_at = now();
  end loop;

  insert into public.audit_logs(actor_id, action, entity_type, after_json)
  values (auth.uid(), 'save_app_settings_checked', 'app_settings', p_rows);

  select coalesce(
    jsonb_agg(jsonb_build_object('key', key, 'value', value, 'updated_at', updated_at) order by key),
    '[]'::jsonb
  )
  into saved_rows
  from public.app_settings
  where key in (select value ->> 'key' from jsonb_array_elements(p_rows));

  return jsonb_build_object('settings', saved_rows);
end;
$$;

revoke execute on function public.save_app_settings_checked(jsonb, jsonb) from public, anon;
grant execute on function public.save_app_settings_checked(jsonb, jsonb) to authenticated;

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
\n\n-- 202605040024 cocktail kitchen inventory\n-- Cocktail recipes, ingredient inventory, table numbers, and kitchen production foundation.
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
\n
-- 202605040025 kitchen sections in account reports
-- Enrich generated account reports with kitchen pax, platter production, ingredient movements,
-- and ingredient balance sections so accountants can trace raw-material usage.
create or replace function public.account_report_archive_kitchen_sections(
  p_period_start date,
  p_period_end date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'kitchen_pax', coalesce((
        select sum(kdp.pax_count)
        from public.kitchen_daily_pax kdp
        where kdp.business_date between p_period_start and p_period_end
      ), 0),
      'kitchen_platters', coalesce((
        select sum(kpr.platter_count)
        from public.kitchen_production_reports kpr
        where kpr.business_date between p_period_start and p_period_end
      ), 0),
      'ingredient_usage_lines', coalesce((
        select count(*)
        from public.ingredient_movements im
        where public.business_date_for_timestamp(im.created_at) between p_period_start and p_period_end
      ), 0)
    ),
    'kitchen_pax', coalesce((
      select jsonb_agg(jsonb_build_object(
        'business_date', kdp.business_date,
        'pax_count', kdp.pax_count,
        'entered_by', kdp.entered_by,
        'updated_at', kdp.updated_at,
        'notes', kdp.notes
      ) order by kdp.business_date)
      from public.kitchen_daily_pax kdp
      where kdp.business_date between p_period_start and p_period_end
    ), '[]'::jsonb),
    'kitchen_production', coalesce((
      select jsonb_agg(jsonb_build_object(
        'business_date', kpr.business_date,
        'time', kpr.created_at,
        'platter', kpr.platter_name,
        'serving_basis', kpr.serving_basis,
        'prepared_count', kpr.platter_count,
        'submitted_by', kpr.submitted_by,
        'ingredient_lines', coalesce(items.item_count, 0),
        'ingredients_deducted', coalesce(items.ingredient_text, ''),
        'notes', kpr.notes
      ) order by kpr.business_date, kpr.created_at)
      from public.kitchen_production_reports kpr
      left join lateral (
        select
          count(*) as item_count,
          string_agg(ii.name || ' ' || round(kpi.total_quantity, case when kpi.unit = 'unit' then 0 else 2 end)::text || ' ' || kpi.unit, ', ' order by ii.name) as ingredient_text
        from public.kitchen_production_items kpi
        join public.ingredient_items ii on ii.id = kpi.ingredient_id
        where kpi.report_id = kpr.id
      ) items on true
      where kpr.business_date between p_period_start and p_period_end
    ), '[]'::jsonb),
    'ingredient_stock_movements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'business_date', public.business_date_for_timestamp(im.created_at),
        'time', im.created_at,
        'ingredient', coalesce(ii.name, 'Ingredient'),
        'category', coalesce(ii.category, '-'),
        'type', case im.movement_type
          when 'stock_in' then 'Ingredient stock in'
          when 'sale' then 'Cocktail sale usage'
          when 'complimentary' then 'FOC cocktail usage'
          when 'void_sale' then 'Void return'
          when 'kitchen_production' then 'Kitchen production'
          when 'waste' then 'Waste'
          when 'count' then 'Stock count'
          when 'adjustment' then 'Adjustment'
          else replace(im.movement_type, '_', ' ')
        end,
        'quantity_change', round(im.quantity_change, case when coalesce(ii.base_unit, 'unit') = 'unit' then 0 else 2 end)::text || ' ' || coalesce(ii.base_unit, 'unit'),
        'balance_after', round(im.quantity_after, case when coalesce(ii.base_unit, 'unit') = 'unit' then 0 else 2 end)::text || ' ' || coalesce(ii.base_unit, 'unit'),
        'entered_by', im.entered_by,
        'reference', im.reference_type,
        'reason_or_notes', coalesce(im.reason, im.notes)
      ) order by im.created_at)
      from public.ingredient_movements im
      left join public.ingredient_items ii on ii.id = im.ingredient_id
      where public.business_date_for_timestamp(im.created_at) between p_period_start and p_period_end
    ), '[]'::jsonb),
    'ingredient_inventory_balance', coalesce((
      with ingredient_stats as (
        select
          ii.id,
          ii.name,
          ii.category,
          ii.base_unit,
          ii.active,
          ii.low_stock_threshold,
          coalesce(ib.quantity_on_hand, 0) as current_quantity,
          coalesce(sum(im.quantity_change) filter (where public.business_date_for_timestamp(im.created_at) > p_period_end), 0) as after_period_change,
          coalesce(sum(im.quantity_change) filter (where public.business_date_for_timestamp(im.created_at) between p_period_start and p_period_end), 0) as period_net,
          coalesce(sum(im.quantity_change) filter (where public.business_date_for_timestamp(im.created_at) between p_period_start and p_period_end and im.movement_type = 'stock_in'), 0) as stock_in_quantity,
          abs(coalesce(sum(least(im.quantity_change, 0)) filter (where public.business_date_for_timestamp(im.created_at) between p_period_start and p_period_end and im.movement_type in ('sale', 'complimentary')), 0)) as cocktail_usage,
          abs(coalesce(sum(least(im.quantity_change, 0)) filter (where public.business_date_for_timestamp(im.created_at) between p_period_start and p_period_end and im.movement_type = 'kitchen_production'), 0)) as kitchen_usage,
          coalesce(sum(im.quantity_change) filter (where public.business_date_for_timestamp(im.created_at) between p_period_start and p_period_end and im.movement_type in ('adjustment', 'waste', 'count')), 0) as adjustment_or_waste
        from public.ingredient_items ii
        left join public.ingredient_balances ib on ib.ingredient_id = ii.id
        left join public.ingredient_movements im on im.ingredient_id = ii.id
        group by ii.id, ii.name, ii.category, ii.base_unit, ii.active, ii.low_stock_threshold, ib.quantity_on_hand
      ), balances as (
        select *, current_quantity - after_period_change as closing_quantity
        from ingredient_stats
      )
      select jsonb_agg(jsonb_build_object(
        'ingredient', name,
        'category', category,
        'unit', base_unit,
        'opening_quantity', round(closing_quantity - period_net, case when base_unit = 'unit' then 0 else 2 end)::text || ' ' || base_unit,
        'stock_in', round(stock_in_quantity, case when base_unit = 'unit' then 0 else 2 end)::text || ' ' || base_unit,
        'cocktail_usage', round(cocktail_usage, case when base_unit = 'unit' then 0 else 2 end)::text || ' ' || base_unit,
        'kitchen_usage', round(kitchen_usage, case when base_unit = 'unit' then 0 else 2 end)::text || ' ' || base_unit,
        'adjustment_or_waste', round(adjustment_or_waste, case when base_unit = 'unit' then 0 else 2 end)::text || ' ' || base_unit,
        'closing_quantity', round(closing_quantity, case when base_unit = 'unit' then 0 else 2 end)::text || ' ' || base_unit,
        'status', case when active and closing_quantity <= low_stock_threshold then 'Low ingredient stock' else 'OK' end
      ) order by category, name)
      from balances
    ), '[]'::jsonb),
    'low_ingredient_stock', coalesce((
      with ingredient_stats as (
        select
          ii.id,
          ii.name,
          ii.category,
          ii.base_unit,
          ii.active,
          ii.low_stock_threshold,
          coalesce(ib.quantity_on_hand, 0) - coalesce(sum(im.quantity_change) filter (where public.business_date_for_timestamp(im.created_at) > p_period_end), 0) as closing_quantity
        from public.ingredient_items ii
        left join public.ingredient_balances ib on ib.ingredient_id = ii.id
        left join public.ingredient_movements im on im.ingredient_id = ii.id
        group by ii.id, ii.name, ii.category, ii.base_unit, ii.active, ii.low_stock_threshold, ib.quantity_on_hand
      )
      select jsonb_agg(jsonb_build_object(
        'ingredient', name,
        'category', category,
        'closing_quantity', round(closing_quantity, case when base_unit = 'unit' then 0 else 2 end)::text || ' ' || base_unit,
        'low_alert_at', round(low_stock_threshold, case when base_unit = 'unit' then 0 else 2 end)::text || ' ' || base_unit,
        'status', 'Low'
      ) order by category, name)
      from ingredient_stats
      where active and closing_quantity <= low_stock_threshold
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

create or replace function public.account_report_archive_apply_kitchen_sections()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  kitchen_json jsonb;
begin
  kitchen_json := public.account_report_archive_kitchen_sections(NEW.period_start, NEW.period_end);
  NEW.report_json := coalesce(NEW.report_json, '{}'::jsonb) || (kitchen_json - 'summary');
  NEW.report_json := jsonb_set(
    NEW.report_json,
    '{summary}',
    coalesce(NEW.report_json -> 'summary', '{}'::jsonb) || coalesce(kitchen_json -> 'summary', '{}'::jsonb),
    true
  );
  return NEW;
end;
$$;

drop trigger if exists account_report_archives_kitchen_sections on public.account_report_archives;
create trigger account_report_archives_kitchen_sections
before insert or update of report_json, period_start, period_end on public.account_report_archives
for each row execute function public.account_report_archive_apply_kitchen_sections();

update public.account_report_archives
set report_json = report_json;

grant execute on function public.account_report_archive_kitchen_sections(date, date) to authenticated;

-- 202605040026 include kitchen and ingredient-only days in automatic account report refresh
-- This replaces the due-report scanner so daily / weekly / monthly / annual archive rows
-- are created even when a day only has kitchen pax, platter production, or ingredient stock activity.
create or replace function public.refresh_due_account_report_archives()
returns setof public.account_report_archives
language plpgsql
security definer
set search_path = public
as $$
declare
  local_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  d date;
  period_start date;
begin
  if auth.uid() is not null and public.current_user_role() not in ('manager', 'admin') then
    raise exception 'Manager or admin permission is required.';
  end if;

  for d in
    with source_dates as (
      select business_date::date as business_date from public.sales
      union
      select business_date::date from public.daily_reports
      union
      select public.business_date_for_timestamp(created_at)::date from public.stock_movements
      union
      select public.business_date_for_timestamp(created_at)::date from public.ingredient_movements
      union
      select business_date::date from public.kitchen_daily_pax
      union
      select business_date::date from public.kitchen_production_reports
    )
    select distinct business_date
    from source_dates
    where business_date is not null and business_date < local_today
    order by business_date
  loop
    perform public.generate_account_report_archive('daily', d, d);
  end loop;

  for period_start in
    with source_dates as (
      select business_date::date as business_date from public.sales
      union
      select business_date::date from public.daily_reports
      union
      select public.business_date_for_timestamp(created_at)::date from public.stock_movements
      union
      select public.business_date_for_timestamp(created_at)::date from public.ingredient_movements
      union
      select business_date::date from public.kitchen_daily_pax
      union
      select business_date::date from public.kitchen_production_reports
    )
    select distinct date_trunc('week', business_date)::date
    from source_dates
    where business_date is not null and (date_trunc('week', business_date)::date + 6) < local_today
    order by 1
  loop
    perform public.generate_account_report_archive('weekly', period_start, period_start + 6);
  end loop;

  for period_start in
    with source_dates as (
      select business_date::date as business_date from public.sales
      union
      select business_date::date from public.daily_reports
      union
      select public.business_date_for_timestamp(created_at)::date from public.stock_movements
      union
      select public.business_date_for_timestamp(created_at)::date from public.ingredient_movements
      union
      select business_date::date from public.kitchen_daily_pax
      union
      select business_date::date from public.kitchen_production_reports
    )
    select distinct date_trunc('month', business_date)::date
    from source_dates
    where business_date is not null and (date_trunc('month', business_date)::date + interval '1 month')::date <= local_today
    order by 1
  loop
    perform public.generate_account_report_archive('monthly', period_start, (period_start + interval '1 month - 1 day')::date);
  end loop;

  for period_start in
    with source_dates as (
      select business_date::date as business_date from public.sales
      union
      select business_date::date from public.daily_reports
      union
      select public.business_date_for_timestamp(created_at)::date from public.stock_movements
      union
      select public.business_date_for_timestamp(created_at)::date from public.ingredient_movements
      union
      select business_date::date from public.kitchen_daily_pax
      union
      select business_date::date from public.kitchen_production_reports
    )
    select distinct date_trunc('year', business_date)::date
    from source_dates
    where business_date is not null and (date_trunc('year', business_date)::date + interval '1 year')::date <= local_today
    order by 1
  loop
    perform public.generate_account_report_archive('annual', period_start, (period_start + interval '1 year - 1 day')::date);
  end loop;

  return query
  select ara.*
  from public.account_report_archives ara
  order by ara.generated_at desc
  limit 240;
end;
$$;

grant execute on function public.refresh_due_account_report_archives() to authenticated;

-- 202605040027 ingredient stock corrections and counts
-- Controlled RPC for admin/manager ingredient stock count, waste/missing, and correction entries.
-- Each change locks the ingredient balance, updates stock, writes ingredient_movements, and writes audit_logs.
create or replace function public.adjust_ingredient_stock(
  p_ingredient_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_reason text,
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
  quantity_change numeric(14,2);
  allow_negative boolean := public.setting_bool('allow_negative_stock', false);
begin
  perform public.require_role(array['manager', 'admin']);

  if p_movement_type not in ('count', 'waste', 'adjustment') then
    raise exception 'Ingredient correction type must be count, waste, or adjustment.';
  end if;
  if p_quantity is null then
    raise exception 'Ingredient correction quantity is invalid.';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Reason is required for ingredient stock correction.';
  end if;

  select * into ingredient_record
  from public.ingredient_items
  where id = p_ingredient_id and active = true
  for update;

  if ingredient_record.id is null then
    raise exception 'Ingredient is inactive or missing.';
  end if;

  insert into public.ingredient_balances(ingredient_id, quantity_on_hand)
  values (p_ingredient_id, 0)
  on conflict (ingredient_id) do nothing;

  select quantity_on_hand into before_qty
  from public.ingredient_balances
  where ingredient_id = p_ingredient_id
  for update;

  if p_movement_type = 'count' then
    if p_quantity < 0 then raise exception 'Actual count must be 0 or more.'; end if;
    after_qty := p_quantity;
    quantity_change := after_qty - before_qty;
  elsif p_movement_type = 'waste' then
    if p_quantity <= 0 then raise exception 'Waste or missing quantity must be more than 0.'; end if;
    quantity_change := -abs(p_quantity);
    after_qty := before_qty + quantity_change;
  else
    if p_quantity = 0 then raise exception 'Correction quantity cannot be 0.'; end if;
    quantity_change := p_quantity;
    after_qty := before_qty + quantity_change;
  end if;

  if not allow_negative and after_qty < 0 then
    raise exception 'Ingredient stock cannot go below 0. Current balance is % %.', before_qty, ingredient_record.base_unit;
  end if;

  update public.ingredient_balances
  set quantity_on_hand = after_qty, updated_at = now()
  where ingredient_id = p_ingredient_id;

  insert into public.ingredient_movements(
    ingredient_id, movement_type, quantity_change, quantity_before, quantity_after,
    unit_input, input_quantity, pack_size_at_time, reference_type, reference_id,
    reason, notes, entered_by, created_by
  ) values (
    p_ingredient_id, p_movement_type, quantity_change, before_qty, after_qty,
    p_movement_type, p_quantity, null, 'ingredient_' || p_movement_type, null,
    trim(p_reason), p_notes, p_entered_by, auth.uid()
  );

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, before_json, after_json)
  values (
    auth.uid(),
    'adjust_ingredient_stock',
    'ingredient',
    p_ingredient_id,
    jsonb_build_object('quantity_on_hand', before_qty),
    jsonb_build_object(
      'movement_type', p_movement_type,
      'quantity_input', p_quantity,
      'quantity_change', quantity_change,
      'quantity_on_hand', after_qty,
      'reason', trim(p_reason),
      'entered_by', p_entered_by
    )
  );

  return jsonb_build_object(
    'ingredient_id', p_ingredient_id,
    'quantity_change', quantity_change,
    'quantity_on_hand', after_qty
  );
end;
$$;

revoke execute on function public.adjust_ingredient_stock(uuid, text, numeric, text, text, text) from public, anon;
grant execute on function public.adjust_ingredient_stock(uuid, text, numeric, text, text, text) to authenticated;

-- 202605040028 ingredient exception summaries in account report archives
-- Adds a compact count / waste / correction summary to saved report snapshots.
create or replace function public.account_report_archive_exception_sections(
  p_period_start date,
  p_period_end date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  with exception_rows as (
    select
      im.*,
      coalesce(ii.name, 'Ingredient') as ingredient_name,
      coalesce(ii.category, '-') as ingredient_category,
      coalesce(ii.base_unit, 'unit') as base_unit,
      case im.movement_type
        when 'count' then 'Stock count'
        when 'waste' then 'Waste'
        when 'adjustment' then 'Adjustment'
        else replace(im.movement_type, '_', ' ')
      end as display_type
    from public.ingredient_movements im
    left join public.ingredient_items ii on ii.id = im.ingredient_id
    where im.movement_type in ('count', 'waste', 'adjustment')
      and public.business_date_for_timestamp(im.created_at) between p_period_start and p_period_end
  ), grouped as (
    select
      display_type,
      ingredient_name,
      ingredient_category,
      base_unit,
      count(*) as entries,
      sum(quantity_change) as net_change,
      max(created_at) as latest_entry
    from exception_rows
    group by display_type, ingredient_name, ingredient_category, base_unit
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'ingredient_stock_counts', coalesce((select count(*) from exception_rows where movement_type = 'count'), 0),
      'ingredient_waste_missing', coalesce((select count(*) from exception_rows where movement_type = 'waste'), 0),
      'ingredient_corrections', coalesce((select count(*) from exception_rows where movement_type = 'adjustment'), 0)
    ),
    'ingredient_exception_summary', coalesce((
      select jsonb_agg(jsonb_build_object(
        'type', g.display_type,
        'ingredient', g.ingredient_name,
        'category', g.ingredient_category,
        'entries', g.entries,
        'net_change', (case when g.net_change > 0 then '+' else '' end) || round(g.net_change, case when g.base_unit = 'unit' then 0 else 2 end)::text || ' ' || g.base_unit,
        'latest_entry', g.latest_entry,
        'entered_by', latest.entered_by,
        'reason_or_notes', latest.reason_or_notes
      ) order by g.display_type, g.ingredient_name)
      from grouped g
      left join lateral (
        select er.entered_by, coalesce(er.reason, er.notes) as reason_or_notes
        from exception_rows er
        where er.display_type = g.display_type
          and er.ingredient_name = g.ingredient_name
          and er.ingredient_category = g.ingredient_category
          and er.base_unit = g.base_unit
        order by er.created_at desc
        limit 1
      ) latest on true
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

create or replace function public.account_report_archive_apply_exception_sections()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  exception_json jsonb;
begin
  exception_json := public.account_report_archive_exception_sections(NEW.period_start, NEW.period_end);
  NEW.report_json := coalesce(NEW.report_json, '{}'::jsonb) || (exception_json - 'summary');
  NEW.report_json := jsonb_set(
    NEW.report_json,
    '{summary}',
    coalesce(NEW.report_json -> 'summary', '{}'::jsonb) || coalesce(exception_json -> 'summary', '{}'::jsonb),
    true
  );
  return NEW;
end;
$$;

drop trigger if exists account_report_archives_exception_sections on public.account_report_archives;
create trigger account_report_archives_exception_sections
before insert or update of report_json, period_start, period_end on public.account_report_archives
for each row execute function public.account_report_archive_apply_exception_sections();

update public.account_report_archives
set report_json = report_json;

grant execute on function public.account_report_archive_exception_sections(date, date) to authenticated;

create table if not exists public.stock_in_drafts (
  id uuid primary key default gen_random_uuid(),
  draft_number text unique not null,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'cancelled')),
  entered_by text,
  supplier text,
  reference text,
  notes text,
  entries jsonb not null,
  total_units int not null default 0 check (total_units >= 0),
  created_by uuid references auth.users(id),
  confirmed_by uuid references auth.users(id),
  cancelled_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text
);

alter table public.stock_in_drafts enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'stock_in_drafts'
      and policyname = 'stock in drafts manager read'
  ) then
    create policy "stock in drafts manager read"
    on public.stock_in_drafts
    for select to authenticated
    using (public.current_user_role() in ('manager', 'admin'));
  end if;
end $$;

create or replace function public.create_stock_in_draft(
  p_entries jsonb,
  p_entered_by text default null,
  p_supplier text default null,
  p_reference text default null,
  p_notes text default null
)
returns public.stock_in_drafts
language plpgsql
security definer
set search_path = public
as $$
declare
  entry jsonb;
  product_record public.products%rowtype;
  entry_quantity int;
  entry_unit text;
  entry_cost numeric;
  entry_cans int;
  normalized_entries jsonb := '[]'::jsonb;
  total_cans int := 0;
  draft_record public.stock_in_drafts%rowtype;
  next_number text;
begin
  perform public.require_role(array['manager', 'admin']);

  if jsonb_typeof(p_entries) <> 'array' then
    raise exception 'Stock In entries must be an array.';
  end if;

  if jsonb_array_length(p_entries) = 0 then
    raise exception 'Enter at least one Stock In item.';
  end if;

  for entry in select value from jsonb_array_elements(p_entries)
  loop
    entry_quantity := nullif(entry->>'quantity', '')::int;
    entry_unit := entry->>'unit';
    entry_cost := nullif(entry->>'cost_per_unit', '')::numeric;

    if entry_quantity is null or entry_quantity <= 0 then
      raise exception 'Quantity must be positive.';
    end if;

    if entry_unit not in ('can', 'carton') then
      raise exception 'Unit must be UNIT(S) or CARTON(S).';
    end if;

    if entry_cost is not null and entry_cost < 0 then
      raise exception 'Cost cannot be negative.';
    end if;

    select * into product_record
    from public.products
    where id = (entry->>'product_id')::uuid;

    if not found then
      raise exception 'Product not found.';
    end if;

    entry_cans := entry_quantity * case when entry_unit = 'carton' then product_record.carton_size else 1 end;
    total_cans := total_cans + entry_cans;
    normalized_entries := normalized_entries || jsonb_build_array(jsonb_build_object(
      'product_id', product_record.id,
      'product_name', product_record.name,
      'quantity', entry_quantity,
      'unit', entry_unit,
      'carton_size', product_record.carton_size,
      'cans', entry_cans,
      'cost_per_unit', entry_cost
    ));
  end loop;

  next_number := 'SI-DRAFT-' || to_char(now() at time zone 'Asia/Kuala_Lumpur', 'YYYYMMDD-HH24MISS') || '-' || upper(substr(gen_random_uuid()::text, 1, 4));

  insert into public.stock_in_drafts (
    draft_number, status, entered_by, supplier, reference, notes, entries, total_units, created_by
  )
  values (
    next_number, 'draft', nullif(p_entered_by, ''), nullif(p_supplier, ''), nullif(p_reference, ''), nullif(p_notes, ''), normalized_entries, total_cans, auth.uid()
  )
  returning * into draft_record;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, after_json)
  values (auth.uid(), 'stock_in_draft_created', 'stock_in_draft', draft_record.id, to_jsonb(draft_record));

  return draft_record;
end;
$$;

create or replace function public.confirm_stock_in_draft(p_draft_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  draft_record public.stock_in_drafts%rowtype;
  confirmed_draft public.stock_in_drafts%rowtype;
  entry jsonb;
  result jsonb;
  results jsonb := '[]'::jsonb;
begin
  perform public.require_role(array['manager', 'admin']);

  select * into draft_record
  from public.stock_in_drafts
  where id = p_draft_id
  for update;

  if not found then
    raise exception 'Stock In draft not found.';
  end if;

  if draft_record.status <> 'draft' then
    raise exception 'Stock In draft is already %.', draft_record.status;
  end if;

  for entry in select value from jsonb_array_elements(draft_record.entries)
  loop
    result := public.stock_in_product(
      (entry->>'product_id')::uuid,
      (entry->>'quantity')::int,
      entry->>'unit',
      nullif(entry->>'cost_per_unit', '')::numeric,
      draft_record.supplier,
      nullif(concat_ws(' / ', draft_record.reference, draft_record.draft_number), ''),
      draft_record.notes,
      draft_record.entered_by
    );
    results := results || jsonb_build_array(result);
  end loop;

  update public.stock_in_drafts
  set status = 'confirmed',
      confirmed_by = auth.uid(),
      confirmed_at = now()
  where id = p_draft_id
  returning * into confirmed_draft;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, before_json, after_json)
  values (auth.uid(), 'stock_in_draft_confirmed', 'stock_in_draft', p_draft_id, to_jsonb(draft_record), to_jsonb(confirmed_draft));

  return jsonb_build_object('draft', to_jsonb(confirmed_draft), 'results', results);
end;
$$;

create or replace function public.cancel_stock_in_draft(
  p_draft_id uuid,
  p_reason text
)
returns public.stock_in_drafts
language plpgsql
security definer
set search_path = public
as $$
declare
  draft_record public.stock_in_drafts%rowtype;
  cancelled_draft public.stock_in_drafts%rowtype;
begin
  perform public.require_role(array['manager', 'admin']);

  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Cancellation reason is required.';
  end if;

  select * into draft_record
  from public.stock_in_drafts
  where id = p_draft_id
  for update;

  if not found then
    raise exception 'Stock In draft not found.';
  end if;

  if draft_record.status <> 'draft' then
    raise exception 'Only draft Stock In records can be cancelled.';
  end if;

  update public.stock_in_drafts
  set status = 'cancelled',
      cancelled_by = auth.uid(),
      cancelled_at = now(),
      cancel_reason = trim(p_reason)
  where id = p_draft_id
  returning * into cancelled_draft;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, before_json, after_json)
  values (auth.uid(), 'stock_in_draft_cancelled', 'stock_in_draft', p_draft_id, to_jsonb(draft_record), to_jsonb(cancelled_draft));

  return cancelled_draft;
end;
$$;

grant select on public.stock_in_drafts to authenticated;
revoke execute on function public.create_stock_in_draft(jsonb, text, text, text, text) from public, anon;
revoke execute on function public.confirm_stock_in_draft(uuid) from public, anon;
revoke execute on function public.cancel_stock_in_draft(uuid, text) from public, anon;
grant execute on function public.create_stock_in_draft(jsonb, text, text, text, text) to authenticated;
grant execute on function public.confirm_stock_in_draft(uuid) to authenticated;
grant execute on function public.cancel_stock_in_draft(uuid, text) to authenticated;

-- Stock In draft proof in account report archives.
create or replace function public.account_report_archive_stock_in_draft_sections(
  p_period_start date,
  p_period_end date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  with period_drafts as (
    select
      sid.*,
      public.business_date_for_timestamp(sid.created_at)::date as draft_business_date
    from public.stock_in_drafts sid
    where public.business_date_for_timestamp(sid.created_at)::date between p_period_start and p_period_end
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'stock_in_drafts_pending', coalesce((select count(*) from period_drafts where status = 'draft'), 0),
      'stock_in_drafts_cancelled', coalesce((select count(*) from period_drafts where status = 'cancelled'), 0),
      'stock_in_drafts_confirmed', coalesce((select count(*) from period_drafts where status = 'confirmed'), 0)
    ),
    'stock_in_draft_proof', coalesce((
      select jsonb_agg(jsonb_build_object(
        'business_date', draft_business_date,
        'time', created_at,
        'draft_number', draft_number,
        'status', case status when 'confirmed' then 'Confirmed - Stock Added' when 'cancelled' then 'Cancelled' else 'Draft Only - Stock Not Added' end,
        'entered_by', entered_by,
        'total_units', total_units,
        'item_count', jsonb_array_length(entries),
        'items', coalesce((
          select string_agg(
            coalesce(entry->>'product_name', 'Product') || ' ' ||
            coalesce(entry->>'quantity', '-') || ' ' ||
            case when entry->>'unit' = 'carton' then 'CARTON(S) x' || coalesce(entry->>'carton_size', '-') else 'UNIT(S)' end,
            ', '
          )
          from jsonb_array_elements(entries) entry
        ), '-'),
        'supplier', supplier,
        'reference', reference,
        'notes', notes,
        'cancel_reason', cancel_reason,
        'confirmed_at', confirmed_at,
        'cancelled_at', cancelled_at
      ) order by created_at)
      from period_drafts
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

create or replace function public.account_report_archive_apply_stock_in_draft_sections()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  draft_json jsonb;
begin
  draft_json := public.account_report_archive_stock_in_draft_sections(NEW.period_start, NEW.period_end);
  NEW.report_json := coalesce(NEW.report_json, '{}'::jsonb) || (draft_json - 'summary');
  NEW.report_json := jsonb_set(
    NEW.report_json,
    '{summary}',
    coalesce(NEW.report_json -> 'summary', '{}'::jsonb) || coalesce(draft_json -> 'summary', '{}'::jsonb),
    true
  );
  return NEW;
end;
$$;

drop trigger if exists account_report_archives_stock_in_draft_sections on public.account_report_archives;
create trigger account_report_archives_stock_in_draft_sections
before insert or update of report_json, period_start, period_end on public.account_report_archives
for each row execute function public.account_report_archive_apply_stock_in_draft_sections();

create or replace function public.refresh_due_account_report_archives()
returns setof public.account_report_archives
language plpgsql
security definer
set search_path = public
as $$
declare
  local_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  d date;
  period_start date;
begin
  if auth.uid() is not null and public.current_user_role() not in ('manager', 'admin') then
    raise exception 'Manager or admin permission is required.';
  end if;

  for d in
    with source_dates as (
      select business_date::date as business_date from public.sales
      union
      select business_date::date from public.daily_reports
      union
      select public.business_date_for_timestamp(created_at)::date from public.stock_movements
      union
      select public.business_date_for_timestamp(created_at)::date from public.stock_in_drafts
      union
      select public.business_date_for_timestamp(created_at)::date from public.ingredient_movements
      union
      select business_date::date from public.kitchen_daily_pax
      union
      select business_date::date from public.kitchen_production_reports
    )
    select distinct business_date
    from source_dates
    where business_date is not null and business_date < local_today
    order by business_date
  loop
    perform public.generate_account_report_archive('daily', d, d);
  end loop;

  for period_start in
    with source_dates as (
      select business_date::date as business_date from public.sales
      union
      select business_date::date from public.daily_reports
      union
      select public.business_date_for_timestamp(created_at)::date from public.stock_movements
      union
      select public.business_date_for_timestamp(created_at)::date from public.stock_in_drafts
      union
      select public.business_date_for_timestamp(created_at)::date from public.ingredient_movements
      union
      select business_date::date from public.kitchen_daily_pax
      union
      select business_date::date from public.kitchen_production_reports
    )
    select distinct date_trunc('week', business_date)::date
    from source_dates
    where business_date is not null and (date_trunc('week', business_date)::date + 6) < local_today
    order by 1
  loop
    perform public.generate_account_report_archive('weekly', period_start, period_start + 6);
  end loop;

  for period_start in
    with source_dates as (
      select business_date::date as business_date from public.sales
      union
      select business_date::date from public.daily_reports
      union
      select public.business_date_for_timestamp(created_at)::date from public.stock_movements
      union
      select public.business_date_for_timestamp(created_at)::date from public.stock_in_drafts
      union
      select public.business_date_for_timestamp(created_at)::date from public.ingredient_movements
      union
      select business_date::date from public.kitchen_daily_pax
      union
      select business_date::date from public.kitchen_production_reports
    )
    select distinct date_trunc('month', business_date)::date
    from source_dates
    where business_date is not null and (date_trunc('month', business_date)::date + interval '1 month')::date <= local_today
    order by 1
  loop
    perform public.generate_account_report_archive('monthly', period_start, (period_start + interval '1 month - 1 day')::date);
  end loop;

  for period_start in
    with source_dates as (
      select business_date::date as business_date from public.sales
      union
      select business_date::date from public.daily_reports
      union
      select public.business_date_for_timestamp(created_at)::date from public.stock_movements
      union
      select public.business_date_for_timestamp(created_at)::date from public.stock_in_drafts
      union
      select public.business_date_for_timestamp(created_at)::date from public.ingredient_movements
      union
      select business_date::date from public.kitchen_daily_pax
      union
      select business_date::date from public.kitchen_production_reports
    )
    select distinct date_trunc('year', business_date)::date
    from source_dates
    where business_date is not null and (date_trunc('year', business_date)::date + interval '1 year')::date <= local_today
    order by 1
  loop
    perform public.generate_account_report_archive('annual', period_start, (period_start + interval '1 year - 1 day')::date);
  end loop;

  return query
  select ara.*
  from public.account_report_archives ara
  order by ara.generated_at desc
  limit 240;
end;
$$;

update public.account_report_archives
set report_json = report_json;

grant execute on function public.account_report_archive_stock_in_draft_sections(date, date) to authenticated;
grant execute on function public.refresh_due_account_report_archives() to authenticated;
