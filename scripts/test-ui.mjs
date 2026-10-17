import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import { testStaffWorkflows } from './test-staff-ui.mjs';
import { testPurchaseBatches } from './test-purchasing-ui.mjs';
import { testDeliveryBatches } from './test-delivery-ui.mjs';
import { testPickupWorkspace } from './test-pickup-ui.mjs';

const out=path.resolve('.qa/screenshots');
await mkdir(out,{recursive:true});
const url=process.env.UI_TEST_URL || 'http://127.0.0.1:5186';
assert.equal(new URL(url).hostname,'127.0.0.1','Browser regression tests use a local preview only');
let server,browser;
try {
  if (!process.env.UI_TEST_URL) {
    server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5186','--strictPort'],{env:{...process.env,VITE_DEMO_MODE:'true'},stdio:['ignore','pipe','pipe']});
    let ready=false;
    for(let i=0;i<100;i++) {
      if(server.exitCode!==null) throw new Error('Preview server exited before becoming ready.');
      try {ready=(await fetch(url)).ok;} catch {}
      if(ready) break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert(ready,'Preview server started');
  }
  browser=await chromium.launch({headless:true});
  if(process.env.UI_TEST_SCOPE==='pickup') {
    await testPickupWorkspace(browser,url,out);
  } else if(process.env.UI_TEST_SCOPE==='staff') {
    await testStaffWorkflows(browser,url,out);
  } else if(process.env.UI_TEST_SCOPE==='purchasing') {
    await testPurchaseBatches(browser,url,out);
  } else if(process.env.UI_TEST_SCOPE==='delivery') {
    await testDeliveryBatches(browser,url,out);
  } else {
  const page=await browser.newPage({viewport:{width:1440,height:1000},hasTouch:true});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);
  await page.getByRole('button',{name:/Austin \(Owner\)/}).click();
  await page.locator('main').waitFor();
  // Authorize the isolated practice session so layout checks reach the actual admin screens.
  await page.evaluate(async()=>{
    const {isDemoMode}=await import('/src/lib/supabase.ts');
    if(!isDemoMode)throw new Error('Admin layout fixtures require local preview mode.');
    sessionStorage.setItem('lovely_paradise_admin_access',JSON.stringify({expiresAt:new Date(Date.now()+3600000).toISOString()}));
  });
  const later=page.getByRole('button',{name:'Later',exact:true});
  await page.waitForTimeout(300);
  if(await later.count()) await later.click();
  const routes=[['/','home'],['/bar','dashboard'],['/kitchen','kitchen'],['/purchasing','purchasing'],['/pos','pos'],['/daily-report','reports'],['/daily-closing','closing'],['/stock-out-report','stock'],['/kitchen/preparation','preparation'],['/guests','bookings'],['/guests/pickup','pickup'],['/fleet','fleet'],['/boarding','boarding'],['/activities','activities'],['/ops','operations'],['/ops/summary','summary'],['/admin/access','access']];
  routes.push(['/inventory','inventory'],['/products','products'],['/sales','sales'],['/movements','movements'],['/settings','bar-settings'],['/maintenance','maintenance'],['/guests/sheet','guest-sheet'],['/ops/outbox','outbox'],['/items','lost-items'],['/admin/boats','boats'],['/admin/vehicles','vehicles'],['/admin/directory','directory'],['/admin/settings','platform-settings']);
  for(const width of [1440,1024,768,390,320]) {
    await page.setViewportSize({width,height:width<768?844:1000});
    for(const [route,name] of routes) {
      await page.goto(url+'/#'+route);
      await page.locator('main').waitFor();
      await page.waitForTimeout(200);
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
      if (overflow > 1) {
        await page.screenshot({path:path.join(out,`overflow-${name}-${width}.png`),fullPage:true});
        console.log(await page.evaluate(()=>Array.from(document.querySelectorAll('main *')).filter(el=>el.getBoundingClientRect().right>innerWidth+1 && getComputedStyle(el).position!=='fixed').slice(0,12).map(el=>({tag:el.tagName,class:el.className,text:el.textContent.slice(0,80)}))));
      }
      assert(overflow<=1,`Page overflow at ${width}px: ${route} (${overflow}px)`);
      assert(!(await page.locator('main').innerText()).includes('This section is not part of your access.'),`Owner can open ${route}`);
      assert.equal(await page.getByPlaceholder('Admin password',{exact:true}).count(),0,'Screenshots show the actual page, not an admin gate');
      await page.screenshot({path:path.join(out,`${name}-${width}.png`),fullPage:true});
    }
  }
  await testStaffWorkflows(browser,url,out);
  await testPurchaseBatches(browser,url,out);
  await testDeliveryBatches(browser,url,out);
  await page.goto(url+'/#/guests/pickup');
  await page.getByRole('button',{name:'Review Recommended',exact:true}).waitFor();
  const pickupState=await page.evaluate(async()=>{
    const {supabase}=await import('/src/lib/supabase.ts');
    const date=document.querySelector('input[type="date"]').value;
    return (await supabase.rpc('read_pickup_board',{p_date:date})).data;
  });
  const ownPax=pickupState.bookings.filter(b=>!b.pickup_required).reduce((s,b)=>s+b.pax_total,0);
  await page.getByRole('tab',{name:/^Own Transport/}).click();
  assert(await page.getByText(`Own Transport · ${ownPax} pax`,{exact:true}).isVisible(),'Own transport shows passenger count, not booking count');
  const pickupBooking=pickupState.bookings.find(b=>b.pickup_required && !b.pickup_group_id);
  await page.getByRole('tab',{name:/^Waiting/}).click();
  await page.getByRole('button',{name:`Edit Location for ${pickupBooking.lead_name}`,exact:true}).click();
  await page.getByLabel('Hotel, Street or Building',{exact:true}).fill('Market Entrance, Jalan Marina Beside the Community Building');
  await page.getByLabel('Latitude',{exact:true}).fill('');
  await page.getByLabel('Longitude',{exact:true}).fill('');
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:width<768?844:1000});
    await page.screenshot({path:path.join(out,`pickup-location-${width}.png`)});
  }
  await page.getByRole('button',{name:'Save Location',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Review Recommended',exact:true}).click();
  const pickupDialog=page.getByRole('dialog',{name:'Review Pickup Plan'});
  await pickupDialog.waitFor();
  assert(await page.getByRole('button',{name:'Confirm Plan',exact:true}).isDisabled(),'Pickup plan requires explicit confirmation');
  assert.equal(await page.getByLabel(`Vehicle for ${pickupBooking.lead_name}`,{exact:true}).inputValue(),'','Missing coordinates stay unassigned');
  await page.getByLabel(`Vehicle for ${pickupBooking.lead_name}`,{exact:true}).selectOption({label:'Van 2 · 10 seats'});
  assert(await page.getByText('A vehicle exceeds its passenger capacity.',{exact:true}).isVisible(),'Manual reassignment flags an overloaded vehicle');
  await page.getByRole('checkbox',{name:'I checked locations, vehicle availability and passenger seats.'}).check();
  assert(await page.getByRole('button',{name:'Confirm Plan',exact:true}).isDisabled(),'An overloaded draft cannot be confirmed');
  await page.getByLabel(`Vehicle for ${pickupBooking.lead_name}`,{exact:true}).selectOption('');
  for(const width of [1440,768,390,320]){
    await page.setViewportSize({width,height:width<768?844:1000});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Pickup review does not overflow');
    await page.screenshot({path:path.join(out,`pickup-plan-${width}.png`)});
  }
  await page.getByRole('button',{name:'Close',exact:true}).click();
  const untouched=await page.evaluate(async()=>{
    const {supabase}=await import('/src/lib/supabase.ts');
    return (await supabase.rpc('read_pickup_board',{p_date:document.querySelector('input[type="date"]').value})).data;
  });
  assert.equal(untouched.runs.length,pickupState.runs.length,'Dismissing a suggestion does not assign any guests');
  await page.getByRole('button',{name:'Review Recommended',exact:true}).click();
  await page.getByRole('checkbox',{name:'I checked locations, vehicle availability and passenger seats.'}).check();
  await page.getByRole('button',{name:'Confirm Plan',exact:true}).click();
  await pickupDialog.waitFor({state:'hidden'});
  await page.reload();
  await page.getByRole('button',{name:'Review Recommended',exact:true}).waitFor();
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:width<768?844:1000});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Confirmed pickup board does not overflow');
    await page.screenshot({path:path.join(out,`pickup-confirmed-${width}.png`),fullPage:true});
  }
  const persisted=await page.evaluate(async()=>{
    const {supabase}=await import('/src/lib/supabase.ts');
    return (await supabase.rpc('read_pickup_board',{p_date:document.querySelector('input[type="date"]').value})).data;
  });
  assert(persisted.runs.length>pickupState.runs.length,'Confirmed pickup runs survive reload');
  assert(persisted.runs.every(r=>persisted.bookings.filter(b=>b.pickup_group_id===r.id).reduce((s,b)=>s+b.pax_total,0)<=r.transport_vehicles.capacity_pax),'Every confirmed vehicle remains within passenger capacity');
  console.log('PASS pickup workflow: pax totals, free-text locations, missing points, draft review, explicit confirmation, reload and screen sizes');
  await page.goto(url+'/#/guests');
  await page.getByRole('button',{name:'New booking',exact:true}).click();
  await page.getByLabel('Hotel, Street or Building',{exact:true}).fill('Jalan Marina Community Building');
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:width<768?844:1000});
    await page.getByText('Saved Pickup Place',{exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(out,`booking-pickup-${width}.png`)});
  }
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.goto(url+'/#/guests/sheet');
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:width<768?844:1000});
    await page.getByText('Pickup Location',{exact:true}).first().scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(out,`booking-sheet-${width}.png`)});
  }

  await page.setViewportSize({width:390,height:844});
  await page.goto(url+'/#/kitchen');
  await page.getByRole('button',{name:'PR-DEMO-002',exact:true}).click();
  const confirm=page.getByRole('button',{name:'Confirm & Send',exact:true});
  assert(await confirm.isDisabled(),'A request requires an explicit confirmation');
  await page.getByRole('checkbox',{name:'I checked the date, items and quantities.'}).check();
  assert(await confirm.isEnabled(),'Checked request can be submitted');
  await page.screenshot({path:path.join(out,'request-confirmation-390.png')});
  await page.getByRole('button',{name:'Close',exact:true}).click();
  assert(await page.getByRole('button',{name:'PR-DEMO-002',exact:true}).isVisible(),'Dismissing confirmation preserves the draft');

  await page.goto(url+'/#/purchasing');
  await page.getByRole('button',{name:'Bought',exact:true}).first().click();
  await page.getByLabel('Quantity Bought (kg)',{exact:true}).fill('10');
  await page.getByLabel('Total Cost (MYR)',{exact:true}).fill('45');
  await page.getByLabel('Supplier',{exact:true}).fill('Pasar Besar');
  for (const width of [390,1440]) {
    await page.setViewportSize({width,height:width<768?844:1000});
    await page.screenshot({path:path.join(out,`purchase-entry-${width}.png`)});
  }
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('tab',{name:/^Open /}).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('tab',{name:/^To Receive /}).getAttribute('aria-selected'),'true','Purchase views support keyboard navigation');
  await page.getByRole('button',{name:'Receive',exact:true}).first().click();
  await page.getByLabel('Inventory Item').selectOption({label:'Chicken breast (g)'});
  assert.equal(await page.getByLabel('g per kg').inputValue(),'1000','kg conversion is explicit');
  const receive=page.getByRole('button',{name:'Confirm & Add to Stock',exact:true});
  assert(await receive.isDisabled(),'A delivery cannot submit before confirmation');
  for (const invalid of ['-1','0','9','0.001']) {
    await page.getByLabel('Quantity (kg)',{exact:true}).fill(invalid);
    await page.getByRole('checkbox',{name:'I checked the delivered quantity and unit size.'}).check();
    assert(await receive.isDisabled(),`Invalid delivery quantity ${invalid} cannot submit`);
  }
  await page.getByLabel('Quantity (kg)',{exact:true}).fill('3');
  await page.getByRole('checkbox',{name:'I checked the delivered quantity and unit size.'}).check();
  assert(await receive.isEnabled(),'A valid checked delivery can be confirmed');
  await page.waitForTimeout(200);
  await page.screenshot({path:path.join(out,'delivery-confirmation-390.png')});
  await page.keyboard.press('Tab');
  assert(await page.evaluate(()=>!!document.activeElement?.closest('[role="dialog"]')),'Modal keeps keyboard focus inside');
  await receive.click();
  await page.getByRole('dialog',{name:'Delivery Confirmed'}).waitFor();
  assert(await page.getByText('+3,000 g',{exact:true}).isVisible(),'Partial delivery immediately shows stock evidence');
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await page.getByText('Received 3 / 8 kg',{exact:true}).waitFor();
  await page.reload();
  await page.getByText('Received 3 / 8 kg',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Receive',exact:true}).first().click();
  assert.equal(await page.getByLabel('Quantity (kg)',{exact:true}).inputValue(),'','Each delivery requires the actual quantity rather than assuming the whole remainder');
  await page.getByLabel('Quantity (kg)',{exact:true}).fill('5');
  await page.getByLabel('Inventory Item').selectOption({label:'Chicken breast (g)'});
  await page.getByRole('checkbox',{name:'I checked the delivered quantity and unit size.'}).check();
  await receive.click();
  const receipts=page.getByRole('dialog',{name:'Delivery Confirmed'});
  await receipts.waitFor();
  assert.equal(await receipts.locator('tbody tr').count(),2,'Each partial delivery retains its own receipt');
  assert(await receipts.getByText('+5,000 g',{exact:true}).isVisible(),'Remainder creates a separate stock receipt');
  for (const width of [390,320,1440]) {
    await page.setViewportSize({width,height:width<768?844:1000});
    await page.waitForTimeout(200);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
    assert(overflow<=1,`Delivery receipts fit at ${width}px`);
    const doneBounds=await receipts.getByRole('button',{name:'Done',exact:true}).boundingBox();
    assert(doneBounds && doneBounds.y>=0 && doneBounds.y+doneBounds.height<=page.viewportSize().height,'Receipt close action stays visible');
    await page.screenshot({path:path.join(out,`delivery-receipts-${width}.png`)});
  }
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await page.getByRole('tab',{name:/^To Receive /}).click();
  await page.getByText('No purchases or deliveries pending.',{exact:true}).waitFor();
  await page.getByRole('tab',{name:/^Open /}).click();
  await page.getByText('Received 8 / 8 kg',{exact:true}).waitFor();
  while(await page.getByRole('button',{name:'Mark unavailable',exact:true}).count()) {
    const count=await page.getByRole('button',{name:'Mark unavailable',exact:true}).count();
    await page.getByRole('button',{name:'Mark unavailable',exact:true}).first().click();
    await page.waitForFunction(expected=>document.querySelectorAll('button[aria-label="Mark unavailable"]').length<expected,count);
  }
  await page.getByRole('tab',{name:/^History /}).click();
  await page.getByLabel('Search purchases').fill('Pasar Besar');
  await page.getByText('PR-DEMO-001',{exact:true}).waitFor();
  await page.waitForTimeout(350);
  await page.reload();
  await page.getByRole('tab',{name:/^History /}).click();
  await page.getByRole('button',{name:'Receipts (2)',exact:true}).waitFor();
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:width<768?844:1000});
    await page.screenshot({path:path.join(out,`purchase-history-${width}.png`),fullPage:true});
  }
  await page.getByLabel('Search purchases').fill('no such purchase');
  await page.getByText('No matching purchases.',{exact:true}).waitFor();
  await page.getByLabel('Search purchases').fill('');
  await page.getByRole('button',{name:'Receipts (2)',exact:true}).waitFor();
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'BM',exact:true}).click();
  await page.getByRole('button',{name:'Resit (2)',exact:true}).click();
  const malayReceipts=page.getByRole('dialog',{name:'Resit Penghantaran'});
  await malayReceipts.waitFor();
  for (const width of [390,320]) {
    await page.setViewportSize({width,height:844});
    await page.waitForTimeout(200);
    assert(await malayReceipts.locator('th').evaluateAll(cells=>cells.every(cell=>cell.scrollWidth<=cell.clientWidth)),'Malay receipt headings fit their columns');
    await page.screenshot({path:path.join(out,`delivery-receipts-ms-${width}.png`)});
  }
  await page.getByRole('button',{name:'Selesai',exact:true}).click();
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'EN',exact:true}).click();
  console.log('PASS Partial delivery, receipt evidence, history, search and reload persistence');

  await page.setViewportSize({width:390,height:844});
  await page.goto(url+'/#/pos');
  await page.getByRole('button',{name:/1602 Lager/}).first().click();
  await page.getByRole('button',{name:/1602 Pale Ale/}).first().click();
  const selected=page.getByRole('heading',{name:'Selected order',exact:true});
  assert(await selected.isVisible(),'The selected order appears immediately');
  await selected.scrollIntoViewIfNeeded();
  const dock=page.getByRole('button',{name:'Cart Details',exact:true}).locator('xpath=../../..');
  assert((await dock.boundingBox()).height<160,'Mobile payment dock stays compact');
  assert.equal(await page.locator('section').filter({has:selected}).getByLabel('Increase',{exact:true}).count(),2,'Each selected item has an immediately available quantity control');
  await page.screenshot({path:path.join(out,'selected-order-390.png')});
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(()=>scrollTo(0,0));
  await page.evaluate(async()=>{
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).filter(img=>img.getBoundingClientRect().top<innerHeight).map(img=>img.complete?Promise.resolve():new Promise(resolve=>{img.addEventListener('load',resolve,{once:true});img.addEventListener('error',resolve,{once:true});setTimeout(resolve,4000);})));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  });
  await page.screenshot({path:path.join(out,'selected-order-1440.png')});

  await page.goto(url+'/#/kitchen');
  await page.getByRole('button',{name:'New Request',exact:true}).click();
  await page.getByLabel('Pax',{exact:true}).fill('100');
  await page.getByLabel('Purpose',{exact:true}).fill('Island Lunch');
  await page.getByLabel('Search Items',{exact:true}).fill('Chicken breast');
  const chickenChoice=page.getByRole('button',{name:'Chicken breast (kg)',exact:true});
  await chickenChoice.click();
  const firstQuantity=await page.getByLabel('Quantity 1',{exact:true}).inputValue();
  await chickenChoice.click();
  assert.equal(await page.getByLabel('Quantity 1',{exact:true}).inputValue(),firstQuantity,'Selecting the same catalogue item does not silently increase its quantity');
  await page.getByLabel('Search Items',{exact:true}).fill('');
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:width<768?844:1000});
    await page.getByLabel('Needed For',{exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(out,`kitchen-catalogue-${width}.png`)});
  }
  const foodNames='Chicken breast|Jasmine rice|Cooking oil|Mixed vegetables|Crabs|Squid|Large tiger prawns (fresh, whole)|Onions|Garlic|Ginger|Potatoes|Carrots|Cabbage|Tomatoes|Cucumber|Chillies|Lemongrass|Spring onions|Coriander|Limes|Tofu|Tempeh|Eggs|Flour|Sugar|Salt|Black pepper|Soy sauce|Oyster sauce|Chilli sauce|Coconut milk|Butter|Milk|Tea|Coffee|Sardines|Tuna|Seabass|Mussels|Clams|Scallops|Spinach|Lettuce|Broccoli|Cauliflower|Pumpkin|Sweetcorn|Green beans|Mushrooms|Pineapple'.split('|');
  assert.equal(foodNames.length,50);
  const orderPaste=foodNames.map((name,index)=>[name,index===49?'':String(index%4+1),/oil|sauce|milk/i.test(name)?'L':name==='Eggs'?'pcs':'kg',index===0?'Fresh delivery':''].join('\t')).join('\n');
  await page.getByLabel('Item Name 1',{exact:true}).evaluate((input,value)=>{
    const clipboardData=new DataTransfer();clipboardData.setData('text/plain',value);
    input.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true}));
  },orderPaste);
  assert.equal(await page.getByRole('textbox',{name:/^Item Name \d+$/}).count(),50,'All 50 pasted rows remain in the editor');
  await page.getByRole('dialog').locator('summary').filter({hasText:'Catalogue'}).click();
  for (const width of [1440,768,390,320]) {
    await page.setViewportSize({width,height:width<768?844:1000});
    await page.getByLabel('Needed For',{exact:true}).scrollIntoViewIfNeeded();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=1),`50-item editor fits at ${width}px`);
    assert(await page.locator('#kitchen-form textarea').evaluateAll(inputs=>inputs.every(input=>input.scrollHeight<=input.clientHeight+1)),`Item names wrap without clipping at ${width}px`);
    const saveBounds=await page.getByRole('button',{name:'Save & Review',exact:true}).boundingBox();
    assert(saveBounds && saveBounds.y+saveBounds.height<=page.viewportSize().height,'Save action remains visible for long requests');
    await page.screenshot({path:path.join(out,`kitchen-entry-50-${width}.png`)});
  }
  await page.getByRole('button',{name:'Save & Review',exact:true}).click();
  await page.getByText('Draft Saved · Not Sent',{exact:true}).waitFor();
  const review=page.getByRole('dialog');
  const savedReference=await review.getByRole('heading',{level:2}).innerText();
  assert.equal(await review.locator('tbody tr').count(),50,'Review loads all saved rows');
  assert(await page.getByRole('button',{name:'Confirm & Send',exact:true}).isDisabled(),'An incomplete saved draft cannot be sent');
  await page.screenshot({path:path.join(out,'kitchen-incomplete-320.png')});
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.reload();
  await page.getByRole('button',{name:savedReference,exact:true}).click();
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  assert.equal(await page.getByRole('textbox',{name:/^Item Name \d+$/}).count(),50,'Closing and reloading preserves the entire draft');
  await page.getByLabel('Quantity 50',{exact:true}).fill('3');
  await page.getByRole('button',{name:'Save & Review',exact:true}).click();
  await page.getByText('Draft Saved · Not Sent',{exact:true}).waitFor();
  await page.getByRole('checkbox',{name:'I checked the date, items and quantities.'}).check();
  for (const width of [390,1440]) {
    await page.setViewportSize({width,height:width<768?844:1000});
    await page.getByText('Draft Saved · Not Sent',{exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(out,`kitchen-review-50-${width}.png`)});
  }
  await page.getByRole('button',{name:'Confirm & Send',exact:true}).click();
  await page.getByText('Sent to Purchasing',{exact:true}).waitFor();
  assert(await page.getByText(/Confirmed by Austin \(Owner\)/).isVisible(),'Submission immediately displays its named confirmation receipt');
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:width<768?844:1000});
    await page.screenshot({path:path.join(out,`kitchen-sent-${width}.png`)});
  }
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await page.reload();
  await page.getByRole('button',{name:savedReference,exact:true}).click();
  await page.getByText('Sent to Purchasing',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Confirm & Send',exact:true}).count(),0,'A sent request does not offer another submission');
  page.once('dialog',dialog=>dialog.accept('2026-11-03'));
  await page.getByRole('button',{name:'Copy',exact:true}).click();
  await page.getByText('Draft Saved · Not Sent',{exact:true}).waitFor();
  assert.notEqual(await page.getByRole('dialog').getByRole('heading',{level:2}).innerText(),savedReference,'Copying opens a new saved draft immediately');
  assert.equal(await page.getByRole('dialog').locator('tbody tr').count(),50,'A copied request retains all items');
  assert(await page.getByRole('button',{name:'Confirm & Send',exact:true}).isDisabled(),'A copied request requires a fresh confirmation');
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.goto(url+'/#/purchasing');
  await page.getByLabel('Search purchases').fill(savedReference);
  await page.getByText(savedReference,{exact:true}).waitFor();
  await page.waitForTimeout(350);
  assert.equal(await page.getByRole('tabpanel').locator('li').count(),50,'Purchasing receives the same 50 confirmed items');
  console.log('PASS 50-item kitchen draft, explicit handoff, reload persistence and purchasing visibility');
  assert.deepEqual(errors,[],'No browser runtime errors');
  console.log(`UI: ${routes.length*5} route/viewport checks plus staff, confirmation, persistence, and cart checks passed.`);
  }
} catch (error) {
  console.error(error);
  throw error;
} finally {
  if(browser) await browser.close();
  if(server && server.exitCode===null) {server.kill('SIGTERM');await once(server,'exit');}
}
