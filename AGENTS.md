# Development and Release Rules

These rules adopt the supplied `MUST SAVE CODEX DEV PLAYBOOK.md` for this project.

- Preserve working business records and the Kitchen/Bar launch scope, plus the explicitly requested Staff Attendance & Leave module. Do not unlock unrelated modules or reuse tourist attendance as employee timekeeping.
- Trace each change across the worker, purchaser, receiver and accountant. A mocked component test does not establish a connected workflow.
- Keep one public mutation authority for each business action. Derive permissions and audit actors on the server; UI visibility and shared PINs are not authorization.
- Preserve the original request ID and reviewed payload after an uncertain response. Recover that operation before allowing a replacement. Never blindly clear a pending payment, receipt or closing.
- Reject stale reviewed state. Test independent connections, competing stock deductions, simultaneous confirmation and actor isolation on native PostgreSQL.
- Add forward migrations. Never edit a previously released migration or rerun an initial schema as an upgrade shortcut. Keep the immutable migration checksum manifest.
- Fail financial reads closed. Missing data is not zero sales. Include all records and distinguish estimates from actual expenditure.
- Treat purchasing, receiving, usage and physical counts as separate events on the same stock ledger. Never guess a weight-to-piece or packet conversion.
- Use `npm run release:check` for the current candidate. Preserve its source/schema/dependency/artifact-bound receipt, including failures. Old test scripts are historical or focused diagnostics, not competing release gates.
- Classify evidence as static, unit, native database, browser fixture, sample UI or hosted provider. Database Storage metadata is not physical upload verification. A queued message is not delivery proof.
- After two failures of the same class, stop equivalent retries and diagnose the harness, product or provider cause before running again.
- Validate actual unlocked pages on phone/tablet/desktop. Show screenshots for UI/UX edits. Keep screenshot fixtures free of real guest data and secrets.
- Publish the exact artifact checked. Keep private review/sample records separate from live cloud records. A deployed review is not production qualification.
- Before live use: rehearse the existing-data upgrade, verify named-account permissions, physical files, two-device acceptance, backups/restoration, schedules and operational ownership.

Current detailed audit: `docs/platform-audit-2026-10-14.md`.
