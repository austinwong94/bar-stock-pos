import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
const url=process.env.TEST_URL??'http://127.0.0.1:5177';
const output=resolve('.qa/screenshots/kitchen-tracking');await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});
const errors=[],cloud=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/supabase\.(co|in)/.test(r.url()))cloud.push(r.url());});
async function fits(label){await page.waitForTimeout(250);const result=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.right>innerWidth+1;}).map(e=>({tag:e.tagName,cls:e.className,text:e.textContent?.slice(0,90),right:e.getBoundingClientRect().right,parent:e.parentElement?.className,parentRight:e.parentElement?.getBoundingClientRect().right})).slice(-12)}));assert(result.scroll<=result.width+1,label+' '+JSON.stringify(result));}
try{
  await page.goto(url+'/#/kitchen');await page.getByRole('button',{name:/Sample Data/}).waitFor();
  await page.getByRole('button',{name:'Austin (Owner)',exact:true}).click();await page.locator('main').waitFor();
  await page.evaluate(async()=>{
    const {db,persistDemoDb}=await import('/src/lib/demoBackend.ts');const {todayIso}=await import('/src/lib/opsData.ts');
    const request=crypto.randomUUID(),item=crypto.randomUUID();
    db.purchase_requests.push({id:request,request_no:'PR-SAMPLE-PARTIAL',needed_for_date:todayIso(),pax_count:100,purpose:'Guest Meals',notes:'Sample partial delivery for UI verification.',requested_by:'u-owner',status:'completed',created_at:new Date().toISOString(),updated_at:new Date().toISOString()});
    db.purchase_request_items.push({id:item,request_id:request,item_name:'Laici Tin',unit:'tin',quantity:3,purchase_status:'bought',purchased_quantity:2,actual_cost:20,supplier:'Sample Supplier',sort_order:1,updated_at:new Date().toISOString()});
    db.purchase_receipts??=[];db.purchase_receipts.push({id:crypto.randomUUID(),purchase_item_id:item,purchase_quantity:1,received_at:new Date().toISOString(),received_by:'u-owner'});persistDemoDb();
  });
  await page.goto(url+'/#/kitchen/purchases?view=open');await page.getByText('PR-SAMPLE-PARTIAL',{exact:true}).waitFor();
  const order=page.locator('.shopping-request').filter({has:page.getByText('PR-SAMPLE-PARTIAL',{exact:true})});
  assert.match(await order.innerText(),/1 tin/);assert.doesNotMatch(await order.innerText(),/Not Arrived|Check Arrival/);
  await page.getByLabel('Search Buying List').fill('PR-SAMPLE-PARTIAL');await page.waitForTimeout(350);
  for(const width of [390,768,1440]){await page.setViewportSize({width,height:900});await fits('To Buy '+width);await page.screenshot({path:output+`/to-buy-${width}.png`,fullPage:true});}
  await order.getByRole('button',{name:'Record Purchase',exact:true}).click();
  assert.equal(await page.getByRole('dialog').getByRole('button',{name:/Fill Shown Quantities/}).count(),0);
  assert.match(await page.getByRole('dialog').innerText(),/Still To Buy 1 tin/);
  await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('region',{name:'Unfinished Purchases',exact:true}).getByText('PR-SAMPLE-PARTIAL',{exact:true}).waitFor();
  await page.goto(url+'/#/kitchen/stock?view=arrivals');await page.getByRole('heading',{name:'Items Arrived',exact:true}).waitFor();
  const delivery=page.locator('li').filter({has:page.getByText('PR-SAMPLE-PARTIAL',{exact:true})}).first();
  await delivery.getByRole('button',{name:'Check Arrival',exact:true}).click();
  const dlg=page.getByRole('dialog');await dlg.getByLabel('Delivered: Laici Tin (tin)',{exact:true}).waitFor();
  assert.equal(await dlg.getByLabel('Pack Size: Laici Tin (unit/tin)',{exact:true}).count(),0,'Verified unit needs no repeated entry.');
  await dlg.getByLabel('Delivered: Laici Tin (tin)',{exact:true}).fill('0.5');
  for(const width of [390,768,1440]){await page.setViewportSize({width,height:900});await fits('Arrival form '+width);await page.screenshot({path:output+`/arrival-${width}.png`});}
  await dlg.getByRole('button',{name:/Review \(1\)/}).click();await dlg.getByText('Draft Saved in Local Preview',{exact:true}).waitFor();
  assert(await dlg.getByRole('button',{name:'Confirm Delivery',exact:true}).isDisabled());
  await dlg.getByRole('checkbox').check();await dlg.getByRole('button',{name:'Confirm Delivery',exact:true}).click();
  await dlg.getByText('Saved in Local Preview',{exact:true}).waitFor();
  await dlg.getByRole('button',{name:'Done',exact:true}).click();assert.match(await delivery.innerText(),/0.5 tin/);
  await page.goto(url+'/#/kitchen/purchases?view=receipts');await page.getByRole('button',{name:/99 Speedmart/}).first().click();
  const receipt=page.getByRole('dialog');await receipt.getByText('Payment Not Checked',{exact:true}).waitFor();
  await receipt.getByRole('button',{name:'Record Payment',exact:true}).click();await receipt.getByLabel('Amount Paid (RM)',{exact:true}).fill('20');await receipt.getByRole('button',{name:'Confirm Payment',exact:true}).click();await receipt.getByText('Part-paid',{exact:true}).waitFor();
  for(const width of [390,768,1440]){await page.setViewportSize({width,height:900});await fits('Payment '+width);await page.screenshot({path:output+`/payment-${width}.png`});}
  await receipt.getByRole('button',{name:'Close',exact:true}).click();await page.reload();await page.getByRole('button',{name:/99 Speedmart/}).first().click();await page.getByRole('dialog').getByText('Part-paid',{exact:true}).waitFor();
  await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  for(const width of [390,768,1440]){
    await page.setViewportSize({width,height:900});
    for(const route of ['/kitchen','/kitchen/stock?view=usage','/kitchen/stock?view=water','/kitchen/stock?view=arrivals','/kitchen/stock?view=count','/kitchen/stock?view=out','/kitchen/purchases?view=receipts','/kitchen/purchases?view=costs','/bar','/pos']){
      await page.goto(url+'/#'+route);await page.locator('main').waitFor();await page.waitForTimeout(250);await fits(route+' '+width);
      assert.equal(await page.getByLabel('Access code',{exact:true}).count(),0);
      if(route.includes('water')){await page.getByRole('button',{name:'230 ml',exact:true}).click();assert(await page.getByRole('heading',{name:'Mineral Water 230 ml',exact:true}).isVisible());await page.screenshot({path:output+`/water-${width}.png`,fullPage:true});}
    }
  }
  await page.evaluate(async()=>{
    const {db,persistDemoDb,demoSignIn}=await import('/src/lib/demoBackend.ts');
    db.access_role_permissions=db.access_role_permissions.filter(r=>r.role_code!=='kitchen_staff');
    db.access_role_permissions.push({role_code:'kitchen_staff',permission_code:'kitchen.stock.count'});
    persistDemoDb();demoSignIn('u-cook');
  });
  await page.goto(url+'/#/kitchen/stock');await page.getByRole('button',{name:'Stock Check',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Stock Check',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await page.getByRole('button',{name:'Record Usage',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Items Arrived',exact:true}).count(),0);
  await page.getByRole('button',{name:'History',exact:true}).click();await page.waitForTimeout(350);
  assert(!/access denied|Kitchen access required|could not load/i.test(await page.locator('main').innerText()));
  assert.deepEqual(errors,[]);assert.deepEqual(cloud,[]);console.log('PASS: partial requests, linked half-pack receipt, mandatory saved draft and confirmation, payment persistence, size switch, independent checker, 30 responsive route checks, no browser errors or live Supabase requests.');console.log(output);
}catch(e){await page.screenshot({path:output+'/failure.png',fullPage:true});console.error(await page.locator('body').innerText());throw e;}finally{await browser.close();}
