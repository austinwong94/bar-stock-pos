export type DepartmentCode =
  | 'bar'
  | 'maintenance'
  | 'guests'
  | 'fleet'
  | 'boarding'
  | 'activities'
  | 'kitchen'
  | 'purchasing'
  | 'ops'
  | 'items'
  | 'platform';

export type Department = {
  code: DepartmentCode;
  name: string;
  description: string | null;
  icon: string | null;
  sort_order: number;
  active: boolean;
};

export type PermissionRow = {
  code: string;
  department_code: DepartmentCode;
  name: string;
  description: string | null;
  sensitive: boolean;
  sort_order: number;
};

export type AccessRole = {
  code: string;
  name: string;
  description: string | null;
  is_master: boolean;
  is_system: boolean;
  sort_order: number;
};

export type UserStatus = 'pending' | 'active' | 'suspended';

export type PlatformProfile = {
  id: string;
  full_name: string | null;
  role: string;
  access_role_code: string | null;
  status: UserStatus;
  agency_id: string | null;
  phone: string | null;
  login_email: string | null;
  is_anonymous: boolean;
  created_at: string;
  updated_at: string;
};

export type SourceType = 'agent' | 'ota' | 'in_house' | 'walk_in' | 'other';

export type Agency = {
  id: string;
  name: string;
  source_type: SourceType;
  contact_person: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  commission_note: string | null;
  active: boolean;
};

export type JobType = 'captain' | 'guide' | 'driver' | 'crew' | 'bar' | 'office' | 'other';

export type Employee = {
  id: string;
  employee_code: string | null;
  full_name: string;
  job_type: JobType;
  phone: string | null;
  profile_id: string | null;
  active: boolean;
  notes: string | null;
};

export type BoatStatus = 'active' | 'maintenance' | 'inactive';

export type Boat = {
  id: string;
  code: string;
  name: string | null;
  boat_type: string;
  capacity_pax: number;
  ownership: 'owned' | 'partner' | 'charter';
  owner_name: string | null;
  registration_no: string | null;
  engine_info: string | null;
  expected_litres_per_trip: number | null;
  status: BoatStatus;
  status_note: string | null;
  sort_order: number;
  notes: string | null;
};

export type FuelEntryType = 'trip_usage' | 'refuel';

export type FuelLog = {
  id: string;
  boat_id: string;
  log_date: string;
  entry_type: FuelEntryType;
  trip_label: string | null;
  entered_island: boolean;
  litres: number;
  price_per_litre: number;
  total_cost: number;
  tank_level_after_pct: number | null;
  engine_hours: number | null;
  handled_by_employee_id: string | null;
  notes: string | null;
  recorded_by: string | null;
  created_at: string;
  boats?: Pick<Boat, 'code' | 'name'> | null;
};

export type FuelSummaryRow = {
  boat_id: string;
  boat_code: string;
  trips: number;
  litres_used: number;
  litres_loaded: number;
  cost_used: number;
  cost_loaded: number;
  avg_litres_per_trip: number;
  expected_litres_per_trip: number | null;
  variance_pct: number | null;
};

export type RepairCategory =
  | 'engine'
  | 'propeller'
  | 'hull'
  | 'electrical'
  | 'fuel_system'
  | 'steering'
  | 'safety_gear'
  | 'interior'
  | 'other';

export type RepairStatus = 'reported' | 'in_progress' | 'fixed' | 'cancelled';

export type Repair = {
  id: string;
  boat_id: string;
  reported_date: string;
  damaged_on: string | null;
  issue_title: string;
  issue_category: RepairCategory;
  issue_details: string | null;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: RepairStatus;
  cost: number;
  vendor: string | null;
  fixed_date: string | null;
  out_of_service: boolean;
  is_recurring: boolean;
  previous_repair_id: string | null;
  reported_by_employee_id: string | null;
  notes: string | null;
  created_at: string;
  boats?: Pick<Boat, 'code' | 'name'> | null;
};

export type BookingStatus = 'draft' | 'confirmed' | 'arrived' | 'cancelled' | 'no_show';
export type AgeBand = 'adult' | 'child' | 'infant' | 'elderly';

export type Tourist = {
  id: string;
  booking_id: string;
  full_name: string;
  phone: string | null;
  nationality: string | null;
  age_band: AgeBand;
  gender: string | null;
  is_lead: boolean;
  seat_note: string | null;
  sort_order: number;
  needs_assistance: boolean;
  assistance_note: string | null;
  tourist_private?: TouristPrivate | null;
};

export type TouristPrivate = {
  tourist_id: string;
  passport_no: string | null;
  date_of_birth: string | null;
  email: string | null;
  medical_notes: string | null;
  dietary_notes: string | null;
};

export type PickupLocation = {
  id: string;
  name: string;
  area: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  active: boolean;
};

export type PickupRun = {
  id: string;
  service_date: string;
  name: string;
  area_label: string | null;
  latitude: number | null;
  longitude: number | null;
  pickup_time: string | null;
  depart_time: string | null;
  vehicle_id: string | null;
  driver_employee_id: string | null;
  status: 'planned' | 'on_the_road' | 'completed' | 'cancelled';
  sort_order: number;
  notes: string | null;
  auto_created: boolean;
  transport_vehicles?: Pick<TransportVehicle, 'code' | 'name' | 'capacity_pax'> | null;
};

export type TransportVehicle = {
  id: string;
  code: string;
  name: string | null;
  vehicle_type: 'van' | 'minibus' | 'bus' | 'car' | 'pickup_truck' | 'other';
  capacity_pax: number;
  plate_no: string | null;
  default_driver_employee_id: string | null;
  active: boolean;
  notes: string | null;
  sort_order: number;
};

export type CatalogueItem = {
  id: string;
  kind: 'ingredient' | 'equipment';
  name: string;
  category: string | null;
  unit: string;
  default_quantity: number | null;
  times_used: number;
  active: boolean;
};

export type Booking = {
  id: string;
  booking_ref: string;
  service_date: string;
  source_type: SourceType;
  agency_id: string | null;
  external_ref: string | null;
  lead_name: string;
  lead_phone: string | null;
  lead_email: string | null;
  nationality: string | null;
  pax_total: number;
  pax_adults: number;
  pax_children: number;
  pax_elderly: number;
  pax_assisted: number;
  pickup_required: boolean;
  pickup_stop_order: number | null;
  pickup_eta: string | null;
  pickup_location_id: string | null;
  pickup_hotel_name: string | null;
  pickup_area: string | null;
  pickup_latitude: number | null;
  pickup_longitude: number | null;
  pickup_time: string | null;
  pickup_group_id: string | null;
  status: BookingStatus;
  special_requests: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  tourists?: Tourist[];
  agencies?: Pick<Agency, 'id' | 'name' | 'source_type'> | null;
};

export type AssignmentStatus = 'planned' | 'boarding' | 'departed' | 'returned' | 'cancelled';

export type BoatAssignment = {
  id: string;
  service_date: string;
  boat_id: string;
  trip_no: number;
  departure_time: string | null;
  return_time: string | null;
  captain_employee_id: string | null;
  guide_employee_id: string | null;
  status: AssignmentStatus;
  locked: boolean;
  notes: string | null;
};

export type TripBooking = {
  id: string;
  assignment_id: string;
  booking_id: string;
  assigned_at: string;
};

export type BoardingStatus = 'pending' | 'arrived' | 'no_show';
export type ActivityStatus = 'pending' | 'joined' | 'absent';

export type ActivityType = {
  code: string;
  name: string;
  description: string | null;
  sort_order: number;
  active: boolean;
};

export type ManifestRow = {
  passenger_id: string;
  assignment_id: string;
  booking_id: string;
  tourist_id: string;
  boarding_status: BoardingStatus;
  boarded_at: string | null;
  activity_code: string | null;
  activity_status: ActivityStatus;
  returned: boolean;
  note: string | null;
  full_name: string;
  phone: string | null;
  age_band: AgeBand;
  is_lead: boolean;
  nationality: string | null;
  needs_assistance: boolean;
  assistance_note: string | null;
  booking_ref: string;
  lead_name: string;
  group_size: number;
  service_date: string;
  boat_id: string;
  boat_code: string;
  boat_name: string | null;
};

export type PurchaseRequestStatus = 'draft' | 'submitted' | 'buying' | 'completed' | 'cancelled';
export type PurchaseItemStatus = 'pending' | 'bought' | 'unavailable';

export type PurchaseRequestItem = {
  id: string;
  request_id: string;
  item_name: string;
  quantity: number;
  unit: string;
  note: string | null;
  purchase_status: PurchaseItemStatus;
  purchased_quantity: number | null;
  actual_cost: number | null;
  supplier: string | null;
  purchased_by: string | null;
  purchased_at: string | null;
  purchase_note: string | null;
  sort_order: number;
};

export type PurchaseRequest = {
  id: string;
  request_no: string;
  origin: 'kitchen' | 'boat' | 'bar' | 'office' | 'other';
  needed_for_date: string;
  pax_count: number;
  purpose: string | null;
  status: PurchaseRequestStatus;
  notes: string | null;
  requested_by: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  cancelled_reason: string | null;
  created_at: string;
  purchase_request_items?: PurchaseRequestItem[];
};

export type NotificationRule = {
  code: string;
  name: string;
  description: string | null;
  department_code: string | null;
  channel: string;
  enabled: boolean;
  target_label: string | null;
  sort_order: number;
};

export type OutboundMessage = {
  id: string;
  rule_code: string | null;
  department_code: string | null;
  channel: string;
  service_date: string | null;
  title: string;
  body: string;
  reference_type: string | null;
  reference_id: string | null;
  status: 'queued' | 'sent' | 'skipped' | 'failed';
  created_at: string;
  sent_at: string | null;
  send_note: string | null;
};

export type OperationsEvent = {
  id: string;
  service_date: string;
  department_code: string | null;
  event_code: string;
  subject: string | null;
  detail: string | null;
  severity: 'info' | 'warning' | 'alert';
  occurred_at: string;
  actor_id: string | null;
};

export type OperationsCheckpoint = {
  code: string;
  name: string;
  department_code: string | null;
  event_code: string;
  scope: 'per_boat' | 'per_day';
  due_time: string;
  enabled: boolean;
  sort_order: number;
};

export type DayStatusRow = {
  checkpoint_code: string;
  checkpoint_name: string;
  department_code: string | null;
  subject: string | null;
  assignment_id: string | null;
  due_time: string;
  done: boolean;
  done_at: string | null;
  overdue: boolean;
  detail: string | null;
};

export type DepartmentBadge = {
  department_code: string;
  count: number;
  label: string;
};

export type BookingHistoryRow = {
  id: string;
  action: string;
  entity_type: string;
  actor_name: string;
  reason: string | null;
  created_at: string;
  summary: string | null;
};

export type TripType = 'island_run' | 'extra_run' | 'emergency' | 'maintenance_run' | 'other';

export type BoatTrip = {
  id: string;
  service_date: string;
  boat_id: string;
  trip_type: TripType;
  assignment_id: string | null;
  departure_time: string | null;
  return_time: string | null;
  pax_count: number;
  purpose: string | null;
  notes: string | null;
  auto_generated: boolean;
  created_at: string;
  boats?: Pick<Boat, 'code' | 'name'> | null;
};

export type FuelPurchase = {
  id: string;
  purchase_date: string;
  litres: number;
  price_per_litre: number;
  total_cost: number;
  supplier: string | null;
  fuel_type: 'petrol' | 'diesel';
  collected_by_employee_id: string | null;
  notes: string | null;
  created_at: string;
};

export type FuelReconciliationRow = {
  boat_id: string;
  boat_code: string;
  trips: number;
  emergency_trips: number;
  pax_carried: number;
  litres_per_trip: number;
  estimated_litres: number;
  estimated_share_pct: number;
  estimated_cost: number;
};

export type FuelPeriodTotals = {
  litres_bought: number;
  cost_bought: number;
  litres_estimated: number;
  variance_litres: number;
  variance_pct: number | null;
  trips: number;
};

export type MissingItemStatus = 'missing' | 'found' | 'written_off';

export type MissingItem = {
  id: string;
  item_name: string;
  category: string;
  quantity: number;
  missing_on: string;
  noticed_location: string | null;
  boat_id: string | null;
  remarks: string | null;
  estimated_value: number | null;
  status: MissingItemStatus;
  found_on: string | null;
  found_remarks: string | null;
  reported_by: string | null;
  created_at: string;
  boats?: Pick<Boat, 'code'> | null;
};

export type AttendanceLogRow = {
  id: string;
  service_date: string;
  assignment_id: string | null;
  boat_code: string | null;
  tourist_name: string | null;
  booking_ref: string | null;
  action: string;
  to_value: string | null;
  actor_name: string | null;
  created_at: string;
};
