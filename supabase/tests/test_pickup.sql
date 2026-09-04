\set ON_ERROR_STOP on
\pset pager off
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, false); end $$;
create or replace function pg_temp.check(label text, got anyelement, want anyelement) returns void language plpgsql as $$
begin
  if got is not distinct from want then raise notice 'PASS  % (%)', label, got;
  else raise exception 'FAIL  % -> got %, want %', label, got, want; end if;
end $$;

reset role;
insert into public.transport_vehicles (id, code, name, vehicle_type, capacity_pax, plate_no, sort_order)
values
  ('11110000-0000-0000-0000-00000000000a', 'Van 1', 'Toyota Hiace', 'van', 12, 'PKA 1234', 1),
  ('11110000-0000-0000-0000-00000000000b', 'Van 2', 'Nissan Urvan', 'van', 8, 'PKA 5678', 2);

set role authenticated;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');   -- coordinator

-- ============ pickup is opt in ============
select pg_temp.check('bookings default to no pickup needed', count(*)::int, 0)
from public.bookings where service_date = '2026-09-12' and pickup_required;

select public.save_booking(
  jsonb_build_object('service_date','2026-09-12','lead_name','Far Hotel Group','source_type','in_house',
                     'pickup_hotel_name','Sunset Beach Villa','pickup_latitude',5.47,'pickup_longitude',100.29),
  (select jsonb_agg(jsonb_build_object('full_name','Far Guest '||g,'age_band','adult')) from generate_series(1,5) g)
) as far \gset
select public.save_booking(
  jsonb_build_object('service_date','2026-09-12','lead_name','Marina Group','source_type','in_house',
                     'pickup_hotel_name','Hotel Marina Bay','pickup_latitude',5.41,'pickup_longitude',100.33),
  (select jsonb_agg(jsonb_build_object('full_name','Marina Guest '||g,'age_band','adult')) from generate_series(1,4) g)
) as marina \gset
select public.save_booking(
  jsonb_build_object('service_date','2026-09-12','lead_name','Suites Group','source_type','in_house',
                     'pickup_hotel_name','Marina Suites','pickup_latitude',5.412,'pickup_longitude',100.331),
  (select jsonb_agg(jsonb_build_object('full_name','Suites Guest '||g,'age_band','adult')) from generate_series(1,3) g)
) as suites \gset
-- This one is making their own way to the jetty.
select public.save_booking(
  jsonb_build_object('service_date','2026-09-12','lead_name','Own Transport','source_type','in_house'),
  jsonb_build_array(jsonb_build_object('full_name','Self Driver','age_band','adult'))
) as own \gset

select pg_temp.check('a booking with a hotel is marked for pickup', pickup_required, true)
from public.bookings where id = :'far';
select pg_temp.check('a booking with no hotel is not', pickup_required, false)
from public.bookings where id = :'own';

-- The coordinator can turn pickup off for someone who arranges their own ride.
select public.set_booking_pickup(:'suites', false);
select pg_temp.check('pickup can be switched off per booking', pickup_required, false)
from public.bookings where id = :'suites';
select public.set_booking_pickup(:'suites', true);

-- ============ planning fills vehicles and orders the route ============
select public.auto_plan_pickups('2026-09-12') as placed \gset
select pg_temp.check('only the guests who need collecting are placed', :'placed'::int, 3);
select pg_temp.check('the guest making their own way is left alone', pickup_group_id is null, true)
from public.bookings where id = :'own';

select pg_temp.check('a run was created', count(*)::int > 0, true)
from public.pickup_groups where service_date = '2026-09-12';
select pg_temp.check('the run is on a vehicle', count(*)::int, 0)
from public.pickup_groups where service_date = '2026-09-12' and vehicle_id is null;

-- Hotels 7 km apart belong on different vehicles, not one long detour.
select pg_temp.check('distant hotels are put on separate runs',
  (select pickup_group_id from public.bookings where id = :'far')
  is distinct from (select pickup_group_id from public.bookings where id = :'marina'), true);
select pg_temp.check('hotels 250 m apart share a run',
  (select pickup_group_id from public.bookings where id = :'marina')
  = (select pickup_group_id from public.bookings where id = :'suites'), true);

-- Within a run, the stop furthest from the jetty is collected first.
select pickup_stop_order from public.bookings where id = :'marina' \gset mar_
select pickup_stop_order from public.bookings where id = :'suites' \gset sui_
select pg_temp.check('the furthest stop on the run is first', :mar_pickup_stop_order, 1);
select pg_temp.check('the nearer stop follows it', :sui_pickup_stop_order, 2);

select pg_temp.check('every stop gets a time', count(*)::int, 0)
from public.bookings where service_date = '2026-09-12' and pickup_group_id is not null and pickup_eta is null;

select pg_temp.check('the first stop is collected before the second',
  (select pickup_eta from public.bookings where id = :'marina')
  < (select pickup_eta from public.bookings where id = :'suites'), true);

select pg_temp.check('the run leaves before it has to be at the jetty',
  (select depart_time from public.pickup_groups
   where id = (select pickup_group_id from public.bookings where id = :'marina')) < '09:00'::time, true);

-- ============ vehicle capacity is respected ============
do $$
declare v_run uuid; v_booking uuid; v_big uuid;
begin
  -- A 20 pax group cannot go on a 12 seat van.
  v_big := public.save_booking(
    jsonb_build_object('service_date','2026-09-12','lead_name','Coach Party','source_type','in_house',
                       'pickup_hotel_name','Town Backpackers','pickup_latitude',5.42,'pickup_longitude',100.34),
    (select jsonb_agg(jsonb_build_object('full_name','Coach Guest '||g,'age_band','adult')) from generate_series(1,20) g));
  select id into v_run from public.pickup_groups where service_date = '2026-09-12' limit 1;
  perform public.assign_pickup_run(v_big, v_run);
  raise exception 'FAIL a van was overloaded';
exception when sqlstate 'P0001' then
  if sqlerrm like '%seat(s) left%' then raise notice 'PASS  a van cannot be overloaded: %', sqlerrm;
  else raise; end if;
end $$;

-- ============ the catalogue saves typing ============
select pg_temp.as_user('88888888-8888-8888-8888-888888888888');   -- cook
reset role;
select pg_temp.check('the catalogue ships with common ingredients', count(*)::int > 15, true)
from public.catalogue_items where kind = 'ingredient';
select pg_temp.check('and common equipment for missing items', count(*)::int > 5, true)
from public.catalogue_items where kind = 'equipment';

set role authenticated;
select pg_temp.as_user('88888888-8888-8888-8888-888888888888');
select public.save_purchase_request(
  jsonb_build_object('needed_for_date','2026-09-12','pax_count',20,'purpose','Lunch'),
  jsonb_build_array(jsonb_build_object('item_name','Kangkung','quantity',3,'unit','kg'))
) as req \gset
reset role;
select pg_temp.check('a newly typed item joins the catalogue', count(*)::int, 1)
from public.catalogue_items where lower(name) = 'kangkung';
select pg_temp.check('and remembers its unit', unit, 'kg')
from public.catalogue_items where lower(name) = 'kangkung';

set role authenticated;
select pg_temp.as_user('88888888-8888-8888-8888-888888888888');
select public.copy_purchase_request(:'req', '2026-09-19') as copy \gset
reset role;
select pg_temp.check('a past order can be copied to a new date', needed_for_date, '2026-09-19'::date)
from public.purchase_requests where id = :'copy';
select pg_temp.check('the copy brings the items with it', count(*)::int, 1)
from public.purchase_request_items where request_id = :'copy';
select pg_temp.check('the copy starts as a draft', status, 'draft')
from public.purchase_requests where id = :'copy';
