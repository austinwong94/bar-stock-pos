-- =====================================================================
-- Seating ninety guests by dragging twenty five groups one at a time is
-- the longest job of the morning, and it is the same job every morning.
-- The pickup page already has one button that does the whole plan; the
-- boat board gets the same.
--
-- Two rules the coordinator would use by hand:
--   * a group never gets split across boats — they travel together;
--   * fill the boat that has the least room left but still fits, so the
--     big boat stays free for the big family instead of being spent on
--     a couple.
-- Anything that will not fit stays in the unassigned pool, visible.
-- =====================================================================
create or replace function public.auto_seat_boats(p_service_date date)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  rec record;
  v_assignment_id uuid;
  v_seated int := 0;
begin
  perform public.require_permission('fleet.assign');

  if exists (
    select 1 from public.boat_assignments
    where service_date = p_service_date and locked
  ) then
    raise exception 'This day is locked. Unlock it before seating boats.';
  end if;

  -- Make sure today's boats exist before trying to fill them.
  perform public.ensure_boat_assignments(p_service_date);

  for rec in
    select b.id, b.pax_total
    from public.bookings b
    where b.service_date = p_service_date
      and b.status in ('draft', 'confirmed', 'arrived')
      and b.pax_total > 0
      and not exists (select 1 from public.trip_bookings tb where tb.booking_id = b.id)
    -- Biggest group first: the hardest to place goes while there is still
    -- room to place it.
    order by b.pax_total desc, b.created_at
  loop
    -- Best fit: the fullest boat this group still fits on.
    select a.id into v_assignment_id
    from public.boat_assignments a
    join public.boats bo on bo.id = a.boat_id
    where a.service_date = p_service_date
      and not a.locked
      and coalesce(a.status, 'planned') <> 'cancelled'
      and bo.status = 'active'
      and bo.capacity_pax > 0
      and bo.capacity_pax - coalesce((
            select sum(bk.pax_total)
            from public.trip_bookings tb
            join public.bookings bk on bk.id = tb.booking_id
            where tb.assignment_id = a.id
          ), 0) >= rec.pax_total
    order by bo.capacity_pax - coalesce((
            select sum(bk.pax_total)
            from public.trip_bookings tb
            join public.bookings bk on bk.id = tb.booking_id
            where tb.assignment_id = a.id
          ), 0), bo.sort_order, bo.code
    limit 1;

    -- No boat has room for the whole group: leave it in the pool rather
    -- than splitting a family or overloading a boat.
    continue when v_assignment_id is null;

    insert into public.trip_bookings (assignment_id, booking_id, assigned_by)
    values (v_assignment_id, rec.id, auth.uid());
    v_seated := v_seated + 1;
  end loop;

  -- Seating a boat is a milestone the operations log watches.
  for rec in
    select a.id from public.boat_assignments a
    where a.service_date = p_service_date
      and exists (select 1 from public.trip_bookings tb where tb.assignment_id = a.id)
  loop
    perform public.refresh_assignment_milestones(rec.id);
  end loop;

  return v_seated;
end;
$$;

revoke all on function public.auto_seat_boats(date) from anon;
grant execute on function public.auto_seat_boats(date) to authenticated;

-- ---------------------------------------------------------------------
-- The same crew works the same boat most days, so offer yesterday's.
-- ---------------------------------------------------------------------
create or replace function public.copy_previous_crew(p_service_date date)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_source date;
  v_filled int := 0;
begin
  perform public.require_permission('fleet.assign');

  -- The most recent earlier day that actually had crew on it, so a quiet
  -- Sunday does not wipe the pattern.
  select max(a.service_date) into v_source
  from public.boat_assignments a
  where a.service_date < p_service_date
    and (a.captain_employee_id is not null or a.guide_employee_id is not null);

  if v_source is null then
    return 0;
  end if;

  perform public.ensure_boat_assignments(p_service_date);

  -- Only fills blanks: a crew already chosen for today is never overwritten.
  with filled as (
    update public.boat_assignments today
    set captain_employee_id = coalesce(today.captain_employee_id, prev.captain_employee_id),
        guide_employee_id = coalesce(today.guide_employee_id, prev.guide_employee_id)
    from public.boat_assignments prev
    where prev.service_date = v_source
      and prev.boat_id = today.boat_id
      and prev.trip_no = today.trip_no
      and today.service_date = p_service_date
      and not today.locked
      and (today.captain_employee_id is null or today.guide_employee_id is null)
      and (prev.captain_employee_id is not null or prev.guide_employee_id is not null)
    returning today.id
  )
  select count(*) into v_filled from filled;

  return v_filled;
end;
$$;

revoke all on function public.copy_previous_crew(date) from anon;
grant execute on function public.copy_previous_crew(date) to authenticated;
