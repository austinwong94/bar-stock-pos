import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const url = process.env.TEST_URL ?? 'http://127.0.0.1:5177';
const out = resolve('.qa/screenshots/linked-delivery'); await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [], cloud = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (/supabase\.(co|in)/.test(request.url())) cloud.push(request.url()); });
const dialog = () => page.getByRole('dialog');
const quantity = (name, unit = 'pcs') => dialog().getByLabel(`Delivered: ${name} (${unit})`, { exact: true });
const find = () => dialog().getByLabel('Find Delivery Item', { exact: true });
const focused = async input => assert(await input.evaluate(node => document.activeElement === node), 'Expected focused delivery field');
async function snapshot(label) {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width === 320 ? 640 : width < 768 ? 844 : 1000 });
    await page.waitForTimeout(100);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), label + ' page overflow');
    assert(await dialog().evaluate(node => node.scrollWidth <= node.clientWidth + 1), label + ' dialog overflow');
    const geometry = await dialog().evaluate(node => {
      const panel = node.getBoundingClientRect(), header = node.querySelector('header').getBoundingClientRect(), footer = node.querySelector('footer').getBoundingClientRect();
      return { top: panel.top, bottom: panel.bottom, header: header.bottom, footer: footer.top, end: footer.bottom, height: innerHeight };
    });
    assert(geometry.top >= -1 && geometry.bottom <= geometry.height + 1 && geometry.end <= geometry.height + 1 && geometry.footer > geometry.header, label + ' visible footer');
    assert(await dialog().locator('input:not(:disabled)').evaluateAll(nodes => nodes.every(node => node.type === 'checkbox' || Number.parseFloat(getComputedStyle(node).fontSize) >= 16)), 'Phone inputs must not trigger text zoom');
    await page.screenshot({ path: `${out}/${label}-${width}.png` });
  }
}
async function records() {
  return page.evaluate(async () => {
    const { db } = await import('/src/lib/demoBackend.ts');
    return { drafts: structuredClone(db.delivery_drafts ?? []), receipts: structuredClone(db.purchase_receipts ?? []), calls: window.deliveryCalls ?? [] };
  });
}
async function openArrival(malay = false) {
  const row = page.locator('li').filter({ has: page.getByText('PR-SAMPLE-50', { exact: true }) }).last();
  await row.getByRole('button', { name: malay ? 'Semak Barang' : 'Check Arrival', exact: true }).click();
}
async function reopenDraft(malay = false) {
  await page.getByRole('button', { name: malay ? /^Buka Draf:/ : /^Open Draft:/ }).first().click();
  await dialog().getByText(malay ? 'Draf Disimpan dalam Pratonton Setempat' : 'Draft Saved in Local Preview', { exact: true }).waitFor();
}
try {
  await page.goto(url + '/#/kitchen/stock?view=arrivals');
  await page.getByRole('button', { name: 'Austin (Owner)', exact: true }).click(); await page.locator('main').waitFor();
  const fixture = await page.evaluate(async () => {
    const { db, persistDemoDb } = await import('/src/lib/demoBackend.ts');
    const { todayIso } = await import('/src/lib/opsData.ts');
    const { saveLocalIngredientItem, loadLocalIngredientItems } = await import('/src/lib/localStore.ts');
    const names = ['Timun','Tomato','New Supplier Item','Gin','Jagung','Carrot','Cili Besar','Nenas','Bawang Putih','Bawang Bombay','Bawang Holland','Kentang','Beras','Telur','Gula','Minyak Masak','Tepung Gandum','Tepung Jagung','Garam','Ajinamoto','Sos Cili','Sos Tomato','Sos Tiram','Cuka','Black Pepper','Mushroom','Laici Tin','Syrup Laici','Keropok Ikan','Serbuk Kari','Sayap','Udang','Sotong','Ikan','Ketam','Ais','Ayam Bulat','Meggi Kari','Mihun','Labu Kuning','Kubis','Kopiko','Susu Cair','Gas Memasak','Sabun Pinggan','Plastik Sampah','Baking Paper','Kicap','Tisu','Sample pantry item with an unusually long supplier description for wrapping'];
    const request = crypto.randomUUID(), now = new Date().toISOString();
    db.purchase_requests.push({ id: request, request_no: 'PR-SAMPLE-50', needed_for_date: todayIso(), pax_count: 100, purpose: 'Guest Meals', notes: 'Isolated sample delivery', requested_by: 'u-owner', status: 'completed', created_at: now, updated_at: now });
    for (const [n, name] of names.entries()) {
      if (n !== 2) {
        const existing = loadLocalIngredientItems().find(item => item.name === name || item.kitchen_label === name);
        saveLocalIngredientItem({ ...existing, name, base_unit: n === 3 ? 'ml' : 'unit', kitchen_label: name, kitchen_unit: n === 3 ? 'ml' : 'pcs', kitchen_factor: 1, active: true });
      }
      db.purchase_request_items.push({ id: crypto.randomUUID(), request_id: request, item_name: name, unit: n === 2 ? 'box' : n === 3 ? 'bottle' : 'pcs', quantity: 20, purchased_quantity: 20, purchase_status: 'bought', supplier: 'Sample Supplier', sort_order: n, updated_at: now });
    }
    persistDemoDb();
    return { request, names };
  });
  await page.goto(url + '/#/kitchen/stock?view=arrivals'); await page.reload(); await openArrival();
  await quantity('Timun').waitFor(); await quantity('Timun').fill('6'); await quantity('Timun').press('Enter'); await focused(quantity('Tomato'));
  await quantity('Tomato').press('Enter'); await focused(quantity('New Supplier Item', 'box'));
  assert.equal(await quantity('Tomato').inputValue(), '', 'Next never invents zero');
  assert(await dialog().getByLabel('Pack Size: New Supplier Item (-/box)', { exact: true }).isDisabled());
  await quantity('New Supplier Item', 'box').press('Enter'); await focused(quantity('Gin', 'bottle'));
  await quantity('Gin', 'bottle').fill('3'); await quantity('Gin', 'bottle').press('Enter');
  const size = dialog().getByLabel('Pack Size: Gin (ml/bottle)', { exact: true }); await focused(size);
  assert.equal(await size.inputValue(), '', 'Bottle sizes must never be guessed'); await size.fill('500'); await size.press('Enter'); await focused(quantity('Jagung'));
  await dialog().getByRole('button', { name: 'Entered 2', exact: true }).click();
  assert.equal(await dialog().getByRole('button', { name: /Fill Shown|Fill Remaining|Undo Fill/ }).count(),0);
  await quantity('Timun').fill(''); assert.equal(await quantity('Timun').count(), 1, 'Clearing focused row keeps it available');
  await quantity('Timun').fill('5'); await quantity('Timun').press('Enter'); await focused(quantity('Gin', 'bottle'));
  assert.equal(await quantity('Tomato').count(), 0, 'Only entered rows are shown');
  await find().fill('Gin'); await quantity('Gin', 'bottle').fill('21'); await find().fill('Timun');
  await dialog().getByRole('button', { name: 'Check Items (1)', exact: true }).click(); await focused(quantity('Gin', 'bottle'));
  assert.equal(await find().inputValue(), ''); await quantity('Gin', 'bottle').fill('3');
  await dialog().getByRole('button', { name: 'All Items 50', exact: true }).click();
  await find().fill('Tomato');assert.equal(await quantity('Tomato').inputValue(),'');assert.equal(await quantity('Sos Tomato').inputValue(),'');await find().fill('');
  for(const name of fixture.names)if(!['Timun','Gin','New Supplier Item'].includes(name))await quantity(name).fill('20');
  assert.equal(await quantity('Timun').inputValue(), '5'); assert.equal(await quantity('Gin', 'bottle').inputValue(), '3');
  assert.equal(await quantity('New Supplier Item', 'box').inputValue(), '', 'Unmapped items cannot be filled');
  await quantity('New Supplier Item', 'box').fill('2'); await find().fill('Timun');
  await dialog().getByRole('button', { name: 'Check Items (1)', exact: true }).click();
  const mapping = dialog().locator('li').filter({ has: page.getByLabel('Delivered: New Supplier Item (box)', { exact: true }) }).getByRole('combobox');
  await focused(mapping); await mapping.selectOption({ label: 'Timun (unit)' });
  await dialog().getByLabel('Pack Size: New Supplier Item (unit/box)', { exact: true }).fill('10');
  await dialog().getByRole('button', { name: 'All Items 50', exact: true }).click();
  await dialog().locator('input[data-delivery-field]').last().press('Enter');
  assert.equal(await dialog().getByRole('heading', { name: 'Receive Delivery', exact: true }).count(), 1, 'Last field does not submit');
  await quantity('Timun').scrollIntoViewIfNeeded(); await snapshot('entry-50');
  await page.evaluate(async () => {
    const { supabase } = await import('/src/lib/supabase.ts'); const rpc = supabase.rpc.bind(supabase);
    window.deliveryCalls = []; window.loseDeliveryDraft = true;
    supabase.rpc = async (name, args) => {
      if (['save_delivery_draft', 'confirm_delivery_draft'].includes(name)) window.deliveryCalls.push({ name, args: structuredClone(args) });
      const result = await rpc(name, args);
      if (!result.error && name === 'save_delivery_draft' && window.loseDeliveryDraft) { window.loseDeliveryDraft = false; return { data: null, error: { message: 'Sample lost draft response' } }; }
      if (!result.error && name === 'confirm_delivery_draft' && window.loseDeliveryConfirmation) { window.loseDeliveryConfirmation = false; return { data: null, error: { message: 'Sample lost confirmation response' } }; }
      return result;
    };
  });
  const baseline = await records();
  await dialog().getByRole('button', { name: 'Review (50)', exact: true }).click();
  await dialog().getByRole('button', { name: 'Retry Draft Save', exact: true }).waitFor(); assert(await quantity('Timun').isDisabled());
  await dialog().getByRole('button', { name: 'Retry Draft Save', exact: true }).click();
  await dialog().getByText('Draft Saved in Local Preview', { exact: true }).waitFor();
  const first = await records(); assert.equal(first.drafts.length, baseline.drafts.length + 1); assert.equal(first.receipts.length, baseline.receipts.length);
  assert.deepEqual(first.calls[0], first.calls[1], 'Uncertain draft retry uses identical payload');
  assert.equal(first.drafts.at(-1).version, 1); const draftId = first.drafts.at(-1).id;
  assert(await dialog().getByRole('button', { name: 'Confirm Delivery', exact: true }).isDisabled());
  await dialog().getByRole('checkbox').check();
  await dialog().getByRole('button', { name: 'Edit Delivery: Timun', exact: true }).click(); await focused(quantity('Timun'));
  assert.deepEqual(await quantity('Timun').evaluate(node => [node.selectionStart, node.selectionEnd]), [0, 1]);
  assert.equal(await quantity('Tomato').inputValue(), '20'); assert.equal(await quantity('Gin', 'bottle').inputValue(), '3');
  await quantity('Timun').fill('4'); await dialog().getByRole('button', { name: 'Review (50)', exact: true }).click();
  await dialog().getByText('Draft Saved in Local Preview', { exact: true }).waitFor();
  assert(!(await dialog().getByRole('checkbox').isChecked()));
  const second = await records(); assert.equal(second.drafts.at(-1).id, draftId); assert.equal(second.drafts.at(-1).version, 2);
  await snapshot('review-50');
  await dialog().getByRole('button', { name: 'Edit Delivery: ' + fixture.names.at(-1), exact: true }).click(); await focused(quantity(fixture.names.at(-1)));
  await quantity(fixture.names.at(-1)).fill('19'); await dialog().getByRole('button', { name: 'Review (50)', exact: true }).click();
  await dialog().getByText('Draft Saved in Local Preview', { exact: true }).waitFor(); await dialog().getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload(); await page.getByRole('button', { name: 'BM', exact: true }).click(); await reopenDraft(true); await snapshot('review-50-malay');
  await dialog().getByRole('button', { name: 'Edit Penghantaran: Timun', exact: true }).click();
  await focused(dialog().getByLabel('Dihantar: Timun (pcs)', { exact: true })); await snapshot('entry-50-malay');
  await dialog().getByRole('button', { name: 'Close', exact: true }).click(); await page.getByRole('button', { name: 'EN', exact: true }).click(); await reopenDraft();
  await page.evaluate(async () => {
    const { supabase } = await import('/src/lib/supabase.ts'); const rpc = supabase.rpc.bind(supabase); let lose = true;
    supabase.rpc = async (name, args) => { const result = await rpc(name, args); if (!result.error && name === 'confirm_delivery_draft' && lose) { lose = false; return { data: null, error: { message: 'Sample lost confirmation response' } }; } return result; };
  });
  await dialog().getByRole('checkbox').check(); await dialog().getByRole('button', { name: 'Confirm Delivery', exact: true }).click();
  await dialog().getByRole('button', { name: 'Retry Confirmation', exact: true }).waitFor();
  assert(await dialog().getByRole('button', { name: 'Back to Delivery Entry', exact: true }).isDisabled());
  assert(await dialog().locator('.delivery-review-edit').evaluateAll(nodes => nodes.every(node => node.disabled)));
  await dialog().getByRole('button', { name: 'Retry Confirmation', exact: true }).click(); await dialog().getByText('Saved in Local Preview', { exact: true }).waitFor();
  const confirmed = await records(); assert.equal(confirmed.receipts.length - baseline.receipts.length, 50, 'Retry does not duplicate stock');
  assert.equal(confirmed.drafts.at(-1).status, 'confirmed'); assert.equal(confirmed.drafts.at(-1).items.find(item => item.purchase_name === 'Gin').base_per_unit, 500);
  await dialog().getByRole('button', { name: 'Done', exact: true }).click(); await openArrival(); await quantity('Timun').fill('1');
  await dialog().getByRole('button', { name: 'Review (1)', exact: true }).click(); await dialog().getByText('Draft Saved in Local Preview', { exact: true }).waitFor();
  await page.evaluate(async request => { const { db, persistDemoDb } = await import('/src/lib/demoBackend.ts'); const item = db.purchase_request_items.find(item => item.request_id === request && item.item_name === 'Timun'); db.purchase_receipts.push({ id: crypto.randomUUID(), purchase_item_id: item.id, purchase_quantity: 1, received_by: 'u-owner', received_at: new Date().toISOString() }); persistDemoDb(); }, fixture.request);
  await dialog().getByRole('checkbox').check(); await dialog().getByRole('button', { name: 'Confirm Delivery', exact: true }).click();
  await dialog().getByRole('button', { name: 'Close & Refresh', exact: true }).waitFor();
  assert(await dialog().locator('.delivery-review-edit').evaluateAll(nodes => nodes.every(node => node.disabled)));
  assert.equal((await records()).receipts.length, confirmed.receipts.length + 1, 'Stale confirmation adds no stock');
  assert.deepEqual(errors, []); assert.deepEqual(cloud, []);
  console.log('PASS: 50-item linked deliveries, Next/skip/blank safety, Entered focus, manual quantities and search, focused validation, exact pack sizes, direct review correction, saved draft versions, reconfirmation, lost-response retries, stale conflict protection, and EN/MS 320/390/768/1440 layouts with visible footer.'); console.log(out);
} catch (error) {
  await page.screenshot({ path: out + '/failure.png' }); console.error((await page.locator('body').innerText()).slice(-6000)); throw error;
} finally { await browser.close(); }
