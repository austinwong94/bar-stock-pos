-- Keep delivery evidence readable even after inventory or staff names change.
alter table public.purchase_receipts
  add column ingredient_name text,
  add column purchase_unit text,
  add column base_per_unit numeric,
  add column received_by_name text,
  add column details_backfilled boolean not null default false;

update public.purchase_receipts r set
  ingredient_name = (select name from public.ingredient_items where id=r.ingredient_id),
  purchase_unit = (select unit from public.purchase_request_items where id=r.purchase_item_id),
  received_by_name = (select full_name from public.profiles where id=r.received_by),
  base_per_unit = coalesce(
    (select pack_size_at_time from public.ingredient_movements where reference_type='purchase_receipt' and reference_id=r.id order by created_at limit 1),
    r.base_quantity/r.purchase_quantity),
  details_backfilled = true;

create index purchase_receipts_item_idx on public.purchase_receipts(purchase_item_id,received_at);

create function public.capture_purchase_receipt_details()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  new.ingredient_name := (select name from public.ingredient_items where id=new.ingredient_id);
  new.purchase_unit := (select unit from public.purchase_request_items where id=new.purchase_item_id);
  new.received_by_name := (select full_name from public.profiles where id=new.received_by);
  new.details_backfilled := false;
  return new;
end $$;
create trigger capture_purchase_receipt_details before insert on public.purchase_receipts
for each row execute function public.capture_purchase_receipt_details();
revoke all on function public.capture_purchase_receipt_details() from public,anon,authenticated;

do $$
declare definition text; updated text;
begin
  definition := pg_get_functiondef('public.receive_purchase_item(uuid,uuid,numeric,numeric,uuid,timestamptz)'::regprocedure);
  updated := replace(definition,'v_base:=round(p_quantity*p_base_per_unit,2);',
    'if round(p_quantity,2)<>p_quantity then raise exception ''Received quantity supports up to two decimal places.''; end if;
  v_base:=round(p_quantity*p_base_per_unit,2);');
  updated := replace(updated,'base_quantity,base_unit,received_by)',
    'base_quantity,base_unit,received_by,base_per_unit)');
  updated := replace(updated,'p_quantity,v_base,v_ingredient.base_unit,auth.uid())',
    'p_quantity,v_base,v_ingredient.base_unit,auth.uid(),p_base_per_unit)');
  updated := replace(updated,'v_receipt.base_quantity<>v_base',
    'v_receipt.base_quantity<>v_base or v_receipt.base_per_unit is distinct from p_base_per_unit');
  if updated=definition or position('auth.uid(),p_base_per_unit)' in updated)=0 then
    raise exception 'Expected delivery function signature was not found';
  end if;
  execute updated;
end $$;

do $$
declare definition text; updated text;
begin
  definition := pg_get_functiondef('public.set_purchase_item_status_checked(uuid,timestamptz,text,numeric,numeric,text,text)'::regprocedure);
  updated := replace(definition,'return public.set_purchase_item_status(',
    'if p_status=''bought'' and round(p_purchased_quantity,2)<>p_purchased_quantity then
    raise exception ''Bought quantity supports up to two decimal places.''; end if;
  if p_actual_cost is not null and round(p_actual_cost,2)<>p_actual_cost then
    raise exception ''Cost supports up to two decimal places.''; end if;
  return public.set_purchase_item_status(');
  if updated=definition then raise exception 'Expected checked purchasing function was not found'; end if;
  execute updated;
end $$;

-- This endpoint retains table RLS, filters before pagination, and never treats
-- "bought" as proof that stock physically arrived.
create function public.read_purchasing_queue(
  p_view text default 'open', p_query text default '',
  p_limit integer default 25, p_offset integer default 0
) returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare result jsonb; search_text text := lower(trim(coalesce(p_query,'')));
begin
  perform public.require_permission('purchasing.view');
  if p_view is null or p_view not in ('open','receiving','history') then raise exception 'Choose a valid purchase view.'; end if;
  if p_limit is null or p_limit<1 or p_limit>50 or p_offset is null or p_offset<0 then raise exception 'Invalid purchase page.'; end if;
  if length(search_text)>160 then raise exception 'Search is too long.'; end if;

  with classified as materialized (
    select r.*, state.pending_count, state.awaiting_count,
      r.status<>'cancelled' and (state.pending_count>0 or state.awaiting_count>0) as is_open,
      r.status<>'cancelled' and state.awaiting_count>0 as is_receiving
    from public.purchase_requests r
    cross join lateral (
      select count(*) filter(where i.purchase_status='pending') as pending_count,
        count(*) filter(where i.purchase_status='bought' and i.purchased_quantity>coalesce(
          (select sum(pr.purchase_quantity) from public.purchase_receipts pr where pr.purchase_item_id=i.id),0)) as awaiting_count
      from public.purchase_request_items i where i.request_id=r.id
    ) state
    where r.status<>'draft' and (search_text='' or
      strpos(lower(concat_ws(' ',r.request_no,r.purpose,r.notes,r.needed_for_date::text)),search_text)>0 or
      exists(select 1 from public.purchase_request_items i where i.request_id=r.id
        and strpos(lower(concat_ws(' ',i.item_name,i.supplier,i.note)),search_text)>0))
  ), filtered as (
    select * from classified where case p_view
      when 'open' then is_open when 'receiving' then is_receiving else not is_open end
  ), page as (
    select * from filtered
    order by case when p_view='history' then needed_for_date end desc,
      case when p_view<>'history' then needed_for_date end asc, id
    limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'counts', jsonb_build_object(
      'open',(select count(*) from classified where is_open),
      'receiving',(select count(*) from classified where is_receiving),
      'history',(select count(*) from classified where not is_open)),
    'requests', coalesce((select jsonb_agg(
      (to_jsonb(p)-'is_open'-'is_receiving'-'pending_count'-'awaiting_count') ||
      jsonb_build_object('purchase_request_items',coalesce((
        select jsonb_agg(
          (case when public.has_permission('purchasing.cost.view') then to_jsonb(i)
            else to_jsonb(i)-'actual_cost' end) ||
          jsonb_build_object('purchase_receipts',coalesce((
            select jsonb_agg(to_jsonb(pr) order by pr.received_at,pr.id)
            from public.purchase_receipts pr where pr.purchase_item_id=i.id
          ),'[]'::jsonb))
          order by i.sort_order,i.id)
        from public.purchase_request_items i where i.request_id=p.id
      ),'[]'::jsonb))
      order by case when p_view='history' then p.needed_for_date end desc,
        case when p_view<>'history' then p.needed_for_date end asc,p.id
    ) from page p),'[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function public.read_purchasing_queue(text,text,integer,integer) from public,anon;
grant execute on function public.read_purchasing_queue(text,text,integer,integer) to authenticated;

-- The dashboard must also count purchases that are bought but not delivered.
do $$
declare definition text; updated text;
begin
  definition := pg_get_functiondef('public.department_badges(date)'::regprocedure);
  updated := replace(definition,
    'select ''purchasing'', count(*)::int, ''request(s) waiting to be bought''
  from public.purchase_requests
  where status in (''submitted'', ''buying'') and public.has_permission(''purchasing.view'')',
    'select ''purchasing'', count(*)::int, ''request(s) awaiting purchase or delivery''
  from public.purchase_requests r
  where r.status not in (''draft'',''cancelled'') and public.has_permission(''purchasing.view'')
    and exists(select 1 from public.purchase_request_items i where i.request_id=r.id
      and (i.purchase_status=''pending'' or (i.purchase_status=''bought'' and i.purchased_quantity>
        coalesce((select sum(pr.purchase_quantity) from public.purchase_receipts pr where pr.purchase_item_id=i.id),0))))');
  if updated=definition then raise exception 'Expected purchasing badge query was not found'; end if;
  execute updated;
end $$;
