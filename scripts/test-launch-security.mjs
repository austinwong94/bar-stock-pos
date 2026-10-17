import assert from 'node:assert/strict';
import {readFile,readdir,access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Exercise the entire migration chain and its real role policies, not permission stubs.
// PGlite serializes requests; this is not a substitute for multi-connection staging tests.
if(!process.env.PGLITE_MODULE) throw new Error('Set PGLITE_MODULE to the installed @electric-sql/pglite entry point.');
const {PGlite}=await import(process.env.PGLITE_MODULE);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let baseline=process.env.SECURITY_SCHEMA_ROOT || root;
try{await access(path.join(baseline,'supabase/tests/harness.sql'));}
catch{baseline=path.resolve(root,'../bar-stock-pos');}
const db=new PGlite();
const owner='11111111-1111-1111-1111-111111111111',cook='88888888-8888-8888-8888-888888888888',buyer='99999999-9999-9999-9999-999999999999',tablet='66666666-6666-6666-6666-666666666666';
const adapt=sql=>sql.replaceAll(/create extension if not exists pgcrypto;/gi,'');
const val=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]??{})[0];
const as=async(id)=>{await db.exec('reset role');await val("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);await db.exec(id?'set role authenticated':'set role anon');};
const admin=()=>db.exec('reset role');
try{
  await db.exec(adapt(await readFile(path.join(baseline,'supabase/tests/harness.sql'),'utf8')));
  // Supabase's pgcrypto extension is unavailable in this WASM runner; only SHA-256 is emulated.
  await db.exec(`create or replace function digest(text,text) returns bytea language sql immutable as $$select sha256(convert_to($1,'UTF8'))$$;
    create or replace function storage.foldername(text) returns text[] language sql immutable as $$select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1]$$;`);
  const migrations=new Map();
  for(const directory of [baseline,root])for(const file of await readdir(path.join(directory,'supabase/migrations'))){
    if(file.endsWith('.sql'))migrations.set(file,path.join(directory,'supabase/migrations',file));
  }
  for(const [name,file] of [...migrations].sort(([a],[b])=>a.localeCompare(b))){
    try{await db.exec(adapt(await readFile(file,'utf8')));}catch(error){throw new Error(`${name}: ${error.message}`,{cause:error});}
  }
  console.log(`PASS: ${migrations.size} migrations applied from scratch with real permission functions and RLS.`);
  await db.exec(await readFile(path.join(baseline,'supabase/tests/seed_test.sql'),'utf8'));
  await db.exec(`update profiles set status='active',access_role_code='bar_staff',app_access_granted=true,admin_access_expires_at=now()+interval '2 hours' where id='${tablet}';`);
  await as(tablet);
  assert.equal(await val("select has_permission('bar.pos.use')"),true);
  for(const code of ['bar.settings.manage','bar.products.manage','bar.pos.void','bar.reports.view','kitchen.production.manage','purchasing.cost.view']){
    assert.equal(await val('select has_permission($1)',[code]),false,`Shared tablet must not inherit ${code}`);
  }
  await assert.rejects(()=>val("select verify_admin_access('anything')"),/approved manager/);
  await as(owner);
  assert.equal(await val("select has_permission('bar.products.manage')"),true);
  const category=await val("insert into categories(name) values('Beer') on conflict(name) do update set name=excluded.name returning id");
  const beer=await val("insert into products(name,category_id,price_per_unit) values('Security test Lager',$1,12) returning id",[category]);
  await val("select stock_in_product($1,20,'can')",[beer]);
  const base={items:[{product_id:beer,quantity:2}],method:'cash',reference:null,reason:null,key:'checkout-one',receipt:null,discount:0,staff:'Test staff',qrType:null,table:'7'};
  const pay=(overrides={})=>{const p={...base,...overrides};return val('select complete_sale_with_qr_type($1::jsonb,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[JSON.stringify(p.items),p.method,p.reference,p.reason,p.key,p.receipt,p.discount,p.staff,p.qrType,p.table]);};
  const sale=await pay();
  assert.equal(sale.total_amount,24);
  assert.equal((await pay()).sale_id,sale.sale_id);
  assert.equal(Number(await val('select quantity_on_hand from inventory_balances where product_id=$1',[beer])),18);
  for(const changes of [{discount:1},{table:'9'},{items:[{product_id:beer,quantity:1}]},{method:'complimentary',reason:'Changed'}]){
    await assert.rejects(()=>pay(changes),error=>error.code==='LP001');
  }
  await as(tablet);await assert.rejects(()=>pay(),error=>error.code==='LP001');
  await assert.rejects(()=>val("select complete_sale($1::jsonb,'cash')",[JSON.stringify(base.items)]),/permission denied/);
  await as(cook);await assert.rejects(()=>pay({key:'cook-sale'}),/permission|access/i);
  await assert.rejects(()=>val("update profiles set access_role_code='master_admin' where id=$1 returning id",[cook]),/permission|access|policy/i);
  await assert.rejects(()=>val('select * from pos_checkout_requests'),/permission denied/);
  assert.equal(Number(await val('select count(*) from sales')),0,'Kitchen cannot read bar sales');
  assert.equal(await val("select has_permission('purchasing.cost.manage')"),false,'Kitchen cannot edit purchase costs');
  await as(buyer);await assert.rejects(()=>pay({key:'buyer-sale'}),/permission|access/i);
  await as(owner);
  await assert.rejects(()=>pay({key:null}),/request ID/);
  await assert.rejects(()=>pay({key:'nan',discount:'NaN'}),/valid discount/);
  await assert.rejects(()=>pay({key:'qr-fake',method:'qr',qrType:'TnGo',receipt:'missing.jpg'}),/Upload your QR/);
  await admin();
  await val("insert into storage.objects(bucket_id,name,owner) values('payment-receipts','qr/test.jpg',$1)",[owner]);
  await val("insert into storage.objects(bucket_id,name,owner) values('payment-receipts','qr/other.jpg',$1)",[tablet]);
  await as(owner);
  await assert.rejects(()=>pay({key:'qr-other',method:'qr',qrType:'TnGo',receipt:'qr/other.jpg'}),/Upload your QR/);
  const qr={key:'qr-valid',method:'qr',qrType:'TnGo',receipt:'qr/test.jpg'};
  const qrSale=await pay(qr);
  assert.equal((await pay(qr)).sale_id,qrSale.sale_id);
  await assert.rejects(()=>pay({...qr,qrType:'Grab'}),error=>error.code==='LP001');
  await assert.rejects(()=>pay({...qr,key:'qr-reuse'}),error=>error.code==='LP001');
  await assert.rejects(()=>val("delete from storage.objects where name='qr/test.jpg' returning id"),/must be retained/);
  await admin();
  await assert.rejects(()=>val("update storage.objects set name='changed.jpg' where name='qr/test.jpg' returning id"),/must be retained/);
  await as(tablet);
  assert.equal((await db.query("delete from storage.objects where name='qr/other.jpg' returning id")).rows.length,1,'Unlinked own uploads can still be cleaned up');
  await as(owner);
  await val('select void_sale($1,$2)',[sale.sale_id,'Security test']);
  assert.equal((await pay()).status,'voided','Recovery must report a subsequent void without reselling');
  assert.equal(Number(await val('select quantity_on_hand from inventory_balances where product_id=$1',[beer])),18);
  assert.equal(await val('select qr_payment_type from sales where id=$1',[qrSale.sale_id]),'TnGo');
  await admin();await val('delete from pos_checkout_requests where request_key=$1',['checkout-one']);
  await as(owner);await assert.rejects(()=>pay(),error=>error.code==='LP001');
  await admin();
  await db.exec(`insert into app_settings(key,value) values('require_manager_approval_for_complimentary','true') on conflict(key) do update set value='true';`);
  await as(tablet);
  await assert.rejects(()=>pay({key:'unapproved-foc',method:'complimentary',reason:'Free'}),/Manager approval/);
  await assert.rejects(()=>pay({key:'unapproved-discount',discount:24}),/Manager approval/);
  await as(owner);
  assert.equal(Number(await val('select quantity_on_hand from inventory_balances where product_id=$1',[beer])),18,'Unapproved free sales roll back their stock deductions');
  assert.equal(Number(await val("select count(*) from sales where idempotency_key in ('unapproved-foc','unapproved-discount')")),0);
  console.log('PASS: exact replay, actor isolation, QR ownership/existence/reuse, evidence retention, void recovery, old-payment hold, finite amounts and stock rollback.');
  await admin();
  const rice=await val("insert into ingredient_items(name,category,base_unit) values('Security test rice','Food','g') returning id");
  await val('insert into ingredient_balances(ingredient_id,quantity_on_hand) values($1,10000) returning ingredient_id',[rice]);
  const usageKey=crypto.randomUUID();
  const usage=(qty=1000)=>val('select record_kitchen_usage_checked($1::jsonb,current_date,$2,$3,10,$4,$5::uuid)',[JSON.stringify([{ingredient_id:rice,quantity:qty,expected_base_unit:'g'}]),'guest_meals','Lunch','',usageKey]);
  await as(cook);const usageId=await usage();assert.equal(await usage(),usageId);
  await assert.rejects(()=>usage(2000),/different details/);
  await as(owner);assert.equal(Number(await val('select quantity_on_hand from ingredient_balances where ingredient_id=$1',[rice])),9000);
  assert.equal(await val('select created_by from kitchen_production_reports where id=$1',[usageId]),cook);
  await as(tablet);await assert.rejects(()=>usage(),/access|permission/i);
  console.log('PASS: kitchen usage still works through its guarded entry point, retains actor identity and only deducts once.');
  for(const role of ['anon','authenticated'])for(const signature of ['purchase_request_message(uuid)','order_pickup_run(uuid)','complete_sale(jsonb,text,text,text,text,text,numeric,text,text)','complete_sale_with_qr_type_internal(jsonb,text,text,text,text,text,numeric,text,text,text)','submit_kitchen_production(date,text,numeric,text,jsonb,text,text)','record_kitchen_stock_out(jsonb,text,text,uuid)']){
    assert.equal(await val('select has_function_privilege($1,$2,$3)',[role,signature,'EXECUTE']),false,signature+' '+role);
  }
  await as(null);await assert.rejects(()=>pay({key:'anon-sale'}),/permission denied/);
  console.log('PASS: anonymous access, direct helper bypasses and shared-tablet privilege escalation blocked.');
}finally{await db.close();}
