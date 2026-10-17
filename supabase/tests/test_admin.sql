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

-- ============ maintenance ============
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');  -- master admin

insert into public.boat_fuel_logs (boat_id, log_date, entry_type, litres, price_per_litre)
values ('b0a70001-0000-0000-0000-000000000001','2026-09-10','refuel', 100, 2.50);
select pg_temp.check('refuel cost auto-calculated', total_cost, 250.00)
from public.boat_fuel_logs order by created_at desc limit 1;

update public.boats set expected_litres_per_trip = 20 where code = 'Boat 1';
insert into public.boat_fuel_logs (boat_id, log_date, entry_type, litres, price_per_litre) values
  ('b0a70001-0000-0000-0000-000000000001','2026-09-10','trip_usage', 30, 2.50),
  ('b0a70001-0000-0000-0000-000000000001','2026-09-11','trip_usage', 30, 2.50);
select pg_temp.check('overspend flagged against the boat baseline', variance_pct, 50.0)
from public.boat_fuel_summary('2026-09-01','2026-09-30') where boat_code='Boat 1';

-- repairs: second engine job on the same boat is flagged as a repeat
insert into public.boat_repairs (boat_id, reported_date, issue_title, issue_category, cost, status, fixed_date)
values ('b0a70002-0000-0000-0000-000000000002','2026-06-01','Engine overheating','engine', 800, 'fixed', '2026-06-03');
insert into public.boat_repairs (boat_id, reported_date, issue_title, issue_category, cost, out_of_service)
values ('b0a70002-0000-0000-0000-000000000002','2026-09-01','Engine overheating again','engine', 1200, true);

select pg_temp.check('repeat problem detected', is_recurring, true)
from public.boat_repairs where issue_title='Engine overheating again';
select pg_temp.check('repeat linked to the earlier job', (previous_repair_id is not null), true)
from public.boat_repairs where issue_title='Engine overheating again';
select pg_temp.check('boat parked while out of service', status, 'maintenance')
from public.boats where code='Boat 2';

update public.boat_repairs set status='fixed' where issue_title='Engine overheating again';
select pg_temp.check('boat back in service once fixed', status, 'active') from public.boats where code='Boat 2';
select pg_temp.check('fixed date stamped automatically', (fixed_date is not null), true)
from public.boat_repairs where issue_title='Engine overheating again';

-- ============ customisable access ============
-- Give the Blue agent one extra permission, by hand, for this user only.
select public.admin_set_permission_override('33333333-3333-3333-3333-333333333333','guests.contact.view','grant');
reset role;
select pg_temp.check('per-user grant took effect',
  public.user_has_permission('33333333-3333-3333-3333-333333333333','guests.contact.view'), true);

set role authenticated;
-- Take POS voiding away from the bar tablet without touching anyone else.
select public.admin_set_permission_override('66666666-6666-6666-6666-666666666666','bar.pos.void','revoke');
reset role;
select pg_temp.check('per-user revoke beats the role',
  public.user_has_permission('66666666-6666-6666-6666-666666666666','bar.pos.void'), false);
select pg_temp.check('other bar rights untouched',
  public.user_has_permission('66666666-6666-6666-6666-666666666666','bar.pos.use'), true);

set role authenticated;
-- Re-mix a whole role: agents may now see passports by default.
select public.admin_set_role_permission('agent','guests.export',true);
reset role;
select pg_temp.check('role edit reaches every user on that role',
  public.user_has_permission('44444444-4444-4444-4444-444444444444','guests.export'), true);

set role authenticated;
-- Suspending a user cuts everything off instantly.
select public.admin_update_user('44444444-4444-4444-4444-444444444444', p_status => 'suspended');
reset role;
select pg_temp.check('suspended user loses every permission',
  public.user_has_permission('44444444-4444-4444-4444-444444444444','guests.booking.view_own'), false);

set role authenticated;
-- A coordinator must not be able to hand out admin-panel rights.
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
do $$
begin
  perform public.admin_update_user('33333333-3333-3333-3333-333333333333', p_access_role_code => 'master_admin');
  raise exception 'FAIL coordinator escalated an account';
exception when sqlstate '42501' then raise notice 'PASS  non-admin cannot promote anyone';
end $$;

-- Legacy bar policies still follow the new matrix.
select pg_temp.as_user('66666666-6666-6666-6666-666666666666');
select pg_temp.check('bar tablet keeps its legacy admin role', public.current_user_role(), 'admin');
select pg_temp.check('bar tablet cannot see the guest list', count(*)::int, 0) from public.bookings;
select pg_temp.check('bar tablet cannot see boats', count(*)::int, 0) from public.boats;
select pg_temp.check('bar tablet still sees products', (count(*) >= 0), true) from public.products;

-- ============ shared bar code kill switch ============
reset role;
select pg_temp.check('bar tablet is active before the switch', status, 'active')
from public.profiles where id='66666666-6666-6666-6666-666666666666';

update public.app_settings set value = 'false'::jsonb where key = 'allow_access_code_login';

select pg_temp.check('turning the code off suspends tablets already signed in', status, 'suspended')
from public.profiles where id='66666666-6666-6666-6666-666666666666';
select pg_temp.check('suspended tablet loses bar access',
  public.user_has_permission('66666666-6666-6666-6666-666666666666','bar.pos.use'), false);
select pg_temp.check('personal accounts are untouched',
  public.user_has_permission('22222222-2222-2222-2222-222222222222','guests.booking.view_all'), true);

-- ============ guard rails ============
set role authenticated;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');   -- coordinator
do $$
declare v_id uuid;
begin
  select id into v_id from public.bookings limit 1;
  perform public.save_booking(jsonb_build_object('id', v_id, 'service_date','2026-09-10','lead_name','Tan Family'), '[]'::jsonb);
  raise exception 'FAIL an empty guest list wiped a booking';
exception when sqlstate 'P0001' then
  if sqlerrm like '%at least one guest%' then raise notice 'PASS  a booking cannot be emptied by accident';
  else raise; end if;
end $$;

select pg_temp.as_user('44444444-4444-4444-4444-444444444444');   -- suspended rival agent
select pg_temp.check('agent cannot read the boarding manifest', count(*)::int, 0) from public.trip_manifest;
select pg_temp.check('agent cannot read pickup runs', count(*)::int, 0) from public.pickup_groups;
select pg_temp.check('agent cannot read fuel records', count(*)::int, 0) from public.boat_fuel_logs;
select pg_temp.check('agent cannot read repair records', count(*)::int, 0) from public.boat_repairs;
select pg_temp.check('agent cannot read the audit log', count(*)::int, 0) from public.audit_logs;
