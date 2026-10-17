import assert from 'node:assert/strict';
import path from 'node:path';

export async function testPickupWorkspace(browser, url, out) {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('lovely_paradise_demo_user','u-master'));
  await page.goto(url+'/#/guests/pickup');
  await page.getByLabel('Service Date',{exact:true}).waitFor();
  const fixture=await page.evaluate(async()=>{
    const {isDemoMode}=await import('/src/lib/supabase.ts');if(!isDemoMode)throw new Error('Sample preview only');
    const {db,persistDemoDb}=await import('/src/lib/demoBackend.ts');
    const date=document.querySelector('input[type="date"]').value;
    const seed=db.bookings.find(b=>b.service_date===date);
    db.bookings=[
      {...seed,id:'pickup-family-a',lead_name:'Chloe Wong Family',pax_total:4,pax_adults:4,pax_children:0,pax_elderly:0,pax_assisted:0,pickup_required:true,pickup_group_id:null,pickup_hotel_name:'Marina Suites Main Entrance',pickup_area:'Marina',pickup_latitude:5.41,pickup_longitude:100.33},
      {...seed,id:'pickup-family-b',lead_name:'Alexanderthegreatandfamilywithanextremelylongbookingname',pax_total:2,pax_adults:2,pax_children:0,pax_elderly:0,pax_assisted:0,pickup_required:true,pickup_group_id:null,pickup_hotel_name:'Marina Suites Main Entrance',pickup_area:'Marina',pickup_latitude:5.41,pickup_longitude:100.33},
      {...seed,id:'pickup-family-c',lead_name:'Market Street Group',pax_total:3,pax_adults:3,pax_children:0,pax_elderly:0,pax_assisted:0,pickup_required:true,pickup_group_id:null,pickup_hotel_name:'Market Entrance Beside the Community Building',pickup_area:'Old Town',pickup_latitude:5.411,pickup_longitude:100.332},
      {...seed,id:'pickup-own',lead_name:'Own Transport Family',pax_total:7,pax_adults:7,pax_children:0,pax_elderly:0,pax_assisted:0,pickup_required:false,pickup_group_id:null},
    ];
    db.pickup_groups=[];
    db.transport_vehicles=db.transport_vehicles.slice(0,3).map((v,i)=>({...v,code:`Van ${i+1}`,capacity_pax:i===0?6:12,active:true}));
    persistDemoDb();return {date,vehicles:db.transport_vehicles};
  });
  await page.reload();
  console.log('Pickup: fixture loaded');
  await page.getByRole('button',{name:'Review Recommended',exact:true}).waitFor();
  const later=page.getByRole('button',{name:'Later',exact:true});if(await later.isVisible())await later.click();
  await page.getByRole('button',{name:'Add Van',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Add Van',exact:true});
  assert(await dialog.getByRole('button',{name:'Add Van',exact:true}).isDisabled(),'Explicit van selection is required');
  await dialog.getByRole('radio',{name:/Van 1/}).check();
  for(const width of [390,768,1440]) {await page.setViewportSize({width,height:width<768?844:1000});await page.screenshot({path:path.join(out,`pickup-add-van-${width}.png`)});}
  await page.evaluate(async()=>{const {supabase}=await import('/src/lib/supabase.ts');const rpc=supabase.rpc.bind(supabase);let lost=false;supabase.rpc=async(name,args)=>{const result=await rpc(name,args);if(name==='save_pickup_van_checked' && !lost && !result.error){lost=true;return {data:null,error:{message:'Connection interrupted after saving. Retry to verify.'}};}return result;};});
  await dialog.getByRole('button',{name:'Add Van',exact:true}).click();
  await dialog.getByRole('button',{name:'Retry Saving',exact:true}).waitFor();
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(500);
  assert(await dialog.getByRole('button',{name:'Retry Saving',exact:true}).isEnabled(),'Lost-response retry stays available even when the board refreshes');
  await dialog.getByRole('button',{name:'Retry Saving',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  console.log('Pickup: lost-response retry passed');
  const run=await page.evaluate(async()=>{const {db}=await import('/src/lib/demoBackend.ts');return db.pickup_groups[0];});
  await page.getByLabel('Move Chloe Wong Family',{exact:true}).selectOption(run.id);
  const assigned=page.locator(`[data-pickup-van="${run.id}"]`);
  await assigned.getByText('Chloe Wong Family',{exact:true}).waitFor();
  assert.equal(await assigned.locator('details').count(),0,'Assigned names never need disclosure toggles');
  await page.getByRole('button',{name:'Add Van',exact:true}).click();
  assert(await dialog.getByRole('radio',{name:/Van 1/}).isDisabled(),'Van already in use cannot be added again');
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  // A tap on an assigned guest must not bubble to its containing van and move a different held guest.
  await page.locator('[data-pickup-booking="pickup-family-b"]').getByText('Alexanderthegreatandfamilywithanextremelylongbookingname',{exact:true}).click();
  await assigned.getByText('Chloe Wong Family',{exact:true}).click();
  const bUnchanged=await page.evaluate(async()=>{const {db}=await import('/src/lib/demoBackend.ts');return db.bookings.find(b=>b.id==='pickup-family-b').pickup_group_id;});
  assert.equal(bUnchanged,null,'Selecting another guest does not accidentally assign the previous guest');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  console.log('Pickup: dragging guest');
  await page.getByRole('button',{name:'Drag Alexanderthegreatandfamilywithanextremelylongbookingname',exact:true}).dragTo(assigned.getByText('Van 1',{exact:true}),{timeout:5000});
  await assigned.getByText('Alexanderthegreatandfamilywithanextremelylongbookingname',{exact:true}).waitFor();
  console.log('Pickup: desktop drag passed');
  const option=page.getByLabel('Move Market Street Group',{exact:true}).locator(`option[value="${run.id}"]`);
  assert(await option.isDisabled(),'Full vans cannot be chosen');
  for(const width of [320,390,768,1024,1440]) {
    await page.setViewportSize({width,height:width<768?844:1000});
    await page.getByRole('tab',{name:/^Vans/}).click();
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.waitForTimeout(5000);
    const addBox=await page.getByRole('button',{name:'Add Van',exact:true}).boundingBox();
    assert(addBox.y+addBox.height < (width<768?844:1000)-52,'Add Van is visible without scrolling past guest lists');
    assert(await assigned.getByText('Chloe Wong Family',{exact:true}).isVisible(),'Names stay visible on each screen size');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No page overflow');
    await page.screenshot({path:path.join(out,`pickup-visible-guests-${width}.png`),fullPage:true});
  }
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('tab',{name:/^Waiting/}).click();
  assert(await page.getByLabel('Move Market Street Group',{exact:true}).isVisible(),'Mobile waiting list is one tap away');
  await page.getByRole('tab',{name:/^Own Transport/}).click();
  assert(await page.getByText('Own Transport · 7 pax',{exact:true}).isVisible(),'Own transport includes passenger totals');
  await page.getByRole('button',{name:'Review Recommended',exact:true}).click();
  const review=page.getByRole('dialog',{name:'Review Pickup Plan'});
  assert(await review.getByRole('button',{name:'Confirm Plan',exact:true}).isDisabled(),'Suggestions require explicit review');
  await review.getByLabel('Group Stops Within (km)').fill('');
  assert(await review.getByRole('button',{name:'Confirm Plan',exact:true}).isDisabled(),'Invalid grouping distance cannot confirm');
  await review.getByLabel('Group Stops Within (km)').fill('2');
  for(const width of [390,768,1440]) {await page.setViewportSize({width,height:width<768?844:1000});await page.screenshot({path:path.join(out,`pickup-recommendation-${width}.png`)});}
  await review.getByLabel('I checked locations, vehicle availability and passenger seats.').check();
  await review.getByRole('button',{name:'Confirm Plan',exact:true}).click();
  await review.waitFor({state:'hidden'});
  await page.reload();
  await page.getByText('Market Street Group',{exact:true}).waitFor();
  const state=await page.evaluate(async()=>{const {db}=await import('/src/lib/demoBackend.ts');return {runs:db.pickup_groups,bookings:db.bookings};});
  assert.equal(state.bookings.filter(b=>b.pickup_required && !b.pickup_group_id).length,0,'Reviewed guests remain assigned after reload');
  assert.equal(new Set(state.runs.map(r=>r.vehicle_id)).size,state.runs.length,'One entry per van');
  assert.deepEqual(errors,[]);
  await page.close();
  console.log('PASS pickup usability: Add Van, visible names, duplicate protection, seat limits, tap isolation, mobile views, recommended review and reload.');
}
