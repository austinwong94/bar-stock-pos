-- =====================================================================
-- Special-needs guests counted alongside adults, children and elderly, so
-- the pax figure alone tells a PIC how to arrange the day, and pickup
-- becomes an explicit choice on the booking rather than a guess.
-- =====================================================================

alter table public.tourists add column if not exists needs_assistance boolean not null default false;
alter table public.tourists add column if not exists assistance_note text;
alter table public.bookings add column if not exists pax_assisted int not null default 0;

create or replace function public.recount_booking_pax(p_booking_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  update public.bookings b
  set pax_adults = counts.adults,
      pax_children = counts.children,
      pax_elderly = counts.elderly,
      pax_assisted = counts.assisted,
      pax_total = counts.total
  from (
    select
      count(*) filter (where age_band = 'adult')::int as adults,
      count(*) filter (where age_band in ('child', 'infant'))::int as children,
      count(*) filter (where age_band = 'elderly')::int as elderly,
      count(*) filter (where needs_assistance)::int as assisted,
      count(*)::int as total
    from public.tourists
    where booking_id = p_booking_id
  ) as counts
  where b.id = p_booking_id;
end;
$$;

-- save_booking now carries the pickup choice and the assistance flag.
-- Pickup defaults to whether a hotel was given, which is what the person
-- entering the booking means in practice, but stays overridable.
create or replace function public.save_booking(
  p_booking jsonb,
  p_tourists jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_booking_id uuid := nullif(p_booking->>'id', '')::uuid;
  v_date date := (p_booking->>'service_date')::date;
  v_lead text := nullif(trim(p_booking->>'lead_name'), '');
  v_agency uuid;
  v_source text;
  v_edit_all boolean := public.has_permission('guests.booking.edit_all');
  v_see_private boolean := public.has_permission('guests.contact.view');
  v_keep uuid[] := array[]::uuid[];
  v_hotel text := nullif(trim(p_booking->>'pickup_hotel_name'), '');
  v_pickup boolean;
  rec record;
  v_person_id uuid;
  v_is_new boolean := v_booking_id is null;
begin
  if v_is_new then
    perform public.require_permission('guests.booking.create');
  elsif not public.can_edit_booking(v_booking_id) then
    raise exception 'You cannot edit this booking.' using errcode = '42501';
  end if;

  if v_date is null then raise exception 'An arrival date is required.'; end if;
  if v_lead is null then raise exception 'A lead guest name is required.'; end if;

  if p_booking ? 'pickup_required' and nullif(p_booking->>'pickup_required', '') is not null then
    v_pickup := (p_booking->>'pickup_required')::boolean;
  else
    v_pickup := v_hotel is not null;
  end if;

  if v_edit_all then
    v_agency := nullif(p_booking->>'agency_id', '')::uuid;
    v_source := coalesce(nullif(p_booking->>'source_type', ''), 'in_house');
  else
    v_agency := public.my_agency_id();
    select coalesce(a.source_type, 'in_house') into v_source
    from public.agencies a where a.id = v_agency;
    v_source := coalesce(v_source, 'in_house');
  end if;

  if v_is_new then
    insert into public.bookings (
      booking_ref, service_date, source_type, agency_id, external_ref,
      lead_name, lead_phone, lead_email, nationality,
      pickup_location_id, pickup_hotel_name, pickup_area,
      pickup_latitude, pickup_longitude, pickup_time, pickup_required,
      status, special_requests, notes, created_by
    )
    values (
      public.next_booking_ref(v_date), v_date, v_source, v_agency,
      nullif(p_booking->>'external_ref', ''),
      v_lead,
      nullif(p_booking->>'lead_phone', ''),
      nullif(p_booking->>'lead_email', ''),
      nullif(p_booking->>'nationality', ''),
      nullif(p_booking->>'pickup_location_id', '')::uuid,
      v_hotel,
      nullif(p_booking->>'pickup_area', ''),
      nullif(p_booking->>'pickup_latitude', '')::numeric,
      nullif(p_booking->>'pickup_longitude', '')::numeric,
      nullif(p_booking->>'pickup_time', '')::time,
      v_pickup,
      coalesce(nullif(p_booking->>'status', ''), 'confirmed'),
      nullif(p_booking->>'special_requests', ''),
      nullif(p_booking->>'notes', ''),
      auth.uid()
    )
    returning id into v_booking_id;
  else
    update public.bookings b set
      service_date = v_date,
      source_type = case when v_edit_all then v_source else b.source_type end,
      agency_id = case when v_edit_all then v_agency else b.agency_id end,
      external_ref = nullif(p_booking->>'external_ref', ''),
      lead_name = v_lead,
      lead_phone = nullif(p_booking->>'lead_phone', ''),
      lead_email = nullif(p_booking->>'lead_email', ''),
      nationality = nullif(p_booking->>'nationality', ''),
      pickup_location_id = nullif(p_booking->>'pickup_location_id', '')::uuid,
      pickup_hotel_name = v_hotel,
      pickup_area = nullif(p_booking->>'pickup_area', ''),
      pickup_latitude = nullif(p_booking->>'pickup_latitude', '')::numeric,
      pickup_longitude = nullif(p_booking->>'pickup_longitude', '')::numeric,
      pickup_time = nullif(p_booking->>'pickup_time', '')::time,
      pickup_required = v_pickup,
      pickup_group_id = case when v_pickup then b.pickup_group_id else null end,
      status = coalesce(nullif(p_booking->>'status', ''), b.status),
      special_requests = nullif(p_booking->>'special_requests', ''),
      notes = nullif(p_booking->>'notes', '')
    where b.id = v_booking_id;
  end if;

  for rec in
    select value as person, ordinality as ord
    from jsonb_array_elements(coalesce(p_tourists, '[]'::jsonb)) with ordinality
  loop
    if coalesce(nullif(trim(rec.person->>'full_name'), ''), '') = '' then continue; end if;
    v_person_id := nullif(rec.person->>'id', '')::uuid;

    if v_person_id is null then
      insert into public.tourists (
        booking_id, full_name, phone, nationality, age_band, gender, is_lead,
        seat_note, sort_order, needs_assistance, assistance_note
      )
      values (
        v_booking_id,
        trim(rec.person->>'full_name'),
        nullif(rec.person->>'phone', ''),
        nullif(rec.person->>'nationality', ''),
        coalesce(nullif(rec.person->>'age_band', ''), 'adult'),
        nullif(rec.person->>'gender', ''),
        coalesce((rec.person->>'is_lead')::boolean, rec.ord = 1),
        nullif(rec.person->>'seat_note', ''),
        rec.ord::int,
        coalesce((rec.person->>'needs_assistance')::boolean, false),
        nullif(rec.person->>'assistance_note', '')
      )
      returning id into v_person_id;
    else
      update public.tourists t set
        full_name = trim(rec.person->>'full_name'),
        phone = nullif(rec.person->>'phone', ''),
        nationality = nullif(rec.person->>'nationality', ''),
        age_band = coalesce(nullif(rec.person->>'age_band', ''), 'adult'),
        gender = nullif(rec.person->>'gender', ''),
        is_lead = coalesce((rec.person->>'is_lead')::boolean, t.is_lead),
        seat_note = nullif(rec.person->>'seat_note', ''),
        sort_order = rec.ord::int,
        needs_assistance = coalesce((rec.person->>'needs_assistance')::boolean, t.needs_assistance),
        assistance_note = nullif(rec.person->>'assistance_note', '')
      where t.id = v_person_id and t.booking_id = v_booking_id;
    end if;

    v_keep := v_keep || v_person_id;

    if v_see_private and rec.person ? 'private' then
      insert into public.tourist_private (
        tourist_id, passport_no, date_of_birth, email, medical_notes, dietary_notes
      )
      values (
        v_person_id,
        nullif(rec.person->'private'->>'passport_no', ''),
        nullif(rec.person->'private'->>'date_of_birth', '')::date,
        nullif(rec.person->'private'->>'email', ''),
        nullif(rec.person->'private'->>'medical_notes', ''),
        nullif(rec.person->'private'->>'dietary_notes', '')
      )
      on conflict (tourist_id) do update set
        passport_no = excluded.passport_no,
        date_of_birth = excluded.date_of_birth,
        email = excluded.email,
        medical_notes = excluded.medical_notes,
        dietary_notes = excluded.dietary_notes,
        updated_at = now();
    end if;
  end loop;

  if array_length(v_keep, 1) is null then
    raise exception 'A booking needs at least one guest name.';
  end if;

  delete from public.tourists t
  where t.booking_id = v_booking_id and not (t.id = any(v_keep));

  perform public.recount_booking_pax(v_booking_id);
  return v_booking_id;
end;
$$;

do $$
declare v_id uuid;
begin
  for v_id in select id from public.bookings loop
    perform public.recount_booking_pax(v_id);
  end loop;
end $$;

-- The manifest a captain reads should flag who needs a hand. The column
-- order changes, so the view is replaced rather than altered.
drop view if exists public.trip_manifest;
create view public.trip_manifest with (security_invoker = true) as
select
  tp.id as passenger_id,
  tp.assignment_id,
  tp.booking_id,
  tp.tourist_id,
  tp.boarding_status,
  tp.boarded_at,
  tp.activity_code,
  tp.activity_status,
  tp.returned,
  tp.note,
  t.full_name,
  coalesce(t.phone, b.lead_phone) as phone,
  t.age_band,
  t.is_lead,
  t.nationality,
  t.needs_assistance,
  t.assistance_note,
  b.booking_ref,
  b.lead_name,
  b.pax_total as group_size,
  b.service_date,
  a.boat_id,
  bo.code as boat_code,
  bo.name as boat_name
from public.trip_passengers tp
join public.tourists t on t.id = tp.tourist_id
join public.bookings b on b.id = tp.booking_id
join public.boat_assignments a on a.id = tp.assignment_id
join public.boats bo on bo.id = a.boat_id;

grant select on public.trip_manifest to authenticated;

-- The summary gains the assistance count, so the figure a PIC reads on the
-- home screen already says how many guests need a hand.
create or replace function public.operations_summary(p_service_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb := '{}'::jsonb;
begin
  perform public.require_permission('ops.log.view');

  -- Guests and boats
  v := v || jsonb_build_object('guests', (
    select jsonb_build_object(
      'bookings', count(distinct b.id),
      'pax', coalesce(sum(b.pax_total), 0),
      'adults', coalesce(sum(b.pax_adults), 0),
      'children', coalesce(sum(b.pax_children), 0),
      'elderly', coalesce(sum(b.pax_elderly), 0),
      'assisted', coalesce(sum(b.pax_assisted), 0),
      'by_source', coalesce((
        select jsonb_object_agg(source_type, pax)
        from (
          select source_type, sum(pax_total) as pax
          from public.bookings
          where service_date = p_service_date and status <> 'cancelled'
          group by source_type
        ) s
      ), '{}'::jsonb)
    )
    from public.bookings b
    where b.service_date = p_service_date and b.status <> 'cancelled'
  ));

  v := v || jsonb_build_object('boats', coalesce((
    select jsonb_agg(row order by row->>'code')
    from (
      select jsonb_build_object(
        'code', bo.code,
        'name', bo.name,
        'capacity', bo.capacity_pax,
        'captain', cap.full_name,
        'guide', gd.full_name,
        'departure', to_char(a.departure_time, 'HH24:MI'),
        'assigned', (select count(*) from public.trip_passengers tp where tp.assignment_id = a.id),
        'boarded', (select count(*) from public.trip_passengers tp
                    where tp.assignment_id = a.id and tp.boarding_status = 'arrived'),
        'no_show', (select count(*) from public.trip_passengers tp
                    where tp.assignment_id = a.id and tp.boarding_status = 'no_show'),
        'returned', (select count(*) from public.trip_passengers tp
                     where tp.assignment_id = a.id and tp.returned)
      ) as row
      from public.boat_assignments a
      join public.boats bo on bo.id = a.boat_id
      left join public.employees cap on cap.id = a.captain_employee_id
      left join public.employees gd on gd.id = a.guide_employee_id
      where a.service_date = p_service_date
        and a.status <> 'cancelled'
        and exists (select 1 from public.trip_passengers tp where tp.assignment_id = a.id)
    ) boats
  ), '[]'::jsonb));

  -- Activities
  v := v || jsonb_build_object('activities', coalesce((
    select jsonb_agg(jsonb_build_object(
      'code', at.code, 'name', at.name,
      'chosen', counts.chosen, 'joined', counts.joined, 'back', counts.back))
    from public.activity_types at
    join lateral (
      select
        count(*) filter (where tp.activity_code = at.code)::int as chosen,
        count(*) filter (where tp.activity_code = at.code and tp.activity_status = 'joined')::int as joined,
        count(*) filter (where tp.activity_code = at.code and tp.returned)::int as back
      from public.trip_passengers tp
      join public.boat_assignments a on a.id = tp.assignment_id
      where a.service_date = p_service_date
    ) counts on true
    where at.active
  ), '[]'::jsonb));

  v := v || jsonb_build_object('headcount', (
    select jsonb_build_object(
      'assigned', count(*),
      'boarded', count(*) filter (where tp.boarding_status = 'arrived'),
      'no_show', count(*) filter (where tp.boarding_status = 'no_show'),
      'not_checked', count(*) filter (where tp.boarding_status = 'pending'),
      'activity_chosen', count(*) filter (where tp.activity_code is not null),
      'back_on_boat', count(*) filter (where tp.returned)
    )
    from public.trip_passengers tp
    join public.boat_assignments a on a.id = tp.assignment_id
    where a.service_date = p_service_date
  ));

  -- Boat trips and fuel
  v := v || jsonb_build_object('trips', coalesce((
    select jsonb_agg(jsonb_build_object(
      'boat', bo.code, 'type', t.trip_type, 'pax', t.pax_count,
      'departure', to_char(t.departure_time, 'HH24:MI'), 'purpose', t.purpose))
    from public.boat_trips t join public.boats bo on bo.id = t.boat_id
    where t.service_date = p_service_date
  ), '[]'::jsonb));

  if public.has_permission('maintenance.view') then
    v := v || jsonb_build_object('fuel', (
      select jsonb_build_object(
        'litres_bought', coalesce(sum(litres), 0),
        'cost', case when public.has_permission('maintenance.cost.view')
                     then coalesce(sum(total_cost), 0) else null end)
      from public.fuel_purchases where purchase_date = p_service_date
    ));
  end if;

  -- Kitchen and purchasing
  if public.has_permission('kitchen.request.view') or public.has_permission('purchasing.view') then
    v := v || jsonb_build_object('supplies', (
      select jsonb_build_object(
        'requests', count(distinct r.id),
        'items', (select count(*) from public.purchase_request_items i
                  join public.purchase_requests rr on rr.id = i.request_id
                  where rr.needed_for_date = p_service_date),
        'items_bought', (select count(*) from public.purchase_request_items i
                         join public.purchase_requests rr on rr.id = i.request_id
                         where rr.needed_for_date = p_service_date and i.purchase_status = 'bought'),
        'pax_catered', coalesce(max(r.pax_count), 0),
        'spend', case when public.has_permission('purchasing.cost.view') then (
                   select coalesce(sum(i.actual_cost), 0) from public.purchase_request_items i
                   join public.purchase_requests rr on rr.id = i.request_id
                   where rr.needed_for_date = p_service_date) else null end)
      from public.purchase_requests r
      where r.needed_for_date = p_service_date and r.status <> 'cancelled'
    ));
  end if;

  -- Missing items reported today
  if public.has_permission('items.view') then
    v := v || jsonb_build_object('missing_items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'item', item_name, 'quantity', quantity, 'status', status, 'remarks', remarks))
      from public.missing_items where missing_on = p_service_date
    ), '[]'::jsonb));
  end if;

  -- Bar takings
  if public.has_permission('bar.reports.view') then
    v := v || jsonb_build_object('bar', (
      select jsonb_build_object(
        'sales', count(*),
        'total', coalesce(sum(paid_amount), 0),
        'cash', coalesce(sum(paid_amount) filter (where payment_method = 'cash'), 0),
        'qr', coalesce(sum(paid_amount) filter (where payment_method = 'qr'), 0),
        'complimentary', coalesce(sum(total_amount) filter (where payment_method = 'complimentary'), 0))
      from public.sales
      where business_date = p_service_date and status = 'completed'
    ));
  end if;

  -- Anything that went wrong
  v := v || jsonb_build_object('incidents', coalesce((
    select jsonb_agg(jsonb_build_object(
      'event', event_code, 'subject', subject, 'detail', detail,
      'at', to_char(occurred_at at time zone 'Asia/Kuala_Lumpur', 'HH24:MI')))
    from public.operations_events
    where service_date = p_service_date and severity in ('warning', 'alert')
  ), '[]'::jsonb));

  return v;
end;
$$;
