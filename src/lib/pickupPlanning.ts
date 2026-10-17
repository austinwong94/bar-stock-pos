import type { Booking, PickupLocation, PickupRun, TransportVehicle } from './platformTypes';

export type PickupBoard = { bookings: Booking[]; runs: PickupRun[]; vehicles: TransportVehicle[]; locations: PickupLocation[]; version: string };
export type PickupDraftGroup = { key: string; runId: string | null; vehicle: TransportVehicle; existing: Booking[]; bookings: Booking[] };
export const pickupPax = (rows: Booking[]) => rows.reduce((sum, row) => sum + row.pax_total, 0);
export const pickupName = (row: Booking) => row.pickup_hotel_name?.trim() || row.pickup_area?.trim() || 'Location Not Recorded';
export const hasPickupPoint = (row: Booking) => validPoint(row.pickup_latitude, row.pickup_longitude);

function validPoint(lat: number | null | undefined, lng: number | null | undefined) {
  return lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

// Shared with the existing pickup route ordering. This is not road distance.
export function distanceKm(lat1: number | null | undefined, lon1: number | null | undefined, lat2: number | null | undefined, lon2: number | null | undefined): number | null {
  if (!validPoint(lat1, lon1) || !validPoint(lat2, lon2)) return null;
  const rad = (value: number) => value * Math.PI / 180;
  const a = Math.sin(rad(lat2! - lat1!) / 2) ** 2 + Math.cos(rad(lat1!)) * Math.cos(rad(lat2!)) * Math.sin(rad(lon2! - lon1!) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}
export const pickupDistance = (a: Booking, b: Booking) => distanceKm(a.pickup_latitude, a.pickup_longitude, b.pickup_latitude, b.pickup_longitude);
export function pickupStops(rows: Booking[]) {
  const stops = new Map<string, Booking[]>();
  for (const row of rows) {
    const key = hasPickupPoint(row) ? `${row.pickup_latitude},${row.pickup_longitude}:${pickupName(row).toLowerCase()}` : `unknown:${row.id}`;
    stops.set(key, [...(stops.get(key) ?? []), row]);
  }
  return [...stops.values()];
}
export const distanceLabel = (km: number) => km < 0.1 ? '<0.1 km' : `${km.toFixed(1)} km`;
export function groupSpread(rows: Booking[]): number | null {
  if (rows.some(row => !hasPickupPoint(row))) return null;
  return Math.max(0, ...rows.flatMap((a, i) => rows.slice(i + 1).map(b => pickupDistance(a, b)!)));
}
export function mapUrl(row: Booking) {
  const query = hasPickupPoint(row) ? `${row.pickup_latitude},${row.pickup_longitude}` : [row.pickup_hotel_name, row.pickup_area].filter(Boolean).join(', ');
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null;
}

export function pickupTargets(board: PickupBoard, selected: string[]) {
  return board.vehicles.filter(vehicle => vehicle.active && vehicle.capacity_pax > 0 && selected.includes(vehicle.id)).flatMap(vehicle => {
    const runs = board.runs.filter(run => run.vehicle_id === vehicle.id && run.status !== 'cancelled');
    if (runs.length > 1 || runs.some(run => run.status !== 'planned')) return [];
    const run = runs[0];
    return [{ key: run?.id ?? `vehicle:${vehicle.id}`, runId: run?.id ?? null, vehicle, existing: board.bookings.filter(b => b.pickup_group_id === run?.id && b.pickup_required), bookings: [] } as PickupDraftGroup];
  });
}

// Conservative nearby-group suggestion, not an optimized driving itinerary.
// Every pair must be within the radius, avoiding a chain of distant stops.
export function suggestPickups(board: PickupBoard, radius: number, selected: string[]) {
  const groups = pickupTargets(board, selected);
  const waiting = board.bookings.filter(b => b.pickup_required && !b.pickup_group_id);
  let pending = waiting.filter(hasPickupPoint).sort((a, b) => b.pax_total - a.pax_total || a.id.localeCompare(b.id));
  for (const booking of pending.slice()) {
    if (!pending.some(b => b.id === booking.id)) continue;
    const occupied = groups.filter(g => g.existing.length || g.bookings.length).filter(g => {
      const rows = [...g.existing, ...g.bookings];
      return pickupPax(rows) + booking.pax_total <= g.vehicle.capacity_pax && rows.every(b => (pickupDistance(booking, b) ?? Infinity) <= radius);
    }).sort((a, b) => groupSpread([...a.existing, ...a.bookings, booking])! - groupSpread([...b.existing, ...b.bookings, booking])!);
    if (occupied[0]) { occupied[0].bookings.push(booking); pending = pending.filter(b => b.id !== booking.id); continue; }
    const free = groups.filter(g => !g.existing.length && !g.bookings.length && g.vehicle.capacity_pax >= booking.pax_total).sort((a, b) => a.vehicle.capacity_pax - b.vehicle.capacity_pax);
    if (!free.length) continue;
    const nearby = [booking];
    for (const other of pending.filter(b => b.id !== booking.id).sort((a, b) => pickupDistance(booking, a)! - pickupDistance(booking, b)!)) {
      if (nearby.every(b => pickupDistance(other, b)! <= radius) && pickupPax(nearby) + other.pax_total <= free[free.length - 1].vehicle.capacity_pax) nearby.push(other);
    }
    const target = free.find(g => g.vehicle.capacity_pax >= pickupPax(nearby))!;
    target.bookings.push(...nearby);
    pending = pending.filter(b => !nearby.some(n => n.id === b.id));
  }
  const assigned = new Set(groups.flatMap(g => g.bookings.map(b => b.id)));
  return { groups, waiting: waiting.filter(b => !assigned.has(b.id)) };
}
