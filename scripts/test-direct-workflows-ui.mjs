import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const url=process.env.UI_TEST_URL||'http://127.0.0.1:5175';
assert.equal(new URL(url).hostname,'127.0.0.1');
const out=path.resolve('.qa/screenshots/direct-workflows');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1200,height:900}}),page=await context.newPage();
page.setDefaultTimeout(12000);
const errors=[],cloud=[],shots=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/supabase\.(co|in)/.test(r.url()))cloud.push(r.url());});
const button=name=>page.getByRole('button',{name,exact:true});
const cell=(label,row=1)=>page.getByLabel(`${label} Row ${row}`,{exact:true});
async function dismiss(){for(const label of ['Later','Hide pax reminder'])if(await button(label).isVisible())await button(label).click();}
async function capture(name,width){
  await page.setViewportSize({width,height:width<768?844:1000});await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(80);
  const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert(overflow.scroll<=overflow.width+1,`${name} overflows at ${width}: ${JSON.stringify(overflow)}`);
  const file=`${name}-${width}.png`;await page.screenshot({path:path.join(out,file)});shots.push(file);
}
try {
  await page.goto(url);assert(await page.evaluate(async()=>(await import('/src/lib/supabase.ts')).isDemoMode));
  await button('Austin (Owner)').click();await page.locator('main').waitFor();await dismiss();
  await page.goto(url+'/#/guests/sheet');await cell('Time').waitFor();await dismiss();
  for(const width of [1024,1200,1440]){await page.setViewportSize({width,height:1000});assert(await page.locator('#desktop-sidebar').isVisible(),'Sidebar defaults open on laptops');}
  await button('Hide Sidebar').click();await page.reload();await cell('Time').waitFor();assert(!await page.locator('#desktop-sidebar').isVisible());
  await page.setViewportSize({width:768,height:1000});await button('Show Sidebar').click();assert(await page.locator('#desktop-sidebar').isVisible(),'Tablet can pin sidebar');
  await page.goto(url+'/#/maintenance');await page.getByRole('heading',{level:1}).waitFor();assert(await page.locator('#desktop-sidebar').isVisible(),'Pinned sidebar survives navigation');
  await page.reload();await page.locator('main').waitFor();await page.locator('#desktop-sidebar').waitFor({state:'visible'});
  await capture('maintenance-sidebar-open',768);
  await button('Hide Sidebar').click();await page.goto(url+'/#/guests/sheet');await cell('Time').waitFor();
  const tabs=page.getByRole('group',{name:'Visible Columns',exact:true});assert.equal(await tabs.getByRole('button').count(),4);assert.equal(await tabs.locator('select').count(),0);
  await cell('Guest Name').fill('Unsaved Sample Family');
  for(const name of ['Bookings','Assignments','Payments','Full Template']){await tabs.getByRole('button',{name,exact:true}).click();assert.equal(await cell('Guest Name').inputValue(),'Unsaved Sample Family');assert.equal(await tabs.getByRole('button',{name,exact:true}).getAttribute('aria-pressed'),'true');}
  const planned=await page.evaluate(async()=>{
    const {supabase}=await import('/src/lib/supabase.ts');const {todayIso}=await import('/src/lib/opsData.ts');
    const {data:s}=await supabase.rpc('read_daily_booking_sheet',{p_date:todayIso()});const boat=s.boats.find(b=>b.captain_employee_id);
    const blank=[...document.querySelectorAll('input[aria-label^="Guest Name Row"]')].find(el=>!el.value);
    return {row:Number(blank.dataset.row)+1,code:boat.code,captain:s.employees.find(e=>e.id===boat.captain_employee_id).full_name};
  });
  const copied=['TBA','Sample Imported Family','',2,0,0,0,0,'Own Transport','','','','','','','',planned.code,'',''].join('\t');
  await cell('Time',planned.row).evaluate((el,text)=>{const data=new DataTransfer();data.setData('text/plain',text);el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},copied);
  assert.equal(await cell('Boat Captain',planned.row).inputValue(),planned.captain,'Blank staff cells in a new pasted booking retain planned staff');
  for(const width of [320,390,768,1200,1440])await capture('sheet-direct-views',width);
  await button('Show Sidebar').click();await capture('sheet-sidebar-open',1200);
  page.once('dialog',d=>d.accept());await button('Discard Changes').click();await cell('Guest Name').waitFor();
  // Reuse planned resources without guessing between conflicting names or staff.
  const auto=await page.evaluate(async()=>{
    const {patchGridCell,blankGridRow}=await import('/src/lib/bookingGrid.ts');
    const sheet={available_boats:[{id:'b1',code:'Boat A'},{id:'b2',code:'Boat B'}],vehicles:[{id:'v1',code:'Van A'}],
      boats:[{boat_id:'b1',captain_employee_id:'c1',crew_employee_ids:['c2']}],runs:[{vehicle_id:'v1',driver_employee_id:'d1'}],
      employees:[{id:'c1',full_name:'Captain One',job_type:'captain'},{id:'c2',full_name:'Crew One',job_type:'crew'},{id:'d1',full_name:'Driver One',job_type:'driver',phone:'0123456789'}]};
    const rows=[blankGridRow(),blankGridRow()];
    patchGridCell(sheet,rows,0,'boat','Boat A');patchGridCell(sheet,rows,0,'vehicle','Van A');
    const first={...rows[0].values};patchGridCell(sheet,rows,1,'boat','Boat A');
    patchGridCell(sheet,rows,1,'captain','Changed Captain');const shared=rows[0].values.captain;
    patchGridCell(sheet,rows,0,'boat','Boat B');const changedBoat={...rows[0].values};
    patchGridCell(sheet,rows,1,'vehicle','Van A');patchGridCell(sheet,rows,1,'vehicle','');
    const cleared={...rows[1].values};
    sheet.employees.push({id:'duplicate',full_name:'Driver One',job_type:'driver',phone:'999'});
    patchGridCell(sheet,rows,1,'driver','Driver One');
    return {first,shared,changedBoat,cleared,duplicatePhone:rows[1].values.driver_phone};
  });
  assert.equal(auto.first.captain,'Captain One');assert.equal(auto.first.crew,'Crew One');assert.equal(auto.first.driver,'Driver One');assert.equal(auto.first.driver_phone,'0123456789');
  assert.equal(auto.shared,'Changed Captain');assert.equal(auto.changedBoat.captain,'');assert.equal(auto.changedBoat.crew,'');assert.equal(auto.cleared.driver,'');assert.equal(auto.cleared.driver_phone,'');assert.equal(auto.duplicatePhone,'');
  await page.getByLabel('Service Date',{exact:true}).fill('2026-10-14');await cell('Time').waitFor();
  for(const route of ['/guests/pickup','/fleet','/boarding','/activities','/guests/meal-needs','/guests','/guests/sheet']){
    await page.goto(url+'/#'+route);await page.locator('main input[type=date]').first().waitFor();assert.equal(await page.locator('main input[type=date]').first().inputValue(),'2026-10-14',route+' reuses the planning date');
  }
  const today=await page.evaluate(async()=>(await import('/src/lib/opsData.ts')).todayIso());await page.getByLabel('Service Date',{exact:true}).fill(today);
  await page.goto(url+'/#/boarding');await page.locator('[data-passenger]').first().waitFor();
  const boats=page.getByRole('group',{name:'Boat Filter',exact:true});assert.equal(await boats.locator('select').count(),0);
  await boats.getByRole('button').nth(1).click();assert.equal(await boats.getByRole('button').nth(1).getAttribute('aria-pressed'),'true');
  await boats.getByRole('button',{name:'All Boats',exact:true}).click();
  for(const width of [320,390,768,1440])await capture('boarding-direct-boats',width);
  await page.setViewportSize({width:390,height:844});await page.getByRole('navigation',{name:'Section Navigation'}).getByRole('link',{name:'Activities',exact:true}).click();await page.getByRole('heading',{name:'Island Activities',exact:true}).waitFor();
  await capture('activities-direct-navigation',390);
  const fixture=await page.evaluate(async()=>{
    const {supabase,isDemoMode}=await import('/src/lib/supabase.ts');if(!isDemoMode)throw Error('Sample only');const {db}=await import('/src/lib/demoBackend.ts');
    const draft=await supabase.rpc('save_purchase_request',{p_request:{needed_for_date:'2026-10-14',pax_count:100,purpose:'Sample Market Run',_request_id:crypto.randomUUID()},p_items:Array.from({length:50},(_,i)=>({item_name:`Sample Ingredient ${i+1}`,quantity:i%5+2,unit:'kg'}))});if(draft.error)throw draft.error;
    const request=db.purchase_requests.find(r=>r.id===draft.data);const sent=await supabase.rpc('submit_purchase_request_checked',{p_request_id:request.id,p_expected_updated_at:request.updated_at});if(sent.error)throw sent.error;return request.request_no;
  });
  await page.goto(url+'/#/purchasing');await page.getByLabel('Search purchases').fill(fixture);await page.waitForFunction(()=>document.querySelectorAll('main button').length>0&&[...document.querySelectorAll('main button')].filter(b=>b.textContent==='Record Purchases').length===1);await button('Record Purchases').click();
  const bought=page.getByRole('textbox',{name:/^Bought:/});assert.equal(await bought.count(),50);
  await bought.nth(0).fill('9.5');await button('Use Requested Quantities').click();
  assert.equal(await bought.nth(0).inputValue(),'9.5');assert.equal(await bought.nth(1).inputValue(),'3');assert.equal(await bought.nth(49).inputValue(),'6');assert(await button('Use Requested Quantities').isDisabled());
  for(const width of [390,768,1440])await capture('purchasing-fifty-quantities',width);
  await button('Review (50)').click();assert(await button('Confirm Purchase').isDisabled(),'Filling quantities does not confirm purchase');
  await capture('purchase-confirmation-required',390);
  await button('Close').click();await button('Discard').click();
  // All main departments: check phone, tablet and desktop page containment.
  const routes=['/','/ops','/ops/summary','/ops/outbox','/guests/sheet','/guests','/guests/meal-needs','/guests/pickup','/fleet','/boarding','/activities','/kitchen','/kitchen/stock','/kitchen/preparation','/purchasing','/maintenance','/items','/bar','/pos','/stock-out-report','/daily-closing','/daily-report','/products','/admin/access','/admin/boats','/admin/vehicles','/admin/directory','/admin/settings'];
  for(const route of routes){await page.goto(url+'/#'+route);await page.locator('main').waitFor();await page.waitForTimeout(300);await dismiss();for(const width of [390,768,1440])await capture('audit-'+(route.slice(1).replaceAll('/','-')||'home'),width);}
  assert.deepEqual(errors,[]);assert.deepEqual(cloud,[]);
  await writeFile(path.join(out,'index.html'),`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Direct Workflows Review</title><style>body{font:15px system-ui;margin:20px;background:#faf8f9;color:#342832}img{max-width:100%;border:1px solid #dfd2da}section{margin:28px 0}</style><h1>Direct Workflows Review</h1><p>Isolated sample records. Phone, tablet and desktop.</p>${shots.map(f=>`<section><h2>${f.replace('.png','').replaceAll('-',' ')}</h2><img loading="lazy" src="${f}"></section>`).join('')}`);
  console.log(`PASS direct sheet views, optional persistent sidebar, resource autofill, shared service date, boat filters, 50-item quantity fill, confirmation protection, ${routes.length} routes and ${shots.length} screenshots. No cloud requests.`);
}catch(e){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});console.error((await page.locator('body').innerText()).slice(-4500));throw e;}finally{await browser.close();}
