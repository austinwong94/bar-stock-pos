import assert from 'node:assert/strict';
import path from 'node:path';

export async function testDeliveryBatches(browser, url, out) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const shots = async (name, dialog = true) => {
    for (const width of [390, 320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: width === 320 ? 640 : width === 1024 ? 768 : width === 768 ? 1024 : width < 768 ? 844 : 1000 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ' fits at ' + width);
      if (dialog) {
        const surface = page.getByRole('dialog');
        const short = await surface.locator('button:visible,input:not([type="checkbox"]):visible,select:visible').evaluateAll(nodes => nodes.filter(node => node.getBoundingClientRect().height < 43.5).map(node => node.outerHTML));
        assert.deepEqual(short, [], name + ' retains 44px touch controls');
        assert(await surface.locator('footer').evaluate(node => node.getBoundingClientRect().bottom <= innerHeight && node.getBoundingClientRect().top >= 0), name + ' keeps the confirmation footer visible');
        assert(await surface.evaluate(node => node.scrollWidth <= node.clientWidth + 1), name + ' does not clip content horizontally');
      }
      await page.screenshot({ path: path.join(out, `${name}-${width}.png`), animations: 'disabled' });
    }
    await page.setViewportSize({ width: 390, height: 844 });
  };
  try {
    await page.goto(url);
    assert(await page.evaluate(async () => (await import('/src/lib/supabase.ts')).isDemoMode), 'Delivery tests use isolated local data only');
    await page.getByRole('button', { name: /Austin \(Owner\)/ }).click();
    await page.locator('main').waitFor();
    await page.waitForTimeout(250);
    if (await page.getByRole('button', { name: 'Later', exact: true }).count()) await page.getByRole('button', { name: 'Later', exact: true }).click();
    const fixture = await page.evaluate(async () => {
      const { supabase } = await import('/src/lib/supabase.ts');
      const { db } = await import('/src/lib/demoBackend.ts');
      const { loadLocalIngredientItems, saveLocalIngredientItem } = await import('/src/lib/localStore.ts');
      const names = ['Blue Swimming Crab', 'Fresh Squid', 'Tiger Prawns', 'Gin', 'Onions', 'Garlic', 'Tonic'];
      const baseItems = loadLocalIngredientItems();
      const catalogue = [];
      const requestItems = Array.from({ length: 50 }, (_, index) => {
        const name = names[index] ?? (index === 49 ? 'Ice Cubes' : `Kitchen Ingredient ${index + 1}`);
        const unit = index === 3 ? 'bottle' : index === 5 ? 'pack' : index === 6 ? 'l' : 'kg';
        const ingredientName = index === 49 ? 'Market Ice Cubes' : name;
        const ingredient = baseItems.find(row => row.name === ingredientName) ?? saveLocalIngredientItem({ name: ingredientName, category: index === 3 ? 'Liquor' : 'Food', base_unit: [3, 6].includes(index) ? 'ml' : 'g', default_pack_size: 1000, pack_label: 'Pack' });
        catalogue.push(ingredient);
        return { item_name: name, quantity: 10, unit };
      });
      saveLocalIngredientItem({ name: 'Kitchen Ingredient 49', category: 'Food', base_unit: 'g', default_pack_size: 1000 });
      const saved = await supabase.rpc('save_purchase_request', { p_request: { needed_for_date: '2026-11-04', pax_count: 100, purpose: 'Kitchen and Bar Delivery', _request_id: crypto.randomUUID() }, p_items: requestItems });
      if (saved.error) throw saved.error;
      const request = db.purchase_requests.find(row => row.id === saved.data);
      const submitted = await supabase.rpc('submit_purchase_request_checked', { p_request_id: request.id, p_expected_updated_at: request.updated_at });
      if (submitted.error) throw submitted.error;
      const bought = await supabase.rpc('record_purchase_batch_checked', { p_request_id: request.id, p_operation_id: crypto.randomUUID(), p_supplier: 'Morning Market Delivery', p_reference: 'DEL-104', p_items: db.purchase_request_items.filter(row => row.request_id === request.id).map(row => ({ id: row.id, expected_updated_at: row.updated_at, quantity: 10, actual_cost: null })) });
      if (bought.error) throw bought.error;
      return { id: request.id, no: request.request_no, ginId: catalogue[3].id, crabId: catalogue[0].id, startingGin: catalogue[3].ingredient_balances.quantity_on_hand };
    });
    await page.goto(url + '/#/purchasing');
    await page.getByRole('tab', { name: /^To Receive / }).click();
    await page.getByLabel('Search purchases').fill(fixture.no);
    await page.waitForTimeout(350);
    if (await page.getByRole('button', { name: 'Hide pax reminder', exact: true }).count()) await page.getByRole('button', { name: 'Hide pax reminder', exact: true }).click();
    await shots('delivery-batch-list', false);
    await page.getByRole('button', { name: 'Receive Delivery', exact: true }).click();
    await page.getByRole('textbox', { name: /^Delivered:/ }).first().waitFor();
    assert.equal(await page.getByRole('textbox', { name: /^Delivered:/ }).count(), 50, 'All 50 bought items can be received together');
    assert.equal(await page.getByLabel('Delivered: Blue Swimming Crab (kg)', { exact: true }).inputValue(), '', 'Delivery amounts are not assumed from the purchase');
    assert(await page.getByText('Not Confirmed', { exact: true }).isVisible(), 'Entry clearly distinguishes unsaved stock from confirmed arrivals');
    await shots('delivery-batch-entry');
    await page.getByLabel('Delivered: Blue Swimming Crab (kg)', { exact: true }).fill('3.5');
    await page.getByLabel('Delivered: Fresh Squid (kg)', { exact: true }).fill('4');
    await page.getByLabel('Delivered: Tiger Prawns (kg)', { exact: true }).fill('6');
    await page.getByLabel('Delivered: Gin (bottle)', { exact: true }).fill('2');
    await page.getByRole('button', { name: 'Check Items (1)', exact: true }).click();
    assert.equal(await page.getByLabel('Inventory Item', { exact: true }).inputValue(), fixture.ginId, 'Unique exact inventory names are suggested');
    assert.equal(await page.getByLabel('ml per bottle', { exact: true }).inputValue(), '', 'Bottle size is never guessed from the inventory default');
    await page.getByLabel('ml per bottle', { exact: true }).fill('500');
    await page.getByLabel('Find Delivery Item', { exact: true }).fill('Gin');
    await shots('delivery-batch-pack-size');
    await page.getByLabel('Find Delivery Item', { exact: true }).fill('Ingredient 49');
    await page.getByRole('button', { name: 'Delivery Details: Kitchen Ingredient 49', exact: true }).click();
    assert.equal(await page.getByLabel('Inventory Item', { exact: true }).inputValue(), '', 'Ambiguous exact names are not automatically selected');
    await page.getByLabel('Find Delivery Item', { exact: true }).fill('Ice Cubes');
    await page.getByLabel('Delivered: Ice Cubes (kg)', { exact: true }).fill('0.5');
    await page.getByRole('button', { name: 'Check Items (1)', exact: true }).click();
    assert.equal(await page.getByLabel('Inventory Item', { exact: true }).inputValue(), '', 'Different names are not fuzzy-matched into inventory');
    await page.getByLabel('Inventory Item', { exact: true }).selectOption({ label: 'Market Ice Cubes (g)' });
    await page.getByLabel('Find Delivery Item', { exact: true }).fill('');
    assert.equal(await page.getByLabel('Delivered: Fresh Squid (kg)', { exact: true }).inputValue(), '4', 'Search does not erase hidden delivery quantities');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Keep Editing', exact: true }).click();
    await page.evaluate(async () => {
      const { supabase } = await import('/src/lib/supabase.ts');
      const original = supabase.rpc.bind(supabase);
      let interrupted = false;
      supabase.rpc = async (name, args) => {
        const result = await original(name, args);
        if (name === 'save_delivery_draft' && !interrupted && !result.error) { interrupted = true; return { data: null, error: { message: 'Draft response interrupted.' } }; }
        return result;
      };
    });
    await page.getByRole('button', { name: 'Review (5)', exact: true }).click();
    await page.getByText('Draft response interrupted.', { exact: true }).waitFor();
    assert(await page.getByLabel('Delivered: Fresh Squid (kg)', { exact: true }).isDisabled(), 'An uncertain save keeps the same draft payload for its retry');
    await page.getByRole('button', { name: 'Retry Draft Save', exact: true }).click();
    await page.getByRole('heading', { name: 'Review Delivery', exact: true }).waitFor();
    const draftState = await page.evaluate(async fixture => {
      const { db } = await import('/src/lib/demoBackend.ts');
      const draft = db.delivery_drafts.find(row => row.request_id === fixture.id);
      return { id: draft.id, count: db.delivery_drafts.filter(row => row.request_id === fixture.id).length, version: draft.version,
        receipts: (db.purchase_receipts ?? []).filter(row => db.purchase_request_items.some(item => item.id === row.purchase_item_id && item.request_id === fixture.id)).length };
    }, fixture);
    assert.deepEqual({ count: draftState.count, version: draftState.version, receipts: draftState.receipts }, { count: 1, version: 1, receipts: 0 }, 'Review saves one recoverable draft without receiving any stock');
    assert(await page.getByText('Not Received. No stock added.', { exact: true }).isVisible(), 'Saved draft cannot be mistaken for received inventory');
    await shots('delivery-draft-review');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('region', { name: 'Unconfirmed Deliveries', exact: true }).waitFor();
    await shots('delivery-draft-inbox', false);
    await page.reload();
    await page.getByRole('button', { name: 'Open Draft: ' + draftState.id, exact: true }).click();
    await page.getByRole('heading', { name: 'Review Delivery', exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog').locator('li').count(), 5, 'Closing and reloading reopens every saved delivery item');
    assert(await page.getByRole('button', { name: 'Confirm Delivery', exact: true }).isDisabled(), 'Reopened drafts require a new explicit confirmation');
    await shots('delivery-draft-resumed');
    await page.getByRole('button', { name: 'Back to Delivery Entry', exact: true }).click();
    await page.getByLabel('Delivered: Fresh Squid (kg)', { exact: true }).fill('4.5');
    await page.getByRole('button', { name: 'Review (5)', exact: true }).click();
    await page.getByRole('heading', { name: 'Review Delivery', exact: true }).waitFor();
    assert.equal(await page.evaluate(async id => (await import('/src/lib/demoBackend.ts')).db.delivery_drafts.find(row => row.id === id).version, draftState.id), 2, 'Edited draft keeps its identity and records a new version');
    assert.equal(await page.getByRole('dialog').locator('li').count(), 5, 'Only entered arrivals appear in the review');
    assert(await page.getByText('Stock to Add', { exact: true }).isVisible(), 'Review does not claim the stock has already been added');
    assert(await page.getByRole('button', { name: 'Confirm Delivery', exact: true }).isDisabled(), 'Delivery stock cannot move without explicit confirmation');
    assert(await page.getByText('2 bottle × 500 ml', { exact: true }).isVisible(), 'Review shows the actual bottle conversion');
    assert(await page.getByText('Market Ice Cubes', { exact: true }).isVisible(), 'Review identifies the selected inventory target');
    await shots('delivery-batch-review');
    await page.getByRole('checkbox', { name: 'I checked the items, delivered quantities and pack sizes.', exact: true }).check();
    await page.evaluate(async () => {
      const { supabase } = await import('/src/lib/supabase.ts');
      const original = supabase.rpc.bind(supabase);
      let interrupted = false;
      supabase.rpc = async (name, args) => {
        const result = await original(name, args);
        if (name === 'confirm_delivery_draft' && !interrupted && !result.error) {
          interrupted = true;
          return { data: null, error: { message: 'Connection interrupted after recording delivery.' } };
        }
        return result;
      };
    });
    await page.getByRole('button', { name: 'Confirm Delivery', exact: true }).click();
    await page.getByText('Connection interrupted after recording delivery.', { exact: true }).waitFor();
    assert(await page.getByRole('button', { name: 'Back to Delivery Entry', exact: true }).isDisabled(), 'An uncertain retry keeps the original delivery payload');
    await page.getByRole('button', { name: 'Retry Confirmation', exact: true }).click();
    await page.getByRole('heading', { name: 'Delivery Recorded', exact: true }).waitFor();
    await shots('delivery-batch-saved');
    const balanceState = await page.evaluate(async fixture => {
      const { db } = await import('/src/lib/demoBackend.ts');
      const { loadLocalIngredientItems } = await import('/src/lib/localStore.ts');
      const ingredients = loadLocalIngredientItems();
      return { evidence: db.audit_logs.filter(row => row.entity_id === fixture.id && row.action === 'receive_purchase_batch').length,
        gin: ingredients.find(row => row.id === fixture.ginId).ingredient_balances.quantity_on_hand,
        crab: ingredients.find(row => row.id === fixture.crabId).ingredient_balances.quantity_on_hand };
    }, fixture);
    assert.deepEqual(balanceState, { evidence: 1, gin: fixture.startingGin + 1000, crab: 3500 }, 'A lost-response retry adds stock exactly once');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.reload();
    await page.getByLabel('Search purchases').fill(fixture.no);
    await page.waitForTimeout(350);
    await page.getByRole('tabpanel').locator('li').filter({ has: page.getByText('Gin', { exact: true }) }).getByRole('button', { name: /Receipts/ }).click();
    await page.getByText('+1,000 ml', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Receive Delivery', exact: true }).click();
    await page.getByLabel('Delivered: Blue Swimming Crab (kg)', { exact: true }).fill('1');
    await page.getByLabel('Delivered: Gin (bottle)', { exact: true }).fill('1');
    await page.getByRole('button', { name: 'Check Items (1)', exact: true }).click();
    assert.equal(await page.getByLabel('ml per bottle', { exact: true }).inputValue(), '', 'Later deliveries must enter their actual pack size again');
    await page.getByLabel('ml per bottle', { exact: true }).fill('1000');
    await page.getByRole('button', { name: 'Review (2)', exact: true }).click();
    await page.getByRole('heading', { name: 'Review Delivery', exact: true }).waitFor();
    await page.evaluate(async fixture => {
      const { supabase } = await import('/src/lib/supabase.ts');
      const { db } = await import('/src/lib/demoBackend.ts');
      const item = db.purchase_request_items.find(row => row.request_id === fixture.id && row.item_name === 'Gin');
      const received = db.purchase_receipts.filter(row => row.purchase_item_id === item.id).reduce((sum, row) => sum + row.purchase_quantity, 0);
      const result = await supabase.rpc('receive_purchase_batch_checked', { p_request_id: fixture.id, p_operation_id: crypto.randomUUID(), p_items: [{ item_id: item.id, ingredient_id: fixture.ginId, quantity: 1, base_per_unit: 500, expected_updated_at: item.updated_at, expected_received_quantity: received, expected_base_unit: 'ml' }] });
      if (result.error) throw result.error;
    }, fixture);
    await page.getByRole('checkbox', { name: 'I checked the items, delivered quantities and pack sizes.', exact: true }).check();
    await page.getByRole('button', { name: 'Confirm Delivery', exact: true }).click();
    await page.getByText(/Another delivery was recorded/).waitFor();
    assert.equal(await page.evaluate(async id => (await import('/src/lib/localStore.ts')).loadLocalIngredientItems().find(row => row.id === id).ingredient_balances.quantity_on_hand, fixture.crabId), 3500, 'A stale last item prevents other inventory changes');
    await page.getByRole('button', { name: 'Close & Refresh', exact: true }).click();
    const staleDraft = await page.evaluate(async id => (await import('/src/lib/demoBackend.ts')).db.delivery_drafts.find(row => row.request_id === id && row.status === 'draft').id, fixture.id);
    await page.getByRole('button', { name: 'Open Draft: ' + staleDraft, exact: true }).click();
    await page.getByRole('button', { name: 'Cancel Draft', exact: true }).click();
    assert(await page.getByRole('button', { name: 'Cancel Draft', exact: true }).isDisabled(), 'A draft cannot be silently discarded without a reason');
    await page.getByLabel('Reason', { exact: true }).fill('This arrival was recorded by the other receiver.');
    await shots('delivery-draft-cancel');
    await page.getByRole('button', { name: 'Cancel Draft', exact: true }).click();
    await page.getByRole('heading', { name: 'Draft Cancelled', exact: true }).waitFor();
    await shots('delivery-draft-cancelled');
    assert.equal(await page.evaluate(async id => (await import('/src/lib/demoBackend.ts')).db.delivery_drafts.find(row => row.id === id).cancelled_reason, staleDraft), 'This arrival was recorded by the other receiver.', 'Cancellation preserves the worker reason in the saved record');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Receive Delivery', exact: true }).click();
    await page.getByLabel('Delivered: Gin (bottle)', { exact: true }).fill('1');
    await page.getByRole('button', { name: 'Check Items (1)', exact: true }).click();
    await page.getByLabel('ml per bottle', { exact: true }).fill('1000');
    await page.getByRole('button', { name: 'Review (1)', exact: true }).click();
    await page.getByRole('checkbox', { name: 'I checked the items, delivered quantities and pack sizes.', exact: true }).check();
    await page.getByRole('button', { name: 'Confirm Delivery', exact: true }).click();
    await page.getByRole('heading', { name: 'Delivery Recorded', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('tabpanel').locator('li').filter({ has: page.getByText('Gin', { exact: true }) }).getByRole('button', { name: /Receipts/ }).click();
    await page.getByRole('dialog').getByText('Received 4 / 10 bottle', { exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog').locator('tbody tr').count(), 3, 'Separate arrivals retain separate actual bottle-size receipts');
    await shots('delivery-batch-receipts');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Records: ' + fixture.no, exact: true }).click();
    await page.getByRole('tab', { name: 'Deliveries', exact: true }).click();
    await page.getByText('3 Confirmed Deliveries', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /^Open Delivery:/ }).count(), 3, 'Three arrivals remain three records, not seven item receipts');
    await shots('delivery-history-list');
    const displayedDate = await page.evaluate(async id => {
      const { db } = await import('/src/lib/demoBackend.ts');
      const first = db.audit_logs.find(row => row.entity_id === id && row.action === 'receive_purchase_batch');
      return new Date(first.after_json.confirmed_at).toLocaleDateString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', year: 'numeric' });
    }, fixture.id);
    await page.getByLabel('Search Deliveries', { exact: true }).fill(displayedDate);
    await page.getByText('3 Confirmed Deliveries', { exact: true }).waitFor();
    await page.getByLabel('Search Deliveries', { exact: true }).fill('Fresh Squid');
    await page.getByText('1 Confirmed Delivery', { exact: true }).waitFor();
    await page.getByRole('button', { name: /^Open Delivery:/ }).click();
    assert.equal(await page.getByRole('dialog').locator('tbody tr').count(), 5, 'Searching one ingredient reopens the whole arrival');
    assert(await page.getByText('2 bottle × 500 ml', { exact: true }).isVisible(), 'Reopened evidence retains the original bottle size');
    await shots('delivery-history-detail');
    await page.getByRole('button', { name: 'Back to Deliveries', exact: true }).click();
    assert.equal(await page.getByLabel('Search Deliveries', { exact: true }).inputValue(), 'Fresh Squid', 'Back preserves the history search');
    await page.getByLabel('Search Deliveries', { exact: true }).fill('not-a-delivery');
    await page.getByText('No Matching Deliveries', { exact: true }).waitFor();
    await page.getByLabel('Search Deliveries', { exact: true }).fill('');
    await page.getByText('3 Confirmed Deliveries', { exact: true }).waitFor();
    const added = await page.evaluate(async fixture => {
      const { supabase } = await import('/src/lib/supabase.ts');
      const { db } = await import('/src/lib/demoBackend.ts');
      const { loadLocalIngredientItems } = await import('/src/lib/localStore.ts');
      const item = db.purchase_request_items.find(row => row.request_id === fixture.id && row.item_name === 'Blue Swimming Crab');
      for (let index = 0; index < 9; index++) {
        const received = Math.round(db.purchase_receipts.filter(row => row.purchase_item_id === item.id).reduce((sum, row) => sum + Number(row.purchase_quantity), 0) * 100) / 100;
        const result = await supabase.rpc('receive_purchase_batch_checked', { p_request_id: fixture.id, p_operation_id: crypto.randomUUID(), p_items: [{ item_id: item.id, ingredient_id: fixture.crabId, quantity: 0.1, base_per_unit: 1000, expected_updated_at: item.updated_at, expected_received_quantity: received, expected_base_unit: 'g' }] });
        if (result.error) throw result.error;
      }
      return { stock: loadLocalIngredientItems().find(row => row.id === fixture.crabId).ingredient_balances.quantity_on_hand };
    }, fixture);
    await page.getByRole('button', { name: 'Refresh Deliveries', exact: true }).click();
    await page.getByText('12 Confirmed Deliveries', { exact: true }).waitFor();
    const firstPage = await page.getByRole('button', { name: /^Open Delivery:/ }).evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
    assert.equal(firstPage.length, 10, 'History uses compact pages of ten arrivals');
    await page.getByRole('button', { name: 'Next Deliveries', exact: true }).click();
    await page.getByText('11-12 / 12', { exact: true }).waitFor();
    const lastPage = await page.getByRole('button', { name: /^Open Delivery:/ }).evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
    assert.equal(new Set([...firstPage, ...lastPage]).size, 12, 'History pages have no duplicated or missing confirmations');
    await shots('delivery-history-page');
    await page.evaluate(async () => {
      const { supabase } = await import('/src/lib/supabase.ts');
      const original = supabase.rpc.bind(supabase);
      let failed = false;
      supabase.rpc = async (name, args) => {
        if (name === 'read_delivery_records' && !failed) { failed = true; return { data: null, error: { message: 'History connection interrupted.' } }; }
        return original(name, args);
      };
    });
    await page.getByRole('button', { name: 'Refresh Deliveries', exact: true }).click();
    await page.getByText('History connection interrupted.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /^Open Delivery:/ }).count(), 0, 'A failed fetch does not present old rows as current results');
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByText('11-12 / 12', { exact: true }).waitFor();
    assert.equal(await page.evaluate(async id => (await import('/src/lib/localStore.ts')).loadLocalIngredientItems().find(row => row.id === id).ingredient_balances.quantity_on_hand, fixture.crabId), added.stock, 'Reading and retrying history never moves inventory');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.evaluate(() => localStorage.setItem('language', 'ms'));
    await page.reload();
    await page.getByLabel('Search purchases').fill(fixture.no);
    await page.waitForTimeout(350);
    await page.getByRole('button', { name: 'Rekod: ' + fixture.no, exact: true }).click();
    await page.getByRole('tab', { name: 'Penghantaran', exact: true }).click();
    await page.getByLabel('Cari Penghantaran', { exact: true }).fill('Fresh Squid');
    await page.getByText('1 Penghantaran Disahkan', { exact: true }).waitFor();
    await shots('delivery-history-malay');
    await page.getByRole('button', { name: /^Buka Penghantaran:/ }).click();
    await shots('delivery-history-detail-malay');
    await page.getByRole('button', { name: 'Selesai', exact: true }).click();
    await page.getByRole('button', { name: 'Terima Penghantaran', exact: true }).click();
    await page.getByLabel('Dihantar: Blue Swimming Crab (kg)', { exact: true }).fill('1');
    await page.getByRole('button', { name: 'Semak (1)', exact: true }).click();
    await page.getByRole('heading', { name: 'Semak Penghantaran', exact: true }).waitFor();
    await shots('delivery-batch-malay');
    await shots('delivery-draft-malay');
    assert.deepEqual(errors, [], 'No delivery browser runtime errors');
    console.log('PASS 50-item receiving, saved draft recovery, edited versions, cancellation evidence, delivery history, retry safety, conflicts and responsive Malay views');
  } catch (failure) {
    await page.screenshot({ path: path.join(out, 'delivery-workflow-failure.png'), animations: 'disabled' });
    console.log((await page.locator('body').innerText()).slice(-2200));
    throw failure;
  } finally { await page.close(); }
}
