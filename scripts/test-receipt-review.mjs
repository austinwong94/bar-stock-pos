import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
async function load(path){const b=await build({entryPoints:[path],bundle:true,write:false,platform:'node',format:'cjs'});const m={exports:{}};new Function('module','exports',b.outputFiles[0].text)(m,m.exports);return m.exports;}
const helpers=await load('src/lib/receiptReview.ts');
const {createReviewScanHandler,validReviewExtraction}=await load('supabase/functions/scan-receipt-review/handler.ts');
const extracted={supplier:'QA Supplier',address:'Lot 1, QA Branch',tax_id:'QA-TAX-1',phone:'0100000000',date:'2026-09-28',receipt_no:'QA-100',currency:'MYR',subtotal:100,tax:6,discount:2,total:104,items:[{description:'Rice',quantity:2,unit:'pack',unit_price:50,amount:100}],warnings:[],unreadable:[]};
const blank=helpers.blankReceiptData();assert.equal(blank.purchase_date,'');assert.equal(blank.total_cost,'');
assert(helpers.sameReceiptData(blank,Object.fromEntries(Object.entries(blank).reverse())));assert(!helpers.sameReceiptData(blank,{...blank,total_cost:'invalid entered value'}));
const filled=helpers.applyReceiptExtraction(blank,extracted);assert.equal(filled.total_cost,'104');assert.equal(helpers.receiptReconciliation(filled),0);assert.equal(filled.lines[0].category,'Other');
const manual={...filled,supplier:'Manual Supplier',lines:[{...helpers.blankReceiptLine(),name:'Manual Item'}]};assert.deepEqual(helpers.applyReceiptExtraction(manual,extracted),manual,'AI must not overwrite manual details');
assert(helpers.receiptGaps(blank).includes('Item Breakdown'));assert(helpers.receiptProblems({...filled,purchase_date:'2026-02-30'},'2026-10-04').includes('date'));
assert(helpers.receiptProblems({...filled,total_cost:'-1'},'2026-10-04').includes('total'));
const validLine=filled.lines[0];assert.equal(helpers.receiptLineProblem(validLine),null);
for(const [patch,field] of [[{name:' '},'name'],[{quantity:'0'},'quantity'],[{quantity:'1e3'},'quantity'],[{quantity:'1000000001'},'quantity'],[{unit:'unknown'},'unit'],[{amount:'-1'},'amount']]){const line={...validLine,...patch};assert.equal(helpers.receiptLineProblem(line),field);assert(helpers.receiptProblems({...filled,lines:[line]},'2026-10-04').includes('items'));}
assert.equal(helpers.receiptLineProblem({...validLine,quantity:'0.0001',amount:'0'}),null);
assert(validReviewExtraction(extracted));assert(!validReviewExtraction({...extracted,unreadable:[{location:3}]}));

async function edge(options={}){
  const calls=[],saved=[];const config={SUPABASE_URL:'https://db.test',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'server-only',OPENAI_API_KEY:'fake-test-not-real',RECEIPT_ALLOWED_ORIGINS:'https://review.test',...options.env};
  const handler=createReviewScanHandler(k=>config[k],async(url,init)=>{
    calls.push({url,init});const json=(v,status=200)=>new Response(JSON.stringify(v),{status});
    if(url.endsWith('/auth/v1/user'))return options.unauthorized?json({},401):json({id:'user'});
    if(url.endsWith('/read_receipt_scan_readiness'))return options.denied?json({},403):json({database_ready:true,private_storage_ready:true});
    if(url.endsWith('/begin_receipt_review_scan'))return options.off?json({message:'Off'},409):json(options.cached?{cached:true,review:{id:'saved'}}:{token:'claim',receipt_path:'user/photo.png',model:'gpt-6-luna'});
    if(url.includes('/storage/'))return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/png'}});
    if(url.includes('api.openai.com'))return json({status:options.incomplete?'incomplete':'completed',usage:{input_tokens:4000,output_tokens:2000},output:[{content:[{type:'output_text',text:JSON.stringify(options.bad?{bad:true}:extracted)}]}]});
    if(url.endsWith('/finish_receipt_review_scan')){const body=JSON.parse(init.body);saved.push(body);return options.saveFailure?json({error:'offline'},503):json({id:'saved',scan_status:body.p_error?'failed':'complete'});}
    throw Error('Unexpected test fetch: '+url);
  });
  const result=await handler(new Request('https://edge.test',{method:'POST',headers:{origin:options.origin??'https://review.test',authorization:'Bearer test'},body:JSON.stringify(options.status?{action:'status'}:{review_id:'11111111-1111-4111-8111-111111111111'})}));
  return {result,calls,saved,paid:calls.filter(c=>c.url.includes('api.openai.com'))};
}
for(const option of [{off:true},{cached:true},{env:{OPENAI_API_KEY:''}},{origin:'https://evil.test'}])assert.equal((await edge(option)).paid.length,0);
const good=await edge();assert.equal(good.result.status,200);assert.equal(good.paid.length,1);assert.deepEqual(good.saved[0].p_extraction,extracted);
const request=JSON.parse(good.paid[0].init.body);assert.equal(request.model,'gpt-6-luna');assert.equal(request.store,false);assert.equal(request.text.format.strict,true);assert.equal(request.reasoning.effort,'none');
for(const option of [{bad:true},{incomplete:true}]){const r=await edge(option);assert.equal(r.result.status,502);assert(r.saved[0].p_error);assert.equal(r.saved[0].p_extraction,null);}
const failure=await edge({saveFailure:true});assert.equal(failure.result.status,502);assert.equal(failure.paid.length,1,'Persistence failures never automatically make another paid call');
console.log('PASS: blank/missing fields, non-overwriting extraction, money reconciliation, structured output, CORS, disabled/cached/missing-key scans, incomplete results, no automatic paid retry.');
for(const key of ['', 'fake-test-not-real']){
  const r=await edge({status:true,env:{OPENAI_API_KEY:key}});assert.equal(r.result.status,200);
  assert.deepEqual(await r.result.json(),{database_ready:true,private_storage_ready:true,key_configured:Boolean(key),api_tested:false});
  assert.equal(r.paid.length,0);assert.equal(r.saved.length,0);assert.equal(r.calls.length,2,'Setup only checks identity and authorized readiness');
}
assert.equal((await edge({status:true,denied:true})).result.status,403);
assert.equal((await edge({status:true,unauthorized:true})).result.status,401);
console.log('PASS: authenticated administrator setup check, no keys returned, no scan claim, no photo reads, no paid request.');

export async function testReceiptReview(db){
  await db.exec(`reset role;select set_config('test.role','owner',false);create role service_role;
    create table purchase_suppliers(id uuid primary key default gen_random_uuid(),name text not null,created_by uuid);
    create unique index purchase_suppliers_name on purchase_suppliers(lower(name));
    create function begin_purchase_receipt_scan(uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
    insert into auth.users values('99999999-9999-4999-8999-999999999999');
    insert into profiles values('99999999-9999-4999-8999-999999999999','Other Purchaser');
    create or replace function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('test.actor',true),''),'11111111-1111-4111-8111-111111111111')::uuid$$;`);
  const migration=await readFile('supabase/migrations/202610040062_receipt_review_workflow.sql','utf8');
  try{await db.exec(migration);}catch(e){console.error(migration.slice(Number(e.position)-250,Number(e.position)+100),e);throw e;}
  await db.exec(`create table storage.buckets(id text primary key,public boolean);insert into storage.buckets values('purchase-evidence',false);`);
  await db.exec(await readFile('supabase/migrations/202610040064_receipt_scan_readiness.sql','utf8'));
  const rpc=async(name,args=[],types=[])=>(await db.query(`select ${name}(${args.map((_,i)=>'$'+(i+1)+(types[i]?'::'+types[i]:'')).join(',')}) r`,args.map(a=>typeof a==='object'&&a!==null?JSON.stringify(a):a))).rows[0].r;
  const save=(id,version,data)=>rpc('save_receipt_review',[id,version,data],['uuid','integer','jsonb']);
  const id=crypto.randomUUID();await db.exec('set role authenticated');let r=await save(id,0,blank);assert.equal(r.status,'pending');assert.equal((await save(id,0,blank)).version,1);assert(r.created_at);assert(!r.scan_token);
  assert.deepEqual(await rpc('read_receipt_scan_readiness'),{database_ready:true,private_storage_ready:true});
  await db.exec("select set_config('test.role','worker',false)");await assert.rejects(()=>rpc('read_receipt_scan_readiness'),/Permission denied/);
  await db.exec("reset role;update storage.buckets set public=true;select set_config('test.role','owner',false);set role authenticated");
  assert.equal((await rpc('read_receipt_scan_readiness')).private_storage_ready,false);
  await db.exec('reset role;update storage.buckets set public=false;set role authenticated');
  await assert.rejects(()=>rpc('save_expense_receipt',[{},crypto.randomUUID()],['jsonb','uuid']),/permission denied/);
  let data={...blank,supplier:'QA Supplier'};r=await save(id,r.version,data);assert.equal(r.version,2);await assert.rejects(()=>save(id,1,{...data,supplier:'Overwrite'}),/another device/);
  await assert.rejects(()=>db.query('delete from receipt_reviews'),/permission denied/);await assert.rejects(()=>db.query('update receipt_review_events set action=\'hidden\''),/permission denied/);
  await assert.rejects(()=>rpc('begin_receipt_review_scan',[id]),/switched off/);await assert.rejects(()=>rpc('begin_purchase_receipt_scan',[id]),/switched off/);
  await db.exec("select set_config('test.role','worker',false)");await assert.rejects(()=>rpc('read_receipt_reviews'),/Permission denied/);await assert.rejects(()=>rpc('save_receipt_ai_settings',[true,1,1]),/Permission denied/);await db.exec("select set_config('test.role','owner',false)");
  const settings=await rpc('save_receipt_ai_settings',[true,1,1]);assert.equal(settings.version,2);await assert.rejects(()=>rpc('save_receipt_ai_settings',[false,1,1]),/Settings changed/);
  const supplier=await rpc('save_purchase_supplier_profile',[{name:'QA Supplier',address:'Branch A',tax_id:'T1',phone:'0123'},0],['jsonb','integer']);assert.equal(supplier.version,1);await assert.rejects(()=>rpc('save_purchase_supplier_profile',[{name:'QA Supplier',address:'Branch B'},0],['jsonb','integer']),/Supplier changed/);
  const prefix='11111111-1111-4111-8111-111111111111/';
  data={...data,purpose:'guest_meals',receipt:{path:prefix+'receipt.png',hash:'c'.repeat(64)},items:{path:prefix+'items.png',hash:'d'.repeat(64)}};r=await save(id,r.version,data);
  await db.exec("select set_config('test.actor','99999999-9999-4999-8999-999999999999',false)");await assert.rejects(()=>save(id,r.version,{...data,supplier:'Wrong Actor'}),/Only the purchaser/);await assert.rejects(()=>rpc('begin_receipt_review_scan',[id]),/own pending/);await db.exec("select set_config('test.actor','',false)");
  const claim=await rpc('begin_receipt_review_scan',[id]);assert(claim.token);await assert.rejects(()=>rpc('begin_receipt_review_scan',[id]),/already started/);
  await assert.rejects(()=>rpc('finish_receipt_review_scan',[id,claim.token,extracted,{},null],['uuid','uuid','jsonb','jsonb','text']),/permission denied/);
  await db.exec('reset role;set role service_role');r=await rpc('finish_receipt_review_scan',[id,claim.token,extracted,{input_tokens:10},null],['uuid','uuid','jsonb','jsonb','text']);assert.equal(r.data.total_cost,'104');assert.equal(r.data.supplier,'QA Supplier');assert.equal(r.data.lines[0].quantity,'2');assert.equal(r.scan_status,'complete');
  await assert.rejects(()=>rpc('finish_receipt_review_scan',[id,claim.token,extracted,{},null],['uuid','uuid','jsonb','jsonb','text']),/claim/);
  await db.exec('reset role;set role authenticated');assert((await rpc('begin_receipt_review_scan',[id])).cached);await assert.rejects(()=>rpc('confirm_receipt_review',[id,r.version,false]),/verify/);
  const other=await save(crypto.randomUUID(),0,data);await assert.rejects(()=>rpc('begin_receipt_review_scan',[other.id]),/daily scan limit/);
  r=await save(id,r.version,{...r.data,total_cost:'105'});await assert.rejects(()=>rpc('confirm_receipt_review',[id,r.version,true]),/missing or unreadable/);
  r=await save(id,r.version,{...r.data,total_cost:'104'});const result=await rpc('confirm_receipt_review',[id,r.version,true]);assert.equal(result.accounting_details.address,'Lot 1, QA Branch');assert.equal(result.total_cost,104);assert.equal((await rpc('confirm_receipt_review',[id,0,false])).id,result.id,'Lost confirmation reply is idempotent');
  await assert.rejects(()=>save(id,r.version,r.data),/Only the purchaser/);
  const events=await rpc('read_receipt_review_events',[id]);assert(events.some(e=>e.action==='confirmed'));assert(events.some(e=>e.action==='scan_completed'));assert(events.every(e=>e.created_at&&e.actor_name));
  await assert.rejects(()=>rpc('delete_receipt_review',[other.id,other.version,'']),/reason/);const removed=await rpc('delete_receipt_review',[other.id,other.version,'Duplicate photo, kept for evidence']);assert.equal(removed.status,'deleted');assert(removed.deleted_at);assert(removed.data.receipt);assert.equal((await rpc('read_receipt_reviews',['deleted'])).total,1);
  const failReview=await save(crypto.randomUUID(),0,data);await rpc('save_receipt_ai_settings',[true,20,settings.version]);const failedClaim=await rpc('begin_receipt_review_scan',[failReview.id]);await db.exec('reset role;set role service_role');const failed=await rpc('finish_receipt_review_scan',[failReview.id,failedClaim.token,null,null,'Unreadable photo'],['uuid','uuid','jsonb','jsonb','text']);assert.equal(failed.status,'pending');assert.equal(failed.scan_status,'failed');
  await db.exec('reset role;set role authenticated');const reset=await rpc('reset_receipt_review_scan',[failed.id,failed.version]);assert.equal(reset.scan_status,'idle');
  await db.exec('reset role');assert.equal(Number((await db.query('select quantity_on_hand n from ingredient_balances where ingredient_id=$1',['22222222-2222-4222-8222-222222222222'])).rows[0].n),7500,'Receipt confirmation never changes inventory');
  assert.equal(Number((await db.query('select count(*) n from expense_receipts where id=$1',[result.id])).rows[0].n),1);
  console.log('PASS: SQL cloud drafts, actor/version checks, disabled/rate-limited scans, service-only extraction, immutable staff audit access, required human review, discrepancy notes, idempotent confirmation, retained removals, failed scan reset, unchanged inventory.');
}
