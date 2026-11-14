# Bar Sale Action Recovery

Sales History and Daily Closing use the same checked sale-action authority and
the same project/account-scoped device recovery. One review version follows every
server update to a sale. An older screen cannot overwrite a newer QR decision or
void a changed sale without reloading and reviewing it.

Before sending, the device retains the request ID, reviewed version, actor,
intended action, reason, sale number/date and exact original/paid values. Lost,
timed-out or malformed replies retain that operation. The page shows Sale Action
Pending with one Check Sale Action button. Other sale changes and a new closing
are blocked until it is resolved. Navigation between History and Closing keeps
the original operation; a new account cannot see or replace it. Unreadable local
recovery is retained for owner investigation. Nothing is inferred from a matching
current QR status alone.

The server serializes actions with checkout and closing, checks permissions and
actor identity, rejects stale versions, and stores the original result atomically
with the business mutation. Exact replay returns that proof without changing a
later QR decision, creating another audit event or returning stock twice. The
original result remains recoverable after the day closes, subject to current
authorisation. The UI refreshes current figures instead of installing an old reply
as current state. A failed financial read hides totals and actions.

The forward migration adds version metadata and a private request ledger only.
It does not seed products, import stock, change prices or rewrite old reports.
The existing void/QR engines and closed-day safeguards are retained privately;
the browser can call only `review_bar_sale_action`. Direct sale updates are
blocked independently of row policies. Other legacy mutation surfaces are not
certified by this change. The deployment probe requires the new authority before
publishing the matching client. Older clients must reload to make a sale change;
ordinary checkout and original payment recovery remain supported.

Evidence: strict protocol/unit tests; native PostgreSQL preservation, replay,
independent-connection races, one stock return/audit, actor/role/closed-day tests;
actual History and Closing React screens using controlled before/after-commit,
timeout, account-switch, storage and failed-read responses; EN/MS phone, tablet
and desktop screenshots. Hosted physical-device and real receipt acceptance stay
separate. No test creates live sales, stock, receipts or staff accounts.
