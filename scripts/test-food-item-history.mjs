import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
const b=await build({entryPoints:['src/lib/foodItemHistory.ts'],bundle:true,write:false,platform:'node',format:'cjs'});
const module={exports:{}};new Function('module','exports',b.outputFiles[0].text)(module,module.exports);
const {localFoodItemHistory,movementAmount,countOutcome,foodMovementName}=module.exports;
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const item={id:uuid(900),name:'Rice',kitchen_label:'Beras',base_unit:'g'};
const rows=Array.from({length:235},(_,n)=>({id:uuid(n+1),ingredient_id:item.id,movement_type:'stock_in',quantity_before:5000,quantity_change:1000,quantity_after:6000,display_unit:'pack',display_factor:1000,entered_by:'Happy',reason:null,notes:'Sample receipt',created_at:'2026-10-03T16:00:00.000Z',reference_id:null,reference_type:null,ingredient_items:{name:item.name,base_unit:item.base_unit}}));
const count={...rows[0],id:uuid(500),movement_type:'count',quantity_before:6000,quantity_change:-500,quantity_after:5500,entered_by:'Chloe',created_at:'2026-10-04T01:00:00Z'};
const newer={...rows[0],id:uuid(501),created_at:'2026-10-04T02:00:00Z'};
const others={...rows[0],id:uuid(502),ingredient_id:uuid(901)};
const all=[...rows,count,newer,others];
let next=null,found=[];
do{const p=localFoodItemHistory(all,item,{p_ingredient_id:item.id,p_anchor_id:count.id,p_before_created_at:next?.created_at,p_before_id:next?.id});found.push(...p.rows);next=p.next;}while(next);
assert.equal(found.length,236);assert.equal(new Set(found.map(r=>r.id)).size,236);assert.equal(found[0].id,count.id);
assert(!found.some(r=>[newer.id,others.id].includes(r.id)));
assert.equal(movementAmount(count,5500),'5.5 pack');
assert.equal(countOutcome(count,(en)=>en),'Short');assert.equal(countOutcome({...count,quantity_change:0},(en)=>en),'Matched');assert.equal(countOutcome({...count,quantity_change:1},(en,ms)=>ms),'Lebih');
assert.equal(foodMovementName({...count,movement_type:'kitchen_production',reason:'Guest Meals / Lunch'},(en)=>en),'Guest Meals / Lunch');
assert.throws(()=>localFoodItemHistory(all,item,{p_ingredient_id:item.id,p_anchor_id:others.id}),/unavailable/);
assert.throws(()=>localFoodItemHistory(all,item,{p_ingredient_id:item.id,p_before_id:count.id}),/filters/);
console.log('PASS: exact-item history, selected-count boundary, tied pagination, fractional units and count outcomes.');

if(process.env.PGLITE_MODULE){
  const {PGlite}=await import(process.env.PGLITE_MODULE);const db=new PGlite();
  try{
    await db.exec(`create role anon;create role authenticated;
      create function public.has_permission(code text) returns boolean language sql stable as $$select code=current_setting('test.permission',true)$$;
      create table ingredient_items(id uuid primary key,name text,kitchen_label text,base_unit text,category text,active boolean,cost_per_base_unit numeric);
      create table ingredient_movements(id uuid primary key,ingredient_id uuid,movement_type text,quantity_change numeric,quantity_before numeric,quantity_after numeric,display_unit text,display_factor numeric,entered_by text,reason text,notes text,reference_type text,reference_id uuid,created_at timestamptz,private_cost numeric);
      insert into ingredient_items values('${item.id}','Rice','Beras','g','Food',false,40),('${uuid(901)}','Rice','Beras','g','Food',true,99),('${uuid(902)}','Gin',null,'ml','Liquor',true,88);
      select set_config('test.permission','kitchen.stock.count',false);`);
    for(const row of all)await db.query('insert into ingredient_movements values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,99)',[row.id,row.ingredient_id,row.movement_type,row.quantity_change,row.quantity_before,row.quantity_after,row.display_unit,row.display_factor,row.entered_by,row.reason,row.notes,row.reference_type,row.reference_id,row.created_at]);
    await db.exec(await readFile('supabase/migrations/202610040058_food_item_history.sql','utf8'));
    await db.exec('set role authenticated');
    const read=async(p={})=>(await db.query('select read_food_item_history($1,$2,$3,$4,$5) result',[p.item??item.id,p.anchor??null,p.time??null,p.id??null,p.limit??50])).rows[0].result;
    let next=null,records=[];
    do{const p=await read({anchor:count.id,time:next?.created_at,id:next?.id});records.push(...p.rows);next=p.next;assert.equal(p.anchor.id,count.id);assert(!('cost_per_base_unit' in p.item));if(records.length>1000)throw new Error('Cursor stalled');}while(next);
    assert.deepEqual(records.map(r=>r.id),found.map(r=>r.id));assert(records.every(r=>!('private_cost' in r)&&r.ingredient_id===item.id));
    const first=await read();assert.equal(first.rows[0].id,newer.id);const older=await read({time:first.next.created_at,id:first.next.id});
    await db.exec(`reset role;insert into ingredient_movements select '${uuid(800)}',ingredient_id,movement_type,quantity_change,quantity_before,quantity_after,display_unit,display_factor,entered_by,reason,notes,reference_type,reference_id,'2026-10-05T01:00:00Z',99 from ingredient_movements where id='${count.id}';set role authenticated;`);
    assert.deepEqual((await read({time:first.next.created_at,id:first.next.id})).rows,older.rows);
    assert.equal((await read({anchor:count.id})).rows[0].id,count.id,'Later movements do not shift a selected count.');
    for(const invalid of [{item:uuid(902)},{item:uuid(903)},{anchor:others.id},{anchor:uuid(904)},{id:count.id},{limit:101}])await assert.rejects(()=>read(invalid));
    for(const permission of ['purchasing.receive','kitchen.production.manage']){await db.exec(`select set_config('test.permission','${permission}',false)`);assert((await read()).rows.length);}
    for(const permission of ['purchasing.cost.view','bar.stock.manage','none']){await db.exec(`select set_config('test.permission','${permission}',false)`);await assert.rejects(()=>read(),/Kitchen access required/);}
    await db.exec('reset role;create or replace function public.has_permission(code text) returns boolean language sql stable as $$select null::boolean$$;set role authenticated');await assert.rejects(()=>read(),/Kitchen access required/);
    await db.exec('reset role;set role anon');await assert.rejects(()=>read(),/permission denied/i);
    await db.exec('reset role');assert.equal(Number((await db.query('select count(*) n from ingredient_movements')).rows[0].n),all.length+1,'History is read-only.');
    console.log('PASS: SQL 236-row trace, inactive food, duplicate names, no prices, limited checker access, no bar access, anchor validation, stable pagination during inserts and anonymous denial.');
  }finally{await db.close();}
}
