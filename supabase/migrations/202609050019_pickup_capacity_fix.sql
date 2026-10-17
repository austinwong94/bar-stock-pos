-- =====================================================================
-- Two faults the 90-guest test data exposed in the pickup planner:
--
--   * a new run took the largest free vehicle without checking the group
--     actually fitted, so a six pax booking landed in a five seat car;
--   * once every vehicle was busy it kept creating runs with no vehicle
--     at all, which have no seat limit and so silently absorb everyone.
--
-- A booking that cannot be seated is now left in the waiting list, where
-- the coordinator can see it and add a vehicle or split the group.
-- =====================================================================
create or replace function public.auto_plan_pickups(
  p_service_date date,
  p_radius_km numeric default null
)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_radius numeric := coalesce(p_radius_km, public.setting_numeric('pickup_group_radius_km', 1.5));
  v_base_lat numeric := public.setting_numeric('base_latitude', 5.42);
  v_base_lng numeric := public.setting_numeric('base_longitude', 100.34);
  rec record;
  v_run_id uuid;
  v_vehicle record;
  v_cluster_pax int;
  v_placed int := 0;
begin
  perform public.require_permission('guests.pickup.manage');

  for rec in
    select
      b.id,
      b.pax_total,
      coalesce(nullif(trim(b.pickup_hotel_name), ''), nullif(trim(b.pickup_area), ''), 'Pickup') as spot,
      nullif(trim(b.pickup_area), '') as area,
      coalesce(b.pickup_latitude, l.latitude) as lat,
      coalesce(b.pickup_longitude, l.longitude) as lng
    from public.bookings b
    left join public.pickup_locations l on l.id = b.pickup_location_id
    where b.service_date = p_service_date
      and b.pickup_required
      and b.pickup_group_id is null
      and b.status in ('draft', 'confirmed', 'arrived')
    -- Furthest hotels first, so a run builds inwards towards the jetty.
    order by coalesce(public.distance_km(
      coalesce(b.pickup_latitude, l.latitude), coalesce(b.pickup_longitude, l.longitude),
      v_base_lat, v_base_lng), -1) desc, b.created_at
  loop
    v_run_id := null;

    -- An existing run works if it passes near this hotel and still has seats.
    select g.id into v_run_id
    from public.pickup_groups g
    join public.transport_vehicles v on v.id = g.vehicle_id
    where g.service_date = p_service_date
      and g.status <> 'cancelled'
      and exists (
        select 1 from public.bookings ob
        where ob.pickup_group_id = g.id
          and (
            lower(coalesce(ob.pickup_hotel_name, '')) = lower(rec.spot)
            or (rec.lat is not null and ob.pickup_latitude is not null
                and public.distance_km(rec.lat, rec.lng, ob.pickup_latitude, ob.pickup_longitude) <= v_radius)
          )
      )
      and coalesce((select sum(x.pax_total) from public.bookings x where x.pickup_group_id = g.id), 0)
          + rec.pax_total <= v.capacity_pax
    order by g.sort_order, g.created_at
    limit 1;

    if v_run_id is null then
      -- How many people are still waiting around this hotel, so the run gets a
      -- vehicle sized to the whole stop rather than to whoever booked first.
      -- Otherwise a two pax hotel takes the coach and the vans run out.
      select coalesce(sum(b.pax_total), 0) into v_cluster_pax
      from public.bookings b
      left join public.pickup_locations l on l.id = b.pickup_location_id
      where b.service_date = p_service_date
        and b.pickup_required
        and b.pickup_group_id is null
        and b.status in ('draft', 'confirmed', 'arrived')
        and (
          lower(coalesce(b.pickup_hotel_name, '')) = lower(rec.spot)
          or (rec.lat is not null
              and public.distance_km(rec.lat, rec.lng,
                    coalesce(b.pickup_latitude, l.latitude),
                    coalesce(b.pickup_longitude, l.longitude)) <= v_radius)
        );

      -- The smallest free vehicle that covers the stop.
      select v.* into v_vehicle
      from public.transport_vehicles v
      where v.active
        and v.capacity_pax >= greatest(v_cluster_pax, rec.pax_total)
        and not exists (
          select 1 from public.pickup_groups g
          where g.service_date = p_service_date and g.vehicle_id = v.id and g.status <> 'cancelled'
        )
      order by v.capacity_pax, v.sort_order, v.code
      limit 1;

      -- Too many for any one vehicle: take the biggest that is free and the
      -- rest of the stop goes on the next run.
      if v_vehicle.id is null then
        select v.* into v_vehicle
        from public.transport_vehicles v
        where v.active
          and v.capacity_pax >= rec.pax_total
          and not exists (
            select 1 from public.pickup_groups g
            where g.service_date = p_service_date and g.vehicle_id = v.id and g.status <> 'cancelled'
          )
        order by v.capacity_pax desc, v.sort_order, v.code
        limit 1;
      end if;

      -- Nothing free that fits: leave it waiting rather than overloading a
      -- van or inventing a run with no vehicle and no seat limit.
      continue when v_vehicle.id is null;

      insert into public.pickup_groups (
        service_date, name, area_label, latitude, longitude,
        vehicle_id, driver_employee_id, auto_created, created_by, sort_order
      )
      values (
        p_service_date,
        v_vehicle.code || ' · ' || rec.spot,
        rec.area,
        rec.lat,
        rec.lng,
        v_vehicle.id,
        v_vehicle.default_driver_employee_id,
        true,
        auth.uid(),
        coalesce((select max(sort_order) + 1 from public.pickup_groups where service_date = p_service_date), 1)
      )
      returning id into v_run_id;
    end if;

    update public.bookings set pickup_group_id = v_run_id where id = rec.id;
    v_placed := v_placed + 1;
  end loop;

  delete from public.pickup_groups g
  where g.service_date = p_service_date
    and g.auto_created
    and not exists (select 1 from public.bookings b where b.pickup_group_id = g.id);

  for rec in select id from public.pickup_groups where service_date = p_service_date loop
    perform public.order_pickup_run(rec.id);
  end loop;

  return v_placed;
end;
$$;

revoke all on function public.auto_plan_pickups(date, numeric) from anon;
grant execute on function public.auto_plan_pickups(date, numeric) to authenticated;
