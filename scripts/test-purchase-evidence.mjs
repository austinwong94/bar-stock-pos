import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['supabase/functions/scan-purchase-receipt/handler.ts'], bundle: true, write: false, platform: 'node', format: 'cjs' });
const module = { exports: {} }; new Function('module','exports',bundle.outputFiles[0].text)(module,module.exports);
const { createReceiptHandler, validExtraction } = module.exports;
const extraction = { supplier:'Test Supplier',date:'2026-09-28',receipt_no:'TEST-1',currency:'MYR',subtotal:10,tax:0,discount:0,total:10,items:[{description:'Rice',quantity:1,unit:'pack',unit_price:10,amount:10}],warnings:[] };
assert(validExtraction(extraction)); assert(!validExtraction({...extraction,total:'ten'})); assert(!validExtraction({...extraction,items:[{description:'Rice',quantity:Infinity}]}));
const id = '22222222-2222-4222-8222-222222222222';
const envValues = { SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service',OPENAI_API_KEY:'test-only',RECEIPT_ALLOWED_ORIGINS:'https://test.example' };
const req = () => new Request('https://test.example/scan', { method:'POST',headers:{ authorization:'Bearer test-session',origin:'https://test.example' },body:JSON.stringify({record_id:id}) });
const json = (body,status=200) => new Response(JSON.stringify(body), {status,headers:{'Content-Type':'application/json'}});
let calls=[],updates=[],cached=false,deny=false,incomplete=false;
const send = async (url,options) => {
  calls.push(url);
  if (url.endsWith('/auth/v1/user')) return json({id});
  if (url.includes('/rpc/')) return deny ? json({message:'Permission denied'},403) : json(cached ? {cached:extraction} : {receipt_path:id+'/test/receipt.png'});
  if (url.includes('/storage/')) return new Response(new Uint8Array([1,2,3]), {headers:{'Content-Type':'image/png'}});
  if (url.includes('/responses')) {
    const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.model,'gpt-5.4-mini');assert.equal(body.text.format.strict,true);
    assert(!body.input[0].content[0].image_url.includes('https://'),'Private storage URL is not sent to OpenAI');
    return json({status:incomplete?'incomplete':'completed',output:[{content:[{type:'output_text',text:JSON.stringify(extraction)}]}],usage:{input_tokens:2000,output_tokens:1000}});
  }
  updates.push(JSON.parse(options.body));return json([{record_id:id}]);
};
let handler=createReceiptHandler(n=>envValues[n],send);
assert.equal((await handler(req())).status,200);assert.equal(updates[0].status,'complete');
assert(calls.every(url=>!url.includes('ingredient')&&!url.includes('purchase_request_items')),'Scanning cannot write stock or manual lines');
calls=[];cached=true;assert.equal((await handler(req())).status,200);assert.equal(calls.length,2,'Cached result has no second billed call');
cached=false;deny=true;calls=[];assert.equal((await handler(req())).status,409);assert.equal(calls.length,2);
deny=false;incomplete=true;updates=[];assert.equal((await handler(req())).status,502);assert.equal(updates[0].status,'failed');
calls=[];handler=createReceiptHandler(n=>n==='OPENAI_API_KEY'?undefined:envValues[n],send);assert.equal((await handler(req())).status,503);assert.equal(calls.length,0);
console.log('PASS: receipt extraction validation, permission rejection, missing-key no-charge, cached scan, incomplete response, no inventory writes.');

if (!process.env.PGLITE_MODULE) { console.log('SQL checks skipped: PGLITE_MODULE not supplied.'); process.exit(0); }
const { PGlite } = await import(process.env.PGLITE_MODULE);
const db=new PGlite();
try {
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select '11111111-1111-4111-8111-111111111111'::uuid$$;
    insert into auth.users values(auth.uid());
    create function has_permission(code text) returns boolean language sql stable as $$select coalesce(current_setting('test.deny',true),'')<>code$$;
    create function require_permission(code text) returns void language plpgsql as $$begin if not has_permission(code) then raise exception 'Permission denied' using errcode='42501';end if;end$$;
    create table profiles(id uuid primary key,full_name text);insert into profiles values(auth.uid(),'Purchaser');
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text,name text,primary key(bucket_id,name));alter table storage.objects enable row level security;
    create function storage.foldername(path text) returns text[] language sql immutable as $$select string_to_array(path,'/')$$;
    create table purchase_requests(id uuid primary key,request_no text,status text);
    create table purchase_request_items(id uuid primary key,request_id uuid,item_name text,unit text,quantity numeric,purchase_status text,updated_at timestamptz,sort_order int,purchased_quantity numeric,actual_cost numeric,supplier text,purchase_note text);
    create table audit_logs(id uuid primary key default gen_random_uuid(),actor_id uuid,action text,entity_type text,entity_id uuid,before_json jsonb,after_json jsonb,created_at timestamptz default now());
    create table operation_requests(actor_id uuid,operation text,request_id uuid,payload_hash text,result_id uuid,primary key(actor_id,operation,request_id));
    create function set_purchase_item_status_checked(p_id uuid,p_updated timestamptz,p_status text,p_quantity numeric,p_cost numeric,p_supplier text,p_note text) returns void language plpgsql security definer as $$begin
      update purchase_request_items set purchase_status=p_status,purchased_quantity=p_quantity,actual_cost=p_cost,supplier=p_supplier,updated_at=clock_timestamp() where id=p_id;
    end$$;
    insert into purchase_requests values('22222222-2222-4222-8222-222222222222','PR-TEST','submitted');
    insert into purchase_request_items values('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','Rice','pack',2,'pending','2026-09-28T00:00:00Z',1,null,null,null,null);`);
  const baseline='supabase/migrations/202609080031_reviewed_purchase_batches.sql';
  await db.exec(await readFile(baseline,'utf8').catch(()=>readFile('../bar-stock-pos/'+baseline,'utf8')));
  await db.exec(await readFile('supabase/migrations/202609280052_purchase_evidence.sql','utf8'));
  const receipt='11111111-1111-4111-8111-111111111111/order/receipt.jpg',items='11111111-1111-4111-8111-111111111111/order/items.jpg';
  await db.query('insert into storage.objects values ($1,$2),($1,$3)',['purchase-evidence',receipt,items]);
  const proof={purchase_date:'2026-09-28',total_cost:20,receipt_path:receipt,items_path:items,receipt_hash:'a'.repeat(64),items_hash:'b'.repeat(64)};
  const lines=[{id:'33333333-3333-4333-8333-333333333333',expected_updated_at:'2026-09-28T00:00:00Z',quantity:2,actual_cost:20}];
  const save=(evidence=proof,token=crypto.randomUUID(),entries=lines)=>db.query('select record_purchase_batch_checked($1,$2::jsonb,$3,$4,$5,$6::jsonb) result',[id,JSON.stringify(entries),'Supplier','TEST-1',token,JSON.stringify(evidence)]);
  await db.exec('set role authenticated');
  await assert.rejects(()=>save(null),/receipt date/);
  await assert.rejects(()=>save({...proof,items_path:receipt}),/different photo/);
  await assert.rejects(()=>save({...proof,items_hash:proof.receipt_hash}),/different photo/);
  await assert.rejects(()=>save({...proof,items_path:items+'missing'}),/finish uploading/);
  await assert.rejects(()=>save({...proof,total_cost:-1}),/date and total/);
  await assert.rejects(()=>save({...proof,total_cost:20.001}),/date and total/);
  await assert.rejects(()=>db.query('select record_purchase_batch_internal($1,$2,$3,$4,$5)',[id,JSON.stringify(lines),'Supplier','Ref',crypto.randomUUID()]),/permission denied/);
  await assert.rejects(()=>db.query("select set_purchase_item_status_checked($1,now(),'bought',2,20,'Supplier',null)",[lines[0].id]),/receipt photo/);
  const token=crypto.randomUUID();
  const result=(await save(proof,token)).rows[0].result;
  assert.equal(result.evidence.total_cost,20);assert.equal(result.confirmed_by_name,'Purchaser');
  assert.equal((await save(proof,token)).rows[0].result.id,result.id);
  await assert.rejects(()=>save({...proof,total_cost:30},token),/different details/);
  const history=(await db.query('select read_purchase_batch_records($1) result',[id])).rows[0].result;
  assert.equal(history.total,1);assert.equal(history.records[0].evidence.receipt_path,receipt);
  await db.exec("select set_config('test.deny','purchasing.cost.view',false)");
  const hidden=(await db.query('select read_purchase_batch_records($1) result',[id])).rows[0].result.records[0];
  assert(!hidden.evidence);assert(!('actual_cost' in hidden.items[0]));
  assert.equal((await db.query('select * from purchase_evidence')).rows.length,0);
  await assert.rejects(()=>save(),/Permission denied/);
  await db.exec("select set_config('test.deny','',false)");
  await db.query('select save_purchase_supplier($1)',['Same Supplier']);await db.query('select save_purchase_supplier($1)',['same supplier']);
  assert.equal((await db.query('select read_purchase_suppliers() names')).rows[0].names.filter(x=>x.toLowerCase()==='same supplier').length,1);
  await db.query('select begin_purchase_receipt_scan($1)',[result.id]);await assert.rejects(()=>db.query('select begin_purchase_receipt_scan($1)',[result.id]),/already been attempted/);
  await db.exec('reset role');
  assert.equal((await db.query('select count(*) from purchase_evidence')).rows[0].count,1);
  console.log('PASS: SQL proof requirements, photo existence, cost privacy, duplicate supplier names, atomic purchase replay, direct-write bypass rejection and scan retry lock.');
  if (process.env.TEST_RECEIPT_DUPLICATES) await (await import('./test-receipt-duplicates.mjs')).testReceiptDuplicateGuards(db);
  if (process.env.TEST_REQUEST_RECEIPT) await (await import('./test-request-receipt.mjs')).testRequestReceiptReviews(db);
} finally { await db.close(); }
