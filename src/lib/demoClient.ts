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
import { receiptMatches } from './receiptDuplicates';
import { loadLocalIngredientItems, stockInLocalIngredient, withLocalIngredientRollback } from './localStore';
import { demoKitchenHandlers } from './demoKitchen';
import { demoSupplyHandlers, ensureSupplyDemo } from './demoSupplyWorkflow';
import { demoStaffHandlers } from './demoStaffWork';
import { demoReceiptReviewHandlers } from './demoReceiptReview';
import { requestReceiptHandlers } from './demoRequestReceipt';
import { demoDeliveryIssueHandlers } from './demoDeliveryIssues';
import { demoReceiptDeliveryHandlers } from './demoReceiptDelivery';
import { demoKitchenCatalogueHandlers, ensureKitchenCatalogue } from './demoKitchenCatalogue';
import { demoBookingHandlers, recountTravelers, demoStaffPax } from './demoBookingOperations';
import { confirmDemoBoatTrip, isActualTrip, syncDemoBoatTrips } from './demoBoatTrips';
import { deliveredStockQuantity, deliveryErrorLabels, deliveryLineError } from './delivery';
import { awaitingDelivery, remainingToBuy, requestProgress, type PurchaseQueueView } from './purchasingProgress';
import type { PurchaseRequest, PurchaseRequestItem } from './platformTypes';
import { kitchenFractional } from './kitchenCatalogue';
import { distanceKm } from './pickupPlanning';
import { demoPrivacyHandlers, filterDemoGuestResult, guardDemoGuestWrite } from './demoPrivacy';

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
  purchase_request_items: row => db.purchase_request_items.filter(item => item.request_id === row.id).map(item => ({
    ...item, purchase_receipts: (db.purchase_receipts ?? []).filter(receipt => receipt.purchase_item_id === item.id),
  })),
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
  private rowRange: {from:number;to:number} | null = null;
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
  range(from:number,to:number) { if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<from)throw Error('Invalid record range.');this.rowRange={from,to};return this; }
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
      if (this.rowRange) rows = rows.slice(this.rowRange.from,this.rowRange.to+1);
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
  recountTravelers(bookingId);
}

function pickupBoard(date: string) {
  const board = {
    bookings: db.bookings.filter(b => b.service_date === date && !['cancelled','no_show'].includes(b.status)),
    runs: db.pickup_groups.filter(g => g.service_date === date).map(g => ({...g, transport_vehicles: db.transport_vehicles.find(v => v.id === g.vehicle_id) ?? null})),
    vehicles: db.transport_vehicles.filter(v => v.active),
    locations: db.pickup_locations.filter(l => l.active),
  };
  return structuredClone({...board, version: JSON.stringify(board)});
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
  ...demoStaffHandlers,
  ...demoPrivacyHandlers,
  ...demoBookingHandlers,
  ...demoKitchenHandlers,
  ...demoSupplyHandlers,
  ...demoReceiptDeliveryHandlers,
  ...demoReceiptReviewHandlers,
  ...demoDeliveryIssueHandlers,
  ...requestReceiptHandlers(args=>rpcHandlers.record_purchase_batch_checked(args)),
  ...demoKitchenCatalogueHandlers,
  confirm_scheduled_boat_trip: confirmDemoBoatTrip,
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
          return near && seats > 0 && used + booking.pax_total <= seats;
        });

      if (!run) {
        // How many people are still waiting around this hotel, so the run gets a
        // vehicle sized to the whole stop rather than to whoever booked first.
        // Otherwise a two pax hotel takes the coach and the vans run out.
        const clusterPax = db.bookings
          .filter(
            (b) =>
              b.service_date === p_service_date &&
              b.pickup_required &&
              !b.pickup_group_id &&
              b.status !== 'cancelled' &&
              (String(b.pickup_hotel_name ?? '').toLowerCase() === String(spot).toLowerCase() ||
                (booking.pickup_latitude != null &&
                  (distanceKm(booking.pickup_latitude, booking.pickup_longitude, b.pickup_latitude, b.pickup_longitude) ??
                    999) <= radius)),
          )
          .reduce((sum, b) => sum + b.pax_total, 0);

        const free = db.transport_vehicles.filter(
          (v) =>
            v.active &&
            !db.pickup_groups.some(
              (g) => g.service_date === p_service_date && g.vehicle_id === v.id && g.status !== 'cancelled',
            ),
        );
        const need = Math.max(clusterPax, booking.pax_total);
        // The smallest free vehicle that covers the stop; if the stop is bigger
        // than anything free, the biggest one and the rest goes on the next run.
        const vehicle =
          free.filter((v) => v.capacity_pax >= need).sort((a, b) => a.capacity_pax - b.capacity_pax)[0] ??
          free.filter((v) => v.capacity_pax >= booking.pax_total).sort((a, b) => b.capacity_pax - a.capacity_pax)[0];
        // Nothing free that fits: leave it waiting rather than overloading a van
        // or inventing a run with no vehicle and no seat limit.
        if (!vehicle) return;
        run = {
          id: uid(),
          service_date: p_service_date,
          name: `${vehicle.code} · ${spot}`,
          area_label: booking.pickup_area ?? null,
          latitude: booking.pickup_latitude ?? null,
          longitude: booking.pickup_longitude ?? null,
          pickup_time: null,
          depart_time: null,
          vehicle_id: vehicle.id,
          driver_employee_id: vehicle.default_driver_employee_id ?? null,
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

  read_pickup_board: ({p_date}: any) => { requirePermission('guests.pickup.manage'); return pickupBoard(p_date); },
  confirm_pickup_plan: ({p_date, p_version, p_groups, p_request_id}: any) => {
    requirePermission('guests.pickup.manage');
    db.operation_requests ??= [];
    const payload = JSON.stringify([p_date,p_version,p_groups]);
    const previous = db.operation_requests.find(r => r.actor_id === currentUserIdRef.value && r.operation === 'confirm_pickup_plan' && r.request_id === p_request_id);
    if (previous) { if (previous.payload !== payload) throw new Error('This confirmation reference was already used for another plan.'); return previous.count; }
    if (!p_request_id || p_version !== pickupBoard(p_date).version) throw new Error('Pickup details changed on another device. Close this draft and suggest again.');
    if (!Array.isArray(p_groups) || !p_groups.length) throw new Error('Choose at least one group.');
    const seen = new Set(), vehicles = new Set();
    // Validate the complete plan before mutating the local preview store.
    for (const g of p_groups) {
      const vehicle = db.transport_vehicles.find(v => v.id === g.vehicle_id && v.active);
      const run = g.run_id ? db.pickup_groups.find(r => r.id === g.run_id) : null;
      if (!vehicle || vehicle.capacity_pax <= 0 || vehicles.has(g.vehicle_id)) throw new Error('Vehicle is unavailable or repeated.');
      vehicles.add(g.vehicle_id);
      if (g.run_id && (!run || run.service_date !== p_date || run.vehicle_id !== vehicle.id || run.status !== 'planned')) throw new Error('Pickup run is no longer available.');
      if (db.pickup_groups.some(r => r.service_date === p_date && r.vehicle_id === vehicle.id && r.status !== 'cancelled' && r.id !== run?.id)) throw new Error('This vehicle already has a run for this date.');
      let used = db.bookings.filter(b => b.pickup_group_id === run?.id && b.pickup_required && !['cancelled','no_show'].includes(b.status)).reduce((sum,b) => sum+b.pax_total,0);
      if (!Array.isArray(g.booking_ids) || !g.booking_ids.length) throw new Error('A vehicle needs at least one booking.');
      for (const id of g.booking_ids) {
        const booking = db.bookings.find(b => b.id === id);
        if (seen.has(id) || !booking || booking.service_date !== p_date || !booking.pickup_required || booking.pickup_group_id || ['cancelled','no_show'].includes(booking.status)) throw new Error('A booking is no longer waiting for pickup.');
        seen.add(id); used += booking.pax_total;
      }
      if (used > vehicle.capacity_pax) throw new Error(`${vehicle.code} has only ${vehicle.capacity_pax} passenger seats; ${used} pax selected.`);
    }
    for (const g of p_groups) {
      const vehicle = db.transport_vehicles.find(v => v.id === g.vehicle_id)!;
      let run = db.pickup_groups.find(r => r.id === g.run_id);
      if (!run) {
        run = {id:uid(),service_date:p_date,name:`${vehicle.code} pickup`,vehicle_id:vehicle.id,driver_employee_id:vehicle.default_driver_employee_id,status:'planned',sort_order:db.pickup_groups.length+1,auto_created:false};
        db.pickup_groups.push(run);
      }
      for (const id of g.booking_ids) Object.assign(db.bookings.find(b => b.id === id)!,{pickup_group_id:run.id,pickup_stop_order:null,pickup_eta:null,updated_at:new Date().toISOString()});
    }
    db.operation_requests.push({actor_id:currentUserIdRef.value,operation:'confirm_pickup_plan',request_id:p_request_id,payload,count:seen.size});
    db.audit_logs.push({id:uid(),actor_id:currentUserIdRef.value,action:'confirm_pickup_plan',entity_type:'pickup_plan',entity_id:p_request_id,after_json:{service_date:p_date,groups:structuredClone(p_groups)},created_at:new Date().toISOString()});
    return seen.size;
  },
  save_pickup_point_checked: (p: any) => {
    requirePermission('guests.pickup.manage');
    const b = db.bookings.find(b => b.id === p.p_booking_id);
    if (!b || b.updated_at !== p.p_expected_updated_at) throw new Error('Booking changed. Refresh before editing the pickup point.');
    if (!p.p_name?.trim()) throw new Error('Enter a pickup location.');
    if ((p.p_latitude == null) !== (p.p_longitude == null) || (p.p_latitude != null && distanceKm(p.p_latitude,p.p_longitude,0,0) == null)) throw new Error('Enter valid latitude and longitude together, or leave both empty.');
    if (db.pickup_groups.some(r => r.id === b.pickup_group_id && r.status !== 'planned')) throw new Error('This pickup is already underway. Its location cannot change.');
    const before = structuredClone(b);
    Object.assign(b,{pickup_hotel_name:p.p_name.trim(),pickup_area:p.p_area || null,pickup_latitude:p.p_latitude,pickup_longitude:p.p_longitude,pickup_location_id:p.p_location_id,pickup_eta:null,updated_at:new Date(Math.max(Date.now(),Date.parse(b.updated_at)+1)).toISOString()});
    db.audit_logs.push({id:uid(),actor_id:currentUserIdRef.value,action:'save_pickup_point',entity_type:'booking',entity_id:b.id,before_json:before,after_json:structuredClone(b),created_at:new Date().toISOString()});
    return null;
  },
  assign_pickup_run_checked: (p: any) => {
    requirePermission('guests.pickup.manage');
    const b = db.bookings.find(b => b.id === p.p_booking_id);
    const run = db.pickup_groups.find(r => r.id === p.p_run_id);
    if (!b || b.updated_at !== p.p_expected_updated_at) throw new Error('Booking changed. Refresh before moving it.');
    if (['cancelled','no_show'].includes(b.status) || db.pickup_groups.some(r => r.id === b.pickup_group_id && r.status !== 'planned')) throw new Error('This booking is not available for pickup.');
    if (p.p_run_id && (!run || run.status !== 'planned' || run.service_date !== b.service_date)) throw new Error('Choose a planned run on the same date.');
    const oldRun=b.pickup_group_id;
    if(run){const vehicle=db.transport_vehicles.find(v=>v.id===run.vehicle_id && v.active);const used=db.bookings.filter(row=>row.id!==b.id && row.pickup_group_id===run.id && !['cancelled','no_show'].includes(row.status)).reduce((sum,row)=>sum+row.pax_total,0);if(!vehicle || vehicle.capacity_pax<used+b.pax_total)throw new Error('This van has insufficient seats.');}
    Object.assign(b,{pickup_group_id:p.p_run_id??null,pickup_stop_order:null,pickup_eta:null,pickup_required:p.p_run_id?true:b.pickup_required});
    b.updated_at = new Date(Math.max(Date.now(),Date.parse(b.updated_at)+1)).toISOString();
    db.bookings.filter(row => row.pickup_group_id && [p.p_run_id,oldRun].includes(row.pickup_group_id)).forEach(row => {row.pickup_eta=null;});
    return null;
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

  save_pickup_van_checked: (args: any) => {
    requirePermission('guests.pickup.manage');
    db.operation_requests ??= [];
    const payload=JSON.stringify(args);
    const previous=db.operation_requests.find(r=>r.actor_id===currentUserIdRef.value && r.operation==='save_pickup_van' && r.request_id===args.p_request_id);
    if(previous){if(previous.payload!==payload)throw new Error('This save reference belongs to different van details.');const saved=db.pickup_groups.find(r=>r.id===previous.result_id);if(!saved)throw new Error('The saved van has since been removed. Refresh the board.');return saved;}
    if(!args.p_request_id || args.p_version!==rpcHandlers.read_pickup_board({p_date:args.p_service_date}).version)throw Object.assign(new Error('Pickup details changed on another device. Close this form and reopen it.'),{code:'40001'});
    if(!['planned','on_the_road','completed'].includes(args.p_status))throw new Error('Choose a valid van status.');
    const before=db.pickup_groups.find(r=>r.id===args.p_id);
    if(args.p_id && (!before || before.service_date!==args.p_service_date || before.status==='cancelled'))throw new Error('This van is no longer available.');
    if(before && before.status!=='planned' && before.vehicle_id!==args.p_vehicle_id)throw new Error('The pickup is already underway. Its van cannot change.');
    if(!args.p_id && args.p_status!=='planned')throw new Error('New vans must start as planned.');
    const snapshot=before?structuredClone(before):null;
    const saved=rpcHandlers.save_pickup_run(args);
    saved.depart_time=args.p_depart_time || null;saved.pickup_time=args.p_depart_time || null;
    db.operation_requests.push({actor_id:currentUserIdRef.value,operation:'save_pickup_van',request_id:args.p_request_id,payload,result_id:saved.id});
    db.audit_logs.push({id:uid(),actor_id:currentUserIdRef.value,action:'save_pickup_van',entity_type:'pickup_group',entity_id:saved.id,before_json:snapshot,after_json:structuredClone(saved),created_at:new Date().toISOString()});
    return saved;
  },
  save_pickup_run: (args: any) => {
    requirePermission('guests.pickup.manage');
    if (!args.p_name?.trim()) throw new Error('Give the run a name.');
    let run = args.p_id ? db.pickup_groups.find((row) => row.id === args.p_id) : null;
    const vehicle=db.transport_vehicles.find(v=>v.id===args.p_vehicle_id && v.active);
    if(!vehicle || vehicle.capacity_pax<=0)throw Object.assign(new Error('Choose an available van.'),{code:'P0001'});
    if(db.pickup_groups.some(r=>r.id!==args.p_id && r.service_date===args.p_service_date && r.vehicle_id===args.p_vehicle_id && r.status!=='cancelled'))throw Object.assign(new Error('This van is already added for this date.'),{code:'23505'});
    if(db.bookings.filter(b=>!!args.p_id && b.pickup_group_id===args.p_id && b.pickup_required && !['cancelled','no_show'].includes(b.status)).reduce((sum,b)=>sum+b.pax_total,0)>vehicle.capacity_pax)throw new Error('This van has insufficient seats for the assigned guests.');
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
      submitted_by: null,
      submitted_by_name: null,
      completed_at: null,
      requested_by: currentUserIdRef.value,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
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
  read_purchase_suppliers: () => {
    requirePermission('purchasing.view');
    return [...new Set([...(db.purchase_suppliers ?? []).map(row => row.name), ...db.purchase_request_items.map(row => row.supplier).filter(Boolean)])].sort();
  },
  save_purchase_supplier: ({ p_name }: any) => {
    requirePermission('purchasing.fulfil');
    const name = String(p_name ?? '').trim();
    if (!name || name.length > 160) throw new Error('Enter a supplier name up to 160 characters.');
    db.purchase_suppliers ??= [];
    const existing = db.purchase_suppliers.find(row => row.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (existing) return existing.name;
    db.purchase_suppliers.push({ id: uid(), name, created_by: currentUserIdRef.value, created_at: new Date().toISOString() });
    return name;
  },
  record_purchase_batch_checked: (args: any) => {
    requirePermission('purchasing.fulfil');
    requirePermission('purchasing.cost.view');
    const proof = args.p_evidence;
    if (!['guest_meals','staff_meals','bar'].includes(proof?.purpose)) throw Object.assign(new Error('Choose Guest Meals, Staff Meals or Bar.'), {code:'22023'});
    const prefix = currentUserIdRef.value + '/';
    if (!proof || !/^\d{4}-\d{2}-\d{2}$/.test(proof.purchase_date) || proof.purchase_date > new Intl.DateTimeFormat('en-CA', { timeZone: KL_TZ }).format(new Date())
      || !Number.isFinite(proof.total_cost) || proof.total_cost < 0 || Math.abs(proof.total_cost * 100 - Math.round(proof.total_cost * 100)) > 1e-8
      || !proof.receipt_path?.startsWith(prefix) || !proof.items_path?.startsWith(prefix) || proof.receipt_path === proof.items_path
      || !/^[a-f0-9]{64}$/.test(proof.receipt_hash) || !/^[a-f0-9]{64}$/.test(proof.items_hash) || proof.receipt_hash === proof.items_hash)
      throw Object.assign(new Error('A receipt date, total and two different photos are required.'), { code: '22023' });
    if (!args.p_supplier?.trim()) throw Object.assign(new Error('Choose a supplier.'), { code: '22023' });
    const lines: Row[] = args.p_items;
    if (!args.p_request_id || !args.p_operation_id) throw new Error('A request and confirmation ID are required.');
    if (!Array.isArray(lines) || !lines.length || lines.length > 250) throw new Error('Confirm between 1 and 250 items at once.');
    if (lines.some(line => !line?.id || !Number.isFinite(line.quantity) || line.quantity <= 0
      || Math.abs(line.quantity * 100 - Math.round(line.quantity * 100)) > 1e-8
      || (line.actual_cost != null && (!Number.isFinite(line.actual_cost) || line.actual_cost < 0
        || Math.abs(line.actual_cost * 100 - Math.round(line.actual_cost * 100)) > 1e-8)))) {
      throw new Error('Check each bought quantity and cost. Use positive quantities and up to two decimal places.');
    }
    if (new Set(lines.map(line => line.id)).size !== lines.length) throw new Error('A purchase item was included more than once.');
    if (!can('purchasing.cost.view') && lines.some(line => line.actual_cost != null)) throw new Error('You do not have permission to record purchase costs.');
    const supplier = args.p_supplier?.trim() || null;
    const reference = args.p_reference?.trim() || null;
    if (supplier?.length > 160 || reference?.length > 120) throw new Error('The supplier or reference is too long.');
    const payload = JSON.stringify({ request: args.p_request_id, items: lines, supplier, reference, evidence: proof });
    db.operation_requests ??= [];
    const visibleRecord = (record: Row) => ({ ...structuredClone(record), items: record.items.map((line: Row) => {
      const result = { ...line }; if (!can('purchasing.cost.view')) delete result.actual_cost; return result;
    }) });
    const previous = db.operation_requests.find(row => row.actor_id === currentUserIdRef.value && row.operation === 'record_purchase_batch' && row.request_id === args.p_operation_id);
    if (previous) {
      if (previous.payload !== payload) throw new Error('This confirmation was already used with different details.');
      const evidence = db.audit_logs.find(row => row.id === previous.result_id);
      if (!evidence) throw new Error('The saved purchase record could not be found.');
      return visibleRecord(evidence.after_json);
    }
    const request = db.purchase_requests.find(row => row.id === args.p_request_id);
    if (receiptMatches(db,{supplier:supplier??'',receipt_no:reference??'',receipt_hash:proof.receipt_hash}).some(r=>r.status==='confirmed')) throw Object.assign(new Error('This receipt is already recorded. Check the matching receipt before continuing.'),{code:'23505'});
    if (!request || !['submitted', 'buying', 'completed'].includes(request.status)) throw Object.assign(new Error('This request is no longer open for purchases. Reopen Purchasing to check its status.'), { code: '40001' });
    const items = lines.map(line => db.purchase_request_items.find(row => row.id === line.id));
    if (items.some((item, index) => !item || item.request_id !== request.id || item.purchase_status === 'unavailable' || remainingToBuy(item as PurchaseRequestItem) <= 0
      || (item.updated_at ?? null) !== (lines[index].expected_updated_at ?? null))) {
      throw Object.assign(new Error('An item changed on another device. No purchases were recorded. Reopen the request and review it again.'), { code: '40001' });
    }
    const before = structuredClone(items);
    if (items.some((item, index) => lines[index].quantity > remainingToBuy(item as PurchaseRequestItem))) throw new Error('Bought quantity exceeds what is still requested. Update the request first.');
    // All validation precedes mutation so a bad last line cannot save earlier lines.
    items.forEach((item, index) => rpcHandlers.set_purchase_item_status({ p_item_ids: [item!.id], p_status: 'bought',
      p_purchased_quantity: Number(item!.purchased_quantity ?? 0) + lines[index].quantity,
      p_actual_cost: item!.purchased_quantity && item!.actual_cost == null || lines[index].actual_cost == null ? null : Number(item!.actual_cost ?? 0) + lines[index].actual_cost,
      p_supplier: supplier, p_note: item!.purchase_note }));
    const record = { id: uid(), request_id: request.id, request_no: request.request_no, supplier, reference, evidence: structuredClone(proof),
      confirmed_at: new Date().toISOString(), confirmed_by: currentUserIdRef.value,
      confirmed_by_name: db.profiles.find(row => row.id === currentUserIdRef.value)?.full_name ?? null,
      items: items.map((item,index) => ({ id: item!.id, item_name: item!.item_name, unit: item!.unit,
        requested_quantity: item!.quantity, quantity: lines[index].quantity, actual_cost: lines[index].actual_cost })),
    };
    db.audit_logs.push({ id: record.id, actor_id: currentUserIdRef.value, action: 'record_purchase_batch', entity_type: 'purchase_request',
      entity_id: request.id, before_json: before, after_json: structuredClone(record), created_at: record.confirmed_at });
    db.operation_requests.push({ actor_id: currentUserIdRef.value, operation: 'record_purchase_batch', request_id: args.p_operation_id, payload, result_id: record.id });
    return visibleRecord(record);
  },
  read_purchase_batch_records: ({ p_request_id }: any) => {
    requirePermission('purchasing.view');
    const all = db.audit_logs.filter(row => row.entity_id === p_request_id && row.action === 'record_purchase_batch')
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
    return { total: all.length, records: all.slice(0, 100).map(row => ({ ...structuredClone(row.after_json), evidence: can('purchasing.cost.view') ? structuredClone(row.after_json.evidence) : undefined, items: row.after_json.items.map((item: Row) => {
      const result = { ...item }; if (!can('purchasing.cost.view')) delete result.actual_cost; return result;
    }) })) };
  },
  read_delivery_records: ({ p_request_id, p_query = '', p_limit = 10, p_offset = 0 }: any) => {
    requirePermission('purchasing.view');
    if (!p_request_id) throw new Error('Choose a purchase request.');
    if (!Number.isInteger(p_limit) || p_limit < 1 || p_limit > 50 || !Number.isInteger(p_offset) || p_offset < 0) throw new Error('Invalid delivery page.');
    const query = String(p_query ?? '').trim().toLowerCase();
    if (query.length > 160) throw new Error('Search is too long.');
    const request = db.purchase_requests.find(row => row.id === p_request_id);
    const records = db.audit_logs.filter(row => row.entity_type === 'purchase_request' && row.entity_id === p_request_id && row.action === 'receive_purchase_batch').map(row => {
      const saved = row.after_json;
      return { id: row.id, request_id: row.entity_id, request_no: saved.request_no, confirmed_at: saved.confirmed_at,
        confirmed_by: saved.confirmed_by, confirmed_by_name: saved.confirmed_by_name, receipts: structuredClone(saved.receipts) };
    });
    const grouped = new Set(records.flatMap(row => row.receipts.map((receipt: Row) => receipt.id)));
    const itemIds = new Set(db.purchase_request_items.filter(row => row.request_id === p_request_id).map(row => row.id));
    for (const receipt of db.purchase_receipts ?? []) {
      if (!itemIds.has(receipt.purchase_item_id) || grouped.has(receipt.id)) continue;
      records.push({ id: receipt.id, request_id: p_request_id, request_no: request?.request_no, confirmed_at: receipt.received_at,
        confirmed_by: receipt.received_by, confirmed_by_name: receipt.received_by_name, receipts: [structuredClone(receipt)] });
    }
    const dateText = (value: string) => {
      const options = { timeZone: 'Asia/Kuala_Lumpur' };
      const date = new Date(value);
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { ...options, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date).map(part => [part.type, part.value]));
      const month = date.toLocaleDateString('en-US', { ...options, month: 'short' });
      return `${parts.year}-${parts.month}-${parts.day} ${parts.day} ${month} ${parts.year} ${parts.hour}:${parts.minute}`;
    };
    const matching = records.filter(row => [row.id, row.confirmed_by_name].join(' ').toLowerCase().includes(query)
      || dateText(row.confirmed_at).toLowerCase().includes(query.replace(/sept/g, 'sep'))
      || row.receipts.some((receipt: Row) => [receipt.ingredient_name, receipt.received_by_name].join(' ').toLowerCase().includes(query)));
    matching.sort((a, b) => Date.parse(b.confirmed_at) - Date.parse(a.confirmed_at) || a.id.localeCompare(b.id));
    return { total: matching.length, records: matching.slice(p_offset, p_offset + p_limit) };
  },
  read_kitchen_alerts: () => {
    requirePermission('platform.settings.manage');
    const messages = (db.outbound_messages ?? []).filter(row => row.rule_code === 'kitchen.request_submitted').map(row => ({
      id: row.id, title: row.title, body: row.body, created_at: row.created_at, delivery_status: 'preview',
    }));
    for (const log of db.audit_logs.filter(row => ['receive_purchase_batch','kitchen_arrival','kitchen_stock_count'].includes(row.action))) {
      const title = log.action === 'kitchen_stock_count' ? 'Stock check confirmed' : 'Delivery confirmed';
      const count = (log.after_json.items ?? log.after_json.receipts ?? log.after_json.lines ?? []).length;
      const who = db.profiles.find(row => row.id === log.actor_id)?.full_name ?? 'Name not recorded';
      messages.push({ id: log.id, title, body: `${title}\n${count} items\nRecorded by: ${who}\nReference: ${log.entity_id}`, created_at: log.created_at, delivery_status: 'preview' });
    }
    return { verified: false, messages: messages.sort((a,b) => b.created_at.localeCompare(a.created_at)).slice(0,30) };
  },
  read_purchasing_queue: ({ p_view = 'open', p_query = '', p_limit = 25, p_offset = 0 }: any) => {
    requirePermission('purchasing.view');
    const view = p_view as PurchaseQueueView;
    if (!['open','receiving','history'].includes(view) || !Number.isInteger(p_limit) || p_limit < 1 || p_limit > 50 || !Number.isInteger(p_offset) || p_offset < 0) throw new Error('Invalid purchase page.');
    const query = String(p_query).trim().toLowerCase();
    if (query.length > 160) throw new Error('Search is too long.');
    const requests = db.purchase_requests.filter(row => row.status !== 'draft').map(row => ({
      ...row,
      purchase_request_items: embeds.purchase_request_items(row, '').map((item: Row) => {
        const next = { ...item };
        if (!can('purchasing.cost.view')) delete next.actual_cost;
        return next;
      }),
    })) as PurchaseRequest[];
    const matching = requests.filter(row => [
      row.request_no, row.purpose, row.notes, row.needed_for_date,
      ...(row.purchase_request_items ?? []).flatMap(item => [item.item_name, item.supplier, item.note]),
    ].filter(Boolean).join(' ').toLowerCase().includes(query));
    const isReceiving = (row: PurchaseRequest) => row.status !== 'cancelled' && (row.purchase_request_items ?? []).some(awaitingDelivery);
    const filtered = matching.filter(row => view === 'open' ? requestProgress(row).open : view === 'receiving' ? isReceiving(row) : !requestProgress(row).open);
    filtered.sort((a,b) => (view === 'history' ? b.needed_for_date.localeCompare(a.needed_for_date) : a.needed_for_date.localeCompare(b.needed_for_date)) || a.id.localeCompare(b.id));
    return {
      requests: filtered.slice(p_offset, p_offset + p_limit), total: filtered.length,
      counts: { open: matching.filter(row => requestProgress(row).open).length, receiving: matching.filter(isReceiving).length, history: matching.filter(row => !requestProgress(row).open).length },
    };
  },
  save_delivery_draft: (args: any) => {
    requirePermission('purchasing.receive');
    const fail = (message: string, code = 'P0001'): never => { throw Object.assign(new Error(message), { code }); };
    if (!args.p_id || !args.p_request_id || !args.p_operation_id || !Number.isInteger(args.p_expected_version) || args.p_expected_version < 0) fail('Reopen the delivery before saving.');
    if (!Array.isArray(args.p_items) || !args.p_items.length || args.p_items.length > 250) fail('Review between 1 and 250 items.');
    const payload = JSON.stringify(args);
    db.operation_requests ??= []; db.delivery_drafts ??= [];
    const previous = db.operation_requests.find(row => row.actor_id === currentUserIdRef.value && row.operation === 'save_delivery_draft' && row.request_id === args.p_operation_id);
    if (previous) {
      if (previous.payload !== payload) fail('This draft save was already used for different details.');
      return structuredClone(db.audit_logs.find(row => row.id === previous.result_id)!.after_json);
    }
    const draft = db.delivery_drafts.find(row => row.id === args.p_id);
    if (draft ? draft.request_id !== args.p_request_id || draft.status !== 'draft' || draft.version !== args.p_expected_version : args.p_expected_version !== 0) fail('This draft changed on another device. Reopen it before editing.', '40001');
    const request = db.purchase_requests.find(row => row.id === args.p_request_id);
    if (!request || !['submitted','buying','completed'].includes(request.status)) fail('This request is not open for receiving.', '40001');
    if (new Set(args.p_items.map((row: Row) => row.item_id)).size !== args.p_items.length) fail('Include each purchase item once.');
    const catalogue = loadLocalIngredientItems();
    const items = args.p_items.map((line: Row) => {
      const item = db.purchase_request_items.find(row => row.id === line.item_id);
      if (!item || item.request_id !== args.p_request_id || item.purchase_status !== 'bought' || item.updated_at !== line.expected_updated_at) fail('A purchase changed. Reopen the delivery before reviewing.', '40001');
      const received = Math.round((db.purchase_receipts ?? []).filter(row => row.purchase_item_id === line.item_id).reduce((sum, row) => sum + Number(row.purchase_quantity), 0) * 100) / 100;
      if (received !== line.expected_received_quantity) fail('Another delivery was recorded. Reopen and check the remaining quantity.', '40001');
      const ingredient = catalogue.find(row => row.id === line.ingredient_id && row.active);
      if (!ingredient || ingredient.base_unit !== line.expected_base_unit) fail('The inventory item or unit changed. Reopen the delivery.', '40001');
      if(line.ingredient_version && ingredient!.updated_at!==line.ingredient_version)fail('The inventory item changed. Reopen the delivery.','40001');
      const issue = deliveryLineError(item!.unit, ingredient!.base_unit, line.quantity, line.base_per_unit, Number(item!.purchased_quantity) - received,kitchenFractional(ingredient!),2,line.measured_pieces);
      if (issue) fail(deliveryErrorLabels[issue][0]);
      return { item_id: item!.id, ingredient_id: ingredient!.id, quantity: line.quantity, base_per_unit: line.base_per_unit, measured_pieces: line.measured_pieces,
        expected_updated_at: item!.updated_at, expected_received_quantity: received, expected_base_unit: ingredient!.base_unit, ingredient_version: ingredient!.updated_at,
        purchase_name: item!.item_name, purchase_unit: item!.unit, ingredient_name: ingredient!.name,display_unit:ingredient!.kitchen_unit,display_factor:ingredient!.kitchen_factor };
    });
    const before = draft ? structuredClone(draft) : null;
    const who = db.profiles.find(row => row.id === currentUserIdRef.value)?.full_name ?? null;
    const now = new Date().toISOString();
    const next: Row = { ...(draft ?? { id: args.p_id, request_id: args.p_request_id, request_no: request!.request_no, status: 'draft', created_by: currentUserIdRef.value,
      created_by_name: who, created_at: now, confirmed_record: null, cancelled_reason: null }),
      items, version: (draft?.version ?? 0) + 1, updated_by: currentUserIdRef.value, updated_by_name: who, updated_at: now };
    if (draft) Object.assign(draft, next); else db.delivery_drafts.push(next);
    const audit = { id: uid(), actor_id: currentUserIdRef.value, action: 'delivery_draft_saved', entity_type: 'delivery_draft', entity_id: next.id, before_json: before, after_json: structuredClone(next), created_at: now };
    db.audit_logs.push(audit);
    db.operation_requests.push({ actor_id: currentUserIdRef.value, operation: 'save_delivery_draft', request_id: args.p_operation_id, payload, result_id: audit.id });
    return structuredClone(next);
  },
  confirm_delivery_draft: ({ p_id, p_expected_version }: any) => {
    requirePermission('purchasing.receive');
    const draft = (db.delivery_drafts ?? []).find(row => row.id === p_id);
    if (!draft) throw new Error('Delivery draft not found.');
    if (draft.status === 'confirmed') return structuredClone(draft.confirmed_record);
    if (draft.status !== 'draft' || draft.version !== p_expected_version) throw Object.assign(new Error('This draft changed on another device. Reopen it before confirming.'), { code: '40001' });
    const before = structuredClone(draft);
    const result = rpcHandlers.receive_purchase_batch_checked({ p_request_id: draft.request_id, p_items: draft.items, p_operation_id: draft.id });
    Object.assign(draft, { status: 'confirmed', confirmed_record: structuredClone(result), version: draft.version + 1, updated_at: new Date().toISOString(), updated_by: currentUserIdRef.value, updated_by_name: db.profiles.find(row => row.id === currentUserIdRef.value)?.full_name ?? null });
    db.audit_logs.push({ id: uid(), actor_id: currentUserIdRef.value, action: 'delivery_draft_confirmed', entity_type: 'delivery_draft', entity_id: draft.id, before_json: before, after_json: structuredClone(result), created_at: draft.updated_at });
    return result;
  },
  cancel_delivery_draft: ({ p_id, p_expected_version, p_reason }: any) => {
    requirePermission('purchasing.receive');
    if (!p_reason?.trim() || p_reason.length > 300) throw Object.assign(new Error('Enter a cancellation reason (up to 300 characters).'), { code: 'P0001' });
    const draft = (db.delivery_drafts ?? []).find(row => row.id === p_id);
    if (!draft) throw new Error('Delivery draft not found.');
    if (draft.status === 'cancelled' && draft.cancelled_reason === p_reason.trim()) return null;
    if (draft.status !== 'draft' || draft.version !== p_expected_version) throw Object.assign(new Error('This draft changed on another device. Reopen it.'), { code: '40001' });
    const before = structuredClone(draft);
    Object.assign(draft, { status: 'cancelled', cancelled_reason: p_reason.trim(), version: draft.version + 1, updated_at: new Date().toISOString(), updated_by: currentUserIdRef.value, updated_by_name: db.profiles.find(row => row.id === currentUserIdRef.value)?.full_name ?? null });
    db.audit_logs.push({ id: uid(), actor_id: currentUserIdRef.value, action: 'delivery_draft_cancelled', entity_type: 'delivery_draft', entity_id: draft.id, before_json: before, after_json: { reason: draft.cancelled_reason }, created_at: draft.updated_at });
    return null;
  },
  read_delivery_drafts: ({ p_limit = 10, p_offset = 0 }: any) => {
    requirePermission('purchasing.view');
    if (!Number.isInteger(p_limit) || p_limit < 1 || p_limit > 50 || !Number.isInteger(p_offset) || p_offset < 0) throw new Error('Invalid draft page.');
    const all = (db.delivery_drafts ?? []).filter(row => row.status === 'draft').sort((a, b) => a.updated_at.localeCompare(b.updated_at) || a.id.localeCompare(b.id));
    return { total: all.length, drafts: all.slice(p_offset, p_offset + p_limit).map(row => ({ id: row.id, request_id: row.request_id, request_no: row.request_no, version: row.version,
      created_by_name: row.created_by_name, created_at: row.created_at, updated_by_name: row.updated_by_name, updated_at: row.updated_at, item_count: row.items.length })) };
  },
  read_delivery_draft: ({ p_id }: any) => {
    requirePermission('purchasing.view');
    const draft = (db.delivery_drafts ?? []).find(row => row.id === p_id);
    if (!draft) throw new Error('Delivery draft not found.');
    const request = db.purchase_requests.find(row => row.id === draft.request_id)!;
    return { draft: structuredClone(draft), request: { ...structuredClone(request), purchase_request_items: embeds.purchase_request_items(request, '').map((row: Row) => {
      const result = structuredClone(row); if (!can('purchasing.cost.view')) delete result.actual_cost; return result;
    }) } };
  },
  receive_purchase_batch_checked: (args: any) => {
    requirePermission('purchasing.receive');
    const lines: Row[] = args.p_items;
    if (!args.p_request_id || !args.p_operation_id) throw new Error('A request and confirmation ID are required.');
    if (!Array.isArray(lines) || !lines.length || lines.length > 250) throw new Error('Confirm between 1 and 250 delivery items.');
    if (lines.some(line => !line?.item_id || !line.ingredient_id || !Number.isFinite(line.expected_received_quantity)
      || line.expected_received_quantity < 0 || !['g', 'ml', 'unit'].includes(line.expected_base_unit))) {
      throw Object.assign(new Error('Reopen the delivery to load its latest details.'), { code: '40001' });
    }
    if (new Set(lines.map(line => line.item_id)).size !== lines.length) throw new Error('Receive each purchase item once per confirmation. Different pack sizes need separate deliveries.');
    const payload = JSON.stringify({ request: args.p_request_id, items: lines });
    db.operation_requests ??= [];
    db.purchase_receipts ??= [];
    const previous = db.operation_requests.find(row => row.actor_id === currentUserIdRef.value && row.operation === 'receive_purchase_batch' && row.request_id === args.p_operation_id);
    if (previous) {
      if (previous.payload !== payload) throw new Error('This delivery was already confirmed with different details.');
      const evidence = db.audit_logs.find(row => row.id === previous.result_id);
      if (!evidence) throw new Error('The saved delivery record could not be found.');
      return structuredClone(evidence.after_json);
    }
    const request = db.purchase_requests.find(row => row.id === args.p_request_id);
    if (!request || !['submitted', 'buying', 'completed'].includes(request.status)) throw Object.assign(new Error('This request is not open for receiving.'), { code: '40001' });
    const ingredients = loadLocalIngredientItems();
    for (const line of lines) {
      const item = db.purchase_request_items.find(row => row.id === line.item_id);
      if (!item || item.request_id !== request.id || item.purchase_status !== 'bought' || (item.updated_at ?? null) !== (line.expected_updated_at ?? null)) {
        throw Object.assign(new Error('A purchase changed on another device. No stock was added. Reopen the delivery.'), { code: '40001' });
      }
      const received = Math.round(db.purchase_receipts.filter(row => row.purchase_item_id === item.id).reduce((sum, row) => sum + Number(row.purchase_quantity), 0) * 100) / 100;
      if (received !== line.expected_received_quantity) throw Object.assign(new Error('Another delivery was recorded. No stock was added by this confirmation. Reopen and check what is still outstanding.'), { code: '40001' });
      const ingredient = ingredients.find(row => row.id === line.ingredient_id);
      if (!ingredient) throw new Error('Choose an active inventory item for every delivery.');
      if (ingredient.base_unit !== line.expected_base_unit) throw Object.assign(new Error('The inventory unit changed. No stock was added. Reopen the delivery.'), { code: '40001' });
      if(line.ingredient_version && ingredient.updated_at!==line.ingredient_version)throw Object.assign(new Error('The inventory item changed. Reopen the delivery.'),{code:'40001'});
      const issue = deliveryLineError(item.unit, ingredient.base_unit, line.quantity, line.base_per_unit, Math.round((Number(item.purchased_quantity) - received) * 100) / 100,kitchenFractional(ingredient),2,line.measured_pieces);
      if (issue) throw Object.assign(new Error(deliveryErrorLabels[issue][0]), { code: 'P0001' });
    }
    const receiptCount = db.purchase_receipts.length;
    const auditCount = db.audit_logs.length;
    const operationCount = db.operation_requests.length;
    try {
      return withLocalIngredientRollback(() => {
        const receipts = lines.map(line => rpcHandlers.receive_purchase_item({ p_item_id: line.item_id, p_ingredient_id: line.ingredient_id,
          p_quantity: line.quantity, p_base_per_unit: line.base_per_unit, p_measured_pieces: line.measured_pieces, p_request_id: uid(), p_expected_updated_at: line.expected_updated_at }));
        const record = { id: uid(), request_id: request.id, request_no: request.request_no, confirmed_at: new Date().toISOString(),
          confirmed_by: currentUserIdRef.value, confirmed_by_name: db.profiles.find(row => row.id === currentUserIdRef.value)?.full_name ?? null, receipts };
        db.audit_logs.push({ id: record.id, actor_id: currentUserIdRef.value, action: 'receive_purchase_batch', entity_type: 'purchase_request', entity_id: request.id,
          after_json: structuredClone(record), created_at: record.confirmed_at });
        db.operation_requests.push({ actor_id: currentUserIdRef.value, operation: 'receive_purchase_batch', request_id: args.p_operation_id, payload, result_id: record.id });
        return record;
      });
    } catch (failure) {
      db.purchase_receipts.length = receiptCount; db.audit_logs.length = auditCount; db.operation_requests.length = operationCount;
      throw failure;
    }
  },
  receive_purchase_item: (args: any) => {
    requirePermission('purchasing.receive');
    const item = db.purchase_request_items.find(row => row.id === args.p_item_id);
    const ingredient = loadLocalIngredientItems().find(row => row.id === args.p_ingredient_id);
    db.purchase_receipts ??= [];
    const base = deliveredStockQuantity({quantity:args.p_quantity,base_per_unit:args.p_base_per_unit,measured_pieces:args.p_measured_pieces});
    const previous = db.purchase_receipts.find(row => row.request_id === args.p_request_id && row.received_by === currentUserIdRef.value);
    if (previous) {
      if (previous.purchase_item_id !== args.p_item_id || previous.ingredient_id !== args.p_ingredient_id || previous.purchase_quantity !== args.p_quantity || previous.base_quantity !== base || previous.base_per_unit !== args.p_base_per_unit) throw new Error('This receipt has already been saved with different details.');
      return previous;
    }
    if (!item || item.purchase_status !== 'bought' || !ingredient) throw new Error('Choose a bought item and an inventory ingredient.');
    if (!ingredient.active || ['draft','cancelled'].includes(db.purchase_requests.find(row => row.id === item.request_id)?.status)) throw new Error('This request cannot receive stock.');
    const received = Math.round(db.purchase_receipts.filter(row => row.purchase_item_id === item.id).reduce((sum,row) => sum + Number(row.purchase_quantity), 0) * 100) / 100;
    const issue=deliveryLineError(item.unit,ingredient.base_unit,args.p_quantity,args.p_base_per_unit,item.purchased_quantity-received,kitchenFractional(ingredient),2,args.p_measured_pieces);
    if(issue)throw new Error(deliveryErrorLabels[issue][0]);
    if (Math.abs(args.p_quantity * 100 - Math.round(args.p_quantity * 100)) > 1e-8) throw new Error('Received quantity supports up to two decimal places.');
    if (base <= 0 || (ingredient.base_unit === 'unit' && !kitchenFractional(ingredient) && !Number.isInteger(base))) throw new Error('Individual items must be received in whole units.');
    stockInLocalIngredient({ ingredientId: ingredient.id, inputQuantity: base, unitType: 'base', enteredBy: db.profiles.find(row => row.id === currentUserIdRef.value)?.full_name, notes: 'Practice purchase receipt' });
    const receipt = {id:uid(), purchase_item_id:item.id, ingredient_id:ingredient.id, request_id:args.p_request_id, purchase_quantity:args.p_quantity, base_quantity:base, base_unit:ingredient.base_unit, received_by:currentUserIdRef.value, received_at:new Date().toISOString(),
      ingredient_name:ingredient.name, purchase_unit:item.unit, base_per_unit:args.p_base_per_unit,measured_pieces:args.p_measured_pieces,display_unit:ingredient.kitchen_unit,display_factor:ingredient.kitchen_factor,
      received_by_name:db.profiles.find(row => row.id === currentUserIdRef.value)?.full_name ?? null, details_backfilled:false };
    db.purchase_receipts.push(receipt);
    return receipt;
  },
  submit_purchase_request_checked: (args: any) => {
    requirePermission('kitchen.request.submit');
    const request = db.purchase_requests.find(row => row.id === args.p_request_id);
    if (!request) throw new Error('Request not found.');
    db.operation_requests ??= [];
    const expected = args.p_expected_updated_at ?? null;
    const previous = db.operation_requests.find(row => row.actor_id === currentUserIdRef.value && row.operation === 'submit_purchase_request' && row.request_id === request.id);
    if (previous && previous.expected === expected && ['submitted','buying','completed'].includes(request.status)) return request;
    if ((request.updated_at ?? null) !== expected || request.status !== 'draft') throw new Error('The request changed. Reopen it and check the updated details before confirming.');
    const items = db.purchase_request_items.filter(row => row.request_id === request.id);
    if (!items.length || items.some(row => !row.item_name?.trim() || !row.unit?.trim() || !Number.isFinite(Number(row.quantity)) || Number(row.quantity) <= 0)) throw new Error('Every item needs a name, unit and quantity greater than zero before sending.');
    const result = rpcHandlers.submit_purchase_request(args);
    request.submitted_by = currentUserIdRef.value;
    request.submitted_by_name = db.profiles.find(row => row.id === currentUserIdRef.value)?.full_name ?? null;
    request.updated_at = new Date(Math.max(Date.now(), (Date.parse(request.updated_at) || 0) + 1)).toISOString();
    db.operation_requests.push({ actor_id: currentUserIdRef.value, operation: 'submit_purchase_request', request_id: request.id, expected, result_id: request.id });
    db.audit_logs.push({ id: uid(), actor_id: currentUserIdRef.value, action: 'submit_purchase_request', entity_type: 'purchase_request', entity_id: request.id, after_json: structuredClone({ request, items }), created_at: request.submitted_at });
    return result;
  },
  set_purchase_item_status_checked: (args: any) => {
    requirePermission('purchasing.fulfil');
    const item = db.purchase_request_items.find(row => row.id === args.p_item_id);
    if (!item || item.updated_at !== args.p_expected_updated_at) throw Object.assign(new Error('Item changed on another device. Reload before editing.'), {code:'40001'});
    const parent = db.purchase_requests.find(row=>row.id===item.request_id);
    if(!parent||!['submitted','buying','completed'].includes(parent.status))throw Object.assign(new Error('Request is no longer available.'),{code:'40001'});
    if ((item.purchase_status==='bought'&&Number(item.purchased_quantity)>0)||(db.purchase_receipts??[]).some(row=>row.purchase_item_id===item.id)) throw new Error('Recorded purchases cannot be cleared. The outstanding quantity stays open.');
    if (db.audit_logs.some(row=>row.action==='record_purchase_batch'&&row.entity_id===parent.id&&row.after_json?.items?.some((line:Row)=>line.id===item.id)))throw new Error('Recorded purchases cannot be cleared. The outstanding quantity stays open.');
    if (!['pending','unavailable'].includes(args.p_status)) throw new Error('Use Record Purchases and attach both photos.');
    if(args.p_purchased_quantity!=null||args.p_actual_cost!=null)throw new Error('Availability changes cannot record quantities or costs.');
    const before=structuredClone(item);
    const result=rpcHandlers.set_purchase_item_status({...args,p_item_ids:[args.p_item_id]});
    db.audit_logs.push({id:uid(),actor_id:currentUserIdRef.value,action:'purchase_availability',entity_type:'purchase_request_item',entity_id:item.id,before_json:before,after_json:structuredClone(item),created_at:new Date().toISOString()});
    return result;
  },
  save_purchase_request: ({ p_request, p_items }: any) => {
    const isNew = !p_request.id;
    if (isNew) requirePermission('kitchen.request.create');
    let request = isNew ? null : db.purchase_requests.find((row) => row.id === p_request.id);
    if (!isNew && !request) throw new Error('Request not found.');
    if (!isNew) {
      const mine = request!.requested_by === currentUserIdRef.value && request!.status === 'draft';
      if (!can('kitchen.manage') && !mine) throw new Error('You cannot edit this request.');
    }
    db.operation_requests ??= [];
    const payload = JSON.stringify({ p_request, p_items });
    const previous = p_request._request_id && db.operation_requests.find(row => row.actor_id === currentUserIdRef.value && row.operation === 'save_purchase_request' && row.request_id === p_request._request_id);
    if (previous) {
      if (previous.payload !== payload) throw new Error('This saved request has changed. Reload it before saving again.');
      return previous.result_id;
    }
    if (request && (request.updated_at ?? null) !== (p_request._expected_updated_at ?? null)) throw new Error('Someone changed this record. Reload it before saving your changes.');
    if (!Array.isArray(p_items) || !p_items.length || p_items.some(item => !item.item_name?.trim() || !item.unit?.trim() || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) < 0 || Math.abs(Number(item.quantity) * 100 - Math.round(Number(item.quantity) * 100)) > 1e-8)) throw new Error('Check each item name, unit and quantity (zero or greater, up to two decimal places).');
    if (!Number.isInteger(Number(p_request.pax_count)) || Number(p_request.pax_count) < 0) throw new Error('Enter a whole pax count of zero or greater.');
    if (p_items.some(item => item.id && !db.purchase_request_items.some(row => row.id === item.id && row.request_id === request?.id))) throw new Error('Request item not found. Reopen the request.');
    const itemIds = p_items.filter(item => item.id).map(item => item.id);
    if (new Set(itemIds).size !== itemIds.length) throw new Error('A request item was included more than once.');

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
      updated_at: new Date(Math.max(Date.now(), (Date.parse(request!.updated_at) || 0) + 1)).toISOString(),
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
        updated_at: request!.updated_at,
      });
      keep.push(row.id);
    });
    if (keep.length === 0) throw new Error('Add at least one item to the request.');
    db.purchase_request_items = db.purchase_request_items.filter(
      (row) => row.request_id !== request!.id || keep.includes(row.id),
    );
    db.audit_logs.push({ id: uid(), actor_id: currentUserIdRef.value, action: 'save_purchase_request', entity_type: 'purchase_request', entity_id: request!.id, created_at: request!.updated_at,
      after_json: structuredClone({ request, items: db.purchase_request_items.filter(row => row.request_id === request!.id), saved_by_name: db.profiles.find(row => row.id === currentUserIdRef.value)?.full_name ?? null }) });
    if (p_request._request_id) db.operation_requests.push({ actor_id: currentUserIdRef.value, operation: 'save_purchase_request', request_id: p_request._request_id, payload, result_id: request!.id });
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
        const clearing = args.p_status !== 'bought';
        row.purchased_quantity = clearing ? null : args.p_purchased_quantity ?? row.quantity;
        row.actual_cost = clearing ? null : args.p_actual_cost === null ? null : args.p_actual_cost ?? row.actual_cost;
        row.supplier = clearing ? null : args.p_supplier ?? row.supplier;
        row.purchase_note = args.p_note ?? null;
        row.purchased_by = clearing ? null : currentUserIdRef.value;
        row.purchased_at = clearing ? null : new Date().toISOString();
        row.updated_at = new Date(Math.max(Date.now(), (Date.parse(row.updated_at) || 0) + 1)).toISOString();
        count += 1;
      });

    const touched = new Set(
      db.purchase_request_items.filter((row) => ids.includes(row.id)).map((row) => row.request_id),
    );
    touched.forEach((requestId) => {
      const request = db.purchase_requests.find((row) => row.id === requestId);
      if (!request || !['submitted', 'buying', 'completed'].includes(request.status)) return;
      const outstanding = db.purchase_request_items.some(
        (row) => row.request_id === requestId && remainingToBuy(row as PurchaseRequestItem) > 0,
      );
      request.status = outstanding ? 'buying' : 'completed';
      request.completed_at = outstanding ? null : new Date().toISOString();
      request.updated_at = new Date(Math.max(Date.now(), (Date.parse(request.updated_at) || 0) + 1)).toISOString();
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
    syncDemoBoatTrips();
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
    if(trip?.auto_generated) throw new Error('Scheduled trips are maintained from the boat board.');
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
    if(db.boat_trips.some(t=>t.id===p_id&&t.auto_generated)) throw new Error('Scheduled trips are maintained from the boat board.');
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
      const trips = db.boat_trips.filter((row) => isActualTrip(row) && row.boat_id === boat.id && inRange(row.service_date));
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
    const trips = db.boat_trips.filter((row) => isActualTrip(row) && inRange(row.service_date));
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
      const purchasing = rpcHandlers.read_purchasing_queue({ p_view: 'open' });
      push('purchasing', purchasing.total, 'request(s) awaiting purchase or delivery');
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
        infants: bookings.reduce((s, b) => s + (b.pax_infants ?? 0), 0),
        tour_leaders: bookings.reduce((s, b) => s + (b.pax_tour_leaders ?? 0), 0),
        tour_guides: bookings.reduce((s, b) => s + (b.pax_tour_guides ?? 0), 0),
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
      trips: db.boat_trips.filter((t) => isActualTrip(t) && t.service_date === p_service_date).map((t) => ({
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
      pickup_latitude: p_booking.pickup_latitude === '' || p_booking.pickup_latitude == null ? null : Number(p_booking.pickup_latitude),
      pickup_longitude: p_booking.pickup_longitude === '' || p_booking.pickup_longitude == null ? null : Number(p_booking.pickup_longitude),
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
      if (tourist.name_pending && tourist.full_name !== person.full_name.trim()) tourist.name_pending = false;
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

  assign_booking_to_boat_checked: (p: any) => {
    requirePermission('fleet.assign');
    const booking=db.bookings.find(b=>b.id===p.p_booking_id);
    const source=db.trip_bookings.find(b=>b.booking_id===p.p_booking_id)?.assignment_id??null;
    if(!booking)throw new Error('Booking not found.');
    if(source!==p.p_expected_assignment_id || booking.pax_total!==p.p_expected_pax)throw new Error('This group changed on another device. Refresh the boat board.');
    if(source===p.p_assignment_id)return null;
    if(db.trip_passengers.some(g=>g.booking_id===p.p_booking_id&&(g.boarding_status!=='pending'||g.activity_code||g.activity_status!=='pending'||g.returned)))throw new Error('Attendance is already recorded for this group. Review its attendance before changing boats.');
    if(source && db.boat_assignments.find(a=>a.id===source)?.locked)throw new Error('This day is locked.');
    const target=db.boat_assignments.find(a=>a.id===p.p_assignment_id);
    if(target && (target.service_date!==booking.service_date || target.status==='cancelled' || db.boats.find(b=>b.id===target.boat_id)?.status!=='active'))throw new Error('This boat is unavailable for the booking date.');
    return p.p_assignment_id?rpcHandlers.assign_booking_to_boat(p):rpcHandlers.unassign_booking(p);
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
    const freeSeats = Math.min(43,boat.capacity_pax) - seated - demoStaffPax(assignment) - (booking.guide_employee_id && ![assignment.captain_employee_id,assignment.guide_employee_id,...(assignment.crew_employee_ids??[]),...db.trip_bookings.filter(t=>t.assignment_id===assignment.id).map(t=>db.bookings.find(b=>b.id===t.booking_id)?.guide_employee_id)].includes(booking.guide_employee_id) ? 1 : 0);
    if (booking.pax_total > freeSeats) {
      throw new Error(
        `${boat.code} only has ${Math.max(freeSeats, 0)} passenger seat(s) left after reserving staff seats; this group is ${booking.pax_total} pax.`,
      );
    }
    db.trip_passengers = db.trip_passengers.filter((row) => row.booking_id !== p_booking_id);
    db.trip_bookings = db.trip_bookings.filter((row) => row.booking_id !== p_booking_id);
    db.trip_bookings.push({ id: uid(), assignment_id: p_assignment_id, booking_id: p_booking_id, assigned_at: new Date().toISOString() });
    syncPassengers(p_assignment_id, p_booking_id);
    return null;
  },

  auto_seat_boats: ({ p_service_date }: any) => {
    requirePermission('fleet.assign');
    if (db.boat_assignments.some((row) => row.service_date === p_service_date && row.locked)) {
      throw new Error('This day is locked. Unlock it before seating boats.');
    }
    rpcHandlers.ensure_boat_assignments({ p_service_date });

    const seatedOn = (assignmentId: string) =>
      db.trip_bookings
        .filter((row) => row.assignment_id === assignmentId)
        .reduce((sum, row) => sum + (db.bookings.find((b) => b.id === row.booking_id)?.pax_total ?? 0), 0);

    let seated = 0;
    db.bookings
      .filter(
        (b) =>
          b.service_date === p_service_date &&
          b.status !== 'cancelled' &&
          b.pax_total > 0 &&
          !db.trip_bookings.some((row) => row.booking_id === b.id),
      )
      // Biggest group first: the hardest to place goes while there is still
      // room to place it.
      .sort((a, b) => b.pax_total - a.pax_total)
      .forEach((booking) => {
        // Best fit: the fullest boat this group still fits on, so the big
        // boat stays free for the big family.
        const target = db.boat_assignments
          .filter((a) => a.service_date === p_service_date && !a.locked && a.status !== 'cancelled')
          .map((a) => ({ a, boat: db.boats.find((x) => x.id === a.boat_id)!, left: 0 }))
          .filter((row) => row.boat && row.boat.status === 'active' && row.boat.capacity_pax > 0)
          .map((row) => ({ ...row, left: Math.min(43,row.boat.capacity_pax) - seatedOn(row.a.id) - demoStaffPax(row.a) - (booking.guide_employee_id ? 1 : 0) }))
          .filter((row) => row.left >= booking.pax_total)
          .sort((x, y) => x.left - y.left || (x.boat.sort_order ?? 0) - (y.boat.sort_order ?? 0))[0];
        // Nothing holds the whole group: leave it in the pool rather than
        // splitting a family.
        if (!target) return;
        db.trip_bookings.push({
          id: uid(),
          assignment_id: target.a.id,
          booking_id: booking.id,
          assigned_at: new Date().toISOString(),
        });
        syncPassengers(target.a.id, booking.id);
        seated += 1;
      });
    return seated;
  },

  copy_previous_crew: ({ p_service_date }: any) => {
    requirePermission('fleet.assign');
    // The most recent earlier day that actually had crew, so a quiet day
    // does not wipe the pattern.
    const source = db.boat_assignments
      .filter((a) => a.service_date < p_service_date && (a.captain_employee_id || a.guide_employee_id))
      .map((a) => a.service_date)
      .sort()
      .pop();
    if (!source) return 0;
    rpcHandlers.ensure_boat_assignments({ p_service_date });

    let filled = 0;
    db.boat_assignments
      .filter((a) => a.service_date === p_service_date && !a.locked)
      .forEach((today) => {
        if (today.captain_employee_id && today.guide_employee_id) return;
        const prev = db.boat_assignments.find(
          (a) => a.service_date === source && a.boat_id === today.boat_id && a.trip_no === today.trip_no,
        );
        if (!prev || (!prev.captain_employee_id && !prev.guide_employee_id)) return;
        // Only fills blanks: a crew already chosen for today is kept.
        today.captain_employee_id = today.captain_employee_id ?? prev.captain_employee_id;
        today.guide_employee_id = today.guide_employee_id ?? prev.guide_employee_id;
        filled += 1;
      });
    return filled;
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

  set_trip_crew_checked: (p: any) => {
    requirePermission('fleet.crew.assign');
    const trip=db.boat_assignments.find(a=>a.id===p.p_assignment_id);
    if(!trip)throw new Error('That boat trip does not exist.');
    const expected=p.p_expected;
    if(!expected || trip.captain_employee_id!==expected.captain || trip.guide_employee_id!==expected.guide || (trip.departure_time?.slice(0,5)||null)!==expected.departure)throw new Error('Crew changed on another device. Close this form and review the latest crew.');
    if(trip.locked)throw new Error('Unlock the day before changing the crew.');
    if(p.p_captain && !db.employees.some(e=>e.id===p.p_captain && e.active && e.job_type==='captain'))throw new Error('Choose an active captain.');
    if(p.p_guide && !db.employees.some(e=>e.id===p.p_guide && e.active && e.job_type==='guide'))throw new Error('Choose an active guide.');
    if(p.p_departure && !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(p.p_departure))throw new Error('Enter a valid departure time.');
    trip.captain_employee_id=p.p_captain;trip.guide_employee_id=p.p_guide;trip.departure_time=p.p_departure;
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





  record_staff_attendance_checked: (p: any) => {
    const permission = {boarding:'boarding.mark',activity:'activities.select',joined:'activities.mark',returned:'activities.mark'}[p.p_action as string];
    if(!permission)throw new Error('Unknown attendance action.');
    requirePermission(permission);
    if(!p.p_date || !p.p_request_id || !Array.isArray(p.p_expected) || !p.p_expected.length)throw new Error('Choose guests and a service date.');
    const payload=JSON.stringify([p.p_date,p.p_action,p.p_value,p.p_expected]);
    db.operation_requests ??=[];
    const previous=db.operation_requests.find(r=>r.actor_id===currentUserIdRef.value && r.operation==='staff_attendance' && r.request_id===p.p_request_id);
    if(previous){if(previous.payload!==payload)throw new Error('This attendance reference was already used.');return previous.count;}
    const ids: string[]=[];
    for(const e of p.p_expected){
      const row=db.trip_passengers.find(r=>r.id===e.id);
      if(!row || !canSeeAssignment(row.assignment_id))throw new Error('You cannot update this guest.');
      if(ids.includes(row.id))throw new Error('A guest cannot appear twice.');
      if(db.boat_assignments.find(a=>a.id===row.assignment_id)?.service_date!==p.p_date)throw new Error('The service date changed. Refresh the list.');
      const state={id:row.id,assignment_id:row.assignment_id,boarding_status:row.boarding_status,activity_code:row.activity_code ?? null,activity_status:row.activity_status,returned:row.returned};
      if(Object.keys(state).some(key=>state[key as keyof typeof state]!==e[key]))throw new Error('Attendance changed on another device. Refresh and check the guest again.');
      if(p.p_action!=='boarding' && row.boarding_status!=='arrived')throw new Error('Check the guest in before recording activity attendance.');
      if(p.p_action==='boarding' && p.p_value!=='arrived' && (row.activity_status==='joined' || row.returned))throw new Error('Correct activity and return attendance before changing check-in.');
      if(p.p_action==='activity' && (row.activity_status==='joined' || row.returned))throw new Error('Correct the existing activity attendance before changing the activity.');
      if(p.p_action==='joined' && p.p_value==='joined' && !row.activity_code)throw new Error('Choose an activity first.');
      ids.push(row.id);
    }
    if(p.p_action==='boarding'){
      if(!['pending','arrived','no_show'].includes(p.p_value))throw new Error('Invalid check-in status.');
      rpcHandlers.mark_boarding({p_passenger_ids:ids,p_status:p.p_value});
    } else if(p.p_action==='activity'){
      if(p.p_value!=null && !db.activity_types.some(t=>t.code===p.p_value && t.active))throw new Error('Unknown activity.');
      rpcHandlers.set_passenger_activity({p_passenger_ids:ids,p_activity_code:p.p_value});
    } else if(p.p_action==='joined'){
      if(!['pending','joined','absent'].includes(p.p_value))throw new Error('Invalid activity attendance status.');
      rpcHandlers.mark_activity_attendance({p_passenger_ids:ids,p_status:p.p_value,p_returned:null});
    } else {
      if(typeof p.p_value!=='boolean')throw new Error('Return attendance must be true or false.');
      rpcHandlers.mark_activity_attendance({p_passenger_ids:ids,p_status:null,p_returned:p.p_value});
    }
    db.operation_requests.push({actor_id:currentUserIdRef.value,operation:'staff_attendance',request_id:p.p_request_id,payload,count:ids.length});
    return ids.length;
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
      syncDemoBoatTrips();
      return new DemoQuery(table);
    },
    rpc(name: string, args: any = {}) {
      const handler = rpcHandlers[name];
      const run = () => {
        if (name === 'receive_purchase_item') return { data: null, error: { message: 'This receiving screen is outdated. Reload before confirming delivery.', code: '42501' } };
        if (!handler) return { data: null, error: { message: `${name} is not available in the demo.` } };
        try {
          ensureSupplyDemo();
          ensureKitchenCatalogue();
          syncDemoBoatTrips();
          guardDemoGuestWrite(name,args);
          const data = filterDemoGuestResult(name,args,handler(args));
          syncDemoBoatTrips();
          persistDemoDb();
          return { data, error: null };
        } catch (error) {
          return { data: null, error: { message: (error as Error).message, code: (error as Error & { code?: string }).code } };
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
