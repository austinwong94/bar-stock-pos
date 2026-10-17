import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
const base=process.env.TEST_URL??'http://127.0.0.1:5177',out=resolve('.qa/screenshots/receipt-deliveries');await mkdir(out,{recursive:true});
const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],remote=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/supabase\.(co|in)|api.openai.com/.test(r.url()))remote.push(r.url());});
const dialog=()=>page.getByRole('dialog').last();
async function screenshot(label,modal=false){for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:width<768?844:1000});
  await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1,undefined,{timeout:3000});
  if(modal){assert(await dialog().evaluate(el=>el.scrollWidth<=el.clientWidth+1));assert(await dialog().evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight+1));}
  await page.screenshot({path:out+'/'+label+'-'+width+'.png'});
}}
const state=()=>page.evaluate(async()=>{const {db}=await import('/src/lib/demoBackend.ts');const {loadLocalIngredientItems}=await import('/src/lib/localStore.ts');return {sources:structuredClone(db.receipt_delivery_sources??[]),drafts:structuredClone(db.receipt_delivery_drafts??[]),items:loadLocalIngredientItems(),receipts:db.expense_receipts.map(r=>({id:r.id,total:r.total_cost})),calls:window.deliveryCalls??[],events:db.audit_logs.filter(a=>a.entity_type==='receipt_delivery')};});
try{
  await page.goto(base);await page.getByRole('button',{name:'Austin (Owner)',exact:true}).click();await page.locator('main').waitFor();
  const fixture=await page.evaluate(async()=>{
    const {db,persistDemoDb,currentUserIdRef}=await import('/src/lib/demoBackend.ts');const {saveLocalIngredientItem}=await import('/src/lib/localStore.ts');
    const {demoSupplyHandlers}=await import('/src/lib/demoSupplyWorkflow.ts');const {malaysiaDateInputValue}=await import('/src/lib/format.ts');
    const rows=[['BERAS (Sample)','pack',7,'Rice & Dry Goods'],['TELUR (Sample)','biji',110,'Meat & Eggs'],['TIMUN (Sample)','biji',20,'Vegetables'],['MINYAK MASAK (Sample)','gelen',3,'Seasoning & Oil']];
    const ids=rows.map(([name,unit])=>saveLocalIngredientItem({name,category:'Food',base_unit:'unit',kitchen_key:crypto.randomUUID(),kitchen_label:name,kitchen_unit:unit,kitchen_factor:1,kitchen_group:'Bahan Kering'}).id);
    const receipt=demoSupplyHandlers.save_expense_receipt({p_operation_id:crypto.randomUUID(),p_receipt:{supplier:'99 Speedmart (Sample)',receipt_no:'SAMPLE-ARRIVAL-001',purpose:'guest_meals',purchase_date:malaysiaDateInputValue(new Date()),total_cost:200,
      receipt_path:currentUserIdRef.value+'/sample-receipt.jpg',items_path:currentUserIdRef.value+'/sample-goods.jpg',receipt_hash:crypto.randomUUID(),items_hash:crypto.randomUUID(),notes:'Sample QA only',lines:rows.map(([name,unit,quantity,category])=>({name,unit,quantity,category,amount:50}))}});
    persistDemoDb();return {receipt:receipt.id,ids};
  });
  await page.goto(base+'/#/kitchen/stock?view=arrivals');await page.reload();
  const row=()=>page.locator(`[data-receipt-delivery="${fixture.receipt}"]`);
  await row().getByRole('button',{name:'Check Arrival',exact:true}).waitFor();const initial=await state();
  assert.equal(initial.sources.length,1);await screenshot('arrival-list');
  await row().getByRole('button',{name:'Check Arrival',exact:true}).click();assert.equal(await dialog().getByRole('button',{name:/Fill Remaining|Fill Shown/}).count(),0);for(const [name,unit,qty] of [['BERAS (Sample)','pack',7],['TELUR (Sample)','biji',110],['TIMUN (Sample)','biji',20],['MINYAK MASAK (Sample)','gelen',3]]){const input=dialog().getByLabel(`Delivered: ${name} (${unit})`,{exact:true});assert.equal(await input.inputValue(),'');await input.fill(String(qty));}
  const rice=()=>dialog().getByRole('textbox',{name:'Delivered: BERAS (Sample) (pack)',exact:true});
  assert.equal(await rice().inputValue(),'7');await rice().fill('5');await screenshot('checked-quantities',true);
  await page.evaluate(async()=>{const {supabase}=await import('/src/lib/supabase.ts');const rpc=supabase.rpc.bind(supabase);window.deliveryCalls=[];let lose=true;supabase.rpc=async(name,args)=>{if(name==='save_receipt_delivery_draft')window.deliveryCalls.push(structuredClone(args));const r=await rpc(name,args);if(name==='save_receipt_delivery_draft'&&!r.error&&lose){lose=false;return {data:null,error:{message:'Sample lost draft reply'}};}return r;};});
  await dialog().getByRole('button',{name:'Review (4)',exact:true}).click();await dialog().getByRole('button',{name:'Retry Draft Save',exact:true}).click();
  await dialog().getByRole('heading',{name:'Review Delivery',exact:true}).waitFor();const saved=await state();assert.deepEqual(saved.calls[0],saved.calls[1]);assert.equal(saved.drafts.length,1);assert.deepEqual(saved.items,initial.items,'Draft cannot change stock');
  assert(await dialog().getByRole('button',{name:'Confirm Delivery',exact:true}).isDisabled());await screenshot('review',true);
  await dialog().getByRole('button',{name:'Close',exact:true}).click();await page.reload();await page.getByRole('button',{name:'BM',exact:true}).click();await row().getByRole('button',{name:'Sambung',exact:true}).click();await dialog().getByRole('heading',{name:'Semak Penghantaran',exact:true}).waitFor();
  await screenshot('review-malay',true);await dialog().getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'EN',exact:true}).click();await row().getByRole('button',{name:'Resume',exact:true}).click();await dialog().getByRole('heading',{name:'Review Delivery',exact:true}).waitFor();
  await dialog().getByRole('checkbox').check();
  await page.evaluate(async()=>{const {supabase}=await import('/src/lib/supabase.ts');const rpc=supabase.rpc.bind(supabase);let lose=true;supabase.rpc=async(name,args)=>{const r=await rpc(name,args);if(name==='confirm_receipt_delivery_draft'&&!r.error&&lose){lose=false;return {data:null,error:{message:'Sample lost confirmation reply'}};}return r;};});
  await dialog().getByRole('button',{name:'Confirm Delivery',exact:true}).click();await dialog().getByRole('button',{name:'Retry Confirmation',exact:true}).click();
  await dialog().getByRole('heading',{name:'Delivery Recorded',exact:true}).waitFor();await screenshot('recorded',true);
  const confirmed=await state();assert.equal(confirmed.drafts[0].status,'confirmed');assert.deepEqual(confirmed.receipts,initial.receipts);
  for(const [n,qty] of [5,110,20,3].entries()){assert.equal(confirmed.items.find(i=>i.id===fixture.ids[n]).ingredient_balances.quantity_on_hand-initial.items.find(i=>i.id===fixture.ids[n]).ingredient_balances.quantity_on_hand,qty);}
  await dialog().getByRole('button',{name:'Done',exact:true}).click();await row().getByText('2 pack',{exact:true}).waitFor();assert.equal(await row().locator('.receipt-delivery-items li').count(),1);await screenshot('still-to-receive');
  await row().getByRole('button',{name:'Check Arrival',exact:true}).click();assert.equal(await rice().inputValue(),'');await rice().fill('2');assert.equal(await rice().inputValue(),'2');await dialog().getByRole('button',{name:'Review (1)',exact:true}).click();await dialog().getByRole('heading',{name:'Review Delivery',exact:true}).waitFor();
  await dialog().getByRole('button',{name:'Cancel Draft',exact:true}).click();await dialog().getByRole('textbox',{name:'Reason',exact:true}).fill('Sample: delivery not here yet.');await dialog().getByRole('button',{name:'Cancel Draft',exact:true}).click();await dialog().getByRole('heading',{name:'Draft Cancelled',exact:true}).waitFor();
  assert.equal((await state()).events.filter(e=>e.action==='receipt_delivery_cancelled').length,1);assert.deepEqual((await state()).items,confirmed.items);
  assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
  console.log('PASS: confirmed purchase auto-handoff, phone/tablet/desktop EN/MS, manually entered quantities, shortages retained, durable review/reload, exact lost-response retries, cancellation audit, stock and costs verified.');console.log(out);
}catch(e){await page.screenshot({path:out+'/failure.png'});console.error((await page.locator('body').innerText()).slice(-6000));throw e;}finally{await browser.close();}
