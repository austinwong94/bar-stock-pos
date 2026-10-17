import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
const base=process.env.TEST_URL??'http://127.0.0.1:5177',out=resolve('.qa/screenshots/delivery-issues');await mkdir(out,{recursive:true});
const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],remote=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/supabase\.(co|in)|api.openai.com/.test(r.url()))remote.push(r.url());});
const dialog=()=>page.getByRole('dialog').last(),inbox=()=>page.getByRole('region',{name:'Delivery Issues',exact:true});
async function screenshot(label,modal=true){for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:width<768?844:1000});
  await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1,undefined,{timeout:3000}).catch(()=>{});
  const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,elements:[...document.querySelectorAll('main *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).map(el=>({tag:el.tagName,class:el.className,text:el.textContent.slice(0,80),right:el.getBoundingClientRect().right})).slice(-12)}));
  assert(overflow.scroll<=overflow.width+1,'Page overflow '+label+' '+JSON.stringify(overflow));
  if(modal){assert(await dialog().evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Dialog overflow');assert(await dialog().evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight+1),'Footer outside screen');}
  await page.screenshot({path:out+'/'+label+'-'+width+'.png'});
}}
const state=()=>page.evaluate(async()=>{const {db}=await import('/src/lib/demoBackend.ts');return {issues:structuredClone(db.delivery_issues??[]),receipts:structuredClone(db.purchase_receipts??[]),events:db.audit_logs.filter(r=>r.entity_type==='delivery_issue'),calls:window.issueCalls??[]};});
try{
  await page.goto(base);await page.getByRole('button',{name:'Austin (Owner)',exact:true}).click();await page.locator('main').waitFor();
  const fixture=await page.evaluate(async()=>{
    const {db,persistDemoDb,currentUserIdRef}=await import('/src/lib/demoBackend.ts');const now=new Date().toISOString(),request=crypto.randomUUID(),item=crypto.randomUUID();
    db.purchase_requests.push({id:request,request_no:'PR-SAMPLE-DELIVERY',status:'completed',needed_for_date:'2026-10-04',created_at:now,updated_at:now,requested_by:currentUserIdRef.value});
    db.purchase_request_items.push({id:item,request_id:request,item_name:'Rice',unit:'pack',quantity:10,purchased_quantity:10,purchase_status:'bought',supplier:'Sample Supplier',sort_order:0,updated_at:now,actual_cost:125});
    db.purchase_receipts??=[];db.purchase_receipts.push({id:crypto.randomUUID(),purchase_item_id:item,purchase_quantity:2});persistDemoDb();return {request,item};
  });
  await page.goto(base+'/#/kitchen/stock?view=arrivals');await page.reload();
  const requestRow=()=>page.locator('li').filter({has:page.getByText('PR-SAMPLE-DELIVERY',{exact:true})}).last();
  await requestRow().getByRole('button',{name:'Report Issue',exact:true}).click();
  await dialog().getByLabel('Affected Item',{exact:true}).selectOption(fixture.item);await dialog().getByRole('button',{name:'Missing',exact:true}).click();
  await dialog().getByLabel('Affected Quantity',{exact:true}).fill('9');assert(await dialog().getByRole('button',{name:'Send Issue',exact:true}).isDisabled());
  await dialog().getByLabel('Affected Quantity',{exact:true}).fill('3');await dialog().getByLabel('Issue Details',{exact:true}).fill('Sample: three packs missing from this delivery. Supplier asked to check.');
  await screenshot('report');await dialog().getByRole('button',{name:'Save & Close',exact:true}).click();await page.reload();
  await inbox().getByRole('button',{name:'Resume',exact:true}).click();assert.equal(await dialog().getByLabel('Affected Quantity',{exact:true}).inputValue(),'3');
  const baseline=await state();assert.equal(baseline.issues.length,0,'Unsent draft is not an issue or delivery');
  await page.evaluate(async()=>{const {supabase}=await import('/src/lib/supabase.ts');const rpc=supabase.rpc.bind(supabase);let lose=true;window.issueCalls=[];supabase.rpc=async(name,args)=>{
    if(name==='report_delivery_issue')window.issueCalls.push(structuredClone(args));const r=await rpc(name,args);if(name==='report_delivery_issue'&&!r.error&&lose){lose=false;return {data:null,error:{message:'Sample lost issue reply'}};}return r;};});
  await dialog().getByRole('button',{name:'Send Issue',exact:true}).click();await dialog().getByRole('button',{name:'Retry Submission',exact:true}).waitFor();
  assert(await dialog().getByLabel('Affected Quantity',{exact:true}).isDisabled());await dialog().getByRole('button',{name:'Retry Submission',exact:true}).click();
  await dialog().getByRole('heading',{name:'Issue Sent',exact:true}).waitFor();const sent=await state();assert.equal(sent.issues.length,1);assert.deepEqual(sent.calls[0],sent.calls[1]);assert.equal(sent.events.length,1);assert.deepEqual(sent.receipts,baseline.receipts);
  await dialog().getByRole('button',{name:'Done',exact:true}).click();await inbox().getByText('Rice · 3 pack',{exact:true}).waitFor();await screenshot('kitchen-inbox',false);
  await page.goto(base+'/#/kitchen/purchases?view=open');await page.reload();await page.getByRole('heading',{name:/^To Buy/}).waitFor();
  await inbox().getByText('Rice · 3 pack',{exact:true}).waitFor();await screenshot('purchaser-inbox',false);
  await inbox().getByRole('button',{name:'Follow Up',exact:true}).click();assert(await dialog().getByRole('button',{name:'Resolve Issue',exact:true}).isDisabled());
  await dialog().getByLabel('Follow-up / Outcome',{exact:true}).fill('Sample: supplier agreed to replace three packs tomorrow. Kitchen will record the actual arrival separately.');
  await page.evaluate(async()=>{const {supabase}=await import('/src/lib/supabase.ts');const rpc=supabase.rpc.bind(supabase);let lose=true;supabase.rpc=async(name,args)=>{const r=await rpc(name,args);if(name==='close_delivery_issue'&&!r.error&&lose){lose=false;return {data:null,error:{message:'Sample lost follow-up reply'}};}return r;};});
  await dialog().getByRole('button',{name:'Resolve Issue',exact:true}).click();await dialog().getByRole('button',{name:'Retry Resolution',exact:true}).waitFor();
  await dialog().getByRole('button',{name:'Retry Resolution',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});
  await inbox().getByRole('button',{name:'Closed (1)',exact:true}).click();await inbox().getByText(/supplier agreed to replace/).waitFor();await screenshot('closed-history',false);
  const closed=await state();assert.equal(closed.events.length,2);assert.equal(closed.issues[0].status,'closed');assert.deepEqual(closed.receipts,baseline.receipts);
  await page.goto(base+'/#/kitchen/stock?view=arrivals');await page.reload();await requestRow().getByRole('button',{name:'Report Issue',exact:true}).click();
  await dialog().getByLabel('Affected Item',{exact:true}).selectOption(fixture.item);await dialog().getByRole('button',{name:'Damaged / Rejected',exact:true}).click();await dialog().getByLabel('Affected Quantity',{exact:true}).fill('2');await dialog().getByRole('button',{name:'Save & Close',exact:true}).click();
  await page.evaluate(async({item})=>{const {db,persistDemoDb}=await import('/src/lib/demoBackend.ts');const r=db.purchase_request_items.find(r=>r.id===item);r.unit='bag';r.updated_at=new Date().toISOString();persistDemoDb();},fixture);
  await page.reload();await inbox().getByRole('button',{name:'Resume',exact:true}).click();await dialog().getByText('The item or unit changed. Check it and enter the affected quantity again.',{exact:true}).waitFor();assert.equal(await dialog().getByLabel('Affected Quantity',{exact:true}).inputValue(),'');assert(await dialog().getByRole('button',{name:'Send Issue',exact:true}).isDisabled());
  await dialog().getByLabel('Affected Quantity',{exact:true}).fill('2');await dialog().getByRole('button',{name:'Save & Close',exact:true}).click();await page.getByRole('button',{name:'BM',exact:true}).click();await page.getByRole('region',{name:'Masalah Penghantaran',exact:true}).getByRole('button',{name:'Sambung',exact:true}).click();await screenshot('report-malay');
  await dialog().getByRole('button',{name:'Buang Draf',exact:true}).click();await dialog().getByLabel('Sebab Pembuangan',{exact:true}).fill('Sample: wrong request. Keep this original draft in the audit log.');await dialog().getByRole('button',{name:'Buang Draf',exact:true}).click();await dialog().getByRole('heading',{name:'Draf Dibuang',exact:true}).waitFor();
  const removed=await page.evaluate(async()=>{const {db}=await import('/src/lib/demoBackend.ts');return db.audit_logs.filter(r=>r.action==='delivery_issue_draft_removed');});assert.equal(removed.length,1);assert.equal(removed[0].before_json.quantity,'2');assert.equal(removed[0].before_json.unit,'bag');assert(removed[0].after_json.removed_at);
  assert.deepEqual((await state()).receipts,baseline.receipts);
  assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
  console.log('PASS: mobile report entry, no over-reporting, saved device drafts, exact retry recovery, purchaser visibility, attributed closure, no inventory writes, changed-unit re-entry, EN/MS 320/390/768/1440 layouts.');console.log(out);
}catch(e){await page.screenshot({path:out+'/failure.png'});console.error((await page.locator('body').innerText()).slice(-5000));throw e;}finally{await browser.close();}
