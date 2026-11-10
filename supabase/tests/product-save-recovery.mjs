import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {root,withDatabase} from '../../scripts/release/database.mjs';
const actor='11111111-1111-1111-1111-111111111111',other='22222222-2222-2222-2222-222222222222',cook='88888888-8888-8888-8888-888888888888';
const scalar=async(db,sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const as=async(db,id)=>{await db.query('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);await db.query(id?'set role authenticated':'set role anon');};
async function records(db){
  const tables=(await db.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows;
  const result=[];for(const {tablename} of tables)result.push({table:tablename,rows:await scalar(db,`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from public."${tablename.replaceAll('"','""')}" t`)});return result;
}
export async function runProductSaveRecoveryTests(){
  await withDatabase(async(db,connect)=>{
    await as(db,actor);const category=await scalar(db,"insert into categories(name) values('Retry Test') returning id");
    await db.query('reset role');const before=await records(db);
    const migration=await readFile(root+'/supabase/migrations/20261110181408_recover_product_save_requests.sql','utf8');await db.query(migration);
    const after=await records(db);assert.deepEqual(after.filter(row=>row.table!=='product_save_requests'),before);assert.equal(after.find(row=>row.table==='product_save_requests').rows.length,0);
    await db.query(migration);assert.deepEqual(await records(db),after,'Migration replay cannot change business records');
    await as(db,actor);
    const payload={name:'Retry Product',category_id:category,price_per_unit:12.5,cost_per_unit:null,carton_size:24,low_stock_threshold:0,active:true,image_url:null};
    const key=randomUUID();
    const save=(client=db,changes={},id=null,version=null,request=key,expectedActor=actor)=>scalar(client,'select to_jsonb(save_product_checked($1,$2::jsonb,$3,$4,$5))',[id,JSON.stringify({...payload,...changes}),version,request,expectedActor]);
    const a=await connect(),b=await connect();await as(a,actor);await as(b,actor);
    const [first,retry]=await Promise.all([save(a),save(b)]);assert.deepEqual(retry,first,'Competing copies of one request return one original confirmation');
    assert.deepEqual(await save(),first,'A lost reply/reload returns the same record');
    const legacy=await scalar(db,'select to_jsonb(save_product_checked(null,$1::jsonb,null))',[JSON.stringify({...payload,name:'Older Open Tab'})]);
    assert.equal(legacy.name,'Older Open Tab','The previous deployed three-argument call remains compatible');
    assert.equal(Number(await scalar(db,'select count(*) from products where id=$1',[first.id])),1);
    assert.equal(Number(await scalar(db,"select count(*) from audit_logs where entity_id=$1 and action='save_product_checked_insert'",[first.id])),1);
    assert.equal(Number(await scalar(db,'select quantity_on_hand from inventory_balances where product_id=$1',[first.id])),0);
    assert.equal(Number(await scalar(db,'select count(*) from stock_movements where product_id=$1',[first.id])),0);
    await assert.rejects(()=>save(db,{price_per_unit:13}),e=>e.code==='LP001');
    await assert.rejects(()=>scalar(db,'select save_product_checked_before_recovery(null,$1::jsonb,null)',[JSON.stringify(payload)]),e=>e.code==='42501');
    await assert.rejects(()=>db.query('select * from product_save_requests'),e=>e.code==='42501');
    const editKey=randomUUID(),edited=await save(db,{price_per_unit:14.25},first.id,first.updated_at,editKey);
    const later=await save(db,{price_per_unit:18},first.id,edited.updated_at,randomUUID());
    assert.deepEqual(await save(db,{price_per_unit:14.25},first.id,first.updated_at,editKey),edited,'Recovery returns its historical result, not a conflicting new edit');
    assert.equal(Number(await scalar(db,'select price_per_unit from products where id=$1',[first.id])),18);
    await assert.rejects(()=>save(db,{price_per_unit:20},first.id,first.updated_at,randomUUID()),e=>e.code==='40001');
    await db.query('reset role');await db.query("update profiles set access_role_code='master_admin' where id=$1",[other]);await as(db,other);
    await assert.rejects(()=>save(db,{},null,null,key,other),e=>e.code==='LP001','Another manager cannot recover another actor\'s request');
    await assert.rejects(()=>save(db,{},null,null,randomUUID(),actor),e=>e.code==='42501','An account switch cannot submit the prior actor\'s form');
    for(const user of [null,cook]){await as(db,user);await assert.rejects(()=>save(db,{},null,null,key,user),e=>e.code==='42501');}
    await db.query('reset role');await db.query("update profiles set access_role_code='kitchen_staff' where id=$1",[actor]);await as(db,actor);
    await assert.rejects(()=>save(),e=>e.code==='42501','Permission revocation blocks even cached recovery');
    await db.query('reset role');assert.equal(Number(await scalar(db,'select count(*) from product_save_requests')),3);
    assert.equal(Number(await scalar(db,'select price_per_unit from products where id=$1',[later.id])),18);
    const retained=await records(db);await db.query(migration);assert.deepEqual(await records(db),retained,'Replay preserves completed request snapshots, audits, products and accounts');
  },{through:'20261110173810_require_explicit_product_setup.sql'});
  console.log('PASS native product-save recovery: unchanged upgrade/replay, concurrent exact retry, one product/audit, no stock import, historical edit recovery, private helper/table, stale and actor/permission denial.');
}
