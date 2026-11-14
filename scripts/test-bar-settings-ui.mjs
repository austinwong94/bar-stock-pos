import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdir,readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';

const out=resolve('.qa/screenshots/bar-settings');await mkdir(out,{recursive:true});
const css=(await Promise.all((await readdir('dist/assets')).filter(n=>n.endsWith('.css')).map(n=>readFile('dist/assets/'+n,'utf8')))).join('\n');
const bundle=await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',
 define:{'import.meta.env.BASE_URL':'"/"','import.meta.env.VITE_SUPABASE_URL':'"https://fixture.test"'},
 stdin:{resolveDir:resolve('.'),loader:'tsx',contents:`import React from 'react';import{createRoot}from'react-dom/client';import{LanguageProvider}from'./src/lib/language';import{ToastProvider}from'./src/components/Toast';import Settings from'./src/pages/Settings';import{defaultSettings}from'./src/lib/data';function App(){const [settings,setSettings]=React.useState(defaultSettings);return <LanguageProvider><ToastProvider><main className="bar-workspace mx-auto max-w-5xl p-3"><Settings settings={settings} onSaved={next=>{window.fixture.installed.push(structuredClone(next));setSettings(next)}}/></main></ToastProvider></LanguageProvider>};createRoot(document.getElementById('root')).render(<App/>);`},
 plugins:[{name:'settings-fixture',setup(b){
  b.onResolve({filter:/(^|\/)supabase$/},()=>({path:'backend',namespace:'settings-fixture'}));
  b.onResolve({filter:/(^|\/)access$/},()=>({path:'access',namespace:'settings-fixture'}));
  b.onResolve({filter:/(^|\/)useSharedRefresh$/},()=>({path:'refresh',namespace:'settings-fixture'}));
  b.onResolve({filter:/(^|\/)adminAccess$/},()=>({path:'admin',namespace:'settings-fixture'}));
  b.onLoad({filter:/.*/,namespace:'settings-fixture'},({path})=>({loader:'js',resolveDir:resolve('.'),contents:path==='access'?`import{useSyncExternalStore}from'react';export function useAccess(){const id=useSyncExternalStore(cb=>{window.addEventListener('fixture-auth',cb);return()=>window.removeEventListener('fixture-auth',cb)},()=>window.fixtureActor??'11111111-1111-1111-1111-111111111111');return{profile:{id},can:()=>!window.fixture.denied}};`:path==='refresh'?`export function useSharedRefresh(fn){window.fixture.refresh=fn}`:path==='admin'?`export const hasAdminAccess=()=>true;export const unlockAdminAccess=async()=>({ok:true});`:`
   const values={business_name:'Test Bar',currency_symbol:'MYR',secondary_currency_symbol:'RMB',rmb_exchange_rate:1.52,business_day_close_time:'00:00',default_carton_size:24,allow_negative_stock:false,require_qr_reference:false,require_manager_approval_for_complimentary:false,staff_names:'Test One, Test Two',receipt_footer_text:''};
   const initial=Object.entries(values).map(([key,value])=>({key,value,updated_at:'2026-11-15T00:00:00Z'}));
   window.fixture={calls:[],installed:[],readMode:null,writeMode:null,denied:false,rows:JSON.parse(sessionStorage.getItem('server-rows')??JSON.stringify(initial))};
   const persist=()=>sessionStorage.setItem('server-rows',JSON.stringify(window.fixture.rows));
   window.fixture.persist=persist;
   export const isSupabaseConfigured=true,shouldUseLocalData=false,isDemoMode=false;
   export const supabase={from(table){const q={select(){return q},in(){return q},order(){return q},range(from,to){q.start=from;q.end=to;return q},then(resolve,reject){return (async()=>{
     const f=window.fixture;let data=structuredClone(f.rows);const mode=q.start===0?f.readMode:null;if(q.start===0)f.readMode=null;
     if(mode==='hold')await new Promise(r=>f.releaseRead=r);
     if(mode==='throw')throw Error('Test network unavailable');
     if(mode==='fail')return {data:null,error:{message:'Test settings unavailable'}};
     if(mode==='missing')data=data.slice(1);if(mode==='duplicate')data=[data[0],...data.slice(0,-1)];
     if(mode==='bad')data[0].updated_at='bad';
     return {data:data.slice(q.start??0,(q.end??249)+1),error:null};
   })().then(resolve,reject)}};return q},async rpc(name,args){
     const f=window.fixture;f.calls.push({name,args:structuredClone(args)});const mode=f.writeMode;f.writeMode=null;
     if(mode==='hold')await new Promise(r=>f.releaseWrite=r);
     if(mode==='before')throw Error('Test save reply unavailable');
     if(args.p_expected_actor_id!==(window.fixtureActor??'11111111-1111-1111-1111-111111111111'))return{error:{code:'42501',message:'Account changed'}};
     const ledger=JSON.parse(sessionStorage.getItem('server-ledger')??'{}');let saved=ledger[args.p_request_id];
     if(saved&&JSON.stringify(saved.args)!==JSON.stringify(args))return{error:{code:'LP001',message:'Different original details'}};
     if(!saved){
       if(mode==='conflict'||args.p_rows.some(row=>f.rows.find(item=>item.key===row.key)?.updated_at!==args.p_versions[row.key]))return{error:{code:'40001',message:'Settings changed on another device'}};
       const stamp=new Date().toISOString();f.rows=args.p_rows.map(row=>({...row,updated_at:stamp}));persist();saved={args:structuredClone(args),result:{settings:structuredClone(f.rows)}};ledger[args.p_request_id]=saved;sessionStorage.setItem('server-ledger',JSON.stringify(ledger));
     }
     if(mode==='after')throw Error('Test save reply unavailable');return{data:mode==='badreply'?{settings:[]}:saved.result,error:null};
   }};
  `}));
 }}]});
const server=createServer((req,res)=>{if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text)}else if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css)}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script>')}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'America/New_York'});let page;
const url='http://127.0.0.1:'+server.address().port;const errors=[];
try{
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(url);
 const name=()=>page.getByRole('textbox',{name:'Business Name',exact:true});
 const save=()=>page.getByRole('button',{name:'Save Settings',exact:true});
 const check=()=>page.getByRole('button',{name:'Check Saved Settings',exact:true});
 const reload=()=>page.getByRole('button',{name:'Reload Latest',exact:true});
 await name().waitFor();await page.waitForFunction(()=>window.fixture.installed.length===1);assert.equal(await name().inputValue(),'Test Bar');assert(!await save().isEnabled());
 // Failed loads never produce success, replace entries, or claim zero/default settings.
 for(const mode of ['fail','throw','duplicate','bad']){
  await page.evaluate(mode=>window.fixture.readMode=mode,mode);await reload().click();await page.waitForFunction(()=>!document.querySelector('button')?.textContent?.includes('Loading'));
  await page.getByRole('alert').first().waitFor();assert.equal(await page.locator('[data-toast="success"]').count(),0);assert(!await save().isEnabled());assert.equal(await name().inputValue(),'Test Bar');
  await reload().click();await page.waitForFunction(()=>!document.querySelector('form [role="alert"]'));await page.locator('[data-toast="success"]').waitFor({state:'hidden'});
 }
 await page.evaluate(()=>{window.fixture.completeRows=structuredClone(window.fixture.rows);window.fixture.rows=window.fixture.rows.filter(row=>row.key!=='business_name')});await reload().click();await page.waitForFunction(()=>document.querySelector('input[aria-labelledby]')?.value==='');assert.equal(await name().inputValue(),'');assert.equal(await page.evaluate(()=>window.fixture.calls.length),0);await page.evaluate(()=>window.fixture.rows=window.fixture.completeRows);await reload().click();await page.waitForFunction(()=>document.querySelector('input[aria-labelledby]')?.value==='Test Bar');
 const staff=page.getByRole('textbox',{name:'Staff Name 1',exact:true});await staff.fill('');assert.equal(await staff.inputValue(),'');await staff.pressSequentially('Test First Last');assert.equal(await staff.inputValue(),'Test First Last');
 const newStaff=page.getByRole('textbox',{name:'New Staff Name',exact:true});await newStaff.fill('Test Added Staff');await newStaff.press('Enter');assert.equal(await page.getByRole('textbox',{name:'Staff Name 3',exact:true}).inputValue(),'Test Added Staff');assert.equal(await page.evaluate(()=>window.fixture.calls.length),0);
 await reload().click();await page.getByRole('button',{name:'Load Latest',exact:true}).click();await page.waitForFunction(()=>document.querySelector('input[aria-labelledby]')?.value==='Test Bar');
 await name().fill('Typed Unsaved Name');await reload().click();await page.getByRole('button',{name:'Keep Editing',exact:true}).click();assert.equal(await name().inputValue(),'Typed Unsaved Name');assert.equal(await page.evaluate(()=>window.fixture.calls.length),0);
 // A background read started before editing must not overwrite it.
 await page.evaluate(()=>{window.fixture.releaseRead=null;window.fixture.readMode='hold';void window.fixture.refresh();});await page.waitForFunction(()=>!!window.fixture.releaseRead);
 await name().fill('Edited During Read');await page.evaluate(()=>window.fixture.releaseRead());await page.waitForFunction(()=>window.fixture.readMode===null);assert.equal(await name().inputValue(),'Edited During Read');
 await reload().click();await page.getByRole('button',{name:'Load Latest',exact:true}).click();await page.waitForFunction(()=>document.querySelector('input[aria-labelledby]')?.value==='Test Bar');
 // Stale response order: only the latest read can install its rows.
 await page.evaluate(()=>{window.fixture.releaseRead=null;window.fixture.readMode='hold';void window.fixture.refresh();});await page.waitForFunction(()=>!!window.fixture.releaseRead);
 await page.evaluate(async()=>{window.fixture.rows[0]={...window.fixture.rows[0],value:'Latest Read'};await window.fixture.refresh();});await page.waitForFunction(()=>document.querySelector('input[aria-labelledby]')?.value==='Latest Read');assert.equal(await name().inputValue(),'Latest Read');
 await page.evaluate(()=>window.fixture.releaseRead());await page.waitForTimeout(20);assert.equal(await name().inputValue(),'Latest Read');
 for(const mode of ['before','after','badreply']){
  await name().fill('Save '+mode);await page.evaluate(mode=>window.fixture.writeMode=mode,mode);await save().click();await check().waitFor();
  const original=await page.evaluate(()=>window.fixture.calls.at(-1).args);assert(original.p_request_id&&original.p_expected_actor_id);assert.equal(await name().isEnabled(),false);assert(!await reload().isEnabled());
  await page.reload();await check().waitFor();assert.equal(await name().inputValue(),'Save '+mode);
  // A successful original save followed by another device edit must retain the latter.
  if(mode!=='before')await page.evaluate(()=>{window.fixture.rows=window.fixture.rows.map(row=>row.key==='business_name'?{...row,value:'Newer Device Edit',updated_at:'2026-12-01T00:00:00Z'}:row);window.fixture.persist();});
  await check().click();await page.getByRole('heading',{name:'Settings Save Pending',exact:true}).waitFor({state:'hidden'});assert.deepEqual(await page.evaluate(()=>window.fixture.calls.at(-1).args),original);
  assert.equal(await name().inputValue(),mode==='before'?'Save '+mode:'Newer Device Edit');assert.equal(await page.evaluate(id=>Object.keys(JSON.parse(sessionStorage.getItem('server-ledger'))).filter(key=>key===id).length,original.p_request_id),1);
 }
 // A confirmed save whose fresh read fails must remain recoverable, not show a false success.
 await name().fill('Saved But Read Failed');await page.locator('[data-toast="success"]').waitFor({state:'hidden'});
 await page.evaluate(()=>window.fixture.readMode='fail');await save().click();await check().waitFor();assert.equal(await page.locator('[data-toast="success"]').count(),0);
 for(const language of ['en','ms']){
  await page.evaluate(value=>localStorage.setItem('language',value),language);await page.reload();
  const pending=page.getByRole('button',{name:language==='en'?'Check Saved Settings':'Semak Tetapan Disimpan',exact:true});await pending.waitFor();
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const targets=await page.locator('form button:visible').evaluateAll(buttons=>buttons.map(button=>button.getBoundingClientRect().height));assert(targets.every(height=>height>=44));await page.screenshot({path:out+'/pending-'+language+'-'+width+'.png',fullPage:true});}
 }
 await page.evaluate(()=>localStorage.setItem('language','en'));await page.reload();await check().click();await page.getByRole('heading',{name:'Settings Save Pending',exact:true}).waitFor({state:'hidden'});
 await page.setViewportSize({width:390,height:844});
 // First definitive stale-version rejection preserves manual input and requires explicit reload.
 await name().fill('Do Not Discard');await page.evaluate(()=>window.fixture.writeMode='conflict');await save().click();await page.getByText('Settings changed on another device. Your entries are kept. Load the latest values before saving.',{exact:true}).waitFor();assert.equal(await name().inputValue(),'Do Not Discard');assert(!await save().isEnabled());assert.equal(await check().count(),0);
 await reload().click();await page.getByRole('button',{name:'Load Latest',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('form [role="alert"]'));
 const carton=page.getByRole('spinbutton',{name:'Default Units per Carton',exact:true});await carton.fill('');assert.equal(await carton.inputValue(),'');await carton.fill('1.5');await save().click();assert.equal(await check().count(),0);await carton.fill('24');
 // No storage means no RPC. The original visible entries remain intact.
 await name().fill('Storage Test');const count=await page.evaluate(()=>window.fixture.calls.length);
 await page.evaluate(()=>{window.originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('bar-settings-save:'))throw Error('Storage blocked');return window.originalSet.call(this,key,value)}});await save().click();await page.getByText('Storage blocked',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.fixture.calls.length),count);assert.equal(await name().inputValue(),'Storage Test');
 await page.evaluate(()=>Storage.prototype.setItem=window.originalSet);
 // Another tab can see recovery but cannot submit while the original request holds the browser lock.
 await page.evaluate(()=>{window.fixture.writeMode='hold';window.fixture.releaseWrite=null});await save().click();await page.waitForFunction(()=>!!window.fixture.releaseWrite);
 const second=await context.newPage();await second.goto(url);await second.getByRole('button',{name:'Check Saved Settings',exact:true}).click();await second.getByText('Another tab is saving settings. Wait, then check the saved settings.',{exact:true}).waitFor();assert.equal(await second.evaluate(()=>window.fixture.calls.length),0);
 await page.evaluate(()=>window.fixture.releaseWrite());await page.getByRole('heading',{name:'Settings Save Pending',exact:true}).waitFor({state:'hidden'});await second.getByRole('heading',{name:'Settings Save Pending',exact:true}).waitFor({state:'hidden'});await second.close();await name().fill('Identity Test');
 // Held writes freeze all controls. Identity switch hides the original operation and its reply.
 await page.evaluate(()=>{window.fixture.writeMode='hold';window.fixture.releaseWrite=null});await save().click();await page.waitForFunction(()=>!!window.fixture.releaseWrite);const original=await page.evaluate(()=>window.fixture.calls.at(-1).args);assert(!await name().isEnabled());
 await page.evaluate(()=>{window.fixtureActor='22222222-2222-2222-2222-222222222222';window.dispatchEvent(new Event('fixture-auth'))});await page.waitForFunction(()=>window.fixture.installed.length>0);assert.equal(await check().count(),0);
 await page.evaluate(()=>window.fixture.releaseWrite());await page.evaluate(()=>{window.fixtureActor='11111111-1111-1111-1111-111111111111';window.dispatchEvent(new Event('fixture-auth'))});await check().waitFor();await check().click();await page.getByRole('heading',{name:'Settings Save Pending',exact:true}).waitFor({state:'hidden'});assert.deepEqual(await page.evaluate(()=>window.fixture.calls.at(-1).args),original);
 await page.clock.install();await name().fill('Timed Out Settings');await page.evaluate(()=>{window.fixture.writeMode='hold';window.fixture.releaseWrite=null});await save().click();await page.waitForFunction(()=>!!window.fixture.releaseWrite);const timeoutArgs=await page.evaluate(()=>window.fixture.calls.at(-1).args);await page.clock.fastForward(20001);await check().waitFor();await page.evaluate(()=>window.fixture.releaseWrite());await check().click();await page.getByRole('heading',{name:'Settings Save Pending',exact:true}).waitFor({state:'hidden'});assert.deepEqual(await page.evaluate(()=>window.fixture.calls.at(-1).args),timeoutArgs);
 for(const language of ['en','ms']){await page.evaluate(value=>localStorage.setItem('language',value),language);await page.reload();await page.waitForFunction(()=>document.querySelector('form fieldset')?.disabled===false);for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:out+'/loaded-'+language+'-'+width+'.png',fullPage:true});}}
 await page.evaluate(()=>{localStorage.setItem('language','en');localStorage.setItem('bar-settings-save:https://fixture.test:11111111-1111-1111-1111-111111111111','{broken')});await page.reload();await page.getByText('Do not re-enter these settings. Ask the owner to check this device.',{exact:true}).waitFor();assert(!await name().isEnabled());assert(!await save().isEnabled());assert.equal(await page.evaluate(()=>localStorage.getItem('bar-settings-save:https://fixture.test:11111111-1111-1111-1111-111111111111')),'{broken');
 assert.deepEqual(errors,[]);console.log('PASS Settings browser contract: read failure truth, complete snapshots, explicit discard, stale/overlapping reads, before/after-commit exact recovery, malformed reply, newer-device edit retained, failed post-save refresh, blank numeric entry, storage failure, identity isolation, timeout recovery, corrupt draft and EN/MS 320/390/768/1440 unlocked screens. No hosted writes.');
}catch(error){console.error(error);if(page)await page.screenshot({path:out+'/first-failure.png',fullPage:true,timeout:5000}).catch(()=>{});throw error;}
finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
