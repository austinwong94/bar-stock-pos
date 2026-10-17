-- Guest and staff meals share the same ingredient balances. Older records remain unclassified.
alter table public.kitchen_production_reports add column if not exists meal_purpose text
  check (meal_purpose in ('guest_meals','staff_meals'));
alter table public.kitchen_production_reports add column if not exists meals_prepared integer
  check (meals_prepared > 0);

create or replace function public.record_kitchen_usage_checked(
  p_items jsonb,p_business_date date,p_purpose text,p_meal text,p_portions integer,p_notes text,p_request_id uuid
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_previous public.operation_requests%rowtype; v_report public.kitchen_production_reports%rowtype;
  v_hash text; v_actor text; v_item jsonb; v_ingredient public.ingredient_items%rowtype;
  v_quantity numeric; v_items jsonb; v_name text;
begin
  perform public.require_permission('kitchen.production.manage');
  if p_request_id is null or auth.uid() is null then raise exception 'A signed-in user and submission reference are required.'; end if;
  perform pg_advisory_xact_lock(73081,1);
  v_hash:=md5(jsonb_build_array(p_items,p_business_date,p_purpose,p_meal,p_portions,p_notes)::text);
  select * into v_previous from public.operation_requests where actor_id=auth.uid() and operation='kitchen_meal_usage' and request_id=p_request_id;
  if found then
    if v_previous.payload_hash is distinct from v_hash then raise exception 'This usage already succeeded with different details. Check history.'; end if;
    return v_previous.result_id;
  end if;
  if p_purpose is null or p_purpose not in ('guest_meals','staff_meals') then raise exception 'Choose guest meals or staff meals.'; end if;
  if p_business_date is null or p_business_date>(now() at time zone 'Asia/Kuala_Lumpur')::date then raise exception 'Choose today or a past usage date.'; end if;
  if p_portions is not null and p_portions<=0 then raise exception 'Enter a positive number of meals, or leave it blank.'; end if;
  if length(coalesce(p_meal,''))>120 or length(coalesce(p_notes,''))>2000 then raise exception 'Shorten the meal name or notes.'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 200 then raise exception 'Choose between 1 and 200 food items.'; end if;
  if (select count(distinct i->>'ingredient_id') from jsonb_array_elements(p_items) i)<>jsonb_array_length(p_items) then raise exception 'An item appears twice.'; end if;
  -- Lock all ingredient rows before the core transaction locks any balances.
  perform 1 from public.ingredient_items i where i.id in (select (j->>'ingredient_id')::uuid from jsonb_array_elements(p_items) j) order by i.id for update;
  for v_item in select j from jsonb_array_elements(p_items) j loop
    select * into v_ingredient from public.ingredient_items where id=(v_item->>'ingredient_id')::uuid and active and category in ('Food','Seafood','Condiment');
    if not found then raise exception 'A food item is unavailable. Refresh and review.'; end if;
    if v_ingredient.base_unit is distinct from v_item->>'expected_base_unit' then raise exception 'The inventory unit changed. Refresh and review.'; end if;
    v_quantity:=(v_item->>'quantity')::numeric;
    if v_quantity is null or v_quantity::text in ('NaN','Infinity','-Infinity') or v_quantity<=0 or v_quantity>1e9 or v_quantity<>round(v_quantity,2)
      or (v_ingredient.base_unit='unit' and v_quantity<>trunc(v_quantity)) then raise exception 'Enter a positive quantity in the displayed unit.'; end if;
  end loop;
  select nullif(trim(full_name),'') into v_actor from public.profiles where id=auth.uid();
  if v_actor is null then raise exception 'Your staff profile needs a name before recording usage.'; end if;
  v_name:=case p_purpose when 'staff_meals' then 'Staff Meals' else 'Guest Meals' end;
  if nullif(trim(p_meal),'') is not null then v_name:=v_name||' / '||trim(p_meal); end if;
  select jsonb_agg(jsonb_build_object('ingredient_id',j->>'ingredient_id','quantity_per_platter',(j->>'quantity')::numeric)) into v_items from jsonb_array_elements(p_items) j;
  -- Actual batch totals are never multiplied by the optional number of meals.
  v_report:=public.submit_kitchen_production(p_business_date,v_name,1,v_actor,v_items,'batch',p_notes);
  update public.kitchen_production_reports set meal_purpose=p_purpose,meals_prepared=p_portions where id=v_report.id returning * into v_report;
  insert into public.operation_requests(actor_id,operation,request_id,payload_hash,result_id)
    values(auth.uid(),'kitchen_meal_usage',p_request_id,v_hash,v_report.id);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_json)
    values(auth.uid(),'record_kitchen_usage','kitchen_production_report',v_report.id,to_jsonb(v_report));
  return v_report.id;
end $$;
revoke all on function public.record_kitchen_usage_checked(jsonb,date,text,text,integer,text,uuid) from public,anon;
grant execute on function public.record_kitchen_usage_checked(jsonb,date,text,text,integer,text,uuid) to authenticated;
