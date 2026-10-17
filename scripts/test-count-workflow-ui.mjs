import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
const url=process.env.TEST_URL??'http://127.0.0.1:5177';
const output=resolve('.qa/screenshots/count-workflow');await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
const errors=[],cloud=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/supabase\.(co|in)/.test(r.url()))cloud.push(r.url());});
const count=(name,unit='biji')=>page.getByLabel('Actual Count '+name+' ('+unit+')',{exact:true});
async function fits(name){await page.waitForTimeout(250);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' overflows');}
async function pictures(name){for(const width of [390,768,1440]){await page.setViewportSize({width,height:900});await fits(name);await page.screenshot({path:output+'/'+name+'-'+width+'.png'});}}
try{
  await page.goto(url+'/#/kitchen/stock?view=count');await page.getByRole('button',{name:'Austin (Owner)',exact:true}).click();await page.locator('main').waitFor();await page.goto(url+'/#/kitchen/stock?view=count');await count('Timun').waitFor();
  await page.evaluate(async()=>{
    const {loadLocalIngredientItems,adjustLocalIngredientStock}=await import('/src/lib/localStore.ts');
    for(const i of loadLocalIngredientItems().filter(i=>['timun','jagung','tomato','laici-tin'].includes(i.kitchen_key)))
      adjustLocalIngredientStock({ingredientId:i.id,movementType:'count',quantity:20,reason:'Sample opening count',enteredBy:'Sample Only'});
  });
  await page.reload();await count('Timun').fill('18');await count('Jagung').fill('20');await count('Tomato').fill('23');
  assert.equal(await count('Laici Tin','tin').getAttribute('inputmode'),'decimal');await count('Laici Tin','tin').fill('17.5');
  await page.getByLabel('Count Notes (Optional)',{exact:true}).fill('Sample weekly check');
  await page.reload();assert.equal(await count('Laici Tin','tin').inputValue(),'17.5');assert.equal(await count('Timun').inputValue(),'18');
  await page.getByText('Draft on This Device · Not Submitted',{exact:true}).waitFor();
  await page.getByRole('button',{name:/^To Count \d+$/}).click();assert.equal(await count('Timun').count(),0);
  await page.getByRole('button',{name:'Entered 4',exact:true}).click();await page.getByRole('checkbox',{name:'Show Expected',exact:true}).check();await page.evaluate(()=>scrollTo(0,0));await pictures('count');
  await page.getByRole('button',{name:'Review Count',exact:true}).click();let dlg=page.getByRole('dialog');
  assert.equal(await dlg.getByRole('button',{name:'Differences 3',exact:true}).getAttribute('aria-pressed'),'true');assert.equal(await dlg.getByText('Jagung',{exact:true}).count(),0);
  assert(await dlg.getByRole('button',{name:'Confirm Count',exact:true}).isDisabled());await pictures('review');
  await dlg.getByRole('button',{name:'All Items 4',exact:true}).click();assert(await dlg.getByText('Jagung',{exact:true}).isVisible());
  await page.goto(url+'/#/kitchen/stock?view=usage');await page.getByRole('heading',{name:'Daily Food Stock Out',exact:true}).waitFor();assert.equal(await page.getByRole('dialog').count(),0,'Pending count must not cover another kitchen tab.');
  await page.getByRole('button',{name:'Stock Check',exact:true}).click();dlg=page.getByRole('dialog');await dlg.getByRole('button',{name:'Back to Count',exact:true}).click();
  await count('Timun').waitFor();assert.equal(await count('Timun').inputValue(),'18');assert.equal(await page.getByLabel('Count Notes (Optional)',{exact:true}).inputValue(),'Sample weekly check');
  await page.evaluate(async()=>{const {supabase}=await import('/src/lib/supabase.ts');const rpc=supabase.rpc.bind(supabase);let once=true;supabase.rpc=async(name,args)=>{const r=await rpc(name,args);if(name==='record_kitchen_stock_count'&&once){once=false;return {data:null,error:{message:'Connection interrupted after saving'}};}return r;};});
  await page.getByRole('button',{name:'Review Count',exact:true}).click();dlg=page.getByRole('dialog');await dlg.getByRole('checkbox').check();await dlg.getByRole('button',{name:'Confirm Count',exact:true}).click();
  await dlg.getByText('Confirmation pending. Check this same count again before starting another.',{exact:true}).waitFor();
  assert(await dlg.getByRole('button',{name:'Back to Count',exact:true}).isDisabled());await dlg.getByRole('button',{name:'Check Confirmation',exact:true}).click();
  await page.getByText(/Count Confirmed in Preview/).waitFor();
  const confirmed=await page.evaluate(async()=>{const {loadLocalIngredientItems,loadLocalIngredientMovements}=await import('/src/lib/localStore.ts');return {drafts:Object.keys(localStorage).filter(k=>k.startsWith('kitchen-count:')),rows:loadLocalIngredientMovements().filter(m=>m.notes==='Sample weekly check'),items:loadLocalIngredientItems().filter(i=>['timun','jagung','tomato','laici-tin'].includes(i.kitchen_key))};});
  assert.equal(confirmed.drafts.length,0);assert.equal(confirmed.rows.length,4);assert.deepEqual(confirmed.rows.map(m=>m.quantity_change).sort((a,b)=>a-b),[-2.5,-2,0,3]);
  await page.getByRole('button',{name:'View Count History',exact:true}).click();await page.getByRole('button',{name:'Counts',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Counts',exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByLabel('Search Food Stock History',{exact:true}).fill('Sample weekly check');await page.waitForTimeout(400);await pictures('history');
  await page.goto(url+'/#/kitchen/stock?view=count');await count('Timun').fill('17');
  await page.evaluate(async()=>{const {loadLocalIngredientItems,adjustLocalIngredientStock}=await import('/src/lib/localStore.ts');const i=loadLocalIngredientItems().find(i=>i.kitchen_key==='timun');adjustLocalIngredientStock({ingredientId:i.id,movementType:'count',quantity:19,reason:'Changed elsewhere',enteredBy:'Sample Only'});});
  await page.reload();await page.getByText('Stock changed. Recount.',{exact:true}).waitFor();assert(await page.getByRole('button',{name:'Review Count',exact:true}).isDisabled());
  await count('Timun').fill('');await count('Timun').fill('19');assert.equal(await page.getByText('Stock changed. Recount.',{exact:true}).count(),0,'Clearing must take a new balance snapshot.');
  const tab2=await context.newPage();await tab2.goto(url+'/#/kitchen/stock?view=count');await tab2.getByLabel('Actual Count Timun (biji)',{exact:true}).fill('18');
  await page.getByText(/^This count changed in another tab\./).waitFor();assert(await count('Timun').isDisabled());await tab2.close();
  await page.getByRole('button',{name:'Reload Count',exact:true}).click();await count('Timun').waitFor();assert.equal(await count('Timun').inputValue(),'18');
  await page.getByRole('button',{name:'Discard Count Draft',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Keep Counting',exact:true}).click();assert.equal(await count('Timun').inputValue(),'18');
  await page.getByRole('button',{name:'Discard Count Draft',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Discard Draft',exact:true}).click();assert.equal(await count('Timun').inputValue(),'');
  await page.getByRole('button',{name:'BM',exact:true}).click();await page.setViewportSize({width:390,height:900});await fits('Malay count');await page.screenshot({path:output+'/count-malay-390.png'});
  assert.deepEqual(errors,[]);assert.deepEqual(cloud,[]);console.log('PASS: draft recovery, fractional keyboard, progress filters, compact review, hidden-pane safety, lost-response retry without duplicates, history link, stale counts, cleared snapshots, cross-tab conflict, explicit discard and responsive English/Malay views.');console.log(output);
}catch(e){await page.screenshot({path:output+'/failure.png',fullPage:true});console.error(await page.locator('body').innerText());throw e;}finally{await browser.close();}
