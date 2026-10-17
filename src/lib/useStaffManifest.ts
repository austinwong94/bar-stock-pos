import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { useSharedRefresh } from './useSharedRefresh';
import { readErrorMessage } from './opsData';
import type { ManifestRow } from './platformTypes';

export type AttendanceAction = 'boarding' | 'activity' | 'joined' | 'returned';
export function attendanceSnapshot(row: ManifestRow) {
  return { id: row.passenger_id, assignment_id: row.assignment_id, boarding_status: row.boarding_status, activity_code: row.activity_code, activity_status: row.activity_status, returned: row.returned };
}
export function groupByBooking(rows: ManifestRow[]) {
  const map = new Map<string, {bookingRef: string; leadName: string; rows: ManifestRow[]}>();
  rows.forEach(row => {
    const key = `${row.assignment_id}:${row.booking_id}`;
    const group = map.get(key) ?? {bookingRef: row.booking_ref, leadName: row.lead_name, rows: []};
    group.rows.push(row); map.set(key, group);
  });
  return [...map.values()];
}
export function guestMatches(row: ManifestRow, search: string) {
  const term = search.trim().toLocaleLowerCase();
  return !term || [row.full_name,row.lead_name,row.booking_ref,row.phone,row.boat_code].some(value => value?.toLocaleLowerCase().includes(term));
}

export function useStaffManifest(date: string, arrivedOnly = false) {
  const [rows, setRows] = useState<ManifestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const generation = useRef(0);
  const writing = useRef(false);
  const retry = useRef<{payload: string; token: string} | null>(null);
  const refresh = useCallback(async () => {
    const version = ++generation.current;
    try {
      const result = await supabase.rpc('read_staff_manifest',{p_date:date,p_arrived_only:arrivedOnly});
      if(version !== generation.current) return;
      if(result.error) throw result.error;
      setRows((result.data ?? []) as ManifestRow[]); setError('');
    } catch (e) {if(version === generation.current) setError(readErrorMessage(e,'Could not load attendance.'));}
    finally {if(version === generation.current) setLoading(false);}
  }, [date,arrivedOnly]);
  useEffect(() => {
    setRows([]); setLoading(true); setNotice(''); void refresh();
    return () => {generation.current++;};
  }, [refresh]);
  useSharedRefresh(refresh,{tables:['boat_assignments','trip_bookings','trip_passengers','tourists']});

  async function update(guests: ManifestRow[], action: AttendanceAction, value: string | boolean | null, message: string) {
    if (writing.current || !guests.length) return false;
    writing.current = true; setBusy(true); setError(''); setNotice('');
    const expected = guests.map(attendanceSnapshot);
    const payload = JSON.stringify([date,action,value,expected]);
    if(retry.current?.payload !== payload) retry.current={payload,token:crypto.randomUUID()};
    try {
      const result = await supabase.rpc('record_staff_attendance_checked',{p_date:date,p_action:action,p_value:value,p_expected:expected,p_request_id:retry.current.token});
      if(result.error) throw result.error;
      retry.current=null;
      await refresh(); setNotice(message); return true;
    } catch(e) {setError(readErrorMessage(e,'Could not save attendance.')); return false;}
    finally {writing.current=false; setBusy(false);}
  }
  return {rows,loading,busy,error,notice,refresh,update};
}
