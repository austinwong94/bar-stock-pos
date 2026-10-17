import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from 'vite';
import {chromium} from 'playwright';
const out=resolve('.qa/screenshots/kitchen-header');await mkdir(out,{recursive:true});
const server=await createServer({base:'/',server:{host:'127.0.0.1',port:0},define:{'import.meta.env.VITE_DEMO_MODE':'"true"'}});let browser,page;
try{
 await server.listen();const base=server.resolvedUrls.local[0].replace(/\/$/,'');browser=await chromium.launch();page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});const errors=[],remote=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/supabase\.(co|in)|api.openai.com/.test(r.url()))remote.push(r.url());});
 await page.goto(base);await page.getByRole('button',{name:'Austin (Owner)',exact:true}).click();await page.locator('main').waitFor();
 const nav=()=>page.getByRole('navigation',{name:'Kitchen Sections',exact:true}),queue=()=>page.getByRole('button',{name:'To Finish',exact:true});
 async function go(route){await page.goto(base+'/#'+route);await nav().waitFor();await page.getByRole('button',{name:/Kitchen Guide|Panduan Dapur/,exact:true}).waitFor();}
 async function geometry(){return page.locator('.kitchen-header').evaluate(el=>{
  const header=el.getBoundingClientRect(),targets=[...el.querySelectorAll('a,button')].filter(n=>n.getClientRects().length),rects=targets.map(n=>n.getBoundingClientRect());
  const overlaps=rects.some((a,i)=>rects.slice(i+1).some(b=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1));
  const fit=targets.every(n=>{const range=document.createRange();range.selectNodeContents(n);const text=[...range.getClientRects()].filter(r=>r.width>0&&r.height>0);const box=n.getBoundingClientRect();return n.scrollWidth<=n.clientWidth+1&&text.every(r=>r.left>=box.left-1&&r.right<=box.right+1);});
  return {height:header.height,top:header.top,fit,overlaps,touch:rects.every(r=>r.height>=44&&r.width>=44),overflow:document.documentElement.scrollWidth>innerWidth+1};
 });}
 const routes=[['/kitchen/stock?view=usage','usage'],['/kitchen/stock?view=count','count'],['/kitchen','requests'],['/kitchen/purchases','purchases'],['/kitchen/finance','finance']];
 for(const locale of ['en','ms']){
  if(locale==='ms'){await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Open menu',exact:true}).click();await page.getByRole('dialog',{name:'Menu'}).getByRole('button',{name:'BM',exact:true}).click();await page.keyboard.press('Escape');}
  for(const [route,name] of routes){await go(route);
   for(const width of [320,360,390,640,768,1440]){
    await page.setViewportSize({width,height:width<768?844:1000});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.evaluate(()=>window.scrollTo(0,0));
    const g=await geometry();assert(g.fit&&!g.overlaps&&g.touch&&!g.overflow,JSON.stringify({locale,name,width,g}));
    if(width>=360&&width<640)assert(g.height<=48,'Phone header uses one row: '+JSON.stringify({locale,width,g}));
    if(width===320)assert(g.height<=96,'Narrow phone header stays within two rows');
    if(name==='usage'){
     await page.getByLabel(locale==='en'?'Number of Guest Meals':'Bilangan Hidangan Tetamu',{exact:true}).fill('20');await page.getByLabel(locale==='en'?'Number of Staff Meals':'Bilangan Hidangan Staf',{exact:true}).fill('5');await page.getByLabel(locale==='en'?'Find Ingredient':'Cari Bahan',{exact:true}).fill('Timun');await page.getByLabel('Timun Guest (biji)',{exact:true}).fill('10');await page.getByLabel('Timun Staff (biji)',{exact:true}).fill('2');
     const actions=await page.locator('.kitchen-actions button').evaluateAll(bs=>bs.map(b=>{const r=b.getBoundingClientRect();return {height:r.height,width:r.width,fit:b.scrollWidth<=b.clientWidth+1};}));assert(actions.every(r=>r.height>=44&&r.width>=44&&r.fit));if(width<601)assert(actions.every(r=>r.height<=52),'Compact stock actions fit: '+JSON.stringify(actions));
     await page.evaluate(()=>document.activeElement?.blur());
     if(locale==='en'&&width===390){const after=await page.locator('.kitchen-header').evaluate(el=>({header:el.getBoundingClientRect().height,actions:document.querySelector('.kitchen-actions').getBoundingClientRect().height,ingredientTop:document.querySelector('.supply-usage-labels').getBoundingClientRect().top}));await writeFile(out+'/after.json',JSON.stringify(after));let before;try{before=JSON.parse(await readFile(out+'/before.json'));}catch{}console.log({before,after});}
    }
    await page.screenshot({path:out+'/'+name+'-'+locale+'-'+width+'.png'});
    if(name==='usage'&&width<768){await page.evaluate(()=>window.scrollTo(0,400));const top=await page.locator('.kitchen-header').evaluate(el=>el.getBoundingClientRect().top),expected=await page.evaluate(()=>parseFloat(getComputedStyle(document.querySelector('[data-sidebar-hidden]')).getPropertyValue('--workspace-header-height')));assert(Math.abs(top-expected)<2,'Kitchen tabs remain below the main app header');if(width===390)await page.screenshot({path:out+'/usage-scrolled-'+locale+'-390.png'});await page.evaluate(()=>window.scrollTo(0,0));}
   }
  }
  if(process.env.UPDATE_NAV_GUIDES==='true'){
   await page.setViewportSize({width:430,height:760});await go('/kitchen/stock?view=usage');await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,400);});
   const clock=page.getByRole('button',{name:locale==='en'?'To Finish':'Belum Selesai',exact:true});await clock.waitFor();const rect=await clock.boundingBox();assert(rect&&rect.y>=0&&rect.y+rect.height<=760);
   // Photograph temporary annotations on the actual unlocked training screen.
   await page.evaluate(({rect,label})=>{const mark=document.createElement('div');mark.dataset.navGuide='true';Object.assign(mark.style,{position:'fixed',left:rect.x-2+'px',top:rect.y-2+'px',width:rect.width+4+'px',height:rect.height+4+'px',border:'2px solid #00796b',borderRadius:'6px',zIndex:9999,pointerEvents:'none'});const n=document.createElement('span');n.textContent='1';Object.assign(n.style,{position:'absolute',top:'-9px',left:'-7px',width:'20px',height:'20px',background:'#00796b',color:'white',borderRadius:'50%',font:'bold 12px system-ui',display:'grid',placeItems:'center'});mark.append(n);document.body.append(mark);const caption=document.createElement('div');caption.dataset.navGuide='true';caption.textContent=label;Object.assign(caption.style,{position:'fixed',bottom:'0',left:'0',right:'0',padding:'3px',textAlign:'center',font:'11px system-ui',background:'#fff',color:'#5a5158',zIndex:10000});document.body.append(caption);},{rect,label:locale==='en'?'TRAINING EXAMPLE - NOT A REAL RECORD':'CONTOH LATIHAN - BUKAN REKOD SEBENAR'});
   await page.screenshot({path:resolve('public/guides/unfinished-'+locale+'.png')});await page.evaluate(()=>document.querySelectorAll('[data-nav-guide]').forEach(n=>n.remove()));
  }
 }
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Open menu',exact:true}).click();await page.getByRole('dialog',{name:'Menu'}).getByRole('button',{name:'EN',exact:true}).click();await page.keyboard.press('Escape');await go('/kitchen/stock?view=usage');
 await queue().click();await page.getByRole('dialog',{name:'To Finish',exact:true}).getByRole('button',{name:/Open Guest & Staff Meals/}).waitFor();await page.keyboard.press('Escape');assert(await queue().evaluate(el=>el===document.activeElement),'Closing queue restores focus to its visible clock');
 await page.getByRole('button',{name:'Kitchen Guide',exact:true}).click();await page.getByRole('dialog',{name:'Kitchen Guide',exact:true}).getByRole('group',{name:'Guide Topics',exact:true}).getByRole('button',{name:'Finish Saved Work',exact:true}).click();assert.match(await page.getByRole('dialog',{name:'Kitchen Guide',exact:true}).innerText(),/clock with a number/);await page.keyboard.press('Escape');
 assert.equal(await page.getByLabel('Timun Guest (biji)',{exact:true}).inputValue(),'10');assert.equal(await page.getByLabel('Timun Staff (biji)',{exact:true}).inputValue(),'2');
 // Large queues and failed reads must not resize the tools or become false zeroes.
 await page.evaluate(async()=>{const {supabase}=await import('/src/lib/supabase.ts');const {todayIso}=await import('/src/lib/opsData.ts');for(let i=0;i<105;i++){const r=await supabase.rpc('save_purchase_request',{p_request:{needed_for_date:todayIso(),status:'draft',purpose:'Sample navigation test',pax_count:0},p_items:[{item_name:'Sample Item '+i,quantity:1,unit:'pcs'}]});if(r.error)throw Error(JSON.stringify(r.error));}});
 await page.reload();await queue().click();await page.getByRole('dialog',{name:'To Finish',exact:true}).getByRole('status').waitFor({state:'hidden'});await page.keyboard.press('Escape');assert.equal(await queue().locator('.work-count').innerText(),'99+');assert.match(await queue().getAttribute('title'),/\d+ unfinished records/);assert((await geometry()).height<=48);
 await page.evaluate(async()=>{const {supabase}=await import('/src/lib/supabase.ts');const rpc=supabase.rpc.bind(supabase);supabase.rpc=async(name,args)=>name==='read_receipt_reviews'&&!args?.p_id?{data:null,error:null}:rpc(name,args);});await queue().click();await page.getByRole('dialog',{name:'To Finish',exact:true}).getByRole('alert').filter({hasText:'not an empty queue'}).waitFor();await page.keyboard.press('Escape');assert.equal(await queue().locator('.work-count').innerText(),'!');assert.match(await queue().getAttribute('title'),/could not be fully checked/);assert((await geometry()).height<=48);await page.screenshot({path:out+'/pending-read-failure-390.png'});
 assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);console.log('PASS sample-browser: compact kitchen navigation across five sections, EN/MS 320/360/390/640/768/1440 layouts, visible touch targets, sticky tabs, queue/help one-tap and focus return, retained typing, 99+ queues and fail-closed counts. No live providers.');
}catch(e){await page?.screenshot({path:out+'/failure.png'}).catch(()=>{});throw e;}
finally{await browser?.close();await server.close();}
