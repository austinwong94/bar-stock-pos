# Kitchen and Bar Launch Security Check

Historical checkpoint. The current findings and release procedure are in
`platform-audit-2026-10-14.md`; use `npm run release:check` for the current
candidate. Earlier PGlite/sibling-checkout evidence below is not current
production qualification.

Status: source changes tested; live Supabase deployment and live acceptance are NOT verified.
The shared Sites review uses device-local sample data. It is not the production database.

## Fixed in migration 202610050071

- Checkout retries are bound to the original authenticated account and the complete request, including items, discount, payment method, QR provider and table. Changed requests cannot silently return or alter another sale.
- The browser now uses the guarded recovery RPC, not a sales-table lookup. Lost permissions do not erase an unresolved payment. A subsequent void is returned as voided, not a new sale.
- QR proof must exist in private storage, belong to the cashier and not already be linked to another sale. Linked evidence cannot be updated or deleted through the storage table. Failed sales roll back stock and sale records together.
- Old raw checkout and kitchen mutation helpers are no longer client-callable. The checked public entry points still call their internal helpers.
- Purchase-message and pickup-order helpers are no longer callable directly by anonymous or authenticated clients.
- Shared access-code sessions are restricted to POS and stock viewing. A shared PIN no longer grants additional permissions. Admin confirmation requires an active, named account with existing management rights.
- The configured manager-approval requirement for FOC is now enforced by the database, including a 100% discount used to make a paid order free. Partial discounts retain the current business rules.
- Account changes discard the prior account's access immediately. Failed permission refreshes fail closed; delayed responses cannot restore older rights.

The PIN is still a secondary convenience check, not the account's security boundary. Do not share manager account credentials. Shared tablet sessions cannot prove which individual was physically holding the device; use named staff accounts for individual attribution.

## Verification

- `test-launch-security.mjs`: all 93 migrations from scratch, actual RLS/role functions, anonymous/tablet/kitchen/buyer/owner boundaries, exact payment retry, altered payload, cross-account retry, missing/foreign/reused receipt, evidence retention, void recovery, legacy-payment hold, rejected-free-sale rollback, kitchen usage identity and single deduction.
- `test-access-session-ui.mjs`: real React provider in Chromium, account switching, out-of-order responses, failed access result, thrown network error and retry recovery.
- `test-platform-reliability.mjs`: pending payment retention and account scoping, repeated submissions, interrupted responses and records beyond server page caps.
- Production npm dependency audit: no known vulnerabilities reported on 5 October 2026. This is not a guarantee against undiscovered vulnerabilities.

The full-chain SQL runner uses PGlite. It substitutes SHA-256 for pgcrypto's digest and does not emulate Supabase Auth, Storage HTTP uploads, pg_cron or simultaneous independent PostgreSQL connections. Those require staging/live checks. The review checkout reads earlier migrations from the sibling main checkout; SECURITY_SCHEMA_ROOT can select a complete schema checkout explicitly.

## Required Before Staff Use Real Data

1. Identify the existing Supabase project and its deployed migration versions. Back up the database and receipt storage. Rehearse pending migrations in staging; do not rerun the original schema or the old live_cloud_fix.sql repair script.
2. Reconcile every pending POS payment before installing 071. Older saved payments without a request snapshot deliberately remain on hold for manager review; never clear them merely to charge again.
3. Apply the missing migrations, including 071, and deploy the matching frontend. PostgreSQL transactions make this migration atomic. Keep source and schema releases together; old raw checkout callers will be denied.
4. Create and approve named owner, accountant, purchaser, kitchen and cashier accounts with least-privilege roles. Test each account and suspended-user denial. Disable `allow_access_code_login` after setting up named cashier accounts: the shared code is not suitable when individual accountability is required. Use strong unique account passwords and enable available MFA for privileged Supabase/project administration.
5. Verify `payment-receipts` and `purchase-evidence` are private. Test a real Storage upload's owner field, signed viewing, forbidden cross-account access and denial of deleting a linked receipt. Storage behavior cannot be proven by the local table stand-in.
6. Test on two devices: same-payment retry, two sales competing for the last stock, two edits to the same record, suspended/revoked access, lost connection after save, and a receipt pending review after closing the browser. Confirm exact balances and audit actors.
7. Verify real purchasing receipt capture, separate kitchen receiving, guest/staff usage, stock checks, accountant totals and Malaysia dates with a small controlled set. Confirm kitchen cannot edit costs or access bar admin.
8. Deploy/verify receipt-scanning and notification Edge Functions only in this same project. Keep OpenAI and service-role keys server-side. Confirm allowed origins, scan permission, admin on/off switch, usage limits and failed scans before enabling paid scanning.
9. Confirm the actual cloud frontend uses cloud mode and the correct public Supabase URL/key. The sample review must stay visibly separate. Confirm backups, restoration procedure and who receives operational failures.

No production records, live database policies, GitHub deployment or live secrets were changed by this audit. Production readiness requires the checks above, not simply publishing the review.
