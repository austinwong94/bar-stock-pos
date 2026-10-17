-- One row per confirmed arrival. Older, ungrouped receipts remain visible.
create function public.read_delivery_records(
  p_request_id uuid, p_query text default '', p_limit integer default 10, p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb; search_text text := lower(trim(coalesce(p_query,'')));
begin
  perform public.require_permission('purchasing.view');
  if p_request_id is null then raise exception 'Choose a purchase request.'; end if;
  if p_limit is null or p_limit<1 or p_limit>50 or p_offset is null or p_offset<0 then raise exception 'Invalid delivery page.'; end if;
  if length(search_text)>160 then raise exception 'Search is too long.'; end if;
  with batches as materialized (
    select jsonb_build_object('id',a.id,'request_id',a.entity_id,'request_no',a.after_json->'request_no',
      'confirmed_at',a.after_json->'confirmed_at','confirmed_by',a.after_json->'confirmed_by',
      'confirmed_by_name',a.after_json->'confirmed_by_name','receipts',a.after_json->'receipts') as record
    from public.audit_logs a where a.entity_type='purchase_request' and a.entity_id=p_request_id and a.action='receive_purchase_batch'
  ), grouped_receipts as (
    select receipt->>'id' as id from batches b cross join lateral jsonb_array_elements(b.record->'receipts') receipt
  ), arrivals as (
    select record from batches
    union all
    select jsonb_build_object('id',r.id,'request_id',q.id,'request_no',q.request_no,
      'confirmed_at',r.received_at,'confirmed_by',r.received_by,'confirmed_by_name',r.received_by_name,
      'receipts',jsonb_build_array(to_jsonb(r)))
    from public.purchase_receipts r join public.purchase_request_items i on i.id=r.purchase_item_id
      join public.purchase_requests q on q.id=i.request_id
    where q.id=p_request_id and not exists(select 1 from grouped_receipts g where g.id=r.id::text)
  ), matching as materialized (
    select record from arrivals where search_text='' or
      strpos(lower(concat_ws(' ',record->>'id',record->>'confirmed_by_name')),search_text)>0 or
      strpos(lower(to_char((record->>'confirmed_at')::timestamptz at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD DD Mon YYYY HH24:MI')),
        replace(search_text,'sept','sep'))>0 or
      exists(select 1 from jsonb_array_elements(record->'receipts') r
        where strpos(lower(concat_ws(' ',r->>'ingredient_name',r->>'received_by_name')),search_text)>0)
  ), page as (
    select record from matching order by (record->>'confirmed_at')::timestamptz desc,record->>'id'
    limit p_limit offset p_offset
  )
  select jsonb_build_object('total',(select count(*) from matching),'records',
    coalesce((select jsonb_agg(record order by (record->>'confirmed_at')::timestamptz desc,record->>'id') from page),'[]'::jsonb)) into result;
  return result;
end $$;
revoke all on function public.read_delivery_records(uuid,text,integer,integer) from public,anon;
grant execute on function public.read_delivery_records(uuid,text,integer,integer) to authenticated;
