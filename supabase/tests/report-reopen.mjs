import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {root,withDatabase} from '../../scripts/release/database.mjs';
const owner='11111111-1111-1111-1111-111111111111',other='22222222-2222-2222-2222-222222222222';
const scalar=async(db,sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const as=async(db,id)=>{await db.query('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);await db.query(id?'set role authenticated':'set role anon');};
async function records(db){const result={};for(const {tablename}of(await db.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows)result[tablename]=await scalar(db,`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from public."${tablename.replaceAll('"','""')}" t`);return result;}
export async function runReportReopenTests(){
 await withDatabase(async(db,connect)=>{
  await as(db,owner);const day=await scalar(db,'select get_business_date()::text');
  const snapshot=()=>scalar(db,'select read_bar_closing($1)',[day]);
  const close=async()=>scalar(db,'select close_daily_report_checked($1,90,$2,$3,$4)',[day,'Original counted note',(await snapshot()).version,randomUUID()]);
  await db.query('reset role');await db.query('insert into cash_sessions(business_date,opening_float,opened_by) values($1,100,$2)',[day,owner]);await as(db,owner);const closed=await close();
  await db.query('reset role');const before=await records(db),migration=(await Promise.all(['20261114221919_recover_reviewed_report_reopening.sql','20261114230215_recheck_report_reopen_permission_after_wait.sql'].map(file=>readFile(root+'/supabase/migrations/'+file,'utf8')))).join('\n');await db.query(migration);
  const upgraded=await records(db),copy=structuredClone(upgraded);delete copy.bar_report_reopen_requests;assert.deepEqual(copy,before,'Upgrade preserves all existing records');await db.query(migration);assert.deepEqual(await records(db),upgraded);
  await as(db,owner);const reviewed=await snapshot(),key=randomUUID(),reason='Correction from Reports';
  const run=(version=reviewed.version,request=key,client=db,actor=owner,note=reason,id=closed.id)=>scalar(client,'select reopen_daily_report_checked($1,$2,$3,$4,$5,$6)',[day,id,version,note,request,actor]);
  await assert.rejects(()=>run(),e=>e.code==='42501','New reopening requires a current password unlock');
  await db.query('reset role');await db.query("update profiles set admin_access_expires_at=now()+interval '2 hours' where id=$1",[owner]);await as(db,owner);
  await assert.rejects(()=>run('stale',randomUUID()),e=>e.code==='40001');await assert.rejects(()=>run(reviewed.version,randomUUID(),db,other),e=>e.code==='42501');
  const a=await connect(),b=await connect();await as(a,owner);await as(b,owner);
  const [proof,repeated]=await Promise.all([run(reviewed.version,key,a),run(reviewed.version,key,b)]);assert.deepEqual(proof,repeated);assert.equal(proof.report.status,'reopened');assert.equal(proof.report.reopened_by,owner);
  for(const field of ['report_json','closed_at','closed_by','notes','total_cash','total_qr','total_complimentary_value','total_sales','actual_cash_counted','expected_cash','cash_variance'])assert.deepEqual(proof.report[field],closed[field],field+' is retained');
  assert.equal(await scalar(db,'select status from cash_sessions where business_date=$1',[day]),'open');
  assert.equal(Number(await scalar(db,"select count(*) from audit_logs where action='reopen_daily_report' and entity_id=$1",[closed.id])),1);
  assert.equal((await scalar(db,"select after_json from audit_logs where action='reopen_daily_report' and entity_id=$1",[closed.id])).reason,reason);
  await assert.rejects(()=>run(reviewed.version,key,db,owner,'Changed'),e=>e.code==='LP001');await assert.rejects(()=>run(reviewed.version,randomUUID()),e=>e.code==='40001');
  const reclosed=await close();await db.query('reset role');await db.query("update profiles set admin_access_expires_at=now()-interval '1 second' where id=$1",[owner]);await as(db,owner);
  assert.deepEqual(await run(),proof,'Committed proof can be recovered after unlock expiry');assert.equal((await snapshot()).report.status,'closed','Recovery never reopens a newer closing');assert.equal((await snapshot()).report.closed_at,reclosed.closed_at);
  const expiredVersion=(await snapshot()).version;await assert.rejects(()=>run(expiredVersion,randomUUID()),e=>e.code==='42501');
  await db.query('reset role');await db.query("update profiles set admin_access_expires_at=now()+interval '2 hours' where id=$1",[owner]);await as(db,owner);const current=await snapshot();
  const competing=await Promise.allSettled([run(current.version,randomUUID(),a),run(current.version,randomUUID(),b)]);assert.equal(competing.filter(r=>r.status==='fulfilled').length,1);assert.equal(competing.find(r=>r.status==='rejected').reason.code,'40001');
  await assert.rejects(()=>db.query('select * from bar_report_reopen_requests'),e=>e.code==='42501');await assert.rejects(()=>db.query("select reopen_daily_report($1,'bypass')",[day]),e=>e.code==='42501');
  // Grant broad fixture-only policies to test the write trigger independently of RLS.
  await db.query('reset role');await db.query('grant insert,update,delete on daily_reports to authenticated');await db.query('create policy native_reopen_write on daily_reports for all to authenticated using(true) with check(true)');await as(db,owner);
  for(const sql of ["update daily_reports set status='closed' where business_date=$1","delete from daily_reports where business_date=$1","insert into daily_reports(business_date) values($1::date+1)"])await assert.rejects(()=>db.query(sql,[day]),e=>e.code==='42501');
  for(const user of [null,'88888888-8888-8888-8888-888888888888','99999999-9999-9999-9999-999999999999','33333333-3333-3333-3333-333333333333']){await as(db,user);await assert.rejects(()=>run(reviewed.version,key,db,user),e=>e.code==='42501');}
  await db.query('reset role');await db.query("update profiles set access_role_code='master_admin' where id=$1",[other]);await as(db,other);await assert.rejects(()=>run(reviewed.version,key,db,other),e=>e.code==='LP001');
  await db.query('reset role');const waiterPid=await scalar(a,'select pg_backend_pid()');await db.query('begin');await db.query('select pg_advisory_xact_lock(77312,1)');
  const queued=run(reviewed.version,key,a).then(value=>({value}),error=>({error}));
  const deadline=Date.now()+5000;while(!await scalar(db,"select exists(select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock' and wait_event='advisory')",[waiterPid])){if(Date.now()>deadline)throw Error('Reopening did not reach the advisory lock');await new Promise(r=>setTimeout(r,10));}
  await db.query("update profiles set status='suspended' where id=$1",[owner]);await db.query('commit');
  assert.equal((await queued).error?.code,'42501','Queued recovery must recheck permission after a revocation commits');
  await as(db,owner);await assert.rejects(()=>run(),e=>e.code==='42501');
  await db.query('reset role');const retained=await records(db);await db.query(migration);assert.deepEqual(await records(db),retained,'Replay preserves later business records');
 },{through:'20261114203706_recover_reviewed_bar_sale_actions.sql'});
 console.log('PASS native report reopening: preserved upgrade/replay, password expiry/current roles including queued revocation, two-connection exact replay and competing stale requests, immutable original money/notes, one audit, old proof cannot reopen newer closing, private engine/ledger and direct-write rejection.');
}
