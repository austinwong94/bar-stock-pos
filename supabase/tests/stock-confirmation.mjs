import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {root,withDatabase} from '../../scripts/release/database.mjs';
const owner='11111111-1111-1111-1111-111111111111';
const scalar=async(db,sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const as=async(db,id)=>{await db.query('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);await db.query(id?'set role authenticated':'set role anon');};
async function records(db){const result={};for(const {tablename}of(await db.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows)result[tablename]=await scalar(db,`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from public."${tablename.replaceAll('"','""')}" t`);return result;}
async function waiting(db,client){const pid=await scalar(client,'select pg_backend_pid()');return async()=>{const until=Date.now()+4000;while(!await scalar(db,"select exists(select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock')",[pid])){if(Date.now()>until)throw Error('Expected database lock was not reached');await new Promise(r=>setTimeout(r,10));}};}
export async function runStockConfirmationTests(){
 await withDatabase(async(db,connect)=>{
  await as(db,owner);const category=await scalar(db,"insert into categories(name) values('Stock Confirmation Test') returning id");
  const make=async(name='Review Lager',client=db)=>scalar(client,"insert into products(name,category_id,price_per_unit,carton_size) values($1,$2,12,24) returning id",[name,category]);
  const draft=async(entries,client=db)=>scalar(client,"select to_jsonb(create_stock_in_draft_checked($1,'Owner','Supplier','Reference','Original note',$2))",[JSON.stringify(entries),randomUUID()]);
  const line=(id,unit='carton')=>({product_id:id,quantity:2,unit,cost_per_unit:null});
  const confirm=(id,client=db)=>scalar(client,'select confirm_stock_in_draft($1)',[id]);
  const balance=id=>scalar(db,'select coalesce((select quantity_on_hand from inventory_balances where product_id=$1),0)',[id]);
  const legacy=await make('Pre-upgrade Reproduction'),oldDraft=await draft([line(legacy)]);await db.query('update products set carton_size=12 where id=$1',[legacy]);
  await confirm(oldDraft.id);assert.equal(Number(await balance(legacy)),24,'Reproduces the old reviewed-48/added-24 defect only in disposable PostgreSQL');
  const id=await make(),pending=await draft([line(id)]);await db.query('reset role');const before=await records(db),migration=await readFile(root+'/supabase/migrations/20261115001635_protect_reviewed_stock_in_cartons.sql','utf8');await db.query(migration);assert.deepEqual(await records(db),before,'Forward migration changes no business or account rows');
  await as(db,owner);const a=await connect(),b=await connect();await as(a,owner);await as(b,owner);
  const [first,retry]=await Promise.all([confirm(pending.id,a),confirm(pending.id,b)]);assert.deepEqual(first.draft,retry.draft);assert.equal(first.draft.total_units,48);assert.equal(Number(await balance(id)),48);
  assert.equal(Number(await scalar(db,"select count(*) from audit_logs where action='stock_in_draft_confirmed' and entity_id=$1",[pending.id])),1);
  await db.query('update products set carton_size=12,active=false where id=$1',[id]);assert.deepEqual((await confirm(pending.id)).draft,first.draft,'Confirmed replay keeps original proof after later product edits');assert.equal(Number(await balance(id)),48);
  for(const [column,value]of [['carton_size',12],['name','Changed'],['active',false]]){
   const p=await make(),d=await draft([line(p)]);await db.query('update products set '+column+'=$1 where id=$2',[value,p]);await db.query('reset role');const unchanged=await records(db);await as(db,owner);await assert.rejects(()=>confirm(d.id),e=>e.code==='40001');await db.query('reset role');assert.deepEqual(await records(db),unchanged,'Rejected '+column+' change cannot add stock, alter cost or confirm audit');await as(db,owner);
  }
  const p=await make(),q=await make(),batch=await draft([line(p,'can'),line(q)]);await db.query('update products set carton_size=12 where id=$1',[q]);await assert.rejects(()=>confirm(batch.id),e=>e.code==='40001');assert.equal(Number(await balance(p)),0,'A later invalid line cannot partially apply earlier entries');
  const corrupt=await draft([line(p)]);await db.query('reset role');await db.query("update stock_in_drafts set total_units=47 where id=$1",[corrupt.id]);await as(db,owner);await assert.rejects(()=>confirm(corrupt.id),/inconsistent total/);assert.equal(Number(await balance(p)),0);
  const race=await make(),raceDraft=await draft([line(race)]);await db.query('reset role');const waiter=await waiting(db,a);await db.query('begin');await db.query('update products set carton_size=12 where id=$1',[race]);const queued=confirm(raceDraft.id,a).then(value=>({value}),error=>({error}));await waiter();await db.query('commit');assert.equal((await queued).error?.code,'40001','An edit committed while confirmation waits must be rechecked');
  await as(db,owner);const held=await make(),heldDraft=await draft([line(held)]);await db.query('reset role');await a.query('begin');const heldProof=await confirm(heldDraft.id,a);const edited=await waiting(db,b);const edit=b.query('update products set carton_size=12 where id=$1',[held]).then(value=>({value}),error=>({error}));await edited();await a.query('commit');assert(!(await edit).error);assert.equal(Number(await balance(held)),48,'A later edit waits until the reviewed conversion has been applied');assert.equal(heldProof.draft.total_units,48);
  const revoke=await make(),revokeDraft=await draft([line(revoke)]);await db.query('reset role');const blocked=await waiting(db,a);await db.query('begin');await db.query('select 1 from products where id=$1 for update',[revoke]);const revoking=confirm(revokeDraft.id,a).then(value=>({value}),error=>({error}));await blocked();await db.query("update profiles set status='suspended' where id=$1",[owner]);await db.query('commit');assert.equal((await revoking).error?.code,'42501','Permission is rechecked after waiting for a product lock');await db.query("update profiles set status='active' where id=$1",[owner]);await as(db,owner);
  for(const actor of [null,'88888888-8888-8888-8888-888888888888','99999999-9999-9999-9999-999999999999','66666666-6666-6666-6666-666666666666']){await as(db,actor);await assert.rejects(()=>confirm(pending.id),e=>e.code==='42501');}
  await as(db,owner);await assert.rejects(()=>scalar(db,'select confirm_stock_in_draft_internal($1)',[pending.id]),e=>e.code==='42501');await db.query('reset role');const retained=await records(db);await db.query(migration);assert.deepEqual(await records(db),retained,'Migration replay preserves later records');
 },{through:'20261114230215_recheck_report_reopen_permission_after_wait.sql'});
 console.log('PASS native stock confirmation: reproduced old carton defect, preserved upgrade/replay, exact reviewed units, inactive/renamed/changed-carton rejection, atomic multi-item refusal, concurrent edits/confirmation, one addition/audit and permission recheck after waits.');
}
