-- A purchase is not available inventory until its delivery is confirmed.
create table public.purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  purchase_item_id uuid not null references public.purchase_request_items(id),
  ingredient_id uuid not null references public.ingredient_items(id),
  request_id uuid not null,
  purchase_quantity numeric(14,2) not null check (purchase_quantity > 0),
  base_quantity numeric(14,2) not null check (base_quantity > 0),
  base_unit text not null check (base_unit in ('ml','g','unit')),
  received_by uuid not null references public.profiles(id),
  received_at timestamptz not null default now(),
  unique(received_by,request_id)
);
alter table public.purchase_receipts enable row level security;
grant select on public.purchase_receipts to authenticated;
create policy receipt_read on public.purchase_receipts for select to authenticated
  using(public.has_permission('purchasing.view') or public.has_permission('kitchen.production.manage') or public.has_permission('bar.reports.view'));

create or replace function public.receive_purchase_item(
  p_item_id uuid, p_ingredient_id uuid, p_quantity numeric, p_base_per_unit numeric,
  p_request_id uuid, p_expected_updated_at timestamptz
) returns public.purchase_receipts language plpgsql security definer set search_path=public as $$
declare
  v_item public.purchase_request_items%rowtype;
  v_ingredient public.ingredient_items%rowtype;
  v_receipt public.purchase_receipts%rowtype;
  v_received numeric; v_before numeric; v_base numeric;
begin
  perform public.require_permission('purchasing.receive');
  perform pg_advisory_xact_lock(73081,1);
  if p_request_id is null or p_quantity is null or p_base_per_unit is null
    or p_quantity<=0 or p_base_per_unit<=0 or p_quantity::text='NaN' or p_base_per_unit::text='NaN'
    then raise exception 'Enter the received quantity and its unit size.'; end if;
  v_base:=round(p_quantity*p_base_per_unit,2);
  select * into v_receipt from public.purchase_receipts where received_by=auth.uid() and request_id=p_request_id;
  if found then
    if v_receipt.purchase_item_id<>p_item_id or v_receipt.ingredient_id<>p_ingredient_id
      or v_receipt.purchase_quantity<>p_quantity or v_receipt.base_quantity<>v_base
      then raise exception 'This receipt has already been saved with different details.'; end if;
    return v_receipt;
  end if;
  select * into v_item from public.purchase_request_items where id=p_item_id for update;
  if not found or v_item.purchase_status<>'bought' then raise exception 'Mark the item as bought before receiving it.'; end if;
  if v_item.updated_at is distinct from p_expected_updated_at then
    raise exception 'The purchase changed on another device. Refresh before receiving it.' using errcode='40001'; end if;
  if exists(select 1 from public.purchase_requests where id=v_item.request_id and status in ('draft','cancelled'))
    then raise exception 'This request cannot receive stock.'; end if;
  select coalesce(sum(purchase_quantity),0) into v_received from public.purchase_receipts where purchase_item_id=p_item_id;
  if v_received+p_quantity>v_item.purchased_quantity then raise exception 'Received quantity exceeds the amount bought.'; end if;
  select * into v_ingredient from public.ingredient_items where id=p_ingredient_id and active for update;
  if not found then raise exception 'Choose an active inventory ingredient.'; end if;
  if v_base<=0 or (v_ingredient.base_unit='unit' and v_base<>trunc(v_base)) then
    raise exception 'Individual items must be received in whole units.'; end if;
  insert into public.ingredient_balances(ingredient_id,quantity_on_hand) values(p_ingredient_id,0) on conflict do nothing;
  select quantity_on_hand into v_before from public.ingredient_balances where ingredient_id=p_ingredient_id for update;
  insert into public.purchase_receipts(purchase_item_id,ingredient_id,request_id,purchase_quantity,base_quantity,base_unit,received_by)
    values(p_item_id,p_ingredient_id,p_request_id,p_quantity,v_base,v_ingredient.base_unit,auth.uid()) returning * into v_receipt;
  update public.ingredient_balances set quantity_on_hand=v_before+v_base,updated_at=clock_timestamp() where ingredient_id=p_ingredient_id;
  insert into public.ingredient_movements(ingredient_id,movement_type,quantity_change,quantity_before,quantity_after,
    unit_input,input_quantity,pack_size_at_time,reference_type,reference_id,reason,entered_by,created_by)
  values(p_ingredient_id,'stock_in',v_base,v_before,v_before+v_base,v_item.unit,p_quantity,p_base_per_unit,
    'purchase_receipt',v_receipt.id,v_item.supplier,(select full_name from public.profiles where id=auth.uid()),auth.uid());
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_json)
    values(auth.uid(),'receive_purchase_item','purchase_receipt',v_receipt.id,to_jsonb(v_receipt));
  return v_receipt;
end $$;
revoke all on function public.receive_purchase_item(uuid,uuid,numeric,numeric,uuid,timestamptz) from public,anon;
grant execute on function public.receive_purchase_item(uuid,uuid,numeric,numeric,uuid,timestamptz) to authenticated;

create or replace function public.protect_received_purchase()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from public.purchase_receipts where purchase_item_id=old.id) and
    (tg_op='DELETE' or new.purchase_status is distinct from old.purchase_status
      or new.purchased_quantity is distinct from old.purchased_quantity
      or new.unit is distinct from old.unit or new.item_name is distinct from old.item_name)
    then raise exception 'This purchase has received stock. Use an inventory correction with a reason.'; end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger protect_received_purchase before update or delete on public.purchase_request_items
for each row execute function public.protect_received_purchase();

create or replace function public.set_purchase_item_status_checked(
  p_item_id uuid,p_expected_updated_at timestamptz,p_status text,
  p_purchased_quantity numeric default null,p_actual_cost numeric default null,
  p_supplier text default null,p_note text default null
) returns int language plpgsql security definer set search_path=public as $$
declare v_item public.purchase_request_items%rowtype;
begin
  perform public.require_permission('purchasing.fulfil');
  perform pg_advisory_xact_lock(73081,1);
  select * into v_item from public.purchase_request_items where id=p_item_id for update;
  if not found or v_item.updated_at is distinct from p_expected_updated_at then
    raise exception 'This purchase changed on another device. Refresh before saving.' using errcode='40001'; end if;
  if not exists(select 1 from public.purchase_requests where id=v_item.request_id and status in ('submitted','buying','completed'))
    then raise exception 'This request is not open for purchasing.'; end if;
  if p_status='bought' and (p_purchased_quantity is null or p_purchased_quantity<=0 or p_purchased_quantity::text='NaN')
    then raise exception 'Enter a positive quantity bought.'; end if;
  if p_actual_cost is not null and (p_actual_cost<0 or p_actual_cost::text='NaN') then raise exception 'Cost must be zero or greater.'; end if;
  return public.set_purchase_item_status(array[p_item_id],p_status,p_purchased_quantity,p_actual_cost,p_supplier,p_note);
end $$;
revoke all on function public.set_purchase_item_status(uuid[],text,numeric,numeric,text,text) from public,anon,authenticated;
revoke all on function public.set_purchase_item_status_checked(uuid,timestamptz,text,numeric,numeric,text,text) from public,anon;
grant execute on function public.set_purchase_item_status_checked(uuid,timestamptz,text,numeric,numeric,text,text) to authenticated;

-- Aggregate repeated ingredient lines BEFORE checking and deducting stock.
create or replace function public.submit_kitchen_production(
  p_business_date date,p_platter_name text,p_platter_count numeric,p_submitted_by text,p_items jsonb,
  p_serving_basis text default 'pax',p_notes text default null
) returns public.kitchen_production_reports language plpgsql security definer set search_path=public as $$
declare v_report public.kitchen_production_reports%rowtype; v_usage record; v_before numeric; v_total numeric;
begin
  perform public.require_permission('kitchen.production.manage');
  if p_business_date is null or nullif(trim(p_platter_name),'') is null or nullif(trim(p_submitted_by),'') is null
    then raise exception 'Enter a date, platter name and submitted by.'; end if;
  if p_platter_count is null or p_platter_count<=0 or p_platter_count<>trunc(p_platter_count) or p_platter_count::text='NaN'
    then raise exception 'Enter a whole number of platters.'; end if;
  if p_serving_basis not in ('pax','table','batch') or p_serving_basis is null then raise exception 'Choose a serving basis.'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Add the ingredients used.'; end if;
  if exists(select 1 from jsonb_to_recordset(p_items) x(ingredient_id uuid,quantity_per_platter numeric)
    left join public.ingredient_items i on i.id=x.ingredient_id and i.active
    where i.id is null or x.quantity_per_platter is null or x.quantity_per_platter<=0 or x.quantity_per_platter::text='NaN'
      or (i.base_unit='unit' and x.quantity_per_platter*p_platter_count<>trunc(x.quantity_per_platter*p_platter_count)))
    then raise exception 'Each ingredient needs a positive quantity in its inventory unit.'; end if;
  -- All writers lock ingredient rows in the same order, then their balances.
  perform 1 from public.ingredient_items i where i.id in
    (select x.ingredient_id from jsonb_to_recordset(p_items) x(ingredient_id uuid)) order by i.id for update;
  insert into public.ingredient_balances(ingredient_id,quantity_on_hand)
    select distinct x.ingredient_id,0 from jsonb_to_recordset(p_items) x(ingredient_id uuid) on conflict do nothing;
  perform 1 from public.ingredient_balances b where b.ingredient_id in
    (select x.ingredient_id from jsonb_to_recordset(p_items) x(ingredient_id uuid)) order by b.ingredient_id for update;
  insert into public.kitchen_production_reports(business_date,platter_name,platter_count,serving_basis,submitted_by,notes,created_by)
    values(p_business_date,trim(p_platter_name),p_platter_count,p_serving_basis,trim(p_submitted_by),p_notes,auth.uid()) returning * into v_report;
  for v_usage in select x.ingredient_id,sum(x.quantity_per_platter) as per_platter,i.base_unit
    from jsonb_to_recordset(p_items) x(ingredient_id uuid,quantity_per_platter numeric)
    join public.ingredient_items i on i.id=x.ingredient_id group by x.ingredient_id,i.base_unit order by x.ingredient_id
  loop
    v_total:=round(v_usage.per_platter*p_platter_count,2);
    select b.quantity_on_hand into v_before from public.ingredient_balances b where b.ingredient_id=v_usage.ingredient_id;
    if v_total<=0 or v_before<v_total then raise exception 'Insufficient ingredient stock. Receive stock or correct the quantities.'; end if;
    insert into public.kitchen_production_items(report_id,ingredient_id,quantity_per_platter,total_quantity,unit)
      values(v_report.id,v_usage.ingredient_id,v_usage.per_platter,v_total,v_usage.base_unit);
    update public.ingredient_balances b set quantity_on_hand=v_before-v_total,updated_at=clock_timestamp() where b.ingredient_id=v_usage.ingredient_id;
    insert into public.ingredient_movements(ingredient_id,movement_type,quantity_change,quantity_before,quantity_after,
      unit_input,input_quantity,reference_type,reference_id,reason,notes,entered_by,created_by)
    values(v_usage.ingredient_id,'kitchen_production',-v_total,v_before,v_before-v_total,
      v_usage.base_unit,v_total,'kitchen_production',v_report.id,p_platter_name,p_notes,p_submitted_by,auth.uid());
  end loop;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_json)
    values(auth.uid(),'submit_kitchen_production','kitchen_production_report',v_report.id,to_jsonb(v_report));
  return v_report;
end $$;

create or replace function public.submit_kitchen_production_checked(
  p_business_date date,p_platter_name text,p_platter_count numeric,p_submitted_by text,p_items jsonb,
  p_serving_basis text,p_notes text,p_request_id uuid
) returns public.kitchen_production_reports language plpgsql security definer set search_path=public as $$
declare v_previous public.operation_requests%rowtype; v_report public.kitchen_production_reports%rowtype; v_hash text;
begin
  perform public.require_permission('kitchen.production.manage');
  if p_request_id is null then raise exception 'A submission reference is required.'; end if;
  perform pg_advisory_xact_lock(73081,1);
  v_hash:=md5(jsonb_build_array(p_business_date,p_platter_name,p_platter_count,p_submitted_by,p_items,p_serving_basis,p_notes)::text);
  select * into v_previous from public.operation_requests where actor_id=auth.uid() and operation='kitchen_production' and request_id=p_request_id;
  if found then
    if v_previous.payload_hash<>v_hash then raise exception 'This submission was already saved. Refresh to enter another batch.'; end if;
    select * into v_report from public.kitchen_production_reports where id=v_previous.result_id;
    return v_report;
  end if;
  v_report:=public.submit_kitchen_production(p_business_date,p_platter_name,p_platter_count,p_submitted_by,p_items,p_serving_basis,p_notes);
  insert into public.operation_requests(actor_id,operation,request_id,payload_hash,result_id)
    values(auth.uid(),'kitchen_production',p_request_id,v_hash,v_report.id);
  return v_report;
end $$;
revoke all on function public.submit_kitchen_production_checked(date,text,numeric,text,jsonb,text,text,uuid) from public,anon;
grant execute on function public.submit_kitchen_production_checked(date,text,numeric,text,jsonb,text,text,uuid) to authenticated;
do $$ begin
  alter publication supabase_realtime add table public.purchase_receipts;
exception when duplicate_object or undefined_object then null; end $$;
