# September Integration Release

Historical integration notes. For the current Kitchen/Bar candidate, read
`docs/platform-audit-2026-10-14.md` and run `npm run release:check` against local
native PostgreSQL 17. The current lineage contains 95 immutable migration files,
ending in `202610140073_measured_piece_receiving.sql`. Rehearse missing forward
migrations against a restored staging copy; do not rerun the original schema or
seed. Local verification is not hosted Supabase or production qualification.

Migration 073 preserves actual weight and measured pieces for receiving, keeps
old normal drafts recoverable, and removes receiving from the default Purchaser
role. Kitchen receivers/managers still confirm arrivals. Reload open devices
after the matched migration/frontend deployment; rehearse the role change with
named accounts before live staff use. The shared review remains sample-only.

## Scope

This branch combines the August bar, cocktail and kitchen inventory modules
with the September island operations platform. It adds permission checks,
checked writes, duplicate-request protection, delivery receiving and responsive
layout fixes. It has not been applied to the live Supabase project or published
to GitHub Pages as part of this work.

## Verified Locally

- All 57 SQL migrations apply to a fresh, isolated PostgreSQL database.
- 224 integration assertions cover the tested financial, inventory, permission
  and concurrency workflows. This is not a guarantee about untested workflows.
- Browser regression covers 30 routes at five viewport widths (320, 390, 768,
  1024 and 1440px), explicit draft
  and delivery confirmation, partial receiving, searchable history, receipt
  persistence, and immediate POS selection. The 50-item kitchen test also covers
  editing, saved draft recovery, confirmation, copying and purchasing visibility.
  The 50-item purchasing checks cover blank quantity entry, search that preserves
  entries, optional costs, explicit review, accidental dismissal, a lost-response
  retry, saved record recovery, stale-item rejection and English/Malay layouts.
  Delivery checks cover a 50-item list, unique exact-name suggestions, ambiguous
  names left unselected, actual bottle sizes, review, lost-response retries,
  concurrent partial arrivals, receipt recovery and English/Malay screen sizes.
  Delivery history checks cover whole-arrival search, ten-record pagination,
  refresh after another device confirms, failed-read recovery and read-only
  browsing. Database tests also cover older ungrouped receipts, original names,
  permissions and searches at the Malaysian/UTC date boundary.
  Delivery-draft tests cover review without stock movement, lost-save retries,
  close/reload recovery, edited versions, explicit reconfirmation, stale arrivals,
  reasoned cancellation and two different workers confirming one draft once.
  Pickup checks cover free-text locations, own-transport pax, missing map points,
  manual overloads, draft dismissal, explicit confirmation and reload persistence.
  Staff checks cover one-tap check-in, failed-save recovery, reviewed group
  changes, activity choice, roll call, returns, English/Malay views, guide-only
  visibility, touch-based boat selection and explicit crew saves. The practice
  admin session is unlocked before capturing protected pages. This is Chromium
  touch emulation, not a claim that every real iPhone/iPad has been tested.
  Screenshots are in `.qa/screenshots`.
- `node scripts/test-pickup-planning.mjs` checks grouping distance, whole-party
  capacity, unavailable vehicles, existing assignments and distinct place names.
- `node scripts/test-delivery.mjs` runs 23 focused checks for fixed kg/g and l/ml
  conversions, variable bottle/packet sizes, whole units and decimal precision.
- Local preview data is separate from cloud records. It is not a live backup.

## Before Live Deployment

1. Back up the live database and verify the backup can be restored. Record the
   currently deployed frontend commit and database migration history.
2. Restore a copy into staging. Compare its applied migrations with this branch.
   Some May-numbered migrations were restored from the August work; do not
   blindly rerun initial schema files against existing tables. Do not run the
   demo seeds or `live_cloud_fix.sql` against production as an upgrade shortcut.
3. Review and apply only missing migrations to staging in dependency order.
   Rehearse the upgrade on this existing-data copy, not only a fresh database.
   The new September migrations are `202609080021` through `202609080035`.
   Migration `027` supplies the purchasing queue API required by this frontend
   and backfills older receipt labels. Inspect these recovered labels in staging.
   Migration `028` records kitchen draft/submission snapshots, captures the
   confirmer's name, blocks incomplete submissions and makes confirmation retries
   idempotent. Earlier submissions have no fabricated historical name.
   Migration `029` supplies the pickup board snapshot, atomic plan confirmation,
   stale-location/move checks and confirmation audit records required by the
   new pickup planner. Apply it before publishing this frontend.
   Migration `030` supplies the checked attendance, boat assignment and crew
   save endpoints. It compares the state shown to the worker, preserves
   attribution through the existing attendance log and deduplicates retries.
   These new screens require migration `030`; do not deploy the frontend alone.
   Migration `031` supplies atomic reviewed purchase entry and purchase records.
   It checks every item's version before writing, rejects duplicate lines and
   saves an attributed audit snapshot. Apply it before using Record Purchases
   on the cloud frontend. Retrying the same confirmation returns its original
   record; recording purchases never adds inventory until delivery is received.
   Purchase Records shows the latest 100 multi-item confirmations per request;
   individual purchases remain visible on the request list, not in this new log.
   Entries are not saved drafts before final confirmation. Closing warns before
   discarding edits; local preview confirmations remain on that browser only.
   Migration `032` supplies reviewed multi-item receiving. Both the single-item
   and multi-item forms now compare previously received totals and inventory
   units before adding stock. Every line is validated before any stock moves,
   and receipt retries return the original confirmation. The old receiving RPC
   is no longer available to authenticated clients; all open receiving screens
   must reload the matching frontend before continuing.
   Delivery quantities start blank. Exact unique names may suggest an inventory
   target, but mismatches or duplicate names require a choice. Standard unit
   conversions are fixed; bottle/packet sizes are entered per arrival. To receive
   two sizes of the same purchase item, confirm each size as a separate arrival.
   Existing per-item Delivery Receipts retain the named receiver, timestamp and
   conversion evidence after leaving the batch confirmation screen.
   Migration `033` supplies the read-only delivery history endpoint. The request's
   Records button now separates Purchases and Deliveries. Deliveries are shown
   as compact pages of ten confirmations; selecting a row reopens every item in
   that arrival. Search uses captured ingredient/staff names and Malaysian dates,
   not today's catalogue names. Older single-item receipts remain visible once,
   with recovered-name provenance disclosed. Refresh fetches new confirmations;
   reading, searching or retrying history never receives stock again.
   Migration `034` supplies shared delivery drafts. Multi-item Review now saves
   a draft before opening confirmation. It does not add inventory. The Unconfirmed
   Deliveries list remains visible on Purchasing until confirmation or reasoned
   cancellation, including when someone closes the popup or switches devices.
   Author, editor, version and timestamps are stored with audit snapshots. Draft
   confirmation checks both the reviewed version and the latest receipt totals;
   two workers confirming the same draft get the original single delivery record.
   Direct draft writes are revoked. Apply this migration before the matching UI.
   Edits are saved when Review succeeds, not on every keystroke. Unsaved edits
   still show a dismissal warning. Single-item Receive continues to confirm
   directly through the checked receipt endpoint. Pending drafts refresh on
   focus, reconnection, manual refresh and the shared polling interval; Realtime
   can provide additional refreshes if the table is in the project's publication.
   Local preview drafts stay in that browser; cross-device persistence requires
   the cloud deployment. The local tests do not establish live Supabase readiness.
   Migration `035` adds checked van creation with retry tokens, stale-board
   rejection, duplicate-vehicle prevention and occupied-van seat validation.
   Existing duplicate entries are flagged in the UI, not silently deleted.
   Moving a booking no longer fabricates or replaces pickup start times.
   Add Van, visible assigned names, mobile list views and recommendation review
   are covered by the focused pickup browser checks. Apply the migration before
   deploying the matching cloud frontend; the shared Sites review uses sample data.
4. Build the matching frontend against staging. Test a staff tablet and a manager
   session simultaneously: purchase, receive partially, finish receiving, sell
   a cocktail, void it, edit a count, and download an accounting report.
5. Check report scheduling in Supabase. The archive job should run at 16:00 UTC
   (midnight Malaysia time). The fresh-database tests do not verify hosted Cron.
   Confirm a successful scheduled execution and its report dates before relying
   on unattended generation. Current archives are bar/kitchen reports; the
   island-wide Daily Summary is a separate view.
6. Use a maintenance window for the live database and frontend upgrade. These
   migrations revoke older write endpoints, so open tablets must reload the
   matching frontend before resuming work.
7. Publish the tested commit using the Pages workflow with the live public URL
   and publishable/anon key. Never include a service-role key or demo build flag.
   Verify the actual hosted URL on a phone and desktop, then verify a new record
   appears on the second device after refresh.

## Operational Notes

- Mobile staff screens share compact date/search/boat filters, 44px action
  targets, readable guest names and a direct section switcher. The existing
  colours are retained. Desktop and tablet retain multi-column working lists.
- Check-in is a positive one-tap action. Group changes and corrections show
  the affected names and require explicit confirmation. Closing that review
  does not change attendance. A failed save does not report success.
- Activity selection, roll call and return attendance have separate views.
  Recorded attendance is not silently reset when changing an activity.
  Boat moves through the new chooser are blocked once attendance has been
  recorded, because the older move endpoint recreates passenger rows.
- The boat chooser keeps parties together, shows available seats and uses
  checked server writes. Crew changes save explicitly and reject stale edits.
  Legacy clients can still call older endpoints; keep tablets on the matching
  release. An offline edit queue has not been added.
- Missing-pax reminders remain scheduled as before but their reminder banner
  now sits in the page flow, so it cannot cover a guest's action buttons.

- Pickup suggestions use saved coordinates and straight-line distances, not
  road distances, traffic or driving times. No external location service is
  called automatically. Map links open only when selected. A street/building
  without coordinates stays waiting until reviewed; a matching area name is
  not treated as proof of proximity. Correct coordinates are still required.
- Suggestions keep whole bookings together, respect passenger capacity and
  preserve existing assignments. All points in a suggested vehicle group must
  be within the selected grouping distance. This is a conservative heuristic,
  not a guaranteed minimum vehicle count or optimized route. Check road access,
  child-seat requirements, pickup times, drivers and vehicle availability.
- Review can move bookings or exclude unavailable vehicles. Dismissing the
  suggestion makes no assignments. Confirm Plan commits the reviewed plan
  atomically, records its actor/time and rejects stale data or overloads.
  Retrying the same confirmation does not duplicate runs. The unsent suggestion
  is local to that screen; confirmed records are shared in cloud mode.
- A suggested vehicle is used at most once per service date. Existing multiple
  runs or runs already underway are not reused automatically. Multiple timed
  journeys per vehicle and road routing are not scheduled by this first draft.
- Own Transport counts passengers separately from bookings. Changing a pickup
  place clears outdated map coordinates unless an unchanged/saved place is used.

- Buying an item does not add inventory. **Receive** records what physically
  arrived and converts the purchase unit into g, ml or individual units.
- Receipt records preserve the authenticated actor, time, quantity and conversion.
  Mixed bottle sizes should be received in separate entries.
- Purchasing separates Open, To Receive and History. Bought items remain open
  until physically received; the dashboard uses the same outstanding count.
  Server-side search and pagination retain access beyond the old 200-row limit.
- New receipt names are captured at delivery, so later staff or ingredient name
  edits do not rewrite them. Older recovered labels are explicitly marked as
  backfilled and may reflect later name changes. Times are shown in Malaysia time.
- Purchase quantities and costs reject more than two decimal places instead of
  silently rounding the submitted value. Receiving retries cannot change the
  original unit conversion.
- Dismissing a kitchen request confirmation keeps the saved draft. Only explicit
  confirmation sends it to purchasing. A draft is not confirmed stock.
- Save & Review opens the persisted request directly. Zero or missing quantities
  may remain in a draft but cannot be sent. Every saved revision and successful
  confirmation leaves an audit snapshot; retrying the same save does not add a
  second request or purchasing message. Queued messages are not proof of delivery
  through WhatsApp or another external provider.
- Stale edits are refused instead of overwriting another device's newer record.
  Retry protection applies to the tested RPCs; it is not an offline sync queue.
- Shared tablet codes identify the tablet session, not the individual person.
  Clickable worker names are claimed attribution. Use personal staff accounts
  where reliable individual accountability is required.
- Do not restore an older frontend alone after applying the new checked-write
  migrations. Use the rehearsed database and frontend recovery plan together.

## Kitchen and Boat Workflow Update (8 September 2026)

The shared Sites review is sample-only. These production migrations were tested
in a disposable PostgreSQL database, not applied to the live Supabase project:

- `202609080036_guest_meal_needs.sql`: scoped meal/allergy requirements, stale-edit
  protection, audit history and kitchen acknowledgement. Unknown is not allergy-free.
- `202609080037_kitchen_stock_out.sql`: food-only access to the existing ingredient
  ledger; confirmed, attributed, atomic deductions with retry and unit checks.
- `202609080038_scheduled_boat_trips.sql`: scheduled records update automatically.
  Planned boats do not count as actual trips or estimated fuel consumption.
  Historical logs are retained where old assignments lack departure status;
  that retention is not verification that those historical trips occurred.

Apply these in order through the normal backed-up migration process before
releasing this frontend to production. Do not rerun the initial schema or seed.
Meal preparation and food stock-out share one inventory; never enter a second
stock-out for ingredients already deducted by a preparation record.
Fuel purchases minus estimated usage are not a measured stock loss.
