import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const url = process.env.UI_TEST_URL || 'http://127.0.0.1:5175';
assert.equal(new URL(url).hostname, '127.0.0.1', 'Only isolated local sample data may be changed');
const out = path.resolve('.qa/screenshots');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
page.setDefaultTimeout(12000);
const errors = [];
page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto(url + '/#/guests/meal-needs');
  await page.locator('[data-meal-guest]').first().waitFor();
  assert(await page.evaluate(async () => (await import('/src/lib/supabase.ts')).isDemoMode));
  for (const label of ['Later', 'Hide pax reminder']) {
    const button = page.getByRole('button', { name: label, exact: true });
    if (await button.isVisible()) await button.click();
  }
  const target = page.locator('[data-meal-guest]').first();
  const id = await target.getAttribute('data-meal-guest');
  const count = await page.locator('[data-meal-guest]').count();
  async function savedChoice(name) {
    await page.waitForFunction(({ id, name }) => Array.from(document.querySelector(`[data-meal-guest="${id}"]`).querySelectorAll('button')).some(b => b.textContent.trim() === name && b.getAttribute('aria-pressed') === 'true' && !b.disabled), { id, name });
    assert.equal(await page.getByRole('dialog').count(), 0, 'No per-guest form or confirmation for a meal choice');
    assert.equal(await page.locator('[data-meal-guest]').count(), count, 'Saved guest stays in the list');
  }
  await page.evaluate(async () => {
    const { supabase } = await import('/src/lib/supabase.ts');
    window.originalMealRpc = supabase.rpc.bind(supabase);
    window.mealAttempts = [];
    supabase.rpc = async (name, args) => {
      if (name === 'save_guest_meal_needs') {
        window.mealAttempts.push(args);
        const result = await window.originalMealRpc(name, args);
        if (window.mealAttempts.length === 1) return { data: null, error: { message: 'Response lost after save' } };
        return result;
      }
      return window.originalMealRpc(name, args);
    };
  });
  await target.getByRole('button', { name: 'Vegetarian', exact: true }).click();
  await target.getByRole('alert').filter({ hasText: 'Save Not Confirmed' }).waitFor();
  await target.getByRole('button', { name: 'Retry Save', exact: true }).click();
  await savedChoice('Vegetarian');
  assert(await page.evaluate(() => JSON.stringify(window.mealAttempts[0]) === JSON.stringify(window.mealAttempts[1])), 'Uncertain saves retry the same payload and token');
  assert.equal(await page.evaluate(async id => (await import('/src/lib/demoBackend.ts')).db.operation_requests.filter(r => r.operation === 'guest_meal_needs' && r.result_id === id).length, id), 1, 'A lost response does not duplicate the saved action');

  await page.evaluate(async id => {
    const { db } = await import('/src/lib/demoBackend.ts');
    const row = db.guest_meal_needs.find(r => r.tourist_id === id);
    row.notes = 'Kitchen confirmed: no peanut oil.';
    row.updated_at = new Date(Date.now() + 100).toISOString();
  }, id);
  await target.getByRole('button', { name: 'Vegan', exact: true }).click();
  await target.getByRole('status').filter({ hasText: 'Changed on another device' }).waitFor();
  assert.match(await target.innerText(), /Kitchen confirmed: no peanut oil/);
  assert.equal(await target.getByRole('button', { name: 'Vegetarian', exact: true }).getAttribute('aria-pressed'), 'true', 'Stale edit does not overwrite the current record');
  await target.getByRole('button', { name: 'Vegan', exact: true }).click();
  await savedChoice('Vegan');

  await page.evaluate(async () => {
    const { supabase } = await import('/src/lib/supabase.ts');
    let failRead = false;
    supabase.rpc = async (name, args) => {
      if (name === 'save_guest_meal_needs') { const result = await window.originalMealRpc(name, args); failRead = true; return result; }
      if (name === 'read_guest_meal_needs' && failRead) { failRead = false; return { data: null, error: { message: 'Refresh failed' } }; }
      return window.originalMealRpc(name, args);
    };
  });
  await target.getByRole('button', { name: 'Standard', exact: true }).click();
  await target.getByRole('alert').filter({ hasText: 'Saved, but refresh failed' }).waitFor();
  await page.evaluate(async () => { const { supabase } = await import('/src/lib/supabase.ts'); supabase.rpc = window.originalMealRpc; });
  await target.getByRole('button', { name: 'Retry Save', exact: true }).click();
  await savedChoice('Standard');

  await page.getByRole('button', { name: 'Allergies', exact: true }).click();
  await target.getByRole('button', { name: 'Shellfish', exact: true }).click();
  await savedChoice('Shellfish');
  await target.getByRole('button', { name: 'Not Asked', exact: true }).click();
  await target.getByRole('button', { name: 'Reset to Not Asked', exact: true }).click();
  await savedChoice('Not Asked');
  assert.equal(await target.getByRole('button', { name: 'None Reported', exact: true }).getAttribute('aria-pressed'), 'false', 'Reset never silently becomes allergy clearance');

  await page.getByRole('button', { name: 'Meal Choices', exact: true }).click();
  await page.evaluate(async () => {
    const { supabase } = await import('/src/lib/supabase.ts');
    supabase.rpc = async (name, args) => { if (name === 'save_guest_meal_needs') await new Promise(resolve => setTimeout(resolve, 500)); return window.originalMealRpc(name, args); };
  });
  await target.getByRole('button', { name: 'Vegetarian', exact: true }).click();
  await page.locator('[data-meal-guest]').nth(1).getByRole('button', { name: 'Standard', exact: true }).click();
  await savedChoice('Vegetarian');
  await page.waitForFunction(() => !Array.from(document.querySelectorAll('[data-meal-guest] [role="status"]')).some(n => n.textContent.includes('Saving...')));
  assert.equal(await page.locator('[data-meal-guest]').nth(1).getByRole('button', { name: 'Standard', exact: true }).getAttribute('aria-pressed'), 'true', 'Different guests can be saved without a page-wide lock');
  await page.evaluate(async () => { const { supabase } = await import('/src/lib/supabase.ts'); supabase.rpc = window.originalMealRpc; });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'BM', exact: true }).first().click();
  await page.getByRole('button', { name: 'Alahan', exact: true }).click();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const small = await page.locator('[data-meal-guest] button:visible').evaluateAll(nodes => nodes.filter(n => n.getBoundingClientRect().height < 43.5).map(n => n.textContent));
    assert.deepEqual(small, [], '44px touch targets');
    await page.screenshot({ path: path.join(out, `direct-allergies-malay-${width}.png`) });
  }
  assert.deepEqual(errors, []);
  console.log('Passed: one-tap saves, preserved names, lost-response retry, stale-device conflict, read-after-save failure, parallel guests, safe allergy reset, Malay responsive layout.');
} catch (e) { await page.screenshot({ path: path.join(out, 'direct-meals-failure.png'), fullPage: true }); throw e; }
finally { await browser.close(); }
