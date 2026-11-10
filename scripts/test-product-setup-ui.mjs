import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdir,readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';

const out=resolve('.qa/screenshots/product-setup');await mkdir(out,{recursive:true});
const css=(await Promise.all((await readdir('dist/assets')).filter(n=>n.endsWith('.css')).map(n=>readFile('dist/assets/'+n,'utf8')))).join('\n');
const bundle=await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.svg':'dataurl'},
  define:{'import.meta.env.BASE_URL':'"/"','import.meta.env.VITE_SUPABASE_URL':'"https://fixture.test"'},
  stdin:{resolveDir:resolve('.'),loader:'tsx',contents:`import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import{LanguageProvider}from'./src/lib/language';import{ToastProvider}from'./src/components/Toast';import Products from'./src/pages/Products';import{defaultSettings}from'./src/lib/data';createRoot(document.getElementById('root')).render(<MemoryRouter><LanguageProvider><ToastProvider><main className="bar-workspace mx-auto max-w-5xl p-3"><Products settings={defaultSettings} onSettingsSaved={()=>{}}/></main></ToastProvider></LanguageProvider></MemoryRouter>);`},
  plugins:[{name:'local-product-fixture',setup(b){
    b.onResolve({filter:/(^|\/)supabase$/},()=>({path:'backend',namespace:'product-fixture'}));
    b.onResolve({filter:/(^|\/)access$/},()=>({path:'access',namespace:'product-fixture'}));
    b.onResolve({filter:/(^|\/)useSharedRefresh$/},()=>({path:'refresh',namespace:'product-fixture'}));
    b.onLoad({filter:/.*/,namespace:'product-fixture'},({path})=>({loader:'js',contents:path==='access'?`export const useAccess=()=>({profile:{id:'11111111-1111-1111-1111-111111111111',full_name:'Test Owner'},can:()=>true,canAny:()=>true});`:path==='refresh'?'export function useSharedRefresh(){}':`
      const category={id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',name:'Beer',sort_order:1};
      const existing={id:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',name:'Existing Test Product',category_id:category.id,price_per_unit:12.5,cost_per_unit:null,carton_size:12,low_stock_threshold:5,active:true,updated_at:'2026-11-10T10:00:00Z',categories:category,inventory_balances:{quantity_on_hand:17}};
      window.fixture={calls:[],hold:false,fail:false};
      export const isSupabaseConfigured=true,hasSupabaseCredentials=true,shouldUseLocalData=false,isDemoMode=false;
      export const supabase={from(table){const q={select(){return q},order(){return q},in(){return q},range(from,to){q.start=from;q.end=to;return q},then(resolve){const rows=table==='products'?[existing]:table==='categories'?[category,{...category,id:'cccccccc-cccc-cccc-cccccccccccc',name:'Soft Drink'}]:[];return Promise.resolve({data:rows.slice(q.start??0,(q.end??999)+1),error:null}).then(resolve)}};return q;},async rpc(name,args){window.fixture.calls.push({name,args:structuredClone(args)});if(window.fixture.hold)await new Promise(resolve=>window.fixture.release=resolve);if(window.fixture.fail)throw Error('Test connection unavailable');return {data:{id:existing.id},error:null};}};
    `}));
  }}]});
const html='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>';
const server=createServer(async(req,res)=>{
  if(req.url==='/assets/custom-order.svg'){res.setHeader('Content-Type','image/svg+xml');res.end(await readFile('public/assets/custom-order.svg'));return;}
  res.setHeader('Content-Type',req.url==='/fixture.js'?'text/javascript':'text/html');res.end(req.url==='/fixture.js'?bundle.outputFiles[0].text:html);
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true});let page;
try{
  page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>sessionStorage.setItem('lovely_paradise_admin_access',JSON.stringify({expiresAt:new Date(Date.now()+600000).toISOString()})));
  const base='http://127.0.0.1:'+server.address().port;
  const dialog=()=>page.getByRole('dialog');
  for(const language of ['en','ms']){
    await page.goto(base);await page.evaluate(value=>localStorage.setItem('language',value),language);await page.reload();
    await page.getByRole('button',{name:language==='en'?'Add Product':'Tambah Produk',exact:true}).click();
    const price=dialog().getByLabel(language==='en'?'Selling Price (RM / Unit)':'Harga Jualan (RM / Unit)',{exact:true});
    const carton=dialog().getByLabel(language==='en'?'Units per Carton':'Unit Setiap Karton',{exact:true});
    assert.equal(await price.inputValue(),'');assert.equal(await carton.inputValue(),'');
    assert.equal(await dialog().locator('[role=group] [aria-pressed=true]').count(),0,'No guessed category');
    const save=dialog().getByRole('button',{name:language==='en'?'Save Product':'Simpan Produk',exact:true});
    for(const width of [320,390,768,1440]){
      await page.setViewportSize({width,height:844});
      await dialog().locator('form').evaluate(el=>el.parentElement.scrollTop=0);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      assert(await dialog().evaluate(el=>el.scrollWidth<=el.clientWidth+1));
      const cost=dialog().getByLabel(language==='en'?'Cost per Unit (RM, Optional)':'Kos Seunit (RM, Pilihan)',{exact:true});
      assert(Math.abs((await price.boundingBox()).height-(await cost.boundingBox()).height)<=1,'A neighbouring hint cannot stretch a numeric input');
      const box=await save.boundingBox();assert(box.y>=0&&box.y+box.height<=844,'Save stays in the viewport');
      assert(await dialog().locator('img').evaluate(el=>el.complete&&el.naturalWidth>0));
      await page.screenshot({path:out+'/blank-'+language+'-'+width+'.png'});
      await dialog().locator('form').evaluate(el=>el.parentElement.scrollTop=el.parentElement.scrollHeight);
      const after=await save.boundingBox();assert.equal(after.y,box.y,'Scrolling cannot hide the save action');
    }
    await dialog().getByRole('button',{name:'Close',exact:true}).click();
  }
  await page.evaluate(()=>localStorage.setItem('language','en'));await page.reload();await page.setViewportSize({width:390,height:844});
  const add=()=>page.getByRole('button',{name:'Add Product',exact:true}).click();
  await add();
  const name=()=>dialog().getByLabel('Product Name',{exact:true});
  const price=()=>dialog().getByLabel('Selling Price (RM / Unit)',{exact:true});
  const carton=()=>dialog().getByLabel('Units per Carton',{exact:true});
  const save=()=>dialog().getByRole('button',{name:'Save Product',exact:true});
  await name().fill('Fixture Product');await price().fill('12.50');await carton().fill('24');await save().click();
  await page.getByText('Choose a category before saving.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.fixture.calls.length),0);
  await dialog().getByRole('button',{name:'Beer',exact:true}).click();
  for(const bad of ['12.345','1e2','-1']){await price().fill(bad);await save().click();assert.equal(await price().inputValue(),bad);assert.equal(await page.evaluate(()=>window.fixture.calls.length),0);}
  await price().fill('12.50');await carton().fill('1.5');await save().click();assert.equal(await carton().inputValue(),'1.5');assert.equal(await page.evaluate(()=>window.fixture.calls.length),0);
  await dialog().getByRole('button',{name:'No Carton',exact:true}).click();assert.equal(await carton().inputValue(),'1');
  await page.evaluate(()=>window.fixture.hold=true);await save().click();await page.waitForFunction(()=>!!window.fixture.release);
  assert(await name().isDisabled());await page.keyboard.press('Escape');assert(await dialog().isVisible());
  await page.evaluate(()=>window.fixture.release());await dialog().waitFor({state:'hidden'});
  const created=await page.evaluate(()=>window.fixture.calls[0].args);assert.equal(created.p_payload.carton_size,1);assert.equal(created.p_payload.price_per_unit,12.5);assert.equal(created.p_payload.cost_per_unit,null);assert.equal(created.p_product_id,null);assert(!('quantity' in created.p_payload));
  await add();assert.equal(await name().inputValue(),'');assert.equal(await price().inputValue(),'');assert.equal(await carton().inputValue(),'');await dialog().getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Edit Existing Test Product',exact:true}).filter({visible:true}).click();
  assert.equal(await price().inputValue(),'12.5');assert.equal(await carton().inputValue(),'12');
  await page.evaluate(()=>{window.fixture.hold=false;window.fixture.fail=true;});await price().fill('13.75');await save().click();
  await page.getByText('Test connection unavailable',{exact:true}).waitFor();assert.equal(await price().inputValue(),'13.75');assert(await save().isEnabled());
  await page.evaluate(()=>window.fixture.fail=false);await save().click();await dialog().waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>window.fixture.calls.at(-1).args.p_source_updated_at),'2026-11-10T10:00:00Z');
  assert.deepEqual(errors,[]);
  console.log('PASS local product UI contract: EN/MS 320/390/768/1440, blank new fields, explicit category, exact raw values, No Carton, persistent Save, busy guard, failure retention, fresh second form and versioned edits. No hosted writes.');
}catch(error){console.error(error);if(page)await page.screenshot({path:out+'/first-failure.png',timeout:5000}).catch(()=>{});throw error;}
finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
