# Food Stock History

## Changes

- Food Stock > History has Day, Week and Month selection, previous/next arrows, and direct All / Stock In / Stock Out / Meals / Counts filters.
- Search matches item names, staff, notes, reasons and operation references. Characters such as `%` and `_` are literal, not wildcard searches.
- Each compact row keeps its item, recorded time, staff, reason/notes, change and before/after balance visible. Weight is displayed in kg and individual items in pcs, matching count and stock-out entry.
- History loads 50 entries at a time. Load Older Records uses a timestamp-and-ID cursor; it no longer silently ends at the newest 200 entries. Identical timestamps and concurrent newer inserts do not shift subsequent pages.
- Times and calendar boundaries use Asia/Kuala_Lumpur. This is recorded-time history, not an inferred delivery/business date. Weeks start Monday.
- Background refresh checks offer new changes without moving rows while staff are reading. Failed reads do not present an empty-result message. A missing cloud function has a database-update message.
- Existing food access permissions are preserved; ingredient costs and non-food items are excluded. Inactive food items retain their history.

## Verification

- `scripts/test-food-stock-history.mjs`: date/year/leap-month cases, Malaysia midnight boundaries, literal search and 235 same-time local rows.
- With PGlite: 237 historical food rows, inactive items, stable cursors, a concurrent newer insert, permission enforcement, invalid input, and excluded liquor/cost data.
- Date helper tests also ran under America/New_York.
- Existing stock count, checked stock-out and platform reliability suites passed.
- Browser checks: 320px and 390px phones, 820px tablet, 1440px desktop; English and Malay; day/week/month arrows, search, movement filters and empty results. No console errors. The 320px date controls stack to keep the full date readable; movement filters remain one row.
- Screenshots: `.qa/screenshots/food-history/phone.png`, `desktop.png`, `tablet-malay.png`, `small-phone-malay.png`.

## Release Boundary

The shared Sites review uses sample data. No live Supabase records or access grants were changed.

Cloud use requires applying `supabase/migrations/202609220050_food_stock_history.sql` through the normal reviewed migration process. It adds a read-only permission-checked function and cursor index; it does not modify stock quantities. This migration was tested with a targeted PostgreSQL fixture, not applied to the live project. Production schema integration and device-to-device testing remain part of deployment verification.
