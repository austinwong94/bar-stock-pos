import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
const url=process.env.TEST_URL??'http://127.0.0.1:5177';
const output=resolve('.qa/screenshots/purchasing-finance');await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],cloud=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/supabase\.(co|in)/.test(r.url()))cloud.push(r.url());});
async function fits(label){await page.waitForTimeout(150);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+' overflows');const clipped=await page.locator('.kitchen-workflow-nav a,.finance-tabs button').evaluateAll(nodes=>nodes.filter(el=>{const range=document.createRange();range.selectNodeContents(el);const a=range.getBoundingClientRect(),b=el.getBoundingClientRect();return a.width>0&&(a.left<b.left-1||a.right>b.right+1);}).map(el=>el.textContent));assert.deepEqual(clipped,[],label+' has overlapping navigation');}
async function login(id){await page.evaluate(async id=>{const {demoSignIn}=await import('/src/lib/demoBackend.ts');demoSignIn(id);},id);await page.goto(url+'/#/');await page.reload();await page.locator('main').waitFor();}
try{
  await page.goto(url+'/#/');await page.getByRole('button',{name:'Austin (Owner)',exact:true}).click();await page.locator('main').waitFor();
  assert(page.url().endsWith('/kitchen/finance'),'Owner opens Finance');
  await page.evaluate(async()=>{
    const {db,persistDemoDb}=await import('/src/lib/demoBackend.ts');const {todayIso}=await import('/src/lib/opsData.ts');
    const today=todayIso(),yesterday=new Date(today+'T12:00:00');yesterday.setDate(yesterday.getDate()-1);
    const prior=[yesterday.getFullYear(),String(yesterday.getMonth()+1).padStart(2,'0'),String(yesterday.getDate()).padStart(2,'0')].join('-');
    db.purchase_requests=[];db.purchase_request_items=[];db.purchase_receipts=[];
    for(let i=0;i<56;i++){
      const id=crypto.randomUUID();db.purchase_requests.push({id,request_no:'PR-QA-'+String(i).padStart(2,'0'),needed_for_date:today,purpose:'Guest Meals',notes:i===0?'Deliver to kitchen before lunch':'',requested_by:'u-cook',status:'submitted',created_at:new Date().toISOString(),updated_at:new Date().toISOString()});
      db.purchase_request_items.push({id:crypto.randomUUID(),request_id:id,item_name:i===55?'Cabbage long supplier packing note':i===0?'Tomato':'Rice '+i,unit:i===0?'biji':'pack',quantity:10,purchase_status:i===0?'bought':i===1?'unavailable':'pending',purchased_quantity:i===0?4:0,actual_cost:null,sort_order:0,updated_at:new Date().toISOString()});
    }
    db.expense_receipts=[];db.purchase_payments=[];
    for(const [date,purpose,total] of [[today,'guest_meals',300],[today,'staff_meals',80],[today,'bar',120],[prior,'guest_meals',200],[prior,'staff_meals',60]])db.expense_receipts.push({id:crypto.randomUUID(),purchase_date:date,purpose,supplier:'99 Speedmart',receipt_no:'QA-'+purpose,total_cost:total,receipt_path:'',items_path:'',lines:[{name:'Rice',category:'Rice & Dry Goods',quantity:10,unit:'pack',amount:total}],notes:'',status:'confirmed',created_at:new Date().toISOString(),created_by:'u-buyer',created_by_name:'Sam'});
    db.kitchen_daily_usage=[{id:'usage-today',business_date:today,guest_meals:100,staff_meals:10,lines:[{ingredient_id:'qa-rice',name:'Rice',unit:'unit',guest_quantity:50,staff_quantity:3,unit_cost:4}],template_ids:[],revision:1},{id:'usage-prior',business_date:prior,guest_meals:50,staff_meals:10,lines:[{ingredient_id:'qa-rice',name:'Rice',unit:'unit',guest_quantity:30,staff_quantity:5,unit_cost:4}],template_ids:[],revision:1}];
    db.audit_logs=db.audit_logs.filter(x=>!['record_purchase_batch','kitchen_stock_count'].includes(x.action));
    db.audit_logs.push({id:crypto.randomUUID(),actor_id:'u-cook',action:'kitchen_stock_count',entity_id:crypto.randomUUID(),created_at:new Date().toISOString(),after_json:{items:[{name:'Rice'}]}});persistDemoDb();
  });
  await login('u-buyer');assert(page.url().endsWith('/kitchen/purchases'),'Purchaser opens buying list');
  await page.getByText('PR-QA-55',{exact:true}).waitFor();assert.equal(await page.locator('.shopping-request').count(),55,'All pages loaded; unavailable excluded');
  const first=page.locator('.shopping-request').filter({has:page.getByText('PR-QA-00',{exact:true})});assert.match(await first.innerText(),/6 biji/);assert.doesNotMatch(await first.innerText(),/Check Arrival|Not Arrived/);
  await page.getByLabel('Search Buying List',{exact:true}).fill('Cabbage');assert.equal(await page.locator('.shopping-request').count(),1);await page.getByLabel('Search Buying List',{exact:true}).fill('');
  await page.getByRole('button',{name:'Mark Unavailable: Cabbage long supplier packing note',exact:true}).click();
  await page.getByRole('button',{name:'Unavailable (2)',exact:true}).click();await page.getByRole('button',{name:'Try Buying Again: Cabbage long supplier packing note',exact:true}).click();
  await page.getByRole('button',{name:'All Needed',exact:true}).click();await page.getByText('PR-QA-55',{exact:true}).waitFor();
  await page.evaluate(async()=>{
    const {db,persistDemoDb}=await import('/src/lib/demoBackend.ts');
    db.purchase_requests=db.purchase_requests.filter(r=>['PR-QA-00','PR-QA-01','PR-QA-55'].includes(r.request_no));
    const request=db.purchase_requests.find(r=>r.request_no==='PR-QA-00');
    for(const [item_name,quantity,unit] of [['Eggs',120,'biji'],['Prawns',8,'pack'],['Squid',6,'pack'],['Rice',3,'pack'],['Cooking Oil',2,'gelen']])db.purchase_request_items.push({id:crypto.randomUUID(),request_id:request.id,item_name,quantity,unit,purchase_status:'pending',sort_order:1,updated_at:new Date().toISOString()});
    persistDemoDb();
  });
  await page.reload();await page.getByText('Cooking Oil',{exact:true}).waitFor();
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});await fits('Buying '+width);await page.screenshot({path:output+`/to-buy-${width}.png`});}
  await first.getByRole('button',{name:'Record Purchase',exact:true}).click();const dialog=page.getByRole('dialog');
  assert.equal(await dialog.getByRole('button',{name:'Guest Meals',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await dialog.getByLabel('Bought: Tomato (biji)',{exact:true}).inputValue(),'','No actual quantity is invented');
  assert.equal(await dialog.getByRole('button',{name:/Fill Shown Quantities/}).count(),0);assert.match(await dialog.innerText(),/Still To Buy 6 biji/);
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:output+'/purchase-entry-390.png'});
  await dialog.getByRole('button',{name:'Remove Pending Receipt',exact:true}).click();await dialog.getByLabel('Reason for Removal',{exact:false}).fill('QA test purchase not made');await dialog.getByRole('button',{name:'Confirm Removal',exact:true}).click();await dialog.getByRole('button',{name:'Close',exact:true}).first().click();
  await login('u-account');assert(page.url().endsWith('/kitchen/finance'),'Accountant opens Finance');
  await page.locator('.finance-comparison').waitFor();
  assert.match(await page.locator('.supply-metrics').innerText(),/500.00/);
  assert.match(await page.getByRole('row').filter({has:page.getByRole('rowheader',{name:'Cost / Guest Meal',exact:true})}).innerText(),/RM 2.00.*RM -0.40.*RM 2.40/s);
  assert.match(await page.getByRole('row').filter({has:page.getByRole('rowheader',{name:'Cost / Staff Meal',exact:true})}).innerText(),/RM 1.20.*RM -0.80.*RM 2.00/s);
  assert.match(await page.getByRole('row').filter({has:page.getByRole('rowheader',{name:'Guest Minus Staff / Meal',exact:true})}).innerText(),/RM 0.80/);
  assert.equal(await page.getByRole('button',{name:'Group Alerts',exact:true}).count(),0);
  for(const mode of ['Weekly','Monthly','Daily']){await page.getByRole('button',{name:mode,exact:true}).click();await page.locator('.finance-comparison').waitFor();}
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});await fits('Finance '+width);await page.screenshot({path:output+`/finance-${width}.png`});}
  await page.getByRole('button',{name:/Payments to Check/}).click();await page.locator('.supply-receipt-row').first().waitFor();assert.equal(await page.locator('.supply-receipt-row').count(),3);
  await page.getByRole('button',{name:'Overview',exact:true}).click();await page.getByLabel('Report Date',{exact:true}).fill('2020-01-01');await page.locator('.finance-comparison').waitFor();assert.match(await page.locator('.finance-comparison').innerText(),/Not Available/);
  await login('u-master');await page.getByRole('button',{name:'Group Alerts',exact:true}).click();await page.getByText('Preview Only · Nothing Sent',{exact:true}).waitFor();await page.getByRole('dialog').getByText('Stock check confirmed',{exact:true}).waitFor();assert.equal(await page.getByRole('dialog').getByRole('alert').count(),0);await page.setViewportSize({width:390,height:844});await page.screenshot({path:output+'/alerts-390.png'});await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  await login('u-cook');assert.equal(await page.getByRole('link',{name:'Finance',exact:true}).count(),0);await page.goto(url+'/#/kitchen/finance');await page.waitForTimeout(400);assert.equal(await page.locator('.finance-comparison').count(),0);
  await login('u-master');await page.goto(url+'/#/kitchen/purchases?view=costs');await page.waitForURL('**/#/kitchen/finance');await page.locator('.finance-comparison').waitFor();
  await page.setViewportSize({width:1440,height:900});await page.getByRole('button',{name:'BM',exact:true}).click();await page.getByRole('button',{name:'Ringkasan',exact:true}).waitFor();await page.setViewportSize({width:320,height:900});await fits('Malay Finance');await page.screenshot({path:output+'/finance-ms-320.png'});
  await page.goto(url+'/#/kitchen/purchases');await page.getByText('PR-QA-55',{exact:true}).waitFor();await fits('Malay Buying');await page.screenshot({path:output+'/to-buy-ms-320.png'});
  assert.deepEqual(errors,[]);assert.deepEqual(cloud,[]);console.log('PASS: role landing, 56-request pagination, partial/unavailable stock, search, purpose prefill, separate receiving, finance calculations and period switching, empty data, receipt drilldown, privacy, alerts preview, EN/MS 320/390/768/1440 layouts; no cloud writes.');console.log(output);
}catch(e){await page.screenshot({path:output+'/failure.png'});console.error(await page.locator('body').innerText());throw e;}finally{await browser.close();}
