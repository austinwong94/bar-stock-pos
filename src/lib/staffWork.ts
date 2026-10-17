import { z } from 'zod';
import { usageDate } from './dailyUsageDraft';

const id=z.string().min(1).max(200),uuid=z.string().uuid(),day=z.string().refine(usageDate),stamp=z.string().refine(v=>Number.isFinite(Date.parse(v))),version=z.number().int().positive();
export const leaveTypes=['annual','medical','unpaid','other'] as const;
export const leaveLabels:Record<typeof leaveTypes[number],[string,string]>={annual:['Annual','Tahunan'],medical:['Medical','Sakit'],unpaid:['Unpaid','Tanpa Gaji'],other:['Other','Lain']};
export const statusLabels:Record<'pending'|'approved'|'rejected'|'withdrawn'|'cancel_requested'|'cancelled',[string,string]>={pending:['Pending Approval','Menunggu Kelulusan'],approved:['Approved','Diluluskan'],rejected:['Rejected','Ditolak'],withdrawn:['Withdrawn','Ditarik Balik'],cancel_requested:['Cancellation Pending','Pembatalan Tertangguh'],cancelled:['Cancelled','Dibatalkan']};
export const portionLabels:Record<'full'|'am'|'pm',[string,string]>={full:['Full Day','Sehari Penuh'],am:['Morning','Pagi'],pm:['Afternoon','Petang']};
const leaveFormSchema=z.object({start_date:day,end_date:day,leave_type:z.enum(leaveTypes),portion:z.enum(['full','am','pm']),reason:z.string().max(500)}).strict().refine(r=>r.end_date>=r.start_date&&daySpan(r.start_date,r.end_date)<=366&&(r.portion==='full'||r.start_date===r.end_date));
const row=z.object({id:uuid,version}).strict(),decision=row.extend({note:z.string().max(500)}).strict();
const actions={
 clock_in:z.object({expected_open:z.null()}).strict(),clock_out:row,leave_apply:leaveFormSchema,leave_withdraw:row,leave_cancel_request:row,
 leave_approve:decision,leave_reject:decision.refine(r=>!!r.note.trim()),leave_cancel:decision,leave_keep:decision.refine(r=>!!r.note.trim()),
 attendance_correct:row.extend({clock_in:stamp,clock_out:stamp.nullable(),reason:z.string().trim().min(1).max(500)}).strict().refine(r=>r.clock_out===null||Date.parse(r.clock_out)>Date.parse(r.clock_in)),
};
export type StaffAction=keyof typeof actions;
export const staffPermission=(action:StaffAction)=>['leave_approve','leave_reject','leave_cancel','leave_keep'].includes(action)?'staff.leave.approve':action==='attendance_correct'?'staff.attendance.manage':'staff.self';
export type StaffAttempt={version:1;action:StaffAction;record:Record<string,unknown>;operationId:string;createdAt:string};
export type LeaveForm=z.infer<typeof leaveFormSchema>;
export function daySpan(start:string,end:string){return Math.round((Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000)+1;}
export function requestedDays(r:Pick<LeaveForm,'start_date'|'end_date'|'portion'>){return r.portion==='full'?daySpan(r.start_date,r.end_date):0.5;}
export const timeSchema=z.object({id,staff_id:id,staff_name:z.string().min(1),clock_in:stamp,clock_out:stamp.nullable(),version,correction_count:z.number().int().nonnegative(),created_at:stamp,updated_at:stamp}).passthrough().refine(r=>r.clock_out===null||Date.parse(r.clock_out)>Date.parse(r.clock_in));
export const leaveSchema=z.object({id,staff_id:id,staff_name:z.string().min(1),start_date:day,end_date:day,leave_type:z.enum(leaveTypes),portion:z.enum(['full','am','pm']),reason:z.string().nullable(),status:z.enum(['pending','approved','rejected','withdrawn','cancel_requested','cancelled']),version,submitted_at:stamp,updated_at:stamp,decided_by:id.nullish(),decided_by_name:z.string().nullish(),decided_at:stamp.nullish(),decision_note:z.string().nullish()}).passthrough().refine(r=>r.end_date>=r.start_date&&daySpan(r.start_date,r.end_date)<=366&&(r.portion==='full'||r.start_date===r.end_date));
export type StaffTime=z.infer<typeof timeSchema>;
export type StaffLeave=z.infer<typeof leaveSchema>;
const workSchema=z.object({server_time:stamp,team:z.boolean(),attendance:z.array(timeSchema),leaves:z.array(leaveSchema),people:z.array(z.object({id,name:z.string()}))});
export type StaffWork=z.infer<typeof workSchema>;
export function readStaffWork(value:unknown,team:boolean,actor:string):StaffWork{
 try{const d=workSchema.parse(value);if(d.team!==team||(!team&&(d.people.length||[...d.attendance,...d.leaves].some(r=>r.staff_id!==actor)))||[d.attendance,d.leaves,d.people].some(rows=>new Set(rows.map(r=>r.id)).size!==rows.length))throw Error();
 const open=d.attendance.filter(r=>r.clock_out===null);if(new Set(open.map(r=>r.staff_id)).size!==open.length||d.attendance.some(r=>Date.parse(r.clock_in)>Date.parse(d.server_time)||(r.clock_out!==null&&Date.parse(r.clock_out)>Date.parse(d.server_time))))throw Error();return d;
 }catch{throw Error('Staff records are incomplete. Refresh before recording.');}
}
export function staffRecord(action:StaffAction,value:unknown){return actions[action].parse(value) as Record<string,unknown>;}
export const staffRecoveryKey=(project:string|undefined,actor:string)=>`staff-work:${project??'review'}:${actor}`;
export function readStaffAttempt(raw:string|null):StaffAttempt|null{
 if(raw===null)return null;try{const d=z.object({version:z.literal(1),action:z.enum(Object.keys(actions) as [StaffAction,...StaffAction[]]),record:z.record(z.unknown()),operationId:uuid,createdAt:stamp}).strict().parse(JSON.parse(raw));staffRecord(d.action,d.record);return d;}catch{throw Error('This staff submission could not be read. Keep this device and ask a manager.');}
}
export function writeStaffAttempt(store:Pick<Storage,'getItem'|'setItem'|'removeItem'>,key:string,next:StaffAttempt|null,expected:string|null){
 if(store.getItem(key)!==expected)throw Error('This staff submission changed in another tab. Reopen Staff.');const raw=next?JSON.stringify(next):null;
 if(raw){readStaffAttempt(raw);store.setItem(key,raw);}else store.removeItem(key);if(store.getItem(key)!==raw)throw Error('Staff submission could not be kept on this device. Reopen Staff.');return raw;
}
export function readStaffResult(value:unknown,attempt:StaffAttempt,actor:string){
 const d=z.object({operation_id:uuid,action:z.string(),record:z.unknown()}).parse(value);if(d.operation_id!==attempt.operationId||d.action!==attempt.action)throw Error('Staff confirmation is uncertain. Check the same submission.');
 const r=attempt.action.startsWith('clock_')||attempt.action==='attendance_correct'?timeSchema.parse(d.record):leaveSchema.parse(d.record);
 if(['clock_in','clock_out','leave_apply','leave_withdraw','leave_cancel_request'].includes(attempt.action)&&r.staff_id!==actor)throw Error('Staff confirmation belongs to another account.');
 if(attempt.record.id!==undefined&&r.id!==attempt.record.id)throw Error('Staff confirmation belongs to another record.');return r;
}
export function malaysiaTime(value:string,lang:'en'|'ms',date=false){return new Intl.DateTimeFormat(lang==='ms'?'ms-MY':'en-GB',{timeZone:'Asia/Kuala_Lumpur',...(date?{dateStyle:'medium'}:{}),timeStyle:'short'}).format(new Date(value));}
export function localTimeInput(value:string){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(value)).replace(' ','T');}
export function inputToStamp(value:string){return new Date(value+'+08:00').toISOString();}
export function workedMinutes(r:StaffTime,now:string){return Math.max(0,Math.floor((Date.parse(r.clock_out??now)-Date.parse(r.clock_in))/60000));}
