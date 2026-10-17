import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withDatabase} from '../../scripts/release/database.mjs';
const owner='11111111-1111-1111-1111-111111111111',agent='33333333-3333-3333-3333-333333333333';
const val=async(db,sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const as=async(db,id)=>{await db.query('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.query('set role authenticated');};
export async function runKitchenMeasureTests(){await withDatabase(async(db,connect)=>{
 const ingredients=[];
 for(const [name,base,unit,factor] of [['Rice Measure Test','g','pack',5000],['Oil Measure Test','ml','botol',750],['Egg Measure Test','unit','biji',1]])ingredients.push((await db.query('insert into ingredient_items(name,category,base_unit,kitchen_key,kitchen_unit,kitchen_factor) values($1,\'Food\',$2,$3,$4,$5) returning *,updated_at::text as updated_at',[name,base,randomUUID(),unit,factor])).rows[0]);
 const day=await val(db,"select (now() at time zone 'Asia/Kuala_Lumpur')::date::text");
 const line=(i,value,unit,quantity)=>({ingredient_id:i.id,name:i.name,quantity,entered_quantity:value,display_unit:unit,unit:i.base_unit,expected_version:i.updated_at});
 const record={date:day,supplier:'Sample Supplier',reference:'METRIC',lines:[line(ingredients[0],5,'kg',5000),line(ingredients[1],2,'L',2000)]};
 const save=(r,id=randomUUID(),client=db)=>val(client,'select record_kitchen_arrival($1::jsonb,$2)',[JSON.stringify(r),id]);
 await as(db,owner);const a=await connect(),b=await connect();await as(a,owner);await as(b,owner);const key=randomUUID();const results=await Promise.all([save(record,key,a),save(record,key,b)]);assert.deepEqual(results[0],results[1]);assert.equal(results[0].lines.find(l=>l.unit==='g').display_unit,'kg');assert.equal(results[0].lines.find(l=>l.unit==='ml').entered_quantity,2);
 assert.equal(Number(await val(db,'select quantity_on_hand from ingredient_balances where ingredient_id=$1',[ingredients[0].id])),5000);assert.equal(Number(await val(db,'select quantity_on_hand from ingredient_balances where ingredient_id=$1',[ingredients[1].id])),2000);
 for(const bad of [line(ingredients[0],5,'L',5000),line(ingredients[2],5,'kg',5000),line(ingredients[0],5,'kg',5)])await assert.rejects(()=>save({...record,lines:[bad]}),/Check delivered/);
 await assert.rejects(()=>save({...record,reference:'changed'},key),/different details/);
 const stale={...record,lines:[{...record.lines[0],expected_version:'2000-01-01T00:00:00Z'}]};await assert.rejects(()=>save(stale),e=>e.code==='40001');
 const usage={business_date:day,guest_meals:10,staff_meals:2,template_ids:[],notes:'',lines:ingredients.slice(0,2).map(i=>({ingredient_id:i.id,name:i.name,unit:i.base_unit,expected_item_version:i.updated_at,guest_quantity:i.base_unit==='g'?500:100,staff_quantity:i.base_unit==='g'?250:50}))};
 await val(db,'select save_daily_kitchen_usage($1::jsonb,null,$2)',[JSON.stringify(usage),randomUUID()]);
 assert.equal(Number(await val(db,'select quantity_on_hand from ingredient_balances where ingredient_id=$1',[ingredients[0].id])),4250);
 const balance=(await db.query('select quantity_on_hand,updated_at::text as updated_at from ingredient_balances where ingredient_id=$1',[ingredients[0].id])).rows[0];const count={ingredient_id:ingredients[0].id,expected_base_unit:'g',expected_balance:4250,expected_version:balance.updated_at,expected_item_version:ingredients[0].updated_at,display_unit:'kg',display_factor:1000,counted_quantity:4000};const countKey=randomUUID();
 await val(db,'select record_kitchen_stock_count($1::jsonb,$2,$3)',[JSON.stringify([count]),'Physical metric check',countKey]);await val(db,'select record_kitchen_stock_count($1::jsonb,$2,$3)',[JSON.stringify([count]),'Physical metric check',countKey]);assert.equal(Number(await val(db,'select quantity_on_hand from ingredient_balances where ingredient_id=$1',[ingredients[0].id])),4000);
 await as(db,agent);await assert.rejects(()=>save(record),e=>e.code==='42501');
 console.log('PASS native-postgres: metric arrival -> guest/staff deductions -> physical count, exact actor replay across connections, invalid families/mismatches/stale setups denied, no duplicate stock.');
});}
if(import.meta.url===new URL(process.argv[1],'file:').href)await runKitchenMeasureTests();
