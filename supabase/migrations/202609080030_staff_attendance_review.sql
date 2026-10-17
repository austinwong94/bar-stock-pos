-- Mobile attendance writes compare the displayed state before changing it.
create or replace function public.record_staff_attendance_checked(p_date date,p_action text,p_value jsonb,p_expected jsonb,p_request_id uuid)
returns integer language plpgsql volatile security definer set search_path=public as $$
declare expected jsonb; passenger public.trip_passengers%rowtype; assignment_date date;
  ids uuid[]:='{}'; current_state jsonb; previous public.operation_requests%rowtype; payload text; val text;
begin
  if p_action='boarding' then perform public.require_permission('boarding.mark');
  elsif p_action='activity' then perform public.require_permission('activities.select');
  elsif p_action in ('joined','returned') then perform public.require_permission('activities.mark');
  else raise exception 'Unknown attendance action.'; end if;
  perform pg_advisory_xact_lock(73081,1);
  if p_date is null or p_request_id is null or jsonb_typeof(p_expected) is distinct from 'array' or jsonb_array_length(p_expected)=0 then raise exception 'Choose guests and a service date.'; end if;
  payload:=md5(p_date::text||p_action||coalesce(p_value::text,'null')||p_expected::text);
  select * into previous from public.operation_requests where actor_id=auth.uid() and operation='staff_attendance' and request_id=p_request_id;
  if found then
    if previous.payload_hash<>payload then raise exception 'This attendance reference was already used.'; end if;
    return jsonb_array_length(p_expected);
  end if;
  for expected in select * from jsonb_array_elements(p_expected) loop
    select * into passenger from public.trip_passengers where id=(expected->>'id')::uuid for update;
    if not found or not public.can_see_assignment(passenger.assignment_id) then raise exception 'You cannot update this guest.' using errcode='42501'; end if;
    if passenger.id=any(ids) then raise exception 'A guest cannot appear twice.'; end if;
    select service_date into assignment_date from public.boat_assignments where id=passenger.assignment_id;
    if assignment_date<>p_date then raise exception 'The service date changed. Refresh the list.'; end if;
    current_state:=jsonb_build_object('id',passenger.id,'assignment_id',passenger.assignment_id,'boarding_status',passenger.boarding_status,'activity_code',passenger.activity_code,'activity_status',passenger.activity_status,'returned',passenger.returned);
    if current_state is distinct from expected then raise exception 'Attendance changed on another device. Refresh and check the guest again.'; end if;
    if p_action<>'boarding' and passenger.boarding_status<>'arrived' then raise exception 'Check the guest in before recording activity attendance.'; end if;
    if p_action='boarding' and p_value #>> '{}' <> 'arrived' and (passenger.activity_status='joined' or passenger.returned) then raise exception 'Correct activity and return attendance before changing check-in.'; end if;
    if p_action='activity' and (passenger.activity_status='joined' or passenger.returned) then raise exception 'Correct the existing activity attendance before changing the activity.'; end if;
    if p_action='joined' and p_value #>> '{}'='joined' and passenger.activity_code is null then raise exception 'Choose an activity first.'; end if;
    ids:=array_append(ids,passenger.id);
  end loop;
  val:=p_value #>> '{}';
  if p_action='boarding' then
    if val is null or val not in ('pending','arrived','no_show') then raise exception 'Invalid check-in status.'; end if;
    perform public.mark_boarding(ids,val);
  elsif p_action='activity' then perform public.set_passenger_activity(ids,val);
  elsif p_action='joined' then
    if val is null or val not in ('pending','joined','absent') then raise exception 'Invalid activity attendance status.'; end if;
    perform public.mark_activity_attendance(ids,val,null);
  else
    if jsonb_typeof(p_value) is distinct from 'boolean' then raise exception 'Return attendance must be true or false.'; end if;
    perform public.mark_activity_attendance(ids,null,val::boolean);
  end if;
  insert into public.operation_requests(actor_id,operation,request_id,payload_hash,result_id) values(auth.uid(),'staff_attendance',p_request_id,payload,p_request_id);
  return cardinality(ids);
end;
$$;
revoke all on function public.record_staff_attendance_checked(date,text,jsonb,jsonb,uuid) from public,anon;
grant execute on function public.record_staff_attendance_checked(date,text,jsonb,jsonb,uuid) to authenticated;

create or replace function public.assign_booking_to_boat_checked(p_booking_id uuid,p_expected_assignment_id uuid,p_assignment_id uuid,p_expected_pax integer)
returns void language plpgsql volatile security definer set search_path=public as $$
declare current_assignment uuid; current_pax integer;
begin
  perform public.require_permission('fleet.assign');
  perform pg_advisory_xact_lock(73081,1);
  select pax_total into current_pax from public.bookings where id=p_booking_id for update;
  if not found then raise exception 'Booking not found.'; end if;
  select assignment_id into current_assignment from public.trip_bookings where booking_id=p_booking_id;
  if current_assignment is distinct from p_expected_assignment_id or current_pax is distinct from p_expected_pax then
    raise exception 'This group changed on another device. Refresh the boat board.';
  end if;
  if current_assignment is not distinct from p_assignment_id then return; end if;
  if exists(select 1 from public.trip_passengers where booking_id=p_booking_id
    and (boarding_status<>'pending' or activity_code is not null or activity_status<>'pending' or returned)) then
    raise exception 'Attendance is already recorded for this group. Review its attendance before changing boats.';
  end if;
  if p_assignment_id is null then perform public.unassign_booking(p_booking_id);
  else perform public.assign_booking_to_boat(p_booking_id,p_assignment_id); end if;
end;
$$;
revoke all on function public.assign_booking_to_boat_checked(uuid,uuid,uuid,integer) from public,anon;
grant execute on function public.assign_booking_to_boat_checked(uuid,uuid,uuid,integer) to authenticated;

create or replace function public.set_trip_crew_checked(p_assignment_id uuid,p_expected jsonb,p_captain uuid,p_guide uuid,p_departure text)
returns void language plpgsql volatile security definer set search_path=public as $$
declare trip public.boat_assignments%rowtype;
begin
  perform public.require_permission('fleet.crew.assign');
  perform pg_advisory_xact_lock(73081,1);
  select * into trip from public.boat_assignments where id=p_assignment_id for update;
  if not found then raise exception 'That boat trip does not exist.'; end if;
  if jsonb_build_object('captain',trip.captain_employee_id,'guide',trip.guide_employee_id,'departure',to_char(trip.departure_time,'HH24:MI')) is distinct from p_expected then
    raise exception 'Crew changed on another device. Close this form and review the latest crew.';
  end if;
  if trip.locked then raise exception 'Unlock the day before changing the crew.'; end if;
  if p_captain is not null and not exists(select 1 from public.employees where id=p_captain and active and job_type='captain') then raise exception 'Choose an active captain.'; end if;
  if p_guide is not null and not exists(select 1 from public.employees where id=p_guide and active and job_type='guide') then raise exception 'Choose an active guide.'; end if;
  if p_departure is not null and p_departure !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Enter a valid departure time.'; end if;
  update public.boat_assignments set captain_employee_id=p_captain,guide_employee_id=p_guide,departure_time=p_departure::time where id=p_assignment_id;
end;
$$;
revoke all on function public.set_trip_crew_checked(uuid,jsonb,uuid,uuid,text) from public,anon;
grant execute on function public.set_trip_crew_checked(uuid,jsonb,uuid,uuid,text) to authenticated;
