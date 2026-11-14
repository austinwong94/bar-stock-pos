# Closing Read Safety

Closing keeps its business-date control available during loading, invalid links
and failed reads. Invalid or cleared calendar dates make no RPC and show a
localized correction message. Selecting a different day immediately hides the
old figures and clears the old cash count, notes and review. Read generations
and the current date reject old successful and failed replies. Account-keyed
workspaces remain separate. Failed snapshots cannot reveal totals or actions.

The shared reader validates complete sales and items, dates, exact monetary
values, paid/discount reconciliation, the explicit report/cash-session fields,
opening float, saved totals, cash variance and provided snapshot breakdowns.
Explicit null cash sessions mean no session; missing or malformed fields do not
become zero. Historical nullable cash values remain unknown and are displayed as
Not Recorded. Legacy product breakdowns without the later discount field remain
readable; no saved report or original retry payload is rewritten.

Native PostgreSQL integration exposed an older History validation defect: the
real cash/FOC QR status is not_applicable, not not_required. The reader and its
fixtures now match the real schema. The connected gate passes actual open,
closed and reopened snapshots through the production parser, including 1,205
complete sales. The volume fixture includes real item rows instead of header-only
stand-ins. This contract test remains part of the canonical release gate.

Closing reuses integer-cent History totals. Reopened reports show current live
figures rather than their old closed totals; locked reports retain their saved
values. A changed snapshot version invalidates an open confirmation and its
checkbox without erasing unfinished same-day typing. An explicitly unlocked
Reports correction waits for the matching verified read and does not race a
duplicate initial fetch. Pending sale actions/closings still block that action.
The existing reopen mutation's interrupted-response recovery remains a separate
work item; this change does not certify or replace that authority.

Evidence is classified separately: unit schema/calendar checks; actual native
PostgreSQL snapshots; real React screens with controlled read/Auth responses and
EN/MS 320/390/768/1440 screenshots; optional guide screenshots from the isolated
sample app. Failure logs and frames retain the status-contract, translation and
pending-test-isolation diagnoses. None is a hosted physical receipt upload or a
two-device pilot. No schema migration, seed quantities or live business write is
required for this change.
