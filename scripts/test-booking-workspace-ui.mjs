import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5175';
assert.equal(new URL(base).hostname, '127.0.0.1');
const out = path.resolve('.qa/screenshots/booking-workspace');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  for (const slot of ['start', '10', '12']) sessionStorage.setItem('kitchen_pax_global_' + today + '_' + slot, 'dismissed');
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [], cloud = [], shots = [], metrics = [];
page.on('pageerror', e => errors.push(e.message));
page.on('request', r => { if (/supabase\.(co|in)/.test(r.url())) cloud.push(r.url()); });
const button = name => page.getByRole('button', { name, exact: true });
const firstName = () => page.getByLabel('Guest Name Row 1', { exact: true });
async function ready() {
  await firstName().waitFor();
  await page.waitForTimeout(200);
  if (await button('Hide pax reminder').isVisible()) await button('Hide pax reminder').click();
}
async function measure(name, width) {
  await page.setViewportSize({ width, height: width < 640 ? 844 : 900 });
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(120);
  const result = await page.evaluate(() => {
    const toolbar = document.querySelector('.booking-grid-controls'), table = document.querySelector('.booking-grid-scroll');
    const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    const overflow = [...document.querySelectorAll('.booking-grid-toolbar button, .booking-mobile-columns button, .service-date-navigation button, .booking-workspace-heading button')]
      .filter(visible).filter(el => el.getBoundingClientRect().right > innerWidth + 1 || el.getBoundingClientRect().left < -1 || el.scrollWidth > el.clientWidth + 1).map(el => el.getAttribute('aria-label') || el.textContent);
    const headerHeight = parseFloat(getComputedStyle(toolbar).getPropertyValue('--workspace-header-height')) || 0;
    return { width: innerWidth, scroll: document.documentElement.scrollWidth, tableTop: table.getBoundingClientRect().top, toolbarHeight: toolbar.getBoundingClientRect().height, headerHeight, overflow };
  });
  assert(result.scroll <= width + 1, name + ' horizontal page overflow');
  assert.deepEqual(result.overflow, [], name + ' control clipping');
  assert(result.tableTop <= (width === 1440 ? 270 + result.headerHeight : width < 640 ? 460 : 475), name + ' too much space before sheet: ' + JSON.stringify(result));
  assert(result.toolbarHeight <= (width < 640 ? 80 : width === 1440 ? 78 : 120), name + ' oversized sticky tools');
  const options = page.getByRole('group', { name: 'Visible Columns', exact: true });
  assert.equal(await options.count(), 1, 'Only one accessible column selector');
  assert.equal(await options.getByRole('button').count(), 4);
  metrics.push({ name, ...result });
  const file = name + '-' + width + '.png'; await page.screenshot({ path: path.join(out, file) }); shots.push(file);
}
try {
  await page.goto(base);
  assert(await page.evaluate(async () => (await import('/src/lib/supabase.ts')).isDemoMode));
  await button('Austin (Owner)').click();
  await page.goto(base + '/#/guests/sheet'); await ready();
  for (const width of [320, 390, 768, 1024, 1440]) await measure('booking-sheet', width);
  // Focus follows the row without changing any record.
  await firstName().focus();
  const fill = await firstName().evaluate(el => {
    const row = el.closest('tr'); return [getComputedStyle(row.cells[2]).backgroundColor, getComputedStyle(row.querySelector('.grid-name-cell')).backgroundColor];
  });
  assert.equal(fill[0], fill[1], 'Pinned and unpinned cells share the selected-row colour');
  assert.notEqual(fill[0], 'rgb(255, 255, 255)', 'Focused row is visible');
  const prefs = await page.evaluate(() => localStorage.getItem('lovely-paradise:booking-sheet-view:v1'));
  // A pinned name must stay readable at the far-right columns, even on phones.
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(120);
    await page.locator('.booking-grid-scroll').evaluate(el => { el.scrollLeft = el.scrollWidth; });
    await page.waitForTimeout(100);
    const pinned = await firstName().evaluate(el => {
      const cell = el.closest('td').getBoundingClientRect(), frame = el.closest('.booking-grid-scroll').getBoundingClientRect();
      return { left: cell.left, right: cell.right, width: cell.width, frameLeft: frame.left, frameRight: frame.right };
    });
    assert(pinned.left >= pinned.frameLeft && pinned.right < pinned.frameRight, 'Name remains visible at ' + width);
    if (width < 640) assert(pinned.width <= width * .45, 'Name does not consume the whole phone sheet');
    const file = 'names-pinned-' + width + '.png'; await page.screenshot({ path: path.join(out, file) }); shots.push(file);
    await page.locator('.booking-grid-scroll').evaluate(el => { el.scrollLeft = 0; });
  }
  assert.equal(await page.evaluate(() => localStorage.getItem('lovely-paradise:booking-sheet-view:v1')), prefs, 'Responsive width does not overwrite local sizing preferences');
  await page.setViewportSize({ width: 390, height: 640 });
  await page.evaluate(() => scrollTo(0, 360)); await page.waitForTimeout(120);
  const pinnedTools = await page.locator('.booking-grid-controls').boundingBox();
  const dateBar = await page.locator('.service-date-navigation').boundingBox();
  assert(pinnedTools.y >= dateBar.y + dateBar.height - 1, 'Date and tools never overlap');
  assert(pinnedTools.y + pinnedTools.height < 310, 'Most of the phone remains available for rows');
  assert(await button('Save').isVisible()); assert(await button('Add Rows').isVisible());
  const mobileColumns = await page.locator('.booking-mobile-columns').boundingBox();
  assert(mobileColumns.y + mobileColumns.height <= dateBar.y + dateBar.height, 'Secondary column choices scroll away');
  await page.screenshot({ path: path.join(out, 'mobile-scrolling.png') }); shots.push('mobile-scrolling.png');
  await page.evaluate(() => scrollTo(0, 0));
  await button('Expand Sheet').click();
  for (const width of [390, 1440]) await measure('expanded-sheet', width);
  await button('Exit Wide View').click();
  await page.setViewportSize({ width: 768, height: 900 });
  await button('Show Sidebar').click(); await measure('tablet-sidebar-open', 768);
  await button('Hide Sidebar').click();
  // Direct section changes preserve unsaved edits; this is sample data only.
  const before = await firstName().inputValue(); await firstName().fill(before + ' Sample Edit');
  for (const name of ['Bookings', 'Assignments', 'Payments', 'Full Template']) {
    await page.getByRole('group', { name: 'Visible Columns', exact: true }).getByRole('button', { name, exact: true }).click();
    assert.equal(await firstName().inputValue(), before + ' Sample Edit');
  }
  page.once('dialog', d => d.accept()); await button('Discard Changes').click(); await ready();
  for (const name of ['List', 'Boats & Vans', 'Accounts', 'Spreadsheet']) {
    await page.getByRole('tab', { name, exact: true }).click(); await page.waitForTimeout(150);
    assert.equal(await page.locator('.service-date-navigation').count(), 1);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
  await ready(); await button('Weekly').click(); await page.locator('tbody[data-sheet-date]').first().waitFor();
  await measure('weekly-sheet', 390); await measure('weekly-sheet', 1440);
  await button('Daily').click(); await ready();
  await page.evaluate(() => localStorage.setItem('language', 'ms')); await page.reload(); await ready();
  for (const width of [320, 390, 768, 1440]) await measure('malay-sheet', width);
  assert.deepEqual(errors, []); assert.deepEqual(cloud, []);
  await writeFile(path.join(out, 'metrics.json'), JSON.stringify(metrics, null, 2));
  await writeFile(path.join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Booking Workspace Review</title><style>body{font:14px system-ui;margin:20px;background:#faf8f9}img{max-width:100%}section{margin:24px 0}</style><h1>Booking Workspace Review</h1>' + shots.map(file => '<section><h2>' + file + '</h2><img loading="lazy" src="' + file + '"></section>').join(''));
  console.log('PASS cleaner toolbar, desktop/tablet/phone, pinned names, row focus, local resizing, weekly view, draft retention, English/Malay, and ' + shots.length + ' unlocked screenshots. No cloud requests.');
} catch (error) { await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }); throw error; }
finally { await browser.close(); }
