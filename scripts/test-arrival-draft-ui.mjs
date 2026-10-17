import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
const url=process.env.TEST_URL??'http://127.0.0.1:5177',output=resolve('.qa/screenshots/arrival-drafts');await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
const errors=[],cloud=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/supabase\.(co|in)/.test(r.url()))cloud.push(r.url());});
const qty=(name,unit='biji')=>page.getByLabel(`${name} Received (${unit})`,{exact:true}),date=()=>page.getByLabel('Delivery Date',{exact:true}),dlg=()=>page.getByRole('dialog');
async function stock(){return page.evaluate(async()=>{const {loadLocalIngredientItems}=await import('/src/lib/localStore.ts');return Object.fromEntries(loadLocalIngredientItems().filter(i=>['timun','jagung','laici-tin'].includes(i.kitchen_key)).map(i=>[i.kitchen_key,i.ingredient_balances.quantity_on_hand]));});}
async function pictures(name,dialog=false){for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:width===320?740:900});await page.evaluate(()=>document.activeElement?.blur());await page.waitForTimeout(250);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' overflow');if(dialog)assert(await dlg().evaluate(e=>e.scrollWidth<=e.clientWidth+1));await page.screenshot({path:output+'/'+name+'-'+width+'.png',fullPage:!dialog});}}
async function openArrival(){await page.goto(url+'/#/kitchen/stock?view=arrivals');await page.getByRole('button',{name:'Unlisted Delivery',exact:true}).click();await qty('Timun').waitFor();}
try{
  await page.goto(url+'/#/kitchen');await page.getByRole('button',{name:'Austin (Owner)',exact:true}).click();await page.locator('main').waitFor();
  await page.evaluate(async()=>{const {db,persistDemoDb}=await import('/src/lib/demoBackend.ts');const {todayIso}=await import('/src/lib/opsData.ts');const id=crypto.randomUUID();db.purchase_requests.push({id,request_no:'PR-SAMPLE-DELIVERY',needed_for_date:todayIso(),pax_count:20,status:'completed',requested_by:'u-owner',created_at:new Date().toISOString(),updated_at:new Date().toISOString()});db.purchase_request_items.push({id:crypto.randomUUID(),request_id:id,item_name:'Laici Tin',quantity:5,purchased_quantity:5,purchase_status:'bought',supplier:'AEON',unit:'tin',sort_order:1,updated_at:new Date().toISOString()});persistDemoDb();});
  await page.goto(url+'/#/kitchen/stock?view=arrivals');await page.getByText('PR-SAMPLE-DELIVERY',{exact:true}).waitFor();await page.getByLabel('Find Expected Delivery',{exact:true}).fill('AEON');await page.waitForTimeout(500);await page.getByText('PR-SAMPLE-DELIVERY',{exact:true}).waitFor();await pictures('expected');
  await page.getByLabel('Find Expected Delivery',{exact:true}).fill('no-such-supplier');await page.getByText('No matching deliveries.',{exact:true}).waitFor();await page.getByLabel('Find Expected Delivery',{exact:true}).fill('Laici');await page.getByText('PR-SAMPLE-DELIVERY',{exact:true}).waitFor();
  await openArrival();await page.getByLabel('Supplier',{exact:true}).selectOption('99 Speedmart');await page.getByLabel('Receipt / Delivery No. (Optional)',{exact:true}).fill('REC-900');await qty('Timun').fill('20');await qty('Timun').press('Enter');assert(await qty('Jagung').evaluate(e=>e===document.activeElement));await qty('Jagung').fill('15');await qty('Laici Tin','tin').fill('2.5');
  const before=await stock(),today=await date().inputValue(),prior=new Date(today+'T12:00:00');prior.setDate(prior.getDate()-1);const previous=prior.toISOString().slice(0,10);await date().fill(previous);await page.waitForTimeout(200);
  await page.getByRole('button',{name:'Expected Deliveries',exact:true}).click();await page.getByRole('button',{name:'Resume Delivery',exact:true}).waitFor();assert.equal(await page.getByRole('dialog').count(),0);await pictures('resume');
  await page.reload();await page.getByRole('button',{name:'Resume Delivery',exact:true}).click();assert.equal(await date().inputValue(),previous);assert.equal(await qty('Laici Tin','tin').inputValue(),'2.5');assert.equal(await page.getByLabel('Supplier',{exact:true}).inputValue(),'99 Speedmart');
  await page.getByRole('button',{name:'Entered (3)',exact:true}).click();await qty('Timun').fill('');assert(await qty('Timun').isVisible());await qty('Timun').fill('21');await pictures('entered');
  await page.getByRole('button',{name:'Review Delivery',exact:true}).click();assert(await dlg().getByRole('button',{name:'Confirm Received',exact:true}).isDisabled());await pictures('confirm',true);assert.deepEqual(await stock(),before);
  await page.goto(url+'/#/kitchen/stock?view=count');await page.getByLabel('Actual Count Timun (biji)',{exact:true}).waitFor();assert.equal(await page.getByRole('dialog').count(),0,'Pending delivery must not cover Stock Check.');await page.goto(url+'/#/kitchen/stock?view=arrivals');assert.equal(await page.getByRole('dialog').count(),0,'The queue must remain available.');await page.getByRole('button',{name:'Resume Delivery',exact:true}).click();await dlg().getByRole('button',{name:'Back',exact:true}).click();assert.equal(await qty('Timun').inputValue(),'21');
  const tab=await context.newPage();await tab.goto(url+'/#/kitchen/stock?view=arrivals');await tab.getByRole('button',{name:'Resume Delivery',exact:true}).click();await tab.getByLabel('Timun Received (biji)',{exact:true}).fill('22');await page.getByText(/^This delivery changed in another tab\./).waitFor();assert(await qty('Timun').isDisabled());await tab.close();await page.getByRole('button',{name:'Reload Draft',exact:true}).click();await page.waitForTimeout(200);assert.equal(await qty('Timun').inputValue(),'22');
  await page.evaluate(async()=>{const {supabase}=await import('/src/lib/supabase.ts');const rpc=supabase.rpc.bind(supabase);let once=true;supabase.rpc=async(name,args)=>{const r=await rpc(name,args);if(name==='record_kitchen_arrival'&&once&&!r.error){once=false;return {data:null,error:{message:'Lost response after arrival saved'}};}return r;};});
  await page.getByRole('button',{name:'Review Delivery',exact:true}).click();await dlg().getByRole('checkbox').check();await dlg().getByRole('button',{name:'Confirm Received',exact:true}).click();await dlg().getByRole('alert').getByText('Lost response after arrival saved',{exact:true}).waitFor();assert(await dlg().getByRole('button',{name:'Back',exact:true}).isDisabled());const changed=await stock();assert.equal(changed.timun,before.timun+22);assert.equal(changed['laici-tin'],before['laici-tin']+2.5);
  await dlg().getByText('Confirmation Not Verified · Stock May Already Be Added',{exact:true}).waitFor();
  assert.equal(await dlg().getByText('Not Confirmed · No Stock Added',{exact:true}).count(),0);
  await page.reload();await page.getByText('Confirmation Not Verified',{exact:true}).waitFor();await page.getByRole('button',{name:'Resume Delivery',exact:true}).click();await dlg().getByRole('checkbox').check();await dlg().getByRole('button',{name:'Check Confirmation',exact:true}).click();await page.getByText(/^Delivery Confirmed/).waitFor();assert.deepEqual(await stock(),changed,'Retry cannot add stock twice.');await page.getByText(/Recorded for This Date/).click();assert.match(await page.locator('main').innerText(),/REC-900/);
  await qty('Timun').fill('1');await page.evaluate(async()=>{const {loadLocalIngredientItems,saveLocalIngredientItem}=await import('/src/lib/localStore.ts');const i=loadLocalIngredientItems().find(i=>i.kitchen_key==='timun');saveLocalIngredientItem({...i,name:i.name+' Updated'});});await page.reload();await page.getByRole('button',{name:'Resume Delivery',exact:true}).click();await page.getByRole('button',{name:'Review Delivery',exact:true}).click();await page.getByText(/^Item setup changed/).waitFor();await qty('Timun').fill('');await qty('Timun').fill('1');await page.getByRole('button',{name:'Review Delivery',exact:true}).click();await dlg().getByRole('button',{name:'Back',exact:true}).click();
  await page.getByRole('button',{name:'Discard Delivery Draft',exact:true}).click();await dlg().getByRole('button',{name:'Keep Draft',exact:true}).click();assert.equal(await qty('Timun').inputValue(),'1');await page.getByRole('button',{name:'Discard Delivery Draft',exact:true}).click();await dlg().getByRole('button',{name:'Discard Draft',exact:true}).click();assert.equal(await qty('Timun').inputValue(),'');assert.deepEqual(await stock(),changed);
  await page.getByLabel('Supplier',{exact:true}).selectOption('AEON');await qty('Timun').fill('12');await qty('Laici Tin','tin').fill('1.5');await page.setViewportSize({width:1440,height:900});await page.getByRole('button',{name:'BM',exact:true}).click();await page.getByRole('button',{name:'Diisi (2)',exact:true}).click();await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(250);await page.screenshot({path:output+'/arrivals-malay-390.png',fullPage:true});
  await page.setViewportSize({width:1440,height:900});await page.getByRole('button',{name:'EN',exact:true}).click();
  await page.evaluate(async()=>{
    const {loadLocalIngredientItems,saveLocalIngredientItem}=await import('/src/lib/localStore.ts');
    const {kitchenFactor,kitchenName,kitchenUnit}=await import('/src/lib/kitchenCatalogue.ts');
    const eligible=()=>loadLocalIngredientItems().filter(i=>i.active&&['Food','Seafood','Condiment'].includes(i.category)&&kitchenFactor(i)>0);
    while(eligible().length<50)saveLocalIngredientItem({name:'Sample Delivery Item '+eligible().length,category:'Food',base_unit:'unit',active:true});
    const key=Object.keys(localStorage).find(k=>k.startsWith('kitchen-arrival:')&&k.endsWith(':draft'));
    const draft=JSON.parse(localStorage.getItem(key));
    draft.entries=Object.fromEntries(eligible().slice(0,50).map(i=>[i.id,{value:'1',name:kitchenName(i),unit:kitchenUnit(i),baseUnit:i.base_unit,factor:kitchenFactor(i),version:i.updated_at}]));
    localStorage.setItem(key,JSON.stringify(draft));
  });
  await page.reload();await page.getByRole('button',{name:'Resume Delivery',exact:true}).click();
  await page.getByRole('button',{name:'Entered (50)',exact:true}).click();
  assert.equal(await page.locator('.arrival-entry .kitchen-simple-row input').count(),50);
  await page.getByRole('button',{name:'Review Delivery',exact:true}).click();
  assert.equal(await dlg().locator('li').count(),50);
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:width===320?740:900});await page.waitForTimeout(200);
    const button=dlg().getByRole('button',{name:'Confirm Received',exact:true});
    assert(await button.evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),'Confirmation must stay on screen.');
    await dlg().locator('li').last().scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    assert(await button.evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),'Confirmation must remain on screen after scrolling.');
    assert(await dlg().locator('li').last().isVisible());
    assert(await dlg().evaluate(e=>e.scrollWidth<=e.clientWidth+1),'Long confirmation cannot overflow.');
    await page.screenshot({path:output+'/fifty-items-'+width+'.png'});
  }
  assert.deepEqual(errors,[]);assert.deepEqual(cloud,[]);console.log('PASS: server-side delivery search, saved supplier/date/reference/quantities, keyboard Next, filter editing, navigation/reload recovery, hidden-modal safety, cross-tab conflict, lost-response replay, unit snapshot protection, discard, 50-item review, English/Malay and 320-1440px layouts.');console.log(output);
}catch(e){await page.screenshot({path:output+'/failure.png',fullPage:true});console.error(await page.locator('body').innerText());throw e;}finally{await browser.close();}
