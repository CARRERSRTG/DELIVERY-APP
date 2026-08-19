# RDZ · Deliveries — Architecture & Rebuild Guide

> Living document. Kept in sync with the codebase on every change.
> Purpose: enough real detail to **recreate the system from scratch**.

Last verified against code: 2026-08-19 (recruiting module ported, D-052)

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

`profiles` also carries `recruiting_role` and `module_access` — access to the **recruiting
module** (a separate app's data, sharing this same `profiles` table; see §11). These are
independent of the deliveries `role` above: a deliveries `sales` user can also be a recruiting
`admin`. Null/empty by default for everyone; only a deliveries `admin` can grant them
(`guard_recruiting_access_change` trigger, deliberately separate from `guard_role_change` above).

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

- **Recruiting module — UI ported, Etapa 2 complete (D-052)**: all 8 recruiting pages now live
  under `/recruiting/*` in this repo/deploy, in their own sibling route group with an
  independent layout, DataProvider, and TopBar. CSS scoped under `.recruiting-module`;
  `usePrefs()` reused instead of porting a second i18n provider. Found and fixed two more
  role-vs-recruiting_role bugs beyond the one from D-051 (a query that could have crashed the
  Users page on a driver profile; `/api/delete-user` that would have deleted a shared account
  instead of revoking module access) — see §11.
- **Recruiting module — data unified (D-050)**: recruiting's Postgres data now lives in this
  project, schema `recruiting.*`, sharing `profiles` (new `recruiting_role` / `module_access`
  columns, both null/empty by default). RLS hardened at the same time — see §11.
- **Split loads**: at pickup the driver confirms how many pallets actually fit; a short
  load splits the order — loaded part keeps the order_no with suffix "a" (out for
  delivery), remainder becomes a new linked order with the SAME order_no and suffix "b",
  re-staged with no driver (`order_suffix` column, migration 012 + updated roles.sql
  insert guard; `orderLabel()` in utils renders "#1001a").
- **Warehouse pallet confirmation**: "Mark ready" now asks to confirm the pallet count
  (prefilled from the original estimate) and stamps `actual_pallets` with the stage move.
- **Single-device sessions** (Supabase mode): profile stores `active_session_id`
  (migration 013); signing in on a new device signs the old one out via realtime,
  landing it on /login?reason=session with an explanation.
- **Role defaults**: warehouse queue defaults to All; sales (like managers) lands on
  Pending; driver table shows Invoice # instead of SO (`ROLE_DEFAULT_COLUMNS.driver`).
- **Driver visibility**: drivers see only orders assigned to them or created by them
  (client filter + RLS migration 011).
- **Store per rep**: Users tab can assign a store to sales reps too; new orders prefill
  the creator's store. Demo: Sam Sales→Edinburg, Wade Warehouse→Pharr.
- Order form defaults the delivery window to **All Day (8:30–5:30)**.
- Invite emails: redirect origin now prefers NEXT_PUBLIC_SITE_URL, then the
  proxy-forwarded host — never localhost when invited from the deployed app.
- Demo seed: added 20 next-day orders (#1070–#1089, `delivery_date` = tomorrow) across
  all six stores with mixed stages/drivers/fees/pins (`demo-data.ts`; LS_KEY v12).
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

## 11. Recruiting module (D-050, D-051, D-052 — complete)

RECRUIT·HN used to be a separate Next.js app (`recruiting-app`). As of D-052 it's fully a
module inside this container app: same deploy, same repo, `/recruiting/*`. The old
`recruiting-app` repo/deploy/Supabase project still exist as a read-only fallback (see §"Old
recruiting project" below) but nothing in production points at them anymore.

- **Schema, not prefix.** Recruiting's 11 tables live in their own Postgres schema,
  `recruiting.*` (`candidates`, `contacts`, `jobs`, `stages`, `stage_history`, `attachments`,
  `questions`, `question_sets`, `templates`, `custom_fields`, `settings`) — not `public.*`.
  Deliveries' own `public.settings` and every other deliveries table are untouched. The
  `recruiting` schema must be added to Supabase → Settings → API → **Exposed schemas** for
  PostgREST to serve it (manual, one-time, not something a migration can do).
- **Identity is shared, permissions are not.** `public.profiles` — already deliveries' table —
  gained `recruiting_role` (`admin | manager | recruiter`, null = no role) and `module_access`
  (`text[]`, today only ever contains `'recruiting'` or is empty). These are independent of the
  deliveries `role` column (see §5). Every profile that existed before D-050 got
  `recruiting_role = null`, `module_access = '{}'` — nobody was granted access by the migration
  itself.
- **`has_recruiting_access()`** (`select recruiting_role is not null from profiles where
  id = auth.uid()`) replaced "any authenticated user" on all 11 `recruiting.*` tables and on
  `storage.objects` for the `resumes` bucket. Mirrors the existing `current_user_role()`
  pattern deliveries already used.
- **`guard_recruiting_access_change`** — a new trigger on `profiles`, deliberately separate
  from `guard_role_change` (untouched) — requires a **deliveries** admin (`current_user_role()
  = 'admin'`), not a recruiting admin, to change anyone's `recruiting_role` or `module_access`.
  Granting cross-module access is a container-level decision.
- **FKs cross schemas on purpose:** `recruiting.candidates.assigned_recruiter` /
  `created_by`, `recruiting.contacts.created_by`, `recruiting.stage_history.changed_by`, and
  `recruiting.attachments.created_by` all reference `public.profiles(id)` directly — normal in
  Postgres, no wrapper needed.
- **No local-mode exemption:** deliveries' rule that every data operation exists in both
  providers (Supabase + local demo) does NOT apply to the recruiting module — recruiting never
  had a local provider and doesn't get one now. Documented exception, not an oversight.
- **`resumes` Storage bucket** was recreated in this project (private, same RLS pattern) and
  its 49 objects copied over from the old recruiting project, same paths.
- **The old recruiting Supabase project (`cfawfwzndxumeufhcwga`) is untouched and stays alive**
  as a read-only fallback until production is validated for 1–2 weeks post-cutover — see D-050.
- **The UI is ported.** 8 pages under `src/app/recruiting/(recruiting)/`: bare `/recruiting`
  is candidates (deliberately — recruiting's original `/` was a "Today" dashboard that was
  never ported; the candidates list took the module's root instead), plus `board`, `calendar`,
  `metrics`, `outcomes`, `questions`, `settings`, `users`.
- **`(recruiting)` is a sibling of `(app)`, never nested under it.** It has its own
  `layout.tsx` — own profile fetch, own `DataProvider` (`src/lib/recruiting-data-provider.tsx`,
  Supabase-only, no local variant — see D4/D-050), own `TopBar`
  (`src/components/recruiting/*`). Nothing from `(app)/layout.tsx` is inherited: no deliveries
  realtime channels, and critically no `DriverGate`/`LocationTracker` — those are deliveries-
  driver-only concepts that have no business mounting on a recruiting page. The recruiting
  layout has its own access guard: no `recruiting_role` → `redirect(landingRoute(...))`, the
  same function that sends a driver to `/driver` unconditionally (D-051) — so `/recruiting/*`
  is exactly as unreachable to a driver as `/home` is, by construction, not by convention.
- **Supabase clients under `src/lib/recruiting/supabase/*`** are built with
  `db: { schema: "recruiting" }`, so every `.from()` call defaults there. The one recurring
  exception: `profiles` lives in `public`, so every query against it uses
  `.schema("public").from("profiles")` explicitly — four spots in the data provider, one in
  Settings (display name), two in the `/api/recruiting/*` routes' admin checks, one in the
  realtime subscription list (`postgres_changes` always needs the real schema, regardless of
  the client's default).
- **CSS: scoped under `.recruiting-module`, not a second global stylesheet.**
  `src/app/recruiting/recruiting.css` is recruiting's original `globals.css` with every
  selector — including its `:root` CSS variables and bare element selectors (`body`, `button`,
  `input`, `a`, `label`) — rewritten to `.recruiting-module <selector>`. This mattered more than
  a normal "avoid class collisions" pass: Next.js bundles all imported CSS sitewide regardless
  of which route is active, so an unscoped `body { font-family: ...; background: var(--paper) }`
  would have silently changed deliveries' own `<body>` styling depending on CSS load order.
  Verified by grepping the compiled `.next/static/css/*.css` output for any recruiting-only
  class (`.cand-row`, `.kb-board`, etc.) appearing without the `.recruiting-module` prefix —
  zero hits.
- **`usePrefs()` (deliveries' own theme/lang context) is reused; recruiting's `I18nProvider`
  was never ported.** `PrefsProvider` already wraps the entire app from the root
  `app/layout.tsx`, so every recruiting component gets light/dark theme and EN/ES for free —
  `useI18n()` calls were mechanically renamed to `usePrefs()` (identical `t(en, es)` signature).
- **Three bugs found and fixed while porting, all the same shape:** something written for
  recruiting's *own* `profiles.role` column, now confused by deliveries' shared `role` column
  on the same table.
  1. `updateUserRole` wrote `role` instead of `recruiting_role` (fixed in the base-port commit).
  2. `reloadAll()`'s "recruiters" query read `profiles.role` (deliveries' role) with no filter —
     any deliveries user, including a driver, would have shown up in recruiting's Users page,
     and `ROLE_INFO[u.role]` (only defined for admin/manager/recruiter) would have thrown on a
     value like `"driver"`. Fixed: query now filters `recruiting_role is not null` and maps
     `recruiting_role → role` in memory.
  3. `/api/recruiting/delete-user` (ported from recruiting's `/api/delete-user`) used to call
     `admin.auth.admin.deleteUser()` — correct when recruiting was someone's only account, but
     that account is now the shared deliveries identity. Changed to *revoke recruiting access*
     (null `recruiting_role`, drop `'recruiting'` from `module_access`) instead of deleting the
     auth user. `/api/recruiting/invite` and `/api/recruiting/delete-user` are their own
     namespace — deliveries' own `/api/invite`/`/api/delete-user` are untouched.
- **User management unified into deliveries' own `/users` (D-053).** Two separate Users
  screens editing the same shared `profiles` row was the exact pattern that produced the three
  bugs above — someone edits meaning one column and hits the other. `UserDialog.tsx` gained an
  "Access to other modules" section (checkbox + `recruiting_role` picker per module, driven by
  the shared `MODULES` list in `constants.ts`) and a new, deliberately separate function,
  `updateUserRecruitingAccess()` in `data-provider.tsx` — it can't be confused with
  `updateUserRole()` because it has a different name and a different signature, and it writes
  `recruiting_role`/`module_access` only. `src/app/recruiting/(recruiting)/users/page.tsx` is
  now a one-line `redirect("/users")`, the same pattern `/home` already used for
  `landingRoute()`. `recruiting-data-provider.tsx` lost `updateUserRole`, `updateUserAvatar` and
  `deleteUser` (only that retired page called them); `/api/recruiting/invite` and
  `/api/recruiting/delete-user` were deleted, and with them
  `src/lib/recruiting/supabase/admin.ts` (recruiting's service-role client), which had no
  importer left. The read-only `recruiters` list (candidate-assignment dropdowns in
  `board`/`candidates`) is untouched — that's not user management.
- **This closed a real authorization gap, not just a UI one.** The two retired endpoints
  authorized by `recruiting_role === 'admin'` (a recruiting admin) using a service-role client —
  which the `guard_recruiting_access_change` trigger treats as trusted (`auth.uid()` is null),
  bypassing its own requirement that a *deliveries* admin make the change. A recruiting admin
  who wasn't also a deliveries admin could revoke someone's access without the trigger ever
  seeing it. The unified `/users` is deliveries-admin-only already (`me.role !== 'admin'` in
  `users/page.tsx`, unchanged), so `updateUserRecruitingAccess()` is a plain client-side
  `profiles` update — same pattern `updateUserRole`/`updateUserStore`/`updateUserPermissions`
  already use — and the trigger is now the *only* authority, not a second opinion an API route
  could route around.
- **Resolved the "grant access to an existing user" gap** noted above: since the dialog already
  operates on an existing profile, granting recruiting access is just that same client-side
  `UPDATE` — no invite email needed. The dialog's checkbox default when checked with no tier
  chosen is `recruiter`, matching what the old invite flow always defaulted to.
- **App switcher, generic for N modules (D-054).** `ModuleSwitcher.tsx` (`src/components/`, a
  sibling of both `TopBar.tsx` files — not inside `recruiting/`) is mounted by both TopBars and
  lets someone with 2+ modules jump directly between them without returning to `/home`. It's
  pure presentation — props only (`{ current, deliveriesRole, moduleAccess }`), no hook from
  either `DataProvider` — which is what lets one file live in both route groups without
  reintroducing anything D-052's isolation was protecting against (GPS tracking, deliveries'
  realtime channels): a component with no data of its own can't leak either. `constants.ts`
  exports `DELIVERIES_CARD` and `accessibleModules(moduleAccess)` — the one place that turns a
  `module_access` array into the ordered list of reachable modules (deliveries always first);
  `HomeSelector` and `ModuleSwitcher` both call it instead of each filtering `MODULES` on their
  own. A third module is one entry in `MODULES` — neither component changes.
- **`deliveriesRole`, never `role`, in the switcher's props — same bug class as D-052's #1/#2,
  closed by naming.** Inside recruiting's own `TopBar`, `me.role` means `recruiting_role`. The
  switcher only ever needs the DELIVERIES role (it's what decides the driver exception and
  where "back to Deliveries" lands), so the prop is named to make that collision impossible to
  reintroduce by accident. `recruiting/(recruiting)/layout.tsx` already selected
  `profile.role`/`profile.module_access` (needed them for the `landingRoute()` guard) but
  discarded both when building `RecruitingProfile` — they're now passed to `TopBar` as separate
  props, never folded into that type, which stays recruiting's own shape.
- **Destination per module:** deliveries uses `roleHome(deliveriesRole)`, never `landingRoute()`
  — that would return `/home` again for anyone still holding 2+ modules, turning "switch to
  deliveries" into a bounce back to the selector. Other modules use their own `MODULES[i].href`.
  `HomeSelector`'s own deliveries card had the same problem in a different shape — its `href`
  was hardcoded to `"/"`, harmless only because the sole 2+-module user today is admin
  (`roleHome('admin') === '/'`); a warehouse or logistics user would have landed on the Orders
  board instead of `/warehouse`/`/routes`. Fixed in the same change so the hub and the switcher
  behave identically.
