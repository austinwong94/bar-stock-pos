-- Kitchen receives dietary requirements, never passport or unrelated medical data.
create table public.guest_meal_needs (
  tourist_id uuid primary key references public.tourists(id) on delete cascade,
  meal_preference text not null default 'unknown' check(meal_preference in ('unknown','standard','vegetarian','vegan','other')),
  allergy_status text not null default 'unknown' check(allergy_status in ('unknown','none_reported','reported')),
  allergens text[] not null default '{}',
  notes text not null default '',
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  check(allergy_status='reported' or cardinality(allergens)=0),
  check(allergy_status<>'reported' or cardinality(allergens)>0 or length(trim(notes))>0)
);
alter table public.guest_meal_needs enable row level security;
revoke all on public.guest_meal_needs from anon,authenticated;
insert into public.guest_meal_needs(tourist_id,notes)
  select tourist_id,dietary_notes from public.tourist_private where nullif(trim(dietary_notes),'') is not null;

create function public.can_manage_meal_needs(p_booking_id uuid) returns boolean language sql stable security definer set search_path=public as $$
  select public.has_permission('kitchen.production.manage') or
    ((public.has_permission('guests.booking.create') or public.has_permission('boarding.mark')) and public.can_view_booking(p_booking_id));
$$;

create function public.read_guest_meal_needs(p_date date) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  if not (public.has_permission('kitchen.production.manage') or public.has_permission('guests.booking.create') or public.has_permission('boarding.mark')) then raise exception 'Meal requirements access is required.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'tourist_id',t.id,'booking_id',b.id,'booking_ref',b.booking_ref,'lead_name',b.lead_name,'full_name',t.full_name,
    'meal_preference',coalesce(n.meal_preference,'unknown'),'allergy_status',coalesce(n.allergy_status,'unknown'),
    'allergens',coalesce(n.allergens,'{}'::text[]),'notes',coalesce(n.notes,''),
    'updated_at',n.updated_at,'updated_by',p.full_name,'reviewed_at',n.reviewed_at,'reviewed_by',r.full_name
  ) order by b.booking_ref,t.sort_order,t.id),'[]'::jsonb) into result
  from public.tourists t join public.bookings b on b.id=t.booking_id
  left join public.guest_meal_needs n on n.tourist_id=t.id
  left join public.profiles p on p.id=n.updated_by left join public.profiles r on r.id=n.reviewed_by
  where b.service_date=p_date and b.status not in ('cancelled','no_show') and public.can_manage_meal_needs(b.id);
  return result;
end; $$;

create function public.save_guest_meal_needs(p_tourist_id uuid,p_expected_updated_at timestamptz,p_details jsonb,p_request_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare old_row public.guest_meal_needs%rowtype; booking_id uuid; prior public.operation_requests%rowtype;
  hash text:=md5(p_tourist_id::text||coalesce(p_expected_updated_at::text,'')||p_details::text); choices text[];
begin
  select t.booking_id into booking_id from public.tourists t where t.id=p_tourist_id;
  if booking_id is null or not public.can_manage_meal_needs(booking_id) then raise exception 'Meal requirements access is required.'; end if;
  if p_request_id is null then raise exception 'A save reference is required.'; end if;
  perform pg_advisory_xact_lock(73081,1);
  select * into prior from public.operation_requests where actor_id=auth.uid() and operation='guest_meal_needs' and request_id=p_request_id;
  if found then
    if prior.payload_hash<>hash then raise exception 'This save already succeeded with different details. Close and reopen this guest.'; end if;
    return prior.result_id;
  end if;
  select * into old_row from public.guest_meal_needs where tourist_id=p_tourist_id for update;
  if old_row.updated_at is distinct from p_expected_updated_at then raise exception 'Meal requirements changed on another device. Close and reopen this guest.'; end if;
  if coalesce(p_details->>'meal_preference','') not in ('unknown','standard','vegetarian','vegan','other') or coalesce(p_details->>'allergy_status','') not in ('unknown','none_reported','reported') then raise exception 'Choose a valid meal and allergy status.'; end if;
  select coalesce(array_agg(distinct trim(value)),'{}') into choices from jsonb_array_elements_text(coalesce(p_details->'allergens','[]')) where trim(value)<>'';
  if cardinality(choices)>32 or exists(select 1 from unnest(choices) x where length(x)>80) or length(coalesce(p_details->>'notes',''))>2000 then raise exception 'Meal requirements are too long.'; end if;
  if p_details->>'allergy_status'='reported' and cardinality(choices)=0 and nullif(trim(p_details->>'notes'),'') is null then raise exception 'Name the reported allergy.'; end if;
  if p_details->>'allergy_status'<>'reported' then choices:='{}'; end if;
  insert into public.guest_meal_needs(tourist_id,meal_preference,allergy_status,allergens,notes,updated_by)
  values(p_tourist_id,p_details->>'meal_preference',p_details->>'allergy_status',choices,trim(coalesce(p_details->>'notes','')),auth.uid())
  on conflict(tourist_id) do update set meal_preference=excluded.meal_preference,allergy_status=excluded.allergy_status,allergens=excluded.allergens,notes=excluded.notes,
    updated_by=auth.uid(),updated_at=greatest(clock_timestamp(),guest_meal_needs.updated_at+interval '1 microsecond'),reviewed_by=null,reviewed_at=null;
  insert into public.operation_requests(actor_id,operation,request_id,payload_hash,result_id) values(auth.uid(),'guest_meal_needs',p_request_id,hash,p_tourist_id);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_json,after_json)
  values(auth.uid(),'save_guest_meal_needs','guest_meal_needs',p_tourist_id,to_jsonb(old_row),p_details);
  return p_tourist_id;
end; $$;

create function public.review_guest_meal_needs(p_tourist_id uuid,p_expected_updated_at timestamptz)
returns void language plpgsql security definer set search_path=public as $$
declare n public.guest_meal_needs%rowtype;
begin
  perform public.require_permission('kitchen.production.manage');
  select * into n from public.guest_meal_needs where tourist_id=p_tourist_id for update;
  if not found or n.updated_at is distinct from p_expected_updated_at then raise exception 'Meal requirements changed. Refresh before reviewing.'; end if;
  if n.meal_preference='unknown' or n.allergy_status='unknown' then raise exception 'Confirm meal and allergy requirements with the guest first.'; end if;
  if n.reviewed_at is not null then return; end if;
  update public.guest_meal_needs set reviewed_at=clock_timestamp(),reviewed_by=auth.uid() where tourist_id=p_tourist_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_json) values(auth.uid(),'review_guest_meal_needs','guest_meal_needs',p_tourist_id,jsonb_build_object('reviewed_version',p_expected_updated_at));
end; $$;
revoke all on function public.can_manage_meal_needs(uuid),public.read_guest_meal_needs(date),public.save_guest_meal_needs(uuid,timestamptz,jsonb,uuid),public.review_guest_meal_needs(uuid,timestamptz) from public,anon;
grant execute on function public.read_guest_meal_needs(date),public.save_guest_meal_needs(uuid,timestamptz,jsonb,uuid),public.review_guest_meal_needs(uuid,timestamptz) to authenticated;
