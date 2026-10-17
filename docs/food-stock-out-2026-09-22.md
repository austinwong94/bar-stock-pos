# Food stock-out reliability and units

## Changes

- Food Stock balances, stock-out entry, confirmation and history consistently show kg for gram-based ingredients and pcs for individual pieces. Stored inventory remains in its original base units.
- Stock-out rows show the expected remaining balance. Invalid quantities, fractional pieces, excess quantities and changed stock block Review. Searching does not drop selected items.
- The confirmation shows before/out/after quantities, reason, notes and the signed-in staff member. It still requires explicit confirmation.
- Reviewed stock-outs persist on this device, scoped to account/project/operation. Refresh restores the original confirmation. This is not a cloud draft and does not preserve unfinished input before Review.
- Confirmed operations retain the existing server ledger and audit identity. Uncertain replies reuse the original immutable request ID. A later permission or validation rejection cannot release a previously uncertain request for fresh submission.
- Confirmed non-submission can return to editing. Stock counting uses the same corrected initial-versus-retry failure rule, including persisting its editable state after a definite initial rejection.
- Food categories and stock-out reasons follow the selected language. Confirmation labels are short enough for phone controls.

## Verification

- scripts/test-stock-out.mjs: kg conversion, whole pieces, blank/zero/negative validation, stale balance versions, account isolation, immutable payloads, multiple pending operations, storage failures, lost replies and uncertain retries after permission changes.
- scripts/test-stock-count.mjs with PGLITE_MODULE: executes the original stock-out function and migrations 48/49 on a minimal PostgreSQL schema. Confirms atomic rollback, exact kg deduction, replay without another deduction, changed-payload rejection, stale versions even at an unchanged quantity, invalid units, fractional pieces, permission rejection and audit identity.
- Existing platform reliability regression tests pass.
- Browser sample-data checks: 0.25 kg of squid and 2 crabs deducted only after confirmation; refresh restored the review with its checkbox unchecked; history retained before/after values and staff. A matching physical count advanced the stock version and blocked an earlier stock-out entry until cleared and reviewed again.
- Inspected 320/390 px phone, 820 px tablet and 1440 px desktop layouts, including English and Malay confirmation controls. No page-width overflow or captured console errors in these checks.

## Release boundary

Shared review only; no live Supabase data, roles or grants were changed. Before cloud release, apply 202609220048_kitchen_stock_count.sql and 202609220049_checked_kitchen_stock_out.sql after the existing kitchen stock-out migration. The new UI uses the checked endpoint without falling back to the old unversioned endpoint.

These targeted checks do not replace production-schema/RLS and real multi-device staging tests. Older clients retain their existing endpoint; refresh them when the cloud release is deployed.
