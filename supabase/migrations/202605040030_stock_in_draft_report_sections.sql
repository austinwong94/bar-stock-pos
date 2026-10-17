-- 202605040030 stock-in draft proof in account report archives
-- Adds Draft Only / Confirmed / Cancelled Stock In evidence to saved daily, weekly,
-- monthly, and annual account reports.

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
