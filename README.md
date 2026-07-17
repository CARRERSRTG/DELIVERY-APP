# RDZ · Deliveries

Delivery order management. **Salespeople create orders → the Office Manager approves → the Warehouse fulfills.** Built with Next.js 14 (App Router) + Supabase + Vercel, matching the Recruiting app's stack.

## Roles & workflow

| Role | Can do |
|------|--------|
| **Sales** | Create/edit orders, submit for approval, resubmit rejected orders |
| **Office Manager** | Approve or reject pending orders (with a reason) |
| **Warehouse** | Fulfill approved orders: set Prepared/Temp status, assign driver, mark Ready → Delivered |
| **Admin** | Everything + manage users and settings |

Order lifecycle:

```
draft → pending → approved → fulfilling → ready → delivered
          │  └── rejected (back to sales) ──┐
          └──────────────── canceled ───────┘
```

Role permissions are enforced in the database (RLS + a stage-transition trigger in `supabase/roles.sql`), so they hold no matter how the data is accessed.

## One-time setup

### 1. Supabase
1. Create a project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, run `supabase/schema.sql`, then `supabase/roles.sql`.
3. Grab **Project Settings → API**: the Project URL, the `anon` public key, and the `service_role` secret key.

### 2. Local env
```bash
cp .env.local.example .env.local   # then fill in the three values
npm install
npm run dev                        # http://localhost:3000
```
The **first user to sign up becomes admin** automatically. From the Users tab, invite the rest and set their roles.

### 3. Deploy to Vercel
1. Push this folder to a Git repo and import it in Vercel.
2. Add the same three env vars in **Project → Settings → Environment Variables**
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).
3. In Supabase **Authentication → URL Configuration**, add your Vercel URL to the redirect allow-list.

## Order fields
Every column from the spec is captured: ID, Prepared Status, Status (Temp), Order Type, Store (Sold From), PO #2, SO #, Invoice #, Input Date, Input Military Time, Delivery Date, Pickup Name/Address/Duration, Est. Pallets, Assigned Driver, Delivery Duration, Delivery Address, Delivery Military Time Windows, Account, Contact, Delivery Phone Number, Delivery Notes.

Orders are exportable to CSV from the Orders tab.
