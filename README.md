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
| **Boat Maintenance** | Fleet fuel purchases, the boat trip log with per-boat estimates, and every repair with cost, dates and repeat detection | Boat crew, manager, accountant |
| **Tourist Bookings** | Booking and guest records from agents, OTAs, in-house and walk-ins, plus pickup-run grouping | Agents (own bookings only), coordinators |
| **Boat Assignment** | Boat register and the daily drag-and-drop manifest, with captain and guide dropdowns | Coordinator, operations manager |
| **Boarding Attendance** | Crew check every guest onto the boat, grouped by who booked together | Captains, guides |
| **Island Activities** | Snorkel / volcanic mud / other choice, roll call, and the back-on-board headcount | Guides |
| **Kitchen** | Ingredient and material requests by date and pax; confirming one puts it on the buying list | Kitchen staff |
| **Things to Purchase** | The buying queue with cost, supplier and what is still outstanding | Purchaser, accountant |
| **Daily Operations** | Live progress log with late-step alerts, the daily summary, and the WhatsApp outbox | Admin, coordinator |
| **Island Items** | Equipment that has gone missing and whether it turned up again | Everyone on the island |
| **Admin & Access** | Approve accounts, set roles, tune permissions per person, maintain directories and the boat register | Master admin |

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

To try the platform against a realistic load before you have real bookings,
add the practice data as well:

```bash
supabase db execute --file supabase/seed_demo_data.sql
```

It writes three days — yesterday finished, today part run, tomorrow still to
plan — with around ninety guests a day across roughly twenty-five bookings from
agents, OTAs, in-house and walk-ins, plus vehicles, a fifth boat, boat seating,
boarding, fuel purchases and repairs. It is safe to run more than once, and
`delete from bookings where service_date between ...` removes it again.

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
family of five is five guest rows on one booking. Each guest is marked adult,
child, elderly or needs-assistance, and those counts show on every card that
matters — the booking list, the pickup run, the boat — so a PIC can arrange the
day without opening anything. In the guest grid you can
paste a block straight out of Excel — Name, Phone, Nationality, Adult/Child and
Passport, tab separated, one guest a line — and the rows fill themselves. Pax
counts are always recalculated from the names, so the boat capacity maths cannot
drift from the list.

**Pickup and transport.** Pickup is opt-in: a booking is only collected if
someone ticked *needs collecting*, so guests making their own way to the jetty
never clutter the board. Press **Plan the runs** and the vans fill themselves —
hotels within the radius you set share a vehicle, a van is never loaded past its
seat count, and each route is ordered from the hotel furthest from the jetty
inwards, with a collection time worked backwards from the first boat departure.
Anything the plan got wrong is fixed by dragging a card, or on a tablet by
tapping the card then the run.

Distance planning needs coordinates on the pickup point (**Directory → Pickup
points**) and the jetty position (**Platform Settings**); without coordinates it
falls back to matching hotel names. Vans live in **Admin → Vehicles**, where
their seat count is what stops a run being overloaded.

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

**Boat maintenance.** Nobody meters a single boat, so fuel is recorded as
**fleet purchases** — what was bought, when, at what price. Consumption is
*estimated* instead: every trip is logged (pulled from the boat board with one
button, with emergency runs such as taking a sick guest off the island entered
by hand) and multiplied by each boat's normal litres per trip, which you set in
the boat register. The page compares the fuel bought against the trips logged
and flags a gap, which is the honest version of "is someone overspending" —
either trips are missing from the log, or more fuel went out than the boats
used.

Repairs record the issue, cost, workshop, when it broke and when it was fixed;
a new job in the same category on the same boat within a year is flagged as a
repeat and linked to the previous one, and a job marked *cannot sail* parks the
boat until it is closed.

**Kitchen and purchasing.** Most of a weekly order is the same every week, so
the kitchen taps items from a catalogue that sorts by how often they are
actually used and fills in the usual quantity and unit. Anything typed joins the
catalogue for next time, and **Copy** starts a new draft from a past order. The
kitchen enters what it needs for a date and a pax count, saves it as a draft,
then confirms it. Confirming is what moves it
onto the buying list and writes the WhatsApp message. The purchaser ticks items
off with cost and supplier; the request closes itself when nothing is left
pending.

**Daily Operations.** *Today* shows each step of the day, the time it was
finished, and anything past its expected time in red — the times are editable.
*Daily Summary* is the one-page record: pax and their age mix, boats with
captain and guide, activity headcounts, trips and fuel, food and spend, bar
takings, incidents, and a line-by-line log of who ticked what and when.

**Missing items.** Anyone on the island can report equipment that has gone
missing with a date and remarks. Items can later be marked found, or written
off — which requires a reason.

**Who did what.** Boarding, activity choice and back-on-boat each record the
person who did it and when. Deleting a customer record asks why and stores the
reason against your name, and every booking has a change history.

## Sending to WhatsApp

The app never calls WhatsApp directly. Every announcement — a confirmed
kitchen request, a completed boat assignment, a step running late — is written
as a finished message into an **outbox**, and each one has its own on/off
switch in Daily Operations → Message Outbox. Switching a rule off stops the
message being created at all, so nothing piles up while it is off.

How the message leaves the building is a separate decision, and the outbox is
deliberately designed so that decision can change without touching any
department:

| Route | Automatic? | Effort | Risk |
| --- | --- | --- | --- |
| **Outbox → Open in WhatsApp** (shipped) | One tap by a person | None, works today | None |
| **Unofficial bridge** (whatsapp-web.js / Baileys on a small server) | Yes | ~1–2 days plus babysitting | Against WhatsApp's terms; the number can be banned |
| **Paid unofficial provider** | Yes | Hours to wire up | Same terms risk, run by someone else |
| **Meta's official Groups API** | Yes | Weeks, if approved | Cannot post into your existing group |

Meta does now have a Groups API on the WhatsApp Cloud Platform, but it does
not do what an island operation needs: it requires an Official Business
Account (the green tick), caps a group at **8 participants**, and has no
endpoint to add someone — people join a group the API itself created, via an
invite link. There is no way to post into the staff group that already exists
on somebody's phone. Check the current limits with Meta before committing,
since this is exactly the sort of thing that changes.

The shipped route is the pragmatic one: the message is written for you, the
PIC taps **Open in WhatsApp**, picks the group and sends. When you want it
fully hands-off, point a worker at `outbound_messages` where `status =
'queued'` and call `mark_outbound_sent`; nothing else changes.

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

## Seating a day quickly

The boat board has two buttons that do the repetitive part of the morning:

* **Seat everyone** fills the boats in one tap. A group is never split across
  boats, and each one goes on the fullest boat it still fits in, so the big
  boat stays free for the big family. Anything too large for any boat stays in
  the unassigned pool rather than being forced on. Drag afterwards to change
  anything.
* **Same crew as last time** copies the captain and guide from the most recent
  day that had a crew. It only fills blanks, so anyone you have already chosen
  for today is kept.

## Colours and theme

Every colour comes from named tokens in `tailwind.config.js`, so the whole
platform is re-themed in one place. The current scheme is pink: `accent`
(`#b3164f`) for anything you can act on, `deep` for pressed and active states,
`shell`/`line` for the warm neutral frame. Status colours stay separate from
the accent on purpose — `alert` for overdue, `palm` for done, `danger` for
destructive, `warning` for attention — so a red row still reads as a problem on
a pink page. Radii are capped at 8–12px.

If you change the accent, change `theme-color` in `index.html` to match.

## Offline demo build

`npm run build:demo` produces `dist/lovely-paradise-demo.html`: the whole app in
one file, backed by an in-memory dataset instead of Supabase. It is meant for
showing the platform and for training staff, never for real data.

The demo replays the same permission and visibility rules the database
enforces, so switching person genuinely changes what is visible — a travel
agent really cannot see another agency's bookings there. A bar at the bottom
switches between an owner, a coordinator, two competing agents, a captain, a
guide, the shared bar tablet, an accountant and an unapproved account.

Sample data lives in this browser only and survives a persona switch, so you
can seat a boat as the coordinator and then check those guests in as the
captain. **Reset demo data** puts it back. It carries the same three days and
about ninety guests a day as `supabase/seed_demo_data.sql`, which is enough for
the boat board, the pickup planner and the capacity limits to behave the way
they do in real use.

Two things do not work in the demo, by design: file downloads (guest export)
and photo upload, because both need a real backend.
