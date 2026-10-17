import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,readdir,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const out=resolve('.qa/screenshots/staff-accounts');await mkdir(out,{recursive:true});
const css=(await readdir('dist/assets')).filter(f=>f.endsWith('.css'));
let style='';for(const file of css)style+=await readFile('dist/assets/'+file,'utf8');
const bundled=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';import {LanguageProvider} from './src/lib/language';import {ToastProvider} from './src/components/Toast';import Access from './src/pages/admin/AccessControl';import {SignIn} from './src/components/SignIn';
createRoot(document.getElementById('root')).render(<MemoryRouter><LanguageProvider><ToastProvider>{location.search.includes('login')?<SignIn/>:<main className="mx-auto max-w-5xl p-3"><Access/></main>}</ToastProvider></LanguageProvider></MemoryRouter>);`,resolveDir:resolve('.'),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',loader:{'.css':'empty'},define:{'import.meta.env.VITE_SUPABASE_URL':'"https://staff-fixture.test"','import.meta.env.BASE_URL':'"/"'},plugins:[{name:'staff-accounts-fixture',setup(b){
  b.onResolve({filter:/(^|\/)supabase$/},()=>({path:'backend',namespace:'staff-fixture'}));
  b.onResolve({filter:/(^|\/)access$/},()=>({path:'access',namespace:'staff-fixture'}));
  b.onLoad({filter:/.*/,namespace:'staff-fixture'},({path})=>({loader:'js',contents:path==='access'?`export const useAccess=()=>({profile:{id:'owner-qa',access_role_code:'master_admin'},can:()=>true,reload:async()=>{}});`:`
window.staffFixture={calls:[],login:null};export const isDemoMode=false,isSupabaseConfigured=true,hasSupabaseCredentials=true,shouldUseLocalData=false;
const roles=[{code:'master_admin',name:'Owner',is_master:true},{code:'kitchen_staff',name:'Kitchen Staff',is_master:false}];
export const supabase={from(table){const q={select(){return q},order(){return q},eq(){return q},then(resolve){return Promise.resolve({data:table==='access_roles'?roles:[],error:null}).then(resolve)}};return q;},rpc:async()=>({data:[],error:null}),functions:{async invoke(name,{body}){window.staffFixture.calls.push(structuredClone(body));if(!body.password)return {data:{user_id:body.operation_id,username:body.username,status:'active'},error:null};return {data:null,error:{context:new Response(JSON.stringify({error:'Reply lost. Retry this same request.'}),{status:503})}}}},auth:{async signInWithPassword(value){window.staffFixture.login=value;return {error:null}}}};` }));
}}]});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?bundled.outputFiles[0].text:`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${style}</style><div id="root"></div><script src="/app.js"></script>`);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));const base='http://127.0.0.1:'+server.address().port;
 await page.goto(base);await page.getByRole('button',{name:'Add Staff Login',exact:true}).click();
 await page.getByLabel('Name',{exact:true}).fill('Lina');await page.getByLabel('Username',{exact:true}).fill('cook.lina');await page.getByLabel('Starting Password').fill('example-only-93812');await page.getByRole('dialog').getByRole('combobox').selectOption('kitchen_staff');
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.querySelector('[role=dialog]').scrollWidth<=document.querySelector('[role=dialog]').clientWidth+1));await page.screenshot({path:out+'/admin-create-'+width+'.png'});}
 await page.getByRole('button',{name:'Create Login',exact:true}).click();await page.getByRole('alert').filter({hasText:'Reply lost'}).waitFor();
 const original=await page.evaluate(()=>window.staffFixture.calls[0]);
 assert(!(await page.evaluate(()=>JSON.stringify(sessionStorage))).includes(original.password),'Password must not enter browser storage');
 await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'Add Staff Login',exact:true}).click();
 assert.equal(await page.getByLabel('Username',{exact:true}).inputValue(),'cook.lina');assert.equal(await page.getByLabel('Starting Password').inputValue(),'');
 await page.getByRole('button',{name:'Retry Same Request',exact:true}).click();await page.getByRole('status').filter({hasText:'Account created'}).waitFor();
 const retry=await page.evaluate(()=>window.staffFixture.calls.at(-1));assert.equal(retry.operation_id,original.operation_id);assert(!retry.password);assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('lp:staff-account:')).length),0);
 await page.getByRole('button',{name:'Done',exact:true}).click();
 await page.evaluate(()=>localStorage.setItem('language','ms'));await page.reload();await page.getByRole('button',{name:'Tambah Akaun Staf',exact:true}).click();await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/admin-create-ms-390.png'});
 await page.goto(base+'/?login');await page.getByLabel('Username or email').fill('cook.lina');await page.getByLabel('Password',{exact:true}).fill('example-only-93812');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForFunction(()=>window.staffFixture.login);assert.equal(await page.evaluate(()=>window.staffFixture.login.email),'cook.lina@staff.lovely-paradise.invalid');
 assert.deepEqual(errors,[]);console.log('PASS actual Admin/SignIn UI fixtures: username-only creation, mobile/tablet/desktop EN/MS, no stored password, original-request recovery and username login. Hosted Auth remains a separate gate.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
