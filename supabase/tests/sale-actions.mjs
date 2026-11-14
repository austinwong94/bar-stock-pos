import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {root,withDatabase} from '../../scripts/release/database.mjs';
const owner='11111111-1111-1111-1111-111111111111',other='22222222-2222-2222-2222-222222222222';
const scalar=async(db,sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const as=async(db,id)=>{await db.query('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);await db.query(id?'set role authenticated':'set role anon');};
async function records(db){const result={};for(const {tablename}of(await db.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows)result[tablename]=await scalar(db,`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from public."${tablename.replaceAll('"','""')}" t`);return result;}
export async function runSaleActionTests(){
 await withDatabase(async(db,connect)=>{
  await as(db,owner);const category=await scalar(db,"insert into categories(name) values('Beer') on conflict(name) do update set name=excluded.name returning id");
  const beer=await scalar(db,"insert into products(name,category_id,price_per_unit) values('Action Test Beer',$1,12) returning id",[category]);
  await db.query('reset role');await db.query('insert into inventory_balances(product_id,quantity_on_hand) values($1,20) on conflict(product_id) do update set quantity_on_hand=20',[beer]);await db.query("insert into storage.objects(bucket_id,name,owner) values('payment-receipts','sale-action/qr.jpg',$1)",[owner]);await as(db,owner);
  const items=JSON.stringify([{product_id:beer,quantity:2,expected_unit_price:12}]),payKey=randomUUID();
  const pay=(method,key=randomUUID())=>scalar(db,'select complete_sale_with_qr_type($1::jsonb,$2,null,null,$3,$4,0,$5,$6,null)',[items,method,key,method==='qr'?'sale-action/qr.jpg':null,'Test Owner',method==='qr'?'TnGo':null]);
  const cash=await pay('cash',payKey),qr=await pay('qr');await db.query('reset role');const before=await records(db);
  const migration=await readFile(root+'/supabase/migrations/20261114203706_recover_reviewed_bar_sale_actions.sql','utf8');await db.query(migration);
  const upgraded=await records(db),withoutMetadata=structuredClone(upgraded);delete withoutMetadata.bar_sale_action_requests;withoutMetadata.sales=withoutMetadata.sales.map(({review_version,...row})=>row);assert.deepEqual(withoutMetadata,before,'Upgrade preserves existing business records');await db.query(migration);assert.deepEqual(await records(db),upgraded);
  await as(db,owner);assert.deepEqual(await pay('cash',payKey),cash,'Pre-upgrade payment recovery remains exact');
  const version=id=>scalar(db,'select review_version from sales where id=$1',[id]);
  const run=(sale,action,expected,key=randomUUID(),reason=null,client=db,actor=owner)=>scalar(client,'select review_bar_sale_action($1,$2,$3,$4,$5,$6)',[sale,action,reason,expected,key,actor]);
  const a=await connect(),b=await connect();await as(a,owner);await as(b,owner);
  const voidKey=randomUUID(),voidVersion=await version(cash.sale_id),voidReason='Wrong order - test';
  const [voided,replayed]=await Promise.all([run(cash.sale_id,'void',voidVersion,voidKey,voidReason,a),run(cash.sale_id,'void',voidVersion,voidKey,voidReason,b)]);assert.deepEqual(voided,replayed);assert.equal(voided.sale.review_version,1);assert.equal(voided.sale.voided_by,owner);
  assert.equal(Number(await scalar(db,"select count(*) from stock_movements where reference_id=$1 and movement_type='void_sale'",[cash.sale_id])),1);assert.equal(Number(await scalar(db,'select quantity_on_hand from inventory_balances where product_id=$1',[beer])),18);
  assert.equal(Number(await scalar(db,"select count(*) from audit_logs where action='void_sale' and entity_id=$1",[cash.sale_id])),1);
  await assert.rejects(()=>run(cash.sale_id,'void',voidVersion,voidKey,'Changed reason'),e=>e.code==='LP001');await assert.rejects(()=>run(cash.sale_id,'void',voidVersion,randomUUID(),voidReason),e=>e.code==='40001');
  const qrKey=randomUUID(),qrVersion=await version(qr.sale_id);const [verified,repeated]=await Promise.all([run(qr.sale_id,'verified',qrVersion,qrKey,null,a),run(qr.sale_id,'verified',qrVersion,qrKey,null,b)]);assert.deepEqual(verified,repeated);assert.equal(verified.sale.qr_status,'verified');
  assert.equal(Number(await scalar(db,"select count(*) from audit_logs where action='verify_qr_payment' and entity_id=$1",[qr.sale_id])),1);
  await run(qr.sale_id,'mismatch',await version(qr.sale_id));assert.deepEqual(await run(qr.sale_id,'verified',qrVersion,qrKey),verified);assert.equal(await scalar(db,'select qr_status from sales where id=$1',[qr.sale_id]),'mismatch','Old recovery does not overwrite a newer decision');
  const current=await version(qr.sale_id);const competing=await Promise.allSettled([run(qr.sale_id,'verified',current,randomUUID(),null,a),run(qr.sale_id,'verified',current,randomUUID(),null,b)]);assert.equal(competing.filter(r=>r.status==='fulfilled').length,1);assert.equal(competing.find(r=>r.status==='rejected').reason.code,'40001');
  const another=await pay('cash'),anotherVersion=await version(another.sale_id);
  const competingVoids=await Promise.allSettled([run(another.sale_id,'void',anotherVersion,randomUUID(),'First correction',a),run(another.sale_id,'void',anotherVersion,randomUUID(),'Second correction',b)]);assert.equal(competingVoids.filter(r=>r.status==='fulfilled').length,1);assert.equal(competingVoids.find(r=>r.status==='rejected').reason.code,'40001');assert.equal(Number(await scalar(db,'select quantity_on_hand from inventory_balances where product_id=$1',[beer])),18);
  for(const sql of ["select void_sale($1,'bypass')","select void_sale_internal($1,'bypass')","select verify_qr_payment($1,'verified',null)","select verify_qr_payment_internal($1,'verified',null)"])await assert.rejects(()=>db.query(sql,[qr.sale_id]),e=>e.code==='42501');
  // Exercise trigger protection independently of the existing no-write row policies.
  await db.query('reset role');await db.query('grant update on sales to authenticated');await db.query('create policy native_test_update on sales for update to authenticated using(true) with check(true)');await as(db,owner);
  for(const sql of ["update sales set qr_status='mismatch' where id=$1","update sales set status='voided' where id=$1","update sales set review_version=0 where id=$1"])await assert.rejects(()=>db.query(sql,[qr.sale_id]),e=>e.code==='42501');
  await assert.rejects(()=>db.query('select * from bar_sale_action_requests'),e=>e.code==='42501');
  for(const [action,reason,expected]of [['unknown',null,current],['void',' ',current],['verified','Extra notes',current],['verified',null,null]])await assert.rejects(()=>run(qr.sale_id,action,expected,randomUUID(),reason),e=>e.code==='22023');
  await assert.rejects(()=>run(qr.sale_id,'mismatch',current,randomUUID(),null,db,other),e=>e.code==='42501');
  for(const user of [null,'88888888-8888-8888-8888-888888888888','99999999-9999-9999-9999-999999999999','33333333-3333-3333-3333-333333333333']){await as(db,user);await assert.rejects(()=>run(qr.sale_id,'verified',qrVersion,qrKey,null,db,user),e=>e.code==='42501');}
  await db.query('reset role');await db.query("update profiles set access_role_code='master_admin' where id=$1",[other]);await as(db,other);await assert.rejects(()=>run(qr.sale_id,'verified',qrVersion,qrKey,null,db,other),e=>e.code==='LP001');
  await as(db,owner);const date=await scalar(db,'select get_business_date()::text'),snapshot=await scalar(db,'select read_bar_closing($1)',[date]);await scalar(db,'select close_daily_report_checked($1,0,null,$2,$3)',[date,snapshot.version,randomUUID()]);
  assert.deepEqual(await run(qr.sale_id,'verified',qrVersion,qrKey),verified,'Original proof is recoverable after closing');await assert.rejects(async()=>run(qr.sale_id,'mismatch',await version(qr.sale_id)),/day is closed/);
  await db.query('reset role');await db.query("update profiles set status='suspended' where id=$1",[owner]);await as(db,owner);await assert.rejects(()=>run(cash.sale_id,'void',voidVersion,voidKey,voidReason),e=>e.code==='42501');
  await db.query('reset role');const retained=await records(db);await db.query(migration);assert.deepEqual(await records(db),retained,'Replay preserves all later records and versions');
 },{through:'20261114122251_restrict_price_history_readers.sql'});
 console.log('PASS native sale actions: preserved upgrade/replay and old payment recovery, two-connection single void/stock return/audit, QR replay without newer-status overwrite, competing decisions/stale versions, private legacy engines/ledger, actor/permission/closed-day guards.');
}
