import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withDatabase} from '../../scripts/release/database.mjs';
const owner='11111111-1111-1111-1111-111111111111',cook='88888888-8888-8888-8888-888888888888',buyer='99999999-9999-9999-9999-999999999999',agent='33333333-3333-3333-3333-333333333333',anon='66666666-6666-6666-6666-666666666666';
const val=async(db,sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const as=async(db,id)=>{await db.query('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);await db.query(id?'set role authenticated':'set role anon');};
export async function runKitchenUnitBatchTests(){await withDatabase(async(db,connect)=>{
 const rows=(await db.query("select id,kitchen_unit,kitchen_factor,updated_at::text from ingredient_items where kitchen_key is not null and base_unit='unit' and kitchen_key not like 'snorkelling-mineral-water%' order by id limit 3")).rows;assert.equal(rows.length,3);
 const lines=rows.map(r=>({id:r.id,unit:'pack',factor:12,expected_updated_at:r.updated_at,carton_size:null}));
 const save=(lines,key=randomUUID(),client=db)=>val(client,'select save_kitchen_units($1,$2::jsonb)',[key,JSON.stringify(lines)]);
 await as(db,owner);const a=await connect(),b=await connect();await as(a,owner);await as(b,owner);const key=randomUUID();
 const result=await Promise.all([save(lines,key,a),save(lines,key,b)]);assert.deepEqual(result[0],result[1]);assert.equal(result[0].items.length,3);
 assert.equal(Number(await val(db,"select count(*) from audit_logs where action='kitchen_unit_setup' and entity_id=any($1::uuid[])",[rows.map(r=>r.id)])),3);
 await assert.rejects(()=>save([{...lines[0],factor:10}],key),/different details/);await assert.rejects(()=>save(lines),e=>e.code==='40001');
 // A stale second row rolls back changes and audit rows for the first.
 const current=result[0].items;const mixed=current.map((r,n)=>({id:r.id,unit:'pack',factor:24,expected_updated_at:n===1?lines.find(l=>l.id===r.id).expected_updated_at:r.updated_at,carton_size:null}));
 await assert.rejects(()=>save(mixed),e=>e.code==='40001');const after=(await db.query("select id,kitchen_factor from ingredient_items where id=any($1::uuid[])",[rows.map(r=>r.id)])).rows;assert(after.every(r=>Number(r.kitchen_factor)===12));
 assert.equal(Number(await val(db,"select count(*) from audit_logs where action='kitchen_unit_setup' and entity_id=any($1::uuid[])",[rows.map(r=>r.id)])),3);
 const next=current.map(r=>({id:r.id,unit:'pack',factor:24,expected_updated_at:r.updated_at,carton_size:null}));
 const races=await Promise.allSettled([save(next,randomUUID(),a),save(next,randomUUID(),b)]);assert.equal(races.filter(r=>r.status==='fulfilled').length,1);assert.equal(races.find(r=>r.status==='rejected').reason.code,'40001');
 assert.deepEqual(await save(lines,key),result[0],'Historical retry returns original proof, not later settings');
 await assert.rejects(()=>save([next[0],next[0]]),/different items/);await assert.rejects(()=>save([{...next[0],staff_id:cook}]),/Invalid unit setting/);
 for(const who of [cook,buyer,agent,anon,null]){await as(db,who);await assert.rejects(()=>save(lines),e=>e.code==='42501');await assert.rejects(()=>db.query('select * from kitchen_unit_batches'),e=>e.code==='42501');}
 console.log('PASS native-postgres: batch delegates exact unit rules, simultaneous historical retries, competing edits, stale-item atomic rollback including audit, actor/permission denial and no direct batch access.');
});}
if(import.meta.url===new URL(process.argv[1],'file:').href)await runKitchenUnitBatchTests();
