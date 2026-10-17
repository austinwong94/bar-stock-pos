# Kitchen Stock: Simpler Daily Workflow

## Applied

- Three prominent actions: Receive Items, Record Usage, Count Remaining.
- Receive Items opens the existing receiving queue directly. Existing delivery drafts, pack-size checks, partial receiving and batch confirmation remain in place.
- Record Usage has direct Guest Meals / Staff Meals choices and Waste / Other access. A searchable, compact list accepts multiple actual ingredient totals without per-item dialogs.
- Blank quantities are excluded. Usage must be positive; counts can be zero. Pieces must be whole numbers. Kilograms convert to grams internally.
- Optional meals prepared is contextual information, never a multiplier for actual total usage.
- Use Previous copies a saved batch for review; it does not submit or deduct automatically. Per-serving preparation remains available separately.
- Signed-in identity is recorded by the new server transaction, not supplied by the browser.
- Guest and staff meals deduct the same ingredient balance. There are no duplicate staff/guest inventories.
- One confirmation reviews the complete batch. Its pending request is recovered on the same device, with an immutable retry ID. The screen says Not Submitted before confirmation; it does not claim this local recovery is a cloud draft.
- History exposes Guest Meals / Staff Meals in the row, alongside recorded time, staff and before/after balances.
- Count Remaining initially hides expected quantities. Expected, actual and difference appear at confirmation. Existing authorization and stale-count guards remain.
- Optional Packs + Loose uses each item's configured pack size, displays that size and calculates the total. No historical pack sizes were guessed. For mixed or unverified package sizes use measured kg/ml/pieces; this is not a mixed-lot counting system.
- Mobile review controls remain visible while scrolling. English and Malay controls use the existing platform design.

## Validation

- Production TypeScript/Vite build.
- New kitchen-usage calculation/recovery tests and PGlite tests using the actual core production function.
- SQL checks: shared balance, total-vs-meal quantities, actor attribution, exact retries, changed-payload rejection, batch rollback, permission denial, unit validation, unavailable ingredients and whole pieces.
- Existing receiving, stock-count, stock-out and food-history regression suites.
- Browser checks at 360, 390, 768 and 1440 widths; mobile English/Malay, guest and staff submissions, count conversion/confirmation, history purpose labels, previous batch reuse and receiving navigation.
- Screenshots are in `.qa/screenshots/kitchen-simple/` (local QA artifacts, not deployment assets).

## Rollout Boundaries

The shared review uses sample data. Live Supabase has not been changed. Production requires migration `202609280051_kitchen_meal_usage.sql` after the existing migration chain, followed by authenticated multi-device staging checks before enabling this build for staff.

No source quantities from the handwritten photograph or typed September lists were imported or combined: they represent different dates or movements. The catalogue still needs agreed item names, verified package sizes and a witnessed opening count for operational rollout.

Existing count permissions are unchanged: kitchen production plus stock-management access are required because confirming a count adjusts the ledger. A separate worker-count/manager-approval workflow, cloud-saved usage drafts, lot/expiry tracking and daily manager exception cases are not introduced in this release.

Stock differences are evidence to investigate, not proof of theft. Browser layout testing is not a substitute for a short trial with actual kitchen staff.
