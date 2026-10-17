\set ON_ERROR_STOP on
\set QUIET on
\pset pager off

create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, false);
end $$;

create or replace function pg_temp.check(label text, got anyelement, want anyelement) returns void language plpgsql as $$
begin
  if got is not distinct from want then
    raise notice 'PASS  % (%)', label, got;
  else
    raise exception 'FAIL  % -> got %, want %', label, got, want;
  end if;
end $$;

-- ============ Agent Blue enters a family of 5 ============
set role authenticated;
select pg_temp.as_user('33333333-3333-3333-3333-333333333333');

select public.save_booking(
  jsonb_build_object(
    'service_date', '2026-09-10',
    'lead_name', 'Tan Family',
    'lead_phone', '+60123456789',
    'pickup_hotel_name', 'Hotel Marina Bay',
    'pickup_latitude', 5.41, 'pickup_longitude', 100.33,
    'agency_id', 'bbbbbbbb-0000-0000-0000-00000000000b',   -- tries to file under a rival agency
    'source_type', 'in_house'                              -- and tries to look in-house
  ),
  jsonb_build_array(
    jsonb_build_object('full_name','Tan Wei',   'phone','+60111111111','age_band','adult','is_lead',true,
                       'private', jsonb_build_object('passport_no','A1234567')),
    jsonb_build_object('full_name','Tan Mei',   'age_band','adult'),
    jsonb_build_object('full_name','Tan Jun',   'age_band','child'),
    jsonb_build_object('full_name','Tan Xin',   'age_band','child'),
    jsonb_build_object('full_name','Tan Bao',   'age_band','infant')
  )
) as blue_booking \gset

select pg_temp.check('booking pax counted from the name list', pax_total, 5) from public.bookings where id = :'blue_booking';
select pg_temp.check('agent cannot file under another agency', agency_id, 'aaaaaaaa-0000-0000-0000-00000000000a'::uuid) from public.bookings where id = :'blue_booking';
select pg_temp.check('agent cannot fake the source', source_type, 'agent') from public.bookings where id = :'blue_booking';
select pg_temp.check('agent has no passport rights so none stored', count(*)::int, 0) from public.tourist_private;
select pg_temp.check('agent sees own booking', count(*)::int, 1) from public.bookings;
select pg_temp.check('agent sees own 5 tourists', count(*)::int, 5) from public.tourists;

-- Agent Blue adds a second booking at a nearby hotel
select public.save_booking(
  jsonb_build_object('service_date','2026-09-10','lead_name','Lee Couple',
                     'pickup_hotel_name','Marina Suites','pickup_latitude',5.412,'pickup_longitude',100.331),
  jsonb_build_array(
    jsonb_build_object('full_name','Lee Ann','age_band','adult','is_lead',true),
    jsonb_build_object('full_name','Lee Bob','age_band','adult'))
) as blue2 \gset

-- ============ Agent Red must not see any of it ============
select pg_temp.as_user('44444444-4444-4444-4444-444444444444');
select pg_temp.check('rival agent sees zero bookings', count(*)::int, 0) from public.bookings;
select pg_temp.check('rival agent sees zero tourists', count(*)::int, 0) from public.tourists;
select pg_temp.check('rival agent sees zero passengers', count(*)::int, 0) from public.trip_passengers;
select pg_temp.check('rival agent sees only own agency', count(*)::int, 1) from public.agencies;
select pg_temp.check('rival agent cannot list staff', count(*)::int, 0) from public.employees;
select pg_temp.check('rival agent cannot list boats', count(*)::int, 0) from public.boats;
select pg_temp.check('rival agent cannot read other profiles', count(*)::int, 1) from public.profiles;

do $$
begin
  perform public.delete_booking((select id from public.bookings limit 1));
  raise exception 'FAIL rival agent deleted a booking';
exception when sqlstate '42501' or sqlstate '02000' then
  raise notice 'PASS  rival agent blocked from delete_booking';
end $$;

-- ============ Coordinator sees everything ============
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select pg_temp.check('coordinator sees the full guest list', count(*)::int, 2) from public.bookings;
select pg_temp.check('coordinator sees all 7 tourists', count(*)::int, 7) from public.tourists;
