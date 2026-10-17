import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const url = process.env.TEST_URL ?? 'http://127.0.0.1:5177';
const out = resolve('.qa/screenshots/count-history'); await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [], cloud = [];
page.on('pageerror', e => errors.push(e.message));
page.on('request', r => { if (/supabase\.(co|in)/.test(r.url())) cloud.push(r.url()); });
const filter = name => page.getByRole('group', { name: 'Count Result', exact: true }).getByRole('button', { name, exact: true });
const movements = () => page.getByRole('list', { name: 'Stock Movements', exact: true });
async function pictures(prefix, malay = false) {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    await page.getByRole('group', { name: malay ? 'Hasil Kiraan' : 'Count Result', exact: true }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${prefix} page overflow at ${width}`);
    const dimensions = await page.locator('.food-count-filters button').evaluateAll(nodes => nodes.map(n => ({ height:n.getBoundingClientRect().height, width:n.clientWidth, scroll:n.scrollWidth, y:n.getBoundingClientRect().y })));
    assert(dimensions.every(d => d.height >= 44 && d.scroll <= d.width + 1 && d.y === dimensions[0].y), `${prefix} filter layout at ${width}`);
    assert(await page.locator('.food-history-types button').evaluateAll(nodes => nodes.every(n => n.scrollWidth <= n.clientWidth + 1)), `${prefix} movement labels overflow at ${width}`);
    await page.screenshot({ path: `${out}/${prefix}-${width}.png` });
  }
}
try {
  await page.goto(url + '/#/kitchen/stock?view=history&type=count');
  await page.getByRole('button', { name: 'Austin (Owner)', exact: true }).click(); await page.locator('main').waitFor();
  const original = await page.evaluate(async () => {
    const { loadLocalIngredientItems } = await import('/src/lib/localStore.ts');
    const { malaysiaDateInputValue } = await import('/src/lib/format.ts');
    const items = loadLocalIngredientItems(true);
    const crab = items.find(i => i.kitchen_key === 'ketam'), rice = items.find(i => i.kitchen_key === 'beras'), egg = items.find(i => i.kitchen_key === 'telur');
    const stamp = Date.parse(malaysiaDateInputValue(new Date()) + 'T08:00:00+08:00');
    const records = Array.from({ length: 192 }, (_, n) => {
      const item = [crab,rice,egg][n % 3]; const change = n < 55 ? -2 : n < 57 ? 1 : 0;
      return { id:crypto.randomUUID(),ingredient_id:item.id,movement_type:'count',quantity_before:50,quantity_after:50+change,quantity_change:change,
        display_unit:item.kitchen_unit??'unit',display_factor:1,entered_by:n<3?'Chloe':'Kitchen PIC',notes:n<3?'Weekly stock check':'Sample check '+(n+1),
        reason:'Stock Check',reference_id:null,reference_type:null,created_at:new Date(stamp+n*1000).toISOString(),ingredient_items:{name:item.name,base_unit:item.base_unit} };
    });
    localStorage.setItem('lovely_paradise_ingredient_movements',JSON.stringify(records));
    return localStorage.getItem('lovely_paradise_ingredient_movements');
  });
  await page.goto(url + '/#/kitchen/stock?view=history&type=count'); await page.getByText('50 / 192 records shown', { exact:true }).waitFor();
  assert.match(await filter('Short').innerText(), /55/); assert.match(await filter('Extra').innerText(), /2/); assert.match(await filter('Matched').innerText(), /135/);
  assert.equal(await movements().getByText('Short', { exact:true }).count(), 0, 'Shortages start beyond the unfiltered first page');
  await filter('Short').click(); await page.getByText('50 / 55 records shown', { exact:true }).waitFor();
  assert.equal(await movements().getByText('Short', { exact:true }).count(), 50);
  await page.getByRole('button', { name:'Load Older Records', exact:true }).click(); await page.getByText('55 / 55 records shown', { exact:true }).waitFor();
  assert.equal(await movements().locator(':scope > li').count(), 55); assert.equal(await page.getByRole('button', { name:'Load Older Records', exact:true }).count(), 0);
  const search = page.getByRole('searchbox', { name:'Search Food Stock History', exact:true });
  await search.fill('Chloe'); await page.getByText('3 / 3 records shown', { exact:true }).waitFor();
  assert.match(await filter('All').innerText(), /3/); assert.match(await filter('Matched').innerText(), /0/);
  await pictures('shortages');
  const firstName = await movements().locator('button').first().getAttribute('aria-label');
  await movements().locator('button').first().click(); await page.getByRole('dialog').getByText('Expected', { exact:true }).waitFor();
  await page.getByRole('dialog').getByRole('button', { name:'Close', exact:true }).click();
  assert.equal(await filter('Short').getAttribute('aria-pressed'),'true'); assert.equal(await search.inputValue(),'Chloe');
  assert.equal(await movements().locator('button').first().getAttribute('aria-label'),firstName);
  await filter('Extra').click(); await page.getByText('No Count Records Match These Filters', { exact:true }).waitFor();
  await page.getByRole('button', { name:'Clear Filters', exact:true }).click(); await page.getByText('50 / 192 records shown', { exact:true }).waitFor();
  assert.equal(await page.getByRole('button', { name:'Counts', exact:true }).getAttribute('aria-pressed'),'true');
  assert.equal(await filter('All').getAttribute('aria-pressed'),'true');
  await page.evaluate(async () => {
    const { supabase } = await import('/src/lib/supabase.ts'); const rpc = supabase.rpc.bind(supabase);
    window.historyTest = { delay:false, fail:false, omit:false };
    supabase.rpc = async (name,args) => {
      if (name !== 'read_food_stock_history') return rpc(name,args);
      if (window.historyTest.fail) return {data:null,error:{message:'History unavailable'}};
      const result = await rpc(name,args);
      if (window.historyTest.omit) delete result.data.count_summary;
      if (window.historyTest.delay && args.p_kind === 'count_short') await new Promise(r => setTimeout(r,500));
      return result;
    };
    window.historyTest.delay = true;
  });
  await filter('Short').click(); await filter('Extra').click(); await page.getByText('2 / 2 records shown', { exact:true }).waitFor();
  await page.waitForTimeout(650); assert.equal(await movements().getByText('Extra', { exact:true }).count(),2);
  await page.evaluate(() => { window.historyTest.delay = false; window.historyTest.fail = true; });
  await page.getByRole('button', { name:'Refresh History', exact:true }).click(); await page.getByRole('alert').waitFor();
  assert.equal(await movements().locator(':scope > li').count(),0); assert(!/\b0\b/.test(await filter('Short').innerText()), 'Unavailable totals are not zero');
  await page.evaluate(() => { window.historyTest.fail = false; }); await page.getByRole('button', { name:'Retry', exact:true }).click(); await page.getByText('2 / 2 records shown', { exact:true }).waitFor();
  await page.evaluate(() => { window.historyTest.omit = true; });
  await page.getByRole('button', { name:'Refresh History', exact:true }).click(); await page.getByText('Stock-check filters need the latest database update.', { exact:false }).waitFor();
  await page.evaluate(() => { window.historyTest.omit = false; }); await page.getByRole('button', { name:'Retry', exact:true }).click(); await page.getByText('2 / 2 records shown', { exact:true }).waitFor();
  await filter('All').click(); await page.getByText('50 / 192 records shown', { exact:true }).waitFor();
  await page.getByRole('button', { name:'Load Older Records', exact:true }).click(); await page.getByText('100 / 192 records shown', { exact:true }).waitFor();
  const inserted = await page.evaluate(() => {
    const records = JSON.parse(localStorage.getItem('lovely_paradise_ingredient_movements'));
    const row = {...records[0], id:crypto.randomUUID(), created_at:new Date(Date.parse(records[191].created_at)+1000).toISOString()};
    records.push(row); localStorage.setItem('lovely_paradise_ingredient_movements',JSON.stringify(records));
    window.dispatchEvent(new Event('focus')); return row;
  });
  await page.getByRole('button', { name:'New changes available. Refresh history.', exact:true }).waitFor();
  assert.equal(await movements().locator(':scope > li').count(),100); assert.match(await filter('All').innerText(),/192/);
  await page.getByRole('button', { name:'New changes available. Refresh history.', exact:true }).click(); await page.getByText('50 / 193 records shown', { exact:true }).waitFor();
  await search.fill('Chloe'); await filter('Short').click(); await page.getByText('4 / 4 records shown', { exact:true }).waitFor();
  await page.getByRole('button', { name:'BM', exact:true }).click(); await page.getByRole('group', { name:'Hasil Kiraan', exact:true }).waitFor();
  await pictures('shortages-malay',true);
  const after = await page.evaluate(() => localStorage.getItem('lovely_paradise_ingredient_movements'));
  assert.deepEqual(JSON.parse(after),[...JSON.parse(original),inserted], 'Reading history must not change stock records');
  assert.deepEqual(errors,[]); assert.deepEqual(cloud,[]);
  console.log('PASS: whole-period totals, off-page shortages, pagination, search, unchanged filters after trace, empty reset, request races, error/migration recovery, concurrent update banner, read-only data and EN/MS layouts at 320/390/768/1440.');
  console.log(out);
} catch(error) {
  await page.screenshot({ path:out+'/failure.png', fullPage:true }); console.error(await page.locator('body').innerText()); throw error;
} finally { await browser.close(); }
