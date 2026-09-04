-- =====================================================================
-- Test data: three days of roughly 88 guests each.
--
--   yesterday  a finished day - boarded, activities done, everyone back
--   today      half run - boats assigned and crewed, boarding under way
--   tomorrow   bookings only, so there is something to plan from scratch
--
-- Safe to re-run: it does nothing if those dates already have bookings.
-- Remove it with the DELETE at the bottom of this file.
-- =====================================================================

do $$
declare
  v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_days date[] := array[v_today - 1, v_today, v_today + 1];
  v_first text[] := array[
    'Wei Ming','Siew Lan','Jun Hao','Xin Yi','Kok Wah','Mei Ling','Zi Xuan','Ah Ma',
    'Hans','Anna','Lukas','Marie','Greta','Johan','Elke','Stefan',
    'Minh','Lan','Bao','Duc','Hoa','Nam','Thuy','Khanh',
    'James','Emily','Oliver','Charlotte','Harry','Sophie','Jack','Amelia',
    'Ji Woo','Seo Yeon','Min Jun','Ha Eun','Aiko','Haruto','Yuki','Sakura',
    'Arun','Priya','Vikram','Divya','Nurul','Faiz','Aisyah','Hakim',
    'Pierre','Camille','Lucas','Chloe'];
  v_last text[] := array[
    'Tan','Lim','Wong','Chen','Lee','Ng','Goh','Teo','Schmidt','Mueller','Weber',
    'Nguyen','Tran','Pham','Vo','Walker','Brooks','Hayes','Carter','Kim','Park',
    'Choi','Tanaka','Sato','Sharma','Patel','Abdullah','Ibrahim','Dubois','Moreau'];
  v_nations text[] := array[
    'Malaysian','Singaporean','German','Vietnamese','British','Korean',
    'Japanese','Indian','French','Australian','Chinese','Dutch'];
  v_sources text[] := array['agent','agent','ota','ota','in_house','in_house','walk_in'];

  v_day date;
  v_day_index int;
  v_seq int;
  v_pax_done int;
  v_size int;
  v_person int;
  v_booking_id uuid;
  v_tourist_id uuid;
  v_surname text;
  v_source text;
  v_agency uuid;
  v_hotel record;
  v_band text;
  v_assist boolean;
  v_rand float;
begin
  if exists (select 1 from public.bookings where service_date = any(v_days)) then
    raise notice 'Test data already present for these dates. Nothing inserted.';
    return;
  end if;

  -- Deterministic, so re-seeding a fresh database gives the same figures.
  perform setseed(0.4242);

  -- Hotels the guests are collected from.
  insert into public.pickup_locations (name, area, latitude, longitude) values
    ('Hotel Marina Bay',   'Marina',    5.410000, 100.330000),
    ('Marina Suites',      'Marina',    5.412000, 100.331000),
    ('Sunset Beach Villa', 'Sunset Bay',5.470000, 100.290000),
    ('Town Backpackers',   'Old Town',  5.420000, 100.340000),
    ('Hillview Resort',    'Hillside',  5.395000, 100.305000),
    ('Pier Lodge',         'Jetty',     5.421000, 100.341000)
  on conflict do nothing;

  -- Vans big enough to collect about sixty guests a morning.
  insert into public.transport_vehicles (code, name, vehicle_type, capacity_pax, plate_no, sort_order) values
    ('Van 1', 'Toyota Hiace',    'van', 12, 'PKA 1234', 1),
    ('Van 2', 'Nissan Urvan',    'van', 10, 'PKA 5678', 2),
    ('Van 3', 'Ford Transit',    'van', 14, 'PKA 3344', 3),
    ('Bus 1', 'Higer 30-seater', 'bus', 30, 'PKB 7788', 4),
    ('Car 1', 'Toyota Avanza',   'car',  5, 'PKB 9012', 5),
    ('Van 4', 'Toyota Hiace',    'van', 12, 'PKA 4411', 6),
    ('Car 2', 'Perodua Alza',    'car',  6, 'PKB 2255', 7)
  on conflict do nothing;

  -- A fleet that can actually carry ninety guests.
  insert into public.boats (code, name, boat_type, capacity_pax, ownership, expected_litres_per_trip, status, sort_order) values
    ('Boat 5', 'Reef Runner', 'ferry', 30, 'owned', 32, 'active', 5)
  on conflict do nothing;
  update public.boats set capacity_pax = 14, expected_litres_per_trip = 20 where code = 'Boat 1';
  update public.boats set capacity_pax = 14, expected_litres_per_trip = 18 where code = 'Boat 2';
  update public.boats set capacity_pax = 40, expected_litres_per_trip = 38 where code = 'Boat 3';

  v_day_index := 0;
  foreach v_day in array v_days loop
    v_day_index := v_day_index + 1;
    v_seq := 0;
    v_pax_done := 0;

    while v_pax_done < 88 loop
      v_seq := v_seq + 1;
      v_rand := random();
      -- Couples and small families dominate, with the occasional coach party.
      v_size := case
        when v_rand < 0.28 then 2
        when v_rand < 0.50 then 4
        when v_rand < 0.68 then 3
        when v_rand < 0.82 then 5
        when v_rand < 0.92 then 6
        when v_rand < 0.97 then 8
        else 12 end;

      v_surname := v_last[1 + floor(random() * array_length(v_last, 1))::int];
      v_source := v_sources[1 + floor(random() * array_length(v_sources, 1))::int];

      select id into v_agency from public.agencies
      where source_type = v_source order by random() limit 1;

      -- Only hotels we hold coordinates for, so the route planner has
      -- something to order the stops by.
      select * into v_hotel from public.pickup_locations
      where latitude is not null and longitude is not null
      order by random() limit 1;

      insert into public.bookings (
        booking_ref, service_date, source_type, agency_id, lead_name, lead_phone,
        pickup_location_id, pickup_hotel_name, pickup_area,
        pickup_latitude, pickup_longitude, pickup_required, status
      )
      values (
        'LP-' || to_char(v_day, 'YYMMDD') || '-' || lpad(v_seq::text, 3, '0'),
        v_day,
        v_source,
        v_agency,
        case when v_size > 4 then v_surname || ' Group'
             when v_size > 2 then v_surname || ' Family'
             else v_first[1 + floor(random() * array_length(v_first, 1))::int] || ' ' || v_surname end,
        '+60 1' || floor(random() * 9)::text || '-' || lpad(floor(random() * 900 + 100)::text, 3, '0')
          || ' ' || lpad(floor(random() * 9000 + 1000)::text, 4, '0'),
        v_hotel.id, v_hotel.name, v_hotel.area, v_hotel.latitude, v_hotel.longitude,
        random() < 0.72,   -- most guests are collected, some make their own way
        'confirmed'
      )
      returning id into v_booking_id;

      for v_person in 1..v_size loop
        v_rand := random();
        v_band := case
          when v_size > 2 and v_person > 2 and v_rand < 0.42 then
            case when v_rand < 0.08 then 'infant' else 'child' end
          when v_rand > 0.93 then 'elderly'
          else 'adult' end;
        v_assist := case when v_band = 'elderly' then random() < 0.45 else random() < 0.02 end;

        insert into public.tourists (
          booking_id, full_name, phone, nationality, age_band, is_lead,
          sort_order, needs_assistance, assistance_note
        )
        values (
          v_booking_id,
          v_first[1 + floor(random() * array_length(v_first, 1))::int] || ' ' || v_surname,
          case when v_person = 1 then '+60 1' || floor(random() * 9)::text || '-'
               || lpad(floor(random() * 900 + 100)::text, 3, '0') || ' '
               || lpad(floor(random() * 9000 + 1000)::text, 4, '0') end,
          v_nations[1 + floor(random() * array_length(v_nations, 1))::int],
          v_band,
          v_person = 1,
          v_person,
          v_assist,
          case when v_assist then 'Needs a hand getting on and off the boat' end
        )
        returning id into v_tourist_id;

        if v_person = 1 then
          insert into public.tourist_private (tourist_id, passport_no)
          values (v_tourist_id, 'P' || lpad(floor(random() * 9000000 + 1000000)::text, 7, '0'))
          on conflict do nothing;
        end if;
      end loop;

      perform public.recount_booking_pax(v_booking_id);
      v_pax_done := v_pax_done + v_size;
    end loop;

    raise notice 'Seeded % with % guests across % bookings.', v_day, v_pax_done, v_seq;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Seat yesterday and today onto boats, and run yesterday to completion.
-- ---------------------------------------------------------------------
do $$
declare
  v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_day date;
  v_assignment uuid;
  v_boat record;
  v_booking record;
  v_seated int;
  v_captain uuid;
  v_guide uuid;
  v_index int;
begin
  if exists (select 1 from public.boat_assignments where service_date in (v_today - 1, v_today)) then
    raise notice 'Boats already assigned for these dates. Nothing changed.';
    return;
  end if;

  select id into v_captain from public.employees where job_type = 'captain' order by full_name limit 1;
  select id into v_guide from public.employees where job_type = 'guide' order by full_name limit 1;

  foreach v_day in array array[v_today - 1, v_today] loop
    v_index := 0;
    for v_boat in select * from public.boats where status = 'active' order by sort_order loop
      v_index := v_index + 1;
      insert into public.boat_assignments (
        service_date, boat_id, trip_no, departure_time, captain_employee_id, guide_employee_id
      )
      values (v_day, v_boat.id, 1, '09:00',
              case when v_index <= 2 then v_captain end,
              case when v_index <= 3 then v_guide end)
      returning id into v_assignment;

      v_seated := 0;
      -- Biggest groups first so a coach party is not stranded by leftovers.
      for v_booking in
        select b.* from public.bookings b
        where b.service_date = v_day
          and not exists (select 1 from public.trip_bookings t where t.booking_id = b.id)
        order by b.pax_total desc
      loop
        exit when v_seated >= v_boat.capacity_pax;
        continue when v_seated + v_booking.pax_total > v_boat.capacity_pax;

        insert into public.trip_bookings (assignment_id, booking_id) values (v_assignment, v_booking.id);
        v_seated := v_seated + v_booking.pax_total;
      end loop;
    end loop;
  end loop;

  -- Yesterday is finished: everyone checked in, activities chosen and done,
  -- and everyone back on the boat.
  update public.trip_passengers tp
  set boarding_status = 'arrived',
      boarded_at = (v_today - 1) + time '08:30',
      activity_code = (array['snorkel','volcano','others'])[1 + (abs(hashtext(tp.id::text)) % 3)],
      activity_status = 'joined',
      activity_marked_at = (v_today - 1) + time '11:00',
      returned = true,
      returned_at = (v_today - 1) + time '15:45'
  from public.boat_assignments a
  where a.id = tp.assignment_id and a.service_date = v_today - 1;

  update public.boat_assignments set status = 'returned' where service_date = v_today - 1;

  -- Today: the first boat is fully checked in, the rest are still boarding.
  update public.trip_passengers tp
  set boarding_status = 'arrived',
      boarded_at = now(),
      activity_code = case when abs(hashtext(tp.id::text)) % 3 = 0 then 'snorkel' end
  from public.boat_assignments a
  join public.boats b on b.id = a.boat_id
  where a.id = tp.assignment_id and a.service_date = v_today and b.sort_order = 1;

  raise notice 'Boats assigned. Yesterday completed, today part boarded.';
end $$;

-- Fuel bought for the fleet, and the trips those boats made.
insert into public.fuel_purchases (purchase_date, litres, price_per_litre, supplier, notes)
select d, l, 2.50, 'Jetty station', n
from (values
  ((now() at time zone 'Asia/Kuala_Lumpur')::date - 1, 180, 'Morning fill for the fleet'),
  ((now() at time zone 'Asia/Kuala_Lumpur')::date,     140, null)
) as t(d, l, n)
where not exists (
  select 1 from public.fuel_purchases
  where purchase_date >= (now() at time zone 'Asia/Kuala_Lumpur')::date - 1
);

-- To remove everything this file created:
--   delete from public.bookings where service_date between current_date - 1 and current_date + 1;
--   delete from public.fuel_purchases where purchase_date >= current_date - 1;
