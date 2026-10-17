import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5175';
assert.equal(new URL(base).hostname, '127.0.0.1');
const out = path.resolve('.qa/screenshots/booking-done');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  for (const slot of ['start', '10', '12']) sessionStorage.setItem('kitchen_pax_global_' + today + '_' + slot, 'dismissed');
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [], cloud = [], shots = [];
page.on('pageerror', e => errors.push(e.message));
page.on('request', r => { if (/supabase\.(co|in)/.test(r.url())) cloud.push(r.url()); });
const button = name => page.getByRole('button', { name, exact: true });
const done = row => page.getByRole('checkbox', { name: 'Done Row ' + row, exact: true });
async function rpc(name, args) {
  return page.evaluate(async ({ name, args }) => {
    const { supabase } = await import('/src/lib/supabase.ts');
    const r = await supabase.rpc(name, args); if (r.error) throw r.error; return r.data;
  }, { name, args });
}
async function saved() {
  await button('Save 1 Row').click();
  await page.waitForFunction(() => [...document.querySelectorAll('[role=status]')].some(el => el.textContent === 'Changes Saved'));
  await button('Save').waitFor();
}
try {
  await page.goto(base);
  assert(await page.evaluate(async () => (await import('/src/lib/supabase.ts')).isDemoMode));
  await button('Austin (Owner)').click();
  const seed = await page.evaluate(async () => {
    const { db, persistDemoDb } = await import('/src/lib/demoBackend.ts');
    const { todayIso } = await import('/src/lib/opsData.ts');
    const today = todayIso(), names = ['Sample Tan Family', 'Sample Lim Group', 'Sample Lee Family'];
    db.bookings = db.bookings.slice(0, 3).map((b, i) => ({ ...b, lead_name: names[i], lead_phone: '', service_date: today }));
    const ids = db.bookings.map(b => b.id), now = new Date().toISOString();
    db.booking_accounts = ids.slice(1).map((id, i) => ({ booking_id: id, amount_due: 200, invoice_number: 'SAMPLE-' + (i + 1), remarks: '', referrer_id: null, commission_method: null, commission_rate: null, commission_pax: 0, commission_base: null, commission_paid: 0, updated_at: now, updated_by: 'u-admin' }));
    db.booking_payments = ids.slice(1).map((id, i) => ({ id: crypto.randomUUID(), booking_id: id, payment_date: today, amount: i ? 200 : 100, kind: 'receipt', reference: 'Sample Receipt', note: '', recorded_by: 'u-admin', created_at: now, voided_at: null }));
    persistDemoDb(); return { today, ids };
  });
  await page.goto(base + '/#/guests/sheet'); await done(1).waitFor();
  if (await button('Hide pax reminder').isVisible()) await button('Hide pax reminder').click();
  await page.getByRole('group', { name: 'Visible Columns', exact: true }).getByRole('button', { name: 'Payments', exact: true }).click();
  assert.equal(await done(1).isChecked(), false, 'Unknown total is not assumed paid');
  assert.equal(await done(2).isChecked(), false, 'Partial payment is not assumed complete');
  assert.equal(await done(3).isChecked(), true, 'Existing fully paid bookings retain their tick');
  const before = await rpc('read_booking_accounts', { p_date: seed.today });
  await done(1).check(); await saved(); await page.reload(); await done(1).waitFor();
  assert(await done(1).isChecked(), 'Tick persists after reload');
  let accounts = await rpc('read_booking_accounts', { p_date: seed.today });
  assert.equal(accounts.accounts.find(a => a.booking_id === seed.ids[0]).amount_due, null);
  assert.deepEqual(accounts.payments, before.payments, 'Tick creates no payment and changes no amounts');
  await done(3).uncheck(); await saved(); await page.reload(); await done(3).waitFor();
  assert.equal(await done(3).isChecked(), false, 'Explicit untick survives a fully paid calculation');
  accounts = await rpc('read_booking_accounts', { p_date: seed.today });
  assert.equal(accounts.accounts.find(a => a.booking_id === seed.ids[2]).amount_due, 200);
  assert.deepEqual(accounts.payments, before.payments);
  // Keyboard and Excel paste operate the same checkbox, without a new dialog.
  await done(3).focus(); await done(3).press('Space'); await saved();
  await done(2).evaluate(el => {
    const data = new DataTransfer(); data.setData('text/plain', 'Done');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  assert(await done(2).isChecked()); await saved();
  accounts = await rpc('read_booking_accounts', { p_date: seed.today });
  const totals = await page.evaluate(async a => {
    const { accountTotals } = await import('/src/lib/bookingOperations.ts');
    return a.accounts.map(account => ({ id: account.booking_id, ...accountTotals(account, a.payments.filter(p => p.booking_id === account.booking_id)) }));
  }, accounts);
  assert.equal(totals.find(t => t.id === seed.ids[1]).status, 'Partial');
  assert.equal(totals.find(t => t.id === seed.ids[1]).balance, 100, 'Done never clears an unpaid balance');
  assert.equal(totals.find(t => t.id === seed.ids[0]).status, 'Total Not Entered');
  const log = await rpc('read_booking_change_log', { p_booking_id: seed.ids[0] });
  assert(log.some(entry => entry.action === 'booking_finance_sheet' && entry.details.payment_done === true && entry.actor && entry.created_at));
  await done(2).uncheck(); await saved();
  // An older device cannot overwrite a newer checkbox decision.
  const sheet = await rpc('read_daily_booking_sheet', { p_date: seed.today });
  accounts = await rpc('read_booking_accounts', { p_date: seed.today });
  await done(1).uncheck();
  await rpc('save_booking_spreadsheet', { p_date: seed.today, p_request_id: crypto.randomUUID(), p_resources: {}, p_rows: [{ key: seed.ids[0], id: seed.ids[0], number: 1, expected: sheet.bookings.find(b => b.id === seed.ids[0]).updated_at, account_expected: accounts.accounts.find(a => a.booking_id === seed.ids[0]).updated_at, booking: {}, assignment: {}, finance: { payment_done: true } }] });
  await button('Save 1 Row').click(); await page.getByRole('alert').filter({ hasText: /Changed on another device/i }).waitFor();
  assert.equal((await rpc('read_booking_accounts', { p_date: seed.today })).accounts.find(a => a.booking_id === seed.ids[0]).payment_done, true);
  page.once('dialog', d => d.accept()); await button('Discard Changes').click(); await page.reload(); await done(1).waitFor();
  const invalidPaste = await page.evaluate(async () => {
    const { gridPayload, gridRows } = await import('/src/lib/bookingGrid.ts');
    const { supabase } = await import('/src/lib/supabase.ts');
    const { todayIso } = await import('/src/lib/opsData.ts');
    const date = todayIso(), { data: sheet } = await supabase.rpc('read_daily_booking_sheet', { p_date: date }), { data: accounts } = await supabase.rpc('read_booking_accounts', { p_date: date });
    const rows = gridRows(sheet, accounts); rows[0].values.paid = 'unknown';
    try { gridPayload(rows, sheet, accounts, date); return ''; } catch (e) { return e.message; }
  });
  assert.match(invalidPaste, /Done must be ticked or unticked/);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width < 640 ? 844 : 900 });
    if (await button('Hide pax reminder').isVisible()) await button('Hide pax reminder').click();
    await page.getByRole('group', { name: 'Visible Columns', exact: true }).getByRole('button', { name: 'Payments', exact: true }).click();
    await done(1).evaluate(el => el.blur()); await done(1).focus(); await page.waitForTimeout(150);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const box = await done(1).boundingBox(); assert(box.width >= 15 && box.height >= 15);
    assert(await done(1).evaluate(el => {
      const box=el.getBoundingClientRect(); return document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)===el;
    }), 'Done stays visible and clickable beside the pinned name');
    assert.equal(await page.getByText('Amount Not Set', { exact: true }).count(), 0);
    const file = 'payment-checkbox-' + width + '.png'; await page.screenshot({ path: path.join(out, file) }); shots.push(file);
  }
  await page.getByRole('tab', { name: 'Accounts', exact: true }).click();
  await page.getByText('Total Not Entered', { exact: true }).waitFor();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width < 640 ? 844 : 900 });
    await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(120);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const file = 'clear-payment-status-' + width + '.png'; await page.screenshot({ path: path.join(out, file) }); shots.push(file);
  }
  assert.deepEqual(errors, []); assert.deepEqual(cloud, []);
  await writeFile(path.join(out, 'index.html'), '<!doctype html><meta name="viewport" content="width=device-width"><title>Payment Checkboxes</title><style>body{font:14px system-ui;background:#faf8f9}img{max-width:100%}</style>' + shots.map(f => '<h2>' + f + '</h2><img src="' + f + '">').join(''));
  console.log('PASS payment checkbox save/reload, untick, keyboard, Excel paste, no invented payments, balance preservation, audit, stale-device rejection, clear payment status and six unlocked screenshots. No cloud requests.');
} catch (error) { await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }); throw error; }
finally { await browser.close(); }
