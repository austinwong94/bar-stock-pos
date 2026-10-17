# Familiar Kitchen Stock Workflow

## What Changed

- A 47-item catalogue follows the supplied names, categories and usual units. Requests retain ordering units: crab in kg; garlic and onions in bags.
- Kitchen receiving is a direct quantity worksheet with supplier, date, reference, named user and mandatory final confirmation. Receiving adds stock; recording a purchase does not add it again.
- Daily usage has Guest and Staff columns against one shared inventory, including cooking gas. Saved templates and item search remain available.
- Snorkelling water has a separate bottle-usage form, a closed-day option and monthly records. Weekly/monthly cost monitoring includes bottles used.
- Stock checks accept weekly or ad-hoc counts. Blank means not counted; zero means none left. Review shows expected, counted and difference.
- Native display units are snapshotted on new stock movements and daily usage. Old records keep their original units.
- The guide is available only on request, in English, Malay and Indonesian.

## Safety

New cloud writes use named authenticated users, permission checks, atomic stock updates and immutable retry IDs. Daily records reject stale edits; manager corrections apply the net difference and retain audit events. Count and waste entries reject changed stock or item settings.

No WhatsApp quantities have been imported as verified opening balances, purchases, deliveries or usage. They are different record types and incomplete historic evidence.

## Confirm Before Live Use

1. Apply migrations in order on staging first, including 202609280054_whatsapp_kitchen_workflow.sql. This update prepares cloud functions; it does not deploy them to live Supabase.
2. Resolve existing inventory whose old units conflict with the WhatsApp units. For example, do not relabel an old kg balance as packs or pieces. Keep the old unit until its conversion or a controlled stock re-baseline has been verified. Unresolved entries are disabled.
3. Confirm bottles per water carton. Do not assume 24. Confirm whether CIGAR is a separate storage location; location-transfer accounting is not added without that clarification.
4. Confirm missing usage units, especially staff rice (10), chicken (6), and the unlabelled frozen quantities. Confirm any mixed pack sizes; variable bags need actual contents counted or weighed.
5. Crab purchases in kg and crab usage in pieces are not interchangeable. Kitchen receiving must record the actual pieces received; no fixed kg-to-crab conversion is assumed.
6. Take a witnessed opening stock count, provision named staff accounts, and test with purchaser, kitchen and manager roles on two devices before go-live.

## Historic Water Notes

The supplied September notes need reconciliation, not invented receipts:

- 2 September: 229 minus 62 is 167, but the reported balance is 169 (+2 unexplained).
- 8 September: 97 minus 35 is 62, but the reported balance is 19 (-43 unexplained).
- Increases on later dates may be replenishment or transfers; they are not automatically treated as purchases.
- Closed days are not missing entries. September has no day 31.

A difference is a prompt to investigate delivery, measurement, transfers, waste and recording errors. It is not proof of theft.

## Verification

Isolated PostgreSQL-compatible tests cover native units, zero imported opening stock, delivery retries, water corrections, excessive deductions, invalid dates, permissions, stale versions, stock-count differences and historical unit snapshots. Browser checks cover delivery, guest/staff deductions, water usage, counts and layouts at 390, 768 and 1440 pixels. Review sample data is separate from live business records.
