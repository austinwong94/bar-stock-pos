import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {root,withDatabase} from '../../scripts/release/database.mjs';
const owner='11111111-1111-1111-1111-111111111111',cook='88888888-8888-8888-8888-888888888888';
const scalar=async(db,sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const as=async(db,id)=>{await db.query('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);await db.query(id?'set role authenticated':'set role anon');};
async function records(db){const tables=(await db.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows;const result=[];for(const {tablename} of tables)result.push({table:tablename,rows:await scalar(db,`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from public."${tablename.replaceAll('"','""')}" t`)});return result;}
export async function runClosingItemAmountTests(){
 const b=await build({entryPoints:[root+'/src/lib/reportItems.ts'],bundle:true,write:false,format:'cjs',platform:'node'}),m={exports:{}};new Function('module','exports',b.outputFiles[0].text)(m,m.exports);
 await withDatabase(async(db,connect)=>{
  await as(db,owner);const oldDate='2000-01-01',oldKey=randomUUID(),oldVersion=(await scalar(db,'select read_bar_closing($1)',[oldDate])).version;
  const close=(client,date,version,key)=>scalar(client,'select close_daily_report_checked($1,$2,$3,$4,$5)',[date,date===oldDate?0:.02,'Exact cents test',version,key]);
  const oldReport=await close(db,oldDate,oldVersion,oldKey),date=await scalar(db,'select get_business_date()::text');
  const pay=async(method)=>scalar(db,'select complete_sale_with_qr_type($1::jsonb,$2,null,$3,$4,null,3.98,$5,null,null)',[JSON.stringify(Array.from({length:4},(_,i)=>({name:'Closing Item '+i,quantity:1,custom_price:1}))),method,method==='complimentary'?'Native test only':null,randomUUID(),'Sample Staff']);
  await pay('cash');await pay('complimentary');const voided=await pay('cash');await scalar(db,'select void_sale($1,$2)',[voided.sale_id,'Native test void']);
  await db.query('reset role');const before=await records(db),migration=await readFile(root+'/supabase/migrations/20261114084942_exact_closing_item_amounts.sql','utf8');await db.query(migration);assert.deepEqual(await records(db),before,'Upgrade preserves every existing report/sale/audit');await db.query(migration);assert.deepEqual(await records(db),before);
  await as(db,owner);assert.deepEqual(await close(db,oldDate,oldVersion,oldKey),oldReport,'Old closing recovery is unchanged');
  const snapshot=await scalar(db,'select read_bar_closing($1)',[date]),expected=m.exports.actualItemSales(snapshot.sales).sort((a,b)=>a.product.localeCompare(b.product)),key=randomUUID(),a=await connect(),c=await connect();await as(a,owner);await as(c,owner);
  const [first,second]=await Promise.all([close(a,date,snapshot.version,key),close(c,date,snapshot.version,key)]);assert.deepEqual(first,second);
  const rows=first.report_json.sales_by_product;assert(rows.every(x=>x.cash>=0&&x.foc_cost>=0&&x.discount>=0));
  assert.deepEqual(rows.map(r=>({product:r.name,quantity:r.quantity,cash:r.cash,qr:r.qr,focCost:r.foc_cost,discount:r.discount})),expected,'Saved report agrees with the live item breakdown');
  const cents=(rows,key)=>rows.reduce((sum,r)=>sum+Math.round(Number(r[key])*100),0);
  assert.equal(cents(rows,'cash'),2);assert.equal(cents(rows,'foc_cost'),2);assert.equal(cents(rows,'discount'),796);assert.equal(rows.reduce((s,r)=>s+r.quantity,0),8);
  const categories=first.report_json.sales_by_category;assert.equal(cents(categories,'cash'),2);assert.equal(cents(categories,'foc_cost'),2);assert.equal(cents(categories,'discount'),796);
  assert.equal(Number(await scalar(db,"select count(*) from daily_reports where business_date=$1",[date])),1);
  assert.equal(Number(await scalar(db,"select count(*) from audit_logs where action='close_daily_report' and entity_id=$1",[first.id])),1);
  assert.deepEqual((await scalar(db,"select after_json from audit_logs where action='close_daily_report' and entity_id=$1",[first.id])),first.report_json,'Audit stores the same exact breakdown');
  for(const id of [owner,cook,null]){await as(db,id);await assert.rejects(()=>scalar(db,'select private.bar_exact_item_sections($1)',[date]),e=>e.code==='42501');if(id!==owner)await assert.rejects(()=>close(db,date,snapshot.version,key),e=>e.code==='42501');}
  await db.query('reset role');const retained=await records(db);await db.query(migration);assert.deepEqual(await records(db),retained,'Replay never rewrites closed snapshots');
  await db.query("update sales set business_date='2001-01-01' where id=(select id from sales where status='completed' and payment_method='cash' limit 1)");
  await db.query("update sale_items set line_total=2 where id=(select si.id from sale_items si join sales s on s.id=si.sale_id where s.business_date='2001-01-01' limit 1)");
  await as(db,owner);const invalid=await scalar(db,"select read_bar_closing('2001-01-01')");await assert.rejects(()=>close(db,'2001-01-01',invalid.version,randomUUID()),e=>e.code==='22023');
  assert.equal(Number(await scalar(db,"select count(*) from daily_reports where business_date='2001-01-01'")),0,'Invalid breakdown cannot create a closing');
  assert.equal(Number(await scalar(db,"select count(*) from cash_sessions where business_date='2001-01-01'")),0,'Rejected closing rolls back its cash session');
 },{through:'20261114080401_validate_pos_money.sql'});
 console.log('PASS native closing item amounts: preserved upgrade/legacy recovery, cent-exact live/product/category/audit agreement, simultaneous retry is one closing, cash/FOC/void handling, private helper and role denial, replay immutability and incomplete-source rollback.');
}
