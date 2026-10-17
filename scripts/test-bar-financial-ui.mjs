import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,readdir,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve('.'),out=resolve('.qa/screenshots/platform-audit');await mkdir(out,{recursive:true});
const owner='11111111-1111-1111-1111-111111111111';
const css=(await readdir('dist/assets')).filter(n=>n.endsWith('.css'));
const style=(await Promise.all(css.map(n=>readFile('dist/assets/'+n,'utf8')))).join('\n');
const bundled=await build({loader:{'.svg':'dataurl'},define:{'import.meta.env.BASE_URL':'"/"','import.meta.env.VITE_SUPABASE_URL':'"https://fixture.test"'},stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';import {LanguageProvider} from './src/lib/language';import {ToastProvider} from './src/components/Toast';import Closing from './src/pages/DailyClosing';import POS from './src/pages/POS';import StockIn from './src/pages/StockIn';import Reports from './src/pages/DailyReport';import {defaultSettings} from './src/lib/data';
 import Products from './src/pages/Products';function App(){const screen=new URLSearchParams(location.search).get('screen')??'closing';return <MemoryRouter><LanguageProvider><ToastProvider><main className="bar-workspace mx-auto max-w-5xl p-3">{screen==='admin'?<Products settings={defaultSettings} onSettingsSaved={()=>{}}/>:screen==='pos'?<POS settings={defaultSettings}/>:screen==='stock'?<StockIn settings={defaultSettings}/>:screen==='reports'?<Reports settings={defaultSettings}/>:<Closing settings={defaultSettings}/>}</main></ToastProvider></LanguageProvider></MemoryRouter>};createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',plugins:[{name:'financial-contract-fixtures',setup(b){
 b.onResolve({filter:/(^|\/)supabase$/},()=>({path:'backend',namespace:'financial-fixture'}));
 b.onResolve({filter:/(^|\/)access$/},()=>({path:'access',namespace:'financial-fixture'}));
 b.onResolve({filter:/(^|\/)useSharedRefresh$/},()=>({path:'refresh',namespace:'financial-fixture'}));
 b.onLoad({filter:/.*/,namespace:'financial-fixture'},({path})=>({loader:'js',contents:path==='access'?`export const useAccess=()=>({profile:{id:'${owner}',full_name:'Audit Manager'},can:()=>true,canAny:()=>true});`:path==='refresh'?'export function useSharedRefresh(){}':`
 const product={id:'22222222-2222-4222-8222-222222222222',name:'Audit Lager',category_id:'beer',active:true,price_per_unit:12,carton_size:24,low_stock_threshold:2,categories:{id:'beer',name:'Beer'},inventory_balances:{quantity_on_hand:20}};
 window.fixture={failRead:new URLSearchParams(location.search).get('fail')==='read',failAdminRead:new URLSearchParams(location.search).get('fail')==='admin',lostClose:new URLSearchParams(location.search).get('fail')==='close',lostDraft:true,priceChange:true,calls:[],close:null};
 export const isSupabaseConfigured=true,isDemoMode=false,hasSupabaseCredentials=true,shouldUseLocalData=false;
 export const supabase={from(table){const query={select(){return query},eq(){return query},in(){return query},order(){return query},limit(){return query},upsert(){window.fixture.calls.push({name:'upsert:'+table});return query},range(from,to){query.from=from;query.to=to;return query},then(resolve){if(table==='categories'&&window.fixture.failAdminRead)return Promise.resolve({data:null,error:{message:'Category records could not be loaded.',code:'57014'}}).then(resolve);const rows=table==='products'?[product]:table==='categories'?[{id:'beer',name:'Beer',sort_order:1}]:[];return Promise.resolve({data:rows.slice(query.from??0,(query.to??999)+1),error:null}).then(resolve)}};return query;},async rpc(name,args={}){
   const f=window.fixture;f.calls.push({name,args:structuredClone(args)});
   if(name==='read_bar_closing'){
     if(f.failRead)return {data:null,error:{message:'Sales could not be loaded. Retry before closing.',code:'57014'}};
     const sale={id:'sale',sale_number:'AUDIT-1',business_date:args.p_business_date,created_at:new Date().toISOString(),status:'completed',payment_method:'cash',paid_amount:24,total_amount:24,discount_amount:0,sale_items:[{id:'line',quantity:2,line_total:24,unit_price:12,products:{name:'Audit Lager'}}]};
     return {data:{business_date:args.p_business_date,sales:[sale],cash_session:{opening_float:100},report:f.close,version:'fixture-snapshot'},error:null};
   }
   if(name==='close_daily_report_checked'){
     f.close={id:'fixture-close',business_date:args.p_business_date,status:'closed',report_json:{number_of_transactions:1},total_cash:24,total_qr:0,total_sales:24,total_complimentary_value:0,expected_cash:124,actual_cash_counted:args.p_actual_cash_counted,cash_variance:args.p_actual_cash_counted-124};
     if(f.lostClose){f.lostClose=false;return {data:null,error:{message:'Reply lost after save',code:'57014'}};}
     return {data:f.close,error:null};
   }
   if(name==='read_bar_reporting_source')return {data:null,error:{message:'Report source is unavailable. Retry before exporting.',code:'57014'}};
   if(name==='create_stock_in_draft_checked'){
     const draft={id:args.p_request_id,draft_number:'AUDIT-DRAFT',status:'draft',entries:args.p_entries,entered_by:args.p_entered_by,total_units:args.p_entries.reduce((sum,row)=>sum+row.cans,0),created_at:new Date().toISOString()};
     if(f.lostDraft){f.lostDraft=false;return {data:null,error:{message:'Draft reply lost after save',code:'57014'}};}
     return {data:draft,error:null};
   }
   if(name==='complete_sale_with_qr_type'){
     if(f.priceChange){f.priceChange=false;product.price_per_unit=18;return {data:null,error:{code:'40001',message:'A product price changed. Refresh and review the order again.'}};}
     return {data:{sale_id:'paid',sale_number:'AUDIT-PAID',total_amount:18,status:'completed'},error:null};
   }
   return {data:[],error:null};
 }};` }));
}}]});
const html='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+style+'</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>';
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/fixture.js'?'text/javascript':'text/html');res.end(req.url==='/fixture.js'?bundled.outputFiles[0].text:html);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true});
let page;
try{
 page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Asia/Kuala_Lumpur'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/?fail=read');await page.getByRole('alert').filter({hasText:'Sales could not'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Close Daily Report',exact:true}).isVisible(),false);
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:out+'/closing-error-'+width+'.png'});}
 await page.evaluate(()=>window.fixture.failRead=false);await page.getByRole('button',{name:'Retry',exact:true}).click();
 await page.getByLabel('Actual cash counted',{exact:true}).fill('124');
 await page.getByLabel('Notes',{exact:true}).fill('Count for this day only');
 const originalDay=await page.getByLabel('Business date',{exact:true}).inputValue();
 const otherDay=originalDay==='2026-10-13'?'2026-10-12':'2026-10-13';
 await page.getByLabel('Business date',{exact:true}).fill(otherDay);
 await page.waitForFunction(()=>document.querySelector('input[type=number]').value==='');
 assert.equal(await page.getByLabel('Actual cash counted',{exact:true}).inputValue(),'','A new closing date requires a fresh count');assert.equal(await page.getByLabel('Notes',{exact:true}).inputValue(),'');
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:844});assert.equal(await page.getByLabel('Actual cash counted',{exact:true}).inputValue(),'');assert.equal(await page.getByLabel('Notes',{exact:true}).inputValue(),'');await page.screenshot({path:out+'/closing-fresh-date-'+width+'.png'});}await page.setViewportSize({width:390,height:844});
 await page.getByLabel('Business date',{exact:true}).fill(originalDay);assert.equal(await page.getByLabel('Actual cash counted',{exact:true}).inputValue(),'');await page.getByLabel('Actual cash counted',{exact:true}).fill('124');
 const drawer=page.locator('div').filter({has:page.getByText('Expected Cash in Drawer',{exact:true})}).last();assert.match(await drawer.innerText(),/124\.00/);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/closing-reviewed-390.png'});
 await page.evaluate(()=>window.fixture.lostClose=true);await page.getByRole('button',{name:'Close Daily Report',exact:true}).click();
 await page.getByRole('dialog').getByRole('checkbox').check();await page.getByRole('button',{name:'Yes, close report',exact:true}).click();
 await page.getByRole('button',{name:'Check Closing',exact:true}).waitFor();
 const original=await page.evaluate(()=>window.fixture.calls.find(c=>c.name==='close_daily_report_checked').args);
 await page.reload();await page.getByRole('button',{name:'Check Closing',exact:true}).waitFor();
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:out+'/closing-recovery-'+width+'.png'});}
 await page.getByRole('button',{name:'Check Closing',exact:true}).click();await page.getByRole('button',{name:'Check Closing',exact:true}).waitFor({state:'hidden'});
 assert.deepEqual(await page.evaluate(()=>window.fixture.calls.find(c=>c.name==='close_daily_report_checked').args),original,'Reload retries the exact closing');
 await page.goto(base+'/?screen=reports');await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:/Download|Export/}).count(),0);
 await page.goto(base+'/?screen=pos');await page.getByRole('button',{name:/Audit Lager.*1 beer/}).click();
 await page.getByRole('button',{name:'Cash Payment',exact:true}).last().click();await page.getByRole('button',{name:'Confirm Cash Payment',exact:true}).click();
 await page.getByText(/Payment not completed\. A product price changed/).waitFor();
 await page.waitForFunction(()=>window.fixture.calls.some(c=>c.name==='complete_sale_with_qr_type'));
 await page.getByRole('button',{name:/Audit Lager.*18/}).waitFor();
 assert.equal(await page.evaluate(()=>window.fixture.calls.find(c=>c.name==='complete_sale_with_qr_type').args.p_items[0].expected_unit_price),12);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/pos-price-recheck-390.png'});
 await page.goto(base+'/?screen=stock');
 const stockQty=()=>page.getByLabel('Audit Lager - Quantity',{exact:true}).filter({visible:true});
 const stockCost=()=>page.locator('input[data-bar-stock-field=cost]').filter({visible:true});
 for(const bad of ['1.5','-2','1e2']){await stockQty().fill(bad);assert.equal(await stockQty().inputValue(),bad);await page.getByRole('button',{name:'Check 1 Item',exact:true}).click();assert.equal(await page.evaluate(()=>window.fixture.calls.filter(c=>c.name==='create_stock_in_draft_checked').length),0);assert(await stockQty().evaluate(el=>el===document.activeElement));}
 await stockQty().fill('3');for(const bad of ['-1','12.345']){await stockCost().fill(bad);await page.getByRole('button',{name:'Check 1 Item',exact:true}).click();assert.equal(await stockCost().inputValue(),bad);assert(await stockCost().evaluate(el=>el===document.activeElement));assert.equal(await page.evaluate(()=>window.fixture.calls.filter(c=>c.name==='create_stock_in_draft_checked').length),0);}await stockCost().fill('');
 await page.getByRole('button',{name:'Cartons (24)',exact:true}).filter({visible:true}).click();assert.equal(await stockQty().inputValue(),'');await stockQty().fill('3');await page.getByRole('button',{name:'Units',exact:true}).filter({visible:true}).first().click();assert.equal(await stockQty().inputValue(),'');await stockQty().fill('3');
 await page.getByRole('button',{name:'Save & Review',exact:true}).click();
 await page.getByRole('button',{name:'Check Saved Draft',exact:true}).waitFor();
 const originalDraft=await page.evaluate(()=>window.fixture.calls.find(c=>c.name==='create_stock_in_draft_checked').args);
 await page.reload();await page.getByRole('button',{name:'Check Saved Draft',exact:true}).waitFor();
 await page.screenshot({path:out+'/stock-draft-recovery-390.png'});
 await page.evaluate(()=>window.fixture.lostDraft=false);await page.getByRole('button',{name:'Check Saved Draft',exact:true}).click();
 await page.getByRole('dialog',{name:'Final Confirmation',exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>window.fixture.calls.find(c=>c.name==='create_stock_in_draft_checked').args),originalDraft,'Stock-in uses the original request after reload');
 assert.equal(await page.evaluate(()=>window.fixture.calls.filter(c=>c.name==='confirm_stock_in_draft').length),0,'Draft recovery does not confirm stock');
 await page.screenshot({path:out+'/stock-draft-review-390.png'});
 await page.evaluate(()=>sessionStorage.setItem('lovely_paradise_admin_access',JSON.stringify({expiresAt:new Date(Date.now()+60000).toISOString()})));
 await page.goto(base+'/?screen=admin&fail=admin');await page.getByRole('alert').filter({hasText:'Category records'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Add Product',exact:true}).count(),0,'Admin does not edit failed reads');
 assert.equal(await page.evaluate(()=>window.fixture.calls.filter(c=>c.name==='upsert:categories').length),0,'Failed category reads never create categories');
 await page.evaluate(()=>window.fixture.failAdminRead=false);await page.getByRole('button',{name:'Retry',exact:true}).click();
 await page.getByRole('button',{name:'Add Product',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.fixture.calls.filter(c=>c.name==='upsert:categories').length),0,'Reading Admin does not recreate removed categories');
 await page.screenshot({path:out+'/admin-reviewed-390.png'});
 assert.deepEqual(errors,[]);
 console.log('PASS local UI contract: failed reads hide financial totals/actions, opening float, reviewed closing, lost reply/reload keeps original request, failed reports cannot export, stale-price rejection and refreshed order; 320/390/768/1440 screenshots. Transport/Auth are fixtures; database behavior has a separate native gate.');
}catch(e){if(page){await page.screenshot({path:out+'/first-failure.png'});console.error((await page.locator('body').innerText()).slice(-2500));}console.error(e.message);throw e;}finally{await browser.close();await new Promise(r=>server.close(r));}
