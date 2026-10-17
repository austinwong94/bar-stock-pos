import assert from 'node:assert/strict';
import {readFile,mkdir,stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gzipSync} from 'node:zlib';
import {chromium} from 'playwright';

const mode=process.argv[2],root=process.cwd(),out=resolve('.qa/screenshots/build-delivery');
assert(['sample','cloud'].includes(mode));await mkdir(out,{recursive:true});
const manifest=JSON.parse(await readFile('dist/.vite/manifest.json','utf8'));
const entry=manifest['index.html'];assert(entry?.isEntry);
const eager=new Set();function visit(key){if(eager.has(key))return;eager.add(key);assert(manifest[key]);for(const id of manifest[key].imports??[])visit(id);}visit('index.html');
assert([...eager].every(k=>!k.startsWith('src/pages/')),'Pages must not be eager dependencies of the shell');
for(const route of ['src/pages/POS.tsx','src/pages/supply/KitchenStock.tsx','src/pages/supply/FinanceWorkspace.tsx'])assert(manifest[route]?.isDynamicEntry,'Missing lazy route '+route);
const eagerBuffers=await Promise.all([...eager].map(k=>readFile(resolve('dist',manifest[k].file))));
const initialBytes=eagerBuffers.reduce((n,b)=>n+b.length,0),gzipBytes=eagerBuffers.reduce((n,b)=>n+gzipSync(b).length,0);
assert(initialBytes<=(mode==='sample'?660000:540000),'Initial JS budget exceeded: '+initialBytes);
const run=(args,env={})=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd:root,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.on('error',reject);child.on('close',c=>c===0?resolve():reject(Error(output)));});
const types={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.json':'application/json'};
const deploymentBase=process.env.GITHUB_PAGES==='true'?'/bar-stock-pos/':'/';
async function serve(directory){const server=createServer(async(req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(!pathname.startsWith(deploymentBase))throw Error();const relative=pathname.slice(deploymentBase.length),file=resolve(directory,relative||'index.html');if(!file.startsWith(directory+sep))throw Error();res.setHeader('Content-Type',types[extname(file)]??'text/html');res.end(await readFile(file));}catch{res.statusCode=404;res.end('Not found');}});await new Promise(r=>server.listen(0,'127.0.0.1',r));return {server,url:'http://127.0.0.1:'+server.address().port+deploymentBase.slice(0,-1)};}
let browser,hosting,page;
try{
 browser=await chromium.launch();hosting=await serve(resolve('dist'));page=await browser.newPage({viewport:{width:390,height:844}});
 const jsRequests=new Set(),pageErrors=[];page.on('request',r=>{if(new URL(r.url()).pathname.endsWith('.js'))jsRequests.add(new URL(r.url()).pathname);});page.on('pageerror',e=>pageErrors.push(e.message));
 await page.goto(hosting.url+'/#/kitchen/finance');
 if(mode==='cloud'){
   await page.getByRole('heading',{name:'Cloud database required',exact:true})
     .or(page.getByRole('button',{name:'Sign in',exact:true})).waitFor();
   assert.equal(await page.getByRole('button',{name:'Austin (Owner)',exact:true}).count(),0,'Cloud build cannot present preview roles');
   assert([...jsRequests].every(p=>!p.includes('DemoBar-')&&!p.includes('FinanceWorkspace-')),'Unconfigured cloud build does not load protected routes or sample toolbar');
 }else{
   await page.getByRole('button',{name:'Austin (Owner)',exact:true}).click();await page.getByRole('button',{name:'Finance CSV',exact:true}).waitFor();
   assert(!jsRequests.has('/'+manifest['src/pages/POS.tsx'].file),'Finance must not download the POS page');
   assert(!jsRequests.has('/'+manifest['src/pages/Products.tsx'].file),'Finance must not download product administration');
   const financeBytes=await [...jsRequests].reduce(async(p,f)=>(await p)+(await stat(resolve('dist','.'+f))).size,Promise.resolve(0));assert(financeBytes<900000,'Finance initial downloads exceeded the sample budget');
   const draftKey='kitchen-request-draft:review:u-master:new',raw=JSON.stringify({version:1,requestId:crypto.randomUUID(),requestNo:'SAMPLE-KEPT-DRAFT',expected:null,operationId:crypto.randomUUID(),neededFor:'2026-10-14',pax:'20',purpose:'Guest Meals',notes:'Typed before a page download failed',items:[{key:'rice',item_name:'Rice',quantity:'2',unit:'pack',note:''}],attempted:false,updatedAt:new Date().toISOString()});
   await page.evaluate(({key,raw})=>localStorage.setItem(key,raw),{key:draftKey,raw});
   const blocked='**/'+manifest['src/pages/POS.tsx'].file;await page.route(blocked,r=>r.abort('failed'));
   await page.evaluate(()=>{location.hash='/pos';});await page.getByRole('heading',{name:'This Section Could Not Load',exact:true}).waitFor();
   let confirmation=false;const dismiss=d=>{confirmation=true;void d.dismiss();};page.once('dialog',dismiss);await page.getByRole('button',{name:'Reload Page',exact:true}).click();assert(confirmation,'Reload must require a deliberate confirmation');await page.getByRole('heading',{name:'This Section Could Not Load',exact:true}).waitFor();assert.equal(await page.evaluate(k=>localStorage.getItem(k),draftKey),raw);
   async function shots(name){for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:width<768?844:1000});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert(await page.getByRole('button',{name:'Reload Page',exact:true}).evaluate(b=>b.scrollWidth<=b.clientWidth+1));await page.screenshot({path:out+'/'+name+'-'+width+'.png'});}}
   await shots('download-failed');await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Open menu',exact:true}).click();await page.getByRole('dialog',{name:'Menu'}).getByRole('button',{name:'BM',exact:true}).click();await page.keyboard.press('Escape');await page.getByRole('heading',{name:'Bahagian Ini Tidak Dapat Dimuatkan',exact:true}).waitFor();await page.screenshot({path:out+'/download-failed-ms-390.png'});
   let release;const waiting=new Promise(r=>{release=r;});const stock='**/'+manifest['src/pages/supply/KitchenStock.tsx'].file;await page.route(stock,async r=>{await waiting;await r.continue();});
   await page.getByRole('button',{name:'Open menu',exact:true}).click();await page.getByRole('dialog',{name:'Menu'}).getByRole('button',{name:/^Dapur(?:\s|$)/}).click();await page.getByRole('status').filter({hasText:'Memuatkan Bahagian...'}).waitFor();assert(await page.getByRole('button',{name:'Open menu',exact:true}).isVisible(),'Navigation stays visible while a section downloads');await page.screenshot({path:out+'/loading-ms-390.png'});release();
   await page.getByRole('button',{name:'Rekod Penggunaan',exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'Bahagian Ini Tidak Dapat Dimuatkan',exact:true}).count(),0,'Another route can be used after a failed page');assert.equal(await page.evaluate(k=>localStorage.getItem(k),draftKey),raw);
   await page.unroute(blocked);await page.evaluate(()=>{location.hash='/pos';});await page.getByRole('heading',{name:'Bahagian Ini Tidak Dapat Dimuatkan',exact:true}).waitFor();page.once('dialog',d=>void d.accept());await Promise.all([page.waitForEvent('load'),page.getByRole('button',{name:'Muat Semula Halaman',exact:true}).click()]);
   await page.locator('.bar-pos-layout').waitFor();assert.equal(await page.evaluate(k=>localStorage.getItem(k),draftKey),raw);await page.screenshot({path:out+'/pos-recovered-390.png'});
   console.log(JSON.stringify({sampleFinanceLoadedBytes:financeBytes,legacyWholeReviewBytes:1482440}));
 }
 assert.deepEqual(pageErrors,[]);await page.close();await new Promise(r=>hosting.server.close(r));hosting=null;
 // Preserve the separate portable practice export without flattening the hosted app.
 const single=resolve('.qa/performance/single-file');await run(['node_modules/vite/bin/vite.js','build','--outDir',single],{VITE_DEMO_MODE:'true',VITE_SINGLE_FILE:'true',GITHUB_PAGES:'false'});
 const singleManifest=JSON.parse(await readFile(single+'/.vite/manifest.json','utf8'));assert.equal(Object.keys(singleManifest).length,1);assert(!singleManifest['index.html'].dynamicImports?.length);
 const singleHTML=single+'/lovely-paradise-demo.html';await run(['scripts/inline-demo.mjs',singleHTML,single]);page=await browser.newPage({viewport:{width:390,height:844}});await page.goto(pathToFileURL(singleHTML).href);await page.getByRole('button',{name:'Austin (Owner)',exact:true}).click();await page.getByRole('button',{name:'Finance CSV',exact:true}).waitFor();await page.evaluate(()=>{location.hash='/pos';});await page.locator('.bar-pos-layout').waitFor();
 const cloud=resolve('.qa/performance/cloud-boundary');await run(['node_modules/vite/bin/vite.js','build','--outDir',cloud],{VITE_DEMO_MODE:'false',VITE_SINGLE_FILE:'false'});
 assert(!Object.keys(JSON.parse(await readFile(cloud+'/.vite/manifest.json','utf8'))).some(k=>/demo(?:Client|Backend|Seed)/.test(k)));
 console.log(JSON.stringify({level:'built-browser-and-static',mode,initialJavaScriptBytes:initialBytes,initialJavaScriptGzipBytes:gzipBytes,checks:'Lazy protected routes, byte budgets, preview backend excluded from cloud, portable single-file boot; sample: failed/slow route recovery, explicit reload, unchanged draft, EN/MS responsive screenshots. Hosted Auth/real-phone speed NOT RUN.'}));
}catch(e){if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});console.error((await page.locator('body').innerText()).slice(-3500));}throw e;}
finally{await browser?.close();if(hosting)await new Promise(r=>hosting.server.close(r));}
