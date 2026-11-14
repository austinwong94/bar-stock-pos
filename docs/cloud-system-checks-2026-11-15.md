# Read-only System checks

Bar Admin > System no longer treats cloud configuration as production acceptance or recommends anonymous sign-ins. Named staff usernames/passwords and current roles remain unchanged.

Check Connection verifies the server Auth user against the current account, then reads that account's active, approved, non-anonymous profile. Only after verification does it read the versioned schema contract and an exact active-product count. Unknown or failed counts are not zero. An empty catalogue is explicitly identified without adding products, prices or stock. Each request has a deadline; account changes stop subsequent reads and discard old results. A new run clears previous results immediately.

Private bucket configuration is labelled Configured Only, not proof of a physical upload, ownership policy, photo decoding or cross-device reopening. Real receipt tests remain manual. Product prices/carton sizes, physically counted opening stock and a second-device record comparison also remain manual, with existing permission-appropriate routes and no automatic completion checkboxes.

The connection panel remains reachable if the separate Products page read fails. It uses the platform's compact type, 44px controls and unframed sections on phone/tablet/desktop. Preview mode cannot perform cloud checks or claim shared saving. Missing cloud configuration is distinguished from preview mode. The old preview-history reset controls are removed from this operational screen without deleting any stored preview or live records.

No mutation adapter, upload or authentication-setting change is part of these checks. Unit tests cover strict identities, schema flags, counts, timeouts and account cancellation. Actual Admin/Products browser fixtures cover failed product reads, direct setup links, stale-result clearing, account switching, late replies, preview/unconfigured states and English/Malay responsive layouts. Real named-account provider reads are verified separately after publication; hosted physical files and two-device acceptance are not inferred from fixtures.
