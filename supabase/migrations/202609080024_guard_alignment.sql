-- Legacy bar routines must respect individual permission revocations.
do $$
declare r record; definition text; permission text;
begin
  select pg_get_functiondef('public.save_product_recipe(uuid,jsonb)'::regprocedure) into definition;
  execute replace(definition,'for update;','for update of p;');
  for r in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('save_product_checked','save_app_settings_checked')
  loop
    permission:=case when r.proname='save_product_checked' then 'bar.products.manage' else 'bar.settings.manage' end;
    definition:=pg_get_functiondef(r.oid);
    definition:=replace(definition,'public.current_user_role() <> ''admin''',format('not public.has_permission(%L)',permission));
    execute definition;
  end loop;
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('stock_in_product','stock_in_products')
  loop
    definition:=pg_get_functiondef(r.oid);
    execute regexp_replace(definition,'perform public.require_role\(array\[[^;]+;','perform public.require_permission(''bar.stock.manage'');','gi');
  end loop;
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='complete_sale'
  loop
    definition:=pg_get_functiondef(r.oid);
    definition:=replace(definition,'if p_idempotency_key is not null then',E'if p_idempotency_key is not null then\n    perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key,0));');
    definition:=replace(definition,'insert into public.ingredient_balances(ingredient_id, quantity_on_hand)',E'if exists(select 1 from tmp_recipe_usage u join public.ingredient_items i on i.id=u.ingredient_id where not i.active) then\n    raise exception ''A recipe ingredient is inactive. Update the recipe before selling.'';\n  end if;\n\n  insert into public.ingredient_balances(ingredient_id, quantity_on_hand)');
    execute definition;
  end loop;
end $$;

do $$
declare t text; pol record; read_guard text;
begin
  foreach t in array array['products','categories','inventory_balances','sales','sale_items','stock_movements','daily_reports','product_price_history']
  loop
    read_guard := 'public.has_permission(''bar.pos.use'') or public.has_permission(''bar.stock.view'') or public.has_permission(''bar.reports.view'') or public.has_permission(''bar.closing.manage'') or public.has_permission(''bar.products.manage'')';
    for pol in select policyname from pg_policies where schemaname='public' and tablename=t
    loop execute format('drop policy %I on public.%I',pol.policyname,t); end loop;
    execute format('create policy department_read on public.%I for select to authenticated using (%s)',t,read_guard);
    if t in ('products','categories') then
      execute format('create policy department_write on public.%I for all to authenticated using(public.has_permission(''bar.products.manage'')) with check(public.has_permission(''bar.products.manage''))',t);
    end if;
  end loop;
end $$;

create or replace function public.submit_purchase_request_checked(p_request_id uuid,p_expected_updated_at timestamptz)
returns public.purchase_requests language plpgsql security definer set search_path=public as $$
declare v_request public.purchase_requests%rowtype;
begin
  perform public.require_permission('kitchen.request.submit');
  perform pg_advisory_xact_lock(73081,1);
  select * into v_request from public.purchase_requests where id=p_request_id for update;
  if not found or v_request.updated_at is distinct from p_expected_updated_at then
    raise exception 'The request changed. Reopen it and check the updated details before confirming.' using errcode='40001'; end if;
  return public.submit_purchase_request(p_request_id);
end $$;
revoke all on function public.submit_purchase_request(uuid) from public,anon,authenticated;
revoke all on function public.submit_purchase_request_checked(uuid,timestamptz) from public,anon;
grant execute on function public.submit_purchase_request_checked(uuid,timestamptz) to authenticated;
