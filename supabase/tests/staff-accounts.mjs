import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withDatabase} from '../../scripts/release/database.mjs';
const owner='11111111-1111-1111-1111-111111111111',cook='88888888-8888-8888-8888-888888888888';
const as=async(db,id)=>{await db.query('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);await db.query(id?'set role authenticated':'set role anon');};
const value=async(db,sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]??{})[0];
export async function runStaffAccountTests({bootstrap=null}={}){return withDatabase(async(db,connect)=>{
  const id=randomUUID(),metadata={staff_provision_operation:id,staff_provision_actor:owner,staff_provision_role:'kitchen_staff',staff_provision_name:'Staff QA'};
  await db.query("insert into auth.users(id,email,raw_app_meta_data) values($1,'staff.qa@staff.lovely-paradise.invalid',$2)",[id,metadata]);
  await as(db,cook);await assert.rejects(()=>value(db,'select admin_activate_created_user($1,$1)',[id]),e=>e.code==='42501');
  await as(db,owner);await assert.rejects(()=>value(db,'select admin_activate_created_user($1,$2)',[id,randomUUID()]),e=>e.code==='42501');
  const a=await connect(),b=await connect();await as(a,owner);await as(b,owner);
  const results=await Promise.all([a.query('select (admin_activate_created_user($1,$1)).id',[id]),b.query('select (admin_activate_created_user($1,$1)).id',[id])]);
  assert(results.every(r=>r.rows[0].id===id));
  assert.equal(Number(await value(db,"select count(*) from audit_logs where action='admin_update_user' and entity_id=$1",[id])),1);
  await value(db,"select admin_update_user($1,p_access_role_code=>'bar_staff')",[id]);
  assert.equal((await value(db,'select to_jsonb(admin_activate_created_user($1,$1))',[id])).access_role_code,'bar_staff');
  await value(db,"select admin_update_user($1,p_status=>'suspended')",[id]);
  await assert.rejects(()=>value(db,'select admin_activate_created_user($1,$1)',[id]),e=>e.code==='42501');
  await assert.rejects(()=>value(db,"select admin_update_user($1,p_status=>'suspended')",[owner]),/Keep at least one/);
  await assert.rejects(()=>value(db,"select admin_update_user_before_account_setup($1)",[owner]),e=>e.code==='42501');
  await db.query('reset role');await db.query("update profiles set status='active',access_role_code='master_admin' where id=$1",[id]);
  await as(a,owner);await as(b,id);
  const remove=await Promise.allSettled([a.query("select admin_update_user($1,p_status=>'suspended')",[owner]),b.query("select admin_update_user($1,p_status=>'suspended')",[id])]);
  assert.equal(remove.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(Number(await value(db,"select count(*) from profiles p join access_roles r on r.code=p.access_role_code where r.is_master and p.status='active'")),1);
  console.log('PASS native staff provisioning: permission denial, operation identity, concurrent replay, one audit event, later role preservation, suspension and last-owner concurrency.');
},{bootstrap});}
