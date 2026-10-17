# Kitchen Group Alerts

## Current State

The shared review is sample data only. No group has been connected and no automatic messages are sent. The Group Alerts window previews confirmed events; Share on WhatsApp opens a manual share and does not mark delivery successful.

The live sender supports Telegram. WhatsApp group/API eligibility for the business and its existing group still needs verification. Do not use an unofficial WhatsApp Web session or QR bridge. Never put bot tokens, API keys or destination credentials in Vite variables, browser storage or source control.

## Events and Roles

- Kitchen submits a request: purchaser opens To Buy with requested units and remaining quantities.
- Purchaser records purchases with receipt and item photos: this does not increase inventory.
- Kitchen confirms delivery: inventory increases, one delivery alert is queued.
- Checker confirms a stock check: the stock record and one check alert are committed together.
- Accountants/bosses open Finance for daily, weekly and monthly comparisons. Purchase spending and usage-cost estimates are separate measures.

Drafts and opening a review dialog send nothing. Transactional audit triggers queue only confirmed arrivals/checks; the existing request submission function queues requests. Idempotent submissions do not create duplicate audit events. Alerts contain request or stock-event details and staff identity, not financial totals or customer details. A request's free-text notes are shared with the group, so staff must not enter private financial/customer data there.

## Live Deployment Checklist

1. Apply the normal migration chain including `202610040060_kitchen_group_alerts.sql` and `202610040061_purchase_availability.sql` to a test database first. Never rerun earlier table-creation scripts blindly.
2. Have the group owner add the Telegram bot, allow sending messages and verify the exact numeric group chat ID. Use a test group first. Choose a group limited to the intended staff.
3. Set server secrets via Supabase's secure secrets interface: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `KITCHEN_APP_URL` (the live app's HTTPS URL), and a random `KITCHEN_ALERT_SECRET` of at least 32 characters. Supabase provides its URL and service-role key to Edge Functions. None of these are browser configuration.
4. Deploy `send-kitchen-alerts` with platform JWT verification disabled; the function requires the dedicated `x-alert-secret` header on every POST and returns 401 without it. Do not expose this secret to clients. Missing sender settings return 503 without claiming messages.
5. Store the function endpoint and alert secret in Supabase Vault. Configure Supabase Cron/pg_net to POST every minute using the Vault values, not inline secret literals. This is a backend job, not a browser timer or a Codex automation. Confirm the job exists and returns 200 in server logs.
6. Queue one known test request, arrival and count; verify exactly three group messages and corresponding provider message IDs in the database. Test a repeated submission and confirm it does not send twice. Only then configure the real destination and enable its job.
7. Inspect queued records before enabling a sender that has been offline; old pending alerts are not automatically discarded. Skip obsolete messages deliberately using the owner outbox controls/approved admin operation.

The sender does not run merely because the migration is applied. This repository does not contain a cron job or production credentials. There is no WhatsApp automatic sender until its official group support is verified.

## Delivery Safety

Workers claim separate queue rows under locks. A confirmed API rejection can retry up to three times, at five-minute intervals. Timeouts, malformed replies and expired claims become Check Delivery (`uncertain`); they are not retried blindly because the message may already be in the group. An administrator must inspect the actual group before an approved database retry. Skipped/sent outbox entries and disabled notification rules are excluded. Network delivery is outside the stock transaction so Telegram downtime cannot roll back stock submissions.

Review stores a successful Telegram message ID, not just an HTTP attempt. A past successful message verifies that delivery only; it is not a continuous connectivity guarantee.

## Verification

Run `node scripts/test-kitchen-alerts.mjs` for mocked transport tests, adding `PGLITE_MODULE` for SQL trigger/queue tests. Run `node scripts/test-purchasing-finance-ui.mjs` against the isolated local sample-data server. These tests do not contact Telegram or change live Supabase records.

References: https://core.telegram.org/bots/tutorial and https://core.telegram.org/bots/api#sendmessage.
