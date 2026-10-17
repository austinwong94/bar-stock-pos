-- Preserve departmental access when restoring the bar and kitchen modules.
insert into public.permissions (code, department_code, name, description, sensitive, sort_order) values
  ('kitchen.production.manage', 'kitchen', 'Record preparation', 'Record actual arrivals and ingredient usage.', false, 5),
  ('purchasing.receive', 'purchasing', 'Receive deliveries', 'Confirm quantities delivered into ingredient stock.', false, 5)
on conflict (code) do nothing;
insert into public.access_role_permissions(role_code, permission_code) values
  ('kitchen_staff', 'kitchen.production.manage'),
  ('kitchen_staff', 'purchasing.view'),
  ('kitchen_staff', 'purchasing.receive'),
  ('purchaser', 'purchasing.receive'),
  ('operations_manager', 'kitchen.production.manage'),
  ('operations_manager', 'purchasing.receive')
on conflict do nothing;

revoke update on public.profiles from authenticated, anon;
grant update(full_name) on public.profiles to authenticated;

create or replace function public.user_has_permission(p_user_id uuid, p_code text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from public.profiles p where p.id=p_user_id and p.status='active'
      and (not p.is_anonymous or (p.app_access_granted and public.setting_bool('allow_access_code_login', true)))) then false
    when exists (select 1 from public.profiles p where p.id=p_user_id and p.is_anonymous)
      and p_code not like 'bar.%' then false
    when exists (select 1 from public.profiles p join public.access_roles r on r.code=p.access_role_code
      where p.id=p_user_id and r.is_master and not p.is_anonymous) then true
    when exists (select 1 from public.user_permission_overrides o
      where o.user_id=p_user_id and o.permission_code=p_code and o.effect='revoke') then false
    when p_code in ('bar.products.manage','bar.settings.manage','bar.pos.void','bar.stock.manage','bar.closing.manage','bar.reports.view')
      and exists (select 1 from public.profiles p join public.access_role_permissions rp on rp.role_code=p.access_role_code
        where p.id=p_user_id and rp.permission_code='bar.pos.use' and p.admin_access_expires_at>now()) then true
    when exists (select 1 from public.user_permission_overrides o
      where o.user_id=p_user_id and o.permission_code=p_code and o.effect='grant') then true
    else exists (select 1 from public.profiles p join public.access_role_permissions rp on rp.role_code=p.access_role_code
      where p.id=p_user_id and rp.permission_code=p_code)
  end
$$;

create or replace function public.current_user_role()
returns text language sql stable security definer set search_path=public as $$
  select public.legacy_role_for(auth.uid())
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,full_name,role,access_role_code,status,login_email,is_anonymous,app_access_granted)
  values(new.id,coalesce(nullif(new.raw_user_meta_data->>'full_name',''),split_part(new.email,'@',1),'Bar Tablet'),
    'pending','pending','pending',new.email,coalesce((to_jsonb(new)->>'is_anonymous')::boolean,new.email is null),false)
  on conflict(id) do nothing;
  return new;
end;
$$;

create or replace function public.verify_app_access(p_access_code text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row public.profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in again.' using errcode='42501'; end if;
  select * into v_row from public.profiles where id=auth.uid() for update;
  if not v_row.is_anonymous or v_row.status='suspended' or not public.setting_bool('allow_access_code_login',true)
    then raise exception 'Bar tablet access is unavailable.' using errcode='42501'; end if;
  if encode(digest(coalesce(p_access_code,''),'sha256'),'hex') <> '615ed7fb1504b0c724a296d7a69e6c7b2f9ea2c57c1d8206c5afdf392ebdfd25'
    then raise exception 'Wrong access code.' using errcode='42501'; end if;
  update public.profiles set access_role_code='bar_staff',status='active',app_access_granted=true,
    app_access_granted_at=now(),admin_access_expires_at=null where id=auth.uid() returning * into v_row;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_json)
    values(auth.uid(),'verify_app_access','profile',auth.uid(),jsonb_build_object('granted_at',now()));
  return to_jsonb(v_row);
end;
$$;

create or replace function public.verify_admin_access(p_admin_password text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_expiry timestamptz := now()+interval '2 hours';
begin
  perform public.require_permission('bar.pos.use');
  if encode(digest(coalesce(p_admin_password,''),'sha256'),'hex') <> '90727dcc85c0513b949e872edf5434fe14e7a8a17f64fdb3271d721e73d74911'
    then raise exception 'Wrong admin password.' using errcode='42501'; end if;
  update public.profiles set admin_access_expires_at=v_expiry where id=auth.uid();
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_json)
    values(auth.uid(),'verify_admin_access','profile',auth.uid(),jsonb_build_object('expires_at',v_expiry));
  return jsonb_build_object('admin_access_expires_at',v_expiry);
end;
$$;
revoke all on function public.verify_app_access(text), public.verify_admin_access(text) from public,anon;
grant execute on function public.verify_app_access(text), public.verify_admin_access(text) to authenticated;

-- Update restored RPC guards without replacing their accounting calculations.
do $$
declare r record; definition text; required_permission text;
begin
  for r in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'complete_sale','void_sale','stock_in','batch_stock_in','stock_in_batch',
      'create_stock_in_draft','confirm_stock_in_draft','cancel_stock_in_draft',
      'stock_in_ingredient','adjust_ingredient_stock','save_product_recipe',
      'save_kitchen_pax','submit_kitchen_production','close_daily_report','reopen_daily_report','verify_qr_payment')
  loop
    required_permission := case
      when r.proname='complete_sale' then 'bar.pos.use'
      when r.proname='void_sale' then 'bar.pos.void'
      when r.proname in ('save_kitchen_pax','submit_kitchen_production') then 'kitchen.production.manage'
      when r.proname='save_product_recipe' then 'bar.products.manage'
      when r.proname in ('close_daily_report','reopen_daily_report','verify_qr_payment') then 'bar.closing.manage'
      else 'bar.stock.manage' end;
    definition := pg_get_functiondef(r.oid);
    definition := regexp_replace(definition, 'perform public.require_role\(array\[[^;]+;', format('perform public.require_permission(%L);',required_permission),'gi');
    execute definition;
  end loop;
end $$;

-- Department permissions apply to restored tables as well as the new UI.
do $$
declare t text; pol record; expression text;
begin
  foreach t in array array['ingredient_items','ingredient_balances','ingredient_movements','recipe_ingredients',
    'kitchen_daily_pax','kitchen_production_reports','kitchen_production_items','stock_in_drafts']
  loop
    for pol in select policyname from pg_policies where schemaname='public' and tablename=t
    loop execute format('drop policy %I on public.%I',pol.policyname,t); end loop;
    expression := case when t='stock_in_drafts' then
      'public.has_permission(''bar.stock.manage'') or public.has_permission(''bar.reports.view'')'
      else 'public.has_permission(''kitchen.production.manage'') or public.has_permission(''bar.stock.view'') or public.has_permission(''bar.pos.use'') or public.has_permission(''bar.products.manage'') or public.has_permission(''bar.reports.view'') or public.has_permission(''purchasing.receive'')' end;
    execute format('create policy integrated_read on public.%I for select to authenticated using (%s)',t,expression);
  end loop;
  create policy integrated_ingredient_edit on public.ingredient_items for all to authenticated
    using(public.has_permission('bar.products.manage')) with check(public.has_permission('bar.products.manage'));
end $$;

drop policy if exists "settings read authenticated" on public.app_settings;
create policy "settings read authenticated" on public.app_settings for select to authenticated
  using(exists(select 1 from public.profiles where id=auth.uid() and status='active' and (not is_anonymous or app_access_granted)));

-- Broadcast restored and new operational records. Reconnects also refetch.
do $$
declare t text;
begin
  foreach t in array array['bookings','tourists','boat_assignments','trip_bookings','trip_passengers',
    'boats','pickup_groups','transport_vehicles','purchase_requests','purchase_request_items','missing_items',
    'attendance_log','profiles','user_permission_overrides','access_role_permissions']
  loop
    begin execute format('alter publication supabase_realtime add table public.%I',t);
    exception when duplicate_object or undefined_object then null; end;
  end loop;
end $$;
