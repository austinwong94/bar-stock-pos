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
