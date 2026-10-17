import type { Booking, BoatAssignment, Employee } from './platformTypes';

export type TravelCounts = { adults: number; children: number; infants: number; tour_leaders: number; tour_guides: number };
export const countLabels: Record<keyof TravelCounts, string> = { adults: 'Adults', children: 'Children', infants: 'Infants', tour_leaders: 'TL (Local)', tour_guides: 'TG (China)' };
export const countKeys = Object.keys(countLabels) as Array<keyof TravelCounts>;
export const travelTotal = (counts: TravelCounts) => countKeys.reduce((sum, key) => sum + counts[key], 0);
export function bookingCounts(b: Booking): TravelCounts {
  return { adults: b.pax_adults + (b.pax_elderly || 0), children: b.pax_children, infants: b.pax_infants || 0, tour_leaders: b.pax_tour_leaders || 0, tour_guides: b.pax_tour_guides || 0 };
}
export const emptyCounts: TravelCounts = { adults: 0, children: 0, infants: 0, tour_leaders: 0, tour_guides: 0 };

export type DailyBooking = Booking & {
  tour_name: string; dropoff_location: string; planning_group: 'standard' | 'xhs' | 'private';
  ops_notes: string; guide_employee_id: string | null; assignment_id: string | null;
  updated_by_name: string | null; creator_name: string | null;
};
export type PlanningBoat = BoatAssignment & { code: string; capacity_pax: number; staff_pax: number; crew_employee_ids: string[]; guest_pax: number; updated_at: string };
export type DailySheet = {
  contacts_hidden?: boolean; names_hidden?: boolean;
  available_boats: { id: string; code: string; capacity_pax: number }[];
  bookings: DailyBooking[]; boats: PlanningBoat[]; employees: Pick<Employee, 'id' | 'full_name' | 'job_type' | 'phone'>[];
  vehicles: { id: string; code: string; name: string; capacity_pax: number }[];
  runs: { id: string; name: string; vehicle_id: string | null; driver_employee_id: string | null; status: string; updated_at: string }[];
  agencies: { id: string; name: string }[]; restricted: boolean;
};

export type CommissionMethod = 'percent' | 'fixed' | 'per_pax';
export type ReferralParty = { id: string; name: string; method: CommissionMethod | null; rate: number | null; is_default: boolean; active: boolean; updated_at: string };
export type BookingAccount = {
  booking_id: string; amount_due: number | null; invoice_number: string; remarks: string;
  payment_done?: boolean | null;
  referrer_id: string | null; commission_method: CommissionMethod | null; commission_rate: number | null;
  commission_pax: number; commission_base: number | null; commission_paid: number;
  updated_at: string; updated_by_name?: string;
};
export type BookingPayment = { id: string; booking_id: string; payment_date: string; amount: number; kind: 'receipt' | 'refund'; reference: string; note: string; recorded_by_name: string; created_at: string; voided_at: string | null; void_reason: string | null };
export const moneyCents = (value: number) => Math.round((value + Number.EPSILON) * 100);
export function accountTotals(account: BookingAccount | null, payments: BookingPayment[]) {
  const paid = payments.filter(p => !p.voided_at).reduce((n, p) => n + moneyCents(p.amount) * (p.kind === 'refund' ? -1 : 1), 0);
  const due = account?.amount_due == null ? null : moneyCents(account.amount_due);
  const commission = !account?.commission_method || account.commission_rate == null ? null
    : account.commission_method === 'fixed' ? moneyCents(account.commission_rate)
    : account.commission_method === 'per_pax' ? moneyCents(account.commission_rate) * account.commission_pax
    : account.commission_base == null ? null : Math.round(moneyCents(account.commission_base) * account.commission_rate / 100);
  return { paid: paid / 100, balance: due == null ? null : (due - paid) / 100, commission: commission == null ? null : commission / 100,
    commissionBalance: commission == null ? null : (commission - moneyCents(account?.commission_paid || 0)) / 100,
    status: due == null ? 'Total Not Entered' : paid > due ? 'Overpaid' : paid === due ? 'Paid' : paid > 0 ? 'Partial' : 'Unpaid' };
}
export function bookingPaymentDone(account: BookingAccount | null, payments: BookingPayment[]) {
  return account?.payment_done ?? ['Paid', 'Overpaid'].includes(accountTotals(account, payments).status);
}
