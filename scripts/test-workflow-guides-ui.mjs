import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
const base=process.env.TEST_URL??'http://127.0.0.1:5177',output=resolve('.qa/screenshots/workflow-guides');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:390,height:844}});
const errors=[],remote=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(/supabase\.(co|in)|api.openai.com/.test(r.url()))remote.push(r.url());});
const dialog=()=>page.getByRole('dialog').last();
async function fits(){
  await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1,{},{timeout:3000});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page overflow');
  assert(await dialog().evaluate(el=>el.scrollWidth<=el.clientWidth+1),'dialog overflow');
  assert(await dialog().evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight+1),'dialog outside viewport');
}
async function imageLoaded(){await dialog().locator('img').evaluate(img=>img.complete&&img.naturalWidth>0?undefined:new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('Missing guide image '+img.src));}));}
try{
  await page.goto(base);await page.getByRole('button',{name:'Austin (Owner)',exact:true}).click();await page.locator('main').waitFor();
  for(const [route,help,topic] of [
    ['/kitchen','Kitchen Guide','Request Items'],
    ['/kitchen/purchases?view=receipts','Kitchen Guide','Purchase Receipts'],
    ['/kitchen/stock?view=arrivals','Kitchen Guide','Receive Items'],
    ['/kitchen/stock?view=usage','Kitchen Guide','Record Usage'],
    ['/kitchen/stock?view=history&type=count','Kitchen Guide','Check Stock'],
    ['/bar','Bar Guide','Take an Order'],
    ['/pos','Bar Guide','Take an Order'],
    ['/stock-in','Bar Guide','Bar Stock'],
    ['/stock-out-report','Bar Guide','Bar Stock'],
    ['/daily-closing','Bar Guide','Daily Closing'],
  ]){
    await page.goto(base+'/#'+route);
    // Hash navigation can leave the previous page's identically named help button visible briefly.
    if(route==='/stock-in'||route==='/stock-out-report')await page.getByRole('heading',{name:'Stock Activity',exact:true}).waitFor();
    if(route==='/daily-closing')await page.getByRole('heading',{name:'Daily Closing',exact:true}).waitFor();
    await page.getByRole('button',{name:help,exact:true}).waitFor();
    assert.equal(await page.getByRole('dialog').count(),0,'Guide is never automatic');
    await page.getByRole('button',{name:help,exact:true}).click();await dialog().getByRole('heading',{name:topic,exact:true}).waitFor();
    await imageLoaded();await fits();
    await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
    assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),help,'Focus returns to help');
  }
  for(const area of ['kitchen','bar']){
    await page.goto(base+'/#'+(area==='kitchen'?'/kitchen/stock?view=usage':'/pos'));
    const help=area==='kitchen'?'Kitchen Guide':'Bar Guide';
    if(area==='kitchen')await page.getByLabel('Number of Guest Meals',{exact:true}).fill('42');
    else await page.locator('.bar-product-grid button').first().click();
    await page.getByRole('button',{name:help,exact:true}).click();
    for(const locale of ['English','Bahasa Melayu','Indonesia']){
      await dialog().getByRole('button',{name:locale,exact:true}).click();
      const topics=dialog().getByRole('group',{name:locale==='English'?'Guide Topics':'Topik Panduan'}).getByRole('button');
      for(let i=0;i<await topics.count();i++){
        await topics.nth(i).click();await imageLoaded();
        for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});await fits();}
        assert(await dialog().locator('ol li').count()>=3);
      }
    }
    await dialog().getByRole('button',{name:'English',exact:true}).click();
    await dialog().getByRole('group',{name:'Guide Topics'}).getByRole('button',{name:area==='kitchen'?'Record Usage':'Beer Sets',exact:true}).click();
    for(const width of [390,1440]){
      await page.setViewportSize({width,height:900});await dialog().locator('.workflow-guide').evaluate(el=>el.parentElement.scrollTo(0,0));await imageLoaded();
      await page.screenshot({path:output+`/${area}-${width}.png`});
    }
    await page.setViewportSize({width:320,height:740});
    await dialog().getByRole('button',{name:'Enlarge Screenshot',exact:true}).click();await imageLoaded();await fits();
    assert.equal(await page.getByRole('dialog').count(),2);await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),1);await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(),0);
    if(area==='kitchen')assert.equal(await page.getByLabel('Number of Guest Meals',{exact:true}).inputValue(),'42','Help preserves unfinished meal entry');
    else assert.match(await page.locator('.bar-live-cart').innerText(),/1602 Lager/,'Help preserves selected order');
  }
  await page.goto(base+'/#/admin/access');await page.getByRole('button',{name:'AI Receipts',exact:true}).click();
  await page.getByRole('heading',{name:'Preview Only - AI Not Connected',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Check Setup',exact:true}).count(),0,'Preview cannot claim cloud readiness');
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:output+`/ai-setup-${width}.png`});
  }
  await page.evaluate(async()=>{const {supabase}=await import('/src/lib/supabase.ts');const original=supabase.rpc.bind(supabase);supabase.rpc=(name,args)=>name==='read_receipt_ai_settings'?Promise.reject(Error('Offline test')):original(name,args);});
  await page.goto(base+'/#/bar');await page.getByRole('button',{name:'Bar Guide',exact:true}).waitFor();
  await page.goto(base+'/#/admin/access');await page.getByRole('button',{name:'AI Receipts',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Receipt settings could not load'}).waitFor();
  assert(await page.getByRole('region',{name:'Scan Setup',exact:true}).isVisible(),'Setup remains available when settings cannot load');
  assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
  console.log('PASS: 10 help entry points, 30 translated topics, 120 responsive topic checks, actual images, enlargement, Escape/focus recovery, retained meal draft/cart, clear preview-only AI setup, no cloud or paid API calls.');
  console.log(output);
}catch(e){await page.screenshot({path:output+'/failure.png'});console.error(await page.locator('body').innerText());throw e;}finally{await browser.close();}
