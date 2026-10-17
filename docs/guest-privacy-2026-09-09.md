# Guest Privacy and Compact Sheet

## Deployment Boundary

This update is for the existing private sample review shared with Austin and Chloe.
It does not apply migrations to production Supabase or invite external planners.
The sample site's role controls are demonstrations, not a security boundary: all
sample records are stored in that browser. Never import confidential live data there.

For production, deploy `202609090045_guest_privacy.sql` before the matching client.
The new client intentionally has no fallback to unredacted raw-table reads.
Validate with named production test accounts before granting external access.

## Administrator Controls

Admin & Access > Users & Access > Guest Privacy:

- Contacts only: hides contact fields, identity documents and free-text notes
  after the cutoff; keeps guest names and operational figures.
- Names & contacts: also replaces guest names with a private label. Booking
  references and passenger counts remain available.
- Keep history: explicit exception for trusted named in-house PICs. Active boss
  accounts retain history automatically.
- Hide after: 1-365 calendar days from the service date, at 00:00 Malaysia time.
  For a 9 September service, 1 day hides on 10 September; 3 days on 12 September.
- Accounts & commission: a separate explicit permission. It does not implicitly
  grant retained guest history or wider access-administration permissions.

Default: names and contacts expire the next day for non-boss accounts. Existing
accountant financial permission remains, but retained customer history must be
explicitly granted. New rules never delete original records.

Every person must have a separate named account. Assign Alvey and planning-only
PICs the External Departure Planner role and approve only the required dates.
Associate all agency-related accounts with their agency. The system cannot infer
business relationships from a name or email address. Agency-linked accounts and
external planners cannot obtain booking finance/commission through an override,
and cannot receive a retained-history exception. Shared anonymous accounts cannot
receive the exception either.

## Enforcement

- Raw historical booking/tourist/manifest reads fail closed through restrictive
  RLS. Controlled read functions retain counts while masking guest fields.
- Daily sheet, passenger list, pickup board, staff manifest, meal needs, booking
  accounts and history use redacted responses. Private helper functions live in a
  non-exposed schema without public/authenticated execution privileges.
- Historical raw audit, attendance and outbound message data are restricted.
  Rebuilding an expired guest message is blocked. Summary incident text is withheld.
- Hidden names/contacts cannot be written back over the original booking. Private
  accounting notes are protected from masked-form overwrites.
- Admin saves are version checked, serialized per account and audited. Stale
  financial-permission changes are rejected. Other devices refresh via the existing
  shared-refresh mechanism; backend reads enforce the current rule immediately.
- Recovered spreadsheet drafts are discarded when a fresh server response marks
  that day private. Exported sheets use the same visible, redacted data.

The feature cannot recall screenshots, downloads or information a user already
received. Free-form labels such as tour names and pickup locations are operational
fields, not a general-purpose detector for personal information. Avoid placing
customer contact details into those fields.

## Layout

- Spreadsheet cells have a 30px content height (31px including the border).
  Saved status, editor and history action occupy one row.
- Existing device-local zoom, column widths, sheet height and optional sidebar
  settings remain intact.
- Shared page headings use 20px, section headings 16px and subheadings 14px.
  Standard controls use a 38px desktop minimum and 44px on phones/coarse pointers.
  Spreadsheet cells intentionally remain compact.
- Repeated saved/date strips are absent when idle. Unsaved changes and save
  feedback remain visible. Admin counters use a compact summary instead of four
  stacked mobile cards.

## Verification

Use the disposable local database runner plus `scripts/test-guest-privacy-ui.mjs`.
`scripts/test-direct-workflows-ui.mjs` exercises 28 main routes across desktop,
tablet and phone sizes. Tests use synthetic data only and reject cloud endpoints.
Chromium viewport checks do not constitute physical iPhone/Safari verification.
