-- Read-only drilldown: a checker's item ledger does not expose purchase prices.
create index if not exists ingredient_movements_item_cursor_idx
  on public.ingredient_movements(ingredient_id, created_at desc, id desc);

create or replace function public.read_food_item_history(
  p_ingredient_id uuid, p_anchor_id uuid default null,
  p_before_created_at timestamptz default null, p_before_id uuid default null,
  p_limit integer default 50
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  food public.ingredient_items;
  anchor_time timestamptz;
  result jsonb;
begin
  if (public.has_permission('kitchen.production.manage')
    or public.has_permission('purchasing.receive') or public.has_permission('kitchen.stock.count')) is not true then
    raise exception 'Kitchen access required.' using errcode='42501';
  end if;
  if p_ingredient_id is null or p_limit is null or p_limit not between 1 and 100
    or (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'Check the item history filters.';
  end if;
  select * into food from public.ingredient_items where id=p_ingredient_id and category in ('Food','Seafood','Condiment');
  if not found then raise exception 'This food item is unavailable.'; end if;
  if p_anchor_id is not null then
    select created_at into anchor_time from public.ingredient_movements
      where id=p_anchor_id and ingredient_id=p_ingredient_id;
    if not found then raise exception 'This stock record is unavailable. Refresh the history.'; end if;
  end if;

  -- Explicit fields keep future financial columns out of this operational view.
  with safe_rows as not materialized (
    select im.id, im.ingredient_id, im.movement_type, im.quantity_change, im.quantity_before, im.quantity_after,
      im.display_unit, im.display_factor, im.entered_by, im.reason, im.notes,
      im.reference_type, im.reference_id, im.created_at,
      jsonb_build_object('name',food.name,'kitchen_label',food.kitchen_label,'base_unit',food.base_unit) as ingredient_items
    from public.ingredient_movements im where im.ingredient_id=p_ingredient_id
  ), page as materialized (
    select * from safe_rows
    where (p_anchor_id is null or (created_at,id) <= (anchor_time,p_anchor_id))
      and (p_before_created_at is null or (created_at,id) < (p_before_created_at,p_before_id))
    order by created_at desc,id desc limit p_limit+1
  ), visible as (select * from page order by created_at desc,id desc limit p_limit)
  select jsonb_build_object(
    'item',jsonb_build_object('id',food.id,'name',food.name,'kitchen_label',food.kitchen_label,'base_unit',food.base_unit),
    'anchor',(select to_jsonb(s) from safe_rows s where s.id=p_anchor_id),
    'rows',coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at desc,v.id desc) from visible v),'[]'::jsonb),
    'next',case when (select count(*) from page)>p_limit then
      (select jsonb_build_object('created_at',v.created_at,'id',v.id) from visible v order by v.created_at,v.id limit 1)
      else null end
  ) into result;
  return result;
end; $$;

revoke all on function public.read_food_item_history(uuid,uuid,timestamptz,uuid,integer) from public,anon;
grant execute on function public.read_food_item_history(uuid,uuid,timestamptz,uuid,integer) to authenticated;
