# Daily Booking Sheet Review

## Working Flow

- The default Spreadsheet view matches the original template column order, with one editable row per booking/group. Type into cells or paste a tab-separated Excel range (up to 200 rows per date). Add Rows adds five blank rows; Save submits all changed rows together. List retains the existing booking form and compact assignment controls.
- Seven date buttons start from today, with the following seven days expandable below. Previous/next week controls and a date picker allow dates beyond that window. Weekly mode displays Monday through Sunday in one editable table, with dated sections. Switching dates or modes retains unsaved rows in the browser tab.
- Full Template keeps booking, staff/boat/van assignments and payment fields together. Optional column filters shorten the view without changing the data. Weekly saves are atomic across the changed dates: any validation, stale-edit or permission failure rolls back the whole request. An unconfirmed save locks editing until the original request is checked; refreshing or switching modes cannot duplicate payments.
- Zoom (60-125%), column widths, sheet height and desktop sidebar visibility are browser-local preferences, never cloud settings. Column borders drag or respond to arrow keys; double-click resets a column. Reset Sheet Sizing restores defaults. Expand Sheet frees the whole viewport. The horizontal slider and arrows stay above the sheet, separate from the table's native scrollbar.
- The spreadsheet accepts registered boat, van and staff names directly. It reuses or creates that day's schedule, updates shared captain/crew/driver assignments, and fills staff contacts from the Directory. Resource versions and passenger capacity are checked before committing.
- Unsaved rows are visibly marked and retained in the same browser tab after navigation/reload. They are not submitted records and are not cloud-synced until Save succeeds. Failed saves retain the typed rows; retries reuse the original request reference. Cancelled/no-show bookings remain visible but are excluded from passenger totals.
- OP creates one booking row with the service date, group name, contact, agency, pickup/drop-off and passenger quantities. Individual names can be completed later in Passenger Details.
- The PIC assigns the boat, local guide and van directly on that row. Captain, crew and driver are assigned under Boats & Vans. Existing pickup and boarding records are used; this is not a second passenger database.
- Suggest Boats prepares a reviewable plan for waiting groups. It considers capacity, XHS grouping and pickup proximity/area. It never splits a booking automatically. It is a suggestion, not a driving-route optimiser or a confirmed departure.
- All group names and passenger breakdowns remain visible after assignment. Confirmation saves the reviewed boat plan atomically; changed source records require a fresh review.

## Passenger Counts

- Adults, children, infants, local tour leaders (TL) and China tour guides (TG) are separate counts. Each person occupies one passenger place.
- Historical elderly records remain intact and count as adults, never as infants.
- Maximum onboard is the lower of the configured boat capacity and 43, including captain and crew. One captain and one crew place are reserved until named. Additional crew use additional places.
- Pending clarification: the separate GUIDE assignment is counted as an additional onboard staff member, distinct from booking TL/TG quantities. The same employee is counted once per boat. Confirm the operator's convention before using this assumption for live loading.

## Accounts

- Each booking can hold an agreed MYR total, invoice number, accounting remarks and multiple dated receipts/refunds. Payment status and balance are calculated, not a manually entered Done flag.
- Corrections void a ledger entry with a reason and retain the original. Actor and recording time are retained.
- Agency and commission referrer are separate. Default referral terms and individual overrides support percentage, fixed booking amount or eligible passenger amount. The terms used are copied onto the booking and do not change when a later rate is edited.
- Accounts and Payments CSV downloads are accountant handoffs for SQL Accounting software. They are not verified direct-import templates or a live SQL Accounting integration. Confirm the accountant's import layout before automating entry.
- The spreadsheet shows the first two active receipts with separate dates and amounts. Existing receipt cells are read-only; full payment history and corrections remain in Accounts. A new referrer name creates a party without inventing a rate. Per-passenger commission requires an accountant to explicitly set eligible passengers; seat totals are not automatically treated as commission-eligible passengers.

## Attendance and POS

- Check In Group records every still-waiting member of that booking with one click. Search retains the full matching group, and checked-in names stay visible. Check In All Waiting shows one confirmation with all affected groups for the selected boat scope, independent of the search text. No-shows and already checked-in guests are excluded.
- POS uses the shared header, palette, typography and restrained panel styling. Single beers remain distinct from bundle sets, and selected items remain visible on mobile. Sample mode uses bundled local product illustrations; live product image URLs are unchanged.

## Access and Audit

- An External Departure Planner must have a named, active, non-anonymous account and an explicit approved service date. The owner can revoke a date.
- This role cannot be expanded using ordinary permission overrides. The planner receives only whitelisted planning fields, not agency/contact details, private passenger details, payments, commissions or unrelated operational tables/files.
- Saved changes record the authenticated actor. A shared access code alone does not establish which employee made a change; use named accounts for real accountability.
- Save retries retain their request reference; stale edits and stale reviewed plans are rejected. This is not an offline write queue or a guarantee against every network failure.

## Release Boundary

The existing private review is sample-data-only and shared with Austin and Chloe. This task does not invite Alvey, push the live GitHub POS, apply live Supabase migrations or transfer live records into the review.

Cloud implementation is prepared in migrations 202609080039 through 202609090044. For a separately authorised production release: back up the database, validate on staging, apply the pending migrations in order, deploy the matching client, create a named restricted account and verify date grants with that account before inviting an external planner. Do not expose an external planner through an older client/database security setup.

Validation covers isolated PostgreSQL migrations and regression tests, sample-only browser workflows, payment retries, simultaneous edits, permissions, capacity and responsive screenshots at phone, tablet and desktop widths. No live cloud writes are part of those tests.
