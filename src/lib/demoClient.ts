/**
 * A thenable query builder shaped like supabase-js, backed by demoBackend.
 * Only the surface this app actually uses is implemented.
 */
import {
  canSeeAssignment,
  canViewBooking,
  clearDemoSession,
  db,
  demoSession,
  demoSignIn,
  isMaster,
  manifestRows,
  myAgencyId,
  registerAuthListener,
  require as requirePermission,
  userHasPermission,
  visibleRows,
  persistDemoDb,
  can,
  currentUserIdRef,
} from './demoBackend';
import { TODAY } from './demoSeed';

type Row = Record<string, any>;
type Filter = { op: string; column: string; value: any };

const uid = () => `d-${Math.random().toString(36).slice(2, 10)}`;

function applyFilters(rows: Row[], filters: Filter[]) {
  return rows.filter((row) =>
    filters.every((filter) => {
      const value = row[filter.column];
      switch (filter.op) {
        case 'eq': return String(value) === String(filter.value);
        case 'neq': return String(value) !== String(filter.value);
        case 'gt': return value > filter.value;
        case 'gte': return value >= filter.value;
        case 'lt': return value < filter.value;
        case 'lte': return value <= filter.value;
        case 'in': return (filter.value as any[]).map(String).includes(String(value));
        default: return true;
      }
    }),
  );
}

// Resolves PostgREST-style embeds such as "agencies(id,name)" or "tourists(*)".
const embeds: Record<string, (row: Row, spec: string) => any> = {
  agencies: (row) => db.agencies.find((item) => item.id === row.agency_id) ?? null,
  boats: (row) => db.boats.find((item) => item.id === row.boat_id) ?? null,
  products: (row) => null,
  tourists: (row, spec) => {
    const list = db.tourists
      .filter((item) => item.booking_id === row.id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((item) => ({ ...item }));
    if (spec.includes('tourist_private')) {
      list.forEach((item) => {
        item.tourist_private = db.tourist_private.find((priv) => priv.tourist_id === item.id) ?? null;
      });
    }
    return list;
  },
};

function applyEmbeds(rows: Row[], select: string) {
  const matches = [...select.matchAll(/(\w+)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)];
  if (matches.length === 0) return rows;
  return rows.map((row) => {
    const copy = { ...row };
    matches.forEach((match) => {
      const table = match[1];
      const resolver = embeds[table];
      if (resolver) copy[table] = resolver(row, match[0]);
    });
    return copy;
  });
}

class DemoQuery implements PromiseLike<{ data: any; error: any }> {
  private filters: Filter[] = [];
  private selectSpec = '*';
  private orders: Array<{ column: string; ascending: boolean }> = [];
  private limitCount: number | null = null;
  private single = false;
  private writeOp: null | (() => any) = null;

  constructor(private table: string) {}

  select(spec = '*') { this.selectSpec = spec; return this; }
  eq(column: string, value: any) { this.filters.push({ op: 'eq', column, value }); return this; }
  neq(column: string, value: any) { this.filters.push({ op: 'neq', column, value }); return this; }
  gt(column: string, value: any) { this.filters.push({ op: 'gt', column, value }); return this; }
  gte(column: string, value: any) { this.filters.push({ op: 'gte', column, value }); return this; }
  lt(column: string, value: any) { this.filters.push({ op: 'lt', column, value }); return this; }
  lte(column: string, value: any) { this.filters.push({ op: 'lte', column, value }); return this; }
  in(column: string, value: any[]) { this.filters.push({ op: 'in', column, value }); return this; }
  order(column: string, options?: { ascending?: boolean }) {
    this.orders.push({ column, ascending: options?.ascending !== false });
    return this;
  }
  limit(count: number) { this.limitCount = count; return this; }
  maybeSingle() { this.single = true; return this; }
  single_() { this.single = true; return this; }

  insert(payload: Row | Row[]) {
    this.writeOp = () => {
      const list = Array.isArray(payload) ? payload : [payload];
      const inserted = list.map((item) => {
        const row = { id: item.id ?? uid(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...item };
        db[this.table] = db[this.table] ?? [];
        db[this.table].push(row);
        afterWrite(this.table, row, 'insert');
        return row;
      });
      return inserted;
    };
    return this;
  }

  update(payload: Row) {
    this.writeOp = () => {
      const targets = applyFilters(db[this.table] ?? [], this.filters);
      targets.forEach((row) => {
        Object.assign(row, payload, { updated_at: new Date().toISOString() });
        afterWrite(this.table, row, 'update');
      });
      return targets;
    };
    return this;
  }

  upsert(payload: Row | Row[], options?: { onConflict?: string }) {
    this.writeOp = () => {
      const key = options?.onConflict ?? 'id';
      const list = Array.isArray(payload) ? payload : [payload];
      db[this.table] = db[this.table] ?? [];
      return list.map((item) => {
        const existing = db[this.table].find((row) => String(row[key]) === String(item[key]));
        if (existing) {
          Object.assign(existing, item, { updated_at: new Date().toISOString() });
          afterWrite(this.table, existing, 'update');
          return existing;
        }
        const row = { id: item.id ?? uid(), created_at: new Date().toISOString(), ...item };
        db[this.table].push(row);
        afterWrite(this.table, row, 'insert');
        return row;
      });
    };
    return this;
  }

  delete() {
    this.writeOp = () => {
      const targets = applyFilters(db[this.table] ?? [], this.filters);
      db[this.table] = (db[this.table] ?? []).filter((row) => !targets.includes(row));
      targets.forEach((row) => afterWrite(this.table, row, 'delete'));
      return targets;
    };
    return this;
  }

  private run() {
    try {
      if (this.writeOp) {
        const data = this.writeOp();
        persistDemoDb();
        return { data, error: null };
      }
      let rows = this.table === 'trip_manifest' ? manifestRows() : visibleRows(this.table);
      rows = applyFilters(rows, this.filters);
      [...this.orders].reverse().forEach((order) => {
        rows = [...rows].sort((a, b) => {
          const left = a[order.column];
          const right = b[order.column];
          if (left === right) return 0;
          if (left === null || left === undefined) return 1;
          if (right === null || right === undefined) return -1;
          return (left > right ? 1 : -1) * (order.ascending ? 1 : -1);
        });
      });
      if (this.limitCount !== null) rows = rows.slice(0, this.limitCount);
      rows = applyEmbeds(rows, this.selectSpec);
      return { data: this.single ? rows[0] ?? null : rows, error: null };
    } catch (error) {
      return { data: null, error: { message: (error as Error).message } };
    }
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

// Triggers, replayed.
function afterWrite(table: string, row: Row, op: 'insert' | 'update' | 'delete') {
  if (table === 'boat_fuel_logs' && op !== 'delete') {
    if (!row.total_cost) row.total_cost = Number(((row.litres ?? 0) * (row.price_per_litre ?? 0)).toFixed(2));
  }
  if (table === 'boat_repairs' && op !== 'delete') {
    if (!row.previous_repair_id) {
      const prior = db.boat_repairs
        .filter((item) => item.boat_id === row.boat_id && item.id !== row.id && item.issue_category === row.issue_category && item.status !== 'cancelled')
        .sort((a, b) => (a.reported_date < b.reported_date ? 1 : -1))[0];
      if (prior) {
        row.previous_repair_id = prior.id;
        row.is_recurring = true;
      }
    } else {
      row.is_recurring = true;
    }
    if (row.status === 'fixed' && !row.fixed_date) row.fixed_date = TODAY;
    if (row.status !== 'fixed') row.fixed_date = null;
  }
  if (table === 'boat_repairs') {
    const boatId = row.boat_id;
    const blocked = db.boat_repairs.some(
      (item) => item.boat_id === boatId && item.out_of_service && ['reported', 'in_progress'].includes(item.status),
    );
    const boat = db.boats.find((item) => item.id === boatId);
    if (boat && (blocked || boat.status === 'maintenance')) {
      boat.status = blocked ? 'maintenance' : 'active';
      boat.status_note = blocked ? 'Under repair' : null;
    }
  }
}

function recountPax(bookingId: string) {
  const booking = db.bookings.find((row) => row.id === bookingId);
  if (!booking) return;
  const people = db.tourists.filter((row) => row.booking_id === bookingId);
  booking.pax_total = people.length;
  booking.pax_adults = people.filter((row) => row.age_band === 'adult').length;
  booking.pax_children = people.length - booking.pax_adults;
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const a =
    Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function syncPassengers(assignmentId: string, bookingId: string) {
  db.tourists
    .filter((tourist) => tourist.booking_id === bookingId)
    .forEach((tourist) => {
      const exists = db.trip_passengers.some(
        (row) => row.assignment_id === assignmentId && row.tourist_id === tourist.id,
      );
      if (exists) return;
      db.trip_passengers.push({
        id: uid(),
        assignment_id: assignmentId,
        booking_id: bookingId,
        tourist_id: tourist.id,
        boarding_status: 'pending',
        boarded_at: null,
        boarded_by: null,
        activity_code: null,
        activity_status: 'pending',
        activity_marked_at: null,
        activity_marked_by: null,
        returned: false,
        returned_at: null,
        note: null,
      });
    });
}

const rpcHandlers: Record<string, (args: any) => any> = {
  my_permissions: () => db.permissions.filter((row) => can(row.code)).map((row) => row.code),

  boat_fuel_summary: ({ p_from, p_to }: any) => {
    requirePermission('maintenance.view');
    return db.boats.map((boat) => {
      const logs = db.boat_fuel_logs.filter(
        (row) => row.boat_id === boat.id && row.log_date >= p_from && row.log_date <= p_to,
      );
      const trips = logs.filter((row) => row.entry_type === 'trip_usage');
      const litresUsed = trips.reduce((sum, row) => sum + Number(row.litres), 0);
      const avg = trips.length ? litresUsed / trips.length : 0;
      const baseline = boat.expected_litres_per_trip;
      return {
        boat_id: boat.id,
        boat_code: boat.code,
        trips: trips.length,
        litres_used: litresUsed,
        litres_loaded: logs.filter((row) => row.entry_type === 'refuel').reduce((sum, row) => sum + Number(row.litres), 0),
        cost_used: trips.reduce((sum, row) => sum + Number(row.total_cost), 0),
        cost_loaded: logs.filter((row) => row.entry_type === 'refuel').reduce((sum, row) => sum + Number(row.total_cost), 0),
        avg_litres_per_trip: Number(avg.toFixed(2)),
        expected_litres_per_trip: baseline,
        variance_pct: trips.length && baseline ? Number((((avg - baseline) / baseline) * 100).toFixed(1)) : null,
      };
    });
  },

  save_booking: ({ p_booking, p_tourists }: any) => {
    const isNew = !p_booking.id;
    if (isNew) requirePermission('guests.booking.create');
    const editAll = can('guests.booking.edit_all');
    const seePrivate = can('guests.contact.view');

    let booking = isNew ? null : db.bookings.find((row) => row.id === p_booking.id);
    if (!isNew && !booking) throw new Error('Booking not found.');
    if (!isNew) {
      const mine =
        booking!.created_by === currentUserIdRef.value ||
        (booking!.agency_id && booking!.agency_id === myAgencyId());
      if (!editAll && !(can('guests.booking.edit_own') && mine)) {
        throw new Error('You cannot edit this booking.');
      }
    }

    const agency = editAll ? p_booking.agency_id || null : myAgencyId();
    const source = editAll
      ? p_booking.source_type || 'in_house'
      : db.agencies.find((row) => row.id === agency)?.source_type ?? 'in_house';

    const fields = {
      service_date: p_booking.service_date,
      lead_name: p_booking.lead_name,
      lead_phone: p_booking.lead_phone || null,
      lead_email: p_booking.lead_email || null,
      external_ref: p_booking.external_ref || null,
      pickup_location_id: p_booking.pickup_location_id || null,
      pickup_hotel_name: p_booking.pickup_hotel_name || null,
      pickup_area: p_booking.pickup_area || null,
      pickup_latitude: p_booking.pickup_latitude === '' ? null : Number(p_booking.pickup_latitude) || null,
      pickup_longitude: p_booking.pickup_longitude === '' ? null : Number(p_booking.pickup_longitude) || null,
      pickup_time: p_booking.pickup_time || null,
      status: p_booking.status || 'confirmed',
      special_requests: p_booking.special_requests || null,
    };

    if (isNew) {
      const sameDay = db.bookings.filter((row) => row.service_date === p_booking.service_date).length + 1;
      booking = {
        id: uid(),
        booking_ref: `LP-${String(p_booking.service_date).replace(/-/g, '').slice(2)}-${String(sameDay).padStart(3, '0')}`,
        source_type: source,
        agency_id: agency,
        pax_total: 0,
        pax_adults: 0,
        pax_children: 0,
        pickup_group_id: null,
        notes: null,
        created_by: currentUserIdRef.value,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...fields,
      };
      db.bookings.push(booking!);
    } else {
      Object.assign(booking!, fields, {
        source_type: editAll ? source : booking!.source_type,
        agency_id: editAll ? agency : booking!.agency_id,
        updated_at: new Date().toISOString(),
      });
    }

    const keep: string[] = [];
    (p_tourists ?? []).forEach((person: Row, index: number) => {
      if (!person.full_name?.trim()) return;
      let tourist = person.id ? db.tourists.find((row) => row.id === person.id) : null;
      if (!tourist) {
        tourist = { id: uid(), booking_id: booking!.id };
        db.tourists.push(tourist);
      }
      Object.assign(tourist, {
        full_name: person.full_name.trim(),
        phone: person.phone || null,
        nationality: person.nationality || null,
        age_band: person.age_band || 'adult',
        is_lead: index === 0,
        seat_note: null,
        sort_order: index + 1,
      });
      keep.push(tourist.id);
      if (seePrivate && person.private) {
        const existing = db.tourist_private.find((row) => row.tourist_id === tourist!.id);
        if (existing) Object.assign(existing, person.private);
        else db.tourist_private.push({ tourist_id: tourist!.id, ...person.private });
      }
    });

    if (keep.length === 0) throw new Error('A booking needs at least one guest name.');
    db.tourists = db.tourists.filter((row) => row.booking_id !== booking!.id || keep.includes(row.id));
    recountPax(booking!.id);

    db.trip_bookings
      .filter((row) => row.booking_id === booking!.id)
      .forEach((row) => syncPassengers(row.assignment_id, booking!.id));

    return booking!.id;
  },

  delete_booking: ({ p_booking_id }: any) => {
    requirePermission('guests.booking.delete');
    if (!canViewBooking(p_booking_id)) throw new Error('Booking not found.');
    db.bookings = db.bookings.filter((row) => row.id !== p_booking_id);
    db.tourists = db.tourists.filter((row) => row.booking_id !== p_booking_id);
    db.trip_bookings = db.trip_bookings.filter((row) => row.booking_id !== p_booking_id);
    db.trip_passengers = db.trip_passengers.filter((row) => row.booking_id !== p_booking_id);
    return null;
  },

  ensure_boat_assignments: ({ p_service_date }: any) => {
    requirePermission('fleet.view');
    db.boats
      .filter((boat) => boat.status === 'active')
      .forEach((boat) => {
        const exists = db.boat_assignments.some(
          (row) => row.service_date === p_service_date && row.boat_id === boat.id && row.trip_no === 1,
        );
        if (exists) return;
        db.boat_assignments.push({
          id: uid(),
          service_date: p_service_date,
          boat_id: boat.id,
          trip_no: 1,
          departure_time: '09:00',
          return_time: null,
          captain_employee_id: null,
          guide_employee_id: null,
          status: 'planned',
          locked: false,
          notes: null,
          created_by: currentUserIdRef.value,
        });
      });
    return db.boat_assignments
      .filter((row) => row.service_date === p_service_date)
      .sort((a, b) => {
        const left = db.boats.find((boat) => boat.id === a.boat_id)?.sort_order ?? 0;
        const right = db.boats.find((boat) => boat.id === b.boat_id)?.sort_order ?? 0;
        return left - right;
      });
  },

  assign_booking_to_boat: ({ p_booking_id, p_assignment_id }: any) => {
    requirePermission('fleet.assign');
    const assignment = db.boat_assignments.find((row) => row.id === p_assignment_id);
    if (!assignment) throw new Error('That boat trip does not exist.');
    if (assignment.locked) throw new Error('This day is locked. Unlock it before changing boats.');
    const boat = db.boats.find((row) => row.id === assignment.boat_id)!;
    const booking = db.bookings.find((row) => row.id === p_booking_id);
    if (!booking) throw new Error('Booking not found.');
    const seated = db.trip_bookings
      .filter((row) => row.assignment_id === p_assignment_id && row.booking_id !== p_booking_id)
      .reduce((sum, row) => sum + (db.bookings.find((b) => b.id === row.booking_id)?.pax_total ?? 0), 0);
    if (boat.capacity_pax > 0 && seated + booking.pax_total > boat.capacity_pax) {
      throw new Error(
        `${boat.code} only has ${Math.max(boat.capacity_pax - seated, 0)} seat(s) left and this group is ${booking.pax_total} pax.`,
      );
    }
    db.trip_passengers = db.trip_passengers.filter((row) => row.booking_id !== p_booking_id);
    db.trip_bookings = db.trip_bookings.filter((row) => row.booking_id !== p_booking_id);
    db.trip_bookings.push({ id: uid(), assignment_id: p_assignment_id, booking_id: p_booking_id, assigned_at: new Date().toISOString() });
    syncPassengers(p_assignment_id, p_booking_id);
    return null;
  },

  unassign_booking: ({ p_booking_id }: any) => {
    requirePermission('fleet.assign');
    const trip = db.trip_bookings.find((row) => row.booking_id === p_booking_id);
    if (trip) {
      const assignment = db.boat_assignments.find((row) => row.id === trip.assignment_id);
      if (assignment?.locked) throw new Error('This day is locked. Unlock it before changing boats.');
    }
    db.trip_bookings = db.trip_bookings.filter((row) => row.booking_id !== p_booking_id);
    db.trip_passengers = db.trip_passengers.filter((row) => row.booking_id !== p_booking_id);
    return null;
  },

  set_trip_crew: (args: any) => {
    requirePermission('fleet.crew.assign');
    const assignment = db.boat_assignments.find((row) => row.id === args.p_assignment_id);
    if (!assignment) throw new Error('That boat trip does not exist.');
    if (args.p_clear_captain) assignment.captain_employee_id = null;
    else if (args.p_captain_employee_id) assignment.captain_employee_id = args.p_captain_employee_id;
    if (args.p_clear_guide) assignment.guide_employee_id = null;
    else if (args.p_guide_employee_id) assignment.guide_employee_id = args.p_guide_employee_id;
    if (args.p_departure_time) assignment.departure_time = args.p_departure_time;
    if (args.p_status) assignment.status = args.p_status;
    return assignment;
  },

  set_day_locked: ({ p_service_date, p_locked }: any) => {
    requirePermission('fleet.finalize');
    db.boat_assignments
      .filter((row) => row.service_date === p_service_date)
      .forEach((row) => { row.locked = p_locked; });
    return null;
  },

  save_pickup_group: (args: any) => {
    requirePermission('guests.pickup.manage');
    if (!args.p_name?.trim()) throw new Error('A pickup group name is required.');
    if (!args.p_id) {
      const group = {
        id: uid(),
        service_date: args.p_service_date,
        name: args.p_name.trim(),
        area_label: args.p_area_label ?? null,
        latitude: null,
        longitude: null,
        pickup_time: args.p_pickup_time || null,
        vehicle: args.p_vehicle ?? null,
        driver_employee_id: args.p_driver_employee_id ?? null,
        notes: args.p_notes ?? null,
        auto_created: false,
      };
      db.pickup_groups.push(group);
      return group;
    }
    const group = db.pickup_groups.find((row) => row.id === args.p_id);
    if (!group) throw new Error('Pickup group not found.');
    Object.assign(group, {
      name: args.p_name.trim(),
      area_label: args.p_area_label ?? group.area_label,
      pickup_time: args.p_pickup_time || null,
      vehicle: args.p_vehicle ?? group.vehicle,
      driver_employee_id: args.p_driver_employee_id ?? null,
    });
    return group;
  },

  set_pickup_group: ({ p_booking_id, p_group_id }: any) => {
    requirePermission('guests.pickup.manage');
    const booking = db.bookings.find((row) => row.id === p_booking_id);
    if (!booking) throw new Error('Booking not found.');
    booking.pickup_group_id = p_group_id;
    return null;
  },

  delete_pickup_group: ({ p_group_id }: any) => {
    requirePermission('guests.pickup.manage');
    db.bookings.filter((row) => row.pickup_group_id === p_group_id).forEach((row) => { row.pickup_group_id = null; });
    db.pickup_groups = db.pickup_groups.filter((row) => row.id !== p_group_id);
    return null;
  },

  auto_group_pickups: ({ p_service_date, p_radius_km }: any) => {
    requirePermission('guests.pickup.manage');
    const radius = Number(p_radius_km) || 1.5;
    let grouped = 0;
    db.bookings
      .filter((row) => row.service_date === p_service_date && !row.pickup_group_id && row.status !== 'cancelled')
      .sort((a, b) => String(a.pickup_hotel_name).localeCompare(String(b.pickup_hotel_name)))
      .forEach((booking) => {
        const spot = booking.pickup_hotel_name || booking.pickup_area || 'Unassigned pickup';
        let group = db.pickup_groups
          .filter((row) => row.service_date === p_service_date)
          .filter(
            (row) =>
              row.name.toLowerCase() === String(spot).toLowerCase() ||
              (booking.pickup_latitude !== null &&
                row.latitude !== null &&
                distanceKm(booking.pickup_latitude, booking.pickup_longitude, row.latitude, row.longitude) <= radius),
          )
          .sort((a, b) => (a.name.toLowerCase() === String(spot).toLowerCase() ? -1 : 1))[0];
        if (!group) {
          group = {
            id: uid(),
            service_date: p_service_date,
            name: spot,
            area_label: booking.pickup_area,
            latitude: booking.pickup_latitude,
            longitude: booking.pickup_longitude,
            pickup_time: booking.pickup_time,
            vehicle: null,
            driver_employee_id: null,
            notes: null,
            auto_created: true,
          };
          db.pickup_groups.push(group);
        }
        booking.pickup_group_id = group.id;
        grouped += 1;
      });
    db.pickup_groups = db.pickup_groups.filter(
      (row) => row.service_date !== p_service_date || !row.auto_created || db.bookings.some((b) => b.pickup_group_id === row.id),
    );
    return grouped;
  },

  mark_boarding: ({ p_passenger_ids, p_status }: any) => {
    requirePermission('boarding.mark');
    let count = 0;
    db.trip_passengers
      .filter((row) => p_passenger_ids.includes(row.id) && canSeeAssignment(row.assignment_id))
      .forEach((row) => {
        row.boarding_status = p_status;
        row.boarded_at = p_status === 'pending' ? null : new Date().toISOString();
        count += 1;
      });
    return count;
  },

  set_passenger_activity: ({ p_passenger_ids, p_activity_code }: any) => {
    requirePermission('activities.select');
    let count = 0;
    db.trip_passengers
      .filter((row) => p_passenger_ids.includes(row.id) && canSeeAssignment(row.assignment_id))
      .forEach((row) => {
        row.activity_code = p_activity_code;
        row.activity_status = 'pending';
        row.returned = false;
        count += 1;
      });
    return count;
  },

  mark_activity_attendance: ({ p_passenger_ids, p_status, p_returned }: any) => {
    requirePermission('activities.mark');
    let count = 0;
    db.trip_passengers
      .filter((row) => p_passenger_ids.includes(row.id) && canSeeAssignment(row.assignment_id))
      .forEach((row) => {
        if (p_status !== null && p_status !== undefined) {
          row.activity_status = p_status;
          row.activity_marked_at = new Date().toISOString();
        }
        if (p_returned !== null && p_returned !== undefined) {
          row.returned = p_returned;
          row.returned_at = p_returned ? new Date().toISOString() : null;
        }
        count += 1;
      });
    return count;
  },

  admin_update_user: (args: any) => {
    requirePermission('platform.users.manage');
    const profile = db.profiles.find((row) => row.id === args.p_user_id);
    if (!profile) throw new Error('User not found.');
    const targetRole = db.access_roles.find((row) => row.code === profile.access_role_code);
    if (targetRole?.is_master && !isMaster()) throw new Error('Only a master admin can change another master admin.');
    if (args.p_access_role_code) {
      const nextRole = db.access_roles.find((row) => row.code === args.p_access_role_code);
      if (!nextRole) throw new Error(`Unknown access role "${args.p_access_role_code}".`);
      if (nextRole.is_master && !isMaster()) throw new Error('Only a master admin can grant master admin.');
      profile.access_role_code = args.p_access_role_code;
    }
    if (args.p_status) profile.status = args.p_status;
    if (args.p_clear_agency) profile.agency_id = null;
    else if (args.p_agency_id) profile.agency_id = args.p_agency_id;
    if (args.p_full_name) profile.full_name = args.p_full_name;
    return profile;
  },

  admin_set_permission_override: ({ p_user_id, p_permission_code, p_effect }: any) => {
    requirePermission('platform.users.manage');
    const permission = db.permissions.find((row) => row.code === p_permission_code);
    if (!permission) throw new Error(`Unknown permission "${p_permission_code}".`);
    if (permission.department_code === 'platform' && !isMaster()) {
      throw new Error('Only a master admin can change admin-panel permissions.');
    }
    db.user_permission_overrides = db.user_permission_overrides.filter(
      (row) => !(row.user_id === p_user_id && row.permission_code === p_permission_code),
    );
    if (p_effect !== 'inherit') {
      db.user_permission_overrides.push({ user_id: p_user_id, permission_code: p_permission_code, effect: p_effect });
    }
    return null;
  },

  admin_set_role_permission: ({ p_role_code, p_permission_code, p_enabled }: any) => {
    requirePermission('platform.roles.manage');
    const role = db.access_roles.find((row) => row.code === p_role_code);
    if (!role) throw new Error(`Unknown access role "${p_role_code}".`);
    if (role.is_master) throw new Error('The master admin role always has every permission.');
    const permission = db.permissions.find((row) => row.code === p_permission_code);
    if (permission?.department_code === 'platform' && !isMaster()) {
      throw new Error('Only a master admin can change admin-panel permissions.');
    }
    db.access_role_permissions = db.access_role_permissions.filter(
      (row) => !(row.role_code === p_role_code && row.permission_code === p_permission_code),
    );
    if (p_enabled) db.access_role_permissions.push({ role_code: p_role_code, permission_code: p_permission_code });
    return null;
  },

  admin_save_access_role: ({ p_code, p_name, p_description }: any) => {
    requirePermission('platform.roles.manage');
    const code = String(p_code).toLowerCase().replace(/[^a-z0-9]+/g, '_');
    if (!code) throw new Error('A role code is required.');
    let role = db.access_roles.find((row) => row.code === code);
    if (!role) {
      role = { code, name: p_name, description: p_description ?? null, is_master: false, is_system: false, sort_order: 100 };
      db.access_roles.push(role);
    } else {
      role.name = p_name;
      role.description = p_description ?? role.description;
    }
    return role;
  },

  admin_effective_permissions: ({ p_user_id }: any) => {
    requirePermission('platform.users.manage');
    const profile = db.profiles.find((row) => row.id === p_user_id);
    const role = db.access_roles.find((row) => row.code === profile?.access_role_code);
    return db.permissions.map((permission) => {
      const override = db.user_permission_overrides.find(
        (row) => row.user_id === p_user_id && row.permission_code === permission.code,
      );
      const fromRole = db.access_role_permissions.some(
        (row) => row.role_code === profile?.access_role_code && row.permission_code === permission.code,
      );
      const source = role?.is_master
        ? 'master'
        : override?.effect === 'revoke'
          ? 'revoked'
          : override?.effect === 'grant'
            ? 'granted'
            : fromRole
              ? 'role'
              : 'none';
      return { permission_code: permission.code, source, allowed: userHasPermission(p_user_id, permission.code) };
    });
  },
};

export function createDemoClient() {
  return {
    from(table: string) {
      return new DemoQuery(table);
    },
    rpc(name: string, args: any = {}) {
      const handler = rpcHandlers[name];
      const run = () => {
        if (!handler) return { data: null, error: { message: `${name} is not available in the demo.` } };
        try {
          const data = handler(args);
          persistDemoDb();
          return { data, error: null };
        } catch (error) {
          return { data: null, error: { message: (error as Error).message } };
        }
      };
      return Promise.resolve(run());
    },
    auth: {
      getSession: async () => ({ data: { session: demoSession() }, error: null }),
      onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
        const unsubscribe = registerAuthListener(callback);
        return { data: { subscription: { unsubscribe } } };
      },
      signInWithPassword: async ({ email }: { email: string }) => {
        const profile = db.profiles.find(
          (row) => row.login_email && row.login_email.toLowerCase() === email.trim().toLowerCase(),
        );
        if (!profile) {
          return { data: null, error: { message: 'No demo account with that email. Use the persona buttons below.' } };
        }
        demoSignIn(profile.id);
        return { data: { session: demoSession() }, error: null };
      },
      signInAnonymously: async () => {
        demoSignIn('u-tablet');
        return { data: { session: demoSession() }, error: null };
      },
      signUp: async () => ({ data: null, error: { message: 'Sign-up is disabled in the demo. Use a persona below.' } }),
      signOut: async () => { clearDemoSession(); return { error: null }; },
    },
    storage: {
      from: () => ({
        upload: async () => ({ data: null, error: { message: 'File upload is disabled in the demo.' } }),
        createSignedUrl: async () => ({ data: null, error: { message: 'Not available in the demo.' } }),
      }),
    },
  };
}
