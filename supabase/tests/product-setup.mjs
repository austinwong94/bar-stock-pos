import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {root,withDatabase} from '../../scripts/release/database.mjs';

const owner='11111111-1111-1111-1111-111111111111';
const cook='88888888-8888-8888-8888-888888888888';
const buyer='99999999-9999-9999-9999-999999999999';
const other='22222222-2222-2222-2222-222222222222';
const migration='20261110173810_require_explicit_product_setup.sql';
const as=async(db,id)=>{await db.query('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);await db.query(id?'set role authenticated':'set role anon');};
const scalar=async(db,sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
async function records(db){
  const names=(await db.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows;
  const rows=[];
  for(const {tablename} of names)rows.push({table:tablename,rows:await scalar(db,`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from public."${tablename.replaceAll('"','""')}" t`)});
  return rows;
}

export async function runProductSetupTests(){
  await withDatabase(async(db,connect)=>{
    await as(db,owner);
    const category=await scalar(db,"insert into categories(name) values('Setup Test') returning id");
    const existing=(await db.query("insert into products(name,category_id,price_per_unit,carton_size) values('Existing Product',$1,8.50,12) returning *",[category])).rows[0];
    await db.query('reset role');
    await db.query('insert into inventory_balances(product_id,quantity_on_hand) values($1,17) on conflict(product_id) do update set quantity_on_hand=17',[existing.id]);
    const before=await records(db);
    await db.query(await readFile(root+'/supabase/migrations/'+migration,'utf8'));
    assert.deepEqual(await records(db),before,'Forward upgrade must not modify any business or account rows');
    await as(db,owner);
    const payload={name:'New Product',category_id:category,price_per_unit:'12.50',cost_per_unit:null,carton_size:24,low_stock_threshold:0,active:true};
    const save=(value=payload,id=null,version=null,client=db)=>scalar(client,'select to_jsonb(public.save_product_checked($1,$2::jsonb,$3))',[id,JSON.stringify(value),version]);
    const invalid=[null,[],{},...['name','category_id','price_per_unit','carton_size'].map(key=>({...payload,[key]:''})),{...payload,category_id:'00000000-0000-0000-0000-000000000000'}];
    for(const key of ['price_per_unit','cost_per_unit'])for(const value of ['12.345','-1','1e2','NaN','Infinity','123456789',true,[],{}])invalid.push({...payload,[key]:value});
    for(const key of ['carton_size','low_stock_threshold'])for(const value of ['1.5',1.5,'-1','1e2','2147483648',true,[],{}])invalid.push({...payload,[key]:value});
    invalid.push({...payload,carton_size:0},{...payload,active:'true'});
    for(const bad of invalid)await assert.rejects(()=>save(bad));
    await db.query('reset role');assert.deepEqual(await records(db),before,'Rejected raw values must not create products, stock or audits');
    for(const actor of [null,cook,buyer]){await as(db,actor);await assert.rejects(()=>save(),e=>e.code==='42501');}
    for(const role of ['bar_cashier','accountant']){
      await db.query('reset role');await db.query('update profiles set access_role_code=$1 where id=$2',[role,other]);await as(db,other);await assert.rejects(()=>save(),e=>e.code==='42501');
    }
    await as(db,owner);
    const saved=await save({...payload,quantity_on_hand:500,quantity:500});
    assert.equal(Number(saved.price_per_unit),12.5);assert.equal(saved.cost_per_unit,null);
    assert.equal(Number(await scalar(db,'select quantity_on_hand from inventory_balances where product_id=$1',[saved.id])),0,'Product setup ignores stock quantities');
    assert.equal(Number(await scalar(db,'select count(*) from stock_movements where product_id=$1',[saved.id])),0);
    assert.equal((await db.query("select actor_id from audit_logs where entity_id=$1 and action='save_product_checked_insert'",[saved.id])).rows[0].actor_id,owner);
    const free=await save({...payload,name:'Explicit Free Item',price_per_unit:0,carton_size:1});assert.equal(Number(free.price_per_unit),0);
    await assert.rejects(()=>save(payload,saved.id),e=>e.code==='40001');
    const a=await connect(),b=await connect();await as(a,owner);await as(b,owner);
    const results=await Promise.allSettled([save({...payload,price_per_unit:14.25},saved.id,saved.updated_at,a),save({...payload,price_per_unit:15.75},saved.id,saved.updated_at,b)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1,'Only one concurrent editor may save the reviewed version');
    assert.equal(results.find(r=>r.status==='rejected').reason.code,'40001');
    const winner=results.find(r=>r.status==='fulfilled').value;
    const history=(await db.query('select old_price_per_unit,new_price_per_unit from product_price_history where product_id=$1',[saved.id])).rows;
    assert(history.some(h=>Number(h.old_price_per_unit)===12.5&&Number(h.new_price_per_unit)===Number(winner.price_per_unit)),'Historical prices retain exact RM values');
    assert.equal(Number(await scalar(db,'select quantity_on_hand from inventory_balances where product_id=$1',[existing.id])),17,'Existing physical stock remains unchanged');
    assert.equal(Number(await scalar(db,'select price_per_unit from products where id=$1',[existing.id])),8.5,'Other prices remain unchanged');
  },{through:'20261110170733_harden_browser_table_privileges.sql'});
  console.log('PASS native product setup: safe existing-data upgrade, exact required values, permission matrix, no stock import, actor audit, historical prices and competing-edit protection.');
}
