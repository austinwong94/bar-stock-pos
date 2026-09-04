// Seed data for the offline demo build. Dates are generated relative to
// today so the default filters always land on something to look at.
/**
 * Every page asks for dates in Asia/Kuala_Lumpur, so the seed has to agree.
 * Using local time here put the sample day one behind whenever the container
 * ran west of Malaysia, and the boat board opened empty.
 */
function iso(offsetDays: number) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

import { NATIONALITY_FOR, generateDay } from './demoDataset';

export const TODAY = iso(0);
export const YESTERDAY = iso(-1);
export const TOMORROW = iso(1);

export const demoUsers = [
  { id: 'u-master', full_name: 'Austin (Owner)', login_email: 'owner@lovelyparadise.demo', access_role_code: 'master_admin', agency_id: null, is_anonymous: false },
  { id: 'u-coord', full_name: 'Siti — Coordinator', login_email: 'siti@lovelyparadise.demo', access_role_code: 'coordinator', agency_id: null, is_anonymous: false },
  { id: 'u-agent-blue', full_name: 'Danny — Blue Sea Travel', login_email: 'danny@bluesea.demo', access_role_code: 'agent', agency_id: 'ag-blue', is_anonymous: false },
  { id: 'u-agent-red', full_name: 'Rina — Red Coral Tours', login_email: 'rina@redcoral.demo', access_role_code: 'agent', agency_id: 'ag-red', is_anonymous: false },
  { id: 'u-captain', full_name: 'Captain Ali', login_email: 'ali@lovelyparadise.demo', access_role_code: 'captain', agency_id: null, is_anonymous: false },
  { id: 'u-guide', full_name: 'Mei — Tour Guide', login_email: 'mei@lovelyparadise.demo', access_role_code: 'guide', agency_id: null, is_anonymous: false },
  { id: 'u-tablet', full_name: 'Bar Tablet', login_email: null, access_role_code: 'bar_staff', agency_id: null, is_anonymous: true },
  { id: 'u-account', full_name: 'Wendy — Accountant', login_email: 'wendy@lovelyparadise.demo', access_role_code: 'accountant', agency_id: null, is_anonymous: false },
  { id: 'u-cook', full_name: 'Lina — Kitchen', login_email: 'lina@lovelyparadise.demo', access_role_code: 'kitchen_staff', agency_id: null, is_anonymous: false },
  { id: 'u-buyer', full_name: 'Sam — Purchaser', login_email: 'sam@lovelyparadise.demo', access_role_code: 'purchaser', agency_id: null, is_anonymous: false },
  { id: 'u-new', full_name: 'Hakim (just signed up)', login_email: 'hakim@lovelyparadise.demo', access_role_code: 'pending', agency_id: null, is_anonymous: false },
];

export const demoAgencies = [
  { id: 'ag-blue', name: 'Blue Sea Travel', source_type: 'agent', contact_person: 'Danny Lim', contact_phone: '+60 12-330 4411', contact_email: 'danny@bluesea.demo', commission_note: null, active: true },
  { id: 'ag-red', name: 'Red Coral Tours', source_type: 'agent', contact_person: 'Rina Ahmad', contact_phone: '+60 12-887 2200', contact_email: 'rina@redcoral.demo', commission_note: null, active: true },
  { id: 'ag-ota', name: 'Klook', source_type: 'ota', contact_person: null, contact_phone: null, contact_email: null, commission_note: null, active: true },
];

export const demoEmployees = [
  { id: 'em-ali', employee_code: 'C01', full_name: 'Captain Ali', job_type: 'captain', phone: '+60 13-220 8890', profile_id: 'u-captain', active: true, notes: null },
  { id: 'em-rosli', employee_code: 'C02', full_name: 'Captain Rosli', job_type: 'captain', phone: '+60 13-441 7761', profile_id: null, active: true, notes: null },
  { id: 'em-mei', employee_code: 'G01', full_name: 'Guide Mei', job_type: 'guide', phone: '+60 11-220 3390', profile_id: 'u-guide', active: true, notes: null },
  { id: 'em-aina', employee_code: 'G02', full_name: 'Guide Aina', job_type: 'guide', phone: '+60 11-556 1123', profile_id: null, active: true, notes: null },
  { id: 'em-kumar', employee_code: 'D01', full_name: 'Driver Kumar', job_type: 'driver', phone: '+60 16-770 2214', profile_id: null, active: true, notes: null },
];

export const demoBoats = [
  { id: 'bt-1', code: 'Boat 1', name: 'Sea Star', boat_type: 'speedboat', capacity_pax: 14, ownership: 'owned', owner_name: null, registration_no: 'PKB 1120', engine_info: '2 x 115hp', expected_litres_per_trip: 20, status: 'active', status_note: null, sort_order: 1, notes: null },
  { id: 'bt-2', code: 'Boat 2', name: 'Blue Wave', boat_type: 'speedboat', capacity_pax: 14, ownership: 'owned', owner_name: null, registration_no: 'PKB 2240', engine_info: '2 x 90hp', expected_litres_per_trip: 18, status: 'active', status_note: null, sort_order: 2, notes: null },
  { id: 'bt-3', code: 'Boat 3', name: 'Island Hop', boat_type: 'ferry', capacity_pax: 40, ownership: 'owned', owner_name: null, registration_no: 'PKB 3310', engine_info: 'Inboard diesel', expected_litres_per_trip: 38, status: 'active', status_note: null, sort_order: 3, notes: null },
  { id: 'bt-4', code: 'Boat 4', name: 'Partner One', boat_type: 'speedboat', capacity_pax: 20, ownership: 'partner', owner_name: 'Pak Hassan', registration_no: 'PKB 4405', engine_info: '2 x 100hp', expected_litres_per_trip: 22, status: 'maintenance', status_note: 'Under repair', sort_order: 4, notes: null },
  { id: 'bt-5', code: 'Boat 5', name: 'Reef Runner', boat_type: 'ferry', capacity_pax: 30, ownership: 'owned', owner_name: null, registration_no: 'PKB 5500', engine_info: 'Inboard diesel', expected_litres_per_trip: 32, status: 'active', status_note: null, sort_order: 5, notes: null },
];

export const demoPickupLocations = [
  { id: 'pl-marina', name: 'Hotel Marina Bay', area: 'Marina', address: 'Jalan Marina 1', latitude: 5.41, longitude: 100.33, active: true },
  { id: 'pl-suites', name: 'Marina Suites', area: 'Marina', address: 'Jalan Marina 8', latitude: 5.412, longitude: 100.331, active: true },
  { id: 'pl-sunset', name: 'Sunset Beach Villa', area: 'Sunset Bay', address: 'Sunset Coastal Road', latitude: 5.47, longitude: 100.29, active: true },
  { id: 'pl-town', name: 'Town Backpackers', area: 'Old Town', address: 'Lebuh Chulia 40', latitude: 5.42, longitude: 100.34, active: true },
];

export function buildBookings() {
  const bookings: Record<string, unknown>[] = [];
  const tourists: Record<string, unknown>[] = [];
  const privates: Record<string, unknown>[] = [];

  // Yesterday finished, today half-run, tomorrow still to plan.
  [YESTERDAY, TODAY, TOMORROW].forEach((date, dayIndex) => {
    generateDay(date, dayIndex).forEach((seed) => {
      const adults = seed.people.filter((person) => person.band === 'adult').length;
      const elderly = seed.people.filter((person) => person.band === 'elderly').length;
      const assisted = seed.people.filter((person) => person.assist).length;

      bookings.push({
        id: seed.id,
        booking_ref: seed.booking_ref,
        service_date: seed.service_date,
        source_type: seed.source_type,
        agency_id: seed.agency_id,
        external_ref: null,
        lead_name: seed.lead_name,
        lead_phone: seed.lead_phone,
        lead_email: null,
        nationality: null,
        pax_total: seed.people.length,
        pax_adults: adults,
        pax_children: seed.people.length - adults - elderly,
        pax_elderly: elderly,
        pax_assisted: assisted,
        pickup_location_id: seed.hotel.id,
        pickup_hotel_name: seed.hotel.name,
        pickup_area: seed.hotel.area,
        pickup_latitude: seed.hotel.lat,
        pickup_longitude: seed.hotel.lng,
        pickup_time: null,
        pickup_group_id: null,
        pickup_required: seed.pickup_required,
        pickup_stop_order: null,
        pickup_eta: null,
        status: 'confirmed',
        special_requests: null,
        notes: null,
        created_by: seed.created_by,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      seed.people.forEach((person, index) => {
        const touristId = `${seed.id}-t${index + 1}`;
        tourists.push({
          id: touristId,
          booking_id: seed.id,
          full_name: person.name,
          phone: person.phone,
          nationality: NATIONALITY_FOR(index + seed.people.length),
          age_band: person.band,
          gender: null,
          is_lead: index === 0,
          seat_note: null,
          sort_order: index + 1,
          needs_assistance: person.assist,
          assistance_note: person.assist ? 'Needs a hand getting on and off the boat' : null,
        });
        if (index === 0) {
          privates.push({
            tourist_id: touristId,
            passport_no: `P${String(1000000 + bookings.length * 37 + index).slice(0, 7)}`,
            date_of_birth: null,
            email: null,
            medical_notes: null,
            dietary_notes: null,
          });
        }
      });
    });
  });

  return { bookings, tourists, privates };
}

export const demoVehicles = [
  { id: 'veh-1', code: 'Van 1', name: 'Toyota Hiace', vehicle_type: 'van', capacity_pax: 12, plate_no: 'PKA 1234', default_driver_employee_id: 'em-kumar', active: true, notes: null, sort_order: 1 },
  { id: 'veh-2', code: 'Van 2', name: 'Nissan Urvan', vehicle_type: 'van', capacity_pax: 10, plate_no: 'PKA 5678', default_driver_employee_id: null, active: true, notes: null, sort_order: 2 },
  { id: 'veh-3', code: 'Van 3', name: 'Ford Transit', vehicle_type: 'van', capacity_pax: 14, plate_no: 'PKA 3344', default_driver_employee_id: null, active: true, notes: null, sort_order: 3 },
  { id: 'veh-4', code: 'Bus 1', name: 'Higer 30-seater', vehicle_type: 'bus', capacity_pax: 30, plate_no: 'PKB 7788', default_driver_employee_id: null, active: true, notes: 'Used when a coach party is in', sort_order: 4 },
  { id: 'veh-5', code: 'Car 1', name: 'Toyota Avanza', vehicle_type: 'car', capacity_pax: 5, plate_no: 'PKB 9012', default_driver_employee_id: null, active: true, notes: 'Small groups and airport runs', sort_order: 5 },
  { id: 'veh-6', code: 'Van 4', name: 'Toyota Hiace', vehicle_type: 'van', capacity_pax: 12, plate_no: 'PKA 4411', default_driver_employee_id: null, active: true, notes: null, sort_order: 6 },
  { id: 'veh-7', code: 'Car 2', name: 'Perodua Alza', vehicle_type: 'car', capacity_pax: 6, plate_no: 'PKB 2255', default_driver_employee_id: null, active: true, notes: null, sort_order: 7 },
];

const catalogue: Array<[string, string, string, string, number]> = [
  ['ingredient', 'Chicken breast', 'Meat', 'kg', 10],
  ['ingredient', 'Prawns', 'Seafood', 'kg', 5],
  ['ingredient', 'Squid', 'Seafood', 'kg', 4],
  ['ingredient', 'Fish fillet', 'Seafood', 'kg', 8],
  ['ingredient', 'Jasmine rice', 'Dry goods', 'kg', 20],
  ['ingredient', 'Noodles', 'Dry goods', 'kg', 6],
  ['ingredient', 'Cooking oil', 'Dry goods', 'L', 5],
  ['ingredient', 'Mixed vegetables', 'Fresh', 'kg', 8],
  ['ingredient', 'Onions', 'Fresh', 'kg', 5],
  ['ingredient', 'Garlic', 'Fresh', 'kg', 2],
  ['ingredient', 'Chilli', 'Fresh', 'kg', 2],
  ['ingredient', 'Tomatoes', 'Fresh', 'kg', 4],
  ['ingredient', 'Watermelon', 'Fruit', 'kg', 10],
  ['ingredient', 'Pineapple', 'Fruit', 'pcs', 8],
  ['ingredient', 'Eggs', 'Fresh', 'tray', 3],
  ['ingredient', 'Drinking water', 'Drinks', 'box', 6],
  ['ingredient', 'Ice', 'Drinks', 'bag', 6],
  ['ingredient', 'Charcoal', 'Other', 'bag', 4],
  ['equipment', 'Snorkel goggles', 'Snorkel gear', 'pcs', 1],
  ['equipment', 'Fins', 'Snorkel gear', 'pcs', 1],
  ['equipment', 'Life jacket (adult)', 'Safety gear', 'pcs', 1],
  ['equipment', 'Life jacket (child)', 'Safety gear', 'pcs', 1],
  ['equipment', 'Dry bag', 'Equipment', 'pcs', 1],
  ['equipment', 'Staff polo shirt', 'Clothing', 'pcs', 1],
];

export const demoCatalogue = catalogue.map(([kind, name, category, unit, qty], index) => ({
  id: `cat-${index + 1}`,
  kind,
  name,
  category,
  unit,
  default_quantity: qty,
  times_used: catalogue.length - index,
  last_used_at: null,
  active: true,
  created_at: new Date().toISOString(),
}));

export const demoFuelPurchases = [
  { id: 'fp-1', purchase_date: TODAY, litres: 180, price_per_litre: 2.5, total_cost: 450, supplier: 'Jetty station', fuel_type: 'petrol', collected_by_employee_id: 'em-rosli', notes: 'Morning fill for the fleet', created_at: new Date().toISOString() },
  { id: 'fp-2', purchase_date: YESTERDAY, litres: 120, price_per_litre: 2.48, total_cost: 297.6, supplier: 'Jetty station', fuel_type: 'petrol', collected_by_employee_id: 'em-ali', notes: null, created_at: new Date().toISOString() },
];

export const demoBoatTrips = [
  { id: 'bt-t1', service_date: YESTERDAY, boat_id: 'bt-1', trip_type: 'island_run', assignment_id: null, departure_time: '09:00', return_time: '16:30', pax_count: 11, purpose: 'Scheduled island run', notes: null, auto_generated: false, created_at: new Date().toISOString() },
  { id: 'bt-t2', service_date: YESTERDAY, boat_id: 'bt-2', trip_type: 'island_run', assignment_id: null, departure_time: '09:00', return_time: '16:30', pax_count: 8, purpose: 'Scheduled island run', notes: null, auto_generated: false, created_at: new Date().toISOString() },
  { id: 'bt-t3', service_date: YESTERDAY, boat_id: 'bt-1', trip_type: 'emergency', assignment_id: null, departure_time: '14:10', return_time: '15:05', pax_count: 3, purpose: 'Took a guest with heat stroke back to the mainland', notes: 'Guide Mei escorted', auto_generated: false, created_at: new Date().toISOString() },
];

function daysAgo(count: number) {
  const date = new Date();
  date.setDate(date.getDate() - count);
  return date.toISOString().slice(0, 10);
}

export const demoRepairs = [
  { id: 'rp-1', boat_id: 'bt-4', reported_date: daysAgo(120), damaged_on: daysAgo(121), issue_title: 'Engine overheating', issue_category: 'engine', issue_details: 'Temperature alarm on the way back from the island.', severity: 'high', status: 'fixed', cost: 850, vendor: 'Jetty Marine Works', fixed_date: daysAgo(117), out_of_service: false, is_recurring: false, previous_repair_id: null, reported_by_employee_id: 'em-rosli', recorded_by: 'u-master', notes: null, created_at: new Date().toISOString() },
  { id: 'rp-2', boat_id: 'bt-4', reported_date: daysAgo(3),   damaged_on: daysAgo(3),   issue_title: 'Engine overheating again', issue_category: 'engine', issue_details: 'Same alarm as three months ago. Impeller suspected.', severity: 'critical', status: 'in_progress', cost: 1200, vendor: 'Jetty Marine Works', fixed_date: null, out_of_service: true, is_recurring: true, previous_repair_id: 'rp-1', reported_by_employee_id: 'em-rosli', recorded_by: 'u-master', notes: null, created_at: new Date().toISOString() },
  { id: 'rp-3', boat_id: 'bt-1', reported_date: daysAgo(21),  damaged_on: daysAgo(22),  issue_title: 'Cracked windscreen', issue_category: 'hull', issue_details: 'Hit by debris in rough water.', severity: 'medium', status: 'fixed', cost: 320, vendor: 'Island Fibreglass', fixed_date: daysAgo(18), out_of_service: false, is_recurring: false, previous_repair_id: null, reported_by_employee_id: 'em-ali', recorded_by: 'u-master', notes: null, created_at: new Date().toISOString() },
  { id: 'rp-4', boat_id: 'bt-2', reported_date: daysAgo(8),   damaged_on: daysAgo(8),   issue_title: 'Bilge pump not switching on', issue_category: 'electrical', issue_details: 'Float switch replaced.', severity: 'medium', status: 'fixed', cost: 180, vendor: 'Jetty Marine Works', fixed_date: daysAgo(7), out_of_service: false, is_recurring: false, previous_repair_id: null, reported_by_employee_id: null, recorded_by: 'u-master', notes: null, created_at: new Date().toISOString() },
];
