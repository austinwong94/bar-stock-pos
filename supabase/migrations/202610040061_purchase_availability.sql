-- Availability is not a purchase. Preserve actual purchases and delivery evidence.
begin;
create or replace function public.set_purchase_item_status_checked(
  p_item_id uuid,p_expected_updated_at timestamptz,p_status text,
  p_purchased_quantity numeric default null,p_actual_cost numeric default null,
  p_supplier text default null,p_note text default null
) returns int language plpgsql security definer set search_path=public as $$
declare item public.purchase_request_items%rowtype; parent public.purchase_requests%rowtype; prior jsonb;
begin
  perform public.require_permission('purchasing.fulfil');
  if p_status is null or p_status not in('pending','unavailable') then raise exception 'Use Record Purchases and attach both photos.';end if;
  if p_purchased_quantity is not null or p_actual_cost is not null then raise exception 'Availability changes cannot record quantities or costs.';end if;
  perform pg_advisory_xact_lock(73081,1);
  select r.* into parent from public.purchase_requests r join public.purchase_request_items i on i.request_id=r.id where i.id=p_item_id for update of r;
  if not found or parent.status not in('submitted','buying','completed') then raise exception 'Request is no longer available.' using errcode='40001';end if;
  select * into item from public.purchase_request_items where id=p_item_id for update;
  if item.updated_at is distinct from p_expected_updated_at or p_expected_updated_at is null then raise exception 'Item changed on another device. Refresh before editing.' using errcode='40001';end if;
  if (item.purchase_status='bought' and coalesce(item.purchased_quantity,0)>0)
    or exists(select 1 from public.purchase_receipts where purchase_item_id=item.id)
    or exists(select 1 from public.audit_logs a where a.action='record_purchase_batch' and a.entity_id=parent.id
      and exists(select 1 from jsonb_array_elements(coalesce(a.after_json->'items','[]')) l where l->>'id'=item.id::text))
    then raise exception 'Recorded purchases cannot be cleared. The outstanding quantity stays open.';end if;
  prior:=to_jsonb(item);
  update public.purchase_request_items set purchase_status=p_status,purchased_quantity=null,actual_cost=null,
    purchased_by=null,purchased_at=null,supplier=null,purchase_note=nullif(trim(p_note),''),updated_at=clock_timestamp()
    where id=item.id returning * into item;
  update public.purchase_requests set status='buying',completed_at=null,updated_at=clock_timestamp() where id=parent.id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_json,after_json)
    values(auth.uid(),'purchase_availability','purchase_request_item',item.id,prior,to_jsonb(item));
  return 1;
end $$;
revoke all on function public.set_purchase_item_status_checked(uuid,timestamptz,text,numeric,numeric,text,text) from public,anon;
grant execute on function public.set_purchase_item_status_checked(uuid,timestamptz,text,numeric,numeric,text,text) to authenticated;
commit;
