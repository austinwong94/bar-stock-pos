# Delivery Entry Improvements

## Changes

- Fill remaining delivery quantities with one action, or fill only search results.
- Preserve quantities already entered. Undo restores the exact prior entry state.
- Only fill active, mapped inventory items with valid unit conversions. Never guess packet or bottle sizes.
- Show pack-size entry and missing inventory mappings directly in each row.
- Show stock additions in kg, pcs or ml, and the quantity still due.
- List outstanding purchased items in the saved-draft confirmation, including skipped items.
- Keep the required final checkbox and confirmation. Filling quantities does not save or receive stock; Review saves a draft, and Confirm Delivery receives stock.
- Use consistent quantity labels on delivery receipts.
- Preserve uncertain-save state after later rejected retries for draft saving, confirmation and cancellation.

## Verification

- `node scripts/test-delivery-entry.mjs`: 50-item fill, partial quantities, search scope, undo snapshot, no overwrite, missing mappings/sizes, inactive items, incompatible units, rounding, quantity labels and uncertain retries.
- Existing stock-out, food-stock-history and platform-reliability tests passed.
- Browser checks used local sample data only: received 3 of 8 kg; reopening offered the remaining 5 kg. A separate request received 2 of 4 garlic packs at 500 g each (+1 kg), and 2 kg squid. Garlic remained partially received with 2 packs outstanding.
- Confirm was disabled until the checkbox was selected. Unknown pack sizes were skipped by bulk fill. Undo and close did not leave an unnecessary discard prompt.
- Screenshots inspected at 320, 390, 820 and 1440 px widths, including English and Malay. No page-width overflow at 320 or 390 px; no browser console errors.
- Screenshots: `.qa/screenshots/delivery-entry/` (local QA artifacts, not committed).

## Deployment Scope

The existing shared review is updated with unchanged access. No new database migration is required for these UI changes; the existing delivery-draft RPCs remain prerequisites for cloud mode. No live Supabase records were changed. Browser receipt tests validate the local preview, not a live cloud deployment or real-device behavior.
