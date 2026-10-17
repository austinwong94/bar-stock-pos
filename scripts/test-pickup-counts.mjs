import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const url = process.env.UI_TEST_URL || 'http://127.0.0.1:5175';
assert.equal(new URL(url).hostname, '127.0.0.1', 'Only isolated local sample data may be changed');
const out = path.resolve('.qa/screenshots');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
page.setDefaultTimeout(12000);
const errors = [];
const cloud = [];
page.on('pageerror', e => errors.push(e.message));
page.on('request', req => { if (/supabase\.(co|in)/.test(req.url())) cloud.push(req.url()); });
const card = id => page.locator(`[data-pickup-booking="${id}"]`);
async function breakdown(locator, expected) {
  await locator.waitFor({ state: 'visible' });
  const actual = await locator.locator('[data-passenger-breakdown]').innerText();
  for (const label of expected) assert(actual.includes(label), `${label} visible in ${actual}`);
  return actual;
}
async function captured(name, widths = [320, 390, 768, 1024, 1440]) {
  await page.waitForFunction(() => !document.querySelector('.no-print.fixed.bottom-20')?.children.length);
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `No horizontal overflow: ${name} ${width}`);
    const clipped = await page.locator('[data-passenger-kind]:visible').evaluateAll(nodes => nodes.filter(n => {
      const r = n.getBoundingClientRect();
      const parent = n.closest('[data-passenger-breakdown]').getBoundingClientRect();
      // The existing bookings table scrolls inside its own container on phones.
      // Pickup rows and dialogs must fit the viewport without horizontal scrolling.
      return r.left < parent.left - 1 || r.right > parent.right + 1 || (!n.closest('table') && r.right > innerWidth + 1);
    }).map(n => n.textContent));
    assert.deepEqual(clipped, [], `Passenger counts fit: ${name} ${width}`);
    await page.screenshot({ path: path.join(out, `${name}-${width}.png`), fullPage: true });
  }
}
try {
  await page.goto(url + '/#/guests/pickup');
  await page.getByLabel('Service Date', { exact: true }).waitFor();
  await page.evaluate(async () => {
    if (!(await import('/src/lib/supabase.ts')).isDemoMode) throw new Error('Sample only');
    const { db, persistDemoDb } = await import('/src/lib/demoBackend.ts');
    const date = document.querySelector('input[type="date"]').value;
    const seed = db.bookings.find(b => b.service_date === date);
    const row = { ...seed, pickup_required: true, pickup_group_id: null, pickup_stop_order: null, pickup_eta: null, pax_assisted: 0, pax_elderly: 0, pickup_hotel_name: 'Marina Suites Main Entrance', pickup_area: 'Marina', pickup_latitude: 5.41, pickup_longitude: 100.33 };
    db.bookings = [
      { ...row, id: 'family', lead_name: 'Wong Family', pax_total: 6, pax_adults: 4, pax_children: 2 },
      { ...row, id: 'elders', lead_name: 'Tan Family', pax_total: 4, pax_adults: 2, pax_children: 1, pax_elderly: 1, pax_assisted: 2 },
      { ...row, id: 'solo', lead_name: 'Alexanderthegreatandfamilywithanextremelylongbookingname', pax_total: 1, pax_adults: 1, pax_children: 0, pickup_latitude: null, pickup_longitude: null },
      { ...row, id: 'own', lead_name: 'Lim Family', pax_total: 5, pax_adults: 3, pax_children: 2, pickup_required: false },
    ];
    db.pickup_groups = [];
    db.transport_vehicles = db.transport_vehicles.slice(0, 2).map((v, i) => ({ ...v, code: `Van ${i + 1}`, capacity_pax: 12, active: true }));
    persistDemoDb();
  });
  await page.reload();
  await page.getByRole('button', { name: 'Add Van', exact: true }).waitFor();
  for (const label of ['Later', 'Hide pax reminder']) { const b = page.getByRole('button', { name: label, exact: true }); if (await b.isVisible()) await b.click(); }
  await page.getByRole('tab', { name: /^Waiting/ }).click();
  const original = await breakdown(card('family'), ['4 Adults', '2 Children']);
  await breakdown(card('elders'), ['2 Adults', '1 Child', '1 Elderly', '2 Needs Assistance (Included)']);
  await breakdown(card('solo'), ['1 Adult', '0 Children']);
  await captured('pickup-counts-waiting');
  await page.getByRole('tab', { name: /^Vans/ }).click();
  for (const number of [1, 2]) {
    await page.getByRole('button', { name: 'Add Van', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Add Van', exact: true });
    await form.getByRole('radio', { name: new RegExp(`Van ${number}`) }).check();
    await form.getByRole('button', { name: 'Add Van', exact: true }).click();
    await form.waitFor({ state: 'hidden' });
  }
  const runIds = await page.locator('[data-pickup-van]').evaluateAll(nodes => nodes.map(n => n.dataset.pickupVan));
  const van = page.locator(`[data-pickup-van="${runIds[0]}"]`);
  await page.getByRole('button', { name: 'Drag Wong Family', exact: true }).dragTo(van.getByText('Van 1', { exact: true }));
  await van.getByText('Wong Family', { exact: true }).waitFor();
  assert.equal(await breakdown(van.locator('[data-pickup-booking="family"]'), ['4 Adults', '2 Children']), original, 'Drag preserves the exact breakdown');
  assert.match(await van.innerText(), /6\/12 pax/, 'Capacity counts six, not just the children');
  await captured('pickup-counts-assigned');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('heading', { name: 'Pickup Vans', exact: true }).evaluate(el => window.scrollBy(0, el.getBoundingClientRect().top - 90));
  await page.screenshot({ path: path.join(out, 'pickup-counts-assigned-phone.png') });
  await card('family').getByLabel('Move Wong Family', { exact: true }).selectOption(runIds[1]);
  const van2 = page.locator(`[data-pickup-van="${runIds[1]}"]`);
  await van2.getByText('Wong Family', { exact: true }).waitFor();
  assert.equal(await breakdown(card('family'), ['4 Adults', '2 Children']), original, 'Touch assignment between vans preserves all counts');
  await card('family').getByLabel('Move Wong Family', { exact: true }).selectOption('no-run');
  await page.getByRole('tab', { name: /^Waiting/ }).click();
  assert.equal(await breakdown(card('family'), ['4 Adults', '2 Children']), original, 'Returning to Waiting preserves counts');
  await card('family').getByRole('button', { name: 'Own Transport', exact: true }).click();
  await card('family').waitFor({ state: 'hidden' });
  await page.getByRole('tab', { name: /^Own Transport/ }).click();
  assert.equal(await breakdown(card('family'), ['4 Adults', '2 Children']), original, 'Own Transport preserves counts');
  await breakdown(card('own'), ['3 Adults', '2 Children']);
  await captured('pickup-counts-own');
  await card('family').getByRole('button', { name: 'Add Pickup', exact: true }).click();
  await card('family').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Review Recommended', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review Pickup Plan', exact: true });
  assert.equal(await breakdown(review.locator('[data-pickup-plan-booking="family"]'), ['4 Adults', '2 Children']), original, 'Recommended plan uses identical counts');
  await breakdown(review.locator('[data-pickup-plan-booking="solo"]'), ['1 Adult', '0 Children']);
  await captured('pickup-counts-plan');
  assert(await review.getByRole('button', { name: 'Confirm Plan', exact: true }).isDisabled());
  await review.getByLabel('I checked locations, vehicle availability and passenger seats.').check();
  await review.getByRole('button', { name: 'Confirm Plan', exact: true }).click();
  await review.waitFor({ state: 'hidden' });
  await page.reload();
  await card('family').waitFor();
  assert.equal(await breakdown(card('family'), ['4 Adults', '2 Children']), original, 'Confirmed counts persist after reload');
  await breakdown(card('elders'), ['2 Adults', '1 Child', '1 Elderly', '2 Needs Assistance (Included)']);
  await captured('pickup-counts-confirmed');
  await page.getByRole('button', { name: 'BM', exact: true }).first().click();
  await breakdown(card('family'), ['4 Dewasa', '2 Kanak-kanak']);
  await breakdown(card('elders'), ['1 Warga Emas', '2 Perlu Bantuan (Termasuk)']);
  await captured('pickup-counts-malay', [320, 390, 768]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'EN', exact: true }).first().click();
  await page.goto(url + '/#/guests');
  const bookingRow = page.getByRole('row').filter({ hasText: 'Wong Family' }).first();
  await bookingRow.waitFor();
  assert.equal(await breakdown(bookingRow, ['4 Adults', '2 Children']), original, 'Bookings and pickup show the same breakdown');
  assert.match(await bookingRow.innerText(), /Assigned · Time Not Set/, 'Assigned guests are not mislabeled as unassigned');
  await page.evaluate(async () => {
    const { db, persistDemoDb } = await import('/src/lib/demoBackend.ts');
    db.bookings.find(b => b.id === 'family').pickup_eta = '08:30:00';
    persistDemoDb();
  });
  await page.reload();
  await bookingRow.getByText('Pickup 08:30', { exact: true }).waitFor();
  assert(!/Collected/.test(await bookingRow.innerText()), 'An estimated pickup time is not a collected status');
  await captured('pickup-counts-bookings');
  assert.deepEqual(errors, [], 'No browser errors');
  assert.deepEqual(cloud, [], 'No live cloud calls');
  await writeFile(path.join(out, 'pickup-counts-index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pickup Passenger Counts</title><style>body{font:16px system-ui;margin:24px;background:#faf8f9;color:#272027}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr));gap:24px}img{max-width:100%;border:1px solid #ddd}a{color:#ad1457}h1{font-size:24px}</style><h1>Pickup Passenger Counts</h1><p>Waiting, assigned vans, Own Transport and recommended plans.</p><main>${['waiting','assigned','own','plan','confirmed'].flatMap(name => [390, 1440].map(width => `<section><h2>${name} · ${width}px</h2><a href="pickup-counts-${name}-${width}.png"><img src="pickup-counts-${name}-${width}.png" alt="${name} passenger breakdown at ${width}px"></a></section>`)).join('')}</main></html>`);
  console.log('Passed: full passenger breakdown before/after drag, van-to-van touch reassignment, return to Waiting, Own Transport, suggestions, ungrouped guests, reviewed confirmation, reload, booking status labels, English/Malay and 33 responsive views; no browser errors or Supabase calls.');
} catch (error) {
  await page.screenshot({ path: path.join(out, 'pickup-counts-failure.png'), fullPage: true });
  throw error;
} finally { await browser.close(); }
