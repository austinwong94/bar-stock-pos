import { db, can, currentUserIdRef, userHasPermission } from './demoBackend';
import { staffRecord, type StaffAction } from './staffWork';
import { malaysiaDateInputValue } from './format';

function fail(message:string,code='P0001'):never{throw Object.assign(Error(message),{code});}
const ensure=()=>{for(const table of ['staff_time_entries','staff_leave_requests','staff_work_operations'])db[table]??=[];};
const actor=()=>currentUserIdRef.value;
const today=()=>malaysiaDateInputValue(new Date());
const allowed=(permission:string)=>{if(!can(permission))fail('Staff access required.','42501');};
const snapshot=(p:Record<string,any>)=>structuredClone(p);
export const demoStaffHandlers:Record<string,(p:any)=>any>={
 read_staff_work_history:({p_id,p_kind})=>{
  ensure();const record=(p_kind==='time'?db.staff_time_entries:p_kind==='leave'?db.staff_leave_requests:[]).find(r=>r.id===p_id);
  if(record?.staff_id===actor())allowed('staff.self');else allowed(p_kind==='time'?'staff.attendance.manage':'staff.leave.approve');
  if(!record)fail('Staff record not found.');return snapshot(db.audit_logs.filter(a=>a.entity_id===p_id&&a.entity_type===(p_kind==='time'?'staff_time':'staff_leave')).map(a=>({action:a.action,created_at:a.created_at,actor_name:a.after_json.actor_name,before_record:a.before_json,after_record:a.after_json.record,submission:a.after_json.submission})));
 },
 read_staff_work:({p_from,p_to,p_team=false})=>{
  ensure();if(p_team){if(!['staff.team.view','staff.leave.approve','staff.attendance.manage'].some(can))fail('Staff team access required.','42501');}else allowed('staff.self');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(p_from)||!/^\d{4}-\d{2}-\d{2}$/.test(p_to)||p_to<p_from||(Date.parse(p_to)-Date.parse(p_from))/86400000>92)fail('Choose a period up to three months.');
  const times=(!p_team||can('staff.team.view')||can('staff.attendance.manage'))?db.staff_time_entries.filter(r=>(p_team||r.staff_id===actor())&&((malaysiaDateInputValue(new Date(r.clock_in))>=p_from&&malaysiaDateInputValue(new Date(r.clock_in))<=p_to)||r.clock_out===null)):[];
  const leaves=db.staff_leave_requests.filter(r=>(p_team||r.staff_id===actor())&&(r.start_date<=p_to&&r.end_date>=p_from||['pending','cancel_requested'].includes(r.status)||Date.parse(r.updated_at)>=Date.now()-86400000||!p_team&&r.end_date>=today()&&r.status==='approved')).map(r=>!p_team||can('staff.leave.approve')||r.staff_id===actor()?r:{...r,reason:null,decision_note:null});
  return snapshot({server_time:new Date().toISOString(),team:p_team,attendance:times.sort((a,b)=>b.clock_in.localeCompare(a.clock_in)),leaves:leaves.sort((a,b)=>b.submitted_at.localeCompare(a.submitted_at)),people:p_team?db.profiles.filter(p=>userHasPermission(p.id,'staff.self')).map(p=>({id:p.id,name:p.full_name})):[]});
 },
 mutate_staff_work:({p_operation_id,p_action,p_record})=>{
  ensure();const action=p_action as StaffAction;
  if(['leave_approve','leave_reject','leave_cancel','leave_keep'].includes(action))allowed('staff.leave.approve');else if(action==='attendance_correct')allowed('staff.attendance.manage');else allowed('staff.self');
  const profile=db.profiles.find(p=>p.id===actor());if(!profile?.full_name?.trim())fail('Your staff account needs a name.');
  const intent=JSON.stringify([action,p_record]),prior=db.staff_work_operations.find(p=>p.actor_id===actor()&&p.operation_id===p_operation_id);
  if(prior){if(prior.payload!==intent)fail('This submission already has different details.');return snapshot(prior.result);}
  if(!p_operation_id||!p_action)fail('Submission details required.');
  const r=staffRecord(action,p_record) as any,now=new Date().toISOString();let record:any,before:any=null;
  const stale=()=>fail('Staff record changed. Refresh before recording.','40001');
  if(action==='clock_in'){
   if(db.staff_time_entries.some(t=>t.staff_id===actor()&&t.clock_out===null))stale();
   if(db.staff_leave_requests.some(l=>l.staff_id===actor()&&['approved','cancel_requested'].includes(l.status)&&l.portion==='full'&&l.start_date<=today()&&l.end_date>=today()))fail('You have approved leave today. Ask the PIC to resolve it before clocking in.');
   record={id:crypto.randomUUID(),staff_id:actor(),staff_name:profile.full_name,clock_in:now,clock_out:null,version:1,correction_count:0,created_at:now,updated_at:now};db.staff_time_entries.push(record);
  }else if(action==='clock_out'||action==='attendance_correct'){
   record=db.staff_time_entries.find(t=>t.id===r.id);if(!record)fail('Attendance not found.');
   if(action==='clock_out'&&record.staff_id!==actor())fail('This is not your attendance.','42501');if(record.version!==r.version)stale();before=snapshot(record);
   const start=action==='clock_out'?record.clock_in:r.clock_in,end=action==='clock_out'?now:r.clock_out;
   if(action==='clock_out'&&record.clock_out!==null)stale();
   if(Date.parse(start)>Date.parse(now)||(end!==null&&(Date.parse(end)<=Date.parse(start)||Date.parse(end)>Date.parse(now))))fail('Check the attendance times.');
   if(action==='attendance_correct'&&db.staff_time_entries.some(t=>t.staff_id===record.staff_id&&t.id!==record.id&&Date.parse(t.clock_in)<(end===null?Infinity:Date.parse(end))&&(t.clock_out===null?Infinity:Date.parse(t.clock_out))>Date.parse(start)))fail('These times overlap another shift.');
   Object.assign(record,{clock_in:start,clock_out:end,version:record.version+1,correction_count:(record.correction_count??0)+(action==='attendance_correct'?1:0),updated_at:now});
  }else if(action==='leave_apply'){
   if(db.staff_leave_requests.some(l=>l.staff_id===actor()&&['pending','approved','cancel_requested'].includes(l.status)&&l.start_date<=r.end_date&&l.end_date>=r.start_date&&(r.portion==='full'||l.portion==='full'||r.portion===l.portion)))fail('You already have a request for these dates. Check the existing request.');
   record={...r,id:crypto.randomUUID(),staff_id:actor(),staff_name:profile.full_name,status:'pending',version:1,submitted_at:now,updated_at:now,decided_by:null,decided_by_name:null,decided_at:null,decision_note:null};db.staff_leave_requests.push(record);
  }else{
   record=db.staff_leave_requests.find(l=>l.id===r.id);if(!record)fail('Leave request not found.');
   if(['leave_withdraw','leave_cancel_request'].includes(action)){if(record.staff_id!==actor())fail('This is not your leave request.','42501');}
   else if(record.staff_id===actor())fail('Another authorised PIC must decide your leave.','42501');
   if(record.version!==r.version)stale();
   const expected=['leave_withdraw','leave_approve','leave_reject'].includes(action)?'pending':action==='leave_cancel_request'?'approved':'cancel_requested';if(record.status!==expected)stale();before=snapshot(record);
   const statuses={leave_withdraw:'withdrawn',leave_cancel_request:'cancel_requested',leave_approve:'approved',leave_reject:'rejected',leave_cancel:'cancelled',leave_keep:'approved'} as Record<string,string>;
   Object.assign(record,{status:statuses[action],version:record.version+1,updated_at:now});
   if(!['leave_withdraw','leave_cancel_request'].includes(action))Object.assign(record,{decided_by:actor(),decided_by_name:profile.full_name,decided_at:now,decision_note:r.note.trim()});
  }
  const result=snapshot({operation_id:p_operation_id,action,record});db.staff_work_operations.push({actor_id:actor(),operation_id:p_operation_id,payload:intent,result,created_at:now});
  db.audit_logs.push({id:crypto.randomUUID(),actor_id:actor(),action:'staff_'+action,entity_type:['clock_in','clock_out','attendance_correct'].includes(action)?'staff_time':'staff_leave',entity_id:record.id,before_json:before,after_json:{actor_name:profile.full_name,record:snapshot(record),submission:snapshot(r),operation_id:p_operation_id},created_at:now});return result;
 },
};
