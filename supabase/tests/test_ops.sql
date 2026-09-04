\set ON_ERROR_STOP on
\pset pager off
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, false); end $$;
create or replace function pg_temp.check(label text, got anyelement, want anyelement) returns void language plpgsql as $$
begin
  if got is not distinct from want then raise notice 'PASS  % (%)', label, got;
  else raise exception 'FAIL  % -> got %, want %', label, got, want; end if;
end $$;

set role authenticated;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');   -- coordinator

-- Two more bookings so we can test capacity and distance grouping
select public.save_booking(
  jsonb_build_object('service_date','2026-09-10','lead_name','Sunset Six','source_type','in_house',
                     'pickup_hotel_name','Sunset Beach Villa','pickup_latitude',5.47,'pickup_longitude',100.29),
  (select jsonb_agg(jsonb_build_object('full_name','Sunset Guest '||g,'age_band','adult')) from generate_series(1,6) g)
) as big \gset

-- ---------- pickup auto-grouping ----------
select public.auto_group_pickups('2026-09-10') as grouped \gset
select pg_temp.check('auto grouping placed every booking', :'grouped'::int, 3);
select pg_temp.check('two hotels 250m apart became one run', count(*)::int, 2) from public.pickup_groups where service_date='2026-09-10';
select pg_temp.check('Marina run holds both Marina bookings', count(*)::int, 2)
from public.bookings b join public.pickup_groups g on g.id=b.pickup_group_id
where g.name='Hotel Marina Bay';
select pg_temp.check('distance maths', public.distance_km(5.41,100.33,5.412,100.331) < 0.3, true);

-- ---------- boat board ----------
select count(*)::int from public.ensure_boat_assignments('2026-09-10') \gset a_
select pg_temp.check('one trip row per active boat', :a_count, 3);

select a.id from public.boat_assignments a join public.boats b on b.id=a.boat_id
where a.service_date='2026-09-10' and b.code='Boat 2' \gset b2_
select a.id from public.boat_assignments a join public.boats b on b.id=a.boat_id
where a.service_date='2026-09-10' and b.code='Boat 1' \gset b1_

-- Boat 2 holds 8. Family of 5 fits; the six then does not.
select public.assign_booking_to_boat((select id from public.bookings where lead_name='Tan Family'), :'b2_id');
select pg_temp.check('whole family moved as one group', count(*)::int, 5)
from public.trip_passengers where assignment_id = :'b2_id';

do $$
declare v_b2 uuid;
begin
  select a.id into v_b2 from public.boat_assignments a join public.boats b on b.id=a.boat_id
   where a.service_date='2026-09-10' and b.code='Boat 2';
  perform public.assign_booking_to_boat((select id from public.bookings where lead_name='Sunset Six'), v_b2);
  raise exception 'FAIL overbooking was allowed';
exception when others then
  if sqlstate = 'P0001' and sqlerrm like '%seat(s) left%' then raise notice 'PASS  overbooking blocked: %', sqlerrm;
  else raise; end if;
end $$;

select public.assign_booking_to_boat((select id from public.bookings where lead_name='Sunset Six'), :'b1_id');
select public.assign_booking_to_boat((select id from public.bookings where lead_name='Lee Couple'), :'b1_id');
select pg_temp.check('Boat 1 now carries 8 pax', count(*)::int, 8) from public.trip_passengers where assignment_id = :'b1_id';

-- Moving a group to another boat takes everyone with it
select public.assign_booking_to_boat((select id from public.bookings where lead_name='Lee Couple'), :'b2_id');
select pg_temp.check('moved group left Boat 1 whole', count(*)::int, 6) from public.trip_passengers where assignment_id = :'b1_id';
select pg_temp.check('moved group arrived on Boat 2 whole', count(*)::int, 7) from public.trip_passengers where assignment_id = :'b2_id';

-- Crew
select public.set_trip_crew(:'b2_id', 'eeeeeeee-0000-0000-0000-00000000000c', 'eeeeeeee-0000-0000-0000-00000000000d');

-- A person added later joins the same boat automatically
select public.save_booking(
  (select to_jsonb(b) - 'pax_total' - 'pax_adults' - 'pax_children' from public.bookings b where b.lead_name='Lee Couple'),
  (select jsonb_agg(jsonb_build_object('id',t.id,'full_name',t.full_name,'age_band',t.age_band) order by t.sort_order)
   from public.tourists t where t.booking_id=(select id from public.bookings where lead_name='Lee Couple'))
   || jsonb_build_array(jsonb_build_object('full_name','Lee Cee','age_band','child'))
);
select pg_temp.check('late addition joined the same boat', count(*)::int, 8) from public.trip_passengers where assignment_id = :'b2_id';

-- ---------- captain scoping ----------
select pg_temp.as_user('55555555-5555-5555-5555-555555555555');
select pg_temp.check('captain sees only their own boat trip', count(*)::int, 1) from public.boat_assignments;
select pg_temp.check('captain sees only their passengers', count(*)::int, 8) from public.trip_passengers;
select pg_temp.check('captain gets name + phone + group', count(*)::int, 8) from public.trip_manifest;
select pg_temp.check('captain cannot read passports', count(*)::int, 0) from public.tourist_private;
select pg_temp.check('captain sees no unrelated booking', count(*)::int, 2) from public.bookings;

select public.mark_boarding(array(select id from public.trip_passengers limit 3), 'arrived') as marked \gset
select pg_temp.check('captain marked boarding', :'marked'::int, 3);

do $$
begin
  perform public.save_booking(jsonb_build_object('service_date','2026-09-11','lead_name','Sneaky'), '[]'::jsonb);
  raise exception 'FAIL captain created a booking';
exception when sqlstate '42501' then raise notice 'PASS  captain cannot create bookings';
end $$;
