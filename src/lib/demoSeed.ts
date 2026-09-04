// Seed data for the offline demo build. Dates are generated relative to
// today so the default filters always land on something to look at.
function iso(offsetDays: number) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

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
  { id: 'bt-1', code: 'Boat 1', name: 'Sea Star', boat_type: 'speedboat', capacity_pax: 12, ownership: 'owned', owner_name: null, registration_no: 'PKB 1120', engine_info: '2 x 115hp', expected_litres_per_trip: 20, status: 'active', status_note: null, sort_order: 1, notes: null },
  { id: 'bt-2', code: 'Boat 2', name: 'Blue Wave', boat_type: 'speedboat', capacity_pax: 10, ownership: 'owned', owner_name: null, registration_no: 'PKB 2240', engine_info: '2 x 90hp', expected_litres_per_trip: 18, status: 'active', status_note: null, sort_order: 2, notes: null },
  { id: 'bt-3', code: 'Boat 3', name: 'Island Hop', boat_type: 'ferry', capacity_pax: 24, ownership: 'owned', owner_name: null, registration_no: 'PKB 3310', engine_info: 'Inboard diesel', expected_litres_per_trip: 35, status: 'active', status_note: null, sort_order: 3, notes: null },
  { id: 'bt-4', code: 'Boat 4', name: 'Partner One', boat_type: 'speedboat', capacity_pax: 10, ownership: 'partner', owner_name: 'Pak Hassan', registration_no: 'PKB 4405', engine_info: '2 x 100hp', expected_litres_per_trip: 19, status: 'maintenance', status_note: 'Under repair', sort_order: 4, notes: null },
];

export const demoPickupLocations = [
  { id: 'pl-marina', name: 'Hotel Marina Bay', area: 'Marina', address: 'Jalan Marina 1', latitude: 5.41, longitude: 100.33, active: true },
  { id: 'pl-suites', name: 'Marina Suites', area: 'Marina', address: 'Jalan Marina 8', latitude: 5.412, longitude: 100.331, active: true },
  { id: 'pl-sunset', name: 'Sunset Beach Villa', area: 'Sunset Bay', address: 'Sunset Coastal Road', latitude: 5.47, longitude: 100.29, active: true },
  { id: 'pl-town', name: 'Town Backpackers', area: 'Old Town', address: 'Lebuh Chulia 40', latitude: 5.42, longitude: 100.34, active: true },
];

type AgeBandSeed = 'adult' | 'child' | 'infant' | 'elderly';

type SeedBooking = {
  id: string;
  ref: string;
  source: string;
  agency: string | null;
  createdBy: string;
  lead: string;
  phone: string;
  location: string;
  time: string;
  date: string;
  people: Array<[string, string, AgeBandSeed, string?]>;
  pickup?: boolean;
  assist?: number;
};

const seedBookings: SeedBooking[] = [
  {
    id: 'bk-tan', ref: 'LP-A-001', source: 'agent', agency: 'ag-blue', createdBy: 'u-agent-blue',
    lead: 'Tan Family', phone: '+60 12-345 6789', location: 'pl-marina', time: '07:30', date: TODAY,
    people: [
      ['Tan Wei Ming', '+60 12-345 6789', 'adult', 'A12345678'],
      ['Tan Siew Lan', '+60 12-345 6780', 'adult', 'A12345679'],
      ['Tan Jun Hao', '', 'child'],
      ['Tan Xin Yi', '', 'child'],
      ['Tan Bao Bao', '', 'infant'],
      ['Tan Ah Ma', '', 'elderly'],
    ],
    assist: 6,
  },
  {
    id: 'bk-lee', ref: 'LP-A-002', source: 'agent', agency: 'ag-blue', createdBy: 'u-agent-blue',
    lead: 'Lee Couple', phone: '+60 19-880 2211', location: 'pl-suites', time: '07:40', date: TODAY,
    people: [['Lee Ann', '+60 19-880 2211', 'adult', 'B22110099'], ['Lee Bob', '', 'adult', 'B22110100']],
  },
  {
    id: 'bk-schmidt', ref: 'LP-A-003', source: 'agent', agency: 'ag-red', createdBy: 'u-agent-red',
    lead: 'Schmidt Group', phone: '+49 170 2233445', location: 'pl-sunset', time: '07:15', date: TODAY,
    people: [
      ['Hans Schmidt', '+49 170 2233445', 'adult', 'C99887766'],
      ['Anna Schmidt', '', 'adult', 'C99887767'],
      ['Lukas Schmidt', '', 'adult', 'C99887768'],
      ['Marie Schmidt', '', 'child'],
      ['Opa Schmidt', '', 'elderly'],
    ],
  },
  {
    id: 'bk-klook', ref: 'LP-A-004', source: 'ota', agency: 'ag-ota', createdBy: 'u-coord',
    lead: 'Nguyen Party', phone: '+84 90 112 3344', location: 'pl-town', time: '07:50', date: TODAY,
    people: [
      ['Nguyen Minh', '+84 90 112 3344', 'adult', 'D11223344'],
      ['Nguyen Lan', '', 'adult'],
      ['Tran Bao', '', 'adult'],
      ['Pham Duc', '', 'adult'],
      ['Vo Thi Hoa', '', 'adult'],
      ['Le Van Nam', '', 'adult'],
    ],
  },
  {
    id: 'bk-house', ref: 'LP-A-005', source: 'in_house', agency: null, createdBy: 'u-coord',
    lead: 'Walker Honeymoon', phone: '+44 7700 900123', location: 'pl-marina', time: '07:30', date: TODAY,
    people: [['James Walker', '+44 7700 900123', 'adult', 'E55443322'], ['Emily Walker', '', 'adult', 'E55443323']],
  },
  {
    id: 'bk-walkin', ref: 'LP-A-006', source: 'walk_in', agency: null, createdBy: 'u-coord',
    lead: 'Kim Solo', phone: '+82 10 5566 7788', location: 'pl-town', time: '08:00', date: TODAY,
    pickup: false,
    people: [['Kim Ji Woo', '+82 10 5566 7788', 'adult', 'F66778899']],
  },
  {
    id: 'bk-tomorrow', ref: 'LP-B-001', source: 'agent', agency: 'ag-blue', createdBy: 'u-agent-blue',
    lead: 'Chen Group', phone: '+886 912 334 556', location: 'pl-sunset', time: '07:20', date: TOMORROW,
    people: [
      ['Chen Wei', '+886 912 334 556', 'adult'],
      ['Chen Li', '', 'adult'],
      ['Chen Yu', '', 'child'],
    ],
  },
];

export function buildBookings() {
  const bookings: Record<string, unknown>[] = [];
  const tourists: Record<string, unknown>[] = [];
  const privates: Record<string, unknown>[] = [];

  seedBookings.forEach((seed) => {
    const location = demoPickupLocations.find((item) => item.id === seed.location)!;
    const adults = seed.people.filter(([, , band]) => band === 'adult').length;
    const elderly = seed.people.filter(([, , band]) => band === 'elderly').length;
    bookings.push({
      id: seed.id,
      booking_ref: seed.ref,
      service_date: seed.date,
      source_type: seed.source,
      agency_id: seed.agency,
      external_ref: null,
      lead_name: seed.lead,
      lead_phone: seed.phone,
      lead_email: null,
      nationality: null,
      pax_total: seed.people.length,
      pax_adults: adults,
      pax_children: seed.people.length - adults - elderly,
      pax_elderly: elderly,
      pax_assisted: seed.assist ? 1 : 0,
      pickup_required: seed.pickup !== false,
      pickup_stop_order: null,
      pickup_eta: null,
      pickup_location_id: location.id,
      pickup_hotel_name: location.name,
      pickup_area: location.area,
      pickup_latitude: location.latitude,
      pickup_longitude: location.longitude,
      pickup_time: seed.time,
      pickup_group_id: null,
      status: 'confirmed',
      special_requests: null,
      notes: null,
      created_by: seed.createdBy,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    seed.people.forEach(([name, phone, band, passport], index) => {
      const touristId = `${seed.id}-t${index + 1}`;
      tourists.push({
        id: touristId,
        booking_id: seed.id,
        full_name: name,
        phone: phone || null,
        nationality: null,
        age_band: band,
        gender: null,
        is_lead: index === 0,
        seat_note: null,
        sort_order: index + 1,
        needs_assistance: seed.assist === index + 1,
        assistance_note: seed.assist === index + 1 ? 'Walks with a stick, needs help boarding' : null,
      });
      if (passport) {
        privates.push({
          tourist_id: touristId,
          passport_no: passport,
          date_of_birth: null,
          email: null,
          medical_notes: null,
          dietary_notes: null,
        });
      }
    });
  });

  return { bookings, tourists, privates };
}

export const demoVehicles = [
  { id: 'veh-1', code: 'Van 1', name: 'Toyota Hiace', vehicle_type: 'van', capacity_pax: 12, plate_no: 'PKA 1234', default_driver_employee_id: 'em-kumar', active: true, notes: null, sort_order: 1 },
  { id: 'veh-2', code: 'Van 2', name: 'Nissan Urvan', vehicle_type: 'van', capacity_pax: 10, plate_no: 'PKA 5678', default_driver_employee_id: null, active: true, notes: null, sort_order: 2 },
  { id: 'veh-3', code: 'Car 1', name: 'Toyota Avanza', vehicle_type: 'car', capacity_pax: 5, plate_no: 'PKB 9012', default_driver_employee_id: null, active: true, notes: 'For small groups and airport runs', sort_order: 3 },
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
