import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
const base=process.env.TEST_URL??'http://127.0.0.1:5177',out=resolve('.qa/screenshots/receipt-delivery-issues');await mkdir(out,{recursive:true});
const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],remote=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/supabase\.(co|in)|api.openai.com/.test(r.url()))remote.push(r.url());});
const dialog=()=>page.getByRole('dialog').last(),inbox=()=>page.getByRole('region',{name:'Delivery Issues',exact:true});
async function screenshot(label,modal=false){for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:width<768?844:1000});
  await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1,undefined,{timeout:3000});
  if(modal){assert(await dialog().evaluate(el=>el.scrollWidth<=el.clientWidth+1));assert(await dialog().evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight+1));}
  await page.screenshot({path:out+'/'+label+'-'+width+'.png'});
}}
const state=()=>page.evaluate(async()=>{const {db}=await import('/src/lib/demoBackend.ts');const {loadLocalIngredientItems}=await import('/src/lib/localStore.ts');return {
  issues:structuredClone(db.delivery_issues??[]),arrivals:structuredClone(db.receipt_delivery_drafts??[]),items:loadLocalIngredientItems(),
  receipts:structuredClone(db.expense_receipts),events:db.audit_logs.filter(a=>a.entity_type==='delivery_issue'),calls:window.issueCalls??[]};});
try{
  await page.goto(base);await page.getByRole('button',{name:'Austin (Owner)',exact:true}).click();await page.locator('main').waitFor();
  const fixture=await page.evaluate(async()=>{
    const {db,persistDemoDb,currentUserIdRef}=await import('/src/lib/demoBackend.ts');const {demoSupplyHandlers}=await import('/src/lib/demoSupplyWorkflow.ts');
    const {malaysiaDateInputValue}=await import('/src/lib/format.ts');
    const r=demoSupplyHandlers.save_expense_receipt({p_operation_id:crypto.randomUUID(),p_receipt:{supplier:'99 Speedmart (Sample)',receipt_no:'SAMPLE-ISSUE-001',purpose:'guest_meals',purchase_date:malaysiaDateInputValue(new Date()),total_cost:102,
      receipt_path:currentUserIdRef.value+'/sample-receipt.jpg',items_path:currentUserIdRef.value+'/sample-goods.jpg',receipt_hash:crypto.randomUUID(),items_hash:crypto.randomUUID(),notes:'Sample only',
      lines:[{name:'BERAS',unit:'pack',quantity:10,category:'Rice & Dry Goods',amount:100},{name:'CILI MERAH',unit:'kg',quantity:0.1234,category:'Vegetables',amount:2}]}});
    persistDemoDb();const source=db.receipt_delivery_sources.find(s=>s.id===r.id);return {receipt:r.id,item:source.lines[0].id,weight:source.lines[1].id};
  });
  await page.goto(base+'/#/kitchen/stock?view=arrivals');await page.reload();
  const row=()=>page.locator(`[data-receipt-delivery="${fixture.receipt}"]`);
  await row().getByRole('button',{name:'Report Issue',exact:true}).waitFor();await row().scrollIntoViewIfNeeded();await screenshot('arrival-actions');
  await row().getByRole('button',{name:'Report Issue',exact:true}).click();
  await dialog().getByLabel('Affected Item',{exact:true}).selectOption(fixture.item);await dialog().getByRole('button',{name:'Missing',exact:true}).click();
  await dialog().getByLabel('Affected Quantity',{exact:true}).fill('11');assert(await dialog().getByRole('button',{name:'Send Issue',exact:true}).isDisabled());
  await dialog().getByLabel('Affected Quantity',{exact:true}).fill('2');await dialog().getByLabel('Issue Details',{exact:true}).fill('Sample: two packs did not arrive. Please check with the supplier.');
  await screenshot('report',true);await dialog().getByRole('button',{name:'Save & Close',exact:true}).click();await page.reload();
  await inbox().getByRole('button',{name:'Resume',exact:true}).click();assert.equal(await dialog().getByLabel('Affected Quantity',{exact:true}).inputValue(),'2');
  const baseline=await state();assert.equal(baseline.issues.length,0);
  await page.evaluate(async()=>{const {supabase}=await import('/src/lib/supabase.ts');const rpc=supabase.rpc.bind(supabase);let lose=true;window.issueCalls=[];supabase.rpc=async(name,args)=>{
    if(name==='report_receipt_delivery_issue')window.issueCalls.push(structuredClone(args));const r=await rpc(name,args);if(name==='report_receipt_delivery_issue'&&!r.error&&lose){lose=false;return {data:null,error:{message:'Sample lost issue reply'}};}return r;};});
  await dialog().getByRole('button',{name:'Send Issue',exact:true}).click();await dialog().getByRole('button',{name:'Retry Submission',exact:true}).click();
  await dialog().getByRole('heading',{name:'Issue Sent',exact:true}).waitFor();const sent=await state();assert.equal(sent.issues.length,1);assert.deepEqual(sent.calls[0],sent.calls[1]);assert.equal(sent.events.length,1);
  assert.equal(sent.issues[0].receipt_id,fixture.receipt);assert.equal(sent.issues[0].request_id,null);assert.equal(sent.issues[0].receipt_line_id,fixture.item);
  await dialog().getByRole('button',{name:'Done',exact:true}).click();await inbox().getByText('BERAS · 2 pack',{exact:true}).waitFor();
  assert((await inbox().innerText()).includes('Receipt SAMPLE-ISSUE-001 · Supplier: 99 Speedmart (Sample)'));
  await page.goto(base+'/#/kitchen/purchases?view=open');await page.reload();await inbox().getByText('BERAS · 2 pack',{exact:true}).waitFor();await inbox().scrollIntoViewIfNeeded();await screenshot('purchaser-follow-up');
  await inbox().getByRole('button',{name:'Follow Up',exact:true}).click();assert(await dialog().getByRole('button',{name:'Resolve Issue',exact:true}).isDisabled());
  await dialog().getByLabel('Follow-up / Outcome',{exact:true}).fill('Sample: supplier will deliver the missing packs tomorrow. Record arrival when received.');
  await dialog().getByRole('button',{name:'Resolve Issue',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});
  await inbox().getByRole('button',{name:'Closed (1)',exact:true}).click();await inbox().getByText(/supplier will deliver/).waitFor();
  await page.goto(base+'/#/kitchen/stock?view=arrivals');await page.reload();await row().getByRole('button',{name:'Report Issue',exact:true}).click();
  await dialog().getByLabel('Affected Item',{exact:true}).selectOption(fixture.weight);await dialog().getByRole('button',{name:'Damaged / Rejected',exact:true}).click();await dialog().getByLabel('Affected Quantity',{exact:true}).fill('0.1234');
  assert(await dialog().getByRole('button',{name:'Send Issue',exact:true}).isEnabled());await dialog().getByRole('button',{name:'Save & Close',exact:true}).click();await page.getByRole('button',{name:'BM',exact:true}).click();
  await page.getByRole('region',{name:'Masalah Penghantaran',exact:true}).getByRole('button',{name:'Sambung',exact:true}).click();await dialog().getByText('Belum Diterima: 0.1234 kg',{exact:true}).waitFor();await screenshot('report-malay',true);
  await dialog().getByRole('button',{name:'Simpan & Tutup',exact:true}).click();await page.getByRole('button',{name:'EN',exact:true}).click();await inbox().getByRole('button',{name:'Resume',exact:true}).click();
  // Simulate a reply lost after the report committed, followed by closing the window.
  await page.evaluate(async()=>{const {supabase}=await import('/src/lib/supabase.ts');const rpc=supabase.rpc.bind(supabase);let lose=true;supabase.rpc=async(name,args)=>{const r=await rpc(name,args);if(name==='report_receipt_delivery_issue'&&!r.error&&lose){lose=false;return {data:null,error:{message:'Sample lost issue reply'}};}return r;};});
  await dialog().getByRole('button',{name:'Send Issue',exact:true}).click();await dialog().getByRole('button',{name:'Retry Submission',exact:true}).waitFor();await dialog().getByRole('button',{name:'Save & Close',exact:true}).click();await page.reload();
  await inbox().getByRole('button',{name:'Resume',exact:true}).click();await dialog().getByRole('heading',{name:'Issue Sent',exact:true}).waitFor();assert.equal((await state()).issues.length,2);await dialog().getByRole('button',{name:'Done',exact:true}).click();
  assert.equal(await inbox().getByRole('button',{name:'Resume',exact:true}).count(),0);
  await row().getByRole('button',{name:'Report Issue',exact:true}).click();await dialog().getByLabel('Affected Item',{exact:true}).selectOption(fixture.item);await dialog().getByRole('button',{name:'Arriving Later',exact:true}).click();await dialog().getByLabel('Affected Quantity',{exact:true}).fill('1');
  await dialog().getByRole('button',{name:'Remove Draft',exact:true}).click();await dialog().getByLabel('Removal Reason',{exact:true}).fill('Sample: already covered by the earlier report.');await dialog().getByRole('button',{name:'Remove Draft',exact:true}).click();await dialog().getByRole('heading',{name:'Draft Removed',exact:true}).waitFor();
  const removed=await page.evaluate(async()=>{const {db}=await import('/src/lib/demoBackend.ts');return db.audit_logs.filter(a=>a.action==='delivery_issue_draft_removed');});assert.equal(removed.length,1);assert.equal(removed[0].before_json.receipt_id,fixture.receipt);assert.equal(removed[0].before_json.receipt_line_id,fixture.item);assert(removed[0].after_json.removed_at);
  const final=await state();assert.deepEqual(final.items,baseline.items);assert.deepEqual(final.arrivals,baseline.arrivals);assert.deepEqual(final.receipts,baseline.receipts);
  assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
  console.log('PASS: receipt issue action, pending draft reload, source-specific inbox, exact retries and lost-reply reopen, purchaser follow-up, four-decimal quantities, removal audit, unchanged stock and receipt totals, EN/MS 320/390/768/1440.');console.log(out);
}catch(e){await page.screenshot({path:out+'/failure.png'});console.error((await page.locator('body').innerText()).slice(-6000));throw e;}finally{await browser.close();}
