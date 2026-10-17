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
