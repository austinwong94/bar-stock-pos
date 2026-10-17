import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const base=process.env.UI_TEST_URL||'http://127.0.0.1:5175';
assert.equal(new URL(base).hostname,'127.0.0.1');
const out=path.resolve('.qa/screenshots/guest-privacy');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
const errors=[],requests=[],shots=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/supabase\.(co|in)/.test(r.url()))requests.push(r.url());});
const button=name=>page.getByRole('button',{name,exact:true});
async function dismiss(){for(const label of ['Later','Hide pax reminder'])if(await button(label).isVisible())await button(label).click();}
async function shot(name,width){
 await page.setViewportSize({width,height:width<768?844:1000});await page.evaluate(()=>scrollTo(0,0));
 await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1);
 await page.waitForTimeout(120);
 const file=`${name}-${width}.png`;await page.screenshot({path:path.join(out,file)});shots.push(file);
}
try{
 await page.goto(base);assert(await page.evaluate(async()=>(await import('/src/lib/supabase.ts')).isDemoMode));
 await button('Austin (Owner)').click();await page.locator('main').waitFor();await dismiss();
 await page.goto(base+'/#/guests/sheet');await page.getByLabel('Guest Name Row 1',{exact:true}).waitFor();await dismiss();
 const today=await page.getByLabel('Service Date',{exact:true}).inputValue();
 const yesterday=new Date(Date.parse(today)-86400000).toISOString().slice(0,10);
 await page.evaluate(async({today,yesterday})=>{
  const {supabase}=await import('/src/lib/supabase.ts');
  const r=await supabase.rpc('sheet_planner_access',{p_date:yesterday,p_user_id:'u-planner',p_allow:true});if(r.error)throw new Error(r.error.message);
  const old=await supabase.rpc('save_daily_booking',{p_date:yesterday,p_booking_id:null,p_expected_updated_at:null,p_request_id:crypto.randomUUID(),p_changes:{lead_name:'Sample Past Guest',lead_phone:'PRIVATE-CONTACT-TEST',counts:{adults:2,children:0,infants:0,tour_leaders:0,tour_guides:0},pickup_required:false}});if(old.error)throw new Error(old.error.message);
 },{today,yesterday});
 for(const width of [390,768,1440])await shot('compact-booking-sheet',width);
 const heights=await page.locator('.booking-grid-table tbody tr[data-grid-key]').evaluateAll(rows=>rows.map(r=>r.getBoundingClientRect().height));
 assert(heights.length>=20);assert(Math.max(...heights)<=32,`Row heights ${heights}`);
 assert.equal(await page.locator('.booking-workspace-heading h1').evaluate(e=>getComputedStyle(e).fontSize),'20px');
 assert.equal(await page.locator('.booking-grid-status').count(),0,'No repeated saved/date strip on initial view');
 await page.goto(base+'/#/admin/access');await button('Guest Privacy').click();await page.locator('.privacy-row').first().waitFor();await dismiss();
 const rule=page.locator('.privacy-row').filter({hasText:'Siti'});
 await rule.getByRole('button',{name:'Contacts only',exact:true}).click();await rule.getByRole('textbox').fill('3');
 await rule.getByRole('button',{name:/Save Privacy/}).click();await page.getByText(/Privacy saved for Siti/).waitFor();
 await page.reload();await button('Guest Privacy').click();await rule.waitFor();
 assert.equal(await rule.getByRole('textbox').inputValue(),'3','Privacy saves survive a reload');
 assert.equal(await rule.getByRole('button',{name:'Contacts only',exact:true}).getAttribute('aria-pressed'),'true');
 const planner=page.locator('.privacy-row').filter({hasText:'External Planner (Sample)'});
 assert(await planner.getByRole('checkbox').isDisabled());assert(await planner.getByRole('button',{name:'Keep history',exact:true}).isDisabled());
 const owner=page.locator('.privacy-row').first();assert(await owner.getByRole('button',{name:'Keep history',exact:true}).isDisabled());
 for(const width of [390,768,1440])await shot('admin-guest-privacy',width);
 await rule.getByRole('textbox').fill('0');await rule.getByRole('button',{name:/Save Privacy/}).click();await page.getByText('Enter 1-365 days.').waitFor();
 await rule.getByRole('textbox').fill('1');await rule.getByRole('button',{name:/Save Privacy/}).click();await page.getByText(/Privacy saved for Siti/).waitFor();
 await page.evaluate(async()=>{const {demoSignIn}=await import('/src/lib/demoBackend.ts');demoSignIn('u-coord');});
 await page.goto(base+'/#/guests/sheet');await page.reload();await page.getByLabel('Service Date',{exact:true}).fill(yesterday);
 await page.getByText('Guest contacts are private for this date.').waitFor();
 assert.equal(await page.locator('main').getByText('PRIVATE-CONTACT-TEST',{exact:true}).count(),0);
 assert.equal(await page.getByRole('tab',{name:'Accounts',exact:true}).count(),0,'Non-financial PIC has no accounts view');
 await shot('contacts-only-history',1440);
 const safe=await page.evaluate(async(yesterday)=>{
   const {supabase}=await import('/src/lib/supabase.ts');const list=await supabase.rpc('read_guest_bookings',{p_date:yesterday});const b=list.data.find(b=>b.lead_name==='Sample Past Guest');
   return {name:b.lead_name,phone:b.lead_phone,flag:b.contacts_hidden};
 },yesterday);
 assert.deepEqual(safe,{name:'Sample Past Guest',phone:null,flag:true});
 await page.evaluate(async()=>{const {demoSignIn}=await import('/src/lib/demoBackend.ts');demoSignIn('u-planner');});
 await page.goto(base+'/#/guests/sheet');await page.reload();await page.getByLabel('Service Date',{exact:true}).fill(yesterday);
 await page.getByText('Guest names and contacts are private for this date.').waitFor();
 assert.equal(await page.getByRole('tab',{name:'Accounts',exact:true}).count(),0);
 assert.equal(await page.getByText('Sample Past Guest',{exact:true}).count(),0);
 await shot('restricted-planner-history',390);await shot('restricted-planner-history',1440);
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
 await writeFile(path.join(out,'index.html'),`<!doctype html><meta name="viewport" content="width=device-width"><title>Compact Sheet & Guest Privacy</title><style>body{font:15px system-ui;margin:20px;background:#faf8f9}img{max-width:100%;border:1px solid #e8dde2}section{margin:24px 0}</style><h1>Compact Sheet & Guest Privacy</h1><p>Sample records, not live customer data.</p>${shots.map(f=>`<section><h2>${f.replace('.png','').replaceAll('-',' ')}</h2><img src="${f}" loading="lazy"></section>`).join('')}`);
 console.log(`PASS compact rows (maximum ${Math.max(...heights).toFixed(1)}px at 85% zoom), privacy save/reload, contact-only masking, restricted planner, ${shots.length} screenshots, no cloud calls.`);
}catch(e){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});console.error((await page.locator('body').innerText()).slice(-4000));throw e;}finally{await browser.close();}
