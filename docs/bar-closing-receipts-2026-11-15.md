# Closing Receipt Viewer

Daily Closing reuses the QR receipt viewer already used by Sales History. A
single Receipt action immediately opens the selected sale's number, paid amount,
QR provider, reference and recorded staff name. Signing and image loading happen
inside that dismissible viewer. Failed signing or decoding shows Retry Photo;
retry requests a fresh signed URL and does not edit a sale or upload a photo.

Selection is tied to the current business date, account and exact sale
fingerprint. Date changes clear it. A changed or removed sale, a replaced
attachment or a failed background financial read removes the viewer. The shared
component ignores late signing replies after close/unmount. A reply cannot reopen
an old attachment or replace a newer selection. Cloud evidence must use the
private payment-receipts path; external URLs, embedded image data, traversal and
sample assets are not accepted as cloud evidence. The signed URL must match the
selected path. Sample preview behavior remains explicitly separate.

The same compact metadata, fixed image frame, loading/error states and close
control apply to History and Closing. Closing's receipt and QR decision buttons
use consistent 44px minimum touch targets. The existing QR verification/void
recovery authority, review versions, closing calculations and receipt retention
policies are unchanged. No migration, hosted business write or sample import is
part of this change.

The canonical release gate includes actual History/Closing React screens with
controlled transport/Auth/image fixtures: cancelled and out-of-order signing,
record/date/account changes, failed reads, invalid/mismatched attachment paths,
signing and decoding retries, long metadata and EN/MS 320/390/768/1440 layouts.
These are not physical Storage uploads, named-account cross-device acceptance or
proof of QR settlement. Real receipt upload/revisit and the two-device pilot
remain separate live-use requirements.
