import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withDatabase} from '../../scripts/release/database.mjs';
const actor='11111111-1111-1111-1111-111111111111',other='22222222-2222-2222-2222-222222222222',cook='88888888-8888-8888-8888-888888888888';
const scalar=async(db,sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const as=async(db,id)=>{await db.query('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);await db.query(id?'set role authenticated':'set role anon');};
export async function runBarSettingsTests(){
 await withDatabase(async(db,connect)=>{
  const values={business_name:'Settings Test Bar',currency_symbol:'MYR',secondary_currency_symbol:'RMB',rmb_exchange_rate:1.52,business_day_close_time:'00:00',default_carton_size:24,allow_negative_stock:false,require_qr_reference:false,require_manager_approval_for_complimentary:false,staff_names:'Test One, Test Two',receipt_footer_text:''};
  const keys=Object.keys(values),rows=changes=>Object.entries({...values,...changes}).map(([key,value])=>({key,value}));
  const versions=()=>scalar(db,'select jsonb_object_agg(key,updated_at) from app_settings where key=any($1)',[keys]);
  const save=(rows,versions,key=randomUUID(),client=db,user=actor)=>scalar(client,'select save_app_settings_checked($1::jsonb,$2::jsonb,$3,$4)',[JSON.stringify(rows),JSON.stringify(versions),key,user]);
  const stockBefore=await scalar(db,"select jsonb_build_array((select coalesce(jsonb_agg(to_jsonb(t)),'[]') from inventory_balances t),(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from stock_movements t),(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from sales t))");
  const auditBefore=Number(await scalar(db,"select count(*) from audit_logs where action='save_app_settings_checked'"));
  await as(db,actor);const version=await versions(),key=randomUUID(),a=await connect(),b=await connect();await as(a,actor);await as(b,actor);
  const [first,retry]=await Promise.all([save(rows({}),version,key,a),save(rows({}),version,key,b)]);assert.deepEqual(first,retry);assert.equal(first.settings.length,11);
  assert.equal(Number(await scalar(db,"select count(*) from audit_logs where action='save_app_settings_checked'")),auditBefore+1);
  const original=structuredClone(first);await save(rows({business_name:'Another Manager Edit',staff_names:'New Test Name'}),await versions());
  assert.deepEqual(await save(rows({}),version,key),original,'Exact retry returns original proof without overwriting newer settings');
  assert.equal(await scalar(db,"select value from app_settings where key='business_name'"),'Another Manager Edit');
  await assert.rejects(()=>save(rows({business_name:'Altered Retry'}),version,key),e=>e.code==='LP001');
  await assert.rejects(()=>save(rows({}),version),e=>e.code==='40001');await assert.rejects(()=>save(rows({}),{}),e=>e.code==='40001');
  await assert.rejects(()=>save(rows({}),version,randomUUID(),db,other),e=>e.code==='42501');
  await db.query('reset role');await db.query("update profiles set access_role_code='master_admin' where id=$1",[other]);await as(db,other);
  await assert.rejects(()=>save(rows({}),version,key,db,other),e=>e.code==='LP001');
  for(const user of [null,cook]){await as(db,user);await assert.rejects(()=>save(rows({}),version,randomUUID(),db,user),e=>e.code==='42501');}
  await as(db,actor);await assert.rejects(()=>db.query('select * from settings_save_requests'),e=>e.code==='42501');
  await db.query('reset role');await db.query("delete from app_settings where key=any($1) and key<>'business_day_close_time'",[keys]);await as(db,actor);
  const partial=await versions(),setupVersions=Object.fromEntries(keys.map(key=>[key,partial[key]??null])),setupKey=randomUUID();
  const setup=await save(rows({}),setupVersions,setupKey);assert.equal(setup.settings.length,11);assert.deepEqual(await save(rows({}),setupVersions,setupKey),setup);
  assert.equal(await scalar(db,"select value from app_settings where key='default_carton_size'"),24,'Absent settings are saved only from explicit reviewed input');
  await db.query('reset role');const stockAfter=await scalar(db,"select jsonb_build_array((select coalesce(jsonb_agg(to_jsonb(t)),'[]') from inventory_balances t),(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from stock_movements t),(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from sales t))");assert.deepEqual(stockAfter,stockBefore);
 });
 console.log('PASS native general Bar Settings: 11-key saves, independent-connection exact replay, single audit, stale versions, actor/permission and recovery-ledger denial, replay after newer edits, unchanged stock/sales.');
}
