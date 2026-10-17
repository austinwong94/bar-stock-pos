-- Booking-level entry, restricted date-scoped planning, and everyone-onboard capacity.
insert into public.permissions(code,department_code,name,sensitive) values
 ('guests.sheet.view','guests','View Daily Booking Sheet',true),
 ('guests.sheet.write','guests','Enter Daily Booking Sheet',false),
 ('guests.plan.manage','guests','Plan Approved Departures',true),
 ('guests.finance.manage','guests','Booking Payments and Commissions',true)
on conflict do nothing;
insert into public.access_roles(code,name,description,is_master,is_system,sort_order) values
 ('external_planner','External Departure Planner','Only approved dates and operational assignments. No payments, referrers or business data.',false,true,20)
on conflict do nothing;
insert into public.access_role_permissions(role_code,permission_code) values
 ('external_planner','guests.plan.manage'),
 ('coordinator','guests.sheet.view'),('coordinator','guests.sheet.write'),
 ('operations_manager','guests.sheet.view'),('operations_manager','guests.sheet.write'),
 ('accountant','guests.sheet.view'),('accountant','guests.finance.manage')
on conflict do nothing;

create function public.is_external_planner() returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.profiles where id=auth.uid() and access_role_code='external_planner')
$$;
-- Even accidental per-user grants cannot turn this restricted role into broad access.
do $$ declare definition text; begin
 select pg_get_functiondef('public.user_has_permission(uuid,text)'::regprocedure) into definition;
 definition:=replace(definition,'select case', $guard$select case
 when exists(select 1 from public.profiles where id=p_user_id and access_role_code='external_planner')
 then p_code='guests.plan.manage' and exists(select 1 from public.profiles where id=p_user_id and status='active' and not is_anonymous)
 $guard$);
 execute definition;
end $$;

create table public.departure_planner_access(
 user_id uuid not null references public.profiles(id), service_date date not null,
 granted_by uuid not null references public.profiles(id), granted_at timestamptz not null default now(),
 primary key(user_id,service_date)
);
alter table public.departure_planner_access enable row level security;
revoke all on public.departure_planner_access from public,anon,authenticated;
create function public.check_sheet_date(p_date date) returns void language plpgsql security definer set search_path=public as $$
begin
 if p_date is null then raise exception 'Choose a service date.'; end if;
 if public.is_external_planner() then
   perform public.require_permission('guests.plan.manage');
   if not exists(select 1 from public.departure_planner_access where user_id=auth.uid() and service_date=p_date)
     then raise exception 'You have no planning access for this date.' using errcode='42501'; end if;
 else perform public.require_permission('guests.sheet.view'); end if;
end $$;

-- Restrictive policies add a deny boundary without changing existing departmental policies.
do $$ declare t text; begin
 for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind in ('r','p') and c.relrowsecurity
 and c.relname not in ('profiles','departments','permissions','access_roles','access_role_permissions') loop
 execute format('create policy external_planner_boundary on public.%I as restrictive for all to authenticated using (not public.is_external_planner()) with check (not public.is_external_planner())',t);
 end loop;
end $$;

alter table public.bookings add column pax_infants int not null default 0;
create policy external_planner_boundary on storage.objects as restrictive for all to authenticated using (not public.is_external_planner()) with check (not public.is_external_planner());
alter table public.bookings add column pax_tour_leaders int not null default 0;
alter table public.bookings add column pax_tour_guides int not null default 0;
alter table public.bookings add column tour_name text not null default 'Lovely Paradise Day Trip';
alter table public.bookings add column dropoff_location text not null default '';
alter table public.bookings add column planning_group text not null default 'standard' check(planning_group in ('standard','xhs','private'));
alter table public.bookings add column ops_notes text not null default '';
alter table public.bookings add column guide_employee_id uuid references public.employees(id);
alter table public.bookings add column updated_by uuid references public.profiles(id);
alter table public.tourists add column traveller_role text not null default 'guest' check(traveller_role in ('guest','tour_leader','tour_guide'));
alter table public.tourists add column name_pending boolean not null default false;
alter table public.boat_assignments add column crew_employee_ids uuid[] not null default '{}';

create function public.stamp_booking_editor() returns trigger language plpgsql set search_path=public as $$
begin if auth.uid() is not null then new.updated_by:=auth.uid();end if;return new;end $$;
create trigger stamp_booking_editor before insert or update on public.bookings for each row execute function public.stamp_booking_editor();
create function public.complete_pending_name() returns trigger language plpgsql set search_path=public as $$
begin if old.name_pending and new.full_name is distinct from old.full_name then new.name_pending:=false;end if;return new;end $$;
create trigger complete_pending_name before update of full_name on public.tourists for each row execute function public.complete_pending_name();

create or replace function public.recount_booking_pax(p_booking_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 update public.bookings b set pax_total=c.total,pax_adults=c.adults,pax_children=c.children,pax_infants=c.infants,
  pax_elderly=0,pax_assisted=c.assisted,pax_tour_leaders=c.tl,pax_tour_guides=c.tg
 from (select count(*)::int total,
 count(*) filter(where traveller_role='guest' and age_band in ('adult','elderly'))::int adults,
 count(*) filter(where traveller_role='guest' and age_band='child')::int children,
 count(*) filter(where traveller_role='guest' and age_band='infant')::int infants,
 count(*) filter(where traveller_role='tour_leader')::int tl,
 count(*) filter(where traveller_role='tour_guide')::int tg,
 count(*) filter(where needs_assistance)::int assisted from public.tourists where booking_id=p_booking_id)c where b.id=p_booking_id;
end $$;
-- Preserve every historical person and total; never reclassify an elderly person as an infant.
update public.bookings b set pax_adults=b.pax_adults+b.pax_elderly,pax_elderly=0,
 pax_children=(select count(*) from public.tourists t where t.booking_id=b.id and age_band='child'),
 pax_infants=(select count(*) from public.tourists t where t.booking_id=b.id and age_band='infant');

create function public.boat_staff_pax(p_assignment uuid) returns int language sql stable security definer set search_path=public as $$
 select coalesce((select count(distinct person)::int from public.boat_assignments a
 cross join lateral unnest(array[a.captain_employee_id,a.guide_employee_id]||a.crew_employee_ids||
 array(select b.guide_employee_id from public.trip_bookings tb join public.bookings b on b.id=tb.booking_id where tb.assignment_id=a.id)) person
 where a.id=p_assignment and person is not null),0)
 + case when exists(select 1 from public.boat_assignments where id=p_assignment and captain_employee_id is null) then 1 else 0 end
 + case when exists(select 1 from public.boat_assignments where id=p_assignment and cardinality(crew_employee_ids)=0) then 1 else 0 end
$$;
create function public.assert_onboard_capacity(p_assignment uuid) returns void language plpgsql security definer set search_path=public as $$
declare cap int; pax int;
begin
 select least(43,b.capacity_pax) into cap from public.boat_assignments a join public.boats b on b.id=a.boat_id where a.id=p_assignment;
 select coalesce(sum(b.pax_total),0) into pax from public.trip_bookings tb join public.bookings b on b.id=tb.booking_id where tb.assignment_id=p_assignment and b.status not in ('cancelled','no_show');
 if cap is null or cap<=0 or pax+public.boat_staff_pax(p_assignment)>cap then
 raise exception 'Boat capacity exceeded: % passengers + % staff/reserved staff seats; maximum % onboard.',pax,public.boat_staff_pax(p_assignment),cap; end if;
end $$;
create function public.check_total_onboard() returns trigger language plpgsql security definer set search_path=public as $$
declare a uuid;
begin
 if tg_table_name='trip_bookings' then perform public.assert_onboard_capacity(new.assignment_id);
 elsif tg_table_name='boat_assignments' then
   if tg_op='UPDATE' and old.locked and new.crew_employee_ids is distinct from old.crew_employee_ids then raise exception 'Unlock the day before changing crew.'; end if;
   if exists(select 1 from public.trip_bookings where assignment_id=new.id) then perform public.assert_onboard_capacity(new.id); end if;
 elsif tg_table_name='bookings' then
   for a in select assignment_id from public.trip_bookings where booking_id=new.id loop perform public.assert_onboard_capacity(a); end loop;
 else for a in select id from public.boat_assignments where boat_id=new.id and service_date>=current_date and status in ('planned','boarding') loop perform public.assert_onboard_capacity(a); end loop;
 end if;
 return new;
end $$;
create constraint trigger total_onboard_booking after insert or update on public.trip_bookings deferrable initially deferred for each row execute function public.check_total_onboard();
create constraint trigger total_onboard_people after update on public.bookings deferrable initially deferred for each row execute function public.check_total_onboard();
create constraint trigger total_onboard_staff after update on public.boat_assignments deferrable initially deferred for each row execute function public.check_total_onboard();
create constraint trigger total_onboard_boat after update on public.boats deferrable initially deferred for each row execute function public.check_total_onboard();

create function public.read_daily_booking_sheet(p_date date) returns jsonb language plpgsql security definer set search_path=public as $$
declare restricted boolean:=public.is_external_planner(); result jsonb;
begin
 perform public.check_sheet_date(p_date);
 select jsonb_build_object('restricted',restricted,
 'available_boats',coalesce((select jsonb_agg(jsonb_build_object('id',id,'code',code,'capacity_pax',least(43,capacity_pax))) from public.boats where status='active'),'[]'::jsonb),
 'bookings',coalesce((select jsonb_agg(
 jsonb_build_object('id',b.id,'service_date',b.service_date,'lead_name',b.lead_name,'booking_ref',b.booking_ref,
 'pax_total',b.pax_total,'pax_adults',b.pax_adults,'pax_children',b.pax_children,'pax_elderly',0,'pax_infants',b.pax_infants,
 'pax_tour_leaders',b.pax_tour_leaders,'pax_tour_guides',b.pax_tour_guides,'pax_assisted',b.pax_assisted,
 'pickup_hotel_name',b.pickup_hotel_name,'pickup_area',b.pickup_area,'pickup_time',b.pickup_time,'pickup_required',b.pickup_required,
 'pickup_group_id',b.pickup_group_id,'pickup_latitude',b.pickup_latitude,'pickup_longitude',b.pickup_longitude,
 'tour_name',b.tour_name,'dropoff_location',b.dropoff_location,'planning_group',b.planning_group,'ops_notes',b.ops_notes,
 'guide_employee_id',b.guide_employee_id,'assignment_id',tb.assignment_id,'status',b.status,'updated_at',b.updated_at,
 'creator_name',p.full_name,'updated_by_name',u.full_name)
 || case when restricted then '{}'::jsonb else jsonb_build_object('lead_phone',b.lead_phone,'agency_id',b.agency_id,'source_type',b.source_type) end
 order by b.created_at,b.id) from public.bookings b left join public.trip_bookings tb on tb.booking_id=b.id
 left join public.profiles p on p.id=b.created_by left join public.profiles u on u.id=b.updated_by where b.service_date=p_date),'[]'::jsonb),
 'boats',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'boat_id',a.boat_id,'service_date',a.service_date,'trip_no',a.trip_no,
 'code',bo.code,'capacity_pax',least(43,bo.capacity_pax),'captain_employee_id',a.captain_employee_id,'guide_employee_id',a.guide_employee_id,
 'crew_employee_ids',a.crew_employee_ids,'staff_pax',public.boat_staff_pax(a.id),'guest_pax',(select coalesce(sum(b.pax_total),0) from public.trip_bookings tb join public.bookings b on b.id=tb.booking_id where tb.assignment_id=a.id and b.status not in ('cancelled','no_show')),
 'locked',a.locked,'status',a.status,'departure_time',a.departure_time,'updated_at',a.updated_at) order by a.trip_no,bo.code)
 from public.boat_assignments a join public.boats bo on bo.id=a.boat_id where a.service_date=p_date and a.status<>'cancelled'),'[]'::jsonb),
 'employees',coalesce((select jsonb_agg(jsonb_build_object('id',id,'full_name',full_name,'job_type',job_type,'phone',phone) order by full_name) from public.employees where active and job_type in ('captain','crew','guide','driver')),'[]'::jsonb),
 'vehicles',coalesce((select jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'capacity_pax',capacity_pax) order by code) from public.transport_vehicles where active),'[]'::jsonb),
 'runs',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'vehicle_id',vehicle_id,'driver_employee_id',driver_employee_id,'status',status,'updated_at',updated_at)) from public.pickup_groups where service_date=p_date and status<>'cancelled'),'[]'::jsonb),
 'agencies',case when restricted then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name) from public.agencies where active),'[]'::jsonb) end) into result;
 return result;
end $$;

create function public.save_daily_booking(p_date date,p_booking_id uuid,p_expected_updated_at timestamptz,p_changes jsonb,p_request_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare b public.bookings%rowtype; original public.bookings%rowtype; v_id uuid:=p_booking_id;
 counts int[]; band text; role_name text; labels text[]:=array['Adult','Child','Infant','Local Tour Leader','China Tour Guide'];
 i int; j int; have int; t record; fingerprint text; previous public.operation_requests%rowtype;
begin
 perform public.require_permission('guests.sheet.write'); perform public.check_sheet_date(p_date);
 perform pg_advisory_xact_lock(73081,1);
 if p_request_id is null then raise exception 'A save reference is required.'; end if;
 fingerprint:=md5(jsonb_build_array(p_date,p_booking_id,p_expected_updated_at,p_changes)::text);
 select * into previous from public.operation_requests where actor_id=auth.uid() and operation='daily_booking' and request_id=p_request_id;
 if found then if previous.payload_hash<>fingerprint then raise exception 'This save reference has different details.'; end if; return previous.result_id; end if;
 if v_id is not null then
  select * into b from public.bookings where bookings.id=v_id and service_date=p_date for update;
  if not found or b.updated_at is distinct from p_expected_updated_at then raise exception 'Booking changed on another device. Reload before saving.' using errcode='40001'; end if;
  if exists(select 1 from public.trip_bookings tb join public.boat_assignments a on a.id=tb.assignment_id where tb.booking_id=v_id and (a.locked or a.status not in ('planned','boarding'))) then raise exception 'The departure is locked or underway.'; end if;
  original:=b;
 else
  if nullif(trim(p_changes->>'lead_name'),'') is null then raise exception 'Enter the booking or group name.'; end if;
  v_id:=gen_random_uuid();
  insert into public.bookings(id,booking_ref,service_date,lead_name,created_by) values(v_id,'LP-'||to_char(p_date,'YYYYMMDD')||'-'||upper(substr(replace(v_id::text,'-',''),1,8)),p_date,trim(p_changes->>'lead_name'),auth.uid()) returning * into b;
 end if;
 if p_changes ? 'counts' then
  counts:=array[(p_changes#>>'{counts,adults}')::int,(p_changes#>>'{counts,children}')::int,(p_changes#>>'{counts,infants}')::int,(p_changes#>>'{counts,tour_leaders}')::int,(p_changes#>>'{counts,tour_guides}')::int];
  if exists(select 1 from unnest(counts)n where n is null or n<0 or n>500) or (select sum(n) from unnest(counts)n) not between 1 and 500 then raise exception 'Enter valid passenger counts (1-500 total).'; end if;
  for i in 1..5 loop
   band:=case i when 2 then 'child' when 3 then 'infant' else 'adult' end;
   role_name:=case i when 4 then 'tour_leader' when 5 then 'tour_guide' else 'guest' end;
   select count(*) into have from public.tourists where booking_id=v_id and traveller_role=role_name and (age_band=band or (i=1 and age_band='elderly'));
   if have>counts[i] then
    if (select count(*) from public.tourists where booking_id=v_id and traveller_role=role_name and (age_band=band or (i=1 and age_band='elderly')) and name_pending and not exists(select 1 from public.guest_meal_needs n where n.tourist_id=tourists.id)
       and not exists(select 1 from public.trip_passengers p where p.tourist_id=tourists.id and (p.boarding_status<>'pending' or p.activity_code is not null)))<have-counts[i]
       then raise exception 'Named or checked-in passengers cannot be removed by changing a count. Edit the passenger list.'; end if;
    delete from public.tourists where tourists.id in(select x.id from public.tourists x where x.booking_id=v_id and x.traveller_role=role_name and (x.age_band=band or (i=1 and x.age_band='elderly')) and x.name_pending and not exists(select 1 from public.guest_meal_needs n where n.tourist_id=x.id)
     and not exists(select 1 from public.trip_passengers p where p.tourist_id=x.id and (p.boarding_status<>'pending' or p.activity_code is not null)) order by x.sort_order desc limit have-counts[i]);
   else for j in have+1..counts[i] loop
    insert into public.tourists(booking_id,full_name,age_band,traveller_role,name_pending,sort_order) values(v_id,labels[i]||' '||j||' (Name Pending)',band,role_name,true,i*1000+j);
   end loop; end if;
  end loop;
 end if;
 update public.bookings set
 lead_name=case when p_changes?'lead_name' then trim(p_changes->>'lead_name') else lead_name end,
 lead_phone=case when p_changes?'lead_phone' then p_changes->>'lead_phone' else lead_phone end,
 pickup_hotel_name=case when p_changes?'pickup_hotel_name' then p_changes->>'pickup_hotel_name' else pickup_hotel_name end,
 pickup_area=case when p_changes?'pickup_area' then p_changes->>'pickup_area' else pickup_area end,
 pickup_required=case when p_changes?'pickup_required' then (p_changes->>'pickup_required')::boolean else pickup_required end,
 pickup_time=case when p_changes?'pickup_time' then nullif(p_changes->>'pickup_time','')::time else pickup_time end,
 pickup_latitude=case when p_changes?'pickup_hotel_name' and p_changes->>'pickup_hotel_name' is distinct from b.pickup_hotel_name then null else pickup_latitude end,
 pickup_longitude=case when p_changes?'pickup_hotel_name' and p_changes->>'pickup_hotel_name' is distinct from b.pickup_hotel_name then null else pickup_longitude end,
 pickup_group_id=case when p_changes->>'pickup_required'='false' then null else pickup_group_id end,
 tour_name=coalesce(p_changes->>'tour_name',tour_name),dropoff_location=coalesce(p_changes->>'dropoff_location',dropoff_location),
 planning_group=coalesce(p_changes->>'planning_group',planning_group),ops_notes=coalesce(p_changes->>'ops_notes',ops_notes),
 agency_id=case when p_changes?'agency_id' then nullif(p_changes->>'agency_id','')::uuid else agency_id end,
 source_type=coalesce(p_changes->>'source_type',source_type),updated_by=auth.uid()
 where bookings.id=v_id returning * into b;
 if nullif(b.lead_name,'') is null or b.pax_total<1 then raise exception 'Enter a name and at least one passenger.'; end if;
 insert into public.operation_requests(actor_id,operation,request_id,payload_hash,result_id) values(auth.uid(),'daily_booking',p_request_id,fingerprint,v_id);
 return v_id;
end $$;

create function public.save_departure_assignment(p_date date,p_booking_id uuid,p_expected_updated_at timestamptz,p_changes jsonb,p_request_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare b public.bookings%rowtype; a public.boat_assignments%rowtype; target uuid; previous public.operation_requests%rowtype; fingerprint text;
begin
 perform public.check_sheet_date(p_date);
 if not public.is_external_planner() then perform public.require_permission('fleet.assign'); end if;
 perform pg_advisory_xact_lock(73081,1);
 fingerprint:=md5(jsonb_build_array(p_date,p_booking_id,p_expected_updated_at,p_changes)::text);
 if p_request_id is null then raise exception 'A save reference is required.'; end if;
 select * into previous from public.operation_requests where actor_id=auth.uid() and operation='departure_assignment' and request_id=p_request_id;
 if found then if previous.payload_hash<>fingerprint then raise exception 'Save reference changed.'; end if; return previous.result_id; end if;
 select * into b from public.bookings where id=p_booking_id and service_date=p_date for update;
 if not found or b.updated_at is distinct from p_expected_updated_at then raise exception 'Booking changed. Reload before assigning.' using errcode='40001'; end if;
 if b.status not in ('draft','confirmed','arrived') then raise exception 'This booking is cancelled or unavailable.'; end if;
 if exists(select 1 from public.trip_bookings tb join public.boat_assignments trip on trip.id=tb.assignment_id where tb.booking_id=b.id and (trip.locked or trip.status<>'planned')) then raise exception 'This boat plan is locked or underway.'; end if;
 if p_changes?'assignment_id' then
  target:=nullif(p_changes->>'assignment_id','')::uuid;
  if target is not null then select * into a from public.boat_assignments where id=target and service_date=p_date and status='planned' and not locked;
   if not found then raise exception 'Choose an available boat on this date.'; end if; end if;
  if target is distinct from (select assignment_id from public.trip_bookings where booking_id=b.id) then
   if exists(select 1 from public.trip_passengers where booking_id=b.id and (boarding_status<>'pending' or activity_code is not null)) then raise exception 'Attendance has started. An internal PIC must review this move.'; end if;
   delete from public.trip_bookings where booking_id=b.id;
   if target is not null then insert into public.trip_bookings(assignment_id,booking_id,assigned_by) values(target,b.id,auth.uid()); end if;
  end if;
 end if;
 if p_changes?'pickup_group_id' and exists(select 1 from public.pickup_groups where id=b.pickup_group_id and status<>'planned') then raise exception 'The pickup is already underway.'; end if;
 if p_changes?'pickup_group_id' and nullif(p_changes->>'pickup_group_id','') is not null and not exists(select 1 from public.pickup_groups where id=(p_changes->>'pickup_group_id')::uuid and service_date=p_date and status='planned') then raise exception 'Choose a planned van on this date.'; end if;
 if p_changes?'guide_employee_id' and nullif(p_changes->>'guide_employee_id','') is not null and not exists(select 1 from public.employees where id=(p_changes->>'guide_employee_id')::uuid and active and job_type='guide') then raise exception 'Choose an active local guide.'; end if;
 update public.bookings set pickup_group_id=case when p_changes?'pickup_group_id' then nullif(p_changes->>'pickup_group_id','')::uuid else pickup_group_id end,
 pickup_required=case when nullif(p_changes->>'pickup_group_id','') is not null then true else pickup_required end,
 pickup_time=case when p_changes?'pickup_time' then nullif(p_changes->>'pickup_time','')::time else pickup_time end,
 guide_employee_id=case when p_changes?'guide_employee_id' then nullif(p_changes->>'guide_employee_id','')::uuid else guide_employee_id end,updated_by=auth.uid() where id=b.id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_json,after_json) values(auth.uid(),'departure_assignment','booking',b.id,jsonb_build_object('updated_at',b.updated_at),p_changes);
 insert into public.operation_requests(actor_id,operation,request_id,payload_hash,result_id) values(auth.uid(),'departure_assignment',p_request_id,fingerprint,b.id);
 return b.id;
end $$;

create function public.save_sheet_boat(p_date date,p_assignment_id uuid,p_expected_updated_at timestamptz,p_captain uuid,p_crew uuid[],p_request_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare a public.boat_assignments%rowtype; previous public.operation_requests%rowtype; fingerprint text;
begin
 perform public.check_sheet_date(p_date); if not public.is_external_planner() then perform public.require_permission('fleet.crew.assign'); end if;
 perform pg_advisory_xact_lock(73081,1);
 fingerprint:=md5(jsonb_build_array(p_date,p_assignment_id,p_expected_updated_at,p_captain,p_crew)::text);
 if p_request_id is null then raise exception 'A save reference is required.'; end if;
 select * into previous from public.operation_requests where actor_id=auth.uid() and operation='sheet_boat' and request_id=p_request_id;
 if found then if previous.payload_hash<>fingerprint then raise exception 'Save reference changed.'; end if; return previous.result_id; end if;
 select * into a from public.boat_assignments where id=p_assignment_id and service_date=p_date;
 if not found or a.updated_at is distinct from p_expected_updated_at then raise exception 'Boat changed. Reload before saving.' using errcode='40001'; end if;
 if a.locked or a.status<>'planned' then raise exception 'Boat is locked or underway.'; end if;
 if p_captain is not null and not exists(select 1 from public.employees where id=p_captain and job_type='captain' and active) then raise exception 'Choose an active captain.'; end if;
 if exists(select 1 from unnest(p_crew) member_id where not exists(select 1 from public.employees e where e.id=member_id and e.job_type in ('crew','captain') and active)) then raise exception 'Choose active crew.'; end if;
 if p_captain=any(p_crew) or cardinality(p_crew)<>(select count(distinct n) from unnest(p_crew)n) then raise exception 'Each staff member can only be counted once.'; end if;
 if exists(select 1 from public.boat_assignments x where x.id<>a.id and x.service_date=p_date and x.status<>'cancelled'
   and (array[p_captain]||p_crew)&&(array[x.captain_employee_id,x.guide_employee_id]||x.crew_employee_ids)) then raise exception 'A selected staff member is already on another boat that day.'; end if;
 update public.boat_assignments set captain_employee_id=p_captain,crew_employee_ids=coalesce(p_crew,'{}') where id=a.id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_json,after_json) values(auth.uid(),'sheet_boat','boat_assignment',a.id,to_jsonb(a),jsonb_build_object('captain',p_captain,'crew',p_crew));
 insert into public.operation_requests(actor_id,operation,request_id,payload_hash,result_id) values(auth.uid(),'sheet_boat',p_request_id,fingerprint,a.id);
 return a.id;
end $$;

create function public.sheet_planner_access(p_date date,p_user_id uuid default null,p_allow boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 perform public.require_permission('platform.users.manage');
 if p_user_id is not null then
 if not exists(select 1 from public.profiles where id=p_user_id and access_role_code='external_planner' and status='active' and not is_anonymous) then raise exception 'Select an active named External Departure Planner account.'; end if;
 if p_allow then insert into public.departure_planner_access(user_id,service_date,granted_by) values(p_user_id,p_date,auth.uid()) on conflict do nothing;
 else delete from public.departure_planner_access where user_id=p_user_id and service_date=p_date; end if;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_json) values(auth.uid(),'planner_access','profile',p_user_id,jsonb_build_object('service_date',p_date,'allowed',p_allow));
 end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'full_name',p.full_name,'allowed',exists(select 1 from public.departure_planner_access a where a.user_id=p.id and a.service_date=p_date))) from public.profiles p where p.access_role_code='external_planner' and p.status='active' and not p.is_anonymous),'[]');
end $$;

do $$ declare r record; begin
 for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in ('read_daily_booking_sheet','save_daily_booking','save_departure_assignment','save_sheet_boat','sheet_planner_access') loop
 execute format('revoke all on function %s from public,anon',r.signature); execute format('grant execute on function %s to authenticated',r.signature); end loop;
end $$;
revoke all on function public.check_sheet_date(date),public.boat_staff_pax(uuid),public.assert_onboard_capacity(uuid) from public,anon,authenticated;

-- Keep the existing permission-filtered summary; add the new passenger categories.
do $$ declare definition text; marker text := '''elderly'', coalesce(sum(b.pax_elderly), 0),'; begin
 select pg_get_functiondef('public.operations_summary(date)'::regprocedure) into definition;
 if strpos(definition,marker)=0 then raise exception 'Passenger summary definition changed; review its count fields.'; end if;
 execute replace(definition,marker,marker || E'\n      ''infants'', coalesce(sum(b.pax_infants), 0),\n      ''tour_leaders'', coalesce(sum(b.pax_tour_leaders), 0),\n      ''tour_guides'', coalesce(sum(b.pax_tour_guides), 0),');
end $$;
