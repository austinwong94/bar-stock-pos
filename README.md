# bar-stock-pos

A small alcohol bar inventory, POS, and daily closing app. The frontend is React + Vite + TypeScript and can be hosted on GitHub Pages. Supabase provides Auth, Postgres, migrations, RLS, and RPC functions for all stock-changing and financial transactions.

## What Is Included

- Login with Supabase Auth.
- Touch-friendly POS with product grid, cart, cash, QR, and complimentary checkout.
- Light pink island-themed demo mode with focused navigation: Dashboard, POS, Stock, Stock Out, Closing, Reports, Admin.
- English / Malay labels, MYR / RMB display, four staff order-taker buttons, custom order price, discounts, and QR receipt photo capture.
- Stock-in flow with large CANS / CARTON buttons and confirmation modal.
- Products, inventory, sales history, stock movement history, settings, users, a separate daily closing page, and a separate reports page.
- Supabase migration with tables, RLS policies, helper functions, and transactional RPC functions.
- Seed data for Beer, Soft Drink, Other, three beer products, Coke, 7Up, Fanta, and default settings.
- GitHub Actions workflow for GitHub Pages.

## Supabase Setup

1. Create a Supabase project.
2. Install the Supabase CLI.
3. Link this project:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

4. Apply the migration:

```bash
supabase db push
```

5. Seed initial categories, products, inventory rows, and settings:

```bash
supabase db execute --file supabase/seed.sql
```

If your CLI version does not support `db execute`, open the Supabase SQL editor and run `supabase/seed.sql`.

## Environment Variables

Create `.env.local`:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-or-publishable-key
```

Never put a service role key in the frontend, GitHub public files, or GitHub Pages secrets. This app only needs the public Supabase URL and anon/publishable key in the browser. Sensitive work is done by Postgres RPC functions.

## Run Locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

## Create The First Admin User

1. In Supabase Auth, create a user with email and password.
2. The migration creates a `profiles` row automatically with role `cashier`.
3. In the Supabase SQL editor, promote your first admin:

```sql
update public.profiles
set role = 'admin', full_name = 'Owner'
where id = (
  select id from auth.users where email = 'owner@example.com'
);
```

After the first admin exists, use the app’s User / Role Management page to assign cashier, manager, and admin roles.

## Deploy To GitHub Pages

1. Push this repo to GitHub as `bar-stock-pos`.
2. In GitHub repository settings, enable Pages with GitHub Actions as the source.
3. Add repository secrets:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Push to `main` or run the workflow manually.

The Vite config uses `/bar-stock-pos/` as the base path when `GITHUB_PAGES=true`.

## Manual Testing Checklist

- Stock-in 10 cans increases stock by 10.
- Stock-in 2 cartons with carton size 24 increases stock by 48.
- Sale deducts stock only after confirmation.
- Cash sale appears in daily cash total.
- QR sale appears in daily QR total and pending verification.
- Complimentary (FOC) sale deducts stock, has paid amount 0, and is recorded in daily reports.
- Complimentary (FOC) confirmation requires a reason.
- QR payment opens the device camera/file capture; uploaded receipts are stored in Supabase Storage bucket `payment-receipts` and the database stores the image path.
- POS records the staff member accepting the order: User 1, User 2, User 3, or User 4.
- Custom orders and discounts can be entered from POS.
- Insufficient stock blocks sale when negative stock is disabled.
- Double-click confirm does not create duplicate sale because the RPC uses an idempotency key.
- Void sale adds stock back and reverses report impact by marking the original sale voided and creating reversal stock movements.
- Daily report saves a JSON snapshot and does not change after later data changes unless reopened/admin corrected.
- Inactive products do not show in POS but remain visible in historical records.

## Notes

- Products are not hardcoded in the frontend. Seed data is only in `supabase/seed.sql`.
- Final trusted totals are calculated by `complete_sale()` using database product prices.
- Stock-in, sale completion, voiding, QR verification, and daily closing are handled by RPC functions.
- Sales and stock movements are never physically deleted.
