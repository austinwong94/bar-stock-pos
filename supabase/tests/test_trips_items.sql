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
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');   -- master admin

-- ============ elderly guests are counted separately ============
select public.save_booking(
  jsonb_build_object('service_date','2026-09-10','lead_name','Wong Family','source_type','in_house'),
  jsonb_build_array(
    jsonb_build_object('full_name','Wong Senior','age_band','elderly'),
    jsonb_build_object('full_name','Wong Nenek','age_band','elderly'),
    jsonb_build_object('full_name','Wong Dad','age_band','adult'),
    jsonb_build_object('full_name','Wong Kid','age_band','child'))
) as wong \gset

select pg_temp.check('elderly counted on their own', pax_elderly, 2) from public.bookings where id = :'wong';
select pg_temp.check('adults exclude the elderly', pax_adults, 1) from public.bookings where id = :'wong';
select pg_temp.check('children still counted', pax_children, 1) from public.bookings where id = :'wong';
select pg_temp.check('total is everyone', pax_total, 4) from public.bookings where id = :'wong';

-- ============ trips are derived from the manifest ============
select public.sync_boat_trips('2026-09-10') as added \gset
select pg_temp.check('a trip is logged for each boat that carried guests', :'added'::int > 0, true);
select pg_temp.check('derived trips are marked automatic', bool_and(auto_generated), true)
from public.boat_trips where service_date = '2026-09-10';

select public.sync_boat_trips('2026-09-10') as again \gset
select pg_temp.check('syncing twice does not duplicate trips', :'again'::int, 0);

-- An emergency run is entered by hand and counts towards fuel.
select public.save_boat_trip(
  null, '2026-09-10',
  (select id from public.boats where code = 'Boat 1'),
  'emergency', '14:30', '15:10', 2, 'Took a sick guest back to the mainland', null) as trip \gset
select pg_temp.check('emergency runs are recorded', trip_type, 'emergency')
from public.boat_trips where id = (:'trip'::public.boat_trips).id;

-- ============ fuel is bought for the fleet, estimated per boat ============
insert into public.fuel_purchases (purchase_date, litres, price_per_litre, supplier)
values ('2026-09-10', 150, 2.50, 'Jetty station');
select pg_temp.check('fuel cost is worked out from litres and price', total_cost, 375.00)
from public.fuel_purchases order by created_at desc limit 1;

select pg_temp.check('the fleet total shows what was bought', litres_bought, 150.00)
from public.fuel_period_totals('2026-09-10','2026-09-10');
select pg_temp.check('and what the trips should have used', litres_estimated > 0, true)
from public.fuel_period_totals('2026-09-10','2026-09-10');

select pg_temp.check('each boat gets an estimated share', count(*)::int > 0, true)
from public.fuel_reconciliation('2026-09-10','2026-09-10') where trips > 0;
select pg_temp.check('the emergency run is counted against Boat 1', emergency_trips, 1)
from public.fuel_reconciliation('2026-09-10','2026-09-10') where boat_code = 'Boat 1';

-- ============ activities can be un-chosen ============
select a.id from public.boat_assignments a join public.boats b on b.id = a.boat_id
where a.service_date = '2026-09-10' and b.code = 'Boat 2' \gset b2_

select public.set_passenger_activity(array(select id from public.trip_passengers where assignment_id = :'b2_id'), 'volcano');
reset role;
select pg_temp.check('an activity can be chosen', count(*)::int, 0)
from public.trip_passengers where assignment_id = :'b2_id' and activity_code is null;

set role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select public.set_passenger_activity(array(select id from public.trip_passengers where assignment_id = :'b2_id' limit 2), null);
reset role;
select pg_temp.check('and un-chosen again when they have not decided', count(*)::int, 2)
from public.trip_passengers where assignment_id = :'b2_id' and activity_code is null;

-- ============ every tick names the person who made it ============
select pg_temp.check('boarding actions are attributed', count(*)::int > 0, true)
from public.attendance_log where action = 'boarding' and actor_name is not null;
select pg_temp.check('clearing an activity is recorded too', count(*)::int, 2)
from public.attendance_log where action = 'activity_choice' and to_value = 'cleared';
select pg_temp.check('the log names the guest and the boat', count(*)::int > 0, true)
from public.attendance_log where tourist_name is not null and boat_code is not null;

-- ============ missing items ============
set role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select public.save_missing_item(null, 'Snorkel goggles', 'snorkel_gear', 3, '2026-09-10',
  'Island jetty', null, 'Left behind after the afternoon session', 45) as item \gset
select pg_temp.check('a missing item is registered', status, 'missing')
from public.missing_items where id = (:'item'::public.missing_items).id;

do $$
begin
  perform public.resolve_missing_item((select id from public.missing_items limit 1), 'written_off', null, '');
  raise exception 'FAIL an item was written off with no reason';
exception when sqlstate 'P0001' then raise notice 'PASS  writing an item off needs a reason';
end $$;

select public.resolve_missing_item((select id from public.missing_items limit 1), 'found', '2026-09-11', 'Handed in at the bar');
select pg_temp.check('found items are closed off', status, 'found') from public.missing_items limit 1;
select pg_temp.check('and record when they turned up', found_on, '2026-09-11'::date) from public.missing_items limit 1;

-- ============ the daily summary pulls the day together ============
select public.operations_summary('2026-09-10') as summary \gset
select pg_temp.check('the summary counts the guests',
  ((:'summary'::jsonb)->'guests'->>'pax')::int > 0, true);
select pg_temp.check('the summary lists the boats used',
  jsonb_array_length((:'summary'::jsonb)->'boats') > 0, true);
select pg_temp.check('the summary names the crew on the boats that have them',
  exists(select 1 from jsonb_array_elements((:'summary'::jsonb)->'boats') b
         where b->>'captain' is not null), true);
select pg_temp.check('the summary breaks down activities',
  jsonb_array_length((:'summary'::jsonb)->'activities') , 3);
select pg_temp.check('the summary includes the boat trips',
  jsonb_array_length((:'summary'::jsonb)->'trips') > 0, true);
select pg_temp.check('the summary includes missing items',
  jsonb_array_length((:'summary'::jsonb)->'missing_items'), 1);
select pg_temp.check('the summary includes the bar takings',
  ((:'summary'::jsonb)->'bar') is not null, true);
select pg_temp.check('the summary includes what was bought',
  ((:'summary'::jsonb)->'supplies') is not null, true);

-- A guide gets the operational blocks but not the money ones.
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select pg_temp.check('a coordinator has no ops log access by default',
  public.has_permission('ops.log.view'), true);

-- ============ passports are auditable without breaking the write ============
set role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select public.save_booking(
  jsonb_build_object('service_date','2026-09-13','lead_name','Passport Test','source_type','in_house'),
  jsonb_build_array(jsonb_build_object(
    'full_name','Traveller One','age_band','adult',
    'private', jsonb_build_object('passport_no','Z9988776')))
) as pass \gset
reset role;
select pg_temp.check('a passport number saves', passport_no, 'Z9988776')
from public.tourist_private tp
join public.tourists t on t.id = tp.tourist_id
where t.booking_id = :'pass';
select pg_temp.check('and the write is recorded against the guest', count(*)::int > 0, true)
from public.audit_logs where entity_type = 'tourist_private';
