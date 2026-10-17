
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
