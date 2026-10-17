import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const bundle=await build({
  stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {AccessProvider,useAccess} from './src/lib/access';
    function Probe(){const a=useAccess();return <output>{JSON.stringify({id:a.profile?.id??null,allowed:a.can('bar.pos.void'),loading:a.loading,error:a.error})}</output>}
    function App(){const [id,setId]=React.useState('owner');window.changeAccount=setId;return <AccessProvider userId={id}><Probe/></AccessProvider>}
    createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:root,loader:'tsx'},
  bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',
  plugins:[{name:'isolated-access-backend',setup(b){
    b.onResolve({filter:/^\.\/supabase$/},()=>({path:'supabase',namespace:'access-test'}));
    b.onResolve({filter:/^\.\/useSharedRefresh$/},()=>({path:'refresh',namespace:'access-test'}));
    b.onLoad({filter:/.*/,namespace:'access-test'},args=>({loader:'js',contents:args.path==='refresh'?'export function useSharedRefresh(){}':`
      window.accessRequests=[];window.permissionRequests=[];
      export const supabase={from(table){const q={select(){return q},eq(){return q},order(){return Promise.resolve({data:[],error:null})},maybeSingle(){return new Promise((resolve,reject)=>window.accessRequests.push({resolve,reject}))}};return q;},rpc(name){if(name==='my_permissions')return new Promise((resolve,reject)=>window.permissionRequests.push({resolve,reject}));return Promise.resolve({data:[],error:null});}};
      window.finishAccess=(index,id,permissions,fail=false)=>{window.accessRequests[index].resolve({data:{id,status:'active',full_name:id},error:fail?{message:'Offline'}:null});window.permissionRequests[index].resolve({data:permissions,error:null});};` }));
  }}],
});
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<div id="root"></div>');await page.addScriptTag({content:bundle.outputFiles[0].text});
  const wait=number=>page.waitForFunction(n=>window.accessRequests.length===n,number);
  const state=async()=>JSON.parse(await page.locator('output').innerText());
  const finish=(...args)=>page.evaluate(args=>window.finishAccess(...args),args);
  await wait(1);await finish(0,'owner',['bar.pos.void']);await page.waitForFunction(()=>document.querySelector('output').textContent.includes('"allowed":true'));
  await page.evaluate(()=>window.changeAccount('cook'));await wait(2);
  assert.deepEqual(await state(),{id:null,allowed:false,loading:true,error:''},'Previous account must disappear immediately');
  await finish(1,'cook',[]);await page.waitForFunction(()=>document.querySelector('output').textContent.includes('"id":"cook"'));
  await page.evaluate(()=>window.dispatchEvent(new Event('access-refresh')));await wait(3);
  await page.evaluate(()=>window.dispatchEvent(new Event('access-refresh')));await wait(4);
  await finish(3,'cook',[],true);await page.waitForFunction(()=>document.querySelector('output').textContent.includes('Access could not'));
  await finish(2,'owner',['bar.pos.void']);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));
  assert.equal((await state()).allowed,false,'A stale successful response must not undo a later denial');
  assert.equal((await state()).id,null);
  await page.evaluate(()=>window.dispatchEvent(new Event('access-refresh')));await wait(5);await finish(4,'cook',[]);
  await page.waitForFunction(()=>document.querySelector('output').textContent.includes('"id":"cook"'));
  await page.evaluate(()=>window.dispatchEvent(new Event('access-refresh')));await wait(6);
  await page.evaluate(()=>window.changeAccount('buyer'));await wait(7);await finish(6,'buyer',[]);
  await page.waitForFunction(()=>document.querySelector('output').textContent.includes('"id":"buyer"'));
  await finish(5,'owner',['bar.pos.void']);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));
  assert.equal((await state()).id,'buyer');assert.equal((await state()).allowed,false);
  await page.evaluate(()=>window.dispatchEvent(new Event('access-refresh')));await wait(8);
  await page.evaluate(()=>window.accessRequests[7].reject(new Error('Network failure')));
  await page.waitForFunction(()=>document.querySelector('output').textContent.includes('Access could not'));
  assert.equal((await state()).allowed,false);assert.deepEqual(errors,[]);
  console.log('PASS: synchronous identity reset, out-of-order refresh, old-account response, failed fetch, failed result and recovery all fail closed.');
}finally{await browser.close();}
