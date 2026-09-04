/**
 * In-memory stand-in for Supabase, used only by the offline demo build
 * (VITE_DEMO_MODE=true). It mirrors the permission and visibility rules
 * from supabase/migrations, so switching persona in the demo shows the same
 * thing the real row level security policies would show.
 *
 * It is never bundled into a build that has real Supabase credentials.
 */
import {
  TODAY,
  TOMORROW,
  YESTERDAY,
  buildBookings,
  demoAgencies,
  demoBoats,
  demoEmployees,
  demoBoatTrips,
  demoFuelPurchases,
  demoPickupLocations,
  demoRepairs,
  demoUsers,
} from './demoSeed';

type Row = Record<string, any>;

const DEPARTMENTS = [
  { code: 'bar', name: 'Bar POS & Stock', description: 'Island bar point of sale, stock, closing and sales reports.', icon: 'ShoppingCart', sort_order: 1, active: true },
  { code: 'maintenance', name: 'Boat Maintenance', description: 'Daily fuel usage, refuelling and repair records for every boat.', icon: 'Wrench', sort_order: 2, active: true },
  { code: 'guests', name: 'Tourist Bookings', description: 'Booking and tourist records from agents, OTAs, in-house and others.', icon: 'Users', sort_order: 3, active: true },
  { code: 'fleet', name: 'Boat Assignment', description: 'Boat register plus the daily drag-and-drop tourist boat manifest.', icon: 'Ship', sort_order: 4, active: true },
  { code: 'boarding', name: 'Boarding Attendance', description: 'Captain and guide passenger check-in before departure.', icon: 'ClipboardCheck', sort_order: 5, active: true },
  { code: 'activities', name: 'Island Activities', description: 'Activity choice and headcount so nobody is left on the island.', icon: 'Waves', sort_order: 6, active: true },
  { code: 'platform', name: 'Admin & Access', description: 'Master admin panel: users, roles, permissions and directories.', icon: 'ShieldCheck', sort_order: 7, active: true },
  { code: 'kitchen', name: 'Kitchen', description: 'Ingredients and materials the kitchen needs, by date and pax.', icon: 'ChefHat', sort_order: 8, active: true },
  { code: 'purchasing', name: 'Things to Purchase', description: 'The buying queue: what was asked for, what has been bought.', icon: 'ShoppingBasket', sort_order: 9, active: true },
  { code: 'ops', name: 'Daily Operations', description: 'Live progress log of the day and what is running late.', icon: 'Activity', sort_order: 10, active: true },
  { code: 'items', name: 'Island Items', description: 'Equipment that has gone missing, and whether it turned up again.', icon: 'PackageSearch', sort_order: 11, active: true },
];

const PERMISSIONS: Row[] = [
  ['bar.pos.use', 'bar', 'Use POS', 'Take orders and complete sales.', false],
  ['bar.pos.void', 'bar', 'Void sales', 'Cancel a completed sale and return stock.', true],
  ['bar.stock.view', 'bar', 'View stock', 'See inventory balances and stock activity.', false],
  ['bar.stock.manage', 'bar', 'Stock in / adjust', 'Receive stock and make adjustments.', false],
  ['bar.closing.manage', 'bar', 'Daily closing', 'Count cash and close the business day.', true],
  ['bar.reports.view', 'bar', 'Bar reports', 'Open daily sales and accounting reports.', true],
  ['bar.products.manage', 'bar', 'Manage products', 'Add products, prices and bundles.', true],
  ['bar.settings.manage', 'bar', 'Bar settings', 'Change bar settings and staff name list.', true],
  ['maintenance.view', 'maintenance', 'View maintenance', 'Open fuel and repair records.', false],
  ['maintenance.fuel.record', 'maintenance', 'Record fuel', 'Enter daily petrol usage and refuelling.', false],
  ['maintenance.repair.record', 'maintenance', 'Record repairs', 'Report a boat damage or repair job.', false],
  ['maintenance.repair.close', 'maintenance', 'Close repairs', 'Mark a repair as fixed and set the fixed date.', false],
  ['maintenance.cost.view', 'maintenance', 'View costs', 'See fuel and repair money figures.', true],
  ['maintenance.manage', 'maintenance', 'Correct records', 'Edit or delete fuel and repair records.', true],
  ['guests.booking.create', 'guests', 'Enter bookings', 'Create bookings and tourist rows.', false],
  ['guests.booking.view_own', 'guests', 'View own bookings', 'See only bookings from own agency or own entries.', false],
  ['guests.booking.edit_own', 'guests', 'Edit own bookings', 'Change bookings from own agency before arrival.', false],
  ['guests.booking.view_all', 'guests', 'View ALL bookings', 'See the full guest list from every source.', true],
  ['guests.booking.edit_all', 'guests', 'Edit ALL bookings', 'Change any booking from any source.', true],
  ['guests.booking.delete', 'guests', 'Delete bookings', 'Cancel and remove booking records.', true],
  ['guests.contact.view', 'guests', 'View passport / ID', 'See passport, birth date, email and medical notes.', true],
  ['guests.export', 'guests', 'Export guest list', 'Download guest data as a file.', true],
  ['guests.pickup.manage', 'guests', 'Pickup coordination', 'Group bookings into pickup runs by hotel and area.', false],
  ['fleet.view', 'fleet', 'View fleet', 'See boats, capacity and the daily board.', false],
  ['fleet.boats.manage', 'fleet', 'Manage boats', 'Add boats, capacity, ownership and maintenance status.', true],
  ['fleet.assign', 'fleet', 'Assign tourists', 'Drag bookings onto boats for a service date.', false],
  ['fleet.crew.assign', 'fleet', 'Assign captain / guide', 'Choose the captain and tour guide for each boat.', false],
  ['fleet.finalize', 'fleet', 'Lock the manifest', 'Freeze a day so the boat list cannot change.', true],
  ['boarding.view', 'boarding', 'View own boarding list', 'See the passenger list for boats you crew.', false],
  ['boarding.mark', 'boarding', 'Mark boarding', 'Mark tourists as arrived, waiting or no show.', false],
  ['boarding.view_all', 'boarding', 'View all boats', 'See boarding progress for every boat.', true],
  ['activities.view', 'activities', 'View activities', 'See activity selection and headcount.', false],
  ['activities.select', 'activities', 'Choose activity', 'Set snorkel, volcanic mud or other per tourist.', false],
  ['activities.mark', 'activities', 'Mark activity roll call', 'Confirm who joined and who returned.', false],
  ['activities.manage', 'activities', 'Manage activity types', 'Add or retire activity options.', true],
  ['platform.users.manage', 'platform', 'Manage users', 'Approve accounts, set roles and per-user access.', true],
  ['platform.roles.manage', 'platform', 'Manage roles', 'Edit the role and permission matrix.', true],
  ['platform.directory.manage', 'platform', 'Manage directory', 'Maintain employees, agencies and pickup locations.', true],
  ['platform.settings.manage', 'platform', 'Platform settings', 'Change platform-wide settings.', true],
  ['platform.audit.view', 'platform', 'View audit log', 'Read the security and change audit trail.', true],
  ['kitchen.request.view', 'kitchen', 'View kitchen requests', 'See what the kitchen has asked for.', false],
  ['kitchen.request.create', 'kitchen', 'Raise a request', 'Create an ingredient or material request.', false],
  ['kitchen.request.submit', 'kitchen', 'Confirm and send', 'Send a request to Things to Purchase. This triggers the WhatsApp message.', false],
  ['kitchen.manage', 'kitchen', 'Correct requests', "Edit or cancel any kitchen request, including other people's.", true],
  ['purchasing.view', 'purchasing', 'View the buying list', 'See every request waiting to be bought.', false],
  ['purchasing.fulfil', 'purchasing', 'Mark as bought', 'Record what was bought, the cost and the supplier.', false],
  ['purchasing.manage', 'purchasing', 'Manage the queue', 'Change quantities, close or cancel requests.', true],
  ['purchasing.cost.view', 'purchasing', 'See purchase costs', 'View the money figures on the buying list.', true],
  ['ops.log.view', 'ops', 'View the operations log', "See today's progress and anything running late.", false],
  ['ops.log.manage', 'ops', 'Manage checkpoints', 'Change the times each step is expected to be done by.', true],
  ['ops.messages.send', 'ops', 'Send queued messages', 'Send the queued WhatsApp messages and mark them as sent.', false],
  ['ops.messages.manage', 'ops', 'Switch messages on and off', 'Choose which sections send a WhatsApp message.', true],
  ['items.view', 'items', 'View missing items', 'See the register of missing equipment.', false],
  ['items.report', 'items', 'Report an item', 'Record an item that has gone missing.', false],
  ['items.manage', 'items', 'Close and correct', 'Mark items found or written off, and edit entries.', true],
  ['items.cost.view', 'items', 'See item values', 'View the money value put on missing items.', true],
  ['guests.booking.edit_agency', 'guests', "Edit the whole agency's bookings", 'Edit any booking from the same agency, not only your own entries.', true],
].map(([code, department_code, name, description, sensitive], index) => ({
  code, department_code, name, description, sensitive, sort_order: index,
}));

const ROLES = [
  { code: 'master_admin', name: 'Master Admin', description: 'Full control of every department and the access matrix.', is_master: true, is_system: true, sort_order: 1 },
  { code: 'operations_manager', name: 'Operations Manager', description: 'Runs every operation department. No access-control rights.', is_master: false, is_system: true, sort_order: 2 },
  { code: 'coordinator', name: 'Trip Coordinator', description: 'Full guest list, pickup grouping and boat assignment.', is_master: false, is_system: true, sort_order: 3 },
  { code: 'bar_staff', name: 'Bar Staff', description: 'Island bar POS, stock, closing and bar reports only.', is_master: false, is_system: true, sort_order: 4 },
  { code: 'captain', name: 'Boat Captain', description: 'Boarding check-in for the boats they crew.', is_master: false, is_system: true, sort_order: 5 },
  { code: 'guide', name: 'Tour Guide', description: 'Boarding check-in plus island activity roll call.', is_master: false, is_system: true, sort_order: 6 },
  { code: 'agent', name: 'Travel Agent', description: 'Enters own bookings only. Cannot see other sources.', is_master: false, is_system: true, sort_order: 7 },
  { code: 'accountant', name: 'Accountant', description: 'Read-only money view across bar and boat costs.', is_master: false, is_system: true, sort_order: 8 },
  { code: 'pending', name: 'Pending Approval', description: 'Signed up but not approved. No access to anything.', is_master: false, is_system: true, sort_order: 9 },
  { code: 'bar_manager', name: 'Bar Manager', description: 'Bar POS, stock in, closing and reports. Cannot change products or prices.', is_master: false, is_system: true, sort_order: 10 },
  { code: 'bar_cashier', name: 'Bar Cashier', description: 'Takes orders on the POS and can look up stock.', is_master: false, is_system: true, sort_order: 11 },
  { code: 'kitchen_staff', name: 'Kitchen Staff', description: 'Raises ingredient requests and sends them to purchasing.', is_master: false, is_system: true, sort_order: 12 },
  { code: 'purchaser', name: 'Purchaser', description: 'Works the buying list and records what was bought.', is_master: false, is_system: true, sort_order: 13 },
];

const ROLE_GRANTS: Record<string, string[]> = {
  operations_manager: PERMISSIONS.filter((p) => p.department_code !== 'platform').map((p) => p.code),
  kitchen_staff: ['kitchen.request.view', 'kitchen.request.create', 'kitchen.request.submit'],
  purchaser: ['purchasing.view', 'purchasing.fulfil', 'purchasing.cost.view', 'kitchen.request.view'],
  coordinator: [
    'guests.booking.create', 'guests.booking.view_own', 'guests.booking.edit_own',
    'guests.booking.view_all', 'guests.booking.edit_all', 'guests.booking.delete',
    'guests.contact.view', 'guests.export', 'guests.pickup.manage',
    'fleet.view', 'fleet.assign', 'fleet.crew.assign', 'fleet.finalize',
    'boarding.view', 'boarding.view_all', 'boarding.mark',
    'activities.view', 'activities.select', 'activities.mark',
    'kitchen.request.view', 'purchasing.view', 'ops.log.view', 'ops.messages.send',
    'items.view', 'items.report',
  ],
  bar_staff: PERMISSIONS.filter((p) => p.department_code === 'bar').map((p) => p.code),
  captain: ['boarding.view', 'boarding.mark', 'activities.view', 'items.view', 'items.report'],
  guide: ['boarding.view', 'boarding.mark', 'activities.view', 'activities.select', 'activities.mark', 'items.view', 'items.report'],
  agent: ['guests.booking.create', 'guests.booking.view_own', 'guests.booking.edit_own'],
  accountant: ['bar.reports.view', 'bar.stock.view', 'maintenance.view', 'maintenance.cost.view',
               'purchasing.view', 'purchasing.cost.view', 'kitchen.request.view', 'items.view', 'items.cost.view'],
  bar_manager: ['bar.pos.use', 'bar.pos.void', 'bar.stock.view', 'bar.stock.manage', 'bar.closing.manage', 'bar.reports.view'],
  bar_cashier: ['bar.pos.use', 'bar.stock.view'],
  pending: [],
  master_admin: [],
};

const { bookings, tourists, privates } = buildBookings();

const DB_KEY = 'lovely_paradise_demo_db';

const seededDb: Record<string, Row[]> = {
  departments: DEPARTMENTS.map((row) => ({ ...row })),
  permissions: PERMISSIONS.map((row) => ({ ...row })),
  access_roles: ROLES.map((row) => ({ ...row })),
  access_role_permissions: Object.entries(ROLE_GRANTS).flatMap(([role_code, codes]) =>
    codes.map((permission_code) => ({ role_code, permission_code })),
  ),
  user_permission_overrides: [],
  profiles: demoUsers.map((user) => ({
    ...user,
    role: 'admin',
    status: user.access_role_code === 'pending' ? 'pending' : 'active',
    phone: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })),
  agencies: demoAgencies.map((row) => ({ ...row })),
  employees: demoEmployees.map((row) => ({ ...row })),
  boats: demoBoats.map((row) => ({ ...row })),
  fuel_purchases: demoFuelPurchases.map((row) => ({ ...row })),
  boat_trips: demoBoatTrips.map((row) => ({ ...row })),
  boat_repairs: demoRepairs.map((row) => ({ ...row })),
  pickup_locations: demoPickupLocations.map((row) => ({ ...row })),
  pickup_groups: [],
  bookings,
  tourists,
  tourist_private: privates,
  activity_types: [
    { code: 'snorkel', name: 'Snorkelling', description: 'Reef snorkelling trip.', sort_order: 1, active: true },
    { code: 'volcano', name: 'Volcanic Mud', description: 'Volcanic mud bath on the island.', sort_order: 2, active: true },
    { code: 'others', name: 'Others / Rest', description: 'Resting on the island, injured, or another activity.', sort_order: 3, active: true },
  ],
  boat_assignments: [],
  trip_bookings: [],
  trip_passengers: [],
  audit_logs: [],
  purchase_requests: [
    {
      id: 'pr-1', request_no: 'PR-DEMO-001', origin: 'kitchen', needed_for_date: TODAY,
      pax_count: 24, purpose: 'Island lunch', status: 'submitted', notes: 'Halal only please',
      requested_by: 'u-cook', submitted_at: new Date().toISOString(), completed_at: null,
      cancelled_reason: null, created_at: new Date().toISOString(),
    },
    {
      id: 'pr-2', request_no: 'PR-DEMO-002', origin: 'kitchen', needed_for_date: TOMORROW,
      pax_count: 30, purpose: 'BBQ dinner', status: 'draft', notes: null,
      requested_by: 'u-cook', submitted_at: null, completed_at: null,
      cancelled_reason: null, created_at: new Date().toISOString(),
    },
  ],
  purchase_request_items: [
    { id: 'pri-1', request_id: 'pr-1', item_name: 'Chicken breast', quantity: 8, unit: 'kg', note: null, purchase_status: 'bought', purchased_quantity: 8, actual_cost: 96, supplier: 'Pasar Besar', purchased_by: 'u-buyer', purchased_at: new Date().toISOString(), purchase_note: null, sort_order: 1 },
    { id: 'pri-2', request_id: 'pr-1', item_name: 'Jasmine rice', quantity: 10, unit: 'kg', note: null, purchase_status: 'pending', purchased_quantity: null, actual_cost: null, supplier: null, purchased_by: null, purchased_at: null, purchase_note: null, sort_order: 2 },
    { id: 'pri-3', request_id: 'pr-1', item_name: 'Cooking oil', quantity: 4, unit: 'L', note: 'Any brand', purchase_status: 'pending', purchased_quantity: null, actual_cost: null, supplier: null, purchased_by: null, purchased_at: null, purchase_note: null, sort_order: 3 },
    { id: 'pri-4', request_id: 'pr-1', item_name: 'Mixed vegetables', quantity: 6, unit: 'kg', note: null, purchase_status: 'pending', purchased_quantity: null, actual_cost: null, supplier: null, purchased_by: null, purchased_at: null, purchase_note: null, sort_order: 4 },
    { id: 'pri-5', request_id: 'pr-2', item_name: 'Prawns', quantity: 5, unit: 'kg', note: 'Large', purchase_status: 'pending', purchased_quantity: null, actual_cost: null, supplier: null, purchased_by: null, purchased_at: null, purchase_note: null, sort_order: 1 },
    { id: 'pri-6', request_id: 'pr-2', item_name: 'Charcoal', quantity: 4, unit: 'bag', note: null, purchase_status: 'pending', purchased_quantity: null, actual_cost: null, supplier: null, purchased_by: null, purchased_at: null, purchase_note: null, sort_order: 2 },
  ],
  notification_rules: [
    { code: 'kitchen.request_submitted', name: 'Kitchen request confirmed', description: 'Sends the full ingredient list, date and pax when the kitchen confirms a request.', department_code: 'kitchen', channel: 'whatsapp', enabled: true, target_label: 'Purchasing group', sort_order: 1 },
    { code: 'purchasing.completed', name: 'Purchase run completed', description: 'Sends a summary when everything on a request has been bought or marked unavailable.', department_code: 'purchasing', channel: 'whatsapp', enabled: false, target_label: 'Purchasing group', sort_order: 2 },
    { code: 'fleet.assignment_completed', name: 'Boat assignment completed', description: 'Sends the full boat manifest with guest names, captain and guide when the day is locked.', department_code: 'fleet', channel: 'whatsapp', enabled: true, target_label: 'Operations group', sort_order: 3 },
    { code: 'ops.checkpoint_overdue', name: 'Step running late', description: 'Sends an alert when a step such as boarding is not finished by its expected time.', department_code: 'ops', channel: 'whatsapp', enabled: true, target_label: 'Operations group', sort_order: 4 },
  ],
  outbound_messages: [],
  operations_events: [],
  operations_checkpoints: [
    { code: 'assignment_locked', name: 'Boat assignment finished', department_code: 'fleet', event_code: 'fleet.assignment_completed', scope: 'per_day', due_time: '08:00', enabled: true, sort_order: 1 },
    { code: 'boarding_done', name: 'Boarding attendance done', department_code: 'boarding', event_code: 'boarding.completed', scope: 'per_boat', due_time: '09:00', enabled: true, sort_order: 2 },
    { code: 'activity_chosen', name: 'Activities chosen', department_code: 'activities', event_code: 'activities.selected', scope: 'per_boat', due_time: '11:00', enabled: true, sort_order: 3 },
    { code: 'activity_roll_call', name: 'Activity roll call done', department_code: 'activities', event_code: 'activities.completed', scope: 'per_boat', due_time: '15:00', enabled: true, sort_order: 4 },
    { code: 'everyone_back', name: 'Everyone back on the boat', department_code: 'activities', event_code: 'activities.all_returned', scope: 'per_boat', due_time: '16:00', enabled: true, sort_order: 5 },
  ],
  missing_items: [
    { id: 'mi-1', item_name: 'Snorkel goggles', category: 'snorkel_gear', quantity: 3, missing_on: YESTERDAY, noticed_location: 'Island jetty', boat_id: null, remarks: 'Not returned after the afternoon session', estimated_value: 45, status: 'missing', found_on: null, found_remarks: null, reported_by: 'u-guide', resolved_by: null, created_at: new Date().toISOString() },
    { id: 'mi-2', item_name: 'Life jacket (child)', category: 'safety_gear', quantity: 1, missing_on: YESTERDAY, noticed_location: 'Boat 2', boat_id: 'bt-2', remarks: null, estimated_value: 80, status: 'found', found_on: TODAY, found_remarks: 'Was under the bench seat', reported_by: 'u-captain', resolved_by: 'u-coord', created_at: new Date().toISOString() },
    { id: 'mi-3', item_name: 'Staff polo shirt', category: 'clothing', quantity: 2, missing_on: TODAY, noticed_location: 'Staff room', boat_id: null, remarks: 'Taken from the drying line', estimated_value: 30, status: 'missing', found_on: null, found_remarks: null, reported_by: 'u-coord', resolved_by: null, created_at: new Date().toISOString() },
  ],
  attendance_log: [],
};

// The demo reloads on a persona switch, so what one person set up has to
// still be there for the next one. Everything stays in this browser.
function hydrate(): Record<string, Row[]> {
  try {
    const saved = localStorage.getItem(DB_KEY);
    if (!saved) return seededDb;
    const parsed = JSON.parse(saved) as Record<string, Row[]>;
    // Catalogue tables always come from code so a stale snapshot cannot
    // pin the demo to an old permission list.
    return {
      ...parsed,
      departments: seededDb.departments,
      permissions: seededDb.permissions,
      access_roles: parsed.access_roles ?? seededDb.access_roles,
    };
  } catch {
    return seededDb;
  }
}

const db: Record<string, Row[]> = hydrate();

export function persistDemoDb() {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch {
    // A full quota just means the demo forgets between reloads.
  }
}

export function resetDemoDb() {
  localStorage.removeItem(DB_KEY);
  localStorage.removeItem('lovely_paradise_settings');
  localStorage.removeItem('lovely_paradise_products');
  localStorage.removeItem('lovely_paradise_sales');
  window.location.reload();
}

// ---------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------
const SESSION_KEY = 'lovely_paradise_demo_user';
let currentUserId: string | null = localStorage.getItem(SESSION_KEY);
const listeners: Array<(event: string, session: unknown) => void> = [];

function sessionFor(userId: string | null) {
  return userId ? { user: { id: userId }, access_token: 'demo' } : null;
}

export function demoSignIn(userId: string) {
  currentUserId = userId;
  localStorage.setItem(SESSION_KEY, userId);
  listeners.forEach((listener) => listener('SIGNED_IN', sessionFor(userId)));
}

/**
 * Switching person in the demo is a change of identity, so it reloads the way
 * a real sign-in does. Without this, pages already on screen keep showing the
 * previous person's data until something happens to re-fetch them.
 */
export function demoSwitchPersona(userId: string) {
  localStorage.setItem(SESSION_KEY, userId);
  window.location.hash = '#/';
  window.location.reload();
}

export function demoCurrentUserId() {
  return currentUserId;
}

export const demoPersonas = demoUsers;

// ---------------------------------------------------------------------
// Permission engine - mirrors user_has_permission() in SQL
// ---------------------------------------------------------------------
function profileOf(userId: string | null) {
  return userId ? db.profiles.find((row) => row.id === userId) ?? null : null;
}

function userHasPermission(userId: string | null, code: string): boolean {
  const profile = profileOf(userId);
  if (!profile || profile.status !== 'active') return false;
  const role = ROLES.find((item) => item.code === profile.access_role_code);
  if (role?.is_master) return true;
  const override = db.user_permission_overrides.find(
    (row) => row.user_id === userId && row.permission_code === code,
  );
  if (override?.effect === 'revoke') return false;
  if (override?.effect === 'grant') return true;
  return db.access_role_permissions.some(
    (row) => row.role_code === profile.access_role_code && row.permission_code === code,
  );
}

function can(code: string) {
  return userHasPermission(currentUserId, code);
}

function isMaster() {
  const role = ROLES.find((item) => item.code === profileOf(currentUserId)?.access_role_code);
  return Boolean(role?.is_master);
}

function myAgencyId() {
  return profileOf(currentUserId)?.agency_id ?? null;
}

function require(code: string) {
  if (!can(code)) throw new Error(`Your access does not include "${code}".`);
}

function crewOnAssignment(assignmentId: string) {
  const assignment = db.boat_assignments.find((row) => row.id === assignmentId);
  if (!assignment) return false;
  return db.employees.some(
    (employee) =>
      employee.profile_id === currentUserId &&
      employee.active &&
      [assignment.captain_employee_id, assignment.guide_employee_id].includes(employee.id),
  );
}

function canSeeAssignment(assignmentId: string) {
  if (can('fleet.view') || can('boarding.view_all')) return true;
  return (can('boarding.view') || can('activities.view')) && crewOnAssignment(assignmentId);
}

function canViewBooking(bookingId: string) {
  const booking = db.bookings.find((row) => row.id === bookingId);
  if (!booking) return false;
  if (can('guests.booking.view_all')) return true;
  if (
    can('guests.booking.view_own') &&
    (booking.created_by === currentUserId || (booking.agency_id && booking.agency_id === myAgencyId()))
  ) {
    return true;
  }
  return db.trip_bookings.some((row) => row.booking_id === bookingId && canSeeAssignment(row.assignment_id));
}

// Row level security, replayed in the browser.
function visibleRows(table: string): Row[] {
  const rows = db[table] ?? [];
  switch (table) {
    case 'profiles':
      return rows.filter((row) => row.id === currentUserId || can('platform.users.manage'));
    case 'agencies':
      return rows.filter(
        () => can('platform.directory.manage') || can('guests.booking.view_all'),
      ).concat(
        can('platform.directory.manage') || can('guests.booking.view_all')
          ? []
          : rows.filter((row) => row.id === myAgencyId()),
      );
    case 'employees':
      return can('platform.directory.manage') || can('fleet.view') || can('maintenance.view') || can('boarding.view')
        ? rows
        : rows.filter((row) => row.profile_id === currentUserId);
    case 'boats':
      return can('fleet.view') || can('maintenance.view') || can('boarding.view') || can('activities.view') ? rows : [];
    case 'fuel_purchases':
      return can('maintenance.view') ? rows : [];
    case 'boat_trips':
      return can('maintenance.view') || can('fleet.view') ? rows : [];
    case 'purchase_requests':
      return can('kitchen.request.view') || can('purchasing.view')
        ? rows
        : rows.filter((row) => row.requested_by === currentUserId);
    case 'purchase_request_items':
      return can('kitchen.request.view') || can('purchasing.view')
        ? rows
        : rows.filter((row) =>
            db.purchase_requests.some((r) => r.id === row.request_id && r.requested_by === currentUserId),
          );
    case 'notification_rules':
      return can('ops.log.view') || can('ops.messages.manage') ? rows : [];
    case 'outbound_messages':
      return can('ops.messages.send') || can('ops.messages.manage') ? rows : [];
    case 'operations_events':
    case 'operations_checkpoints':
      return can('ops.log.view') || can('ops.log.manage') ? rows : [];
    case 'missing_items':
      return can('items.view') ? rows : rows.filter((row) => row.reported_by === currentUserId);
    case 'attendance_log':
      return can('ops.log.view') ? rows : rows.filter((row) => canSeeAssignment(row.assignment_id));
    case 'boat_repairs':
      return can('maintenance.view') || can('fleet.view') ? rows : [];
    case 'pickup_locations':
      return can('guests.booking.create') || can('guests.booking.view_own') || can('guests.booking.view_all') || can('guests.pickup.manage') || can('platform.directory.manage')
        ? rows
        : [];
    case 'pickup_groups':
      return can('guests.pickup.manage') || can('guests.booking.view_all') || can('fleet.view') ? rows : [];
    case 'bookings':
      return rows.filter((row) => canViewBooking(row.id));
    case 'tourists':
      return rows.filter((row) => canViewBooking(row.booking_id));
    case 'tourist_private':
      if (!can('guests.contact.view')) return [];
      return rows.filter((row) => {
        const tourist = db.tourists.find((item) => item.id === row.tourist_id);
        return tourist ? canViewBooking(tourist.booking_id) : false;
      });
    case 'boat_assignments':
      return rows.filter((row) => canSeeAssignment(row.id));
    case 'trip_bookings':
    case 'trip_passengers':
      return rows.filter((row) => canSeeAssignment(row.assignment_id));
    case 'audit_logs':
      return can('platform.audit.view') ? rows : [];
    default:
      return rows;
  }
}

// The trip_manifest view.
function manifestRows(): Row[] {
  return visibleRows('trip_passengers')
    .map((passenger) => {
      const tourist = db.tourists.find((row) => row.id === passenger.tourist_id);
      const booking = db.bookings.find((row) => row.id === passenger.booking_id);
      const assignment = db.boat_assignments.find((row) => row.id === passenger.assignment_id);
      const boat = db.boats.find((row) => row.id === assignment?.boat_id);
      if (!tourist || !booking || !assignment || !boat) return null;
      const row: Row = {
        passenger_id: passenger.id,
        assignment_id: passenger.assignment_id,
        booking_id: passenger.booking_id,
        tourist_id: passenger.tourist_id,
        boarding_status: passenger.boarding_status,
        boarded_at: passenger.boarded_at,
        activity_code: passenger.activity_code,
        activity_status: passenger.activity_status,
        returned: passenger.returned,
        note: passenger.note,
        full_name: tourist.full_name,
        phone: tourist.phone ?? booking.lead_phone,
        age_band: tourist.age_band,
        is_lead: tourist.is_lead,
        nationality: tourist.nationality,
        booking_ref: booking.booking_ref,
        lead_name: booking.lead_name,
        group_size: booking.pax_total,
        service_date: booking.service_date,
        boat_id: boat.id,
        boat_code: boat.code,
        boat_name: boat.name,
      };
      return row;
    })
    .filter((row): row is Row => row !== null);
}

export { db, can, userHasPermission, isMaster, myAgencyId, require, canViewBooking, canSeeAssignment, manifestRows, visibleRows, currentUserIdRef };

const currentUserIdRef = { get value() { return currentUserId; } };

export function registerAuthListener(listener: (event: string, session: unknown) => void) {
  listeners.push(listener);
  return () => {
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  };
}

export function clearDemoSession() {
  currentUserId = null;
  localStorage.removeItem(SESSION_KEY);
  listeners.forEach((listener) => listener('SIGNED_OUT', null));
}

export function demoSession() {
  return sessionFor(currentUserId);
}
