# RDZ · Deliveries — Architecture & Rebuild Guide

> Living document. Kept in sync with the codebase on every change.
> Purpose: enough real detail to **recreate the system from scratch**.

Last verified against code: 2026-07-14 (address autocomplete)

---

## 1. What it is

Internal delivery-order management for a tile company. Salespeople create orders,
the Office Manager approves/rejects, the Warehouse fulfills. Four roles, one shared
team workspace. Bilingual (English / Spanish), light/dark themed, mobile-friendly.

Order lifecycle:
```
draft → pending → approved → fulfilling → ready → picked_up → delivered
          │  └── rejected (back to sales) ──┐
          └──────────────── canceled ───────┘
```
Driver marks `ready → picked_up` (collected) then `picked_up → delivered`.

## 2. Stack

- **Next.js 14.2** (App Router, `"use client"` components) + **React 18** + **TypeScript**
- **Supabase** (Postgres + Auth + Realtime + RLS) for production
- **Local demo mode** — localStorage, no backend, for offline/demo use
- **Vercel** for hosting
- No CSS framework — hand-written CSS in `src/app/globals.css` with CSS variables + theming
- Routing/distance: server route calling Google Maps / Mapbox / OpenStreetMap (auto-selected by env key)

## 3. Two data modes (the core design decision)

The app runs in one of two modes, chosen by `NEXT_PUBLIC_LOCAL_MODE` in `.env.local`:

| | Local demo (`true`) | Supabase (`false`) |
|---|---|---|
| Provider | `src/lib/local-data-provider.tsx` | `src/lib/data-provider.tsx` |
| Storage | browser localStorage (`rtg_deliveries_local_v4`) | Postgres |
| Auth | fake "View as" role switcher (`LocalApp.tsx`) | Supabase Auth |
| Realtime | `storage` events across tabs | Supabase postgres_changes channel |

**Both providers implement the identical `DataState` contract** (defined in `data-provider.tsx`).
Every component consumes data through `useData()` and never knows which mode is active.
**Rule: any new data operation must be added to BOTH providers with matching behavior.**

Shared, mode-agnostic business logic lives in `src/lib/` (e.g. `notifications.ts`,
`constants.ts`, `utils.ts`) so the two providers stay in lock-step.

## 4. Directory map

```
src/
  app/
    (app)/                  authenticated shell (layout picks Local vs Supabase provider)
      layout.tsx            reads NEXT_PUBLIC_LOCAL_MODE, mounts provider + TopBar
      page.tsx              Orders — table/board toggle, filters, search, CSV, ?order= deep-link
      approvals/page.tsx    manager queue of pending orders
      warehouse/page.tsx    warehouse fulfillment queue (store-scoped)
      driver/page.tsx       driver view: to-deliver / delivered, can log new orders
      settings/page.tsx     admin-only: language, workspace name, duration rates, pick-lists
      users/page.tsx        admin-only: invite / role / delete users
    api/
      distance/route.ts     POST {origin,destination} → miles + ETA (Google/Mapbox/OSM)
      geocode/route.ts      POST {q} → address autocomplete suggestions (Google/Mapbox/OSM)
      invite/route.ts       admin invites a user (service-role)
      delete-user/route.ts  admin deletes a user (service-role)
    auth/callback, auth/signout, login, reset-password
    layout.tsx, globals.css, manifest.ts
  components/
    LocalApp.tsx            local-mode shell + role switcher
    TopBar.tsx              app title, tabs, lang/theme toggles, NotificationBell, user, sign-out
    NotificationBell.tsx    bell + unread badge + dropdown; click → /?order=<id>
    OrdersTable.tsx         compact table view
    OrdersBoard.tsx         kanban board — one column per stage
    OrderModal.tsx          create/edit/view an order + workflow action buttons
    AddressInput.tsx        text input with real-time /api/geocode autocomplete dropdown
    VersionFooter.tsx
  lib/
    data-provider.tsx       Supabase provider + DataState contract + useData()
    local-data-provider.tsx localStorage provider (mirrors the contract)
    notifications.ts        role-targeted notification recipient logic (shared)
    export.ts               Excel (collapsible, grouped by employee) + print-to-PDF exports
    constants.ts            STAGES, ROLE_INFO, TABS, permission helpers
    types.ts                Profile, Delivery, OrderEvent, Settings, Stage, UserRole
    utils.ts                formatting, deliveryColumns, colLabel, CSV, palletDuration, nowMilitary
    prefs.tsx               language + theme context (usePrefs, t(en,es))
    supabase/               client / server / admin / middleware factories
supabase/
  schema.sql                tables, triggers, RLS, realtime (fresh install)
  roles.sql                 role column + stage-transition guard + write RLS
  migrations/001_notifications.sql   add notifications to an existing DB
```

## 5. Roles & permissions

Roles: `admin | manager | sales | warehouse | driver` (`UserRole` in types.ts).
Permission helpers in `constants.ts`: `canCreate`, `canApprove`, `canFulfill`, `canDeliver`, `canEditFields(role, stage)`.

- **sales** — create/edit orders in draft/pending/rejected, submit, resubmit, cancel
- **manager** (Office Manager) — approve/reject pending, unlock approved back to pending
- **warehouse** — approved → fulfilling → ready; edits ONLY pallets + prepared status;
  scoped to their `profile.store` (only sees orders picked up from that store)
- **driver** — own view (`/driver`); can log new orders like sales; marks ready → delivered;
  scoped to their store / assigned orders
- **admin** — everything + settings + user management (assigns each warehouse/driver a store);
  can override an order to ANY status via the "Set status" selector (bypasses `canTransition`)

In Supabase mode these are enforced in the DB (RLS + a stage-transition trigger in `roles.sql`),
so they hold regardless of client. The UI mirrors them for UX.

Workflow moves are additionally guarded client-side by `canTransition(from, to)` in
`constants.ts`, enforced in both providers' `setStage`. An order can NEVER reach the
warehouse (fulfilling/ready/delivered) without a manager approving it first.

## 6. Data model (Postgres / TS types)

- **profiles** — id (=auth user), full_name, role, store (warehouse/driver scope), avatar_url
- **settings** — singleton row id=1: app_name, order_types[] (text[]),
  stores & drivers (jsonb — arrays of `{name, address}` so each location is
  map-searchable), pickup_min_per_pallet, delivery_min_per_pallet
- **deliveries** — the order. order_no (sequential), stage, rejected_reason, all spec fields
  (prepared_status, status_temp, order_type, store, po2, so_num, invoice_num, input_date,
  input_time, delivery_date, pickup_address/duration, est_pallets (sales),
  actual_pallets (warehouse-revised), redelivery_of + redelivery_reason (repeat tracking),
  assigned_driver,
  delivery_duration/address/windows, account, contact, delivery_phone, delivery_notes),
  route_miles/duration/provider/traffic, created_by, approved_by/at, timestamps
- **order_events** — audit/history log (kind, note, created_by) per delivery. Written on
  create, every stage change, field edits ("edited"), and admin status overrides. Shown in
  the order's "Activity" section with actor + timestamp.
- **notifications** — user_id (recipient), delivery_id, order_no, kind, message, read, created_at

## 7. Key feature notes (implementation-specific)

- **Store & driver locations** — Settings stores/drivers are `{name, address}`; the
  address is entered via `AddressInput` (map-searchable). When routing an order with no
  explicit pickup address, the origin falls back to the selected store's saved address.
  Selecting a store also auto-fills the order's pickup name + pickup address.
- **Intra-store (store-to-store) orders** — when the order type matches `/transfer|intra/i`
  (e.g. "Intra-Tienda"), the Delivery Address input becomes a **store dropdown**; picking the
  destination store fills `delivery_address` from that store's saved address.
- **Address autocomplete** — pickup & delivery addresses use `AddressInput`, which
  debounces (~350ms) to `/api/geocode` for live suggestions (Google Places / Mapbox /
  OSM Nominatim by env). Picking a suggestion sets the field, which triggers the mileage
  calc. Pickup Name field was removed. Free-typing still works; suggestions are best-effort.
- **Auto distance/ETA** — `OrderModal` debounces (~900ms) on pickup/store + delivery address
  and calls `/api/distance`; a `lastRouted` ref avoids re-fetching the same pair. Manual
  "Recalculate" button also present. Errors only surface on manual runs.
- **Durations** — pickup/delivery durations are auto-derived (`palletDuration` = pallets ×
  per-pallet minutes from settings) and persisted via `withDurations`, but the duration
  fields are NOT shown in the form.
- **Input date/time** — stamped automatically at creation (`todayISO()` + `nowMilitary()`
  in `withDurations`); not editable in the form. Still shown in view mode + CSV.
- **Notifications** — `notificationsForStage()` fans a stage change to recipients:
  pending→managers, approved→warehouse + creator, rejected/ready/delivered→creator.
  Actor never notified. Emitted from both providers' `setStage`/`addDelivery`.
  Bell in TopBar; clicking navigates `/?order=<id>` which the Orders page auto-opens.
- **Board view** — `OrdersBoard`, columns per `STAGES`, ignores the stage chip filter,
  keeps search. Toggle in Orders page header.
- **i18n** — `usePrefs().t(en, es)` picks per language. `colLabel()` translates the
  view-mode detail keys (CSV keeps English headers).

## 8. Rebuild from scratch

1. `npx create-next-app` (14, TS, App Router). Add deps: `@supabase/ssr`, `@supabase/supabase-js`, `exceljs`.
2. Copy `src/` and `supabase/`. Set up `.env.local` from `.env.local.example`.
3. **Local demo:** `NEXT_PUBLIC_LOCAL_MODE=true`, `npm run dev`. No backend needed.
4. **Supabase:** create project → run `supabase/schema.sql` then `supabase/roles.sql`
   in SQL Editor. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`. First user to sign up becomes admin.
   For an existing DB, also run the files in `supabase/migrations/` in order.
5. Optional live traffic: set `GOOGLE_MAPS_API_KEY` or `MAPBOX_TOKEN` (else OSM, no traffic).
6. Deploy to Vercel with the same env vars; add the Vercel URL to Supabase Auth redirect allow-list.

## 9. Conventions

- Bump `LS_KEY` suffix in `local-data-provider.tsx` when the demo seed shape changes (forces reseed).
- Add new tables to the realtime publication and give them RLS in `schema.sql`.
- Keep the two data providers behaviorally identical.
- All user-facing strings go through `t(en, es)`.

## 10. Change log (most recent first)

- Added `picked_up` stage: driver marks ready→picked_up→delivered (driver page has an
  "Out for delivery" tab). Removed the admin "Set status" selector.
- Driver "Navigate" buttons in the order view (canDeliver roles): open Google Maps
  (turn-by-turn pickup→delivery) or Waze with the trip.
- Selecting a store auto-fills pickup name + address. Intra-store order types
  ("Intra-Tienda"/"Transfer") make the delivery destination a store dropdown that fills
  the delivery address from the chosen store.
- Admin can set an order to ANY status ("Set status" selector; bypasses `canTransition`).
  Full history: field edits now log an "edited" event; Activity log shows actor + timestamp.
  Drivers can also submit/resubmit/cancel their own drafts.
- Added **driver** role (own view, logs orders like sales, marks delivered). **Warehouse**
  store-scoped + edits only pallets/prepared-status. **Re-delivery** tracking: repeats logged
  as new linked orders (redelivery_of/reason) via the "Record re-delivery" flow. **Exports**:
  Excel grouped-by-employee with collapsible rows (exceljs) + print-to-PDF, replacing the
  CSV-only button (CSV still available). Migrations 004; roles.sql updated for driver + redelivery.
- Stores & drivers now carry a map-searchable address ({name,address} jsonb, migration 003).
  New `LocationEditor` in Settings uses `AddressInput`; store address feeds routing origin.
- Approval gate hardened: `canTransition` guard in both providers blocks any move to
  warehouse stages without prior manager approval. Account field moved next to Contact.
- Warehouse/Fulfillment section in the order form is now hidden entirely from sales/manager
  (shown only to warehouse & admin). Details still visible to all in view mode.
- Pallets: sales sets `est_pallets`; warehouse revises `actual_pallets` (new column,
  migration 002). Warehouse field lives in the Fulfillment section; board shows actual if set.
- Address autocomplete: pickup & delivery addresses are real-time search inputs
  (`AddressInput` + `/api/geocode`); picking a suggestion recomputes mileage. Removed Pickup Name.
- Removed Pickup/Delivery Duration fields from the order form (auto-computed, not shown).
- Input Date + Input Military Time now auto-stamped at creation and removed from the form.
- Per-pallet duration formula in labels restricted to admin/manager (then fields removed entirely).
- Fully translated OrderModal (labels, buttons, messages, view-mode keys via colLabel).
- Added Orders board view (kanban by stage) + table/board toggle.
- Notifications open the related order via `/?order=<id>` deep-link.
- Added role-targeted in-app notification bell (Supabase + local, table + RLS + realtime).
- Distance/ETA now auto-calculates (debounced) as addresses are typed.
