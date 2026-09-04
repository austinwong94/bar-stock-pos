-- Users
insert into auth.users (id, email, is_anonymous, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'owner@lovely.test',  false, '{"full_name":"Owner"}'),
  ('22222222-2222-2222-2222-222222222222', 'coord@lovely.test',  false, '{"full_name":"Coordinator"}'),
  ('33333333-3333-3333-3333-333333333333', 'agentA@blue.test',   false, '{"full_name":"Agent Blue"}'),
  ('44444444-4444-4444-4444-444444444444', 'agentB@red.test',    false, '{"full_name":"Agent Red"}'),
  ('55555555-5555-5555-5555-555555555555', 'captain@lovely.test',false, '{"full_name":"Captain Ali"}'),
  ('66666666-6666-6666-6666-666666666666', null,                 true,  '{"full_name":"Bar Tablet"}');

insert into public.agencies (id, name, source_type) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'Blue Sea Travel', 'agent'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'Red Coral Tours', 'agent');

update public.profiles set access_role_code='master_admin', status='active' where id='11111111-1111-1111-1111-111111111111';
update public.profiles set access_role_code='coordinator',  status='active' where id='22222222-2222-2222-2222-222222222222';
update public.profiles set access_role_code='agent', status='active', agency_id='aaaaaaaa-0000-0000-0000-00000000000a' where id='33333333-3333-3333-3333-333333333333';
update public.profiles set access_role_code='agent', status='active', agency_id='bbbbbbbb-0000-0000-0000-00000000000b' where id='44444444-4444-4444-4444-444444444444';
update public.profiles set access_role_code='captain', status='active' where id='55555555-5555-5555-5555-555555555555';

insert into public.employees (id, full_name, job_type, profile_id) values
  ('eeeeeeee-0000-0000-0000-00000000000c', 'Captain Ali', 'captain', '55555555-5555-5555-5555-555555555555'),
  ('eeeeeeee-0000-0000-0000-00000000000d', 'Guide Mei', 'guide', null);

insert into public.boats (id, code, name, boat_type, capacity_pax, ownership, sort_order) values
  ('b0a70001-0000-0000-0000-000000000001', 'Boat 1', 'Sea Star',  'speedboat', 12, 'owned',   1),
  ('b0a70002-0000-0000-0000-000000000002', 'Boat 2', 'Blue Wave', 'speedboat',  8, 'owned',   2),
  ('b0a70003-0000-0000-0000-000000000003', 'Boat 3', 'Partner 1', 'ferry',     20, 'partner', 3);

insert into public.pickup_locations (name, area, latitude, longitude) values
  ('Hotel Marina Bay',  'Marina',  5.410000, 100.330000),
  ('Marina Suites',     'Marina',  5.412000, 100.331000),
  ('Sunset Beach Villa','Sunset',  5.470000, 100.290000);
