import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
const base=process.env.TEST_URL??'http://127.0.0.1:5177',out=resolve('.qa/screenshots/delivery-source-issues');await mkdir(out,{recursive:true});
const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],remote=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/supabase\.(co|in)|api.openai.com/.test(r.url()))remote.push(r.url());});
const dialog=()=>page.getByRole('dialog').last();
async function screenshot(label){for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:width<768?844:1000});await page.waitForTimeout(200);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert(await dialog().evaluate(el=>el.scrollWidth<=el.clientWidth+1&&el.getBoundingClientRect().bottom<=innerHeight+1));
  await page.screenshot({path:out+'/'+label+'-'+width+'.png'});
}}
const drafts=()=>page.evaluate(()=>Object.entries(localStorage).filter(([k])=>k.startsWith('delivery-issue:')).map(([k,v])=>({key:k,value:JSON.parse(v)})));
try{
  await page.goto(base);await page.getByRole('button',{name:'Austin (Owner)',exact:true}).click();await page.locator('main').waitFor();
  const fixture=await page.evaluate(async()=>{
    const {db,persistDemoDb}=await import('/src/lib/demoBackend.ts');const {demoSupplyHandlers}=await import('/src/lib/demoSupplyWorkflow.ts');const {demoDeliveryIssueHandlers:h}=await import('/src/lib/demoDeliveryIssues.ts');
    const now=new Date().toISOString(),request=crypto.randomUUID(),item=crypto.randomUUID(),other=crypto.randomUUID(),issue=crypto.randomUUID();
    db.purchase_requests.push({id:request,request_no:'PR-SAMPLE-CHECK',status:'completed',needed_for_date:'2026-10-05',created_at:now,updated_at:now});
    for(const [id,name] of [[item,'BERAS'],[other,'TELUR']])db.purchase_request_items.push({id,request_id:request,item_name:name,unit:'pack',quantity:10,purchased_quantity:10,purchase_status:'bought',supplier:'99 Speedmart (Sample)',sort_order:0,updated_at:now,actual_cost:100});
    h.report_delivery_issue({p_id:issue,p_data:{item_id:item,kind:'missing',quantity:2,note:'Two packs did not arrive.',expected_updated_at:now,expected_received_quantity:0}});
    h.add_delivery_issue_update({p_id:crypto.randomUUID(),p_issue_id:issue,p_version:1,p_note:'Supplier confirmed: two replacement packs arriving tomorrow.'});
    const receipt=demoSupplyHandlers.save_expense_receipt({p_operation_id:crypto.randomUUID(),p_receipt:{supplier:'AEON (Sample)',receipt_no:'SAMPLE-CHECK-02',purpose:'guest_meals',purchase_date:'2026-10-05',total_cost:100,receipt_path:'u-master/sample-receipt.jpg',items_path:'u-master/sample-goods.jpg',receipt_hash:crypto.randomUUID(),items_hash:crypto.randomUUID(),notes:'Sample only',lines:[{name:'BERAS',unit:'pack',quantity:10,category:'Rice & Dry Goods',amount:100}]}});
    const source=db.receipt_delivery_sources.find(s=>s.id===receipt.id),receiptItem=source.lines[0].id;
    persistDemoDb();return {request,item,other,issue,now,receipt:receipt.id,receiptItem};
  });
  await page.evaluate(()=>localStorage.setItem('lovely_paradise_demo_user','u-cook'));
  await page.goto(base+'/#/kitchen/stock?view=arrivals');await page.reload();
  const requestRow=()=>page.locator('li').filter({has:page.getByText('PR-SAMPLE-CHECK',{exact:true})});
  await requestRow().getByRole('button',{name:'Report Issue',exact:true}).click();
  await dialog().getByLabel('Affected Item',{exact:true}).selectOption(fixture.item);
  await dialog().getByRole('region',{name:'Existing Report',exact:true}).waitFor();
  assert.equal(await dialog().getByLabel('Affected Quantity',{exact:true}).count(),0);
  assert.equal(await dialog().getByRole('button',{name:'Send Issue',exact:true}).count(),0);
  assert.equal((await drafts()).length,0,'Looking at someone else\'s report must not create an unsent draft');
  assert((await dialog().innerText()).includes('two replacement packs arriving tomorrow'));
  await screenshot('existing-report');
  await dialog().getByRole('button',{name:'Updates (1)',exact:true}).click();
  await dialog().getByRole('region',{name:'Update History',exact:true}).waitFor();assert.equal(await dialog().getByRole('textbox').count(),0,'Kitchen sees read-only follow-up');
  await dialog().getByRole('button',{name:'Done',exact:true}).click();await dialog().getByRole('region',{name:'Existing Report',exact:true}).waitFor();
  await dialog().getByLabel('Affected Item',{exact:true}).selectOption(fixture.other);
  await dialog().getByRole('button',{name:'Missing',exact:true}).click();await dialog().getByLabel('Affected Quantity',{exact:true}).fill('1');await dialog().getByLabel('Issue Details',{exact:true}).fill('Keep this unfinished egg report.');
  const draftBefore=await drafts();
  await dialog().getByLabel('Affected Item',{exact:true}).selectOption(fixture.item);assert.deepEqual(await drafts(),draftBefore);
  await dialog().getByRole('button',{name:'Done',exact:true}).click();await page.reload();
  await page.getByRole('region',{name:'Delivery Issues',exact:true}).getByRole('button',{name:'Resume',exact:true}).click();
  assert.equal(await dialog().getByLabel('Affected Quantity',{exact:true}).inputValue(),'1');assert.equal(await dialog().getByLabel('Issue Details',{exact:true}).inputValue(),'Keep this unfinished egg report.');
  // A second kitchen user submits while the first user's form is still open.
  await page.evaluate(async f=>{const {demoDeliveryIssueHandlers:h}=await import('/src/lib/demoDeliveryIssues.ts');const {persistDemoDb}=await import('/src/lib/demoBackend.ts');h.report_delivery_issue({p_id:crypto.randomUUID(),p_data:{item_id:f.other,kind:'missing',quantity:1,note:'Reported by the other receiver.',expected_updated_at:f.now,expected_received_quantity:0}});persistDemoDb();},fixture);
  await dialog().getByRole('button',{name:'Send Issue',exact:true}).click();await dialog().getByRole('region',{name:'Existing Report',exact:true}).waitFor();
  assert.equal((await drafts())[0].value.note,'Keep this unfinished egg report.');assert.equal((await drafts())[0].value.attempt,undefined);
  assert.equal(await page.evaluate(async()=>{const {db}=await import('/src/lib/demoBackend.ts');return db.delivery_issues.length;}),2);
  await dialog().getByRole('button',{name:'Done',exact:true}).click();
  // A different receipt containing the same item is not blocked by the request's report.
  const receiptRow=()=>page.locator(`[data-receipt-delivery="${fixture.receipt}"]`);
  await receiptRow().getByRole('button',{name:'Report Issue',exact:true}).click();await dialog().getByLabel('Affected Item',{exact:true}).selectOption(fixture.receiptItem);
  await dialog().getByRole('button',{name:'Missing',exact:true}).click();await dialog().getByLabel('Affected Quantity',{exact:true}).fill('2');assert(await dialog().getByRole('button',{name:'Send Issue',exact:true}).isEnabled());
  await dialog().getByRole('button',{name:'Send Issue',exact:true}).click();await dialog().getByRole('heading',{name:'Issue Sent',exact:true}).waitFor();await dialog().getByRole('button',{name:'Done',exact:true}).click();
  await page.getByRole('button',{name:'BM',exact:true}).click();await receiptRow().getByRole('button',{name:'Lapor Masalah',exact:true}).click();
  await dialog().getByLabel('Item Terjejas',{exact:true}).selectOption(fixture.receiptItem);await dialog().getByRole('region',{name:'Laporan Sedia Ada',exact:true}).waitFor();await screenshot('receipt-malay');
  await dialog().getByRole('button',{name:'Selesai',exact:true}).click();await page.getByRole('button',{name:'EN',exact:true}).click();
  // A failed lookup cannot silently allow a fresh duplicate report.
  await page.evaluate(async()=>{const {supabase}=await import('/src/lib/supabase.ts');const rpc=supabase.rpc.bind(supabase);let fail=true;supabase.rpc=async(name,args)=>{if(name==='read_delivery_source_issues'&&fail){fail=false;return {data:null,error:{message:'Sample lookup interrupted'}};}return rpc(name,args);};});
  await receiptRow().getByRole('button',{name:'Report Issue',exact:true}).click();await dialog().getByRole('alert').filter({hasText:'lookup interrupted'}).waitFor();assert(await dialog().getByRole('button',{name:'Send Issue',exact:true}).isDisabled());
  await dialog().getByRole('button',{name:'Retry',exact:true}).click();await dialog().getByLabel('Affected Item',{exact:true}).selectOption(fixture.receiptItem);await dialog().getByRole('region',{name:'Existing Report',exact:true}).waitFor();
  assert.equal(await dialog().getByRole('alert').count(),0,'Successful retry clears the old lookup error');
  // Model an already-authorised buyer's resolution arriving from another device.
  await page.evaluate(async f=>{const {db,persistDemoDb}=await import('/src/lib/demoBackend.ts');const i=db.delivery_issues.find(i=>i.receipt_id===f.receipt);Object.assign(i,{status:'closed',version:i.version+1,closed_by:'u-buyer',closed_by_name:'Sam',closed_at:new Date().toISOString(),resolution:'Sample: replacement has been checked.'});persistDemoDb();},fixture);
  await dialog().getByRole('button',{name:'Refresh Report',exact:true}).click();await dialog().getByRole('region',{name:'Existing Report',exact:true}).waitFor({state:'detached'});
  await dialog().getByLabel('Affected Item',{exact:true}).selectOption(fixture.receiptItem);await dialog().getByLabel('Affected Quantity',{exact:true}).waitFor();
  assert.equal(await dialog().getByRole('option').filter({hasText:'Already Reported'}).count(),0,'Resolved reports no longer mark the item as open');
  assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
  console.log('PASS: source-scoped reports, latest updates, no draft on view, preserved unsent notes, simultaneous-report recovery, receipt/request isolation, lookup failure/retry, read-only kitchen, EN/MS 320/390/768/1440 screenshots.');console.log(out);
}catch(e){await page.screenshot({path:out+'/failure.png'});console.error((await page.locator('body').innerText()).slice(-6000));throw e;}finally{await browser.close();}
