-- Read-only, bounded history. Cursor ties use the movement ID so no rows are skipped.
create index if not exists ingredient_movements_history_cursor_idx
  on public.ingredient_movements(created_at desc,id desc);

create function public.read_food_stock_history(
  p_start date, p_end date, p_search text default '', p_kind text default 'all',
  p_before_created_at timestamptz default null, p_before_id uuid default null, p_limit integer default 50
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  perform public.require_permission('kitchen.production.manage');
  if p_start is null or p_end is null or p_end <= p_start or p_end > p_start + 366 then
    raise exception 'Choose a valid history date range of up to one year.';
  end if;
  if p_kind is null or p_kind not in ('all','in','out','preparation','count')
    or p_limit is null or p_limit not between 1 and 100 or length(coalesce(p_search,'')) > 160
    or (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'Check the history filters.';
  end if;
  with page as materialized (
    select im.*,jsonb_build_object('name',i.name,'base_unit',i.base_unit) as ingredient_items
    from public.ingredient_movements im join public.ingredient_items i on i.id=im.ingredient_id
    where i.category in ('Food','Seafood','Condiment')
      and im.created_at >= (p_start::timestamp at time zone 'Asia/Kuala_Lumpur')
      and im.created_at < (p_end::timestamp at time zone 'Asia/Kuala_Lumpur')
      and (p_before_created_at is null or (im.created_at,im.id) < (p_before_created_at,p_before_id))
      and (p_kind='all' or (p_kind='in' and im.movement_type='stock_in')
        or (p_kind='out' and im.movement_type in ('waste','adjustment'))
        or (p_kind='preparation' and im.movement_type='kitchen_production')
        or (p_kind='count' and im.movement_type='count'))
      and strpos(lower(concat_ws(' ',i.name,im.entered_by,im.reason,im.notes,im.reference_id::text)),lower(trim(coalesce(p_search,''))))>0
    order by im.created_at desc,im.id desc limit p_limit+1
  ), visible as (select * from page order by created_at desc,id desc limit p_limit)
  select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at desc,v.id desc) from visible v),'[]'::jsonb),
    'next',case when (select count(*) from page)>p_limit then
      (select jsonb_build_object('created_at',v.created_at,'id',v.id) from visible v order by v.created_at,v.id limit 1)
      else null end
  ) into result;
  return result;
end; $$;
revoke all on function public.read_food_stock_history(date,date,text,text,timestamptz,uuid,integer) from public,anon;
grant execute on function public.read_food_stock_history(date,date,text,text,timestamptz,uuid,integer) to authenticated;
