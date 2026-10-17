-- Aggregate inside PostgreSQL so PostgREST's row limit cannot truncate totals.
create or replace function public.read_bar_overview(p_from date, p_to date, p_today date)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare result jsonb;
begin
  if not (public.has_permission('bar.pos.use') or public.has_permission('bar.stock.view') or public.has_permission('bar.reports.view')) then
    raise exception 'Bar access is required.' using errcode='42501';
  end if;
  if p_from is null or p_to is null or p_today is null or p_to<p_from or p_to-p_from>366 then
    raise exception 'Choose a valid reporting period.' using errcode='22023';
  end if;
  select jsonb_build_object(
    'totals', (select jsonb_build_object(
      'cash',coalesce(sum(paid_amount) filter(where payment_method='cash'),0),
      'qr',coalesce(sum(paid_amount) filter(where payment_method='qr'),0),
      'focCost',coalesce(sum(total_amount) filter(where payment_method='complimentary'),0),
      'paidRevenue',coalesce(sum(paid_amount) filter(where payment_method<>'complimentary'),0),
      'tx',count(*)) from public.sales where status='completed' and business_date between p_from and p_to),
    'soldToday',coalesce((select jsonb_object_agg(product_id,quantity) from (
      select i.product_id,sum(i.quantity) as quantity from public.sale_items i
      join public.sales s on s.id=i.sale_id
      where s.status='completed' and s.business_date=p_today and i.product_id is not null group by i.product_id
    ) items),'{}'::jsonb)
  ) into result;
  return result;
end; $$;
revoke all on function public.read_bar_overview(date,date,date) from public,anon;
grant execute on function public.read_bar_overview(date,date,date) to authenticated;
