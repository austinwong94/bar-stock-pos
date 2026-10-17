import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
const base=process.env.TEST_URL??'http://127.0.0.1:5190';
const out=resolve('.qa/screenshots/launch-security');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage();const errors=[],cloud=[];
  async function language(code){
    const button=page.getByRole('button',{name:code,exact:true});
    if(await button.count()){await button.click();return;}
    const sidebar=page.getByRole('button',{name:'Show Sidebar',exact:true});
    if(await sidebar.count()){await sidebar.click();await button.click();return;}
    await page.getByRole('button',{name:'Open menu',exact:true}).click();
    await page.getByRole('dialog',{name:'Menu',exact:true}).getByRole('button',{name:code,exact:true}).click();
    await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'Menu',exact:true}).waitFor({state:'hidden'});
  }
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(/supabase\.(co|in)/.test(r.url()))cloud.push(r.url());});
  await page.goto(base);await page.getByRole('button',{name:'Austin (Owner)',exact:true}).click();await page.locator('main').waitFor();
  for(const [route,name] of [['/bar','bar'],['/pos','pos'],['/stock-in','bar-stock-in'],['/stock-out-report','bar-stock-out'],['/daily-closing','closing'],['/daily-report','bar-reports'],['/products','bar-products'],['/kitchen','kitchen'],['/kitchen/stock?view=usage','kitchen-usage'],['/kitchen/stock?view=count','kitchen-count'],['/kitchen/stock?view=history&type=count','kitchen-history'],['/kitchen/purchases','purchases'],['/kitchen/finance','finance']]){
    await page.goto(base+'/#'+route);await page.locator('main h1').waitFor();
    if(name==='bar-stock-out')await page.getByRole('button',{name:'Stock Out',exact:true}).click();
    if(name==='bar-products'){
      await page.getByPlaceholder('Admin password',{exact:true}).fill('0122206881');
      await page.getByRole('button',{name:'Unlock',exact:true}).click();
      await page.getByRole('button',{name:'Add Product',exact:true}).waitFor();
    }
    for(const width of [390,768,1440]){
      await page.setViewportSize({width,height:width<768?844:1000});
      await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),route+' fits '+width);
      assert((await page.locator('main').innerText()).length>100,'Page content must be present: '+route);
      assert(!/Checking your access|not part of your access/i.test(await page.locator('main').innerText()));
      await page.screenshot({path:out+'/'+name+'-'+width+'.png'});
      if(name==='bar-reports'){
        const labelsFit=async()=>{
          const periods=await page.locator('.bar-report-periods button').evaluateAll(buttons=>buttons.length===4&&buttons.every(button=>{const range=document.createRange();range.selectNodeContents(button);return range.getClientRects().length===1&&button.scrollWidth<=button.clientWidth+1;}));
          const navigation=await page.locator('.bar-navigation a').evaluateAll(links=>links.filter(link=>link.getClientRects().length).every(link=>{const range=document.createRange();range.selectNodeContents(link);return range.getClientRects().length===1&&link.scrollWidth<=link.clientWidth+1;}));
          return periods&&navigation;
        };
        assert(await labelsFit(),'English report labels stay on one line at '+width);
        await language('BM');
        await page.locator('.bar-report-periods').getByText('Mingguan',{exact:true}).waitFor();
        assert(await labelsFit(),'Malay report labels stay on one line at '+width);
        await page.screenshot({path:out+'/'+name+'-malay-'+width+'.png'});
        await language('EN');
      }
    }
  }
  assert.deepEqual(errors,[]);assert.deepEqual(cloud,[]);
  await page.goto(base+'/#/staff');await page.getByRole('heading',{name:'Attendance & Leave',exact:true}).waitFor();
  for(const width of [390,768,1440]){await page.setViewportSize({width,height:width<768?844:1000});await page.getByRole('button',{name:'Clock In',exact:true}).waitFor();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.screenshot({path:out+'/staff-'+width+'.png'});const fits=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);if(!fits)console.log(await page.locator('body *').evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length&&(n.getBoundingClientRect().right>innerWidth+1||n.getBoundingClientRect().left< -1)).map(n=>({tag:n.tagName,class:n.className,rect:n.getBoundingClientRect().toJSON(),text:n.textContent?.slice(0,100)}))));assert(fits,'Staff fits '+width);}
  assert.deepEqual(errors,[]);assert.deepEqual(cloud,[]);
  console.log('PASS: 14 unlocked kitchen/bar/staff routes at 390/768/1440px; no page overflow, browser errors or live database calls. Sample adapter only, not hosted-provider acceptance.');
  console.log(out);
}finally{await browser.close();}
