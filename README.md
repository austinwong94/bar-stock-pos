# Lovely Paradise Operations Platform

An operations system for Lovely Paradise. The island bar POS is now one
department inside a larger platform that also covers boat maintenance, tourist
bookings, the daily boat manifest, boarding attendance and island activities.

Frontend is React + Vite + TypeScript on GitHub Pages. Supabase provides Auth,
Postgres, migrations, row level security and the RPC functions that carry out
every stock, money and guest-data change.

## Departments

| Department | What it does | Who normally uses it |
| --- | --- | --- |
| **Bar POS & Stock** | The original bar app: POS, stock in, daily closing, reports, products | Bar staff, bar manager |
| **Boat Maintenance** | Daily petrol used per island trip, refuelling, and every repair job with cost, dates and repeat detection | Boat crew, manager, accountant |
| **Tourist Bookings** | Booking and guest records from agents, OTAs, in-house and walk-ins, plus pickup-run grouping | Agents (own bookings only), coordinators |
| **Boat Assignment** | Boat register and the daily drag-and-drop manifest, with captain and guide dropdowns | Coordinator, operations manager |
| **Boarding Attendance** | Crew check every guest onto the boat, grouped by who booked together | Captains, guides |
| **Island Activities** | Snorkel / volcanic mud / other choice, roll call, and the back-on-board headcount | Guides |
| **Admin & Access** | Approve accounts, set roles, tune permissions per person, maintain directories | Master admin |

## How access works

Access is not a single ladder. Every department has its own list of actions
(`bar.pos.use`, `guests.booking.view_all`, `fleet.assign`, …) and access is
decided in two layers:

1. **Role matrix** — each role (Travel Agent, Coordinator, Captain, Bar Staff,
   Accountant, or one you create) has a tick box per action.
2. **Per person overrides** — any single account can be given an action its
   role does not have, or have one taken away. **A "never allow" always beats
   the role.**

So "User A: full POS, nothing else. User B: partial POS, partial bookings, full
maintenance. User C: everything" is set from Admin & Access without touching code.

Master Admin bypasses every check and is the only role that can hand out
admin-panel rights or promote another master admin.

### The privacy rule for agents

The rule that keeps agencies apart lives in Postgres, not in the interface:

- An agent account is attached to one agency.
- `guests.booking.view_own` shows only bookings created by that agent or that
  agency. `guests.booking.view_all` — the full guest list — is a separate
  permission that no agent role holds.
- Agents cannot list staff, boats, other agencies, other people's profiles, the
  boat manifest or the boarding lists at all.
- Agents cannot file a booking under another agency or under a fake source: the
  save function overwrites both fields with their own agency.
- Passport, birth date, email and medical notes live in a separate table behind
  `guests.contact.view`, so a captain reading a boarding list physically cannot
  select them.
- Captains and guides see only the boats they are rostered on, and only name,
  contact number and which group each guest booked with.

Because those rules are row level security policies, they hold even if someone
calls the Supabase REST API directly with their own token. `supabase/tests/`
contains a suite that proves it — see **Testing the security model** below.

## First-time setup

1. Create a Supabase project and install the Supabase CLI.

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

2. Seed the bar and the operations departments:

```bash
supabase db execute --file supabase/seed.sql
supabase db execute --file supabase/seed_platform.sql
```

If your CLI has no `db execute`, paste the files into the Supabase SQL editor.

3. In Supabase, open **Auth > Sign In / Providers** and:
   - enable **Email** (staff, agents and the master admin sign in with it),
   - enable **Anonymous sign-ins** only if you still want the shared bar tablet
     code to work.

4. Create your own account from the app's **Request a new account** button, then
   make it the master admin from the Supabase SQL editor:

```sql
update public.profiles
set access_role_code = 'master_admin', status = 'active'
where login_email = 'you@example.com';
```

Everything else — approving staff, creating agent logins, tuning permissions —
is done from **Admin & Access** inside the app.

## Environment Variables

Create `.env.local`:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-or-publishable-key
```

Never put a service role key in the frontend, in GitHub files, or in Pages
secrets. The browser only needs the public URL and anon key; every sensitive
operation runs inside a Postgres function.

## Run locally

```bash
npm install
npm run dev
```

## Deploy to GitHub Pages

1. Push this repo to GitHub as `bar-stock-pos`.
2. In repository settings enable Pages with GitHub Actions as the source.
3. Add repository secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Push to `main` or run the workflow manually.

The Vite config uses `/bar-stock-pos/` as the base path when `GITHUB_PAGES=true`.

## The shared bar tablet code

The old single access code still works, but it no longer makes everyone an
admin. It now signs in anonymously as **Bar Staff**: the whole Bar department
and nothing else. It can never reach guest data, boats or the admin panel.

Give every bar staff member a personal login when you can, then turn the code
off in **Admin & Access > Platform Settings**. Turning it off both blocks new
code sign-ins and suspends the tablets already signed in with it.

## Day to day

**Entering bookings.** One booking holds everyone who travelled together, so a
family of five is five guest rows on one booking. In the guest grid you can
paste a block straight out of Excel — Name, Phone, Nationality, Adult/Child and
Passport, tab separated, one guest a line — and the rows fill themselves. Pax
counts are always recalculated from the names, so the boat capacity maths cannot
drift from the list.

**Pickup runs.** Open Pickup Runs, press **Auto group** and bookings at the same
hotel, or at hotels within the radius you set (1.5 km by default), fall into one
run. Anything the system got wrong is fixed by dragging the card, or on a tablet
by tapping the card and then tapping the run. Grouping by distance needs
coordinates on the pickup point, which you set once in **Directory > Pickup
points**; without them it matches on the hotel name.

**Boat board.** Every active boat shows its type, capacity, who is aboard, how
many pax are assigned and how many seats are left, next to the pool of guests
with no boat yet. Dragging a card moves the *entire* booking, so groups are
never split by accident, and a drop that would exceed capacity is refused with
the number of free seats. Captain and guide are dropdowns fed by the employee
directory. **Lock day** freezes the manifest.

**Boarding.** Captains and guides see only their own boats, with guests grouped
by booking so a missing person's friends can help find them. Mark one guest, a
whole group, or the whole boat.

**Activities.** Snorkel / Volcanic Mud / Others per guest or per group, then a
roll call. The header keeps a live count per activity and a **back on the boat**
figure so nobody is left behind.

**Boat maintenance.** Fuel entries are either *used going to island* or
*reloaded*, both with litres and price. Give each boat a normal litres-per-trip
figure in the boat register and the page flags any boat burning more than 15%
above it. Repairs record the issue, cost, workshop, when it broke and when it
was fixed; a new job in the same category on the same boat within a year is
flagged as a repeat and linked to the previous one, and a job marked *cannot
sail* parks the boat until it is closed.

## Testing the security model

`supabase/tests/` applies every migration to a throwaway Postgres database and
then asserts the access rules as real signed-in users — an agent, a rival agent,
a coordinator, a captain and the shared bar tablet.

```bash
# needs a local postgres; defaults to host /tmp port 5433
supabase/tests/run.sh
```

It checks, among other things, that a rival agent sees zero bookings, zero
tourists, zero staff and zero boats; that an agent cannot file under another
agency; that a captain cannot read passports or create bookings; that
overbooking a boat is refused; that moving a group keeps it whole; and that a
per-user "never allow" beats the role.

## Notes

- Products are not hardcoded in the frontend. Bar seed data lives in
  `supabase/seed.sql`, operations seed data in `supabase/seed_platform.sql`.
- Final trusted totals are calculated by `complete_sale()` from database prices.
- Stock-in, sale completion, voiding, QR verification, daily closing, booking
  saves, boat assignment and every access change are RPC functions, so the rules
  cannot be skipped by calling the REST API directly.
- Sales and stock movements are never physically deleted.
- The legacy `profiles.role` column is kept for the original bar policies, but
  it is now derived from the bar permissions a user actually holds rather than
  being set by hand.

## Bar manual testing checklist

- Stock-in 10 cans increases stock by 10.
- Stock-in 2 cartons with carton size 24 increases stock by 48.
- Sale deducts stock only after confirmation.
- Cash sale appears in daily cash total.
- QR sale appears in daily QR total and pending verification.
- Complimentary (FOC) sale deducts stock, has paid amount 0, and is recorded in daily reports.
- Complimentary (FOC) confirmation requires a reason.
- QR payment opens the device camera/file capture; uploaded receipts are stored in Supabase Storage bucket `payment-receipts` and the database stores the image path.
- POS records the staff member accepting the order: Chloe, Happy, Elle, or NekoMiao.
- Custom orders and discounts can be entered from POS.
- Insufficient stock blocks sale when negative stock is disabled.
- Double-click confirm does not create duplicate sale because the RPC uses an idempotency key.
- Void sale adds stock back and reverses report impact by marking the original sale voided and creating reversal stock movements.
- Daily report saves a JSON snapshot and does not change after later data changes unless reopened/admin corrected.
- Inactive products do not show in POS but remain visible in historical records.
