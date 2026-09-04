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

const KL_TZ = 'Asia/Kuala_Lumpur';

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
  transport_vehicles: (row) => db.transport_vehicles.find((item) => item.id === row.vehicle_id) ?? null,
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
  if (table === 'fuel_purchases' && op !== 'delete') {
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


function logAttendance(passengerIds: string[], action: string, toValue: string) {
  const actor = db.profiles.find((row) => row.id === currentUserIdRef.value)?.full_name ?? 'unknown';
  passengerIds.forEach((passengerId) => {
    const passenger = db.trip_passengers.find((row) => row.id === passengerId);
    if (!passenger) return;
    const assignment = db.boat_assignments.find((row) => row.id === passenger.assignment_id);
    const boat = db.boats.find((row) => row.id === assignment?.boat_id);
    const tourist = db.tourists.find((row) => row.id === passenger.tourist_id);
    const booking = db.bookings.find((row) => row.id === passenger.booking_id);
    db.attendance_log.push({
      id: uid(),
      service_date: assignment?.service_date ?? null,
      assignment_id: passenger.assignment_id,
      boat_code: boat?.code ?? null,
      passenger_id: passengerId,
      tourist_name: tourist?.full_name ?? null,
      booking_ref: booking?.booking_ref ?? null,
      action,
      from_value: null,
      to_value: toValue,
      actor_id: currentUserIdRef.value,
      actor_name: actor,
      created_at: new Date().toISOString(),
    });
  });
}

function logMilestone(assignmentId: string, eventCode: string, department: string, detail: string) {
  const assignment = db.boat_assignments.find((row) => row.id === assignmentId);
  if (!assignment) return;
  const exists = db.operations_events.some(
    (row) => row.event_code === eventCode && row.reference_id === assignmentId);
  if (exists) return;
  db.operations_events.push({
    id: uid(),
    service_date: assignment.service_date,
    department_code: department,
    event_code: eventCode,
    subject: db.boats.find((row) => row.id === assignment.boat_id)?.code ?? null,
    detail,
    severity: 'info',
    reference_type: 'boat_assignment',
    reference_id: assignmentId,
    occurred_at: new Date().toISOString(),
    actor_id: currentUserIdRef.value,
  });
}

function refreshMilestones(assignmentId: string) {
  const list = db.trip_passengers.filter((row) => row.assignment_id === assignmentId);
  if (list.length === 0) return;
  const settled = list.filter((row) => row.boarding_status !== 'pending').length;
  const arrived = list.filter((row) => row.boarding_status === 'arrived');
  if (settled === list.length) {
    logMilestone(assignmentId, 'boarding.completed', 'boarding',
      `${arrived.length} of ${list.length} guests checked in`);
  }
  if (arrived.length > 0 && arrived.every((row) => row.activity_code)) {
    logMilestone(assignmentId, 'activities.selected', 'activities',
      `All ${arrived.length} guests have an activity`);
  }
  if (arrived.length > 0 && arrived.every((row) => row.activity_status !== 'pending')) {
    logMilestone(assignmentId, 'activities.completed', 'activities',
      `Activity roll call done for ${arrived.length} guests`);
  }
  if (arrived.length > 0 && arrived.every((row) => row.returned)) {
    logMilestone(assignmentId, 'activities.all_returned', 'activities',
      `All ${arrived.length} guests back on board`);
  }
}

function recountPax(bookingId: string) {
  const booking = db.bookings.find((row) => row.id === bookingId);
  if (!booking) return;
  const people = db.tourists.filter((row) => row.booking_id === bookingId);
  booking.pax_total = people.length;
  booking.pax_adults = people.filter((row) => row.age_band === 'adult').length;
  booking.pax_elderly = people.filter((row) => row.age_band === 'elderly').length;
  booking.pax_children = people.length - booking.pax_adults - booking.pax_elderly;
}

function distanceKm(
  lat1: number | null | undefined,
  lon1: number | null | undefined,
  lat2: number | null | undefined,
  lon2: number | null | undefined,
): number | null {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
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


// The message body is built once, exactly as the SQL does, so the outbox
// shows what would really be sent.
function purchaseRequestMessage(requestId: string) {
  const request = db.purchase_requests.find((row) => row.id === requestId);
  if (!request) return '';
  const who = db.profiles.find((row) => row.id === request.requested_by)?.full_name ?? 'Kitchen';
  const lines = db.purchase_request_items
    .filter((row) => row.request_id === requestId)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((row, index) =>
      `${index + 1}. ${row.item_name} - ${Number(row.quantity)} ${row.unit}${row.note ? ` (${row.note})` : ''}`)
    .join('\n');

  const readable = new Date(`${request.needed_for_date}T00:00:00`).toLocaleDateString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  });

  return [
    '*THINGS TO PURCHASE*',
    `Request: ${request.request_no}`,
    `Needed for: ${readable}`,
    `Pax: ${request.pax_count}`,
    request.purpose ? `For: ${request.purpose}` : null,
    '',
    lines,
    request.notes ? `\nNote: ${request.notes}` : null,
    `\nRequested by: ${who}`,
  ].filter((line) => line !== null).join('\n');
}

function boatAssignmentMessage(serviceDate: string) {
  const parts: string[] = ['*BOAT ASSIGNMENT*', serviceDate, ''];
  db.boat_assignments
    .filter((a) => a.service_date === serviceDate && a.status !== 'cancelled')
    .forEach((assignment) => {
      const boat = db.boats.find((b) => b.id === assignment.boat_id);
      const seated = db.trip_bookings.filter((tb) => tb.assignment_id === assignment.id);
      if (seated.length === 0) return;
      const pax = seated.reduce(
        (sum, tb) => sum + (db.bookings.find((b) => b.id === tb.booking_id)?.pax_total ?? 0), 0);
      parts.push(`*${boat?.code}${boat?.name ? ` (${boat.name})` : ''}*${assignment.departure_time ? ` - ${assignment.departure_time}` : ''}`);
      parts.push(`Captain: ${db.employees.find((e) => e.id === assignment.captain_employee_id)?.full_name ?? 'not set'}  |  Guide: ${db.employees.find((e) => e.id === assignment.guide_employee_id)?.full_name ?? 'not set'}`);
      parts.push(`Pax: ${pax}/${boat?.capacity_pax}`);
      seated.forEach((tb) => {
        const booking = db.bookings.find((b) => b.id === tb.booking_id);
        if (!booking) return;
        parts.push(`- ${booking.lead_name} (${booking.pax_total} pax${booking.pickup_hotel_name ? `, ${booking.pickup_hotel_name}` : ''})`);
        db.tourists
          .filter((tourist) => tourist.booking_id === booking.id)
          .sort((a, b) => a.sort_order - b.sort_order)
          .forEach((tourist) => parts.push(`   . ${tourist.full_name}`));
      });
      parts.push('');
    });
  return parts.join('\n');
}

// A message is only produced when its rule is on, so switching a rule off
// really does stop it rather than queueing silently.
function queueMessage(
  ruleCode: string,
  title: string,
  body: string,
  serviceDate: string | null,
  referenceType: string | null,
  referenceId: string | null,
) {
  const rule = db.notification_rules.find((row) => row.code === ruleCode);
  if (!rule || !rule.enabled) return null;
  const message = {
    id: uid(), rule_code: ruleCode, department_code: rule.department_code,
    channel: rule.channel, service_date: serviceDate, title, body,
    reference_type: referenceType, reference_id: referenceId,
    status: 'queued', created_by: currentUserIdRef.value,
    created_at: new Date().toISOString(), sent_at: null, sent_by: null, send_note: null,
  };
  db.outbound_messages.push(message);
  return message.id;
}


/**
 * Same route logic as the SQL: start at the hotel furthest from the jetty,
 * always hop to the nearest unvisited stop, then work the times backwards
 * from when the van has to be at the jetty.
 */
function orderPickupRun(runId: string) {
  const run = db.pickup_groups.find((row) => row.id === runId);
  if (!run) return 0;
  const base = { lat: 5.42, lng: 100.34 };
  const speed = 30;
  const dwell = 5;

  const bookings = db.bookings.filter((row) => row.pickup_group_id === runId);
  if (bookings.length === 0) return 0;

  const stops = new Map<string, { lat: number | null; lng: number | null }>();
  bookings.forEach((booking) => {
    const key = String(booking.pickup_hotel_name || booking.pickup_area || booking.id).toLowerCase();
    if (!stops.has(key)) stops.set(key, { lat: booking.pickup_latitude, lng: booking.pickup_longitude });
  });

  const remaining = [...stops.entries()];
  remaining.sort(
    (a, b) =>
      (distanceKm(b[1].lat, b[1].lng, base.lat, base.lng) ?? -1) -
      (distanceKm(a[1].lat, a[1].lng, base.lat, base.lng) ?? -1),
  );

  const ordered: Array<{ key: string; minutes: number }> = [];
  let current = remaining.shift()!;
  let minutes = 0;
  ordered.push({ key: current[0], minutes });

  while (remaining.length > 0) {
    remaining.sort(
      (a, b) =>
        (distanceKm(current[1].lat, current[1].lng, a[1].lat, a[1].lng) ?? 999) -
        (distanceKm(current[1].lat, current[1].lng, b[1].lat, b[1].lng) ?? 999),
    );
    const next = remaining.shift()!;
    const hop = distanceKm(current[1].lat, current[1].lng, next[1].lat, next[1].lng) ?? 0;
    minutes += dwell + (hop / speed) * 60;
    ordered.push({ key: next[0], minutes });
    current = next;
  }

  const toJetty = distanceKm(current[1].lat, current[1].lng, base.lat, base.lng) ?? 0;
  const total = minutes + dwell + (toJetty / speed) * 60;

  const departures = db.boat_assignments
    .filter((a) => a.service_date === run.service_date && a.departure_time)
    .map((a) => a.departure_time as string)
    .sort();
  const target = departures[0] ?? '09:00';
  const [th, tm] = target.split(':').map(Number);
  const targetMinutes = th * 60 + tm - 30;
  const startMinutes = Math.max(targetMinutes - Math.ceil(total), 0);
  const fmt = (value: number) =>
    `${String(Math.floor(value / 60) % 24).padStart(2, '0')}:${String(Math.round(value % 60)).padStart(2, '0')}`;

  run.depart_time = fmt(startMinutes);
  run.pickup_time = run.depart_time;

  ordered.forEach((stop, index) => {
    bookings
      .filter(
        (booking) =>
          String(booking.pickup_hotel_name || booking.pickup_area || booking.id).toLowerCase() === stop.key,
      )
      .forEach((booking) => {
        booking.pickup_stop_order = index + 1;
        booking.pickup_eta = fmt(startMinutes + Math.ceil(stop.minutes));
      });
  });

  return ordered.length;
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



  // ---- pickup and transport --------------------------------------------
  set_booking_pickup: ({ p_booking_id, p_required }: any) => {
    // Either the coordinator, or the person who entered the booking.
    const owner = db.bookings.find((row) => row.id === p_booking_id)?.created_by;
    if (!can('guests.pickup.manage') && !can('guests.booking.edit_all') && owner !== currentUserIdRef.value) {
      throw new Error('You cannot change this booking.');
    }
    const booking = db.bookings.find((row) => row.id === p_booking_id);
    if (!booking) throw new Error('Booking not found.');
    booking.pickup_required = p_required;
    if (!p_required) {
      booking.pickup_group_id = null;
      booking.pickup_stop_order = null;
      booking.pickup_eta = null;
    }
    return null;
  },

  order_pickup_run: ({ p_run_id }: any) => orderPickupRun(p_run_id),

  auto_plan_pickups: ({ p_service_date, p_radius_km }: any) => {
    requirePermission('guests.pickup.manage');
    const radius = Number(p_radius_km) || 1.5;
    const base = { lat: 5.42, lng: 100.34 };
    let placed = 0;

    const waiting = db.bookings
      .filter(
        (b) =>
          b.service_date === p_service_date &&
          b.pickup_required &&
          !b.pickup_group_id &&
          b.status !== 'cancelled',
      )
      // Furthest hotel first, so a run builds inwards towards the jetty.
      .sort(
        (a, b) =>
          (distanceKm(b.pickup_latitude, b.pickup_longitude, base.lat, base.lng) ?? -1) -
          (distanceKm(a.pickup_latitude, a.pickup_longitude, base.lat, base.lng) ?? -1),
      );

    waiting.forEach((booking) => {
      const spot = booking.pickup_hotel_name || booking.pickup_area || 'Pickup';
      let run = db.pickup_groups
        .filter((g) => g.service_date === p_service_date && g.status !== 'cancelled')
        .find((g) => {
          const seats = db.transport_vehicles.find((v) => v.id === g.vehicle_id)?.capacity_pax ?? 0;
          const used = db.bookings
            .filter((b) => b.pickup_group_id === g.id)
            .reduce((sum, b) => sum + b.pax_total, 0);
          const near = db.bookings.some(
            (b) =>
              b.pickup_group_id === g.id &&
              (String(b.pickup_hotel_name ?? '').toLowerCase() === String(spot).toLowerCase() ||
                (booking.pickup_latitude != null &&
                  b.pickup_latitude != null &&
                  (distanceKm(booking.pickup_latitude, booking.pickup_longitude, b.pickup_latitude, b.pickup_longitude) ?? 999) <= radius)),
          );
          return near && (seats === 0 || used + booking.pax_total <= seats);
        });

      if (!run) {
        const vehicle = db.transport_vehicles
          .filter(
            (v) =>
              v.active &&
              !db.pickup_groups.some(
                (g) => g.service_date === p_service_date && g.vehicle_id === v.id && g.status !== 'cancelled',
              ),
          )
          .sort((a, b) => b.capacity_pax - a.capacity_pax)[0];
        run = {
          id: uid(),
          service_date: p_service_date,
          name: `${vehicle?.code ?? 'Run'} · ${spot}`,
          area_label: booking.pickup_area ?? null,
          latitude: booking.pickup_latitude ?? null,
          longitude: booking.pickup_longitude ?? null,
          pickup_time: null,
          depart_time: null,
          vehicle_id: vehicle?.id ?? null,
          driver_employee_id: vehicle?.default_driver_employee_id ?? null,
          status: 'planned',
          sort_order: db.pickup_groups.length + 1,
          notes: null,
          auto_created: true,
          created_at: new Date().toISOString(),
        };
        db.pickup_groups.push(run);
      }

      booking.pickup_group_id = run.id;
      placed += 1;
    });

    db.pickup_groups = db.pickup_groups.filter(
      (g) =>
        g.service_date !== p_service_date ||
        !g.auto_created ||
        db.bookings.some((b) => b.pickup_group_id === g.id),
    );
    db.pickup_groups
      .filter((g) => g.service_date === p_service_date)
      .forEach((g) => orderPickupRun(g.id));
    return placed;
  },

  assign_pickup_run: ({ p_booking_id, p_run_id, p_allow_overload }: any) => {
    requirePermission('guests.pickup.manage');
    const booking = db.bookings.find((row) => row.id === p_booking_id);
    if (!booking) throw new Error('Booking not found.');
    const previous = booking.pickup_group_id;

    if (p_run_id) {
      const run = db.pickup_groups.find((row) => row.id === p_run_id);
      if (!run) throw new Error('Pickup run not found.');
      const seats = db.transport_vehicles.find((v) => v.id === run.vehicle_id)?.capacity_pax ?? 0;
      const used = db.bookings
        .filter((b) => b.pickup_group_id === p_run_id && b.id !== p_booking_id)
        .reduce((sum, b) => sum + b.pax_total, 0);
      if (!p_allow_overload && seats > 0 && used + booking.pax_total > seats) {
        throw new Error(`${run.name} has ${Math.max(seats - used, 0)} seat(s) left and this booking is ${booking.pax_total} pax.`);
      }
      booking.pickup_required = true;
    }

    booking.pickup_group_id = p_run_id ?? null;
    booking.pickup_stop_order = null;
    booking.pickup_eta = null;
    if (p_run_id) orderPickupRun(p_run_id);
    if (previous && previous !== p_run_id) orderPickupRun(previous);
    return null;
  },

  save_pickup_run: (args: any) => {
    requirePermission('guests.pickup.manage');
    if (!args.p_name?.trim()) throw new Error('Give the run a name.');
    let run = args.p_id ? db.pickup_groups.find((row) => row.id === args.p_id) : null;
    if (!run) {
      run = {
        id: uid(), service_date: args.p_service_date, auto_created: false,
        area_label: null, latitude: null, longitude: null,
        sort_order: db.pickup_groups.length + 1, created_at: new Date().toISOString(),
      };
      db.pickup_groups.push(run);
    }
    Object.assign(run, {
      name: args.p_name.trim(),
      vehicle_id: args.p_vehicle_id ?? null,
      driver_employee_id: args.p_driver_employee_id ?? null,
      depart_time: args.p_depart_time || run.depart_time || null,
      pickup_time: args.p_depart_time || run.pickup_time || null,
      status: args.p_status || run.status || 'planned',
      notes: args.p_notes ?? run.notes ?? null,
    });
    return run;
  },

  delete_pickup_run: ({ p_run_id }: any) => {
    requirePermission('guests.pickup.manage');
    db.bookings
      .filter((row) => row.pickup_group_id === p_run_id)
      .forEach((row) => {
        row.pickup_group_id = null;
        row.pickup_stop_order = null;
        row.pickup_eta = null;
      });
    db.pickup_groups = db.pickup_groups.filter((row) => row.id !== p_run_id);
    return null;
  },

  copy_purchase_request: ({ p_source_id, p_needed_for_date }: any) => {
    requirePermission('kitchen.request.create');
    const source = db.purchase_requests.find((row) => row.id === p_source_id);
    if (!source) throw new Error('Request not found.');
    const sameDay = db.purchase_requests.filter((row) => row.needed_for_date === p_needed_for_date).length + 1;
    const copy = {
      ...source,
      id: uid(),
      request_no: `PR-${String(p_needed_for_date).replace(/-/g, '').slice(2)}-${String(sameDay).padStart(3, '0')}`,
      needed_for_date: p_needed_for_date,
      status: 'draft',
      submitted_at: null,
      completed_at: null,
      requested_by: currentUserIdRef.value,
      created_at: new Date().toISOString(),
    };
    db.purchase_requests.push(copy);
    db.purchase_request_items
      .filter((row) => row.request_id === p_source_id)
      .forEach((row) => {
        db.purchase_request_items.push({
          ...row, id: uid(), request_id: copy.id,
          purchase_status: 'pending', purchased_quantity: null, actual_cost: null,
          supplier: null, purchased_by: null, purchased_at: null, purchase_note: null,
        });
      });
    return copy.id;
  },

  // ---- kitchen and purchasing ----------------------------------------
  save_purchase_request: ({ p_request, p_items }: any) => {
    const isNew = !p_request.id;
    if (isNew) requirePermission('kitchen.request.create');
    let request = isNew ? null : db.purchase_requests.find((row) => row.id === p_request.id);
    if (!isNew && !request) throw new Error('Request not found.');
    if (!isNew) {
      const mine = request!.requested_by === currentUserIdRef.value && ['draft', 'submitted'].includes(request!.status);
      if (!can('kitchen.manage') && !mine) throw new Error('You cannot edit this request.');
    }

    if (isNew) {
      const sameDay = db.purchase_requests.filter((row) => row.needed_for_date === p_request.needed_for_date).length + 1;
      request = {
        id: uid(),
        request_no: `PR-${String(p_request.needed_for_date).replace(/-/g, '').slice(2)}-${String(sameDay).padStart(3, '0')}`,
        origin: p_request.origin || 'kitchen',
        status: 'draft',
        requested_by: currentUserIdRef.value,
        submitted_at: null,
        completed_at: null,
        cancelled_reason: null,
        created_at: new Date().toISOString(),
      };
      db.purchase_requests.push(request!);
    }
    Object.assign(request!, {
      needed_for_date: p_request.needed_for_date,
      pax_count: Number(p_request.pax_count) || 0,
      purpose: p_request.purpose || null,
      notes: p_request.notes || null,
    });

    const keep: string[] = [];
    (p_items ?? []).forEach((item: Row, index: number) => {
      if (!item.item_name?.trim()) return;
      let row = item.id ? db.purchase_request_items.find((x) => x.id === item.id) : null;
      if (!row) {
        row = { id: uid(), request_id: request!.id };
        db.purchase_request_items.push(row);
      }
      Object.assign(row, {
        item_name: item.item_name.trim(),
        quantity: Number(item.quantity) || 0,
        unit: item.unit || 'kg',
        note: item.note || null,
        purchase_status: row.purchase_status ?? 'pending',
        sort_order: index + 1,
      });
      keep.push(row.id);
    });
    if (keep.length === 0) throw new Error('Add at least one item to the request.');
    db.purchase_request_items = db.purchase_request_items.filter(
      (row) => row.request_id !== request!.id || keep.includes(row.id),
    );
    return request!.id;
  },

  submit_purchase_request: ({ p_request_id }: any) => {
    requirePermission('kitchen.request.submit');
    const request = db.purchase_requests.find((row) => row.id === p_request_id);
    if (!request) throw new Error('Request not found.');
    if (request.status !== 'draft') throw new Error('This request has already been sent.');
    request.status = 'submitted';
    request.submitted_at = new Date().toISOString();
    queueMessage('kitchen.request_submitted', `Kitchen request ${request.request_no}`,
      purchaseRequestMessage(request.id), request.needed_for_date, 'purchase_request', request.id);
    return request;
  },

  set_purchase_item_status: (args: any) => {
    requirePermission('purchasing.fulfil');
    const ids: string[] = args.p_item_ids ?? [];
    let count = 0;
    db.purchase_request_items
      .filter((row) => ids.includes(row.id))
      .forEach((row) => {
        row.purchase_status = args.p_status;
        const clearing = args.p_status === 'pending';
        row.purchased_quantity = clearing ? null : args.p_purchased_quantity ?? row.quantity;
        row.actual_cost = clearing ? null : args.p_actual_cost ?? row.actual_cost;
        row.supplier = clearing ? null : args.p_supplier ?? row.supplier;
        row.purchase_note = args.p_note ?? null;
        row.purchased_by = clearing ? null : currentUserIdRef.value;
        row.purchased_at = clearing ? null : new Date().toISOString();
        count += 1;
      });

    const touched = new Set(
      db.purchase_request_items.filter((row) => ids.includes(row.id)).map((row) => row.request_id),
    );
    touched.forEach((requestId) => {
      const request = db.purchase_requests.find((row) => row.id === requestId);
      if (!request || !['submitted', 'buying', 'completed'].includes(request.status)) return;
      const outstanding = db.purchase_request_items.some(
        (row) => row.request_id === requestId && row.purchase_status === 'pending',
      );
      request.status = outstanding ? 'buying' : 'completed';
      request.completed_at = outstanding ? null : new Date().toISOString();
    });
    return count;
  },

  cancel_purchase_request: ({ p_request_id, p_reason }: any) => {
    if (!p_reason?.trim()) throw new Error('Say why this request is being cancelled.');
    const request = db.purchase_requests.find((row) => row.id === p_request_id);
    if (!request) throw new Error('Request not found.');
    const mine = request.requested_by === currentUserIdRef.value && request.status === 'draft';
    if (!can('kitchen.manage') && !can('purchasing.manage') && !mine) {
      throw new Error('You cannot cancel this request.');
    }
    request.status = 'cancelled';
    request.cancelled_reason = p_reason.trim();
    return null;
  },

  // ---- messaging ------------------------------------------------------
  set_notification_rule: ({ p_code, p_enabled }: any) => {
    requirePermission('ops.messages.manage');
    const rule = db.notification_rules.find((row) => row.code === p_code);
    if (!rule) throw new Error(`Unknown notification rule "${p_code}".`);
    rule.enabled = p_enabled;
    return rule;
  },

  mark_outbound_sent: ({ p_message_id, p_status, p_note }: any) => {
    requirePermission('ops.messages.send');
    const message = db.outbound_messages.find((row) => row.id === p_message_id);
    if (!message) throw new Error('Message not found.');
    message.status = p_status ?? 'sent';
    message.sent_at = message.status === 'sent' ? new Date().toISOString() : null;
    message.send_note = p_note ?? null;
    return message;
  },

  // ---- operations log --------------------------------------------------
  operations_day_status: ({ p_service_date }: any) => {
    requirePermission('ops.log.view');
    const rows: Row[] = [];
    const now = new Date();
    db.operations_checkpoints
      .filter((checkpoint) => checkpoint.enabled)
      .sort((a, b) => a.sort_order - b.sort_order)
      .forEach((checkpoint) => {
        const subjects =
          checkpoint.scope === 'per_day'
            ? [{ subject: null as string | null, assignmentId: null as string | null }]
            : db.boat_assignments
                .filter(
                  (assignment) =>
                    assignment.service_date === p_service_date &&
                    assignment.status !== 'cancelled' &&
                    db.trip_passengers.some((tp) => tp.assignment_id === assignment.id),
                )
                .map((assignment) => ({
                  subject: db.boats.find((boat) => boat.id === assignment.boat_id)?.code ?? null,
                  assignmentId: assignment.id,
                }));

        subjects.forEach(({ subject, assignmentId }) => {
          const event = db.operations_events.find(
            (row) =>
              row.event_code === checkpoint.event_code &&
              row.service_date === p_service_date &&
              (assignmentId === null || row.reference_id === assignmentId),
          );
          const due = new Date(`${p_service_date}T${checkpoint.due_time}`);
          rows.push({
            checkpoint_code: checkpoint.code,
            checkpoint_name: checkpoint.name,
            department_code: checkpoint.department_code,
            subject,
            assignment_id: assignmentId,
            due_time: checkpoint.due_time,
            done: Boolean(event),
            done_at: event?.occurred_at ?? null,
            overdue: !event && now > due,
            detail: event?.detail ?? null,
          });
        });
      });
    return rows;
  },

  raise_overdue_alerts: ({ p_service_date }: any) => {
    requirePermission('ops.log.view');
    const late = (rpcHandlers.operations_day_status({ p_service_date }) as Row[]).filter((row) => row.overdue);
    let raised = 0;
    late.forEach((row) => {
      const label = `${row.checkpoint_name}${row.subject ? ` - ${row.subject}` : ''}`;
      if (db.operations_events.some((e) => e.event_code === 'ops.overdue' && e.subject === label && e.service_date === p_service_date)) return;
      db.operations_events.push({
        id: uid(), service_date: p_service_date, department_code: row.department_code,
        event_code: 'ops.overdue', subject: label,
        detail: `Not done by ${row.due_time}`, severity: 'alert',
        reference_type: 'operations_checkpoint', reference_id: row.assignment_id,
        occurred_at: new Date().toISOString(), actor_id: currentUserIdRef.value,
      });
      queueMessage('ops.checkpoint_overdue', `Running late: ${label}`,
        `*RUNNING LATE*\n${p_service_date}\n\n${label}\nExpected by ${row.due_time}, still not done.`,
        p_service_date, 'operations_checkpoint', row.assignment_id);
      raised += 1;
    });
    return raised;
  },

  set_operations_checkpoint: ({ p_code, p_due_time, p_enabled }: any) => {
    requirePermission('ops.log.manage');
    const checkpoint = db.operations_checkpoints.find((row) => row.code === p_code);
    if (!checkpoint) throw new Error(`Unknown checkpoint "${p_code}".`);
    if (p_due_time) checkpoint.due_time = p_due_time;
    if (p_enabled !== null && p_enabled !== undefined) checkpoint.enabled = p_enabled;
    return checkpoint;
  },

  // ---- trips and fuel --------------------------------------------------
  sync_boat_trips: ({ p_service_date }: any) => {
    requirePermission('maintenance.view');
    let added = 0;
    db.boat_assignments
      .filter(
        (assignment) =>
          assignment.service_date === p_service_date &&
          assignment.status !== 'cancelled' &&
          db.trip_passengers.some((tp) => tp.assignment_id === assignment.id),
      )
      .forEach((assignment) => {
        const boarded = db.trip_passengers.filter(
          (tp) => tp.assignment_id === assignment.id && tp.boarding_status === 'arrived',
        ).length;
        const existing = db.boat_trips.find((trip) => trip.assignment_id === assignment.id);
        if (existing) {
          existing.pax_count = boarded;
          return;
        }
        db.boat_trips.push({
          id: uid(), service_date: assignment.service_date, boat_id: assignment.boat_id,
          trip_type: 'island_run', assignment_id: assignment.id,
          departure_time: assignment.departure_time, return_time: assignment.return_time,
          pax_count: boarded, purpose: 'Scheduled island run', notes: null,
          auto_generated: true, recorded_by: currentUserIdRef.value, created_at: new Date().toISOString(),
        });
        added += 1;
      });
    return added;
  },

  save_boat_trip: (args: any) => {
    requirePermission('maintenance.fuel.record');
    let trip = args.p_id ? db.boat_trips.find((row) => row.id === args.p_id) : null;
    if (!trip) {
      trip = { id: uid(), auto_generated: false, assignment_id: null, recorded_by: currentUserIdRef.value, created_at: new Date().toISOString() };
      db.boat_trips.push(trip);
    }
    Object.assign(trip, {
      service_date: args.p_service_date,
      boat_id: args.p_boat_id,
      trip_type: args.p_trip_type,
      departure_time: args.p_departure_time || null,
      return_time: args.p_return_time || null,
      pax_count: Number(args.p_pax_count) || 0,
      purpose: args.p_purpose || null,
      notes: args.p_notes || null,
    });
    return trip;
  },

  delete_boat_trip: ({ p_id }: any) => {
    requirePermission('maintenance.manage');
    db.boat_trips = db.boat_trips.filter((row) => row.id !== p_id);
    return null;
  },

  fuel_reconciliation: ({ p_from, p_to }: any) => {
    requirePermission('maintenance.view');
    const inRange = (date: string) => date >= p_from && date <= p_to;
    const purchases = db.fuel_purchases.filter((row) => inRange(row.purchase_date));
    const litres = purchases.reduce((sum, row) => sum + Number(row.litres), 0);
    const cost = purchases.reduce((sum, row) => sum + Number(row.total_cost), 0);
    const price = litres > 0 ? cost / litres : 0;

    const perBoat = db.boats.map((boat) => {
      const trips = db.boat_trips.filter((row) => row.boat_id === boat.id && inRange(row.service_date));
      const baseline = Number(boat.expected_litres_per_trip ?? 0);
      return {
        boat_id: boat.id,
        boat_code: boat.code,
        trips: trips.length,
        emergency_trips: trips.filter((row) => row.trip_type === 'emergency').length,
        pax_carried: trips.reduce((sum, row) => sum + Number(row.pax_count ?? 0), 0),
        litres_per_trip: baseline,
        estimated_litres: Number((trips.length * baseline).toFixed(1)),
      };
    });
    const fleet = perBoat.reduce((sum, row) => sum + row.estimated_litres, 0);
    return perBoat.map((row) => ({
      ...row,
      estimated_share_pct: fleet > 0 ? Number(((row.estimated_litres / fleet) * 100).toFixed(1)) : 0,
      estimated_cost: Number((row.estimated_litres * price).toFixed(2)),
    }));
  },

  fuel_period_totals: ({ p_from, p_to }: any) => {
    requirePermission('maintenance.view');
    const inRange = (date: string) => date >= p_from && date <= p_to;
    const purchases = db.fuel_purchases.filter((row) => inRange(row.purchase_date));
    const bought = purchases.reduce((sum, row) => sum + Number(row.litres), 0);
    const cost = purchases.reduce((sum, row) => sum + Number(row.total_cost), 0);
    const trips = db.boat_trips.filter((row) => inRange(row.service_date));
    const estimated = trips.reduce((sum, row) => {
      const boat = db.boats.find((b) => b.id === row.boat_id);
      return sum + Number(boat?.expected_litres_per_trip ?? 0);
    }, 0);
    return [{
      litres_bought: bought,
      cost_bought: cost,
      litres_estimated: Number(estimated.toFixed(1)),
      variance_litres: Number((bought - estimated).toFixed(1)),
      variance_pct: estimated > 0 ? Number((((bought - estimated) / estimated) * 100).toFixed(1)) : null,
      trips: trips.length,
    }];
  },

  // ---- missing items ---------------------------------------------------
  save_missing_item: (args: any) => {
    if (!args.p_item_name?.trim()) throw new Error('Say which item is missing.');
    let item = args.p_id ? db.missing_items.find((row) => row.id === args.p_id) : null;
    if (!item) {
      requirePermission('items.report');
      item = {
        id: uid(), status: 'missing', found_on: null, found_remarks: null,
        reported_by: currentUserIdRef.value, resolved_by: null, created_at: new Date().toISOString(),
      };
      db.missing_items.push(item);
    } else if (!can('items.manage') && item.reported_by !== currentUserIdRef.value) {
      throw new Error('You can only edit items you reported.');
    }
    Object.assign(item, {
      item_name: args.p_item_name.trim(),
      category: args.p_category || 'equipment',
      quantity: Math.max(Number(args.p_quantity) || 1, 1),
      missing_on: args.p_missing_on,
      noticed_location: args.p_noticed_location || null,
      boat_id: args.p_boat_id || null,
      remarks: args.p_remarks || null,
      estimated_value: args.p_estimated_value ?? null,
    });
    return item;
  },

  resolve_missing_item: ({ p_id, p_status, p_found_on, p_remarks }: any) => {
    requirePermission('items.manage');
    if (p_status === 'written_off' && !p_remarks?.trim()) {
      throw new Error('Say why this item is being written off.');
    }
    const item = db.missing_items.find((row) => row.id === p_id);
    if (!item) throw new Error('Item not found.');
    item.status = p_status;
    item.found_on = p_status === 'found' ? p_found_on ?? TODAY : null;
    item.found_remarks = p_remarks || null;
    item.resolved_by = p_status === 'missing' ? null : currentUserIdRef.value;
    return item;
  },

  // ---- badges and summary ---------------------------------------------
  department_badges: ({ p_service_date }: any) => {
    const out: Row[] = [];
    const push = (department_code: string, count: number, label: string) => {
      if (count > 0) out.push({ department_code, count, label });
    };
    if (can('purchasing.view')) {
      push('purchasing', db.purchase_requests.filter((r) => ['submitted', 'buying'].includes(r.status)).length,
        'request(s) waiting to be bought');
    }
    if (can('kitchen.request.view')) {
      push('kitchen', db.purchase_requests.filter(
        (r) => r.status === 'draft' && (r.requested_by === currentUserIdRef.value || can('kitchen.manage')),
      ).length, 'draft request(s) not sent yet');
    }
    if (can('fleet.assign')) {
      push('fleet', db.bookings.filter(
        (b) => b.service_date === p_service_date && b.status !== 'cancelled'
          && !db.trip_bookings.some((tb) => tb.booking_id === b.id),
      ).length, 'booking(s) with no boat');
    }
    const dayPassengers = db.trip_passengers.filter((tp) => {
      const assignment = db.boat_assignments.find((a) => a.id === tp.assignment_id);
      return assignment?.service_date === p_service_date && canSeeAssignment(tp.assignment_id);
    });
    push('boarding', dayPassengers.filter((tp) => tp.boarding_status === 'pending').length, 'guest(s) not checked in');
    push('activities', dayPassengers.filter((tp) => tp.boarding_status === 'arrived' && !tp.activity_code).length,
      'guest(s) with no activity chosen');
    if (can('maintenance.view')) {
      push('maintenance', db.boat_repairs.filter((r) => ['reported', 'in_progress'].includes(r.status)).length,
        'repair job(s) still open');
    }
    if (can('items.view')) {
      push('items', db.missing_items.filter((r) => r.status === 'missing').length, 'item(s) still missing');
    }
    if (can('ops.messages.send')) {
      push('ops', db.outbound_messages.filter((m) => m.status === 'queued').length, 'message(s) waiting to be sent');
    }
    if (can('platform.users.manage')) {
      push('platform', db.profiles.filter((p) => p.status === 'pending').length, 'account(s) waiting for approval');
    }
    return out;
  },

  operations_summary: ({ p_service_date }: any) => {
    requirePermission('ops.log.view');
    const bookings = db.bookings.filter((b) => b.service_date === p_service_date && b.status !== 'cancelled');
    const assignments = db.boat_assignments.filter(
      (a) => a.service_date === p_service_date && a.status !== 'cancelled'
        && db.trip_passengers.some((tp) => tp.assignment_id === a.id),
    );
    const passengers = db.trip_passengers.filter((tp) =>
      db.boat_assignments.some((a) => a.id === tp.assignment_id && a.service_date === p_service_date));

    const bySource: Record<string, number> = {};
    bookings.forEach((b) => { bySource[b.source_type] = (bySource[b.source_type] ?? 0) + b.pax_total; });

    const summary: Row = {
      guests: {
        bookings: bookings.length,
        pax: bookings.reduce((s, b) => s + b.pax_total, 0),
        adults: bookings.reduce((s, b) => s + (b.pax_adults ?? 0), 0),
        children: bookings.reduce((s, b) => s + (b.pax_children ?? 0), 0),
        elderly: bookings.reduce((s, b) => s + (b.pax_elderly ?? 0), 0),
        by_source: bySource,
      },
      boats: assignments.map((a) => {
        const boat = db.boats.find((b) => b.id === a.boat_id);
        const list = db.trip_passengers.filter((tp) => tp.assignment_id === a.id);
        return {
          code: boat?.code, name: boat?.name, capacity: boat?.capacity_pax,
          captain: db.employees.find((e) => e.id === a.captain_employee_id)?.full_name ?? null,
          guide: db.employees.find((e) => e.id === a.guide_employee_id)?.full_name ?? null,
          departure: a.departure_time,
          assigned: list.length,
          boarded: list.filter((tp) => tp.boarding_status === 'arrived').length,
          no_show: list.filter((tp) => tp.boarding_status === 'no_show').length,
          returned: list.filter((tp) => tp.returned).length,
        };
      }),
      activities: db.activity_types.filter((a) => a.active).map((type) => ({
        code: type.code, name: type.name,
        chosen: passengers.filter((tp) => tp.activity_code === type.code).length,
        joined: passengers.filter((tp) => tp.activity_code === type.code && tp.activity_status === 'joined').length,
        back: passengers.filter((tp) => tp.activity_code === type.code && tp.returned).length,
      })),
      headcount: {
        assigned: passengers.length,
        boarded: passengers.filter((tp) => tp.boarding_status === 'arrived').length,
        no_show: passengers.filter((tp) => tp.boarding_status === 'no_show').length,
        not_checked: passengers.filter((tp) => tp.boarding_status === 'pending').length,
        activity_chosen: passengers.filter((tp) => tp.activity_code).length,
        back_on_boat: passengers.filter((tp) => tp.returned).length,
      },
      trips: db.boat_trips.filter((t) => t.service_date === p_service_date).map((t) => ({
        boat: db.boats.find((b) => b.id === t.boat_id)?.code, type: t.trip_type,
        pax: t.pax_count, departure: t.departure_time, purpose: t.purpose,
      })),
      incidents: db.operations_events
        .filter((e) => e.service_date === p_service_date && e.severity !== 'info')
        .map((e) => ({ event: e.event_code, subject: e.subject, detail: e.detail, at: String(e.occurred_at).slice(11, 16) })),
    };

    if (can('maintenance.view')) {
      const purchases = db.fuel_purchases.filter((f) => f.purchase_date === p_service_date);
      summary.fuel = {
        litres_bought: purchases.reduce((s, f) => s + Number(f.litres), 0),
        cost: can('maintenance.cost.view') ? purchases.reduce((s, f) => s + Number(f.total_cost), 0) : null,
      };
    }
    if (can('kitchen.request.view') || can('purchasing.view')) {
      const requests = db.purchase_requests.filter((r) => r.needed_for_date === p_service_date && r.status !== 'cancelled');
      const items = db.purchase_request_items.filter((i) => requests.some((r) => r.id === i.request_id));
      summary.supplies = {
        requests: requests.length,
        items: items.length,
        items_bought: items.filter((i) => i.purchase_status === 'bought').length,
        pax_catered: requests.reduce((max, r) => Math.max(max, r.pax_count ?? 0), 0),
        spend: can('purchasing.cost.view') ? items.reduce((s, i) => s + Number(i.actual_cost ?? 0), 0) : null,
      };
    }
    if (can('items.view')) {
      summary.missing_items = db.missing_items
        .filter((i) => i.missing_on === p_service_date)
        .map((i) => ({ item: i.item_name, quantity: i.quantity, status: i.status, remarks: i.remarks }));
    }
    if (can('bar.reports.view')) {
      summary.bar = { sales: 0, total: 0, cash: 0, qr: 0, complimentary: 0 };
    }
    return summary;
  },

  booking_history: ({ p_booking_id }: any) => {
    if (!canViewBooking(p_booking_id)) return [];
    return db.audit_logs
      .filter((row) => row.entity_id === p_booking_id)
      .map((row) => ({
        id: row.id, action: row.action, entity_type: row.entity_type,
        actor_name: row.actor_name ?? 'unknown', reason: row.reason ?? null,
        created_at: row.created_at, summary: row.summary ?? null,
      }));
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

  delete_booking: ({ p_booking_id, p_reason }: any) => {
    requirePermission('guests.booking.delete');
    if (!p_reason || String(p_reason).trim().length < 5) {
      throw new Error('Say why this booking is being deleted.');
    }
    if (!canViewBooking(p_booking_id)) throw new Error('Booking not found.');
    const booking = db.bookings.find((row) => row.id === p_booking_id);
    if (!can('guests.booking.edit_all') && booking?.created_by !== currentUserIdRef.value) {
      throw new Error('You can only delete bookings you entered.');
    }
    db.audit_logs.push({
      id: uid(), actor_id: currentUserIdRef.value,
      actor_name: db.profiles.find((row) => row.id === currentUserIdRef.value)?.full_name ?? 'unknown',
      action: 'delete_booking', entity_type: 'booking', entity_id: p_booking_id,
      reason: String(p_reason).trim(), summary: booking?.lead_name ?? null,
      created_at: new Date().toISOString(),
    });
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
    if (p_locked) {
      queueMessage('fleet.assignment_completed', `Boat assignment ${p_service_date}`,
        boatAssignmentMessage(p_service_date), p_service_date, 'boat_assignment_day', null);
    }
    return null;
  },





  mark_boarding: ({ p_passenger_ids, p_status }: any) => {
    requirePermission('boarding.mark');
    let count = 0;
    db.trip_passengers
      .filter((row) => p_passenger_ids.includes(row.id) && canSeeAssignment(row.assignment_id))
      .forEach((row) => {
        row.boarding_status = p_status;
        row.boarded_at = p_status === 'pending' ? null : new Date().toISOString();
        row.boarded_by = p_status === 'pending' ? null : currentUserIdRef.value;
        count += 1;
      });
    const touched = db.trip_passengers.filter((row) => p_passenger_ids.includes(row.id));
    logAttendance(touched.map((row) => row.id), 'boarding', p_status);
    new Set(touched.map((row) => row.assignment_id)).forEach((id) => refreshMilestones(id as string));
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
        row.returned_at = null;
        row.returned_by = null;
        count += 1;
      });
    const touched = db.trip_passengers.filter((row) => p_passenger_ids.includes(row.id));
    logAttendance(touched.map((row) => row.id), 'activity_choice', p_activity_code ?? 'cleared');
    new Set(touched.map((row) => row.assignment_id)).forEach((id) => refreshMilestones(id as string));
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
          row.returned_by = p_returned ? currentUserIdRef.value : null;
        }
        count += 1;
      });
    const touched = db.trip_passengers.filter((row) => p_passenger_ids.includes(row.id));
    if (p_status !== null && p_status !== undefined) {
      logAttendance(touched.map((row) => row.id), 'activity_roll_call', p_status);
    }
    if (p_returned !== null && p_returned !== undefined) {
      logAttendance(touched.map((row) => row.id), 'back_on_boat', p_returned ? 'yes' : 'no');
    }
    new Set(touched.map((row) => row.assignment_id)).forEach((id) => refreshMilestones(id as string));
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
