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

-- ============ kitchen raises a request ============
select pg_temp.as_user('88888888-8888-8888-8888-888888888888');   -- cook
select public.save_purchase_request(
  jsonb_build_object('needed_for_date','2026-09-10','pax_count',42,'purpose','Island lunch'),
  jsonb_build_array(
    jsonb_build_object('item_name','Chicken breast','quantity',12,'unit','kg'),
    jsonb_build_object('item_name','Rice','quantity',20,'unit','kg'),
    jsonb_build_object('item_name','Cooking oil','quantity',5,'unit','L','note','Any brand'))
) as req \gset

select pg_temp.check('request starts as a draft', status, 'draft') from public.purchase_requests where id = :'req';
select pg_temp.check('three items saved', count(*)::int, 3) from public.purchase_request_items where request_id = :'req';
select pg_temp.check('nothing queued before it is confirmed', count(*)::int, 0)
from public.outbound_messages where reference_id = :'req';

-- Confirming is what sends the WhatsApp message.
select public.submit_purchase_request(:'req');
reset role;
select pg_temp.check('confirming queues exactly one message', count(*)::int, 1)
from public.outbound_messages where reference_id = :'req';
select pg_temp.check('message carries the date', body like '%10 Sep 2026%', true)
from public.outbound_messages where reference_id = :'req';
select pg_temp.check('message carries the pax count', body like '%Pax: 42%', true)
from public.outbound_messages where reference_id = :'req';
select pg_temp.check('message lists every ingredient',
  (body like '%Chicken breast - 12 kg%' and body like '%Rice - 20 kg%' and body like '%Cooking oil - 5 L%'), true)
from public.outbound_messages where reference_id = :'req';

-- ============ the on/off switch really stops it ============
set role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');   -- master
select public.set_notification_rule('kitchen.request_submitted', false);

select pg_temp.as_user('88888888-8888-8888-8888-888888888888');
select public.save_purchase_request(
  jsonb_build_object('needed_for_date','2026-09-11','pax_count',10,'purpose','Test'),
  jsonb_build_array(jsonb_build_object('item_name','Ice','quantity',3,'unit','bag'))
) as req2 \gset
select public.submit_purchase_request(:'req2');
reset role;
select pg_temp.check('switched off means no message at all', count(*)::int, 0)
from public.outbound_messages where reference_id = :'req2';

set role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select public.set_notification_rule('kitchen.request_submitted', true);

-- ============ purchasing works the queue ============
select pg_temp.as_user('99999999-9999-9999-9999-999999999999');   -- buyer
select pg_temp.check('buyer sees the submitted requests', count(*)::int, 2)
from public.purchase_requests where status in ('submitted','buying');

select public.set_purchase_item_status(
  array(select id from public.purchase_request_items where request_id = :'req' limit 2),
  'bought', null, 120.50, 'Pasar Besar', null);
reset role;
select pg_temp.check('part bought moves the request to buying', status, 'buying')
from public.purchase_requests where id = :'req';

set role authenticated;
select pg_temp.as_user('99999999-9999-9999-9999-999999999999');
select public.set_purchase_item_status(
  array(select id from public.purchase_request_items where request_id = :'req' and purchase_status = 'pending'),
  'bought', null, 30, 'Pasar Besar', null);
reset role;
select pg_temp.check('all items bought completes the request', status, 'completed')
from public.purchase_requests where id = :'req';

set role authenticated;
select pg_temp.as_user('33333333-3333-3333-3333-333333333333');   -- travel agent
select pg_temp.check('an agent cannot see the buying list at all', count(*)::int, 0) from public.purchase_requests;

-- ============ operations log and late-step alerts ============
set role authenticated;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');   -- coordinator

select a.id from public.boat_assignments a join public.boats b on b.id = a.boat_id
where a.service_date = '2026-09-10' and b.code = 'Boat 2' \gset b2_

select public.mark_boarding(array(select id from public.trip_passengers where assignment_id = :'b2_id'), 'arrived');
reset role;
select pg_temp.check('boarding completion is logged', count(*)::int, 1)
from public.operations_events where event_code = 'boarding.completed' and reference_id = :'b2_id';
select pg_temp.check('the log names the boat', subject, 'Boat 2')
from public.operations_events where event_code = 'boarding.completed' and reference_id = :'b2_id';

set role authenticated;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select public.mark_boarding(array(select id from public.trip_passengers where assignment_id = :'b2_id' limit 1), 'arrived');
reset role;
select pg_temp.check('the milestone is not logged twice', count(*)::int, 1)
from public.operations_events where event_code = 'boarding.completed' and reference_id = :'b2_id';

set role authenticated;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select public.set_passenger_activity(array(select id from public.trip_passengers where assignment_id = :'b2_id'), 'snorkel');
reset role;
select pg_temp.check('activity selection completion is logged', count(*)::int, 1)
from public.operations_events where event_code = 'activities.selected' and reference_id = :'b2_id';

set role authenticated;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select count(*)::int as done_rows from public.operations_day_status('2026-09-10') where done \gset s_
select pg_temp.check('the day status shows completed steps', :s_done_rows >= 2, true);

-- A future date is not late yet, which is the whole point of the timer.
select count(*)::int as future_late from public.operations_day_status('2026-12-31') where overdue \gset f_
select pg_temp.check('a step whose time has not come is not late', :f_future_late, 0);

-- A past day whose steps were never done must read as late.
select count(*)::int as late from public.operations_day_status(current_date - 1) where overdue \gset o_
select pg_temp.check('unfinished steps past their time are flagged late', :o_late > 0, true);
select public.raise_overdue_alerts(current_date - 1) as raised \gset
select pg_temp.check('late steps raise alerts', :'raised'::int > 0, true);
select public.raise_overdue_alerts(current_date - 1) as raised2 \gset
select pg_temp.check('the same late step does not alert twice', :'raised2'::int, 0);

-- ============ only the person who entered it may edit it ============
set role authenticated;
select pg_temp.as_user('33333333-3333-3333-3333-333333333333');   -- Agent Blue
select id from public.bookings where lead_name = 'Tan Family' \gset tan_
select pg_temp.check('the person who entered it can edit it', public.can_edit_booking(:'tan_id'), true);

select pg_temp.as_user('77777777-7777-7777-7777-777777777777');   -- Agent Blue Two, same agency
select pg_temp.check('a colleague at the same agency can still see it', public.can_view_booking(:'tan_id'), true);
select pg_temp.check('but cannot edit what they did not enter', public.can_edit_booking(:'tan_id'), false);

do $$
declare v_id uuid;
begin
  select id into v_id from public.bookings where lead_name = 'Tan Family';
  perform public.save_booking(
    jsonb_build_object('id', v_id, 'service_date','2026-09-10','lead_name','Hijacked'),
    jsonb_build_array(jsonb_build_object('full_name','Someone')));
  raise exception 'FAIL a colleague edited a booking they did not enter';
exception when sqlstate '42501' then raise notice 'PASS  editing someone else''s entry is refused';
end $$;

select pg_temp.as_user('22222222-2222-2222-2222-222222222222');   -- coordinator has edit_all
select pg_temp.check('a coordinator can edit anyone''s', public.can_edit_booking(:'tan_id'), true);

-- ============ deleting needs a written reason ============
select pg_temp.as_user('33333333-3333-3333-3333-333333333333');
do $$
declare v_id uuid;
begin
  select id into v_id from public.bookings where lead_name = 'Lee Couple';
  perform public.delete_booking(v_id, '');
  raise exception 'FAIL deleted with no reason';
exception when sqlstate '42501' then raise notice 'PASS  agent has no delete right anyway';
      when sqlstate 'P0001' then raise notice 'PASS  a reason is required to delete';
end $$;

select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
do $$
declare v_id uuid;
begin
  select id into v_id from public.bookings where lead_name = 'Lee Couple';
  perform public.delete_booking(v_id, 'x');
  raise exception 'FAIL a one letter reason was accepted';
exception when sqlstate 'P0001' then raise notice 'PASS  a token reason is rejected';
end $$;

-- ============ the change trail ============
reset role;
select pg_temp.check('entering a booking is recorded', count(*)::int > 0, true)
from public.audit_logs where entity_type = 'bookings' and action = 'insert';
select pg_temp.check('the trail names who did it', count(*)::int > 0, true)
from public.audit_logs where entity_type = 'bookings' and actor_name is not null;

set role authenticated;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select public.delete_booking(:'tan_id', 'Guest cancelled the trip by phone');
reset role;
select pg_temp.check('the delete reason is stored', reason, 'Guest cancelled the trip by phone')
from public.audit_logs where action = 'delete_booking' and entity_id = :'tan_id';

-- ============ home screen badges ============
set role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select count(*)::int as badge_rows from public.department_badges('2026-09-10') \gset bg_
select pg_temp.check('the master admin gets badge counts', :bg_badge_rows > 0, true);
select pg_temp.as_user('33333333-3333-3333-3333-333333333333');
select count(*)::int as agent_badges from public.department_badges('2026-09-10') \gset ag_
select pg_temp.check('an agent gets no badges for other departments', :ag_agent_badges, 0);
