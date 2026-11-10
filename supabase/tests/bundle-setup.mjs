import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {root,withDatabase} from '../../scripts/release/database.mjs';
const actor='11111111-1111-1111-1111-111111111111',other='22222222-2222-2222-2222-222222222222',cook='88888888-8888-8888-8888-888888888888';
const scalar=async(db,sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const as=async(db,id)=>{await db.query('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);await db.query(id?'set role authenticated':'set role anon');};
async function records(db){const tables=(await db.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows;const result=[];for(const {tablename} of tables)result.push({table:tablename,rows:await scalar(db,`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from public."${tablename.replaceAll('"','""')}" t`)});return result;}
export async function runBundleSetupTests(){
 await withDatabase(async(db,connect)=>{
  const before=await records(db),migration=await readFile(root+'/supabase/migrations/20261110185901_safeguard_bundle_configuration.sql','utf8');
  await db.query(migration);const upgraded=await records(db);assert.deepEqual(upgraded.filter(x=>x.table!=='settings_save_requests'),before);await db.query(migration);assert.deepEqual(await records(db),upgraded);
  const versions=()=>scalar(db,"select jsonb_object_agg(key,updated_at) from app_settings where key like 'beer_bundle_%'");
  const values={beer_bundle_enabled:true,beer_bundle_name:'Test Bundle',beer_bundle_units_per_set:4,beer_bundle_price:40};
  const rows=changes=>Object.entries({...values,...changes}).map(([key,value])=>({key,value}));
  const save=(rows,versions,key=randomUUID(),client=db,user=actor)=>scalar(client,'select save_app_settings_checked($1::jsonb,$2::jsonb,$3,$4)',[JSON.stringify(rows),JSON.stringify(versions),key,user]);
  await as(db,actor);const version=await versions(),key=randomUUID(),a=await connect(),b=await connect();await as(a,actor);await as(b,actor);
  const [first,retry]=await Promise.all([save(rows({}),version,key,a),save(rows({}),version,key,b)]);assert.deepEqual(first,retry);assert.deepEqual(await save(rows({}),version,key),first);
  assert.equal(Number(await scalar(db,"select count(*) from audit_logs where action='save_app_settings_checked'")),1);
  const newest=await save(rows({beer_bundle_price:48}),await versions());assert.equal(newest.settings.find(x=>x.key==='beer_bundle_price').value,48);
  assert.deepEqual(await save(rows({}),version,key),first,'Retry retains the original result even after another manager edit');
  assert.equal(await scalar(db,"select value from app_settings where key='beer_bundle_price'"),48);
  await assert.rejects(()=>save(rows({beer_bundle_price:41}),version,key),e=>e.code==='LP001');
  await assert.rejects(()=>save(rows({}),version),e=>e.code==='40001');await assert.rejects(()=>save(rows({}),{}),e=>e.code==='40001');
  for(const [key,invalid] of [['beer_bundle_price','40.555'],['beer_bundle_price',0],['beer_bundle_units_per_set',4.5],['beer_bundle_units_per_set',0],['beer_bundle_units_per_set',2147483648],['beer_bundle_name',' ']])await assert.rejects(()=>save(rows({[key]:invalid}),{}),e=>e.code==='22023');
  await assert.rejects(()=>save(rows({}).slice(1),{}),e=>e.code==='22023');await assert.rejects(()=>save([...rows({}),rows({})[0]],{}),e=>e.code==='22023');
  await assert.rejects(()=>db.query("update app_settings set value='99' where key='beer_bundle_price'"),e=>e.code==='42501');
  await assert.rejects(()=>db.query("delete from app_settings where key='beer_bundle_price'"),e=>e.code==='42501');
  await assert.rejects(()=>db.query('select * from settings_save_requests'),e=>e.code==='42501');
  await assert.rejects(()=>scalar(db,"select save_app_settings_checked_before_recovery('[]','{}')"),e=>e.code==='42501');
  await assert.rejects(()=>save(rows({}),version,randomUUID(),db,other),e=>e.code==='42501');
  await db.query('reset role');await db.query("update profiles set access_role_code='master_admin' where id=$1",[other]);await as(db,other);await assert.rejects(()=>save(rows({}),version,key,db,other),e=>e.code==='LP001');
  for(const user of [null,cook]){await as(db,user);await assert.rejects(()=>save(rows({}),version,key,db,user),e=>e.code==='42501');}
  await as(db,actor);const current=await versions();await scalar(db,'select save_app_settings_checked($1::jsonb,$2::jsonb)',[JSON.stringify(rows({})),JSON.stringify(current)]);
  const category=await scalar(db,"insert into categories(name) values('Beer') on conflict(name) do update set name=excluded.name returning id");
  const beer=await scalar(db,"insert into products(name,category_id,price_per_unit) values('Bundle Test Beer',$1,12) returning id",[category]);
  await db.query('reset role');await db.query('insert into inventory_balances(product_id,quantity_on_hand) values($1,100) on conflict(product_id) do update set quantity_on_hand=100',[beer]);await as(db,actor);
  const bundle=[{bundle:true,quantity:1,expected_bundle_price:40,expected_bundle_units:4,components:[{product_id:beer,quantity:4}]}],saleKey=randomUUID();
  const pay=(items,key=randomUUID(),client=db)=>scalar(client,"select complete_sale_with_qr_type($1::jsonb,'cash',null,null,$2,null,0,'Test Owner',null,null)",[JSON.stringify(items),key]);
  const sale=await pay(bundle,saleKey);assert.equal(sale.total_amount,40);
  for(const corrupt of ['missing','bad-size','fractional-price','disabled']){
   await db.query('reset role');await db.query("delete from app_settings where key like 'beer_bundle_%'");
   if(corrupt!=='missing')for(const row of rows(corrupt==='bad-size'?{beer_bundle_units_per_set:'bad'}:corrupt==='fractional-price'?{beer_bundle_price:40.555}:{beer_bundle_enabled:false}))await db.query('insert into app_settings(key,value) values($1,$2::jsonb)',[row.key,JSON.stringify(row.value)]);
   await as(db,actor);await assert.rejects(()=>pay(bundle),e=>e.code==='40001');
   const single=await pay([{product_id:beer,quantity:1,expected_unit_price:12}]);assert.equal(single.total_amount,12,'Individual drinks do not depend on bundle configuration');
   assert.equal((await pay(bundle,saleKey)).sale_id,sale.sale_id,'Original payment recovery precedes present settings validation');
  }
  await db.query('reset role');assert.equal(Number(await scalar(db,'select count(*) from sales')),5);assert.equal(Number(await scalar(db,'select quantity_on_hand from inventory_balances where product_id=$1',[beer])),92);
  const retained=await records(db);await db.query(migration);assert.deepEqual(await records(db),retained);
 },{through:'20261110181408_recover_product_save_requests.sql'});
 console.log('PASS native bundle safety: record-preserving upgrade/replay, exact concurrent retry, stale/actor/permission and direct-write denial, missing/invalid bundle checkout blocked, individual sales and historical payment recovery intact.');
}
