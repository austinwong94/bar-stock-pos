# Receipt Scanning and Review

Receipt entry is available under Kitchen > Purchases > Receipts > Add Receipt. It saves a pending review before any expense is created. This document covers the new receipt workflow and the remaining production setup.

## Worker Workflow

1. Add a receipt and take or upload its photo. With AI enabled, extraction starts after the photo is saved.
2. Attach the separate photo of purchased goods. Choose Guest Meals, Staff Meals or Bar.
3. Check the supplier, branch address, receipt number, date, items, quantities and amounts against the original photo.
4. Correct missing or uncertain fields. Explain unresolved warnings or discrepancies in Review Note.
5. Tick verification once and confirm. Only this confirmation creates the expense; it does not receive inventory.

Save & Close retains a pending review with the purchaser and timestamps. Other authorised accounts can see pending reviews, but only the originating purchaser can edit or confirm them. Removing a pending review requires a reason; the record, photos and audit events remain. Confirmed records link to their original review and history.

Selecting a saved supplier fills its address, registration ID and phone. Use separate supplier names for separate branches, for example AEON - Imago. Common items reuse name, category and unit, never yesterday's quantity or amount.

New To Buy > Record Purchase entries use the same saved review and pre-confirmation scanner. The request number and bought quantities stay attached to the receipt; pending entries appear in both To Buy and Receipts. Opening the same request resumes the purchaser's existing pending review. Photos, staff, timestamps and removal reasons remain auditable. Existing device-only drafts are kept on their original form so uncertain confirmations can still recover their original transaction ID.

The buying list uses compact quantity/cost rows, a search field for longer lists and keyboard next-field navigation. Fill Shown Quantities is an explicit manual shortcut, not proof that goods were bought. For scanned receipts, Fill Exact Receipt Matches only fills blank entries with a single exact name/unit match. Duplicate names, different units, excessive quantities and manual entries are not automatically matched or overwritten. A bottle is not assumed to be a litre. Confirming creates one request-linked purchase, not a second standalone expense, and leaves partial quantities outstanding for the purchaser and deliveries outstanding for the receiver. Pending reviews never receive inventory.

Both entry screens check for matching confirmed receipts and pending reviews. An identical photo, or the same supplier and receipt number (ignoring case and outer spaces), identifies a match. Staff can inspect the existing record and its photos without leaving their entry. A confirmed match blocks a second purchase; a pending match names the other purchaser but does not reserve the receipt indefinitely. The first verified confirmation succeeds; subsequent duplicates are rejected inside the database transaction. A failed duplicate check blocks new confirmation while keeping the entry saved. Retrying an uncertain earlier confirmation still checks the original submission.

Receipt history shows changed fields and item quantities with before and after values, staff names and Malaysia timestamps, newest first. Unchanged fields are omitted. The original stored audit events remain untouched.

## Controls and Safeguards

- Admin > Staff Access > AI Receipts controls automatic scanning. It is off by default.
- A rolling 24-hour limit controls new scan attempts. Cached successful results do not create another billed request.
- Only server code holds the OpenAI key. Private receipt bytes are sent to OpenAI for extraction; public storage links are not created.
- Structured output is validated. Failed, incomplete or refused scans leave the review pending; they do not create purchases.
- Unknown values stay blank. Warnings and unreadable fragments remain alongside the confirmed accounting record.
- Manual values are not silently overwritten by a scan. The complete original extraction is retained separately.
- Confirmation uses a stable receipt ID in a transaction. A lost response can be checked without creating another expense.
- Version checks reject stale cross-device edits. Browser backup helps with interrupted entry; offline changes are not claimed as cloud-saved.
- Client accounts have no direct update or delete access to the audit tables. Database administrators retain administrative access; this is not a forensic guarantee or evidence of theft.
- Separate staff accounts are necessary for meaningful attribution. Shared credentials cannot identify the actual person holding a phone.

## Production Activation

The shared review runs with sample data. Its receipt scanner does not call OpenAI, incurs no API charges and explicitly reports that scanning is not connected. Preview records and photos are device-local, not cross-device business records.

For the live Supabase project, after reviewing prior migrations:

1. Apply migrations 202610040062_receipt_review_workflow.sql, 202610040063_receipt_duplicate_checks.sql, 202610040064_receipt_scan_readiness.sql and 202610040065_request_receipt_reviews.sql in order, once, after the existing purchasing migrations.
2. Deploy the scan-receipt-review Edge Function with its shared scan-purchase-receipt/handler.ts import included.
3. Configure OPENAI_API_KEY in Supabase server secrets and RECEIPT_ALLOWED_ORIGINS with the exact authorised site origins.
4. Deploy the production frontend with demo mode off. Do not put OpenAI or service-role secrets in VITE variables.
5. In Admin > Staff Access > AI Receipts, use Check Setup. This authenticated, administrator-only check verifies receipt RPC availability, private photo storage and whether the server key is set. It does not read a photo, create a scan attempt, call OpenAI or return any key. A saved key is not proof of billing/model access. Turn on AI Receipts, start with a low scan limit and test representative local receipts, faded thermal print and cropped photos.
6. Verify from a second staff account that pending reviews and confirmation history are visible as intended.

No live Supabase migration, real receipt transmission or paid OpenAI evaluation was performed during this implementation.

## On-demand Worker Guides

Kitchen pages and the Bar overview, POS, Stock Activity and Daily Closing have a question-mark help button. It opens the relevant topic without navigating away or submitting the underlying form. English, Bahasa Melayu and Indonesian instructions are available. Indonesian instructions use the actual Malay UI button names and Malay screenshots. Screenshots are captured from isolated sample sessions in EN/MS, with numbered DOM highlights and a training label. Tap a screenshot to enlarge it; Escape closes the enlargement first, then the guide.

The receipt guide distinguishes request-linked Record Purchase from Add Receipt, pending from confirmed, and purchase recording from physical stock arrival. Bar instructions distinguish single beers from sets and explain uncertain-payment recovery. Regenerate assets with scripts/test-capture-workflow-guides.mjs after changing the covered screens, then run scripts/test-workflow-guides-ui.mjs. Training pictures are illustrative sample data, not live receipts or stock records.

## Model and Estimated Cost

Recommended starting model: GPT-6 Luna using the Responses API, image input, strict Structured Outputs and reasoning effort none. This is a cost-conscious starting point, not a verified accuracy benchmark on this business's receipts.

Official standard pricing checked on 4 October 2026: USD 0.10 per million input tokens and USD 0.50 per million output tokens. An illustrative scan using 4,000 input tokens including the image and 2,000 output tokens costs USD 0.0014, or USD 1.40 for 1,000 such scans. This is not a fixed per-receipt quote: resolution, receipt length, output, retries and processing options affect cost. Hosting and storage are separate.

Sources: [GPT-6 Luna model and pricing](https://developers.openai.com/api/docs/models/gpt-6-luna), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [image input and limitations](https://developers.openai.com/api/docs/guides/images-vision).

AI can miss a line without flagging it. Retain mandatory human comparison with the original receipt instead of automatically posting unverified scans.

## Verification

- SQL tests run against an isolated PGlite PostgreSQL instance, not live Supabase.
- Edge Function tests use mocked network responses and no real API key.
- Browser tests use visibly labelled QA sample receipts and sample extraction data, at 320, 390, 768 and 1440 pixels in English and Malay.
- Live image accuracy, Supabase deployment/configuration and real-device camera behavior require the production activation checks above.
- Duplicate guards are tested with both real purchase RPC definitions in isolated PostgreSQL, two staff identities, retained rejected reviews, idempotent retries and voided receipt replacements. Real multi-device/load testing remains a production activation check.
- Duplicate detection is not image similarity: a new photo with an absent or different receipt number can escape matching. No purchase is automatically merged based on the same amount or date. Supplier branches should use distinct saved names; a genuinely reused receipt number needs accounting review rather than inventing a number to bypass the check.
- Request-linked reviews are tested against the actual transactional purchase RPCs: owner-only editing, one pending review per purchaser/request, partial purchase, one accounting record, stale versions, duplicate rejection, lost-response retry, retained removals and changed units. Refreshing a changed request clears quantities whose item name or unit changed; the original values and labels stay in audit history. No real multi-device load test or cloud migration has been performed.
- Earlier device-only purchase drafts remain on their legacy form and are not silently migrated or deleted. They remain on that device until confirmed or explicitly discarded.
