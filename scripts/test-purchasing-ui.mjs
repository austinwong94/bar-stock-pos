import assert from 'node:assert/strict';
import path from 'node:path';

export async function testPurchaseBatches(browser, url, out) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const shots = async (name, dialog = true) => {
    for (const width of [390, 320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: width === 320 ? 640 : width === 1024 ? 768 : width === 768 ? 1024 : width < 768 ? 844 : 1000 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ' fits at ' + width);
      if (dialog) {
        const sizes = await page.getByRole('dialog').locator('button:visible, input:not([type="checkbox"]):visible').evaluateAll(nodes => nodes.filter(node => node.getBoundingClientRect().height < 43.5).map(node => node.outerHTML));
        assert.deepEqual(sizes, [], name + ' has 44px targets');
        assert(await page.getByRole('dialog').locator('footer').evaluate(node => node.getBoundingClientRect().bottom <= innerHeight && node.getBoundingClientRect().top >= 0), name + ' keeps confirmation visible');
        assert(await page.getByRole('dialog').evaluate(node => node.scrollWidth <= node.clientWidth + 1), name + ' has no hidden horizontal overflow');
        const supplier = page.getByLabel('Supplier (Optional)', { exact: true });
        if (await supplier.count()) {
          const first = await supplier.boundingBox();
          const second = await page.getByLabel('Receipt No. (Optional)', { exact: true }).boundingBox();
          assert(Math.abs(first.y - second.y) < 1 && Math.abs(first.height - second.height) < 1, 'Supplier and receipt fields align at ' + width);
        }
      }
      await page.screenshot({ path: path.join(out, `${name}-${width}.png`), animations: 'disabled' });
    }
    await page.setViewportSize({ width: 390, height: 844 });
  };
  try {
    await page.goto(url);
    assert(await page.evaluate(async () => (await import('/src/lib/supabase.ts')).isDemoMode), 'Purchase tests never use cloud data');
    await page.getByRole('button', { name: /Austin \(Owner\)/ }).click();
    await page.locator('main').waitFor();
    await page.waitForTimeout(250);
    if (await page.getByRole('button', { name: 'Later', exact: true }).count()) await page.getByRole('button', { name: 'Later', exact: true }).click();
    const fixture = await page.evaluate(async () => {
      const { supabase } = await import('/src/lib/supabase.ts');
      const { db } = await import('/src/lib/demoBackend.ts');
      const names = ['Blue Swimming Crab', 'Fresh Squid', 'Tiger Prawns', 'Red Snapper', 'Onions', 'Garlic', 'Fresh Ginger', 'Bird Eye Chillies', 'Limes', 'Tomatoes'];
      const items = Array.from({ length: 50 }, (_, index) => ({ item_name: index < names.length ? names[index] : `Kitchen Ingredient ${index + 1}`, quantity: index % 5 + 2, unit: 'kg' }));
      const draft = await supabase.rpc('save_purchase_request', { p_request: { needed_for_date: '2026-11-03', pax_count: 100, purpose: 'Morning Kitchen Market Run', _request_id: crypto.randomUUID() }, p_items: items });
      if (draft.error) throw draft.error;
      const request = db.purchase_requests.find(row => row.id === draft.data);
      const sent = await supabase.rpc('submit_purchase_request_checked', { p_request_id: request.id, p_expected_updated_at: request.updated_at });
      if (sent.error) throw sent.error;
      return { id: request.id, no: request.request_no };
    });
    await page.goto(url + '/#/purchasing');
    await page.getByLabel('Search purchases').fill(fixture.no);
    await page.waitForTimeout(350);
    if (await page.getByRole('button', { name: 'Hide pax reminder', exact: true }).count()) await page.getByRole('button', { name: 'Hide pax reminder', exact: true }).click();
    await shots('purchase-batch-list', false);
    await page.getByRole('button', { name: 'Record Purchases', exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: /^Bought:/ }).count(), 50, 'All 50 items are editable together');
    assert.equal(await page.getByLabel('Bought: Blue Swimming Crab (kg)', { exact: true }).inputValue(), '', 'Bought quantities start blank, never prefilled with the request');
    await shots('purchase-batch-entry');
    await page.getByLabel('Supplier (Optional)', { exact: true }).fill('Pasar Besar');
    await page.getByLabel('Receipt No. (Optional)', { exact: true }).fill('INV-091');
    await page.getByLabel('Bought: Blue Swimming Crab (kg)', { exact: true }).fill('8');
    await page.getByLabel('Bought: Fresh Squid (kg)', { exact: true }).fill('4.5');
    await page.getByLabel('Bought: Tiger Prawns (kg)', { exact: true }).fill('0');
    assert(await page.getByRole('button', { name: 'Review (3)', exact: true }).isDisabled(), 'An entered zero cannot be skipped silently');
    await page.getByLabel('Bought: Tiger Prawns (kg)', { exact: true }).fill('3');
    await page.getByLabel('Find Item', { exact: true }).fill('Ingredient 50');
    await page.getByLabel('Bought: Kitchen Ingredient 50 (kg)', { exact: true }).fill('2');
    assert.equal(await page.getByRole('textbox', { name: /^Bought:/ }).count(), 1, 'Search reduces the visible entry list');
    await page.getByLabel('Find Item', { exact: true }).fill('');
    assert.equal(await page.getByLabel('Bought: Fresh Squid (kg)', { exact: true }).inputValue(), '4.5', 'Filtering preserves hidden entries');
    await page.getByRole('checkbox', { name: 'Add Costs', exact: true }).check();
    await page.getByLabel('Total Cost: Blue Swimming Crab (MYR)', { exact: true }).fill('192');
    await page.getByLabel('Total Cost: Fresh Squid (MYR)', { exact: true }).fill('99');
    await page.getByLabel('Total Cost: Tiger Prawns (MYR)', { exact: true }).fill('108');
    await page.getByLabel('Supplier (Optional)', { exact: true }).scrollIntoViewIfNeeded();
    await shots('purchase-batch-costs');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Keep Editing', exact: true }).click();
    assert.equal(await page.getByLabel('Bought: Fresh Squid (kg)', { exact: true }).inputValue(), '4.5', 'Accidental dismiss cannot silently lose entered purchases');
    await page.getByRole('button', { name: 'Review (4)', exact: true }).click();
    assert.equal(await page.getByRole('dialog').locator('li').count(), 4, 'Review contains only actual entered items');
    assert(await page.getByRole('button', { name: 'Confirm Purchase', exact: true }).isDisabled(), 'Final confirmation requires an explicit check');
    await shots('purchase-batch-review');
    await page.getByRole('checkbox', { name: 'I checked the items and quantities bought.', exact: true }).check();
    await page.evaluate(async () => {
      const { supabase } = await import('/src/lib/supabase.ts');
      window.purchaseOriginalRpc = supabase.rpc.bind(supabase);
      let interrupted = false;
      supabase.rpc = async (name, args) => {
        const result = await window.purchaseOriginalRpc(name, args);
        if (name === 'record_purchase_batch_checked' && !interrupted) {
          interrupted = true;
          if (result.error) throw result.error;
          return { data: null, error: { message: 'Connection interrupted after confirmation.' } };
        }
        return result;
      };
    });
    await page.getByRole('button', { name: 'Confirm Purchase', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Connection interrupted after confirmation.' }).waitFor();
    assert.equal(await page.getByText('Purchase Recorded', { exact: true }).count(), 0, 'An unverified save does not claim success');
    assert(await page.getByRole('button', { name: 'Back to Entry', exact: true }).isDisabled(), 'A pending retry retains the exact submitted details');
    await page.getByRole('button', { name: 'Retry Confirmation', exact: true }).click();
    await page.getByRole('heading', { name: 'Purchase Recorded', exact: true }).waitFor();
    await shots('purchase-batch-saved');
    const saved = await page.evaluate(async id => {
      const { db } = await import('/src/lib/demoBackend.ts');
      return { records: db.audit_logs.filter(row => row.entity_id === id && row.action === 'record_purchase_batch').length,
        pending: db.purchase_request_items.filter(row => row.request_id === id && row.purchase_status === 'pending').length,
        receipts: (db.purchase_receipts ?? []).filter(receipt => db.purchase_request_items.some(item => item.id === receipt.purchase_item_id && item.request_id === id)).length };
    }, fixture.id);
    assert.deepEqual(saved, { records: 1, pending: 46, receipts: 0 }, 'Retry records one batch, preserves blank items and creates no receipt stock');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.reload();
    await page.getByLabel('Search purchases').fill(fixture.no);
    await page.getByRole('button', { name: 'Records: ' + fixture.no, exact: true }).click();
    await page.getByText('Pasar Besar · INV-091', { exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog').locator('tbody tr').count(), 4, 'Confirmation evidence persists after reload');
    await shots('purchase-batch-history');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Record Purchases', exact: true }).click();
    await page.getByLabel('Bought: Onions (kg)', { exact: true }).fill('5');
    await page.getByLabel('Bought: Garlic (kg)', { exact: true }).fill('2');
    await page.getByRole('button', { name: 'Review (2)', exact: true }).click();
    await page.evaluate(async id => {
      const { db } = await import('/src/lib/demoBackend.ts');
      const { supabase } = await import('/src/lib/supabase.ts');
      const item = db.purchase_request_items.find(row => row.request_id === id && row.item_name === 'Garlic');
      const result = await supabase.rpc('set_purchase_item_status_checked', { p_item_id: item.id, p_expected_updated_at: item.updated_at, p_status: 'unavailable' });
      if (result.error) throw result.error;
    }, fixture.id);
    await page.getByRole('checkbox', { name: 'I checked the items and quantities bought.', exact: true }).check();
    await page.getByRole('button', { name: 'Confirm Purchase', exact: true }).click();
    await page.getByText(/An item changed on another device/).waitFor();
    assert.equal(await page.evaluate(async id => (await import('/src/lib/demoBackend.ts')).db.purchase_request_items.find(row => row.request_id === id && row.item_name === 'Onions').purchase_status, fixture.id), 'pending', 'A conflict on another item does not save valid earlier items');
    await page.getByRole('button', { name: 'Close & Refresh', exact: true }).click();
    await page.evaluate(() => localStorage.setItem('language', 'ms'));
    await page.reload();
    await page.getByLabel('Search purchases').fill(fixture.no);
    await page.waitForTimeout(350);
    await page.getByRole('button', { name: 'Rekod Pembelian', exact: true }).click();
    await page.getByLabel('Dibeli: Onions (kg)', { exact: true }).fill('5');
    await page.getByRole('button', { name: 'Semak (1)', exact: true }).click();
    await shots('purchase-batch-malay');
    assert.deepEqual(errors, [], 'No runtime errors in purchase workflows');
    console.log('PASS 50-item purchase entry, search, explicit confirmation, lost-response retry, history, conflict and Malay/mobile checks');
  } finally { await page.close(); }
}
