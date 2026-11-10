import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,readdir,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

const out=resolve('.qa/screenshots/receipt-upload');await mkdir(out,{recursive:true});
let style='';for(const file of (await readdir('dist/assets')).filter(f=>f.endsWith('.css')))style+=await readFile('dist/assets/'+file,'utf8');
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const bundled=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';import {LanguageProvider} from './src/lib/language';import {ReceiptReviewEditor} from './src/pages/supply/ReceiptReview';
function Fixture(){const[open,setOpen]=React.useState(true);return <MemoryRouter><LanguageProvider><main className="mx-auto max-w-5xl p-3"><h1>Receipt Upload - QA Only</h1>{open?<ReceiptReviewEditor initial={window.receiptFixture.record} onClose={()=>{window.receiptFixture.closed++;setOpen(false);}} onSaved={()=>{window.receiptFixture.confirmed++;setOpen(false);}}/>:<button onClick={()=>setOpen(true)}>Reopen Saved Review</button>}</main></LanguageProvider></MemoryRouter>;}createRoot(document.getElementById('root')).render(<Fixture/>);`,resolveDir:resolve('.'),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',loader:{'.css':'empty'},define:{'import.meta.env.VITE_SUPABASE_URL':'"https://receipt-fixture.test"','import.meta.env.BASE_URL':'"/"'},plugins:[{name:'receipt-upload-fixture',setup(b){
  b.onResolve({filter:/(^|\/)supabase$/},()=>({path:'backend',namespace:'receipt-fixture'}));
  b.onResolve({filter:/(^|\/)access$/},()=>({path:'access',namespace:'receipt-fixture'}));
  b.onResolve({filter:/(^|\/)useSharedRefresh$/},()=>({path:'refresh',namespace:'receipt-fixture'}));
  b.onLoad({filter:/.*/,namespace:'receipt-fixture'},({path})=>({loader:'js',contents:path==='access'?`export const useAccess=()=>({profile:{id:'11111111-1111-4111-8111-111111111111'},can:()=>true});`:path==='refresh'?`export const useSharedRefresh=()=>{};`:`
export const isDemoMode=false,isSupabaseConfigured=true,hasSupabaseCredentials=true,shouldUseLocalData=false;
const owner='11111111-1111-4111-8111-111111111111';
window.receiptFixture={closed:0,confirmed:0,calls:[],uploads:[],pending:[],record:{id:'22222222-2222-4222-8222-222222222222',version:1,status:'pending',created_by:owner,created_by_name:'QA Purchaser - Fixture',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),scan_status:'idle',scan_error:null,extraction:null,model:null,result_id:null,deleted_at:null,delete_reason:null,confirmed_at:null,data:{purpose:'guest_meals',supplier:'QA Supplier - Not a Real Purchase',address:'QA Branch',tax_id:'QA-ONLY',phone:'',receipt_no:'QA-UPLOAD-ONLY',purchase_date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur'}).format(new Date()),currency:'MYR',total_cost:'30',subtotal:'30',tax:'0',discount:'0',receipt:{path:owner+'/existing-receipt.png',hash:'a'.repeat(64)},items:{path:owner+'/existing-items.png',hash:'b'.repeat(64)},lines:[{id:'33333333-3333-4333-8333-333333333333',name:'QA Only Rice',category:'Other',quantity:'2',unit:'pack',amount:'30'}],notes:'QA only - no live records',review_note:'Checked fixture details'}}};
const fixture=window.receiptFixture;
export const supabase={rpc:async(name,args)=>{fixture.calls.push({name,args:structuredClone(args)});if(name==='read_receipt_ai_settings')return {data:{enabled:false,daily_limit:0,model:'disabled',version:1}};if(['read_purchase_suppliers','read_purchase_supplier_profiles','read_expense_receipts','check_purchase_receipt_duplicates','read_receipt_review_events'].includes(name))return {data:[]};if(name==='save_receipt_review'){fixture.record={...fixture.record,data:structuredClone(args.p_data),version:fixture.record.version+1,updated_at:new Date().toISOString()};return {data:structuredClone(fixture.record)}};if(name==='read_receipt_reviews')return {data:structuredClone(fixture.record)};if(name==='confirm_receipt_review')return {data:{id:fixture.record.id}};throw Error('Unexpected fixture RPC '+name);},storage:{from(bucket){if(bucket!=='purchase-evidence')throw Error('Unexpected bucket');return {async upload(path,file,options){fixture.uploads.push({path,name:file.name,options});return new Promise(resolve=>fixture.pending.push(fail=>resolve({error:fail?{message:'QA connection interrupted. Try again.'}:null})));},async createSignedUrl(){return {data:{signedUrl:'data:image/png;base64,${png}'},error:null}}};}}};` }));
}}]});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?bundled.outputFiles[0].text:`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${style}</style><div id="root"></div><script src="/app.js"></script>`);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],remote=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:')&&!r.url().startsWith('data:'))remote.push(r.url());});
  const base='http://127.0.0.1:'+server.address().port,dialog=()=>page.getByRole('dialog');
  const receipt=()=>dialog().getByLabel('Receipt Photo: Upload Photo',{exact:true}),items=()=>dialog().getByLabel('Items Photo: Upload Photo',{exact:true});
  const file={name:'QA-UPLOAD-ONLY.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')};
  await page.goto(base);await dialog().getByRole('checkbox').check();
  await receipt().setInputFiles(file);await page.waitForFunction(()=>window.receiptFixture.pending.length===1);
  assert(await dialog().getByRole('button',{name:'Save & Close',exact:true}).isDisabled());
  assert(await dialog().getByRole('button',{name:'Confirm Receipt',exact:true}).isDisabled());
  assert(await dialog().getByRole('button',{name:'View Audit History',exact:true}).isDisabled());
  await dialog().getByRole('button',{name:'Close',exact:true}).click();await dialog().getByRole('alert').filter({hasText:'Wait for the photo upload'}).waitFor();
  await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.receiptFixture.closed),0,'Close and Escape cannot abandon an in-flight photo');
  assert(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;}),'Navigation warns while photo bytes are in flight');
  await items().setInputFiles({...file,name:'QA-ITEMS-ONLY.png',buffer:Buffer.concat([file.buffer,Buffer.from('qa items')])});await page.waitForFunction(()=>window.receiptFixture.pending.length===2);
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:844});assert(await dialog().evaluate(el=>el.scrollWidth<=el.clientWidth+1));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:out+'/uploading-en-'+width+'.png'});}
  await page.evaluate(()=>window.receiptFixture.pending.shift()(false));await page.waitForFunction(()=>window.receiptFixture.record.data.receipt.path.includes('/receipt-'));
  assert(await dialog().getByRole('button',{name:'Save & Close',exact:true}).isDisabled(),'The second photo still blocks closing');
  await page.evaluate(()=>window.receiptFixture.pending.shift()(true));await dialog().getByRole('alert').filter({hasText:'QA connection interrupted'}).waitFor();
  assert.equal(await page.evaluate(()=>window.receiptFixture.record.data.items.path.endsWith('existing-items.png')),true,'A failed replacement preserves the last saved photo');
  assert.equal(await dialog().getByLabel('Receipt Total (RM)',{exact:true}).inputValue(),'30');
  assert.equal(await dialog().getByLabel('Quantity 1',{exact:true}).inputValue(),'2');
  await items().setInputFiles({...file,name:'QA-ITEMS-RETRY.png',buffer:Buffer.concat([file.buffer,Buffer.from('qa items retry')])});await page.waitForFunction(()=>window.receiptFixture.pending.length===1);
  await page.evaluate(()=>window.receiptFixture.pending.shift()(false));await page.waitForFunction(()=>window.receiptFixture.record.data.items.path.includes('/items-'));
  assert(!(await dialog().getByRole('checkbox').isChecked()),'New evidence requires fresh human verification');
  const uploads=await page.evaluate(()=>window.receiptFixture.uploads.length);
  await items().setInputFiles(file);await dialog().getByRole('alert').filter({hasText:'Use a different photo'}).waitFor();
  assert.equal(await page.evaluate(()=>window.receiptFixture.uploads.length),uploads,'Duplicate bytes are rejected before any upload');
  await dialog().getByRole('button',{name:'Save & Close',exact:true}).click();await page.getByRole('button',{name:'Reopen Saved Review',exact:true}).click();
  assert.equal(await dialog().locator('img').count(),2);assert.equal(await page.evaluate(()=>window.receiptFixture.confirmed),0,'Upload checks never confirm a purchase');
  assert.equal(await page.evaluate(()=>window.receiptFixture.calls.filter(c=>c.name==='confirm_receipt_review').length),0);
  await page.evaluate(()=>localStorage.setItem('language','ms'));await page.reload();
  await dialog().getByLabel('Foto Resit: Muat Naik Foto',{exact:true}).setInputFiles(file);await page.waitForFunction(()=>window.receiptFixture.pending.length===1);
  for(const width of [390,768]){await page.setViewportSize({width,height:844});assert(await dialog().evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.screenshot({path:out+'/uploading-ms-'+width+'.png'});}
  await page.evaluate(()=>window.receiptFixture.pending.shift()(false));await page.waitForFunction(()=>window.receiptFixture.record.data.receipt.path.includes('/receipt-'));
  assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
  console.log('PASS local browser contract: slow simultaneous uploads block close/Escape/confirmation, navigation warning, failed replacement preserves evidence, retry saves, duplicate bytes never upload, fresh verification, unchanged manual amounts, EN/BM phone/tablet/desktop. No hosted Storage or live records used.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
