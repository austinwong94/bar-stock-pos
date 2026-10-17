import { pickupDistance } from './pickupPlanning';
import type { DailyBooking, DailySheet, PlanningBoat } from './bookingOperations';

export type BoatPlanLine = { booking_id: string; assignment_id: string | null };
export function extraGuideSeats(boat:PlanningBoat,bookings:DailyBooking[],candidate:DailyBooking) {
  if(!candidate.guide_employee_id)return 0;
  const staff=[boat.captain_employee_id,boat.guide_employee_id,...boat.crew_employee_ids,...bookings.map(b=>b.guide_employee_id)];
  return staff.includes(candidate.guide_employee_id)?0:1;
}
export function plannedStaff(boat:PlanningBoat,bookings:DailyBooking[]) {
  return new Set([boat.captain_employee_id,boat.guide_employee_id,...boat.crew_employee_ids,...bookings.map(b=>b.guide_employee_id)].filter(Boolean)).size
    +(boat.captain_employee_id?0:1)+(boat.crew_employee_ids.length?0:1);
}
export function suggestBoats(sheet:DailySheet):BoatPlanLine[] {
  const active=sheet.bookings.filter(b=>!['cancelled','no_show'].includes(b.status));
  const groups=new Map(sheet.boats.map(a=>[a.id,active.filter(b=>b.assignment_id===a.id)]));
  const waiting=active.filter(b=>!b.assignment_id).sort((a,b)=>Number(b.planning_group==='xhs')-Number(a.planning_group==='xhs')||(a.pickup_area??'').localeCompare(b.pickup_area??'')||b.pax_total-a.pax_total);
  return waiting.map(b=>{
    const candidates=sheet.boats.filter(a=>!a.locked&&a.status==='planned').map(a=>{
      const members=groups.get(a.id)!;const used=members.reduce((n,b)=>n+b.pax_total,0);
      const free=a.capacity_pax-used-plannedStaff(a,[...members,b]);
      const distances=members.map(x=>pickupDistance(b,x)).filter((d):d is number=>d!==null);
      const sameArea=members.some(x=>b.pickup_area&&x.pickup_area?.toLowerCase()===b.pickup_area.toLowerCase());
      const proximity=distances.length?Math.min(...distances)*5:sameArea?0:members.length?20:12;
      const preference=b.planning_group==='xhs'?(members.some(x=>x.planning_group==='xhs')?-10:members.length?10:0):0;
      const privateConflict=members.length>0&&(b.planning_group==='private'||members.some(x=>x.planning_group==='private'));
      return {a,members,free,score:proximity+preference+Math.max(0,free-b.pax_total)/100,privateConflict};
    }).filter(x=>x.free>=b.pax_total&&!x.privateConflict).sort((a,b)=>a.score-b.score||a.a.code.localeCompare(b.a.code));
    const target=candidates[0];if(target)target.members.push(b);
    return {booking_id:b.id,assignment_id:target?.a.id??null};
  });
}
