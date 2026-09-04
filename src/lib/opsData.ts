import { supabase } from './supabase';
import type {
  ActivityType,
  Agency,
  Boat,
  Employee,
  PickupLocation,
} from './platformTypes';

export async function loadBoats(includeInactive = false) {
  let query = supabase.from('boats').select('*').order('sort_order').order('code');
  if (!includeInactive) query = query.neq('status', 'inactive');
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Boat[];
}

export async function loadEmployees(jobTypes?: Employee['job_type'][]) {
  let query = supabase.from('employees').select('*').eq('active', true).order('full_name');
  if (jobTypes?.length) query = query.in('job_type', jobTypes);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Employee[];
}

export async function loadAgencies() {
  const { data, error } = await supabase.from('agencies').select('*').eq('active', true).order('name');
  if (error) throw error;
  return (data ?? []) as Agency[];
}

export async function loadPickupLocations() {
  const { data, error } = await supabase
    .from('pickup_locations')
    .select('*')
    .eq('active', true)
    .order('name');
  if (error) throw error;
  return (data ?? []) as PickupLocation[];
}

export async function loadActivityTypes() {
  const { data, error } = await supabase
    .from('activity_types')
    .select('*')
    .eq('active', true)
    .order('sort_order');
  if (error) throw error;
  return (data ?? []) as ActivityType[];
}

export const sourceLabels: Record<string, string> = {
  agent: 'Agent',
  ota: 'OTA',
  in_house: 'In-house',
  walk_in: 'Walk-in',
  other: 'Other',
};

export const bookingStatusLabels: Record<string, string> = {
  draft: 'Draft',
  confirmed: 'Confirmed',
  arrived: 'Arrived',
  cancelled: 'Cancelled',
  no_show: 'No show',
};

export function readErrorMessage(error: unknown, fallback = 'Something went wrong.') {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

export function todayIso() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
