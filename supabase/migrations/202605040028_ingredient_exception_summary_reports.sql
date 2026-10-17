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
