-- =====================================================================
-- Starter data for the operations departments. Safe to re-run.
-- Run this after `supabase db push`, and after supabase/seed.sql if you
-- also want the bar products.
-- =====================================================================

-- Fleet. Change the codes, types and capacities to match the real boats.
insert into public.boats (code, name, boat_type, capacity_pax, ownership, owner_name, expected_litres_per_trip, status, sort_order)
values
  ('Boat 1', 'Sea Star',   'speedboat', 12, 'owned',   null,            20, 'active', 1),
  ('Boat 2', 'Blue Wave',  'speedboat', 12, 'owned',   null,            20, 'active', 2),
  ('Boat 3', 'Island Hop', 'ferry',     24, 'owned',   null,            35, 'active', 3),
  ('Boat 4', 'Partner 1',  'speedboat', 10, 'partner', 'Partner owner', 18, 'active', 4)
on conflict do nothing;

-- Crew. These names fill the captain and guide dropdowns on the boat board,
-- so nobody has to retype a name again.
insert into public.employees (full_name, job_type, phone)
values
  ('Captain Ali',  'captain', null),
  ('Captain Rosli','captain', null),
  ('Guide Mei',    'guide',   null),
  ('Guide Aina',   'guide',   null),
  ('Driver Kumar', 'driver',  null)
on conflict do nothing;

-- Booking sources. In-house entries need no agency; every outside agent or
-- OTA gets a row here, and their logins are attached to it.
insert into public.agencies (name, source_type)
values
  ('Walk-in / In-house', 'in_house'),
  ('Example Travel Agent', 'agent'),
  ('Example OTA', 'ota')
on conflict do nothing;

-- Pickup points. Coordinates are what makes auto-grouping work; without them
-- the system falls back to matching the hotel name.
insert into public.pickup_locations (name, area, latitude, longitude)
values
  ('Hotel Example Marina', 'Marina', null, null),
  ('Example Beach Resort', 'Beach',  null, null)
on conflict do nothing;

-- Activities. Snorkel and volcanic mud ship by default; add more here or
-- from the app when a new one starts.
insert into public.activity_types (code, name, description, sort_order)
values ('snorkel', 'Snorkelling', 'Reef snorkelling trip.', 1)
on conflict (code) do nothing;
