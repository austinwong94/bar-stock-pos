import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';

const url=process.env.UI_TEST_URL||'http://127.0.0.1:5175';
assert.equal(new URL(url).hostname,'127.0.0.1','Only isolated sample data may be edited');
const out=path.resolve('.qa/screenshots/booking-sheet');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000},hasTouch:true});page.setDefaultTimeout(12000);
const errors=[],cloud=[],shots=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/supabase\.(co|in)/.test(r.url()))cloud.push(r.url());});
async function capture(name,widths=[390,768,1440]){
  await page.waitForFunction(()=>!document.querySelector('[data-toast]'));
  for(const width of widths){await page.setViewportSize({width,height:width<768?844:1000});await page.evaluate(()=>scrollTo(0,0));
    await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1);
    const clipped=await page.locator('.daily-sheet button:visible,.daily-sheet label:visible,.daily-sheet strong:visible').evaluateAll(nodes=>nodes.filter(n=>{const r=n.getBoundingClientRect();return r.width>0 && (r.right>innerWidth+1||r.left< -1);}).map(n=>n.textContent));
    assert.deepEqual(clipped,[],`Controls fit: ${name} at ${width}`);
    const file=`${name}-${width}.png`;await page.screenshot({path:path.join(out,file),fullPage:!(await page.getByRole('dialog').count())});shots.push(file);
  }
}
const rpc=async(name,args)=>page.evaluate(async({name,args})=>{const {supabase,isDemoMode}=await import('/src/lib/supabase.ts');if(!isDemoMode)throw Error('Sample only');const r=await supabase.rpc(name,args);if(r.error)throw Error(r.error.message);return r.data;},{name,args});
try{
  await page.goto(url+'/#/guests/sheet');await page.getByRole('button',{name:'Austin (Owner)',exact:true}).click();
  await page.goto(url+'/#/guests/sheet');await page.getByLabel('Service Date',{exact:true}).waitFor();
  const date=await page.evaluate(async()=>{
    const {db,persistDemoDb}=await import('/src/lib/demoBackend.ts');const {TOMORROW}=await import('/src/lib/demoSeed.ts');
    db.bookings=[];db.tourists=[];db.trip_bookings=[];db.trip_passengers=[];db.boat_assignments=[];db.pickup_groups=[];db.booking_accounts=[];db.booking_payments=[];
    db.boats=db.boats.slice(0,2).map((b,i)=>({...b,code:i===0?'Big Boat 1':'Boat 2',capacity_pax:i===0?43:14,status:'active'}));
    persistDemoDb();return TOMORROW;
  });
  await page.reload();await page.getByLabel('Service Date',{exact:true}).fill(date);await page.getByRole('tab',{name:'List',exact:true}).waitFor();
  for(const label of ['Later','Hide pax reminder']){const b=page.getByRole('button',{name:label,exact:true});if(await b.isVisible())await b.click();}
  await page.getByRole('tab',{name:'List',exact:true}).click();await page.getByRole('button',{name:'Add Booking',exact:true}).waitFor();
  await page.getByRole('button',{name:'Add Booking',exact:true}).click();let dialog=page.getByRole('dialog',{name:'Add Booking',exact:true});
  await dialog.getByLabel('Booking / Group Name').fill('Wong Family');await dialog.getByLabel('Contact Number').fill('012 345 6789');
  for(const [label,value]of Object.entries({'Adults':'4','Children':'2','Infants':'1','TL (Local)':'1','TG (China)':'1'}))await dialog.getByRole('spinbutton',{name:label,exact:true}).fill(value);
  await dialog.getByLabel('Pickup Location').fill('Marina Suites Main Entrance');await dialog.getByLabel('Area',{exact:true}).fill('Marina');await dialog.getByLabel('Pickup Time').fill('08:00');await dialog.getByLabel('Drop-off Location').fill('Marina Suites');
  await dialog.getByLabel('Agency',{exact:true}).selectOption({label:'NCA'});await dialog.getByLabel('Shared Planning Remarks').fill('Meet at the main lobby');
  await capture('add-booking',[390,1440]);await dialog.getByRole('button',{name:'Save Booking',exact:true}).click();await dialog.waitFor({state:'hidden'});
  assert((await page.locator('.sheet-booking-row').innerText()).includes('9 pax'));
  const others=[['Tan Group',6,'Marina Suites','Marina','xhs'],['Lim Family',4,'Hotel Marina Bay','Marina','xhs'],['Lee Family',5,'Town Apartments','Old Town','standard'],['Ocean Travel Group',8,'Sunset Beach Villa','Sunset Bay','standard'],['Alexanderthegreatandfamilywithaverylongbookingname',2,'A building without a hotel name on Jalan Pantai','North Beach','standard']];
  for(const [name,pax,hotel,area,group]of others)await rpc('save_daily_booking',{p_date:date,p_booking_id:null,p_expected_updated_at:null,p_request_id:crypto.randomUUID(),p_changes:{lead_name:name,counts:{adults:pax,children:0,infants:0,tour_leaders:0,tour_guides:0},pickup_hotel_name:hotel,pickup_area:area,pickup_required:true,planning_group:group}});
  await page.getByRole('button',{name:'Refresh Sheet'}).click();await page.waitForFunction(()=>document.querySelectorAll('.sheet-booking-row').length===6);
  await capture('daily-bookings',[320,390,768,1024,1440]);
  await page.getByRole('tab',{name:'Boats & Vans',exact:true}).click();await page.getByLabel('Add Boat',{exact:true}).selectOption('bt-1');await page.waitForFunction(()=>document.querySelectorAll('.sheet-boat').length===1);
  await page.getByLabel('Captain for Big Boat 1').selectOption('em-ali');await page.waitForFunction(()=>document.querySelector('select[aria-label="Captain for Big Boat 1"]')?.value==='em-ali');
  await page.getByLabel('Jamil (Crew)',{exact:true}).check();await page.waitForFunction(()=>!document.querySelector('.sheet-crew')?.disabled);
  await page.getByLabel('Add Boat',{exact:true}).selectOption('bt-2');await page.waitForFunction(()=>document.querySelectorAll('.sheet-boat').length===2);
  const vanOption=await page.getByLabel('Add Van',{exact:true}).locator('option').nth(1).getAttribute('value');await page.getByLabel('Add Van',{exact:true}).selectOption(vanOption);await page.locator('.sheet-van').waitFor();
  await page.getByLabel('Driver for Van 1').selectOption('em-kumar').catch(async()=>{await page.locator('.sheet-van select').selectOption('em-kumar');});
  await page.getByRole('tab',{name:'List',exact:true}).click();await page.getByRole('button',{name:'Suggest Boats',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Review Suggested Boats'});await capture('suggested-boat-plan',[390,768,1440]);
  await dialog.getByRole('button',{name:'Confirm Boat Plan'}).click();await dialog.waitFor({state:'hidden'});await capture('assigned-boats',[320,390,768,1440]);
  assert((await page.locator('.sheet-boat-manifest').allTextContents()).join(' ').includes('Wong Family'));
  await page.getByRole('tab',{name:'Accounts',exact:true}).click();await page.locator('.sheet-account-row').filter({hasText:'Wong Family'}).getByRole('button',{name:'Open Account'}).click();
  dialog=page.getByRole('dialog',{name:'Wong Family',exact:true});await dialog.getByRole('tab',{name:'Total & Invoice'}).click();await dialog.getByLabel('Agreed Booking Total (RM)').fill('1464');await dialog.getByLabel('Invoice Number').fill('IV-LP-2609-001');await dialog.getByRole('button',{name:'Save Total & Invoice'}).click();await dialog.getByRole('button',{name:'Record Payment'}).waitFor();
  for(const [dateValue,amount,reference]of [['2026-08-04','500','Deposit'],['2026-08-11','964','Balance']]){await dialog.getByLabel('Payment Date',{exact:true}).fill(dateValue);await dialog.getByLabel('Amount (RM)',{exact:true}).fill(amount);await dialog.getByLabel('Payment Reference').fill(reference);await dialog.getByRole('button',{name:'Record Payment'}).click();await page.waitForFunction(()=>document.querySelector('.sheet-payment-form input[type=number]')?.value==='');}
  assert((await dialog.innerText()).includes('RM 0.00'));assert.equal(await dialog.locator('.sheet-payment-row').count(),2);
  assert(await page.locator('[data-toast="success"]').count()<=1,'Identical save notices do not stack');
  await capture('payment-ledger',[320,390,768,1440]);await dialog.getByRole('button',{name:'Close',exact:true}).click();await capture('booking-accounts',[390,768,1440]);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Accounts CSV'}).click();assert((await download).suggestedFilename().includes(date));
  await page.getByRole('tab',{name:'Commission Terms',exact:true}).click();await page.getByRole('button',{name:'Edit General Commission'}).click();dialog=page.getByRole('dialog',{name:'Edit Commission Terms'});await dialog.getByLabel('Commission Method').selectOption('percent');await dialog.getByLabel('Rate (%)').fill('10');await dialog.getByRole('button',{name:'Save Terms'}).click();await dialog.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Add Referrer'}).click();dialog=page.getByRole('dialog',{name:'Add Referrer'});await dialog.getByLabel('Name',{exact:true}).fill('NCA Referral Agreement (Sample)');await dialog.getByRole('button',{name:'Save Terms'}).click();await dialog.waitFor({state:'hidden'});await capture('referral-terms',[390,1440]);
  await page.getByRole('tab',{name:'Booking Accounts',exact:true}).click();await page.locator('.sheet-account-row').filter({hasText:'Wong Family'}).getByRole('button',{name:'Open Account'}).click();dialog=page.getByRole('dialog',{name:'Wong Family',exact:true});await dialog.getByRole('tab',{name:'Commission',exact:true}).click();await dialog.getByLabel('Referrer',{exact:true}).selectOption({label:'NCA Referral Agreement (Sample)'});await dialog.getByRole('button',{name:'Save Booking Commission'}).click();await dialog.getByRole('button',{name:'Record Payment'}).waitFor();await dialog.getByRole('tab',{name:'Commission',exact:true}).click();assert((await dialog.innerText()).includes('RM 146.40'));await capture('booking-commission',[390,1440]);await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Planner Access',exact:true}).click();dialog=page.getByRole('dialog',{name:`Planner Access: ${date}`});await dialog.getByLabel('External Planner (Sample)').check();await capture('planner-access',[390,1440]);await dialog.getByRole('button',{name:'Close',exact:true}).click();
  const today=await page.evaluate(async()=>(await import('/src/lib/opsData.ts')).todayIso());
  await rpc('save_daily_booking',{p_date:today,p_booking_id:null,p_expected_updated_at:null,p_request_id:crypto.randomUUID(),p_changes:{lead_name:'Today Summary Family',counts:{adults:4,children:2,infants:1,tour_leaders:1,tour_guides:1}}});
  await page.goto(url+'/#/');await page.getByText('1 TL (Local)',{exact:true}).waitFor();await capture('home-summary',[320,390,768,1440]);
  await page.goto(url+'/#/ops/summary');await page.getByText(/4 Adults.*2 Children.*1 Infant.*1 TL \(Local\).*1 TG \(China\)/).waitFor();await capture('daily-summary',[320,390,768,1440]);
  await page.evaluate(()=>localStorage.setItem('lovely_paradise_demo_user','u-planner'));await page.goto(url+'/#/guests/sheet');await page.reload();await page.getByLabel('Service Date',{exact:true}).fill(date);await page.getByRole('tab',{name:'List',exact:true}).click();await page.locator('.sheet-booking-row').first().waitFor();
  assert.equal(await page.getByRole('tab',{name:'Accounts',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Add Booking',exact:true}).count(),0);await capture('restricted-planner',[390,768,1440]);
  assert.deepEqual(errors,[],'No browser runtime errors');assert.deepEqual(cloud,[],'No live Supabase requests');
  await writeFile(path.join(out,'index.html'),`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Booking Workflow Screenshots</title><style>body{margin:20px;font:15px system-ui;background:#f8f4f7;color:#302431}section{margin-bottom:28px}img{max-width:100%;border:1px solid #dacdd5}a{color:#a91650}</style><h1>Booking Workflow Review</h1><p>Isolated sample data. No live records were changed.</p>${shots.map(file=>`<section><h2>${file.replace('.png','').split('-').join(' ')}</h2><a href="${file}"><img src="${file}" loading="lazy"></a></section>`).join('')}`);
  console.log(`BOOKING UI: workflows, responsive checks and ${shots.length} unlocked screenshots passed.`);
}catch(error){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});console.error((await page.locator('body').innerText()).slice(-5000));throw error;}finally{await browser.close();}
