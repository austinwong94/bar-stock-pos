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

insert into public.app_settings (key, value)
values ('business_day_close_time', '"00:00"'::jsonb)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();

update public.sales
set business_date = (created_at at time zone 'Asia/Kuala_Lumpur')::date
where business_date is distinct from (created_at at time zone 'Asia/Kuala_Lumpur')::date;

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
        with item_values as (
          select coalesce(p.name, si.custom_item_name, 'Custom Order') as name,
                 si.quantity,
                 s.payment_method,
                 case
                   when sum(si.line_total) over (partition by s.id) > 0
                   then (si.line_total / sum(si.line_total) over (partition by s.id)) * s.total_amount
                   else 0
                 end as adjusted_total
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
                 end as adjusted_total
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
          and (sm.created_at at time zone 'Asia/Kuala_Lumpur')::date = p_business_date
        group by p.name order by p.name
      ) x
    ),
    'stock_movements', (
      select coalesce(jsonb_agg(to_jsonb(sm)), '[]'::jsonb)
      from public.stock_movements sm
      where (sm.created_at at time zone 'Asia/Kuala_Lumpur')::date = p_business_date
    ),
    'opening_stock', (
      select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
      from (
        select p.name,
               ib.quantity_on_hand - coalesce(sum(sm.quantity_change) filter (where (sm.created_at at time zone 'Asia/Kuala_Lumpur')::date = p_business_date), 0) as quantity
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
