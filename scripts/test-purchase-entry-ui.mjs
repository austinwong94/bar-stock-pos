import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
const url=process.env.TEST_URL??'http://127.0.0.1:5177';
const output=resolve('.qa/screenshots/purchase-entry');await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],cloud=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/supabase\.(co|in)/.test(r.url()))cloud.push(r.url());});
const dialog=page.getByRole('dialog');
const bought=name=>dialog.getByRole('textbox',{name:'Bought: '+name,exact:true});
const cost=name=>dialog.getByRole('textbox',{name:'Total Cost: '+name+' (MYR)',exact:true});
async function fits(label){
  await page.waitForTimeout(250);
  const result=await dialog.evaluate(el=>{
    const bounds=el.getBoundingClientRect();
    return [...el.querySelectorAll('.purchase-entry-row,input:not([type=file]),button')].filter(n=>{
      const r=n.getBoundingClientRect();return r.width>0&&(r.left<bounds.left-1||r.right>bounds.right+1||n.scrollWidth>n.clientWidth+2);
    }).map(n=>n.getAttribute('aria-label')||n.textContent);
  });
  assert.deepEqual(result,[],label+' clipped controls');
  const collisions=await dialog.locator('.purchase-entry-row').evaluateAll(rows=>rows.flatMap(row=>{
    const cells=[...row.children].filter(el=>!el.classList.contains('col-span-full'));
    return cells.slice(0,-1).filter((el,i)=>el.getBoundingClientRect().right>cells[i+1].getBoundingClientRect().left+1).map(el=>el.textContent);
  }));
  assert.deepEqual(collisions,[],label+' overlapping item columns');
  const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('body *')].filter(el=>{const r=el.getBoundingClientRect();return r.width&&r.right>innerWidth+1;}).slice(-8).map(el=>({tag:el.tagName,cls:el.className,text:el.textContent?.slice(0,100)}))}));
  assert(overflow.scroll<=overflow.width+1,label+' page overflow '+JSON.stringify(overflow));
}
try{
  await page.goto(url+'/#/');await page.getByRole('button',{name:'Austin (Owner)',exact:true}).click();await page.locator('main').waitFor();
  await page.evaluate(async()=>{
    const {db,persistDemoDb}=await import('/src/lib/demoBackend.ts');const {todayIso}=await import('/src/lib/opsData.ts');
    const id=crypto.randomUUID();db.purchase_requests=[{id,request_no:'PR-50-ITEMS',needed_for_date:todayIso(),purpose:'Guest Meals',notes:'Kitchen supplies',requested_by:'u-cook',status:'submitted',created_at:new Date().toISOString(),updated_at:new Date().toISOString()}];
    const names=['Tomato','Cabbage','Eggs','Rice','Cooking Oil','Prawns','Squid','Crab','Cucumber','Sweetcorn','Carrot','Garlic','Onion','Potato','Sugar','Salt','Chilli Sauce','Oyster Sauce','Vinegar','Black Pepper','Mushroom','Lychee','Curry Powder','Chicken Wings','Ice','Noodles','Pumpkin','Milk','Flour','Corn Flour','Pineapple','Large Chilli','Cooking Gas','Rubbish Bags','Dishwashing Liquid','Fish Crackers','Butter','Margarine','Baking Paper','Soy Sauce','Fish','Lime','Ginger','Coconut Milk','Turmeric','Spring Onion','Coriander','Lemongrass','Tamarind','KitchenSupplyWithAnUnusuallyLongUnbrokenProductName'];
    db.purchase_request_items=names.map((item_name,i)=>({id:crypto.randomUUID(),request_id:id,item_name,quantity:10,unit:i===0?'biji':i===1?'kg':'pack',purchase_status:i===0?'bought':'pending',purchased_quantity:i===0?4:0,sort_order:i,updated_at:new Date().toISOString()}));
    db.purchase_receipts=[];persistDemoDb();
  });
  await page.goto(url+'/#/kitchen/purchases');await page.getByRole('button',{name:'Record Purchase',exact:true}).click();
  await bought('Tomato (biji)').fill('2');
  await dialog.getByLabel('Find Item',{exact:true}).fill('Cabbage');
  assert.equal(await dialog.getByRole('button',{name:/Fill Shown Quantities|Undo Fill/}).count(),0);
  assert.equal(await bought('Cabbage (kg)').inputValue(),'');await bought('Cabbage (kg)').fill('10');
  await dialog.getByRole('button',{name:'Clear Item Search',exact:true}).click();
  assert.equal(await bought('Tomato (biji)').inputValue(),'2');assert.equal(await bought('Eggs (pack)').inputValue(),'');
  await dialog.getByRole('button',{name:'Entered (2)',exact:true}).click();assert.equal(await dialog.locator('.purchase-entry-list li').count(),2);
  await bought('Tomato (biji)').fill('');assert(await bought('Tomato (biji)').isVisible(),'An active row must not disappear while replacing its quantity');await bought('Tomato (biji)').fill('2');
  await bought('Tomato (biji)').press('Enter');assert(await bought('Cabbage (kg)').evaluate(el=>el===document.activeElement));
  await bought('Cabbage (kg)').fill('11');assert.equal(await bought('Cabbage (kg)').getAttribute('aria-invalid'),'true');
  await dialog.getByLabel('Find Item',{exact:true}).fill('Tomato');
  await dialog.getByRole('button',{name:'Check 1 Item',exact:true}).click();
  assert(await bought('Cabbage (kg)').evaluate(el=>el===document.activeElement));
  assert(await dialog.getByText('Only 10 kg left to buy.',{exact:true}).isVisible());await bought('Cabbage (kg)').fill('10');
  await dialog.getByRole('checkbox',{name:'Add Costs',exact:true}).check();
  await bought('Tomato (biji)').press('Enter');assert(await cost('Tomato').evaluate(el=>el===document.activeElement));
  await cost('Tomato').fill('21.50');await cost('Tomato').press('Enter');assert(await bought('Cabbage (kg)').evaluate(el=>el===document.activeElement));
  await cost('Cabbage').fill('22');
  await dialog.getByRole('button',{name:'Use Item Total · MYR 43.50',exact:true}).click();
  await dialog.getByLabel('Supplier',{exact:true}).selectOption('99 Speedmart');
  // Real image bytes in an isolated sample-data context, never live receipts.
  const photos=await page.evaluate(()=>['#b00f53','#0c766d'].map(fill=>{const c=document.createElement('canvas');c.width=160;c.height=120;const x=c.getContext('2d');x.fillStyle=fill;x.fillRect(0,0,160,120);x.fillStyle='white';x.font='18px sans-serif';x.fillText('QA SAMPLE',20,60);return c.toDataURL('image/png').split(',')[1];}));
  for(const [i,label] of ['Receipt Photo: Upload Photo','Items Photo: Upload Photo'].entries()){
    await dialog.getByLabel(label,{exact:true}).setInputFiles({name:`qa-${i}.png`,mimeType:'image/png',buffer:Buffer.from(photos[i],'base64')});
    await dialog.locator('img').nth(i).waitFor();
  }
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});
    await dialog.locator('.purchase-entry-tools').evaluate(el=>el.scrollIntoView({block:'start'}));
    await fits('Entry '+width);await page.screenshot({path:output+`/entry-${width}.png`});
    await bought('KitchenSupplyWithAnUnusuallyLongUnbrokenProductName (pack)').scrollIntoViewIfNeeded();await fits('Long item '+width);
  }
  await dialog.getByRole('button',{name:'Entered (2)',exact:true}).click();
  await cost('Cabbage').press('Enter');assert(!(await cost('Cabbage').evaluate(el=>el===document.activeElement)),'Final Enter does not accidentally submit');
  assert.equal(await cost('Cabbage').getAttribute('enterkeyhint'),'done');
  await dialog.getByRole('button',{name:'Review (2)',exact:true}).click();
  assert(await dialog.getByRole('button',{name:'Confirm Purchase',exact:true}).isDisabled());
  await dialog.getByRole('button',{name:'Edit: Cabbage',exact:true}).click();assert(await bought('Cabbage (kg)').evaluate(el=>el===document.activeElement));
  assert.equal(await cost('Tomato').inputValue(),'21.50');await dialog.locator('img').nth(1).waitFor();assert.equal(await dialog.locator('img').count(),2,'Editing preserves both photo attachments');
  await dialog.getByRole('button',{name:'Review (2)',exact:true}).click();
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});await fits('Confirmation '+width);await page.screenshot({path:output+`/confirm-${width}.png`});}
  await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Confirm Purchase',exact:true}).click();
  await dialog.getByText('Awaiting delivery. Inventory is unchanged.',{exact:true}).waitFor();
  const saved=await page.evaluate(async()=>{const {db}=await import('/src/lib/demoBackend.ts');return db.purchase_request_items.filter(i=>i.purchased_quantity>0).map(i=>({name:i.item_name,quantity:i.purchased_quantity}));});
  assert.deepEqual(saved,[{name:'Tomato',quantity:6},{name:'Cabbage',quantity:10}],'Only the two entered rows purchased, partial quantities added once');
  await dialog.getByRole('button',{name:'Done',exact:true}).click();
  await page.setViewportSize({width:1440,height:900});await page.getByRole('button',{name:'BM',exact:true}).click();
  await page.getByRole('button',{name:'Rekod Belian',exact:true}).click();
  assert.equal(await dialog.getByRole('button',{name:/Isi Kuantiti Dipaparkan/}).count(),0);
  for(const width of [320,390]){await page.setViewportSize({width,height:900});await dialog.locator('.purchase-entry-tools').evaluate(el=>el.scrollIntoView({block:'start'}));await fits('Malay entry '+width);await page.screenshot({path:output+`/entry-ms-${width}.png`});}
  assert.deepEqual(errors,[]);assert.deepEqual(cloud,[]);
  console.log('PASS: 50 rows, manual quantities, quantity limits, hidden errors, numeric Next/Done, totals, review editing, evidence preserved, explicit confirmation, only entered rows saved, EN/MS 320/390/768/1440, no live writes.');console.log(output);
}catch(e){await page.screenshot({path:output+'/failure.png'});console.error(await page.locator('body').innerText());throw e;}finally{await browser.close();}
