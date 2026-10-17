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
      'qr_mismatch', coalesce((select sum(paid_amount) from completed_sales where payment_method = 'qr' and qr_status = 'mismatch'), 0)
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
