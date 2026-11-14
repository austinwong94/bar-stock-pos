import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdir,readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const out=resolve('.qa/screenshots/bundle-setup');await mkdir(out,{recursive:true});
const css=(await Promise.all((await readdir('dist/assets')).filter(n=>n.endsWith('.css')).map(n=>readFile('dist/assets/'+n,'utf8')))).join('\n');
const built=await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.svg':'dataurl'},define:{'import.meta.env.BASE_URL':'"/"','import.meta.env.VITE_SUPABASE_URL':'"https://fixture.test"'},
 stdin:{resolveDir:resolve('.'),loader:'tsx',contents:`import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import{LanguageProvider}from'./src/lib/language';import{ToastProvider}from'./src/components/Toast';import Products from'./src/pages/Products';import POS from'./src/pages/POS';import{cloudSettingsFromRows}from'./src/lib/data';function App(){const [settings,setSettings]=React.useState(()=>cloudSettingsFromRows(window.fixture.rows));window.fixture.settings=settings;return <MemoryRouter><LanguageProvider><ToastProvider><main className="bar-workspace mx-auto max-w-5xl p-3">{location.search.includes('pos')?<POS settings={settings}/>:<Products settings={settings} onSettingsSaved={setSettings}/>}</main></ToastProvider></LanguageProvider></MemoryRouter>};createRoot(document.getElementById('root')).render(<App/>);`},
 plugins:[{name:'bundle-fixture',setup(b){
 b.onResolve({filter:/(^|\/)supabase$/},()=>({path:'backend',namespace:'bundle-fixture'}));b.onResolve({filter:/(^|\/)access$/},()=>({path:'access',namespace:'bundle-fixture'}));b.onResolve({filter:/(^|\/)useSharedRefresh$/},()=>({path:'refresh',namespace:'bundle-fixture'}));
 b.onLoad({filter:/.*/,namespace:'bundle-fixture'},({path})=>({loader:'js',resolveDir:resolve('.'),contents:path==='access'?`export const useAccess=()=>({profile:{id:'11111111-1111-1111-1111-111111111111',full_name:'Test Owner'},can:()=>true,canAny:()=>true});`:path==='refresh'?`export function useSharedRefresh(refresh){window.fixture.refresh=refresh;}`:`
 const stamp='2026-11-10T10:00:00Z',category={id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',name:'Beer',sort_order:1},product={id:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',name:'Test Lager',category_id:category.id,price_per_unit:12,cost_per_unit:null,carton_size:24,low_stock_threshold:0,active:true,image_url:'/assets/test-product.svg',updated_at:stamp,categories:category,inventory_balances:{quantity_on_hand:20}};
 window.fixture={rows:JSON.parse(localStorage.getItem('test-bundle-rows')??'[]'),calls:[],mode:null,hold:false};
 export const isSupabaseConfigured=true,hasSupabaseCredentials=true,shouldUseLocalData=false,isDemoMode=false;
 export const supabase={from(table){const q={select(){return q},eq(){return q},in(){return q},order(){return q},range(from,to){q.start=from;q.end=to;return q},async then(resolve){const f=window.fixture;if(table==='app_settings'&&f.readHold)await new Promise(resolve=>f.readRelease=resolve);if(table==='app_settings'&&f.readFail){f.readFail=false;return Promise.resolve({data:null,error:{code:'42501',message:'Test read interrupted'}}).then(resolve);}let rows=table==='app_settings'?f.rows:table==='products'?[product]:table==='categories'?[category]:[];if(table==='app_settings'&&f.readBad){f.readBad=false;rows=rows.map(row=>({...row,updated_at:'bad'}));}return Promise.resolve({data:rows.slice(q.start??0,(q.end??999)+1),error:null}).then(resolve)}};return q;},async rpc(name,args){
 const f=window.fixture;f.calls.push({name,args:structuredClone(args)});if(f.hold)await new Promise(resolve=>f.release=resolve);const mode=f.mode;f.mode=null;if(mode==='before')throw Error('Test network interrupted');
 const ledger=JSON.parse(localStorage.getItem('test-bundle-server')??'{}');let result=ledger[args.p_request_id];
 if(!result){if(f.rows.some(row=>args.p_versions[row.key]!==row.updated_at))return {data:null,error:{code:'40001',message:'Settings changed on another device'}};
 result={settings:args.p_rows.map(row=>({...row,updated_at:new Date().toISOString()}))};ledger[args.p_request_id]=result;localStorage.setItem('test-bundle-server',JSON.stringify(ledger));f.rows=result.settings;localStorage.setItem('test-bundle-rows',JSON.stringify(f.rows));}
 if(mode==='after')throw Error('Test network interrupted');if(mode==='read-fail')f.readFail=true;if(mode==='bad-read')f.readBad=true;return {data:mode==='badreply'?{}:result,error:null};
 }};`}));}}]});
const html='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>';
const server=createServer(async(req,res)=>{if(req.url?.startsWith('/assets/')){res.setHeader('Content-Type','image/svg+xml');res.end(await readFile('public/assets/custom-order.svg'));return;}res.setHeader('Content-Type',req.url==='/fixture.js'?'text/javascript':'text/html');res.end(req.url==='/fixture.js'?built.outputFiles[0].text:html);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true});let page;
try{
 const context=await browser.newContext({viewport:{width:390,height:844}});page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(()=>sessionStorage.setItem('lovely_paradise_admin_access',JSON.stringify({expiresAt:new Date(Date.now()+600000).toISOString()})));
 const base='http://127.0.0.1:'+server.address().port;
 const form=()=>page.getByRole('form',{name:/Beer Bundle Settings|Tetapan Set Bir/});
 const price=()=>form().getByLabel(/Price per Set \(RM\)|Harga Set \(RM\)/);
 const units=()=>form().getByLabel(/Beers per Set|Bir Setiap Set/);
 const name=()=>form().getByLabel(/Bundle Name|Nama Set/);
 const save=()=>form().getByRole('button',{name:/^Save$|^Simpan$/});
 const check=()=>form().getByRole('button',{name:/Check Saved Bundle|Semak Set Disimpan/});
 const finished=async()=>{await page.waitForFunction(()=>localStorage.getItem('bundle-save:https://fixture.test:11111111-1111-1111-1111-111111111111')===null);await save().waitFor();};
 await page.goto(base);await form().waitFor();assert.equal(await price().inputValue(),'');assert.equal(await units().inputValue(),'');await form().getByText('Not Set Up',{exact:true}).waitFor();
 await page.goto(base+'?pos');await page.getByText('Beer sets unavailable. Ask a manager to check the bundle settings.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Choose Beers',exact:true}).count(),0);
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:out+'/pos-missing-mobile.png',fullPage:true});
 await page.goto(base);await name().fill('Test Beer Set');await units().fill('4.5');await price().fill('40.555');await save().click();assert.equal(await page.evaluate(()=>window.fixture.calls.length),0);assert.equal(await units().inputValue(),'4.5');
 await units().fill('4');await save().click();assert.equal(await page.evaluate(()=>window.fixture.calls.length),0);assert.equal(await price().inputValue(),'40.555');
 await price().fill('40.50');await form().getByRole('checkbox').check();await save().click();await page.getByText('Beer bundle saved.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.fixture.calls.length),1);
 for(const language of ['en','ms']){
  await page.evaluate(value=>localStorage.setItem('language',value),language);await page.reload();await form().waitFor();
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:844});await form().scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert(await form().evaluate(el=>el.scrollWidth<=el.clientWidth+1));assert(Math.abs((await price().boundingBox()).height-(await units().boundingBox()).height)<1);await form().screenshot({path:out+'/settings-'+language+'-'+width+'.png'});}
 }
 await page.evaluate(()=>localStorage.setItem('language','en'));await page.reload();await price().fill('42');const oldVersions=await page.evaluate(()=>Object.fromEntries(window.fixture.rows.map(row=>[row.key,row.updated_at])));
 await page.evaluate(async()=>{window.fixture.rows=window.fixture.rows.map(row=>({...row,value:row.key==='beer_bundle_price'?55:row.value,updated_at:'2026-11-12T00:00:00Z'}));localStorage.setItem('test-bundle-rows',JSON.stringify(window.fixture.rows));await window.fixture.refresh();});assert.equal(await price().inputValue(),'42');await save().click();await form().getByRole('button',{name:'Load Latest',exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>window.fixture.calls.at(-1).args.p_versions),oldVersions,'Refresh cannot pair old edits with newer versions for any bundle field');assert.equal(await price().inputValue(),'42');
 await page.evaluate(()=>{window.fixture.readHold=true;window.fixture.readRelease=null;});await form().getByRole('button',{name:'Load Latest',exact:true}).click();await page.waitForFunction(()=>!!window.fixture.readRelease);await price().fill('43');await page.evaluate(()=>{window.fixture.readHold=false;window.fixture.readRelease();});await page.waitForFunction(()=>document.querySelector('input[inputmode=decimal]')?.value==='43');assert.equal(await price().inputValue(),'43','A delayed explicit reload cannot overwrite newer typing');
 await form().getByRole('button',{name:'Load Latest',exact:true}).click();await page.waitForFunction(()=>document.querySelector('input[inputmode=decimal]')?.value==='55');
 for(const mode of ['before','after','badreply','read-fail','bad-read']){
  await price().fill(String(60+['before','after','badreply','read-fail','bad-read'].indexOf(mode)));await page.evaluate(mode=>window.fixture.mode=mode,mode);await save().click();await check().waitFor();const original=await page.evaluate(()=>window.fixture.calls.at(-1).args);
  assert.equal(await price().isEnabled(),false);await page.reload();await check().waitFor();
  if(mode==='after'){
   for(const language of ['en','ms']){await page.evaluate(value=>localStorage.setItem('language',value),language);await page.reload();await check().waitFor();for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert(await form().evaluate(el=>el.scrollWidth<=el.clientWidth+1));await form().screenshot({path:out+'/pending-'+language+'-'+width+'.png'});}}
   await page.evaluate(()=>localStorage.setItem('language','en'));await page.reload();await check().waitFor();
  }
  await check().click();await finished();assert.deepEqual(await page.evaluate(()=>window.fixture.calls.at(-1).args),original);assert.equal(await page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('test-bundle-server'))).filter(k=>k===window.fixture.calls.at(-1).args.p_request_id).length),1);
 }
 await price().fill('80');await page.evaluate(()=>window.fixture.mode='after');await save().click();await check().waitFor();
 await page.evaluate(()=>{window.fixture.rows=window.fixture.rows.map(row=>({...row,value:row.key==='beer_bundle_price'?88:row.value,updated_at:'2026-11-13T00:00:00Z'}));localStorage.setItem('test-bundle-rows',JSON.stringify(window.fixture.rows));});await check().click();await finished();assert.equal(await price().inputValue(),'88','Historical recovery must install current settings rather than its cached reply');
 await price().fill('90');await page.evaluate(()=>{window.fixture.hold=true;window.fixture.release=null;});await save().click();await page.waitForFunction(()=>!!window.fixture.release);const other=await context.newPage();await other.goto(base);const otherCheck=other.getByRole('button',{name:'Check Saved Bundle',exact:true});await otherCheck.waitFor();await otherCheck.click();assert.equal(await other.evaluate(()=>window.fixture.calls.length),0,'Another tab cannot submit while the first save is in flight');await other.close();await page.evaluate(()=>{window.fixture.hold=false;window.fixture.release();});await finished();await price().waitFor({state:'visible'});
 await page.evaluate(()=>localStorage.setItem('bundle-save:https://fixture.test:11111111-1111-1111-1111-111111111111','{broken'));await page.reload();await form().getByText('Do not re-enter these bundle settings. Ask the owner to check this device.',{exact:true}).waitFor();assert.equal(await price().isEnabled(),false);assert.equal(await page.evaluate(()=>localStorage.getItem('bundle-save:https://fixture.test:11111111-1111-1111-1111-111111111111')),'{broken');assert.deepEqual(errors,[]);
 console.log('PASS local bundle UI: blank missing setup, unavailable POS bundle, raw invalid input, frozen source versions, explicit conflict reload, before/after commit and malformed/read-failure recovery, reload, historical snapshot isolation, cross-tab lock, corrupt storage, EN/MS 320/390/768/1440. Fixture data only.');
}catch(error){console.error(error);if(page)await page.screenshot({path:out+'/first-failure.png',timeout:5000}).catch(()=>{});throw error;}
finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
