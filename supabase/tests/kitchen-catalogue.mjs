import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {root,withDatabase} from '../../scripts/release/database.mjs';

const file='20261017001732_restore_standard_kitchen_catalogue.sql';
export async function runKitchenCatalogueTests({bootstrap=null}={}) {
  const migration=await readFile(root+'/supabase/migrations/'+file,'utf8');
  await withDatabase(async(db,connect)=>{
    const retained=(await db.query("select id from ingredient_items where kitchen_key='timun'")).rows[0];
    if(retained){
      await db.query('delete from ingredient_balances where ingredient_id<>$1',[retained.id]);
      await db.query('delete from ingredient_items where id<>$1',[retained.id]);
      await db.query("update ingredient_items set active=false,cost_per_base_unit=9,kitchen_unit='pcs',kitchen_factor=1 where id=$1",[retained.id]);
      await db.query('insert into ingredient_balances(ingredient_id,quantity_on_hand) values($1,17) on conflict(ingredient_id) do update set quantity_on_hand=17',[retained.id]);
      await db.query("update catalogue_items set unit='pcs',default_quantity=23,times_used=12 where lower(name)='timun'");
    }
    const before={
      items:(await db.query('select to_jsonb(i) item from ingredient_items i order by id')).rows,
      balances:(await db.query('select to_jsonb(b) balance from ingredient_balances b order by ingredient_id')).rows,
      catalogue:(await db.query('select to_jsonb(c) item from catalogue_items c order by id')).rows,
      movements:(await db.query('select count(*)::int n from ingredient_movements')).rows[0].n,
    };
    const first=await connect(),second=await connect();
    await Promise.all([first.query(migration),second.query(migration)]);
    const items=(await db.query('select to_jsonb(i) item from ingredient_items i order by id')).rows;
    assert.equal(items.length,49);
    for(const {item} of before.items)assert.deepEqual(items.find(r=>r.item.id===item.id)?.item,item,'Existing ingredient setup must remain unchanged');
    for(const {item} of before.catalogue)assert.deepEqual((await db.query('select to_jsonb(c) item from catalogue_items c where id=$1',[item.id])).rows[0].item,item,'Existing buying catalogue must remain unchanged');
    for(const {balance} of before.balances)assert.deepEqual((await db.query('select to_jsonb(b) balance from ingredient_balances b where ingredient_id=$1',[balance.ingredient_id])).rows[0].balance,balance);
    assert.equal((await db.query('select count(*)::int n from ingredient_movements')).rows[0].n,before.movements);
    const oldIds=before.items.map(r=>r.item.id);
    assert.equal((await db.query('select count(*)::int n from ingredient_items i join ingredient_balances b on b.ingredient_id=i.id where not (i.id=any($1::uuid[])) and b.quantity_on_hand<>0',[oldIds])).rows[0].n,0);
    assert.equal((await db.query('select count(*)::int n from ingredient_items where not (id=any($1::uuid[])) and cost_per_base_unit is not null',[oldIds])).rows[0].n,0);
    const oldCatalogueIds=before.catalogue.map(r=>r.item.id);
    assert.equal((await db.query('select count(*)::int n from catalogue_items where not (id=any($1::uuid[])) and (default_quantity is not null or times_used<>0)',[oldCatalogueIds])).rows[0].n,0);
    assert.equal((await db.query("select count(*)::int n from audit_logs where action='restore_standard_kitchen_catalogue'")).rows[0].n,1);
    await db.query(migration);
    assert.equal((await db.query("select count(*)::int n from audit_logs where action='restore_standard_kitchen_catalogue'")).rows[0].n,1,'Replay cannot add another audit or duplicate item');
    assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n,0);
    assert.equal((await db.query('select count(*)::int n from sales')).rows[0].n,0);
  },bootstrap?{bootstrap,seed:false}:{through:'20261016230746_hosted_crypto_search_path.sql',seed:false});
  console.log('PASS native kitchen catalogue recovery: 49 names, concurrent/idempotent installation, existing units/costs/balances/catalogue untouched, blank new request quantities, no stock movements, sales or accounts.');
}
