# Bar Settings: Verified Reads and Save Recovery

The general Settings form now uses the existing `save_app_settings_checked`
request ledger, actor check, advisory lock and per-key reviewed versions. No
new database migration or mutation authority is introduced.

- A failed, thrown, timed-out, malformed or repeated-row read does not replace
  entered settings or show a successful reload. Older reads cannot replace newer
  reads or edits made while loading.
- Missing keys are verified as absent, not populated from sample/default
  settings. Text and numbers stay blank; unset switches show Not Set. An owner
  must provide valid values before saving. Missing versions are explicitly null.
- A request is retained on this device before sending, scoped to project and
  named account. Browser locks and compare-before-write checks protect competing
  tabs. Storage failure prevents the request from being sent.
- Interrupted saves freeze their original fields and show Check Saved Settings.
  Retry uses the same request ID, actor, values and reviewed versions. Corrupt
  recovery details are retained for investigation, not silently removed.
- An initial definitive rejection leaves manual entries intact. Stale versions
  require a deliberate reload, with confirmation before discarding typed changes.
  A later rejection cannot disprove an earlier uncertain attempt.
- Success requires both an exact saved-result check and a verified current read.
  Replaying a previous save never installs its historical values over a later
  manager edit. Failed post-save reads leave recovery available.
- Staff-name edits retain focus and spaces, including temporarily empty rows.
  Removing a name is explicit; an empty edited row is not silently omitted.
- Touch controls are at least 44px; numeric inputs remain blank when cleared.
  EN/MS phone, tablet and desktop screenshots use controlled test records only.

Evidence is part of the canonical `npm run release:check`: pure validation and
recovery tests, independent native PostgreSQL connections, and the actual React
Settings component with controlled failure/recovery responses. No test writes
live settings, prices, quantities, purchases, sales or accounts. Actual hosted
acceptance is recorded separately; local fixtures are not physical-device proof.
