import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
const base=process.env.TEST_URL??'http://127.0.0.1:5177',out=resolve('.qa/screenshots/delivery-followups');await mkdir(out,{recursive:true});
const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],remote=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/supabase\.(co|in)|api.openai.com/.test(r.url()))remote.push(r.url());});
const dialog=()=>page.getByRole('dialog').last(),inbox=()=>page.getByRole('region',{name:'Delivery Issues',exact:true});
async function screenshot(label,modal=false){for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:width<768?844:1000});await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1,undefined,{timeout:3000});
  await page.waitForTimeout(200);
  if(modal){assert(await dialog().evaluate(el=>el.scrollWidth<=el.clientWidth+1));assert(await dialog().evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight+1));}
  await page.screenshot({path:out+'/'+label+'-'+width+'.png'});
}}
const state=()=>page.evaluate(async()=>{const {db}=await import('/src/lib/demoBackend.ts');return {issues:structuredClone(db.delivery_issues??[]),events:db.audit_logs.filter(a=>a.action==='delivery_issue_updated'),receipts:structuredClone(db.purchase_receipts??[]),items:structuredClone(db.purchase_request_items),calls:window.followupCalls??[]};});
async function as(id,path){await page.evaluate(id=>localStorage.setItem('lovely_paradise_demo_user',id),id);await page.goto(base+'/#'+path);await page.reload();await page.locator('main').waitFor();}
async function loseReply(){await page.evaluate(async()=>{const {supabase}=await import('/src/lib/supabase.ts');const rpc=supabase.rpc.bind(supabase);let lose=true;window.followupCalls=[];supabase.rpc=async(name,args)=>{
  if(name==='add_delivery_issue_update')window.followupCalls.push(structuredClone(args));const r=await rpc(name,args);if(name==='add_delivery_issue_update'&&!r.error&&lose){lose=false;return {data:null,error:{message:'Sample lost update reply'}};}return r;};});}
try{
  await page.goto(base);await page.getByRole('button',{name:'Austin (Owner)',exact:true}).click();await page.locator('main').waitFor();
  const fixture=await page.evaluate(async()=>{const {db,persistDemoDb}=await import('/src/lib/demoBackend.ts');const {demoDeliveryIssueHandlers}=await import('/src/lib/demoDeliveryIssues.ts');
    const now=new Date().toISOString(),request=crypto.randomUUID(),item=crypto.randomUUID(),issue=crypto.randomUUID();
    db.purchase_requests.push({id:request,request_no:'PR-SAMPLE-UPDATE',status:'completed',needed_for_date:'2026-10-05',created_at:now,updated_at:now});
    db.purchase_request_items.push({id:item,request_id:request,item_name:'BERAS',unit:'pack',quantity:10,purchased_quantity:10,purchase_status:'bought',supplier:'99 Speedmart (Sample)',sort_order:0,updated_at:now,actual_cost:100});
    demoDeliveryIssueHandlers.report_delivery_issue({p_id:issue,p_data:{item_id:item,kind:'missing',quantity:2,note:'Two packs did not arrive.',expected_updated_at:now,expected_received_quantity:0}});persistDemoDb();return {issue};
  });
  await as('u-buyer','/kitchen/purchases?view=open');await inbox().getByRole('button',{name:'Follow Up',exact:true}).click();
  await dialog().getByRole('textbox',{name:'Follow-up / Outcome',exact:true}).waitFor();assert(await dialog().getByRole('button',{name:'Save Update',exact:true}).isDisabled());
  await dialog().getByRole('textbox',{name:'Follow-up / Outcome',exact:true}).fill('Sample: supplier will send the missing two packs tomorrow. Still waiting.');
  await screenshot('buyer-entry',true);await dialog().getByRole('button',{name:'Close',exact:true}).click();await page.reload();
  await inbox().getByRole('button',{name:'Resume Update',exact:true}).click();assert((await dialog().getByRole('textbox',{name:'Follow-up / Outcome',exact:true}).inputValue()).includes('Still waiting'));
  const baseline=await state();await loseReply();await dialog().getByRole('button',{name:'Save Update',exact:true}).click();await dialog().getByRole('button',{name:'Retry Update',exact:true}).waitFor();
  assert(await dialog().getByRole('textbox',{name:'Follow-up / Outcome',exact:true}).isDisabled());await dialog().getByRole('button',{name:'Retry Update',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});
  const first=await state();assert.equal(first.issues[0].status,'open');assert.equal(first.events.length,1);assert.deepEqual(first.calls[0],first.calls[1]);assert.equal(first.events[0].after_json.created_by,'u-buyer');
  await inbox().getByText(/supplier will send/).waitFor();await inbox().scrollIntoViewIfNeeded();await screenshot('buyer-open');
  await as('u-cook','/kitchen/stock?view=arrivals');await inbox().getByText(/supplier will send/).waitFor();assert.equal(await inbox().getByRole('button',{name:'Follow Up',exact:true}).count(),0);await inbox().scrollIntoViewIfNeeded();await screenshot('kitchen-update');
  await inbox().getByRole('button',{name:'Updates (1)',exact:true}).click();assert.equal(await dialog().getByRole('textbox').count(),0);assert.equal(await dialog().getByRole('button',{name:'Save Update',exact:true}).count(),0);await dialog().getByRole('button',{name:'Done',exact:true}).click();
  await as('u-buyer','/kitchen/purchases?view=open');await inbox().getByRole('button',{name:'Follow Up',exact:true}).click();await dialog().getByRole('textbox',{name:'Follow-up / Outcome',exact:true}).fill('Sample: supplier confirmed the delivery time.');
  await loseReply();await dialog().getByRole('button',{name:'Save Update',exact:true}).click();await dialog().getByRole('button',{name:'Retry Update',exact:true}).waitFor();await dialog().getByRole('button',{name:'Close',exact:true}).click();await page.reload();
  await inbox().getByRole('button',{name:'Resume Update',exact:true}).click();await dialog().getByRole('button',{name:'Retry Update',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});assert.equal((await state()).events.length,2);
  await inbox().getByRole('button',{name:'Follow Up',exact:true}).click();await dialog().getByRole('textbox',{name:'Follow-up / Outcome',exact:true}).fill('Sample: our follow-up after checking with kitchen.');
  await page.evaluate(async({issue})=>{const {demoDeliveryIssueHandlers}=await import('/src/lib/demoDeliveryIssues.ts');const {db,persistDemoDb}=await import('/src/lib/demoBackend.ts');const row=db.delivery_issues.find(i=>i.id===issue);demoDeliveryIssueHandlers.add_delivery_issue_update({p_id:crypto.randomUUID(),p_issue_id:issue,p_version:row.version,p_note:'Sample update from another device.'});persistDemoDb();},fixture);
  await dialog().getByRole('button',{name:'Save Update',exact:true}).click();await dialog().getByRole('alert').filter({hasText:'This issue changed'}).waitFor();await dialog().getByRole('button',{name:'Save Update',exact:true}).waitFor();
  assert((await dialog().getByRole('textbox',{name:'Follow-up / Outcome',exact:true}).inputValue()).includes('our follow-up'));await dialog().getByRole('button',{name:'Save Update',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});assert.equal((await state()).events.length,4);
  await page.getByRole('button',{name:'BM',exact:true}).click();await page.getByRole('region',{name:'Masalah Penghantaran',exact:true}).getByRole('button',{name:'Susulan',exact:true}).click();await dialog().getByRole('textbox',{name:'Susulan / Keputusan',exact:true}).fill('Sample: semua barang sudah diterima dan diperiksa.');await screenshot('followup-malay',true);
  await dialog().getByRole('button',{name:'Selesaikan Masalah',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});await page.getByRole('button',{name:'EN',exact:true}).click();await inbox().getByRole('button',{name:'Closed (1)',exact:true}).click();
  await inbox().getByRole('button',{name:'Updates (4)',exact:true}).click();await dialog().getByRole('region',{name:'Update History',exact:true}).waitFor();await screenshot('history',true);assert.equal(await dialog().getByRole('textbox').count(),0);
  const final=await state();assert.equal(final.issues[0].status,'closed');assert.equal(final.events.length,4);assert.deepEqual(final.items,baseline.items);assert.deepEqual(final.receipts,baseline.receipts);assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
  console.log('PASS: separate update/resolve, buyer and read-only kitchen views, local draft resume, lost-response and reload retries, concurrent update conflict, immutable history, unchanged purchasing, EN/MS 320/390/768/1440 screenshots.');console.log(out);
}catch(e){await page.screenshot({path:out+'/failure.png'});console.error((await page.locator('body').innerText()).slice(-7000));throw e;}finally{await browser.close();}
