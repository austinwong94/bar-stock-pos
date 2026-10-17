# Simplified Kitchen and Purchasing

## Staff Workflow

1. **Request:** Open Kitchen > Purchase Requests > New Request. The usual ingredient catalogue is already listed. Enter quantities only for needed items, save the draft, review it, and confirm sending. Repeat Last List reuses a previous request for checking and editing.
2. **Purchase:** For requested items, open Purchases > To Buy > Record Purchase. For unrelated receipts use Receipts > Add Receipt. Both retain a pending receipt review. Choose Guest Meals, Staff Meals, or Bar; select the supplier; enter receipt date, number and total; attach a receipt photo and a different photo of the purchased items. Verify before confirmation. Requested purchases also record bought quantities; standalone receipts may be itemised later by accounts.
3. **Receive:** Record the quantities actually delivered. A receipt proves a purchase; it does not prove the delivery arrived. Recording a receipt alone does not increase inventory. Request-linked buying and receiving remain available under To Buy and Receive.
4. **Use:** Open Kitchen > Kitchen Stock > Record Usage. Enter the day's guest and staff meal counts, choose ingredient-list templates, and enter actual total quantities used in the two columns. Review and confirm. Do not enter a per-person recipe quantity: the system does not multiply these entries by meal count.
5. **Check:** Count Remaining compares a physical count against recorded stock. Use Record Waste or Missing Stock for separately explained losses. A discrepancy is a reason to investigate, not proof of theft.

Guest and staff meals draw from the same stock. Cooking gas uses the ingredient's configured base unit; the supplied cooking-gas entry is stored in grams and displayed in kilograms. Record net gas used, not the weight of the metal cylinder. Receiving must use the actual net contents of the purchased cylinder. No opening gas balance or cost is invented for the live database.

## Receipt-to-Kitchen Handoff

- New, confirmed, itemised standalone Guest Meals and Staff Meals receipts appear automatically in Items Arrived. Request-linked receipts keep their original request receiving path; Bar receipts are excluded.
- Supplier, receipt number and purchased quantities are reused. Receivers see no receipt prices, tax IDs, accounting notes or private photo paths. They still verify actual goods and pack sizes before confirming; partial arrivals retain the outstanding balance.
- One open review draft per receipt is shared in the cloud after Review is pressed. Resume retains quantities, author and timestamp. Cancellation retains its reason and audit event. Retry uses the same draft and version; concurrent edits require reopening.
- Purchased quantities support up to four decimals, including weights such as 0.1234 kg. Base-stock movements remain exact to two decimals. Unknown pack sizes are never invented.
- Receipt item names, units and quantities are snapshotted for receiving. Accounts may still correct costs and categories; changing those item quantities or voiding an already received receipt is blocked to prevent a broken stock/receipt trail.
- No historical receipts are replayed. Unitemised receipts and those itemised later still need Unlisted Delivery; the system cannot know if those goods were already received.
- Migration `202610050067_receipt_deliveries.sql` is required after migration 066. Test the full migration chain on a staging clone before real use. The shared review still uses device-local samples, not the live database.

## Delivery Issues

- The item selector marks open issues as Already Reported. Selecting one shows the original quantity, author, timestamp and latest purchaser update immediately, with no duplicate-entry fields. Viewing a report does not create a draft or overwrite another unfinished item. Receipt and request sources are kept separate, even for the same ingredient.
- Lookup failures block new submissions until Retry succeeds. The database still rejects simultaneous duplicate submissions; the refreshed form then shows the existing report and retains unsent notes. Unknown previous submission outcomes still reconcile against the original report ID.
- Migration `202610050070_delivery_source_issues.sql` adds the permission-checked, source-scoped lookup after 069. It returns no receipt costs or private evidence paths. Apply and test this with the earlier migrations on staging before cloud rollout; the shared review remains device-local samples.

- Follow Up has two direct actions: Save Update leaves the issue open; Resolve Issue records the final outcome and closes it. A supplier promise must remain open until settled. These actions never receive stock or post a refund.
- The latest update is visible in the inbox for purchaser and kitchen. Updates opens the attributed, timestamped history; the kitchen has read-only access. Original reports and updates remain unchanged.
- Unsent follow-up text stays in an explicitly labelled device draft with Resume Update. Lost-response retries retain the exact operation ID and text, even after reloading. Concurrent updates reject stale versions and retain the user's note for review.
- Migration `202610050069_delivery_issue_followup.sql` adds append-only follow-ups to the existing audit log and must follow 068. No live migrations or AI settings were changed by the shared review update.

- In Items Arrived, Report Issue records an item and quantity still outstanding as arriving later, missing, or damaged/rejected before acceptance. It is an observation to investigate, not a conclusion about theft.
- An unfinished issue stays as an explicitly unsent device draft. Send Issue records the server timestamp and account name; retries reuse the same report ID. One open issue per purchase item prevents double reporting across devices.
- Unsent drafts can be removed with a reason. Removal retains original draft details, the account and a server timestamp in the audit log. A sent report cannot be removed through this path. Interrupted submissions or removals are reconciled against the saved record on reopening.
- Kitchen and purchasing see the same open reports. Purchasers can record a follow-up and close an issue; original names, units, quantity, author and timestamps remain in Closed history and audit events.
- Reporting or closing does not add stock, erase a delivery balance, alter purchase costs, or create a refund. Actual replacement deliveries must still be received; losses after acceptance belong in Waste / Other.
- Receipt-linked deliveries also have Report Issue beside Check Arrival. They use the same inbox, closure and draft-removal audit, with an explicit receipt number and supplier. Reporting and closing never change stock, receipt amounts or received quantities.
- Request issues use Last Supplier, because a request item can have several purchase batches. Receipt issues use Supplier from the receiving snapshot. These are observations, not findings of fault.
- Receipt issue quantities retain up to four decimals; request quantities retain two. Source-specific draft keys, one open issue per receipt line, a shared confirmation lock and latest received-quantity checks prevent cross-source retries and stale reports.
- Apply migration `202610050068_receipt_delivery_issues.sql` after 067 for cloud operation. The review uses local sample data only; this migration has not been applied to live Supabase. Validate the full migration chain on staging before rollout.
- Migration `202610040066_delivery_issues.sql` supplies the permission-checked RPCs and audit records. Shared-review testing uses local samples; real cross-device operation requires applying the migration to the existing Supabase project after staging checks.

The Kitchen header and navigation remain in place across requests and stock. Meals & Allergies and Preparation are removed from the active workflow. Other departments are locked for this limited release; kitchen, purchases, bar and necessary administration remain permission-controlled.

## Accounts Workflow

- Weekly and monthly monitoring compares purchases with the previous full period. An unfinished current period is labelled explicitly.
- Filter by purchase purpose, supplier, item category or item name. Supplier spend comes from receipt totals. Item/category spend requires item breakdowns; missing breakdowns and mismatched totals are flagged, not guessed.
- Accounts can add or correct item breakdowns after a worker submits a receipt. This preserves the original amount, photos and audit trail. Concurrent edits require reloading rather than overwriting.
- Meal usage is separate from purchase spend. Cost per meal is an estimate using ingredient rates captured on confirmation, not FIFO inventory valuation or audited cost of goods sold. Missing ingredient rates and unrecorded days remain visible.
- Supplier/category filters apply to purchases, not the shared kitchen usage totals. CSV exports include receipt identifiers and avoid repeating a receipt total on each item row.
- Historical corrections require permission and a reason. Original evidence and audit events are retained.

## Verification Performed

- Build and focused regression tests for kitchen usage, stock-out, stock count, purchase evidence, food history and delivery entry.
- PostgreSQL-compatible execution of the new migration in an isolated test database: atomic deductions, duplicate-submit replay, stale edits, net corrections, historical cost preservation, permission checks, receipt evidence, duplicate receipts, coding versions, void retention and release locks.
- UI checks at 360/390px phone, 768px tablet and 1440px desktop widths. Tested stock-out confirmation, saved-day reload, quantity-only purchase requests, required-photo validation, supplier/item filters and percentage discounts after cart changes.
- These checks do not substitute for testing the complete migration chain against a staging clone of the live database.

## Before Real Staff Use

The shared review is sample data in browser-local storage. It is not the live inventory, does not synchronise records across devices and must not be used for actual purchases or sales.

1. Back up the live Supabase database and storage; apply the full required migration chain to staging first, including `202609280053_simple_kitchen_purchasing.sql`.
2. Confirm private purchase-evidence storage and authenticated policies. Verify photos can be reopened by authorised accounts and cannot be accessed by unrelated roles.
3. Load the real ingredient catalogue, units, pack sizes, opening balances, ingredient costs, usual templates and suppliers. Do not import review samples as actual stock.
4. Create separate named staff accounts and assign least-privilege kitchen, purchasing, accounts and bar roles. Shared access codes alone are not sufficient attribution for staff actions.
5. Test with two separate devices/accounts, including simultaneous stock-out edits, interrupted submissions, receipt uploads, receiving and permission-denied routes.
6. Build the production frontend with demo mode disabled and the correct Supabase project configuration. Deploy GitHub/live Supabase only after the owner approves the rollout.

No live Supabase migration, GitHub push, staff invitation or real financial transaction was performed in this change.
