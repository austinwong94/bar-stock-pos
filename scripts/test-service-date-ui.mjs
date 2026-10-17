import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const url = process.env.UI_TEST_URL || 'http://127.0.0.1:5175';
assert.equal(new URL(url).hostname, '127.0.0.1');
const out = path.resolve('.qa/screenshots/service-date');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  for (const slot of ['start', '10', '12']) sessionStorage.setItem('kitchen_pax_global_' + today + '_' + slot, 'dismissed');
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [], cloud = [], shots = [], measurements = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (/supabase\.(co|in)/.test(request.url())) cloud.push(request.url()); });
const button = name => page.getByRole('button', { name, exact: true });
const bar = page.getByRole('region', { name: 'Service Date Navigation', exact: true });
const date = page.getByLabel('Service Date', { exact: true });
const days = page.getByRole('group', { name: 'Seven Days', exact: true }).getByRole('button');
const routes = ['/guests/sheet', '/guests', '/guests/pickup', '/fleet', '/boarding', '/activities', '/guests/meal-needs', '/ops', '/ops/summary'];
async function dismiss() {
  for (const label of ['Later', 'Hide pax reminder']) if (await button(label).isVisible()) await button(label).click();
}
async function visit(route) {
  await page.goto(url + '/#' + route);
  await date.waitFor();
  await dismiss();
  await page.waitForTimeout(200);
}
async function capture(name, width) {
  await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(100);
  const dimensions = await bar.evaluate(el => {
    const r = el.getBoundingClientRect();
    return { width: innerWidth, scroll: document.documentElement.scrollWidth, height: r.height,
      topBorder: getComputedStyle(el).borderTopWidth,
      clipped: [...el.querySelectorAll('button,input')].filter(c => c.getBoundingClientRect().left < r.left - 1 || c.getBoundingClientRect().right > r.right + 1).map(c => c.getAttribute('aria-label')),
      crowded: [...el.querySelectorAll('button')].filter(c => c.scrollWidth > c.clientWidth + 1).map(c => c.getAttribute('aria-label')) };
  });
  assert(dimensions.scroll <= width + 1, name + ' page overflow at ' + width);
  assert(dimensions.height <= (width === 1440 ? 60 : 108), name + ' oversized date bar: ' + JSON.stringify(dimensions));
  assert.equal(dimensions.topBorder, '0px');
  assert.deepEqual(dimensions.clipped, [], name + ' clipped date controls');
  assert.deepEqual(dimensions.crowded, [], name + ' clipped date wording');
  measurements.push({ name, ...dimensions });
  const file = name + '-' + width + '.png';
  await page.screenshot({ path: path.join(out, file) });
  shots.push(file);
}
try {
  await page.goto(url);
  assert(await page.evaluate(async () => (await import('/src/lib/supabase.ts')).isDemoMode));
  await button('Austin (Owner)').click();
  await visit('/guests/sheet');
  await page.getByLabel('Time Row 1', { exact: true }).waitFor();
  assert.equal(await days.count(), 7);
  assert.equal(await page.getByText('Next 7 Days', { exact: true }).count(), 0);
  const today = await date.inputValue();
  await days.nth(3).click();
  const picked = await date.inputValue();
  const labels = await days.evaluateAll(elements => elements.map(e => e.getAttribute('aria-label')));
  for (const route of routes) {
    await visit(route);
    assert.equal(await date.inputValue(), picked, route + ' retains selected date');
    assert.deepEqual(await days.evaluateAll(elements => elements.map(e => e.getAttribute('aria-label'))), labels, route + ' retains seven-day window');
    assert.equal(await bar.count(), 1, route + ' has one date bar');
  }
  await visit('/guests/sheet');
  await date.fill('2026-12-31');
  await button('Next Seven Days').click();
  assert.equal(await date.inputValue(), '2027-01-07');
  await button('Previous Seven Days').click();
  assert.equal(await date.inputValue(), '2026-12-31');
  await button('Weekly').click();
  await page.locator('tbody[data-sheet-date]').first().waitFor();
  assert.equal(await days.first().getAttribute('aria-label'), 'Monday, 28 December 2026');
  assert.equal(await days.last().getAttribute('aria-label'), 'Sunday, 3 January 2027');
  assert.equal(await page.locator('tbody[data-sheet-date]').count(), 7);
  await button('Next Seven Days').click();
  assert.equal(await page.locator('tbody[data-sheet-date]').first().getAttribute('data-sheet-date'), '2027-01-04');
  await button('Daily').click();
  await button('Today').click();
  assert.equal(await date.inputValue(), today);
  await visit('/guests');
  await page.getByRole('checkbox', { name: 'All dates', exact: true }).check();
  assert.deepEqual(await days.evaluateAll(elements => elements.map(el => el.getAttribute('aria-pressed'))), Array(7).fill('false'));
  assert.equal(await bar.getByText('All Dates', { exact: true }).count(), 1);
  await days.nth(1).click();
  assert(!await page.getByRole('checkbox', { name: 'All dates', exact: true }).isChecked());
  await button('Today').click();

  for (const route of routes) {
    await visit(route);
    for (const width of [390, 768, 1440]) await capture(route.slice(1).replaceAll('/', '-'), width);
  }
  await visit('/guests/sheet');
  for (const width of [320, 1024]) await capture('sheet-compact', width);
  await page.setViewportSize({ width: 768, height: 900 });
  await button('Show Sidebar').click();
  await capture('sheet-sidebar-open', 768);
  await button('Hide Sidebar').click();
  // Scroll actual populated screens. Sticky position follows the optional mobile header.
  for (const route of ['/guests/sheet', '/boarding', '/guests/pickup', '/guests/meal-needs']) {
    await visit(route);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 640 });
      await page.evaluate(() => scrollTo(0, 0));
      const initial = await bar.boundingBox();
      await page.evaluate(() => scrollTo(0, 360));
      await page.waitForTimeout(100);
      const sticky = await bar.evaluate(el => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, offset: parseFloat(getComputedStyle(el).top), scroll: scrollY,
          hit: el.contains(document.elementFromPoint(r.x + r.width / 2, r.top + 10)) };
      });
      assert(Math.abs(sticky.top - Math.max(initial.y - sticky.scroll, sticky.offset)) < 2, route + ' sticky position');
      assert(sticky.hit, route + ' date navigation is not covered');
      if (route === '/guests/sheet') {
        const toolbar = await page.locator('.booking-grid-controls').boundingBox();
        assert(toolbar.y >= sticky.bottom - 1, 'Sheet controls do not cover date navigation');
      }
      const file = route.slice(1).replaceAll('/', '-') + '-sticky-' + width + '.png';
      await page.screenshot({ path: path.join(out, file) }); shots.push(file);
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(cloud, []);
  await writeFile(path.join(out, 'measurements.json'), JSON.stringify(measurements, null, 2));
  await writeFile(path.join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Shared Date Navigation</title><style>body{font:14px system-ui;margin:20px;background:#faf8f9}img{max-width:100%}section{margin:24px 0}</style><h1>Shared Date Navigation</h1>' + shots.map(file => '<section><h2>' + file + '</h2><img loading="lazy" src="' + file + '"></section>').join(''));
  console.log('PASS nine connected pages, date/window persistence, all-dates filter, next-week entry, weekly/year boundaries, sticky controls, optional sidebar and ' + shots.length + ' unlocked screenshots. No cloud requests.');
} catch (error) {
  await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true });
  throw error;
} finally { await browser.close(); }
