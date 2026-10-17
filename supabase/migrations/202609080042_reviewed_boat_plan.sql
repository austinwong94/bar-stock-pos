-- A review represents one consistent snapshot, never a sequence of partial assignments.
create function public.confirm_sheet_boat_plan(p_date date,p_expected jsonb,p_lines jsonb,p_request_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare fingerprint text; prior public.operation_requests%rowtype; board jsonb; item jsonb; b public.bookings%rowtype; result uuid;
begin
 perform public.check_sheet_date(p_date);if not public.is_external_planner() then perform public.require_permission('fleet.assign');end if;
 perform pg_advisory_xact_lock(73081,1);
 fingerprint:=md5(jsonb_build_array(p_date,p_expected,p_lines)::text);
 if p_request_id is null then raise exception 'Save reference is required.';end if;
 select * into prior from public.operation_requests where actor_id=auth.uid() and operation='sheet_boat_plan' and request_id=p_request_id;
 if found then if prior.payload_hash<>fingerprint then raise exception 'Save reference changed.';end if;return prior.result_id;end if;
 board:=public.read_daily_booking_sheet(p_date);
 if p_expected is distinct from jsonb_build_object('bookings',board->'bookings','boats',board->'boats') then raise exception 'The boat plan changed on another device. Reopen the suggestion before confirming.' using errcode='40001';end if;
 if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 or jsonb_array_length(p_lines)>500 then raise exception 'Choose at least one booking.';end if;
 if (select count(*) from jsonb_array_elements(p_lines))<>(select count(distinct x->>'booking_id') from jsonb_array_elements(p_lines)x) then raise exception 'A booking appears twice in this plan.';end if;
 for item in select * from jsonb_array_elements(p_lines) loop
  select * into b from public.bookings where id=(item->>'booking_id')::uuid and service_date=p_date and status in ('draft','confirmed','arrived');
  if not found or exists(select 1 from public.trip_bookings where booking_id=b.id) then raise exception 'A booking is no longer waiting for a boat.';end if;
  if nullif(item->>'assignment_id','') is null then raise exception 'Select a boat for each submitted group.';end if;
  perform public.save_departure_assignment(p_date,b.id,b.updated_at,jsonb_build_object('assignment_id',item->>'assignment_id'),gen_random_uuid());
 end loop;
 result:=p_request_id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_json) values(auth.uid(),'confirmed_boat_plan','departure_plan',result,jsonb_build_object('service_date',p_date,'lines',p_lines));
 insert into public.operation_requests(actor_id,operation,request_id,payload_hash,result_id) values(auth.uid(),'sheet_boat_plan',p_request_id,fingerprint,result);
 return result;
end $$;
revoke all on function public.confirm_sheet_boat_plan(date,jsonb,jsonb,uuid) from public,anon;
grant execute on function public.confirm_sheet_boat_plan(date,jsonb,jsonb,uuid) to authenticated;

-- Preserve the legacy endpoint but reserve staff seats before choosing a boat.
create function public.boat_candidate_staff_pax(p_assignment uuid,p_guide uuid) returns int language sql stable security definer set search_path=public as $$
 select public.boat_staff_pax(p_assignment)+case when p_guide is not null and not exists(
  select 1 from public.boat_assignments a cross join lateral unnest(array[a.captain_employee_id,a.guide_employee_id]||a.crew_employee_ids||array(select b.guide_employee_id from public.trip_bookings tb join public.bookings b on b.id=tb.booking_id where tb.assignment_id=a.id)) member
  where a.id=p_assignment and member=p_guide) then 1 else 0 end
$$;
revoke all on function public.boat_candidate_staff_pax(uuid,uuid) from public,anon,authenticated;
do $$ declare definition text;begin
 select pg_get_functiondef('public.auto_seat_boats(date)'::regprocedure) into definition;
 definition:=replace(definition,'select b.id, b.pax_total','select b.id, b.pax_total, b.guide_employee_id');
 definition:=replace(definition,'bo.capacity_pax - coalesce(','least(43,bo.capacity_pax) - public.boat_candidate_staff_pax(a.id,rec.guide_employee_id) - coalesce(');
 definition:=replace(definition,'coalesce(a.status, ''planned'') <> ''cancelled''','coalesce(a.status, ''planned'') = ''planned''');
 execute definition;
end $$;
