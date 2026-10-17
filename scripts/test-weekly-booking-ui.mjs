import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const url=process.env.UI_TEST_URL||'http://127.0.0.1:5175';assert.equal(new URL(url).hostname,'127.0.0.1');
const out=path.resolve('.qa/screenshots/weekly-booking');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(15000);
const errors=[],cloud=[],shots=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/supabase\.(co|in)/.test(r.url()))cloud.push(r.url());});
const button=name=>page.getByRole('button',{name,exact:true});
const cell=(label,row=1,date='')=>page.getByLabel(`${label} Row ${row}${date?' '+date:''}`,{exact:true});
const range=(locator,value)=>locator.evaluate((el,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},String(value));
const rpc=(name,args)=>page.evaluate(async({name,args})=>{const {supabase,isDemoMode}=await import('/src/lib/supabase.ts');if(!isDemoMode)throw Error('Sample only');const r=await supabase.rpc(name,args);if(r.error)throw Error(r.error.message);return r.data;},{name,args});
const saved=async()=>{await button('Save').waitFor();assert(await button('Save').isDisabled());};
const paste=async(locator,text)=>locator.evaluate((el,text)=>{el.focus();const data=new DataTransfer();data.setData('text/plain',text);el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},text);
async function capture(name,widths=[390,768,1440]){for(const width of widths){await page.setViewportSize({width,height:width<768?844:1000});await page.evaluate(()=>scrollTo(0,0));await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1);const file=`${name}-${width}.png`;await page.screenshot({path:path.join(out,file)});shots.push(file);}}
try{
  await page.route('**/src/lib/supabase.ts*',async route=>{const response=await route.fetch();const body=await response.text();await route.fulfill({response,body:body+'\nif(isDemoMode){const original=supabase.rpc.bind(supabase);supabase.rpc=async(name,args)=>{const result=await original(name,args);if(window.__loseWeekResponse&&name==="save_booking_sheet_range"&&!result.error){window.__loseWeekResponse=false;return {data:null,error:{message:"Failed to fetch"},status:0};}return result;};}\n'});});
  await page.goto(url+'/#/guests/sheet');await button('Austin (Owner)').click();await page.goto(url+'/#/guests/sheet');await cell('Time').waitFor();
  const seed=await page.evaluate(async()=>{const {db,persistDemoDb}=await import('/src/lib/demoBackend.ts');const {isDemoMode}=await import('/src/lib/supabase.ts');if(!isDemoMode)throw Error('Sample only');for(const key of ['bookings','tourists','trip_bookings','trip_passengers','boat_assignments','pickup_groups','booking_accounts','booking_payments'])db[key]=[];db.boats[0]={...db.boats[0],code:'Big Boat 1',capacity_pax:43,status:'active'};persistDemoDb();return {van:db.transport_vehicles[0].code};});
  await page.reload();await cell('Time').waitFor();
  for(const label of ['Later','Hide pax reminder'])if(await button(label).isVisible())await button(label).click();
  assert.equal(await page.getByRole('group',{name:'Seven Days',exact:true}).getByRole('button').count(),7);
  assert.equal(await page.locator('.booking-next-week').count(),0);
  await button('Next Seven Days').click();assert.equal(await page.getByRole('group',{name:'Seven Days',exact:true}).getByRole('button').count(),7);
  await capture('next-week-tabs',[390,1440]);
  const nextDate=page.getByRole('group',{name:'Seven Days',exact:true}).getByRole('button').nth(2);await nextDate.click();assert.equal(await nextDate.getAttribute('aria-pressed'),'true');
  const first='2026-09-14',second='2026-09-15';await page.getByLabel('Service Date',{exact:true}).fill(first);await cell('Time').waitFor();
  const line=(name,date)=>['0645HRS',name,'012 345 6789',4,1,1,0,0,'Marina Suites','Lovely Paradise Day Trip','Marina Suites','Guide Mei','','Driver Kumar','',seed.van,'Big Boat 1','Captain Ali','Jamil (Crew)','1 vegetarian meal','Sample Referral',date,100,'','','','IV-SAMPLE-'+date,'Deposit received',600,'NCA'].join('\t');
  await paste(cell('Time'),line('Wong Family','2026-09-01'));await button('Save 1 Row').waitFor();
  await page.getByLabel('Service Date',{exact:true}).fill(second);await cell('Time').waitFor();await paste(cell('Time'),line('Tan Family','2026-09-02'));await button('Save 1 Row').waitFor();
  await button('Weekly').click();await cell('Guest Name',1,first).waitFor();await cell('Time',1,'2026-09-20').waitFor();
  assert.equal(await cell('Guest Name',1,first).inputValue(),'Wong Family');assert.equal(await cell('Guest Name',1,second).inputValue(),'Tan Family');assert.equal(await page.locator('tbody[data-sheet-date]').count(),7);
  await button('Save 2 Rows').waitFor();
  // A lost success response must retain the exact multi-day request across reloads.
  await page.evaluate(()=>window.__loseWeekResponse=true);
  await button('Save 2 Rows').click();await button('Check Last Save').waitFor();assert(await page.getByLabel('Service Date',{exact:true}).isDisabled());assert(await cell('Guest Name',1,first).isDisabled());
  await page.reload();await button('Check Last Save').waitFor();await button('Check Last Save').click();await saved();
  for(const d of [first,second]){const s=await rpc('read_daily_booking_sheet',{p_date:d});assert.equal(s.bookings.length,1);assert.equal(s.boats.length,1);assert.equal(s.runs.length,1);const a=await rpc('read_booking_accounts',{p_date:d});assert.equal(a.payments.length,1);assert.equal(a.payments[0].amount,100);assert.equal(a.payments[0].payment_date,d===first?'2026-09-01':'2026-09-02');}
  // One date's shared crew does not change another date.
  const captainSecond=await cell('Boat Captain',1,second).inputValue();await cell('Boat Captain',1,first).fill('');assert.equal(await cell('Boat Captain',1,second).inputValue(),captainSecond);
  page.once('dialog',d=>d.accept());await button('Discard Changes').click();await saved();
  await cell('Adults',1,first).fill('100');await button('Save 1 Row').click();await page.getByRole('alert').filter({hasText:/capacity|onboard|seat/i}).waitFor();assert(!await cell('Adults',1,first).isDisabled(),'Rejected transactions remain editable');assert.equal(await button('Check Last Save').count(),0);
  page.once('dialog',d=>d.accept());await button('Discard Changes').click();await saved();
  const resize=page.getByRole('separator',{name:'Resize Guest Name',exact:true});await resize.press('ArrowRight');assert.equal(Number(await resize.getAttribute('aria-valuenow')),230);
  await range(page.getByLabel('Sheet Zoom',{exact:true}),70);await page.getByLabel('Resize Sheet Height',{exact:true}).press('ArrowUp');
  await button('Hide Sidebar').click();assert(!await page.locator('#desktop-sidebar').isVisible());
  const prefs=await page.evaluate(()=>JSON.parse(localStorage.getItem('lovely-paradise:booking-sheet-view:v1')));assert.equal(prefs.zoom,70);assert.equal(prefs.height,520);assert.equal(prefs.widths.name,230);
  await page.reload();await cell('Time',1,first).waitFor();assert.equal(await page.getByLabel('Sheet Zoom',{exact:true}).inputValue(),'70');assert(await button('Show Sidebar').isVisible());
  const startTop=await page.locator('.booking-grid-scroll').evaluate(el=>el.scrollTop);const pan=page.getByLabel('Horizontal Position');await range(pan,await pan.getAttribute('max'));assert(await page.locator('.booking-grid-scroll').evaluate(el=>el.scrollLeft>1000));assert.equal(await page.locator('.booking-grid-scroll').evaluate(el=>el.scrollTop),startTop);
  await capture('weekly-payments-right',[390,1440]);await range(pan,0);
  await capture('weekly-wide-workspace',[390,768,1024,1440]);
  await button('Expand Sheet').click();await capture('expanded-week',[390,768,1440]);await button('Exit Wide View').click();
  const other=await browser.newContext(),otherPage=await other.newPage();await otherPage.goto(url);assert.equal(await otherPage.evaluate(()=>localStorage.getItem('lovely-paradise:booking-sheet-view:v1')),null);await other.close();
  await button('Reset Sheet Sizing').click();await button('Show Sidebar').click();
  // A realistic, longer weekly sheet keeps horizontal access at the top.
  const fifty=Array.from({length:50},(_,i)=>['TBA',`Sample Group ${String(i+1).padStart(2,'0')}`,'',2,0,0,0,0,'Own Transport'].join('\t')).join('\n');
  await paste(cell('Time',2,first),fifty);await button('Save 50 Rows').click();await saved();assert.equal((await rpc('read_daily_booking_sheet',{p_date:first})).bookings.length,51);
  await capture('weekly-fifty-groups',[320,390,768,1440]);
  await page.locator('.booking-grid-scroll').evaluate(el=>el.scrollTop=el.scrollHeight);await range(pan,await pan.getAttribute('max'));assert(await page.locator('.booking-grid-scroll').evaluate(el=>el.scrollLeft>1000&&el.scrollTop>100));
  await range(pan,0);await page.locator('.booking-grid-scroll').evaluate(el=>el.scrollTop=0);
  await page.getByLabel('Service Date',{exact:true}).fill('2026-12-31');await cell('Time',1,'2027-01-03').waitFor();assert.equal(await page.locator('tbody[data-sheet-date]').first().getAttribute('data-sheet-date'),'2026-12-28');
  assert.deepEqual(errors,[]);assert.deepEqual(cloud,[]);
  await writeFile(path.join(out,'index.html'),`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Booking Sheet Improvements</title><style>body{font:15px system-ui;background:#faf8f9;color:#342832;margin:20px}img{max-width:100%;border:1px solid #dfd2da}section{margin:30px 0}</style><h1>Booking Sheet Improvements</h1><p>Isolated sample records. Desktop, tablet and phone.</p>${shots.map(f=>`<section><h2>${f.replace('.png','').replaceAll('-',' ')}</h2><img src="${f}"></section>`).join('')}`);
  console.log(`PASS 14-day tabs, weekly save, dated receipts, uncertain retry, local preferences, 50-row entry, horizontal scrolling, year boundary and ${shots.length} screenshots.`);
}catch(e){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});console.error((await page.locator('body').innerText()).slice(-4000));console.error('Captain cells',await page.locator('input[aria-label*="Captain"]').evaluateAll(els=>els.map(e=>({label:e.getAttribute('aria-label'),disabled:e.disabled,value:e.value}))));throw e;}finally{await browser.close();}
