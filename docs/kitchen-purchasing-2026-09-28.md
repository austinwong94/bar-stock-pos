# Kitchen purchasing and receipt trial

## Worker flow

1. Requests: Repeat Last List starts a new draft for today. Review quantities before submitting; old payments, receipt photos and bought statuses are not copied. The catalogue remains available for additional items.
2. Purchasing: select a supplier, enter the receipt date, reference if present, and total in MYR. Attach two different images: receipt and purchased items. Enter what was actually bought, review and explicitly confirm.
3. Receiving: when items arrive, confirm the quantities actually received and their pack sizes. Only this step adds inventory. A purchase receipt must not add inventory while goods are still in transit.
4. Stock: record actual guest-meal use, staff-meal use, or waste. Both meal types use one shared stock balance. Do not enter ingredients here again if Preparation already deducted them.
5. Count Remaining: physical counts identify differences. Record and investigate discrepancies without treating them as proof of theft.

The help button opens this flow in English, Bahasa Melayu or Bahasa Indonesia. No guide appears automatically. The kitchen header and section navigation have one shared implementation. The request-only pax banner no longer shifts the kitchen tabs; pax entry remains in Preparation and the reminder remains in Daily Operations.

## Spending and budget interpretation

The purchase total is the receipt total, not quantity multiplied by that total. Optional item costs are line totals, not unit prices. A warning compares fully entered line totals against the receipt total; tax, discounts and unrelated items may account for a difference.

Do not calculate daily food cost per guest by dividing today's purchases by today's visitors. Purchases can supply several days. A trustworthy budget report needs actual ingredient usage valued at receipt-backed unit cost, allocated separately to guest and staff meals, divided by recorded meals served. Missing pack sizes or item costs must remain uncosted, never silently become zero. This release adds evidence-backed purchase totals; it does not claim to implement FIFO/weighted-average valuation or a new cost-per-meal budget report.

## Live setup

The shared review remains a sample-data build. Uploaded review photos persist in IndexedDB on that browser/device, not a shared database. UI records explicitly say Local Preview.

For the real Supabase project:

1. Back up and test existing migrations in staging. Apply migration 202609280052_purchase_evidence.sql after the existing purchasing migrations. It creates suppliers, a private purchase-evidence bucket, immutable proof references, and isolated receipt-scan results.
2. Deploy the updated frontend together with the migration. Older Bought forms are intentionally rejected by the database when they omit proof.
3. Verify a purchaser can upload/read evidence and a kitchen-only user cannot read costs or receipt images. Confirm purchase retry and receiving on two devices. No live migration was applied during this task.
4. Deploy the scan-purchase-receipt Supabase Edge Function when ready. Keep OPENAI_API_KEY as a server secret; never use a VITE variable. The function needs SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in its server environment.
5. Set RECEIPT_ALLOWED_ORIGINS to the exact live frontend origin(s), comma-separated. Use a dedicated OpenAI project/key and a small monitored budget. Supabase hosting/storage costs are separate.

Storage limits: JPG/PNG/WebP, up to 10 MB each, camera or file selection. Signed viewing URLs expire after five minutes. No client delete/overwrite policy is granted. Uploads abandoned before confirmation are not purchases and can leave unreferenced photos. An administrator should apply a reviewed retention job to unreferenced uploads, excluding every path referenced by purchase_evidence and active submissions. There is no automatic photo deletion in this release.

## AI trial, not automatic accounting

The optional AI Receipt Check is on a saved purchase. It reads the receipt image only, extracts supplier/date/receipt number/currency/item description/quantity/unit/unit price/line amount/subtotal/tax/discount/total and warnings, then stores the extraction separately. Missing or unclear text stays null. Manual records, receiving, ingredient mappings and inventory are never written by scanning.

The function authenticates the user, checks purchasing and cost permissions, reserves a scan atomically, limits the project to 100 new scans per rolling day, and caches completed scans. An uncertain/failed attempt is locked for administrator investigation rather than silently making another potentially paid call. Stored token usage supports cost checks. No paid OpenAI call was made in implementation tests; mocked responses covered success, cached reads, failed permissions, missing keys and incomplete outputs.

Recommended rollout: compare scans against 30-50 independently entered real receipts, covering usual suppliers, long receipts, Malay abbreviations, handwriting, faded print and discounts. Track field-level and monetary errors. After validating accuracy, introduce Scan → Review/Edit → Confirm prefill. Keep manual entry as fallback. Do not replace the receipt photo, item photo, pack-size verification or human confirmation with AI.

## Model and cost estimate

Starting candidate: GPT-5.4 mini with image input and strict structured output. Verified official pricing on 2026-09-28: USD 0.75 per million input tokens, USD 4.50 per million output tokens.

Illustrative receipt with 2,000 input tokens (including image) and 1,000 output tokens:
2,000 × 0.75 / 1,000,000 + 1,000 × 4.50 / 1,000,000 = USD 0.006, approximately USD 6 per 1,000 receipts.

This is an example, not a quote or measured receipt benchmark. Image resolution, long receipts, output length, retries and changing model prices affect actual cost. Storage/hosting/taxes are excluded. ChatGPT subscription credits do not fund this application's OpenAI API key.

Sources:
- https://developers.openai.com/api/docs/models/gpt-5.4-mini
- https://developers.openai.com/api/docs/guides/images-vision
- https://developers.openai.com/api/docs/guides/structured-outputs

## Verification

- scripts/test-purchase-evidence.mjs: executable PostgreSQL checks plus mocked receipt API tests.
- Existing kitchen usage, count, history and delivery-entry regression scripts.
- Unlocked phone, tablet and desktop screenshots in .qa/screenshots/kitchen-purchases.
- No live sales, inventory, cloud records or sharing permissions changed.
