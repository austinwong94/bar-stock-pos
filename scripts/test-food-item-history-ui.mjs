import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
const url=process.env.TEST_URL??'http://127.0.0.1:5177',out=resolve('.qa/screenshots/item-history');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:390,height:900}});
const errors=[],cloud=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/supabase\.(co|in)/.test(r.url()))cloud.push(r.url());});
async function pictures(name){for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});await page.waitForTimeout(250);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' page overflows');const dlg=page.getByRole('dialog');if(await dlg.count())assert(await dlg.evaluate(e=>e.scrollWidth<=e.clientWidth+1),name+' dialog overflows');await page.screenshot({path:out+'/'+name+'-'+width+'.png'});}}
try{
  await page.goto(url+'/#/kitchen/stock?view=count');await page.getByRole('button',{name:'Austin (Owner)',exact:true}).click();await page.locator('main').waitFor();
  const fixture=await page.evaluate(async()=>{
    const {loadLocalIngredientItems,adjustLocalIngredientStock}=await import('/src/lib/localStore.ts');
    const rice=loadLocalIngredientItems(true).find(i=>i.kitchen_key==='laici-tin');const empty=loadLocalIngredientItems(true).find(i=>i.kitchen_key==='carrot');const now=Date.now(),stamp=n=>new Date(now+n*1000).toISOString();
    const base={ingredient_id:rice.id,unit_input:'unit',input_quantity:null,pack_size_at_time:null,reference_type:null,reference_id:null,reason:null,notes:null,created_by:'u-owner',ingredient_items:{name:rice.name,base_unit:'unit'},display_unit:'tin',display_factor:1};
    const old=Array.from({length:75},(_,n)=>({...base,id:crypto.randomUUID(),movement_type:'stock_in',quantity_before:n,quantity_change:1,quantity_after:n+1,entered_by:'Happy',notes:'Earlier delivery '+(n+1),created_at:stamp(-500+n)}));
    const before={...base,id:crypto.randomUUID(),movement_type:'count',quantity_before:75,quantity_change:0,quantity_after:75,entered_by:'Chloe',notes:'Opening check',created_at:stamp(-200)};
    const arrival={...base,id:crypto.randomUUID(),movement_type:'stock_in',quantity_before:75,quantity_change:25,quantity_after:100,entered_by:'Happy',notes:'Delivery checked against receipt',created_at:stamp(-150)};
    const used={...base,id:crypto.randomUUID(),movement_type:'kitchen_production',quantity_before:100,quantity_change:-14,quantity_after:86,entered_by:'Kitchen PIC',reason:'Daily Kitchen Usage',notes:'Guest meals 60; staff meals 10',created_at:stamp(-120)};
    const waste={...base,id:crypto.randomUUID(),movement_type:'waste',quantity_before:86,quantity_change:-1,quantity_after:85,entered_by:'Kitchen PIC',reason:'Spoilage',notes:'Damaged tin',created_at:stamp(-90)};
    const counted={...base,id:crypto.randomUUID(),movement_type:'count',quantity_before:85,quantity_change:-2.5,quantity_after:82.5,entered_by:'Chloe',notes:'Weekly shelf check',created_at:stamp(-60)};
    const later={...base,id:crypto.randomUUID(),movement_type:'stock_in',quantity_before:82.5,quantity_change:10,quantity_after:92.5,entered_by:'Happy',notes:'Delivery after the count',created_at:stamp(-30)};
    adjustLocalIngredientStock({ingredientId:rice.id,movementType:'count',quantity:92.5,reason:'Sample balance',enteredBy:'Sample Only'});
    localStorage.setItem('lovely_paradise_ingredient_movements',JSON.stringify([later,counted,waste,used,arrival,before,...old.reverse()]));
    return {itemId:rice.id,emptyId:empty.id,anchorId:counted.id,rows:81};
  });
  await page.goto(url+'/#/kitchen/stock?view=history&type=count');await page.getByRole('button',{name:'Item History: Laici Tin',exact:true}).first().waitFor();
  await page.getByRole('list',{name:'Stock Movements',exact:true}).getByText('Short',{exact:true}).waitFor();await pictures('counts');
  const beforeUrl=page.url();await page.getByRole('button',{name:'Item History: Laici Tin',exact:true}).first().click();let dlg=page.getByRole('dialog');
  await dlg.getByText('82.5 tin',{exact:true}).waitFor();assert.match(await dlg.innerText(),/Expected\s+85 tin/);assert.match(await dlg.innerText(),/Short\s+2.5 tin/);
  assert.equal(await dlg.getByText('Delivery after the count',{exact:true}).count(),0);await dlg.getByText('Guest meals 60; staff meals 10',{exact:true}).waitFor();await dlg.getByText('Damaged tin',{exact:true}).waitFor();
  await pictures('count-trace');assert.equal(await dlg.getByLabel('Item Movements',{exact:true}).locator(':scope > li').count(),50);
  await dlg.getByRole('button',{name:'Load Older Records',exact:true}).click();await dlg.getByText('80 records shown · End of History',{exact:true}).waitFor();assert.equal(await dlg.getByLabel('Item Movements',{exact:true}).locator(':scope > li').count(),80);
  await dlg.getByRole('button',{name:'Close',exact:true}).click();assert.equal(page.url(),beforeUrl);assert.equal(await page.getByRole('button',{name:'Counts',exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:'Balances',exact:true}).click();await page.getByLabel('Find Food Stock',{exact:true}).fill('laici');await pictures('balances');
  await page.getByRole('button',{name:'Item History: Laici Tin',exact:true}).click();dlg=page.getByRole('dialog');await dlg.getByText('Delivery after the count',{exact:true}).waitFor();assert.match(await dlg.innerText(),/Latest Recorded Balance: 92.5 tin/);
  await dlg.getByRole('button',{name:'Close',exact:true}).click();assert.equal(await page.getByLabel('Find Food Stock',{exact:true}).inputValue(),'laici');
  await page.getByLabel('Find Food Stock',{exact:true}).fill('carrot');await page.getByRole('button',{name:'Item History: Carrot',exact:true}).click();await page.getByRole('dialog').getByText('No Recorded Movements',{exact:true}).waitFor();await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  await page.evaluate(async()=>{const {supabase}=await import('/src/lib/supabase.ts');const rpc=supabase.rpc.bind(supabase);window.failHistory=true;supabase.rpc=async(name,args)=>name==='read_food_item_history'&&window.failHistory?{data:null,error:{message:'Temporary history outage'}}:rpc(name,args);});
  await page.getByLabel('Find Food Stock',{exact:true}).fill('laici');await page.getByRole('button',{name:'Item History: Laici Tin',exact:true}).click();dlg=page.getByRole('dialog');await dlg.getByRole('alert').waitFor();await page.evaluate(()=>window.failHistory=false);await dlg.getByRole('button',{name:'Retry',exact:true}).click();await dlg.getByText('Delivery after the count',{exact:true}).waitFor();await dlg.getByRole('button',{name:'Close',exact:true}).click();
  await page.evaluate(async()=>{const {db,persistDemoDb,demoSignIn}=await import('/src/lib/demoBackend.ts');db.access_role_permissions=db.access_role_permissions.filter(r=>r.role_code!=='kitchen_staff');db.access_role_permissions.push({role_code:'kitchen_staff',permission_code:'kitchen.stock.count'});persistDemoDb();demoSignIn('u-cook');});
  await page.goto(url+'/#/kitchen/stock?view=history&type=count');await page.getByRole('button',{name:'Item History: Laici Tin',exact:true}).first().click();dlg=page.getByRole('dialog');await dlg.getByText('82.5 tin',{exact:true}).waitFor();assert(!/RM|cost|price/i.test(await dlg.innerText()));await dlg.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'BM',exact:true}).click();await page.getByRole('button',{name:'Sejarah Item: Laici Tin',exact:true}).first().click();dlg=page.getByRole('dialog');await dlg.getByText('Dijangka',{exact:true}).waitFor();await page.setViewportSize({width:390,height:900});await page.waitForTimeout(250);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:out+'/count-trace-malay-390.png'});
  await dlg.getByRole('button',{name:'Close',exact:true}).click();
  const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('lovely_paradise_ingredient_movements')));assert.equal(after.length,fixture.rows,'Viewing history never changes inventory.');
  assert.deepEqual(errors,[]);assert.deepEqual(cloud,[]);console.log('PASS: direct count and balance drilldown, selected-count boundary, 80-row pagination, back to unchanged filters, empty history, retry, independent checker, no inventory changes and responsive English/Malay screens.');console.log(out);
}catch(e){await page.screenshot({path:out+'/failure.png',fullPage:true});console.error(await page.locator('body').innerText());throw e;}finally{await browser.close();}
