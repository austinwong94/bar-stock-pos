import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {root,withDatabase} from '../../scripts/release/database.mjs';
const owner='11111111-1111-1111-1111-111111111111',cook='88888888-8888-8888-8888-888888888888';
const scalar=async(db,sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const as=async(db,id)=>{await db.query('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);await db.query(id?'set role authenticated':'set role anon');};
async function records(db){const tables=(await db.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows;const result=[];for(const {tablename} of tables)result.push({table:tablename,rows:await scalar(db,`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from public."${tablename.replaceAll('"','""')}" t`)});return result;}
export async function runPosMoneyTests(){
 await withDatabase(async(db,connect)=>{
  const pay=(price,discount=0,key=randomUUID(),quantity=1,client=db)=>scalar(client,"select complete_sale_with_qr_type($1::jsonb,'cash',null,null,$2,null,$3,'Money Test',null,null)",[JSON.stringify([{name:'Money Test Custom Order',quantity,custom_price:price}]),key,discount]);
  await as(db,owner);const legacyKey=randomUUID(),legacy=await pay(12.345,.001,legacyKey);
  await db.query('reset role');const before=await records(db),migration=await readFile(root+'/supabase/migrations/20261114080401_validate_pos_money.sql','utf8');await db.query(migration);assert.deepEqual(await records(db),before,'Upgrade does not rewrite existing financial records');await db.query(migration);assert.deepEqual(await records(db),before);
  await as(db,owner);assert.deepEqual(await pay(12.345,.001,legacyKey),legacy,'An old committed payment is recovered before new precision checks');
  const beforeRejected=await scalar(db,'select count(*) from sales');
  for(const price of [12.345,'1e2','NaN','Infinity',-1,0,null,{},'999999999','1,234.56'])await assert.rejects(()=>pay(price),e=>e.code==='22023');
  for(const amount of [.001,-1,'NaN','Infinity','-Infinity',10000000000])await assert.rejects(()=>pay(1,amount),e=>e.code==='22023');
  await assert.rejects(()=>pay(.29,.3),/Invalid discount/);assert.equal(await scalar(db,'select count(*) from sales'),beforeRejected);
  await db.query('reset role');await assert.rejects(()=>scalar(db,"select complete_sale_with_qr_type_before_review($1::jsonb,'cash',null,null,$2,null,0,'Money Test',null,null)",[JSON.stringify([{name:'Old Open Tab',quantity:1,custom_price:1.005}]),randomUUID()]),e=>e.code==='22023','Older in-flight public calls cannot bypass the private money guard');await as(db,owner);
  const a=await connect(),b=await connect();await as(a,owner);await as(b,owner);const key=randomUUID();
  const [first,second]=await Promise.all([pay(.29,.01,key,3,a),pay(.29,.01,key,3,b)]);assert.deepEqual(first,second);assert.equal(first.total_amount,.86);
  const saved=await scalar(db,'select to_jsonb(s) from sales s where id=$1',[first.sale_id]);assert.equal(Number(saved.paid_amount),.86);assert.equal(Number(saved.discount_amount),.01);
  assert.equal(Number(await scalar(db,'select sum(line_total) from sale_items where sale_id=$1',[first.sale_id])),.87);assert.equal(Number(await scalar(db,'select sum(quantity) from sale_items where sale_id=$1',[first.sale_id])),3);
  assert.equal((await pay(.35,.04)).total_amount,.31,'Half-cent percentage result agrees with exact database arithmetic');
  assert.equal((await pay('0.2900',0)).total_amount,.29,'Equivalent trailing zeros are not a monetary change');
  for(const id of [cook,null]){await as(db,id);await assert.rejects(()=>pay(.29,.01,key,3),e=>e.code==='42501');}
  await db.query('reset role');assert.equal(Number(await scalar(db,'select count(*) from stock_movements')),0,'Custom orders do not invent physical stock');
  const retained=await records(db);await db.query(migration);assert.deepEqual(await records(db),retained);
  assert.equal(await scalar(db,"select has_function_privilege('anon','public.complete_sale_with_qr_type(jsonb,text,text,text,text,text,numeric,text,text,text)','execute')"),false);
 },{through:'20261110185901_safeguard_bundle_configuration.sql'});
 console.log('PASS native POS money: unchanged upgrade/replay, original pre-upgrade recovery, invalid precision/excess/amount denial, concurrent exact cents and one sale, line/discount/paid reconciliation, no invented stock and permission preservation.');
}
