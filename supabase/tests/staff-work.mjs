import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withDatabase} from '../../scripts/release/database.mjs';
const owner='11111111-1111-1111-1111-111111111111',cook='88888888-8888-8888-8888-888888888888',buyer='99999999-9999-9999-9999-999999999999',account='55555555-5555-5555-5555-555555555555',agent='33333333-3333-3333-3333-333333333333',anonymous='66666666-6666-6666-6666-666666666666';
const val=async(db,sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]??{})[0];
const as=async(db,id)=>{await db.query('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);await db.query(id?'set role authenticated':'set role anon');};
const denied=fn=>assert.rejects(fn,e=>e.code==='42501');
export async function runStaffWorkTests(){await withDatabase(async(db,connect)=>{
 await as(db,cook);
 const mutate=(action,record,key=randomUUID(),client=db)=>val(client,'select mutate_staff_work($1,$2,$3::jsonb)',[key,action,JSON.stringify(record)]);
 const read=(team=false,client=db)=>val(client,'select read_staff_work($1,$2,$3)',[today,today,team]);
 const today=await val(db,"select (now() at time zone 'Asia/Kuala_Lumpur')::date::text"),next=await val(db,'select ($1::date+2)::text',[today]),later=await val(db,'select ($1::date+40)::text',[today]);
 assert.equal(await val(db,"select has_permission('staff.self')"),true);assert.equal(await val(db,"select has_permission('staff.leave.approve')"),false);
 const a=await connect(),b=await connect();await as(a,cook);await as(b,cook);const clockKey=randomUUID();
 const clocks=await Promise.all([mutate('clock_in',{expected_open:null},clockKey,a),mutate('clock_in',{expected_open:null},clockKey,b)]);assert.equal(clocks[0].record.id,clocks[1].record.id);assert.equal(clocks[0].record.staff_id,cook);assert.equal((await read()).attendance.length,1);
 await assert.rejects(()=>mutate('clock_in',{expected_open:null,staff_id:buyer}),/Unknown staff action or fields/);await assert.rejects(()=>mutate('clock_in',{expected_open:null}),e=>e.code==='40001');
 await assert.rejects(()=>mutate('clock_out',{id:randomUUID(),version:1}),e=>e.code==='40001');
 const outKey=randomUUID(),out=await mutate('clock_out',{id:clocks[0].record.id,version:1},outKey);assert.deepEqual(await mutate('clock_out',{id:clocks[0].record.id,version:1},outKey),out);assert(out.record.clock_out);assert.equal((await read()).attendance.length,1);
 const apply={start_date:next,end_date:next,leave_type:'annual',portion:'full',reason:'PRIVATE-STAFF-REASON'},applyKey=randomUUID();const req=await mutate('leave_apply',apply,applyKey);assert.equal(req.record.status,'pending');assert.deepEqual(await mutate('leave_apply',apply,applyKey),req);
 await assert.rejects(()=>mutate('leave_apply',{...apply,reason:'changed'},applyKey),/different details/);await assert.rejects(()=>mutate('leave_apply',apply),/already have/);await denied(()=>read(true));
 await as(db,buyer);assert.equal((await read()).attendance.length,0);assert.equal((await read()).leaves.length,0);await denied(()=>mutate('leave_withdraw',{id:req.record.id,version:1}));await denied(()=>val(db,'select read_staff_work_history($1,$2)',[req.record.id,'leave']));await denied(()=>db.query('select * from staff_leave_requests'));
 await as(db,owner);await val(db,"select admin_set_permission_override($1,'staff.leave.approve','grant')",[buyer]);await as(db,buyer);assert.equal(await val(db,"select has_permission('staff.leave.approve')"),true);assert.equal(await val(db,"select has_permission('staff.attendance.manage')"),false);
 await as(a,owner);await as(b,buyer);const decisions=await Promise.allSettled([mutate('leave_approve',{id:req.record.id,version:1,note:''},randomUUID(),a),mutate('leave_reject',{id:req.record.id,version:1,note:'Dates not available'},randomUUID(),b)]);assert.equal(decisions.filter(r=>r.status==='fulfilled').length,1);assert.equal(decisions.find(r=>r.status==='rejected').reason.code,'40001');
 const approved=decisions.find(r=>r.status==='fulfilled').value;const history=await val(db,'select read_staff_work_history($1,$2)',[req.record.id,'leave']);assert.equal(history.length,2);assert.equal(history[0].actor_name,'Cook Lina');assert.equal(history[1].after_record.version,2);
 await as(db,cook);const originalReplay=await mutate('leave_apply',apply,applyKey);assert.equal(originalReplay.record.status,'pending','Replay returns the original proof without downgrading the decided database row');const ownDate=await val(db,'select read_staff_work($1,$1,false)',[next]);assert.equal(ownDate.leaves[0].status,approved.record.status);
 await as(db,owner);const own=await mutate('leave_apply',{...apply,start_date:later,end_date:later});await denied(()=>mutate('leave_approve',{id:own.record.id,version:1,note:''}));
 await as(db,buyer);const future=await mutate('leave_approve',{id:own.record.id,version:1,note:''});assert((await read(true)).leaves.some(r=>r.id===own.record.id&&r.status==='approved'),'An approved future request remains visible in recent team records');
 await as(db,owner);const cancelReq=await mutate('leave_cancel_request',{id:future.record.id,version:future.record.version});await as(db,buyer);const cancelled=await mutate('leave_cancel',{id:cancelReq.record.id,version:cancelReq.record.version,note:''});assert.equal(cancelled.record.status,'cancelled');await as(db,owner);assert.equal((await val(db,'select read_staff_work_history($1,$2)',[own.record.id,'leave'])).length,4);
 // A team observer gets dates only, not reasons, decision notes or private history.
 await val(db,"select admin_set_permission_override($1,'staff.team.view','grant')",[account]);await as(db,account);const observer=await read(true);assert(observer.leaves.every(l=>l.staff_id===account||(l.reason===null&&l.decision_note===null)));await denied(()=>val(db,'select read_staff_work_history($1,$2)',[req.record.id,'leave']));await denied(()=>mutate('leave_approve',{id:req.record.id,version:1,note:''}));
 await as(db,cook);const half={...apply,start_date:later,end_date:later,portion:'am'},am=await mutate('leave_apply',half),pm=await mutate('leave_apply',{...half,portion:'pm'});assert.notEqual(am.record.id,pm.record.id);await assert.rejects(()=>mutate('leave_apply',{...half,portion:'full'}),/already have/);
 await assert.rejects(()=>mutate('leave_apply',{...half,end_date:next}),/Check leave/);await as(db,owner);await assert.rejects(()=>mutate('leave_reject',{id:am.record.id,version:1,note:''}),/reason/);
 // Manager correction keeps the original ledger and invalidates an older clock-out screen.
 await as(db,cook);const fresh=await mutate('clock_in',{expected_open:null});await as(db,owner);const overlap=await val(db,"select (now()-interval '2 hours')::text");await assert.rejects(()=>mutate('attendance_correct',{id:fresh.record.id,version:1,clock_in:overlap,clock_out:null,reason:'Sample overlap check'}),/overlap/);
 // Direct table reads are private even for the owner; use a known authoritative stamp for the correction.
 const validIn=new Date(Date.parse(out.record.clock_out)+1).toISOString(),correct=await mutate('attendance_correct',{id:fresh.record.id,version:1,clock_in:validIn,clock_out:null,reason:'Missed clock-in (Sample)'});assert.equal(correct.record.correction_count,1);
 await as(db,cook);await assert.rejects(()=>mutate('clock_out',{id:fresh.record.id,version:1}),e=>e.code==='40001');const closed=await mutate('clock_out',{id:fresh.record.id,version:correct.record.version});assert(closed.record.clock_out);const timeHistory=await val(db,'select read_staff_work_history($1,$2)',[fresh.record.id,'time']);assert.equal(timeHistory.length,3);assert.equal(timeHistory[1].submission.reason,'Missed clock-in (Sample)');
 await denied(()=>db.query("update staff_time_entries set clock_in=now() where id=$1",[fresh.record.id]));await denied(()=>db.query('delete from staff_work_operations'));
 // An open shift remains reachable the next day without inventing a second clock-in.
 await as(db,buyer);const overnight=await mutate('clock_in',{expected_open:null});await as(db,owner);
 const previousNight=await val(db,"select (($1::date-1)+time '23:58') at time zone 'Asia/Kuala_Lumpur'",[today]);
 const carried=await mutate('attendance_correct',{id:overnight.record.id,version:1,clock_in:previousNight.toISOString(),clock_out:null,reason:'Sample overnight shift'});
 await as(db,buyer);assert((await read()).attendance.some(r=>r.id===carried.record.id));
 const nextDayOut=await mutate('clock_out',{id:carried.record.id,version:carried.record.version});assert.equal(nextDayOut.record.clock_in,carried.record.clock_in);
 assert((await val(db,'select read_staff_work($1::date-1,$1::date-1,false)',[today])).attendance.some(r=>r.id===carried.record.id));
 // Full-day approved leave blocks a fresh shift until the PIC resolves the cancellation.
 const leaveToday=await mutate('leave_apply',{...apply,start_date:today,end_date:today});await as(db,owner);
 const leaveTodayApproved=await mutate('leave_approve',{id:leaveToday.record.id,version:1,note:''});await as(db,buyer);
 await assert.rejects(()=>mutate('clock_in',{expected_open:null}),/approved leave today/);
 const leaveTodayCancel=await mutate('leave_cancel_request',{id:leaveTodayApproved.record.id,version:2});await as(db,owner);
 await mutate('leave_cancel',{id:leaveTodayCancel.record.id,version:3,note:''});await as(db,buyer);
 const afterCancel=await mutate('clock_in',{expected_open:null});await mutate('clock_out',{id:afterCancel.record.id,version:1});
 for(const who of [agent,anonymous,null]){await as(db,who);await denied(()=>read());await denied(()=>read(true));await denied(()=>mutate('clock_in',{expected_open:null}));}
 await as(db,owner);assert.equal(Number(await val(db,"select count(*) from audit_logs where action='staff_clock_in' and entity_id=$1",[clocks[0].record.id])),1);
 // Revoke access while a submission is genuinely waiting at the mutation lock.
 await a.query('reset role');await a.query('begin');await a.query('select pg_advisory_xact_lock(73090,1)');await as(b,cook);
 const pid=await val(b,'select pg_backend_pid()'),queued=mutate('clock_in',{expected_open:null},randomUUID(),b).then(value=>({value}),error=>({error}));
 try{
   await db.query('reset role');let waiting=false;
   for(let i=0;i<40;i++){waiting=await val(db,"select exists(select 1 from pg_locks where pid=$1 and locktype='advisory' and not granted)",[pid]);if(waiting)break;await new Promise(r=>setTimeout(r,25));}
   assert(waiting,'The submission must wait at the lock before access is revoked');
   await db.query("update profiles set status='suspended' where id=$1",[cook]);await a.query('commit');
   assert.equal((await queued).error?.code,'42501','Revoked queued access cannot write');
 }finally{await a.query('rollback');await queued;}
 await as(db,cook);await denied(()=>read());
 console.log('PASS native-postgres: staff named-account isolation, one shift across simultaneous retries, overnight carry-over, approved-leave clock block, stale clock-out/corrections, own leave and overlap/half-day rules, attributed PIC decisions/races, no self-approval, cancellations, immutable original replay, private reasons/history, recent future decisions, direct-write/anonymous/agency/suspended-account and queued-revocation denial.');
});}
if(import.meta.url===new URL(process.argv[1],'file:').href)await runStaffWorkTests();
