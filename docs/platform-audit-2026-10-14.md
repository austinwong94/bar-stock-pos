# Platform Audit: 14 October 2026

## Decision

**Repair the existing platform; do not rebuild the entire platform.**

The Kitchen/Bar core already has transactional stock movements, named-account
permissions, reviewed receipt/delivery drafts and an audit ledger. Replacing it
would create a second implementation and put existing records at unnecessary
risk. The serious problems found are concentrated at read, review/retry,
integration and release boundaries. Fix those boundaries and simplify the
worker-facing workflows on the existing ledger.

**Not yet qualified for staff to use real data.** Local verification and private
review publication are not proof that the existing Supabase project has the
matching schema, physical Storage behavior, backups or operational setup.

Basis: the user's attached `MUST SAVE CODEX DEV PLAYBOOK.md`; current review
source opened at `ad99be1ccfdbfae9ed9b6b9f6ba5e55567420d66`; existing main source;
the complete migration lineage; current Kitchen/Bar routes, RPCs and Edge
Functions. The final candidate's exact fingerprints and check outcomes are in
`.qa/release/receipt.json`. Findings below distinguish source inspection from
executed acceptance. This is not a guarantee that every possible bug is found.

## Scope and Method

- Trace Kitchen request -> purchaser review -> receipt confirmation -> separate
  receiver -> inventory -> guest/staff usage -> accountant expenditure/costs.
- Trace Bar stock draft -> confirmation -> individual/bundle/cocktail sale ->
  payment recovery -> void -> closing -> reporting and downloaded archive.
- Inspect permissions, stale writes, retry identity, dates, units, required
  evidence, scanner boundaries, private review vs cloud builds and deployment.
- Apply all 95 immutable migration files to disposable **native PostgreSQL 17**,
  using actual permission/RLS functions and independent connections. Rehearse
  the 071 -> 072 forward upgrade with existing sale/retry data.
- Inventory reachable frontend files, routes and literal RPC calls using the
  TypeScript AST. Check callable cloud RPCs against the fresh native schema.
  This does not detect every possible dynamically constructed call.
- Exercise real React components with controlled Auth/transport fixtures for
  failure/recovery states; inspect unlocked sample pages at mobile, tablet and
  desktop widths. Those fixtures do not establish hosted Auth/Storage behavior.
- No live Supabase records or credentials were changed. Dormant guest, fleet,
  boarding and commission modules remain outside the Kitchen/Bar launch scope;
  their presence in source is not a claim that they are launch-qualified.

## Priority Findings and Repairs

| Priority | Finding | Result |
| --- | --- | --- |
| Critical | Failed or capped sales reads could become an apparently empty/partial financial day. | Fixed: atomic server reporting/closing snapshots, explicit errors, exports/closing disabled on incomplete reads; tested beyond 1,000 sales. |
| Critical | A price or bundle definition could change after the cashier reviewed the order. | Fixed: server locks and compares reviewed price/size; rejected carts refresh for another review; historical completed retries keep original amounts. |
| Critical | Interrupted closing saves lacked durable exact-operation recovery; stale closing inputs could conflict with concurrent sales. | Fixed: account-scoped persisted request, reviewed snapshot version, atomic server request/result; closing replay and concurrent closer tests. |
| High | Opening cash float was missing from the closing screen's drawer calculation. | Fixed: expected drawer cash includes opening float; native and browser checks. |
| High | Bar stock draft creation could be repeated after a lost reply, and already-confirmed retries were treated as failures. | Fixed: immutable actor/request/payload and recovery UI; exact confirmation replay does not add stock twice. |
| High | Older meal-write endpoints remained callable although the current finance view uses the daily meal journal. | Fixed: retired client authorities revoked; current daily usage remains canonical. No historical meal records deleted. |
| High | Current daily guest/staff meals were absent from downloaded accounting archive sections. | Fixed: daily meal journal included alongside retained historical preparation rows, with explicit guest/staff counts. |
| High | An ordinary cashier could submit untracked custom sales. | Fixed: custom-order authority requires `bar.pos.custom`; manager grant, ordinary cashier/shared tablet denied. |
| High | Settings failures silently substituted default sales configuration. | Fixed: cloud platform waits for verified settings and shows retry instead of fabricated defaults. |
| High | Stock-in draft reads silently ignored errors and only loaded ten records. | Fixed: paged reads, failed-read state, creation blocked until a successful load. Pending drafts are not discarded on failed reads. |
| High | Main/review schema histories differed; review tests depended on a sibling checkout. | Fixed: complete byte-checked immutable lineage included in review; fresh-install tests are self-contained. |
| High | GitHub Pages published after only building, independent of tests or the deployed schema. | Fixed locally: one release command, schema contract probe and publication gate; exact checked artifact uploaded. Workflow changes are not yet executed on GitHub. |
| High | Production dependency audit identified vulnerable `source-map-js` 1.2.1. | Fixed with scoped 1.2.2 update. Known-vulnerability audit is point-in-time evidence, not a guarantee against unknown vulnerabilities. |
| Medium | Cashier Admin navigation led to screens requiring permissions the cashier did not have. | Fixed: route/navigation permission requirements agree. |
| Medium | Leading whitespace could bypass CSV formula escaping. | Fixed: whitespace-prefixed formula-like exports escaped. |
| High | Stock movement, price/audit history and Stock Activity reads were capped or inconsistent after failed reads. | Fixed: stable paged history reads and explicit errors; generation guards prevent older refreshes replacing newer state. Large-history performance still needs bounded server paging. |
| High | Loading Admin could automatically recreate removed/missing default categories. | Fixed: loading is read-only; defaults require the existing explicit Create Categories action; failed Admin reads block editing. |

New forward migrations: `202610140072_bar_reviewed_transactions.sql` and
`202610140073_measured_piece_receiving.sql`.
Old migration files were not rewritten. Existing records and original retry
identities remain intact; the native upgrade test checks that preservation.

## Connected Workflow Review

| Workflow | Checked behavior | Qualification / remaining limit |
| --- | --- | --- |
| Kitchen request | Cook saves and submits; separate purchaser sees the request. | Native connected journey; delivery of an external notification is separate. |
| Purchase receipt | Saved review survives before confirmation; explicit human confirmation; retry creates one expense. | Native state/audit tested; attachment rows are metadata stand-ins, not real uploaded bytes. |
| Separate receiving | Purchase alone does not add stock; saved receiving draft alone does not add stock; simultaneous confirmation adds stock once. | Native connected journey and redacted receiver view. |
| Guest/staff meals | Shared stock; distinct guest/staff usage and meal counts; repeated same request does not deduct twice. | Native tested. Ingredient-cost figures remain estimates based on configured rates, not certified FIFO/weighted-average COGS. |
| Daily corrections | Two editors cannot overwrite the same reviewed version. | Native tested; later corrections require authorized kitchen management, not an unrecorded edit. |
| Waste/other usage | Separate attributable movement; cannot be entered through retired meal authority. | Source/permission inspection; not every waste reason exercised as a connected browser journey. |
| Stock checks | Physical count is distinct from purchases/usage and exposes a variance. | Source/unit inspection. A variance is not proof of theft or an instruction to silently replace the ledger. Authorized reasoned reconciliation remains an operational requirement. |
| Snorkelling water | Bottles/cartons require verified conversion; daily usage and counted balance are distinct. | Source/unit inspection. Historical WhatsApp balances must not be imported as purchases or fabricated receipts. |
| Individual/bundle beer | Reviewed product/bundle values, quantity deduction and historical sale values retained. | Native price-change, bundle conflict and replay checks. |
| Cocktails | Recipe required; stock stored in ml; 1,000ml/500ml bottles combine correctly; recipe deduction and void restore. | Native tested. Unrecorded pours/spillage require separate attributable usage/count checks. |
| Payment race/recovery | Same request on two connections creates one sale; two cashiers cannot both sell the last unit; actor/payload isolated. | Native concurrent PostgreSQL tested; real hosted two-device pilot still required. |
| QR proof | Missing, foreign and reused evidence denied; linked evidence retained; provider change cannot mutate a completed request. | Native metadata/policies tested. Photo is not gateway settlement; human verification is not a provider transaction integration. |
| Closing | Snapshot version, opening float, closed-day controls, interrupted reply, exact replay, two closers and reopen/void. | Native + browser fixtures; real hosted acceptance pending. |
| Reports/archive | Full financial source, read failure blocks exports; current daily meals included; reading does not automatically rewrite archives. | Native/source checks. Immutable archive revisions and reproducible PDF bytes need a separate bounded design. |
| Access/security | Named roles, self-elevation denial, shared tablet restrictions, revocation/account-change race, private helper grants. | Native + account-provider browser fixtures; actual hosted accounts/MFA not configured by this audit. |
| Scanner/alerts | Server-side secret boundary, structured receipt review, admin controls and failed/uncertain scans. | Protocol/source checks only. No paid scan or delivered external message claimed. |

## Launch Gate Status

1. **Weight vs pieces: repaired in source, migration 073.** Receipt-linked and
   request-linked receiving now preserve actual delivered weight and actual
   counted pieces. For 7 kg / 12 pcs, exactly 12 pcs enter stock; no rounded or
   estimated kg-to-piece factor is stored. Review saves a draft without stock;
   explicit confirmation adds stock once. Invalid/fractional counts, stale
   deliveries and altered retries are checked. The default Purchaser role can
   buy but cannot confirm arrivals; kitchen receivers and managers can. Native
   tests cover both paths, partial deliveries, guest/staff deductions and older
   saved normal drafts. English/Malay sample browser checks cover 320/390/768/
   1440px, reload and lost replies. Guide text/images were updated. This still
   requires the same forward migration and hosted acceptance before live use.
2. **Hosted project acceptance:** identify the existing Supabase project's
   applied migration history; restore its backup to staging and rehearse only
   missing forward migrations. The disposable 071 upgrade fixture is not a
   replacement for that actual-data rehearsal.
3. **Physical evidence:** test real capture/upload, actual ownership metadata,
   signed viewing, cross-account denial and linked-file deletion prevention.
   Current receipt hashes are browser-supplied, not independently verified
   against stored bytes. Server-derived byte hashes are needed before claiming
   strong duplicate/authenticity protection. An image cannot prove a purchase
   or payment is genuine without reconciliation.
4. **Operational accounts:** named cashier, cook, purchaser, checker, accountant
   and boss accounts; restricted roles; suspension test; disable shared-code
   login if individual accountability is required. A clickable staff name is
   claimed attribution, not verified identity.
5. **Recovery/operations:** verified backup restoration, failure ownership,
   Malaysia-midnight Cron execution, original dated reports, notifications and
   real two-device pilot. These were not accessible for this audit.
6. **Actual receipt AI:** same Supabase project, server-only `OPENAI_API_KEY`,
   controlled billing/limits, allowlisted origins and an accuracy benchmark on
   your receipt photographs. Never merge uncertain scan lines without review;
   abandoned reviews must remain attributable pending records.

The deployment probe checks a schema version and private-bucket configuration.
It deliberately does **not** certify these six operational gates. Do not treat
successful publication as their completion.

## UX and Structure

Keep the familiar four jobs: **Request**, **Buy**, **Receive**, **Record Usage**;
then **Stock Check** and **Finance** for the appropriate staff. They share one
ledger but must not silently perform each other's jobs. Prefer direct segmented
choices, remembered verified item mappings and supplier defaults over repeated
typing. Keep guest/staff usage on the same page. Quantities must remain actual
worker inputs; yesterday's usage or a recipe estimate is not automatically
today's consumption.

The repaired financial screens clearly distinguish loading, failed read,
pending confirmation and confirmed records. Unlocked screenshots include
Kitchen/Bar sample layouts and actual React error/recovery states at phone,
tablet and desktop sizes. Layout assertions check overflow/content/errors;
they are not a substitute for human visual inspection or real phone testing.

Remaining UX priorities: concise accountant drill-through from totals to
receipt/arrival/usage evidence; bounded date-range reporting for growing history;
guide screenshots updated alongside each affected workflow. Avoid introducing
additional overview pages or competing names for the same action.

Pending-work queue repaired: one consistent Kitchen header control opens a
permission-scoped list of requests, receipt reviews, linked/receipt delivery
drafts and this-device arrivals, meals, water, counts and waste confirmations.
Uncertain operations appear first. Each row opens the original workflow with
its original record ID, date or bottle size; the queue performs no mutation.
Cloud and phone-only persistence are explicit; corrupt local records remain
preserved and blocked for manager review. Failed/duplicate/changing paginated
reads do not imply an empty queue. Resume targets are reread before opening;
completed or replaced delivery drafts cannot silently become new deliveries.
Native SQL verifies purchaser/receiver cost privacy and completed records
leaving the queue. Full-App sample browser checks cover all recovery paths,
unchanged drafts, no writes, actor-switch isolation and EN/MS layouts at
320/390/768/1440px. An unrelated Waste/Other confirmation no longer opens over
the meals page. The EN/MS/ID guide includes this workflow and new sample images.
This does not make phone drafts cloud-synced or introduce production provider
qualification. Cross-device typed-draft synchronisation remains separate work.

Reporting scope repaired: direct period prints explicitly identify bar-only
reports; saved archives are labelled operations snapshots, not complete financial
accounts. Shared scope/filename definitions cover previews and prints without
rewriting historical archive metadata. Kitchen Finance now exports a period-wide
purchasing/usage CSV independently of purchase filters: receipt/item reconciliation,
tax/discount, void evidence, checked versus unknown payments, saved meal-cost
estimates, water usage and daily coverage. It excludes bar sales, counts and
pending reviews explicitly. Invalid/duplicate/null sources block totals and
exports; changing period cannot export the previous period's source. Native
PostgreSQL feeds the actual exporter under a named accountant role. Browser
checks cover downloads, recovery, scope and EN/MS mobile/tablet/desktop layouts;
fixture reads are labelled separately. Long archive filenames no longer squeeze
desktop action buttons. Some legacy Stock Movement labels remain English-only.
The sample bundle is about 1.42 MB and the main initial JS chunk about 648 KB
before compression; Vite flags the chunk size. Measure startup on actual worker
phones and slow connections before promising smooth performance. Overflow-free
screenshots do not resolve the remaining language or performance gaps.

Visual inspection also found broken Weekly/Monthly button labels that the first
overflow assertion missed. Report-period widths were repaired and explicit
single-line English/Malay checks were added before publication.

## Playbook Applied to Future Work

- `AGENTS.md` records the repeatable rules in each project checkout.
- `npm run release:check` is the current authoritative local release gate.
- `.qa/release/receipt.json` binds source, migration lineage, lockfile, artifact
  and stage evidence. Re-run only after changed inputs or a diagnosed failure.
- CI uses the same command; cloud deployment additionally checks the existing
  database contract and refuses the review's sample build.
- Older test/upgrade notes remain historical context, not current launch proof.
- A public/private live URL, native database pass, fixture screenshot and hosted
  provider pass are four different claims. Always report the appropriate one.

## Scanner Model and Dependency Sources

Official OpenAI documentation confirms the configured `gpt-6-luna` supports
image input and structured outputs. Its listed rates are $0.10/input and
$0.50/output per million tokens. Actual receipt cost depends on image/token
usage and retries; no paid calls were made for this audit.

- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://developers.openai.com/api/docs/pricing
- https://github.com/advisories/GHSA-68fv-2mgg-jv7q

## Release Boundary

### Mobile Page Delivery

The shared review no longer flattens every lazy route into one JavaScript file.
The hosted sample shell measured 628,766 raw bytes / 178,453 gzip bytes instead
of the previous 1.48 MB whole-app file; the built-browser Finance visit fetched
806,619 raw JavaScript bytes (about 46% less). These are local asset/download
measurements, not timing claims on actual staff phones. The cloud probe's shell
is about 511 KB rather than 650 KB. Large-chunk warnings and real slow-phone
performance remain open; the sample backend still belongs in practice builds.

Cloud builds replace preview client/backend imports with fail-closed boundaries.
The build rejects a preview adapter, seed or database module in any cloud chunk.
Pages remain lazy. A failed download/render now leaves navigation available and
offers a user-confirmed reload; no automatic retry, submission or draft clearing
is performed. Loading state is inside the existing page layout, not around the
whole navigation tree. Navigation to another section recovers independently.

The release gate checks eager-import and byte budgets, actual split-file loading,
missing/slow page downloads, explicit reload and unchanged saved draft IDs at
320/390/768/1440px, with EN/MS recovery screenshots. The separate single-file
practice export keeps its explicit build flag and boots Finance/POS; assembling
an ordinary multi-chunk build as a single-file export now fails instead of silently
choosing the first asset. The legacy practice export still references external
guide/product images; this does not promise complete offline media. Cloud build
probes verify exclusion and fail-closed setup, not hosted Auth or paid services.

### Accountant Source Inspection

Finance measures now open their source receipts or dated usage. Warning rows
open exact unchecked-payment, known-unpaid or breakdown cohorts, excluding voids
and previous periods; closing a receipt returns to the same filtered list.
Supplier and item totals preserve purchase filters, with exact name/category/unit
item matching and explicit separation between matched amounts and invoice totals.
Unclassified purchases appear separately so purpose rows reconcile to the total.
Usage shows recorded, absent and future dates, water closure, workers, revisions,
ingredient quantities and saved cost rates. Missing rates never become zero.
Ingredient-only costs are not presented as whole-meal costs; gram rates convert
correctly when labelled per kg. Inspection is read-only and refresh failures hide
stale source records rather than replacing them with zero. Account changes remount
the Finance workspace. The EN/MS/ID guide opens on its Finance topic automatically.

Pure cohort/calculation tests, full-App controlled financial read/browser fixtures
and native named-accountant receipt/usage inspection cover these changes. The
browser contract includes no-mutation assertions, failure/recovery, return to the
same list and 320/390/768/1440px EN/MS screenshots. Native Kitchen staff cannot
read expense costs; native accountant records feed the actual inspection helper.
These checks do not qualify hosted Auth, physical files, complete historic paging
or an audited inventory valuation method.

### Delivery Recovery Follow-Up

Linked and receipt deliveries now retain typed quantities, measured piece counts,
the reviewed source and exact save/confirm/cancel operations on the same device.
Close & Keep returns to the original form through To Finish, including after a
reply is lost. Unknown confirmation status never claims no stock was added.
Recovery is project/account/source scoped; unreadable records remain visible,
storage failures block sending, and conflicting-tab writes cannot silently
replace an existing recovery. Only exact draft IDs suppress a duplicate queue
row. Successfully confirmed or cancelled recoveries clear only their own key.

Unit checks cover schema/identity/payload preservation, storage errors and queue
deduplication. Full-App sample browser checks cover typing reload, two tabs,
storage denial, saves before/after commit, confirmation and cancellation replies
lost across reload, exact arguments, single stock addition and EN/MS layouts at
320/390/768/1440px. Native PostgreSQL consumes the actual persisted/reloaded
payload and replays saved and confirmed delivery results after stock changes.
These remain local/sample/native evidence, not hosted-provider qualification.
Typing is device-only; a successfully saved review draft is accessible to
authorised receivers through the existing cloud authority. No new schema or
alternate stock mutation API was introduced.

The private shared review remains sample-only, with its existing audience.
Matching source repairs are retained in the local main checkout. No GitHub
production push, live Supabase migration, real account creation or secret
installation is implied. The measured receiving repair is now source-qualified.
The next live step is hosted staging acceptance, followed by a small named-staff
pilot.

### Supplier Payment Follow-Up

Supplier payments and payment reversals now retain their exact reviewed arguments
before sending. Interrupted operations appear in To Finish for the same authorised
account, project and device. The original receipt opens in one tap; retries reuse
the original operation ID (or reversal payment ID), version, amount and reference.
Old bare-argument recoveries remain supported without fabricated timestamps.
Unreadable entries remain preserved. Storage denial, failed read-back and a
conflicting tab block replacement writes. A reversal must reference a payment
belonging to the displayed receipt. Only verified server results clear recovery.

Payment reads validate receipt identity, real dates, cents, unique ledger entries,
active-payment totals and status. Failed or incomplete reads hide stale totals;
they do not report zero or enable a new payment. Saving or reversing a payment
refreshes Finance and purchase lists while keeping the receipt open. Closing
returns to the same Finance inspection cohort. Recorded money never changes stock.
The EN/MS/ID guide includes this recovery path and unlocked sample screenshots.

Forward migration 074 adds a permission-checked, read-only single-receipt lookup
using the existing expense authority and its payment/accounting metadata. No old
migration or payment mutation authority is replaced. Deploy it before the matching
cloud UI. It has not been applied to live Supabase by this review publication.

Qualification includes unit storage/legacy/isolation checks, native independent
payment retries and stale/actor races, attributed reversal history and Kitchen/
anonymous read denial. Full-App sample browser checks inject interrupted replies
before/after commit, verify one resulting payment, reload and queue recovery,
Finance cohort updates, blocked quota/corrupt entries, genuine second-tab storage
events and EN/MS layouts at 320/390/768/1440px. These are local/native/sample
evidence, not hosted Auth, physical receipt-byte or real-device pilot acceptance.

### Staff Attendance and Leave

The explicitly requested Staff module is now separate from tourist attendance.
Named employees clock in/out in one tap and enter leave in a short inline form.
Only the owner and individually authorised PICs decide leave; approval does not
automatically grant attendance correction or platform administration. Staff see
their own history, while team observers receive dates without private reasons.
Agency, external-planner, anonymous and suspended accounts cannot use this module.
The existing owner Access panel delegates the new permissions.

Server timestamps, one open shift, version checks and exact operation replay
protect concurrent submissions. Corrections and decisions retain the original
record, actor, timestamp and reason. Uncertain replies retain the exact submission
on the same account/project/device and retry without duplicating records. Typing
drafts are device-only and visibly Not Submitted; they are not cloud submissions.
Pending and upcoming leave remains visible without switching to a future month.
Forward migration 075 must precede the matching cloud UI; publication does not
apply it to live Supabase or create real employee accounts.

Unit, disposable native PostgreSQL and full-App sample browser tests cover actor
isolation, concurrent retries/PIC decisions, stale corrections, interrupted
submissions, reload/storage conflicts, privacy revocation and EN/MS phone/tablet/
desktop layouts. Guides contain highlighted unlocked sample screenshots. These
are not hosted-provider or physical-presence acceptance. Named-account clocking
does not prove physical attendance; no GPS, payroll, work schedule, statutory
entitlement or company leave allowance is invented. Exports show calendar leave
duration and shifts grouped by their clock-in date, not payable hours. Kitchen
and Bar remain active; unrelated tourist/boat modules remain locked.

### Bulk Kitchen Unit Setup

Unit Setup now shows an editable item list instead of an item dropdown. Search,
Needs Setup, Select Shown and direct unit buttons apply one labelled size to
compatible selected items. Different sizes remain editable inline. A stock-unit
shortcut applies only exact kg/g, L/ml or individual-piece conversions; it never
guesses bag weights or pieces per kg. Water remains individual bottles, with a
separate carton-size field. Review and Confirm Save cover all changed rows.

Forward migration 076 orchestrates the existing save_kitchen_unit authority in
one transaction. One stale row rolls back all changes and audits. Exact reviewed
operation IDs replay the original result even after later edits. Device drafts,
uncertain-save recovery, account/project isolation and storage conflicts prevent
silent loss or replacement. No stock movement or quantity is created by setup.
The new migration must precede the matching cloud UI; the shared review remains
sample-only and does not apply live Supabase changes.

Evidence includes 50-row unit checks, native independent-connection retries and
competing edits, atomic rollback/audit/permission checks, and unlocked sample UI
with 50+ rows, close/reload recovery, lost replies after commit, different sizes,
blank numeric editing and EN/MS 320/390/768/1440px screenshots. Hosted Auth,
physical device acceptance and operational pack-label checks remain separate.

Unit setup labels identify the weight/volume of one pack or bottle, or counted
items (not weight). Workers enter labelled sizes directly with kg/g or L/ml
buttons, individually or for compatible selected rows. Exact decimal conversion
shows 5 kg = 5,000 g or 2 L = 2,000 ml before review. Changing the measurement
button converts the entered number too, preserving the physical amount.
Counted stock is never relabelled as weight or volume; whole-pack inventory = one
counted item differs from contents tracked separately.
Standard piece/kg/L conversion fields are read-only; the existing explicit bulk
action fills them. Pack/bag values stay editable and require label verification.
Review shows the labelled size and stored measurement instead of "stock units /
pack". Drafts retain selected measurement units and typed values, with legacy
draft compatibility and exact canonical payload recovery after a lost reply.
Invalid precision or mismatched typed/conversion data cannot be submitted.
This is entry conversion only: no base-unit rebasing, balance or schema change.

### Metric Kitchen Recording

Arrivals, daily guest/staff usage, physical stock checks (including loose stock)
and waste now have direct kg/g or L/ml buttons for measured ingredients. Existing
pack/piece choices remain separate. Unit changes preserve physical quantity;
non-exact conversion back into containers is blocked instead of rounded. Balance
and count differences follow the selected unit, and reviews retain sufficient
decimal precision. No weight-to-piece inference or ingredient rebasing occurs.

Purchase-linked receiving keeps ordered units and outstanding quantities intact.
Delivered weight/volume can be entered in either metric unit; container sizes
use the same labelled-weight/volume control as Unit Setup. Immutable save and
confirmation payloads remain canonical. Typing recovery retains entered units
and verifies that metric display values agree with the saved canonical values.
Legacy pending submissions remain unchanged on retry.

Forward migration 077 extends the existing record_kitchen_arrival authority to
validate selected metric units against the stored base unit, preserve the entered
quantity/unit in history and require an exact conversion. Permission checks,
sorted locks, actor audit, stale-item rejection and original operation replay
remain in that same transaction. Apply this migration before using the matching
cloud arrival UI. Shared-review publication does not apply it to live Supabase.

Evidence includes exact quantity/precision/storage checks, a native PostgreSQL
arrival -> guest/staff deductions -> physical count journey with simultaneous
retry and invalid-family/permission/stale-state rejection, and unlocked sample
phone/tablet/desktop workflows with retained unit choices, lost replies after
commit, actual stock transitions, review-to-edit conversion and linked receipts.
Worker guides include the measurement buttons in English, Malay and Indonesian.
Real cloud Auth, physical files and two-device operational acceptance remain
separate launch gates; the shared review still uses sample data only.

### Mobile Kitchen Quick Entry

Daily usage can reuse the ingredient IDs from the most recent confirmed day in
the preceding 28 days. It never copies quantities, meal counts, costs, notes or
the recording date. Inactive, missing or rebased ingredients are omitted with a
visible warning. Failed or inconsistent history disables only this optional
shortcut; manual entry and recovery remain available.

Search reaches beyond the chosen list. All / Entered narrows checking without
discarding hidden entries. The phone keyboard's Next action moves through the
visible quantity fields, skipping a blank guest/staff column only when its meal
count is explicitly zero. Existing conflicting amounts remain editable and must
still pass the established review validation.

Compatible unit choices are remembered per project, account and ingredient on
the same device, not shared to other workers. They apply only to fresh blank
entries. Existing drafts and immutable pending submissions retain their original
units and quantities. Preference-write failures do not discard the usage draft.
The existing daily journal authority, version checks and exact lost-reply replay
remain unchanged; no schema migration or new mutation endpoint is introduced.

Evidence: pure helper/storage checks and unlocked sample browser flows at 320,
390, 768 and 1440px in English and Malay, including fresh meal counts, search
outside a reused list, zero-group keyboard skipping, non-overwriting reuse,
device preference isolation, failed history recovery and one stock deduction
after a deliberately lost confirmation reply. Worker guide text is updated in
English, Malay and Indonesian. This is not real hosted-Auth acceptance evidence.

### Remembered Receiving and Count Units

Unlisted arrivals and quantity-mode stock checks now remember compatible item
units per project, account, workflow and device. Receiving, counting and daily
usage retain separate choices. Only fresh blank entries use a preference; typed
drafts, reviewed snapshots and uncertain confirmation payloads remain unchanged.
No amounts, dates, suppliers or expected balances are copied from previous
transactions. Unit memory does not create a recording draft or submit anything.

Optional preference-storage failures are visible and do not discard the actual
recording draft. Preferences are written only after the recording edit persists.
Receiving's keyboard Next skips disabled/unconfigured rows and does not submit
the form or bypass review. In an entered-only list, moving between a quantity and
its unit buttons keeps the row available until the worker leaves it.

Evidence extends the existing metric sample-browser journey with independent
workflow preferences, successful next-delivery/next-count blank defaults after
reload, preference-only storage faults, original typed units despite preference
changes, skipped unconfigured rows, frozen lost-reply recovery, single stock
transitions and English/Malay phone/tablet/desktop screenshots. Pure helper
checks cover project/account/workflow isolation and incompatible units. The
existing mutation authorities and schema are unchanged; no live-provider access
or production readiness is implied by these local tests.

The receiving guide now distinguishes saved cloud review drafts for linked
deliveries from device-only unlisted delivery typing/review. The latter syncs
only after confirmation. A release fixture was repaired to read item versions
after its opening-count movements instead of relying on timestamps accidentally
matching within the same millisecond. Production stale-version rejection was
not weakened; the failed cloud-source release receipt is retained.

### Compact Kitchen Navigation

Kitchen section tabs, the pending-work clock/count and the guide now share one
mobile row at common phone widths. Narrow 320px screens keep a two-row grid with
all labels visible. The same section header is used across stock, requests,
purchases and Finance. The mobile purchasing tab is named To Buy; its accessible
name and route remain Purchases. Visible labels are not replaced by dropdowns.

On phones and when the sidebar is hidden, the kitchen tabs stay beneath the main
app header while scrolling. A repeated Kitchen title is visually hidden only
when the main app header already supplies it; the semantic heading remains.
Stock actions are shorter while keeping at least 44px touch targets. At 390px,
like-for-like sample usage measurements changed the header from 96px to 44px
and stock actions from 56px to 46px, placing the ingredient heading 67px earlier.
This measurement is not a universal saving for every device or text size.

Pending-work counts use fixed-size badges. More than 99 shows 99+; the exact
count is available in the tooltip and accessible description. A failed/incomplete
read still shows !, not zero. The queue remains one tap away, with the same
original-record recovery, actor permissions and immutable pending payloads.
No business mutation authority, receipt, quantity or schema was changed.

Evidence covers English/Malay five-section navigation at 320, 360, 390, 640, 768
and 1440px, visible/non-overlapping controls, sticky positioning, queue and guide
access/focus return, retained typed quantities, large queues and failed reads.
The worker guide explains the clock badge in English, Malay and Indonesian.
Its English/Malay training image highlights the actual clock on the new header.
All screens are unlocked sample UI; hosted-provider acceptance remains separate.

## Predictable Daily Usage Lists

Daily usage now groups All Ingredients, Last List and saved meal templates as
ingredient-list choices. All Ingredients is idempotent and clears template
selection; removing the last selected template returns to all ingredients.
Multiple meal templates can still be combined. Changing lists exits the Entered
filter and clears search, but never changes typed quantities, units, version
snapshots, meal counts, notes or the correction version. A failed draft write
does not change the visible list or clear its filter.

List / Entered replaces the two differently functioning All labels. Searching
leaves Entered mode so an unentered ingredient is immediately available. Entered
clears search so it shows all typed amounts rather than silently hiding them.
Ingredient-list choices have a stable row; long template names wrap below it,
and template management is a labelled, 44px settings icon. Search and the checking
filter share a row on common phones and stack on narrow 320px screens.

The canonical sample-browser stage checks list selection, combining templates,
repeated All Ingredients taps, final-template removal, search/filter transitions,
quantity/snapshot preservation, reload recovery, unchanged stock and the existing
lost-confirmation replay. EN/MS screenshots cover 320/360/390/768/1440px with
long-name stress fixtures and representative unlocked kitchen records. Worker
guide text and its EN/MS usage images reflect the new list controls. This adds
no cloud mutation authority, migration, live provider call or production claim.

## Waste Drafts and Phone Recovery

Waste / Other now preserves item quantities, measured units, stock/item versions,
reason and notes before Review. Device drafts are account/project scoped, carry
creation and last-saved timestamps, and resume through To Finish. They are not
cloud submissions and do not deduct stock. This is a recording-recovery aid,
not tamper-proof evidence of a worker's actions on a browser they control.

The editing draft stays separate from the original frozen confirmation. Closing
an unattempted review saves an editable draft before removing that local review.
An uncertain response keeps its exact ID and arguments. A verified confirmation
clears its draft; deliberate draft removal needs its own confirmation and never
removes an existing stock movement. Corrupt storage is retained and blocks new
submission. Concurrent tab changes block old editing/confirmation. Stock/item
snapshots are never silently updated to match changed stock.

Keyboard Next traverses visible editable quantities. Entered checks only filled
items, and search returns to all-item mode to find missing items directly. The
review footer uses the full recording section rather than the short reason
block as its sticky boundary. The sample toolbar measures its own height, and
kitchen footers use that height instead of a fixed 46px offset.

Unit evidence includes shape/unit/version guards, corrupt/quota/silent storage
failures, two-tab compare-and-set, and queue permissions/deduplication. The new
canonical sample-browser stage covers typing/reload/queue resume, review/back,
lost replies before/after commit with a single deduction, stale stock, independent
tabs, deliberate discard, account switching and EN/MS 320/390/768/1440px geometry.
The guide opens the waste topic directly and has current EN/MS screen captures
plus English/Malay/Indonesian instructions. Initial focused fixture failures
(actor-key assumption, descendant selector, shortcut browser context and persona
landing-route assumption) were diagnosed separately; their screenshots remain
under .qa/screenshots/waste-draft/failure-before-*. No live provider was used.

The first broad gate stopped on Staff team geometry at 320px. Its failed receipt
is retained as .qa/release/receipt-waste-before-staff-geometry-diagnosis.json.
A focused repeat passed, but the captured layout showed cramped period labels
and date fragments. Narrow Staff screens now use a 44px labelled download icon,
full-width period tabs with a separate date row, and non-splitting date tokens.
Geometry checks wait for the measured sample-toolbar height before their normal
animation-frame settlement, retain the original strict overflow assertions, and
include element-boundary diagnostics on failure. Current Staff guide images
reflect the layout. No attendance, leave, export or permission authority changed.

## Receiving and Count List Recovery

Unlisted receiving and stock checks now follow the same search/filter behaviour
as daily usage and Waste / Other. Search opens all active matching items; Entered
and count-progress choices clear search so a previous query cannot hide entries.
These are display changes only: quantities, unit choices, notes, versions and
pending operation arguments are not recalculated or filled from expected stock.

Typed entries whose catalogue item is inactive or missing remain visible as
Not in the Active Item List, with their quantity/unit and an explicit Remove
Entry action. This means catalogue status, not a claim that goods are physically
out of stock. Only that unfinished entry is removed; other draft snapshots and
confirmed stock stay unchanged. Count removal persists before hiding the entry,
so quota/CAS failures retain the visible recovery action. Frozen confirmations
still block editing/removal and preserve the original request.

The canonical metric-recording browser stage now covers filter/search transitions,
empty Entered states, inactive receiving/count entries, missing-item counts,
zero counts, failed removal storage, preserved snapshots and unchanged stock,
followed by its existing confirmations and lost-reply replay. EN/MS captures
cover 320/390/768/1440px with visible 44px recovery actions. Guide instructions
are updated in English/Malay/Indonesian; current EN/MS count images highlight
the progress controls. No authority, migration or live provider was changed.

The first broad run caught a sample-persona reload/navigation race in the prior
waste test. Its failed receipt is preserved as
.qa/release/receipt-receiving-count-before-persona-navigation-fix.json. The test
now waits for the persona's completed load and verifies its ID before navigating
to Waste / Other, using the existing Staff test pattern. It does not weaken the
account-isolation or stock-recovery assertions.

## Long Kitchen Request Lists

The quantity-only request form keeps search, All Items / Entered and the quantity
heading visible inside its scrolling dialog. Header, close and Save & Review
remain outside that scrolling list. English and Malay filter labels have enough
room at phone widths; the narrowest screens stack search above the buttons.

Searching exits Entered and closes a previously expanded item. Both list choices
clear the old search and focused/expanded row, avoiding hidden unentered items or
an unrelated editor pinned into search results. These are display-only changes:
the exact durable draft, quantity strings, units, notes, timestamps and operation
identity remain unchanged. No request is sent until the existing save, review
and explicit confirmation process finishes.

The request draft unit test and the previously historical request browser test
are now part of the canonical release gate. The browser test owns an ephemeral
sample Vite server in either checkout. It covers blank Entered, alias search,
search/filter preservation, sticky controls at 320/390/768/1440px in English and
Malay, keyboard Next, two-tab guards, lost-save replay, draft resume/discard,
stale edits and a complete 58-item saved review. Current guide text and actual
unlocked EN/MS request screenshots accompany the change. This is local/sample
evidence, not hosted Auth, physical Storage or production qualification.

## Purchaser Receipt List Checking

Request-linked receipt entry now has All Items / Entered and sticky search plus
column headings. Entered includes any quantity or cost, including a zero, invalid
value or cost-only incomplete row, rather than hiding unfinished financial data.
Clearing the final value keeps the focused row until the worker moves on. Search
exits Entered; either list choice clears an old query. Filters are display-only
and do not change the saved review, money, units, audit or stock. Bulk quantity
fill is available only in the full/search list when there are eligible blanks,
not during entered-row checking. It still requires an explicit click, respects
current remaining quantities and never overwrites typed values.

Buying-list and receipt-row search reuse the kitchen catalogue's English/Malay
aliases. This affects discovery only: receipt extraction matching remains strict
on exact name and unit, with no fuzzy financial match or guessed container size.
An item-filtered buying search still opens the entire original request. The cost
column says Total RM / Jumlah RM; the guide specifies that it is a line total,
not a per-unit price. Keyboard Next proceeds through quantity then cost without
placing the input behind the sticky tools.

The exact-match unit test and request-linked receipt browser journey now run in
the canonical release gate. The browser owns its sample server and covers both
photos, pending review/resume, exact extraction matches, cost-only errors,
filter/audit preservation, partial purchase, lost-confirmation recovery, one
accounting purchase without receiving stock, and a 50-item EN/MS list at
320/390/768/1440px. Actual unlocked receipt guide images were refreshed. Hosted
AI, physical file uploads and production accounts remain separate gates; no
live record, schema, billing configuration or permissions were changed.

## Actionable Receipt Checks

The receipt footer now offers one Check action for the next missing or invalid
detail rather than a long, non-interactive list. It focuses the supplier, date,
currency, total, relevant photo control, exact invalid receipt-line field, tax
field or required review note. A buying-list problem restores the full list and
focuses the first invalid quantity or cost; unknown snapshot entries instead
focus Refresh List without invoking it. No value, review version, audit, stock
or verification checkbox is changed by navigation. Read-only, busy, scanning,
conflicting and uncertain reviews retain their existing editing restrictions.

Receipt-line targeting reuses the same validation predicate as receiptProblems,
with tests preserving the original numeric/unit/name/money rules. The canonical
request-receipt browser journey covers hidden quantity/cost errors, field-specific
receipt corrections, tax, note, supplier/date/total/currency, photo focus and a
new unlinked receipt's purpose. EN/MS 320/390/768/1440px captures verify visible
focus and 44px checking actions; photo labels now show a keyboard focus ring.
Guide instructions and highlighted screen captures match the new footer.

The first focused test exposed a React commit timing issue: the filter changed
but its newly visible input did not receive focus. The failed screenshot is
retained as .qa/screenshots/request-receipt/failure-before-filtered-focus-commit.png.
Focus now occurs in a layout effect after callback refs for the restored list
have committed, rather than relying on one animation-frame delay. This is a
frontend navigation change only, not a new Supabase API or live-data migration.

An expanded fixture also exposed a test-baseline race with debounced typing:
an earlier currency/quantity edit was still saving when the audit comparison
started. The comparison now waits for the form's saved-review acknowledgement
and verifies the persisted MYR/cost values before retaining the same strict
navigation-versus-audit assertion. Its failed screenshot remains as
.qa/screenshots/request-receipt/failure-before-typing-save-acknowledgement.png.

The strict tablet geometry check then caught the global ui-control desktop
minimum overriding the new button's single-class rule. Its 44px minimum now
uses the receipt-dialog scope; geometry assertions remain unchanged. The prior
frame is retained as failure-before-check-button-specificity.png in the same
screenshot directory.

## Daily Usage Recovery

Typed daily guest/staff usage for inactive or missing ingredients previously
disappeared from the active list but still blocked review. Such entries now
remain visible outside the ingredient filter, with their saved name, both
quantities and units, and one Remove Entry action. Explicit zero entries are
included. The action removes only that unfinished row through the existing
persist-before-state, exact-value draft authority; it does not change stock.
Failed stock-list reads never classify items as unavailable or offer removal;
the browser test verifies the original draft survives this failure and retry.
Loading, conflicts, another-tab changes and frozen confirmations retain their
existing mutation restrictions. Confirmed historical entries remain visible
without a remove action, using the saved record rather than hiding archived items.

New drafts retain a display-name snapshot, including after unit changes. Legacy
drafts without names remain readable; a missing legacy item has an ID-qualified
fallback. Names are display-only, not quantity, permission or unit authority.
EN/MS/ID usage guide instructions now cover this recovery path.

The canonical gate now includes daily-usage draft unit tests. The metric browser
journey verifies inactive and missing entries, explicit zero, quota failure,
preservation of every other quantity and day field, unchanged stock, reload,
confirmed history, and unlocked EN/MS 320/390/768/1440px captures. The mobile
warning must fit between the visible sticky header and footer, not just have
an in-bounds button. No Supabase API, schema or live record is changed.

Focused evidence corrected two harness assumptions: confirmed records use the
server's stored display unit rather than the temporary input unit, and retained
hidden kitchen workspaces must be excluded when measuring a visible footer.
Their screenshots remain as failure-before-confirmed-display-unit-expectation.png
and failure-before-visible-footer-selection.png under .qa/screenshots/kitchen-measure.
The inactive-stock fixture read was also made explicitly inactive-inclusive;
failure-before-inactive-stock-fixture-read.png preserves the original evidence.
Hosted provider acceptance and the two-device production pilot remain separate
launch gates; passing sample/local checks is not production qualification.

## Direct Daily Usage Corrections

Review now reveals and focuses the exact invalid field after its filtered rows
have committed. The explanation sits beside that ingredient, meal count or
correction reason, with an accessible description and invalid-field border.
Missing meal counts receive a direct explanation instead of an unexplained
disabled Review button. Invalid amounts and combined use exceeding stock have
distinct messages. Missing ingredients focus search; unavailable items focus
their unfinished-entry action. Unconfigured ingredients focus their row and
request manager setup, not clearing quantities from disabled inputs.

This navigation only changes presentation state, not saved drafts, quantities,
unit preferences, selected templates, expected versions, operation IDs or stock.
Frozen confirmation, read-only, loading, failed stock reads and conflict guards
remain in force. Validation still precedes the existing reviewed confirmation.
EN/MS/ID usage-guide instructions describe the automatic correction focus.

The correction journey exposed a pre-existing conversion failure: 100 ml from
a 750 ml bottle reopened as a repeating bottle fraction rejected by the form.
Correction entry now uses the exact existing metric conversion when a container
fraction cannot round-trip to the saved ledger quantity. Exactly representable
container amounts remain unchanged. No quantity rounding or weight-to-piece
conversion is introduced. Historical records remain unchanged. The original
failure frame is kept as .qa/screenshots/kitchen-measure/failure-before-measured-correction-quantities.png.

The canonical metric browser journey checks hidden invalid guest/staff amounts,
combined-stock limits, empty and invalid meal counts, zero-meal mismatch,
missing ingredients, missing setup, unavailable items, stale snapshots and
correction reasons. It verifies exact persisted drafts and unchanged stock,
no premature confirmation, focused controls and explanations unobscured by
sticky navigation/footer at 320/390/768/1440px in English and Malay. This is a
frontend validation and exact display conversion change; no live schema,
Supabase records, sharing permissions or paid scanning calls are changed.

## Recheck Without Retyping

Withdrawn on 15 October at the owner's request. See Manual Quantities Only below.

A stale typing draft can now offer Keep These Amounts after the worker checks
the item and both quantities. Eligibility requires the saved ingredient name,
base unit, entry unit and conversion factor to match the current active item,
valid amounts in the same measurement family, and a newer readable item version.
Renamed items, changed pack conversions, different measurement families, missing
setup and invalid amounts still require correction. Legacy drafts remain readable
but cannot use this shortcut without a saved base-unit snapshot; no family is
inferred from the current item. Unit switching preserves that legacy restriction.

The explicit action writes through the original exact-value, persist-before-state
draft authority. It changes only the checked item version (and the identical
display name), preserving quantities, other entries, selected lists, meal counts,
notes and expected day revision. It neither submits usage nor changes stock.
Frozen pending submissions and read-only/conflicting/loading states cannot use it.
Fresh review and the normal confirmation checkbox remain mandatory; excessive
quantities still fail stock validation after this check. Save failures retain the
draft and focus a visible error with a 44px Reload Day action.

New typing drafts capture the known base unit. Clearing both old amounts and
explicitly re-entering them captures the current setup; merely changing a legacy
draft's unit does not invent its missing original base unit. EN/MS/ID usage guides
describe the limited shortcut and the remaining review/confirmation steps.

The canonical draft unit tests cover all three base families, zero, blanks,
changed/renamed/inactive items, corrupt snapshots and invalid conversions. The
metric browser journey covers EN/MS 320/390/768/1440px action sizing and visible
focus, exact preservation, quota failure, same-tab simulation of another tab's
write and reload recovery, no automatic submission, continued stock limits and
changed-pack/legacy rejection. No live Supabase schema or records are changed.
The first expanded competing-tab journey reached the correct preserved note,
then encountered two Note labels because another hidden kitchen pane stays
mounted. The test now scopes that edit to daily usage's exact control. Its
original frame is retained as failure-before-usage-note-scope.png in the same
screenshot directory; the production action already uses its section-scoped refs.

The mirrored cloud gate then exposed a pre-existing sample-persona reload race
in the pending-work browser test. Its failure receipt and both frames are retained
under .qa. The test now waits for the new load and verifies the new actor before
checking queue privacy, matching the staff and waste test pattern. Only the exact
expected destroyed execution context is tolerated during that deliberate reload;
all other errors and the actor-isolation assertions remain enforced.

## Grouped Mobile Entry

Daily kitchen usage keeps compact Guest/Staff column labels visible while the
ingredient list scrolls. They align with the quantity fields and highlight the
focused group. A ResizeObserver measures the real kitchen navigation height;
sidebar visibility, translated wrapping and viewport changes retain the correct
offset. The sticky labels are bounded by the ingredient table, not the notes,
footer or confirmation dialog. No new mode buttons or automatic quantities were
introduced.

The phone keyboard Next follows visible enabled guest quantities, then staff
quantities, instead of alternating both groups per ingredient. It skips disabled
zero-meal fields and ends at the final field without looping or submitting.
Manual taps remain available in either column. Only the existing input handlers
write the draft; focusing, scrolling and resizing have no mutation authority.

The canonical quick-entry browser journey checks an explicit fifty-item fixture,
EN/MS 320/390/768/1440 layouts, sidebar open/closed changes, a smaller
keyboard-height viewport, aligned labels, unobscured focus, group-by-group Next,
stock preservation and unchanged exact draft bytes. Original fixture-size and
wrapped-Malay-label failure frames are retained in kitchen-quick-entry. The
initial seed had fewer than fifty items; explicit sample-only rows now provide
the requested long-list coverage. Short translated labels avoid the observed
wrap. The usage guide and its generated EN/MS screenshots reflect the flow.
No Supabase API, schema, financial calculations or live records changed.
The first smaller-viewport check selected another retained hidden pane's footer
with a document-wide selector. The retained screenshot shows the usage input
already clear of its real footer. The assertion now scopes both boundaries to
that input's usage section; production layout did not need a compensating scroll.
Guide capture now waits for the mobile sidebar layout, offsets only actually
sticky navigation and asserts the highlighted controls are in the viewport before
saving an image. Both generated guide images were visually inspected unlocked.

## Receiving Without Retyping

Withdrawn on 15 October at the owner's request. See Manual Quantities Only below.

Unlisted receiving now reveals and focuses the exact invalid or stale quantity,
even if search or Entered previously hid it. The explanation sits beside that
row, with aria-invalid/aria-describedby linkage. An unavailable entry focuses
its existing Remove Entry action instead of hiding the whole-record error above
a long list. A failed stock read cannot classify saved entries as unavailable.

Keep This Amount is offered only for an active item with an identical saved
display name, base unit, setup unit and factor, a strictly newer readable item
version and a valid positive quantity. Changed conversions, names, invalid/zero
amounts and unknown/older versions require correction. The action uses the
existing delivery edit/storage authority and only updates the checked item
version. It retains the date, supplier, reference, selected measurement, typed
quantity, other entries and device unit preferences. It never adds stock or
replaces a frozen confirmation. Failed writes focus the preserved actual error;
competing-tab edits must be reloaded, not overwritten.

Canonical metric unit and unlocked browser tests cover all three base families,
wrong/unknown conversions, missing items, hidden invalid/zero quantities, exact
draft preservation, quota failure, concurrent-tab reference preservation,
changed-pack rejection and the unchanged reviewed/lost-reply stock addition.
EN/MS 320/390/768/1440 screenshots check visible focus, explanations and 44px
actions. The receiving guide documents the bounded shortcut. The first extended
journey reached the correct blank next delivery in the intentionally changed g
preference; its old kg expectation assumed the previous manual unit-button tap.
The test now asserts Keep leaves preferences unchanged. That failure frame is
retained as failure-v76-before-next-unit-expectation.png. No live Supabase schema,
records, purchasing events or accounting calculations were modified.

## Direct Request Corrections

Save & Review now reveals and focuses the precise invalid request quantity in
the compact list instead of opening the item editor and focusing its name.
Quantity explanations link to the marked field through aria-describedby. Only a
missing name or unit opens that item's editor, focusing the required detail;
correcting a unit no longer moves focus back to its name. Empty saved unit values
have a visible Select Unit placeholder rather than implying the first option is
selected. Existing validation rules and payload construction remain unchanged.

For custom items, keyboard Next from the name closes the editor and focuses the
existing quantity field without requiring Done. It checks a blank name locally,
does not submit the form, does not copy amounts and does not write the draft.
The existing edit/persist authority, attempted-save freeze, exact operation ID,
server stale-record guards and separate Confirm & Send remain unchanged.

The canonical request browser journey checks hidden incorrect quantities,
negative values, missing names and units, direct keyboard custom entry, no extra
editor for quantity errors, exact raw draft bytes and no saved requests during
error navigation. EN/MS screenshots at 320/390/768/1440 verify focus and both
fields/explanations between the pinned search and footer. The existing competing
tab, lost-response recovery, quantity-free list reuse, saved review, final human
confirmation and full 58-item review still run in the same connected journey.
The optional EN/MS/ID request guide now reflects these actions. No live records,
Supabase schemas, stock calculations or accounting totals were changed.

## Manual Quantities Only

The owner withdrew quantity-retention shortcuts. Keep This Amount and Keep These
Amounts, their acceptance functions and styles are removed. Changed item details
require clearing and manually re-entering the actual receiving quantity, or both
guest and staff quantities. Typing the same amount over an old value does not
accept stale item metadata. Field-level explanations and direct focus remain.

Fill Remaining, Fill Shown Quantities and Fill Exact Receipt Matches are removed
from purchasing and receiving. Requested, purchased or extracted quantities must
not populate actual bought or received entries. New delivery suggestions retain
only unique item mappings and verified unit setup; actual quantities stay blank.
Receipt extraction remains a separately reviewed reference, not stock authority.
List reuse keeps names only. Physical counts remain manually entered.

Existing typed drafts, historical records and frozen confirmation payloads are
preserved, not erased or rewritten. A lost response still retries the same
operation, and competing-tab edits cannot silently overwrite another draft.
Explicit Review, verification checkbox and final Confirm remain required before
stock changes. Measurement conversion remains exact and does not guess pack
contents or kg-to-pieces conversions. EN/MS/ID guides reflect manual entry.

Focused unit and unlocked browser tests assert the removed shortcuts are absent,
stale amounts cannot be accepted, failed writes preserve drafts, and actual stock
and accounting changes occur only through the original confirmation authority.
The canonical release receipts retain candidate-bound full verification evidence.
Private review publication does not qualify or modify live Supabase records.

## Fresh Kitchen and Bar Entries

The follow-up checks trace active Kitchen request/repeat lists, purchasing,
receiving, guest/staff usage, water, waste, physical counts, Bar stock-in, POS,
and closing. Repeated ingredient/request lists retain names and units only.
Original unfinished drafts and frozen uncertain operations remain recoverable;
opening a confirmed record for an authorised correction is not a new record.
Unrouted legacy production modules stay locked and are not enabled by this work.

Bar stock-in no longer strips characters from numeric inputs: 1.5 must not
become 15, -2 must not become 2, and a cost such as 12.345 must not silently round.
Every nonempty quantity/cost row must validate before any draft is created.
Invalid, cost-only or inactive-product entries cannot be silently omitted while
other rows are submitted. Checking an error reveals and focuses its actual
control synchronously. Inactive products retain their typed quantities visibly
until the worker explicitly removes that unfinished entry.

Changing individual units/cartons clears that quantity for manual re-entry;
tapping the current unit preserves the same draft. A carton-size snapshot from
the first typed quantity rejects a later changed conversion until cleared and
re-entered. The existing checked draft and final stock confirmation authorities,
original request identity, lost-response recovery and submission proof remain.
New batches start blank. No old draft, confirmed stock or ledger row is rewritten.

Changing closing dates clears the previous actual-cash entry, notes and review
checkbox state. Pending closing payloads are unchanged. POS discounts reset for
paid or emptied orders, including the local preview path. Changing water between
Operating and Closed clears hidden bottle inputs; returning to Operating needs
a fresh manually entered quantity. Selecting Closed still explicitly records
zero usage after review, rather than treating unrecorded days as zero.

Bar stock controls have 44px targets and phone-friendly input sizes. Product
balances wrap instead of truncating, the cost placeholder states RM/unit, and
the two-action footer stays above the preview bar and safe-area inset. The
one-click whole-form Clear action is removed; individual row clearing remains.
Save & Review describes the saved-draft stage rather than implying stock has
already been confirmed. EN/MS/ID guide text and EN/MS stock images are updated.

A connected sample-browser journey is part of the single canonical release
gate. It checks exact raw invalid values, no draft/stock mutations on errors,
changed carton/active item handling, actual stock changes after confirmation,
blank subsequent batches, fresh paid/abandoned POS orders, water date/status
isolation, original-draft recovery and EN/MS 320/390/768/1440 layouts. A separate
controlled browser contract checks closing date isolation and immutable retries.
Native PostgreSQL race/actor tests remain separate from sample UI evidence.

Preserved diagnostic frames distinguish an asynchronous-focus defect, responsive
and unavailable-message selector assumptions, and the observed 40px input CSS
override. Error focus is synchronous, selectors reflect actual responsive labels,
and scoped stock control sizing fixes the CSS issue. The preview toolbar overlap
found in those frames is corrected, not hidden by disabling the screenshots.
No live Supabase schema, records, authentication or Storage settings are changed.

The initial final-gate run was stopped before completion to correct clipped
numeric placeholders found in the guide captures. Its partial receipt is retained
as receipt-before-placeholder-fit-79.json; final qualification requires rerunning
the entire gate on the corrected source and refreshed guide assets. Numeric
values retain phone-sized text; compact placeholders are measured for fit.
