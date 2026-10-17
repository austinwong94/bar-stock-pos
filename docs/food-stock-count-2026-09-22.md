# Food stock counting - 22 September 2026

## Workflow

- Kitchen > Food Stock > Count is available to accounts with both kitchen.production.manage and the existing bar.stock.manage permission. No roles or grants were expanded.
- Enter physical quantities directly. Weight is entered in kg and stored in g; pieces stay whole pieces. Blank means not counted, while zero is an explicit empty stock count.
- Review shows expected quantity, physical count and difference. Confirm requires acknowledging the physical check. No inventory is changed by opening or dismissing Review.
- A reviewed confirmation is saved on that device, scoped to project/account/operation. It is recovered after a refresh. This is not a cloud draft; unfinished input before Review is not persisted.
- Confirmed counts update the existing ingredient ledger with before/after quantities, staff identity, timestamp, notes and a reference. Matching counts also create evidence.
- Every count batch is atomic. Current balance and its version must match the original snapshot. A stale count requires recounting; uncertain retries use the original immutable request ID.

## Verification

- scripts/test-stock-count.mjs tests unit conversion, blank/zero distinction, whole pieces, stale versions, malformed recovery, account isolation and immutable retries.
- Targeted PGlite SQL tests execute the migration against a minimal schema: atomic multi-item counts, zero and matching counts, audit identity, duplicate retries, changed-payload rejection, failed-batch rollback, stale versions, units and permission guards.
- Browser checks on local sample data: confirmation disabled until checked; review restored after reload; four items confirmed once, including zero pieces; count history retained staff and differences; a subsequent stock movement blocked a stale count; Recount accepted the fresh balance.
- Ordinary Kitchen sample role has no Count tab. Owner access is unchanged.
- Screenshots inspected at 320/390 px phones, 820 px tablet and 1440 px desktop. Removed the body minimum-width rule that clipped content on a 320 px viewport with a persistent scrollbar.
- Platform reliability regression tests also pass. Full production-schema/RLS and simultaneous real-device integration tests still require a staging Supabase environment.

## Rollout

The shared review uses device-local sample data. Live Supabase records remain unchanged.

Apply supabase/migrations/202609220048_kitchen_stock_count.sql through the normal migration process before using counts in cloud mode. It requires the existing operation_requests, ingredient inventory, profile, audit and permission functions. The UI blocks counting if balance-version metadata is unavailable; it does not silently fall back to an unprotected update.

This adds food inventory counts, not liquor/bar counts or a new staff approval workflow. Counts help reconcile shortages; they do not determine their cause or prove misconduct.
