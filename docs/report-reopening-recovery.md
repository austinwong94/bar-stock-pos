# Report correction recovery

The normal flow stays Reports > edit > admin password > review the existing report.

New reopen requests use `reopen_daily_report_checked`. The server checks the named account's current permission, the password-unlock expiry, the report ID and the reviewed full closing snapshot version. It locks against payments, closing and sale review, then records the original request and proof in one transaction. Original closing figures, notes and snapshot are retained; the correction reason remains in the audit log. The old reopening function is private. Browser table writes cannot bypass the checked operation.

Before sending, the browser retains the exact request under the project and account. An uncertain reply is not a failure or permission to create another request. The compact pending panel offers one Check Report Reopening action; there is no discard button. It reuses the exact identity and reviewed payload. A storage failure sends nothing. Corrupt retained data blocks new editing and needs owner investigation on that device.

An already committed proof can be recovered after the password unlock expires, but never after the account loses its current permission. If no commit exists and the unlock expired, renew editing from Reports and return to check the retained operation. A returned proof is historical: the screen reads the current report again and never uses old proof to overwrite a later closing. A failed read hides the figures until verified.

Release evidence includes strict protocol tests, native PostgreSQL upgrades/replay and independent-connection races, and actual React Closing fixtures covering StrictMode, interrupted replies, newer closing, account/tab isolation, storage failure and English/Malay at 320/390/768/1440 pixels. Fixtures do not qualify physical two-device acceptance or real hosted business transactions.
