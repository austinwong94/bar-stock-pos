import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const url=process.env.TEST_URL??'http://127.0.0.1:5177';
const out=resolve('.qa/screenshots/count-entry');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
const errors=[],cloud=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/supabase\.(co|in)/.test(r.url()))cloud.push(r.url());});
const count=(name,unit='biji')=>page.getByLabel(`Actual Count ${name} (${unit})`,{exact:true});
const review=()=>page.getByRole('button',{name:'Review Count',exact:true});
const dialog=()=>page.getByRole('dialog');
async function focused(input){assert(await input.evaluate(n=>document.activeElement===n),'Expected focused count field');}
async function pictures(name,malay=false){
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:width<768?844:1000});await page.waitForTimeout(150);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' page overflow');
    const d=dialog();assert(await d.evaluate(n=>n.scrollWidth<=n.clientWidth+1),name+' dialog overflow');
    const geometry=await d.evaluate(n=>{
      const p=n.getBoundingClientRect(),footer=n.querySelector('footer').getBoundingClientRect(),header=n.querySelector('header').getBoundingClientRect();
      return {top:p.top,bottom:p.bottom,footerTop:footer.top,footerBottom:footer.bottom,headerBottom:header.bottom,height:innerHeight};
    });
    assert(geometry.top>=-1&&geometry.bottom<=geometry.height+1&&geometry.footerBottom<=geometry.height+1&&geometry.footerTop>=geometry.headerBottom,name+' footer outside viewport');
    assert(await d.getByRole('button',{name:malay?'Sahkan Kiraan':'Confirm Count',exact:true}).isVisible());
    assert(await d.locator('.count-review-columns').first().locator('span').evaluateAll(nodes=>nodes.every(n=>n.getBoundingClientRect().height<=20)),'Column headings should fit on one line');
    await page.screenshot({path:`${out}/${name}-${width}.png`});
  }
}
try{
  await page.goto(url+'/#/kitchen/stock?view=count');await page.getByRole('button',{name:'Austin (Owner)',exact:true}).click();await page.locator('main').waitFor();
  const baseline=await page.evaluate(async()=>{
    const {loadLocalIngredientItems,saveLocalIngredientItem,adjustLocalIngredientStock,loadLocalIngredientMovements}=await import('/src/lib/localStore.ts');
    for(let n=0;n<10;n++)saveLocalIngredientItem({name:n===9?'Sample pantry item with an unusually long supplier description for testing wrapping':'Sample pantry item '+(n+1),category:'Food',base_unit:'unit'});
    for(const item of loadLocalIngredientItems().filter(i=>['Food','Seafood','Condiment'].includes(i.category))){
      const factor=item.kitchen_key==='jagung'?0:item.kitchen_factor|| (item.base_unit==='g'?1000:1);
      saveLocalIngredientItem({...item,kitchen_factor:factor,default_pack_size:item.kitchen_key==='timun'?12:item.default_pack_size,pack_label:item.kitchen_key==='timun'?'Bag':item.pack_label});
      adjustLocalIngredientStock({ingredientId:item.id,movementType:'count',quantity:(factor||1)*20,reason:'Sample opening stock',enteredBy:'Sample Only'});
    }
    return loadLocalIngredientMovements().length;
  });
  await page.goto(url+'/#/kitchen/stock?view=count');await page.reload();await count('Timun').waitFor();
  await page.getByText('Fresh Ingredients',{exact:true}).waitFor();
  assert(await count('Jagung').isDisabled());
  await page.getByRole('button',{name:/^To Count \d+$/}).click();
  await count('Timun').fill('18');assert.equal(await count('Timun').getAttribute('enterkeyhint'),'next');await count('Timun').press('Enter');await focused(count('Tomato'));
  assert.equal(await count('Timun').count(),0,'Completed row leaves To Count only after focus advances');
  await count('Tomato').fill('0');await count('Tomato').press('Enter');await focused(count('Carrot'));
  await count('Carrot').press('Enter');assert.equal(await count('Carrot').inputValue(),'','Skipping a field never creates a zero');assert.equal(await dialog().count(),0);
  await page.getByRole('button',{name:/^All \d+$/}).click();
  await page.getByLabel('Find Item to Count',{exact:true}).fill('Timun');
  await page.getByRole('button',{name:'Packs + Loose',exact:true}).click();
  await page.getByRole('button',{name:'Recount Timun',exact:true}).click();await focused(page.getByLabel('Sealed Packs Timun',{exact:true}));
  await page.getByLabel('Sealed Packs Timun',{exact:true}).fill('2');await page.getByLabel('Sealed Packs Timun',{exact:true}).press('Enter');await focused(page.getByLabel('Loose Timun',{exact:true}));
  await page.getByLabel('Loose Timun',{exact:true}).fill('3');await page.getByLabel('Loose Timun',{exact:true}).press('Enter');assert.equal(await dialog().count(),0);
  await page.getByLabel('Count Notes (Optional)',{exact:true}).fill('Sample correction test');await review().click();
  await dialog().getByRole('checkbox').check();
  const firstAttempt=await page.evaluate(()=>Object.keys(localStorage).find(k=>k.startsWith('kitchen-count:')&&k.includes('/')));
  await dialog().getByRole('button',{name:'Edit Count: Timun',exact:true}).click();
  await focused(count('Timun'));assert.equal(await count('Timun').inputValue(),'27');
  assert.deepEqual(await count('Timun').evaluate(n=>[n.selectionStart,n.selectionEnd]),[0,2]);
  assert.equal(await count('Tomato').inputValue(),'0');assert.equal(await page.getByLabel('Find Item to Count',{exact:true}).inputValue(),'');
  assert.equal(await page.getByLabel('Count Notes (Optional)',{exact:true}).inputValue(),'Sample correction test');
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),firstAttempt),null,'The editable unsubmitted attempt is retired');
  await count('Timun').fill('26');await review().click();assert(!(await dialog().getByRole('checkbox').isChecked()),'Changed quantities must be confirmed again');
  await page.evaluate(async()=>{const {loadLocalIngredientItems,adjustLocalIngredientStock}=await import('/src/lib/localStore.ts');const item=loadLocalIngredientItems().find(i=>i.kitchen_key==='timun');adjustLocalIngredientStock({ingredientId:item.id,movementType:'count',quantity:21,reason:'Changed on another device',enteredBy:'Sample Only'});window.dispatchEvent(new Event('focus'));});
  await dialog().getByRole('button',{name:'Edit Count: Timun',exact:true}).click();await page.getByText('Stock changed. Recount.',{exact:true}).waitFor();assert(await review().isDisabled());
  await page.getByRole('button',{name:'Recount Timun',exact:true}).click();await focused(count('Timun'));assert.equal(await count('Timun').inputValue(),'');await count('Timun').fill('21');
  assert.equal(await page.getByText('Stock changed. Recount.',{exact:true}).count(),0);
  await page.getByRole('button',{name:'Discard Count Draft',exact:true}).click();await dialog().getByRole('button',{name:'Discard Draft',exact:true}).click();
  const fields=page.locator('input[data-count-item]:not(:disabled)');assert(await fields.count()>=50);
  for(let n=0;n<50;n++)await fields.nth(n).fill(n===0?'18':n===2?'22':'20');
  const lastFieldLabel=await fields.nth(49).getAttribute('aria-label');
  await page.getByLabel('Count Notes (Optional)',{exact:true}).fill('Sample 50-item shelf check');await review().click();
  await pictures('review-50');
  const toggle=dialog().getByRole('button',{name:'All Items 50',exact:true});await toggle.click();
  await pictures('review-all-50');
  assert.equal(await dialog().locator('.count-review-edit').count(),50);const last=dialog().locator('.count-review-edit').last();
  await last.scrollIntoViewIfNeeded();const panelBottom=await dialog().locator('footer').evaluate(n=>n.getBoundingClientRect().bottom);assert(panelBottom<=1000);
  await last.click();
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),lastFieldLabel);
  await page.keyboard.type('19');await review().click();
  assert(await dialog().getByRole('button',{name:'Confirm Count',exact:true}).isDisabled());
  await dialog().getByRole('button',{name:'Back to Count',exact:true}).click();
  await page.getByRole('button',{name:'BM',exact:true}).click();await page.getByRole('button',{name:'Semak Kiraan',exact:true}).click();
  await pictures('review-50-malay',true);
  await dialog().getByRole('button',{name:'Kembali ke Kiraan',exact:true}).click();await page.getByRole('button',{name:'EN',exact:true}).click();await review().click();
  await page.evaluate(async()=>{const {supabase}=await import('/src/lib/supabase.ts');const rpc=supabase.rpc.bind(supabase);supabase.rpc=async(name,args)=>name==='record_kitchen_stock_count'?{data:null,error:{message:'Sample uncertain response'}}:rpc(name,args);});
  await dialog().getByRole('checkbox').check();await dialog().getByRole('button',{name:'Confirm Count',exact:true}).click();
  await dialog().getByRole('button',{name:'Check Confirmation',exact:true}).waitFor();
  assert(await dialog().getByRole('button',{name:'Back to Count',exact:true}).isDisabled());
  assert(await dialog().locator('.count-review-edit').evaluateAll(nodes=>nodes.every(n=>n.disabled)),'Pending confirmation cannot be edited');
  const after=await page.evaluate(async()=>{const {loadLocalIngredientMovements}=await import('/src/lib/localStore.ts');return loadLocalIngredientMovements().length;});
  assert.equal(after,baseline+1,'Only the explicit concurrent-stock fixture changed inventory');
  assert.deepEqual(errors,[]);assert.deepEqual(cloud,[]);
  console.log('PASS: keyboard Next, disabled-field skip, blank versus zero, To Count focus, packs/loose, direct review correction, preserved other entries/notes, required reconfirmation, stale snapshot recount, 50-item scrolling/visible footer, uncertain-edit lock and EN/MS 320/390/768/1440 layouts.');console.log(out);
}catch(error){await page.screenshot({path:out+'/failure.png',fullPage:true});console.error(await page.locator('body').innerText());throw error;}finally{await browser.close();}
