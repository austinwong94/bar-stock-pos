# Platform fixes - 22 September 2026

## Included

- Bar overview uses a permission-checked, security-invoker PostgreSQL aggregate instead of fetching unbounded sales into the browser. Completed sales, void exclusions, FOC value and today's stock units are calculated in the database.
- Pending cloud POS requests are retained before submission, scoped to project/account and operation. Recovery checks the original sale and reuses the same request ID. An uncertain result must not prompt a second collection. Lookup failures retain the pending request. Already-voided sales are not charged again. QR evidence is no longer deleted merely because a response failed.
- Repair updates compare the original updated_at value, reject stale edits and keep the form available for inspection. New repair insertion is not yet retry-idempotent.
- Kitchen history is date-bounded and paginated. Failed refreshes are explicit and prevent preparation confirmation. Use Previous copies ingredient quantities, requires a fresh serving count and retains the confirmation step. Summaries count records rather than adding incompatible serving bases.
- Booking spreadsheet shows saved net payments, balance and record count, including receipts beyond the first two entry slots and refunds. Finance permission still controls these columns.
- FOC Value replaces the misleading FOC Cost label in the affected bar reports and PDFs; it is not shown as a second subtraction from revenue. Historical fields and values are unchanged.
- Mobile staff screens have compact headings and summaries, consistent direct kitchen navigation, and explicit passenger type plus attendance status. Existing group check-in and one-tap meal controls remain available.

## Verification

- TypeScript and production Vite build pass. Existing large-bundle warning remains.
- scripts/test-platform-reliability.mjs covers 1,205 records, smaller server page caps, failed loads, lost payment responses, account isolation, multiple tabs, storage failures, resolved/voided payment recovery, extra receipts, refunds and void exclusions.
- Targeted PostgreSQL checks use PGlite via PGLITE_MODULE. They execute the new aggregate against 1,205 cash sales plus QR, complimentary, voided and out-of-period records, with access/date rejection checks.
- Browser checks use isolated local sample data: group check-in retains names; direct meal choice saves in place; 10 x 200 g deducts 2,000 g only after confirmation; reuse leaves the count blank; two receipts totalling RM250 against RM600 show RM350 balance.
- Inspected phone (320/390 px), tablet (768 px) and desktop (1440 px) layouts on the changed workflows. No document-width overflow in those checks. The external planner sample is denied an unapproved date and has no accounts tab.
- The full existing database suite could not run because no local PostgreSQL server was available. Targeted checks do not replace a production-schema/RLS integration test.

## Rollout boundary

The shared review uses sample data. Live Supabase data and access grants were not changed.

Before releasing the cloud bar overview, apply supabase/migrations/202609220047_bar_overview.sql through the normal Supabase migration process and verify cashier/manager/report-only roles against the deployed database. The UI reports an explicit error if the function is unavailable; it does not silently substitute truncated totals.

This batch does not complete the wider roadmap: role-specific task navigation, physical stock-count workflows, named meal templates, pickup-coordinate matching, SQL Accounting import validation and full production multi-device/permission checks remain separate work.
