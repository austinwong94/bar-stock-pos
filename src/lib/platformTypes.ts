export type DepartmentCode =
  | 'bar'
  | 'maintenance'
  | 'guests'
  | 'fleet'
  | 'boarding'
  | 'activities'
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
export type AgeBand = 'adult' | 'child' | 'infant';

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

export type PickupGroup = {
  id: string;
  service_date: string;
  name: string;
  area_label: string | null;
  latitude: number | null;
  longitude: number | null;
  pickup_time: string | null;
  vehicle: string | null;
  driver_employee_id: string | null;
  notes: string | null;
  auto_created: boolean;
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
  booking_ref: string;
  lead_name: string;
  group_size: number;
  service_date: string;
  boat_id: string;
  boat_code: string;
  boat_name: string | null;
};
