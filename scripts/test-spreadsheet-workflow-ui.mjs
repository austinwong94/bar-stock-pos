import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const url=process.env.UI_TEST_URL||'http://127.0.0.1:5175';
assert.equal(new URL(url).hostname,'127.0.0.1');
const out=path.resolve('.qa/screenshots/spreadsheet-workflow');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000},hasTouch:true});page.setDefaultTimeout(15000);
const errors=[],cloud=[],shots=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/supabase\.(co|in)/.test(r.url()))cloud.push(r.url());});
async function capture(name,widths=[390,768,1440]){
  await page.waitForFunction(()=>!document.querySelector('[data-toast]'));
  for(const width of widths){await page.setViewportSize({width,height:width<768?844:1000});await page.evaluate(()=>scrollTo(0,0));
    await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1);
    const file=`${name}-${width}.png`;await page.screenshot({path:path.join(out,file),fullPage:false});shots.push(file);
  }
}
async function paste(label,text){await page.getByRole('textbox',{name:label,exact:true}).evaluate((el,text)=>{el.focus();const data=new DataTransfer();data.setData('text/plain',text);el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},text);}
const rpc=(name,args)=>page.evaluate(async({name,args})=>{const {supabase,isDemoMode}=await import('/src/lib/supabase.ts');assertDemo(isDemoMode);function assertDemo(ok){if(!ok)throw Error('Sample only');}const r=await supabase.rpc(name,args);if(r.error)throw Error(r.error.message);return r.data;},{name,args});
async function saved(){await page.getByRole('button',{name:'Save',exact:true}).waitFor();assert(await page.getByRole('button',{name:'Save',exact:true}).isDisabled());}
try{
  await page.goto(url+'/#/guests/sheet');await page.getByRole('button',{name:'Austin (Owner)',exact:true}).click();
  await page.goto(url+'/#/guests/sheet');await page.getByLabel('Service Date',{exact:true}).waitFor();
  const seed=await page.evaluate(async()=>{
    const {db,persistDemoDb}=await import('/src/lib/demoBackend.ts');const {TODAY,TOMORROW}=await import('/src/lib/demoSeed.ts');
    const {isDemoMode}=await import('/src/lib/supabase.ts');if(!isDemoMode)throw Error('Sample only');
    for(const key of ['bookings','tourists','trip_bookings','trip_passengers','boat_assignments','pickup_groups','booking_accounts','booking_payments'])db[key]=[];
    db.boats=db.boats.slice(0,2).map((b,i)=>({...b,code:i?'Boat 2':'Big Boat 1',capacity_pax:i?20:43,status:'active'}));
    db.transport_vehicles[0].capacity_pax=20;persistDemoDb();return {today:TODAY,tomorrow:TOMORROW,van:db.transport_vehicles[0].code};
  });
  await page.reload();await page.getByLabel('Service Date',{exact:true}).fill(seed.today);
  for(const label of ['Later','Hide pax reminder']){const b=page.getByRole('button',{name:label,exact:true});if(await b.isVisible())await b.click();}
  await page.getByRole('textbox',{name:'Time Row 1',exact:true}).waitFor();
  assert(await page.getByRole('tab',{name:'Spreadsheet',exact:true}).getAttribute('aria-selected')==='true','Spreadsheet is the visible default');
  const unit=await page.evaluate(async()=>{const g=await import('/src/lib/bookingGrid.ts');return {times:['0645HRS','6:45PM','12:00AM','12:00PM','TBA'].map(g.gridTime),quoted:g.parseGridPaste('"Hello\nWorld"\t4\nSecond\t2'),date:g.gridDate('4-Aug','2026-09-09')};});
  assert.deepEqual(unit.times,['06:45','18:45','00:00','12:00',null]);assert.equal(unit.quoted[0][0],'Hello\nWorld');assert.equal(unit.date,'2026-08-04');
  const lines=[
    ['0645HRS','Wong Family','012 345 6789',6,1,1,1,1,'Marina Suites','Lovely Paradise Day Trip','Marina Suites','Guide Mei','','Driver Kumar','',seed.van,'Big Boat 1','Captain Ali','Jamil (Crew)','Meet at main lobby','Sample Referral','4-Aug',500,'11-Aug',964,'','IV-SAMPLE-001','Two dated receipts',1464,'NCA'],
    ['0700HRS','Tan Family','WeChat: sample-family',4,1,1,0,0,'Hotel Marina Bay','Lovely Paradise Day Trip','Hotel Marina Bay','','','Driver Kumar','',seed.van,'Big Boat 1','Captain Ali','Jamil (Crew)','1 vegetarian meal','','','','','','','','','','NCA'],
  ];
  await paste('Time Row 1',lines.map(x=>x.join('\t')).join('\n'));
  await page.getByRole('button',{name:'Save 2 Rows',exact:true}).waitFor();await capture('booking-sheet-unsaved',[1440]);
  await page.reload();await page.getByRole('textbox',{name:'Guest Name Row 1',exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'Guest Name Row 1',exact:true}).inputValue(),'Wong Family','Unsaved rows survive refresh');
  await page.getByRole('button',{name:'Save 2 Rows',exact:true}).click();await saved();
  let sheet=await rpc('read_daily_booking_sheet',{p_date:seed.today});assert.equal(sheet.bookings.length,2);assert.equal(sheet.bookings.find(b=>b.lead_name==='Wong Family').pax_total,10);assert.equal(sheet.boats.length,1);assert.equal(sheet.runs.length,1);
  const account=await rpc('read_booking_accounts',{p_date:seed.today});assert.deepEqual(account.payments.map(p=>p.amount).sort((a,b)=>a-b),[500,964]);
  await capture('booking-spreadsheet',[320,390,768,1440]);
  await page.getByRole('group',{name:'Visible Columns',exact:true}).getByRole('button',{name:'Assignments',exact:true}).click();await capture('spreadsheet-assignments',[390,1440]);
  await page.getByRole('group',{name:'Visible Columns',exact:true}).getByRole('button',{name:'Payments',exact:true}).click();await capture('spreadsheet-payments',[390,1440]);
  await page.getByRole('group',{name:'Visible Columns',exact:true}).getByRole('button',{name:'Full Template',exact:true}).click();
  await page.getByRole('textbox',{name:'Guest Name Row 1',exact:true}).fill('Locally Edited Family');
  const original=sheet.bookings[0];await rpc('save_daily_booking',{p_date:seed.today,p_booking_id:original.id,p_expected_updated_at:original.updated_at,p_changes:{lead_name:'Updated On Another Device'},p_request_id:crypto.randomUUID()});
  await page.getByRole('button',{name:'Save 1 Row',exact:true}).click();await page.getByRole('alert').filter({hasText:/another device/i}).waitFor();assert.equal(await page.getByRole('textbox',{name:'Guest Name Row 1',exact:true}).inputValue(),'Locally Edited Family');
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Discard Changes',exact:true}).click();await page.getByRole('button',{name:'Refresh Sheet',exact:true}).click();await saved();
  // Bulk paste is one transaction; fifty groups do not require fifty dialogs.
  await page.getByLabel('Service Date',{exact:true}).fill(seed.tomorrow);await page.getByRole('textbox',{name:'Time Row 1',exact:true}).waitFor();
  const fifty=Array.from({length:50},(_,i)=>['TBA',`Sample Group ${String(i+1).padStart(2,'0')}`,'',2,0,0,0,0,'Own Transport'].join('\t')).join('\n');
  await paste('Time Row 1',fifty);await page.getByRole('button',{name:'Save 50 Rows',exact:true}).click();await saved();assert.equal((await rpc('read_daily_booking_sheet',{p_date:seed.tomorrow})).bookings.length,50);
  await capture('fifty-bookings',[390,1440]);
  // Returning to boarding uses the same saved groups, without re-entry.
  await page.goto(url+'/#/boarding');await page.getByLabel('Service Date',{exact:true}).fill(seed.today);await page.locator('[data-passenger]').first().waitFor();
  const groupButton=page.getByRole('button',{name:'Check In Group Updated On Another Device',exact:true});await groupButton.waitFor();assert((await groupButton.innerText()).includes('(10)'));
  await capture('group-check-in',[320,390,768,1440]);await groupButton.click();await page.waitForFunction(()=>document.querySelector('button[aria-label="Check In Group Updated On Another Device"]')?.disabled);
  assert.equal(await page.getByRole('dialog').count(),0,'Group check-in needs one click, not a modal');assert.equal(await page.locator('[data-passenger]').count(),16,'Names stay visible after check-in');
  await capture('group-checked-in',[390,1440]);
  const pending=await page.evaluate(async()=>{const {db}=await import('/src/lib/demoBackend.ts');return db.trip_passengers.find(p=>p.boarding_status==='pending');});
  await rpc('record_staff_attendance_checked',{p_date:seed.today,p_action:'boarding',p_value:'no_show',p_expected:[{id:pending.id,assignment_id:pending.assignment_id,boarding_status:pending.boarding_status,activity_code:pending.activity_code,activity_status:pending.activity_status,returned:pending.returned}],p_request_id:crypto.randomUUID()});
  await page.getByRole('button',{name:'Refresh Attendance',exact:true}).click();await page.getByRole('button',{name:'Check In All Waiting (5)',exact:true}).click();
  await capture('check-all-confirmation',[390,768,1440]);await page.getByRole('dialog').getByRole('button',{name:'Check In 5 Guests',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
  const attendance=await page.evaluate(async()=>{const {db}=await import('/src/lib/demoBackend.ts');return db.trip_passengers.map(p=>p.boarding_status);});assert.equal(attendance.filter(s=>s==='arrived').length,15);assert.equal(attendance.filter(s=>s==='no_show').length,1);
  await page.goto(url+'/#/pos');await page.getByRole('heading',{name:'POS',exact:true}).waitFor();
  const lager=page.getByRole('button').filter({hasText:'1602 Lager'}).filter({has:page.locator('img')}).first();await lager.waitFor();await lager.click();
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('main img')).every(i=>i.complete&&i.naturalWidth>0));
  await capture('pos-selected-order',[320,390,768,1440]);
  assert(!/RMB/.test(await page.locator('main').innerText()),'POS uses RM only');
  await page.getByRole('button').filter({hasText:'Build mix'}).click();let bundle=page.getByRole('dialog');
  for(const name of ['1602 Lager','1602 Pale Ale'])for(let i=0;i<2;i++)await bundle.getByRole('button',{name:`Add ${name} to bundle`,exact:true}).click();
  await capture('pos-bundle',[390,1440]);await bundle.getByRole('button',{name:'Add bundle set to cart',exact:true}).click();await bundle.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Cash Payment',exact:true}).filter({visible:true}).first().click();await page.getByRole('dialog',{name:'Confirm Cash Payment',exact:true}).waitFor();await capture('pos-checkout',[390,1440]);
  assert((await page.getByRole('dialog').innerText()).includes('52.00'),'One single beer plus a four-beer bundle retains the correct total');
  assert.deepEqual(errors,[],'No runtime errors');assert.deepEqual(cloud,[],'No live cloud requests');
  await writeFile(path.join(out,'index.html'),`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Spreadsheet, Attendance and POS</title><style>body{font:15px system-ui;margin:20px;background:#faf8f9;color:#342832}img{max-width:100%;border:1px solid #dfd2da}section{margin-bottom:28px}</style><h1>Spreadsheet, Attendance and POS</h1><p>Isolated sample records only.</p>${shots.map(f=>`<section><h2>${f.replace('.png','').replaceAll('-',' ')}</h2><img loading="lazy" src="${f}"></section>`).join('')}`);
  console.log(`PASS spreadsheet, 50-row paste, saved groups, stale edits, group attendance, no-show protection, POS and ${shots.length} screenshots.`);
}catch(e){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});console.error((await page.locator('body').innerText()).slice(-5000));throw e;}finally{await browser.close();}
