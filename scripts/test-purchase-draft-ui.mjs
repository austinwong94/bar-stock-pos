import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
const url=process.env.TEST_URL??'http://127.0.0.1:5177',output=resolve('.qa/screenshots/purchase-drafts');await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
const errors=[],cloud=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/supabase\.(co|in)/.test(r.url()))cloud.push(r.url());});
const dlg=()=>page.getByRole('dialog'),qty=(name='Tomato',unit='biji')=>dlg().getByLabel(`Bought: ${name} (${unit})`,{exact:true});
async function picture(name,modal=false){for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});await page.waitForTimeout(250);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' page overflow');if(modal)assert(await dlg().evaluate(el=>el.scrollWidth<=el.clientWidth+1),name+' modal overflow');
  if(name==='restored'){
    assert((await dlg().getByLabel('Receipt Date',{exact:true}).boundingBox()).width>=160,'The full date needs readable space');
    const photos=await dlg().locator('.purchase-proof-fields img').evaluateAll(imgs=>imgs.map(img=>img.getBoundingClientRect().top));assert.equal(photos.length,2);assert(Math.abs(photos[0]-photos[1])<1,'Both photo panels align');
  }
  await page.screenshot({path:output+`/${name}-${width}.png`});}}
async function resume(){await page.getByRole('region',{name:'Unfinished Purchases',exact:true}).getByRole('button',{name:'Resume',exact:true}).click();}
async function state(){return page.evaluate(async()=>{const {db}=await import('/src/lib/demoBackend.ts');return {purchases:db.audit_logs.filter(r=>r.action==='record_purchase_batch').length,items:db.purchase_request_items.map(i=>({id:i.id,bought:i.purchased_quantity??0})),drafts:Object.keys(localStorage).filter(k=>k.startsWith('purchase-entry-draft:')).map(k=>JSON.parse(localStorage.getItem(k)))};});}
async function reviewAndConfirm(){await dlg().getByRole('button',{name:/^Review \(/}).click();await dlg().getByRole('checkbox').check();await dlg().getByRole('button',{name:'Confirm Purchase',exact:true}).click();}
// These drafts predate cloud receipt reviews. Keep testing their original recovery path.
async function seedLegacyDraft(){await page.evaluate(async()=>{const {db,currentUserIdRef}=await import('/src/lib/demoBackend.ts');const {createPurchaseDraft,purchaseDraftPrefix,purchaseDraftEvent}=await import('/src/lib/purchaseDraft.ts');const {todayIso}=await import('/src/lib/opsData.ts');const r=db.purchase_requests[0],actor=currentUserIdRef.value;const d=createPurchaseDraft({...r,purchase_request_items:db.purchase_request_items.filter(i=>i.request_id===r.id)},actor,todayIso());localStorage.setItem(purchaseDraftPrefix('preview','review',actor)+r.id,JSON.stringify(d));window.dispatchEvent(new Event(purchaseDraftEvent));});await page.reload();}
try{
  await page.goto(url+'/#/');await page.getByRole('button',{name:'Austin (Owner)',exact:true}).click();await page.locator('main').waitFor();
  await page.evaluate(async()=>{
    const {db,persistDemoDb}=await import('/src/lib/demoBackend.ts');const {todayIso}=await import('/src/lib/opsData.ts');
    const id=crypto.randomUUID();db.purchase_requests=[{id,request_no:'PR-KITCHEN-102',needed_for_date:todayIso(),purpose:'Guest Meals',status:'submitted',created_at:new Date().toISOString(),updated_at:new Date().toISOString()}];
    db.purchase_request_items=['Tomato','Rice','Prawns'].map((item_name,n)=>({id:crypto.randomUUID(),request_id:id,item_name,quantity:n===0?20:5,unit:n===0?'biji':'pack',purchase_status:'pending',purchased_quantity:0,sort_order:n,updated_at:new Date().toISOString()}));
    db.purchase_receipts=[];db.audit_logs=db.audit_logs.filter(r=>r.action!=='record_purchase_batch');persistDemoDb();
  });
  await page.goto(url+'/#/kitchen/purchases');await seedLegacyDraft();await page.getByRole('button',{name:'Resume Purchase',exact:true}).click();
  await qty().fill('20');await qty('Rice','pack').fill('5');await dlg().getByLabel('Supplier',{exact:true}).selectOption('99 Speedmart');
  await dlg().getByLabel('Receipt No. (Optional)',{exact:true}).fill('REC-900');await dlg().getByLabel('Receipt Total (MYR)',{exact:true}).fill('100.50');
  const photos=await page.evaluate(()=>['#b10e50','#14695b'].map(fill=>{const c=document.createElement('canvas');c.width=120;c.height=100;const x=c.getContext('2d');x.fillStyle=fill;x.fillRect(0,0,120,100);x.fillStyle='white';x.font='15px sans-serif';x.fillText('QA SAMPLE',10,50);return c.toDataURL('image/png').split(',')[1];}));
  for(const [i,label] of ['Receipt Photo: Upload Photo','Items Photo: Upload Photo'].entries()){await dlg().getByLabel(label,{exact:true}).setInputFiles({name:`proof-${i}.png`,mimeType:'image/png',buffer:Buffer.from(photos[i],'base64')});await dlg().locator('img').nth(i).waitFor();}
  await dlg().getByText('Draft on This Device · Not Submitted',{exact:true}).waitFor();
  await dlg().getByRole('button',{name:'Close',exact:true}).click();assert.equal((await state()).purchases,0,'Closing only saves a local draft');await picture('resume');
  await page.reload();await resume();assert.equal(await qty().inputValue(),'20');assert.equal(await dlg().getByLabel('Receipt No. (Optional)',{exact:true}).inputValue(),'REC-900');await dlg().locator('img').nth(1).waitFor();
  await picture('restored',true);
  const tab=await context.newPage();await tab.goto(url+'/#/kitchen/purchases');await tab.getByRole('region',{name:'Unfinished Purchases',exact:true}).getByRole('button',{name:'Resume',exact:true}).click();
  await tab.getByLabel('Bought: Tomato (biji)',{exact:true}).fill('19');await page.getByText('Draft changed in another tab. Close and resume it.',{exact:true}).waitFor();assert(await qty().isDisabled());await tab.close();
  await dlg().getByRole('button',{name:'Close',exact:true}).click();await resume();assert.equal(await qty().inputValue(),'19');
  // Another worker changes a requested unit and removes an item before this purchase is confirmed.
  await page.evaluate(async()=>{const {db,persistDemoDb}=await import('/src/lib/demoBackend.ts');db.purchase_request_items[0].unit='kg';db.purchase_request_items[0].updated_at='2026-10-04T13:00:00.000Z';db.purchase_request_items=db.purchase_request_items.filter(i=>i.item_name!=='Rice');persistDemoDb();});
  await reviewAndConfirm();await dlg().getByRole('button',{name:'Refresh Request & Keep Entries',exact:true}).waitFor();assert.equal((await state()).purchases,0);
  await page.evaluate(()=>{const original=Storage.prototype.setItem;window.restorePurchaseStorage=()=>{Storage.prototype.setItem=original;};Storage.prototype.setItem=function(key,value){if(key.startsWith('purchase-entry-draft:'))throw new DOMException('Full','QuotaExceededError');return original.call(this,key,value);};});
  await dlg().getByRole('button',{name:'Refresh Request & Keep Entries',exact:true}).click();await dlg().getByText('Draft could not be saved on this device. Check browser storage and retry.',{exact:true}).waitFor();
  assert.equal((await state()).drafts[0].entries[(await state()).drafts[0].request.purchase_request_items[0].id].quantity,'19');
  await page.evaluate(()=>window.restorePurchaseStorage());await dlg().getByRole('button',{name:'Retry Device Save',exact:true}).click();
  await dlg().getByRole('button',{name:'Refresh Request & Keep Entries',exact:true}).click();await qty('Tomato','kg').waitFor();
  assert.equal(await qty('Tomato','kg').inputValue(),'19');assert.equal(await qty('Rice','pack').inputValue(),'5');assert(await dlg().getByRole('button',{name:/^Review \(/}).isDisabled());
  await dlg().getByText('Item changed. Previously: Tomato (biji). Re-enter the quantity using the current unit.',{exact:true}).waitFor();
  await qty('Tomato','kg').fill('20');await dlg().locator('li').filter({has:page.getByText('Rice',{exact:true})}).getByRole('button',{name:'Remove Entry',exact:true}).click();
  assert.equal(await qty('Rice','pack').count(),0);
  await dlg().getByRole('button',{name:/^Review \(/}).click();await dlg().getByRole('checkbox').check();
  await page.evaluate(()=>{const original=Storage.prototype.setItem;window.restorePurchaseStorage=()=>{Storage.prototype.setItem=original;};Storage.prototype.setItem=function(key,value){if(key.startsWith('purchase-entry-draft:')&&JSON.parse(value).attempted)throw new DOMException('Full','QuotaExceededError');return original.call(this,key,value);};});
  await dlg().getByRole('button',{name:'Confirm Purchase',exact:true}).click();await dlg().getByText('Draft could not be saved on this device. Check browser storage and retry.',{exact:true}).waitFor();
  assert.equal((await state()).purchases,0,'Never send a purchase unless its retry ID can be retained');assert.equal((await state()).drafts[0].attempted,false);
  await page.evaluate(()=>window.restorePurchaseStorage());await dlg().getByRole('button',{name:'Retry Device Save',exact:true}).click();await dlg().getByRole('button',{name:'Back to Entry',exact:true}).click();
  // Simulate a successful cloud write with the reply lost, then a rejected retry.
  await page.evaluate(async()=>{const {supabase}=await import('/src/lib/supabase.ts');const rpc=supabase.rpc.bind(supabase);let once=true;supabase.rpc=async(name,args)=>{if(name==='record_purchase_batch_checked'&&!once)return {data:null,error:{message:'Temporary access rejection',code:'42501'}};const r=await rpc(name,args);if(name==='record_purchase_batch_checked'&&once&&!r.error){once=false;return {data:null,error:{message:'Saved, but connection dropped'}};}return r;};});
  await reviewAndConfirm();await dlg().getByText('Saved, but connection dropped',{exact:true}).waitFor();
  const uncertain=await state();assert.equal(uncertain.purchases,1);assert.equal(uncertain.drafts[0].attempted,true);const token=uncertain.drafts[0].operationId;
  assert(await dlg().getByRole('button',{name:'Edit: Tomato',exact:true}).isDisabled());assert.equal(await dlg().getByRole('button',{name:'Discard Purchase Draft',exact:true}).count(),0);
  await dlg().getByRole('button',{name:'Check Confirmation',exact:true}).click();await dlg().getByText('Temporary access rejection',{exact:true}).waitFor();assert.equal((await state()).drafts[0].operationId,token);
  await dlg().getByRole('button',{name:'Close',exact:true}).click();await page.reload();
  // The uncertain confirmation remains visible even when its item is no longer on To Buy.
  await page.getByRole('region',{name:'Unfinished Purchases',exact:true}).getByRole('button',{name:'Check Confirmation',exact:true}).waitFor();await picture('pending');
  await page.getByRole('region',{name:'Unfinished Purchases',exact:true}).getByRole('button',{name:'Check Confirmation',exact:true}).click();await picture('check-confirmation',true);
  await dlg().getByRole('button',{name:'Check Confirmation',exact:true}).click();await dlg().getByText('Awaiting delivery. Inventory is unchanged.',{exact:true}).waitFor();
  assert.equal((await state()).purchases,1,'No duplicate purchase after reloading and retrying');assert.equal((await state()).drafts.length,0);
  await dlg().getByRole('button',{name:'Done',exact:true}).click();
  await seedLegacyDraft();await page.getByRole('button',{name:'Resume Purchase',exact:true}).click();await qty('Prawns','pack').fill('2');await dlg().getByRole('button',{name:'Discard Purchase Draft',exact:true}).click();await dlg().getByRole('button',{name:'Keep Draft',exact:true}).click();assert.equal(await qty('Prawns','pack').inputValue(),'2');
  await dlg().getByRole('button',{name:'Discard Purchase Draft',exact:true}).click();await dlg().getByRole('button',{name:'Discard Draft',exact:true}).click();assert.equal((await state()).drafts.length,0);
  await seedLegacyDraft();await page.getByRole('button',{name:'Resume Purchase',exact:true}).click();await qty('Prawns','pack').fill('3');await dlg().getByRole('button',{name:'Close',exact:true}).click();
  await page.setViewportSize({width:1440,height:900});await page.getByRole('button',{name:'BM',exact:true}).click();await picture('resume-ms');
  await page.getByRole('button',{name:'EN',exact:true}).click();
  await page.evaluate(async()=>{const {demoSignIn}=await import('/src/lib/demoBackend.ts');demoSignIn('u-buyer');});await page.reload();assert.equal(await page.getByRole('region',{name:'Unfinished Purchases',exact:true}).count(),0,'A different staff account does not see this draft');
  assert.deepEqual(errors,[]);assert.deepEqual(cloud,[]);
  console.log('PASS: device autosave, photos and receipt restoration, no purchase before confirmation, cross-tab safety, stale units/deleted lines, lost-response replay with original ID, rejected-retry retention, draft cleanup/discard, account separation, EN/MS 320/390/768/1440; no live writes.');console.log(output);
}catch(e){await page.screenshot({path:output+'/failure.png'});console.error(await page.locator('body').innerText());throw e;}finally{await browser.close();}
