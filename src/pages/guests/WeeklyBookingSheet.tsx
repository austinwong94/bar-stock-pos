import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useSharedRefresh } from '../../lib/useSharedRefresh';
import { sheetWeekStart, shiftSheetDate } from '../../lib/bookingSheetView';
import type { DailyBooking } from '../../lib/bookingOperations';
import BookingSpreadsheet, { type SheetDay } from './BookingSpreadsheet';

export default function WeeklyBookingSheet({date,onDirty,onBusy,onDraftSafe,onHistory,onAccounts}:{date:string;onDirty:(v:boolean)=>void;onBusy:(v:boolean)=>void;onDraftSafe:(v:boolean)=>void;onHistory:(b:DailyBooking)=>void;onAccounts:(date:string)=>void}){
  const start=sheetWeekStart(date),[days,setDays]=useState<SheetDay[]>([]),[loading,setLoading]=useState(true),seq=useRef(0);
  const reload=useCallback(async()=>{const token=++seq.current;const rows=await Promise.all(Array.from({length:7},async(_,i)=>{const d=shiftSheetDate(start,i);try{const {data,error}=await supabase.rpc('read_daily_booking_sheet',{p_date:d});return {date:d,sheet:error?null:data,error:error?.message};}catch(e){return {date:d,sheet:null,error:(e as Error).message};}}));if(token===seq.current){setDays(rows);setLoading(false);}},[start]);
  useEffect(()=>{setLoading(true);void reload();return()=>{seq.current++;};},[reload]);
  useSharedRefresh(reload,{tables:['bookings','boat_assignments','pickup_groups','trip_bookings','booking_accounts','booking_payments'],intervalMs:15000});
  if(loading)return <p role="status" className="py-6 text-sm text-muted">Loading Week...</p>;
  return <BookingSpreadsheet key={start} date={date} days={days} reload={reload} onDirty={onDirty} onBusy={onBusy} onDraftSafe={onDraftSafe} onHistory={onHistory} onAccounts={onAccounts}/>;
}
