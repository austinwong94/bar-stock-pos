import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
const base=process.env.TEST_URL??'http://127.0.0.1:5177',output=resolve('public/guides');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const remote=[],errors=[];
try {
  for(const language of ['en','ms']){
    const context=await browser.newContext({viewport:{width:430,height:760},deviceScaleFactor:1});
    await context.addInitScript(locale=>localStorage.setItem('language',locale),language);
    const page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    page.on('request',r=>{if(/supabase\.(co|in)|api.openai.com/.test(r.url()))remote.push(r.url());});
    const t=(en,ms)=>language==='en'?en:ms;
    const button=(en,ms)=>page.getByRole('button',{name:t(en,ms),exact:true});
    const dialog=()=>page.getByRole('dialog');
    async function go(route){await page.goto(base+'/#'+route);await page.locator('main').waitFor();await page.waitForTimeout(350);}
    async function capture(id,highlights=[],scroll=0){
      await page.evaluate(y=>{document.activeElement?.blur();window.scrollTo(0,y);},scroll);
      await page.waitForTimeout(150);
      // Temporary DOM annotations are photographed with the actual sample screen.
      for(const [number,locator] of highlights){
        await locator.first().waitFor({state:'visible'});
        const rect=await locator.first().boundingBox();
        assert(rect&&rect.y<736&&rect.y+rect.height>0,id+' highlight must be in the screenshot');
        await page.evaluate(({rect,number})=>{
          const mark=document.createElement('div');mark.dataset.guideAnnotation='true';
          Object.assign(mark.style,{position:'fixed',left:Math.max(2,rect.x-3)+'px',top:Math.max(2,rect.y-3)+'px',width:Math.min(rect.width+6,innerWidth-4)+'px',height:rect.height+6+'px',border:'2px solid #00796b',borderRadius:'5px',zIndex:9999,pointerEvents:'none'});
          const badge=document.createElement('span');badge.textContent=number;
          Object.assign(badge.style,{position:'absolute',left:'-1px',top:'-10px',background:'#00796b',color:'white',font:'bold 12px system-ui',width:'20px',height:'20px',borderRadius:'50%',display:'grid',placeItems:'center'});mark.append(badge);document.body.append(mark);
        },{rect,number});
      }
      await page.evaluate(label=>{const note=document.createElement('div');note.dataset.guideAnnotation='true';note.textContent=label;Object.assign(note.style,{position:'fixed',bottom:'0',left:'0',right:'0',padding:'3px',textAlign:'center',font:'11px system-ui',background:'#fff',color:'#5a5158',zIndex:10000,borderTop:'1px solid #ddd'});document.body.append(note);},t('TRAINING EXAMPLE - NOT A REAL RECORD','CONTOH LATIHAN - BUKAN REKOD SEBENAR'));
      await page.screenshot({path:output+`/${id}-${language}.png`});
      await page.evaluate(()=>document.querySelectorAll('[data-guide-annotation]').forEach(e=>e.remove()));
      console.log('Captured',id,language);
    }
    await page.goto(base);await page.getByRole('button',{name:'Austin (Owner)',exact:true}).click();await page.locator('main').waitFor();
    await go('/kitchen');await button('New Request','Permintaan Baru').click();
    await dialog().locator('.request-quantity').first().fill('20');
    await capture('requests',[[2,dialog().locator('.request-entry-meta')],[2,dialog().locator('.request-quantity').first()],[3,button('Save & Review','Simpan & Semak')]]);
    await button('Close','Close').click();
    await go('/kitchen/purchases?view=receipts');await button('Add Receipt','Tambah Resit').click();
    await capture('receipts',[[2,dialog().locator('input[type=file]').first().locator('..')],[4,dialog().locator('footer')]]);
    await button('Close','Close').click();
    await go('/kitchen/stock?view=arrivals');await button('Check Arrival','Semak Barang').first().click();
    await capture('arrivals',[[2,dialog().locator('input[inputmode=decimal]').first()],[3,dialog().locator('footer')]]);
    await button('Close','Close').click();
    await go('/kitchen/stock?view=usage');
    await capture('usage',[[1,page.getByLabel(t('Number of Guest Meals','Bilangan Hidangan Tetamu'),{exact:true})],[2,page.getByLabel('Timun Guest (biji)',{exact:true})]],260);
    await go('/kitchen/stock?view=count');
    await capture('count',[[1,button('Stock Check','Semak Stok')],[2,page.getByRole('button',{name:t('To Count 50','Belum Dikira 50'),exact:true})]]);
    await go('/pos');await page.locator('.bar-product-grid button').first().click();
    await capture('sell',[[1,page.locator('.bar-staff')],[2,page.locator('.bar-categories')],[3,page.locator('.bar-live-cart')]]);
    await button('Choose Beers','Pilih Bir').click();
    for(let i=0;i<4;i++)await dialog().getByRole('button',{name:'Add 1602 Lager to bundle',exact:true}).click();
    await capture('bundle',[[2,page.getByLabel('Bundle Sets',{exact:true})],[3,dialog().locator('footer')]]);
    await button('Close','Close').click();
    await button('Cash Payment','Bayaran Tunai').click();
    await capture('payment',[[2,dialog().locator('input').first()],[3,dialog().locator('footer')]]);
    await button('Close','Close').click();
    await go('/stock-in');
    await capture('bar-stock',[[1,button('Stock In','Stok Masuk')],[2,page.locator('input[inputmode=numeric]').first()]]);
    await go('/daily-closing');
    await capture('closing',[[1,page.getByLabel(t('Business date','Tarikh bisnes'),{exact:true})],[2,page.locator('.bar-metrics')]]);
    await context.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);console.log('PASS: current EN/MS sample screens captured; no real records or AI calls.');
}finally{await browser.close();}
