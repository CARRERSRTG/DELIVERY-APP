-- 059: timetracker module — schema, tables.
--
-- Recreates timetracker's CURRENT final shape (base tables + every later
-- `alter table add column` folded in) in its own schema, `timetracker`,
-- instead of replaying its historical migrations against `public`. No seed
-- data here — real production data (from the standalone timetracker
-- Supabase project) is loaded by a separate, explicitly-confirmed
-- data-migration step, same as recruiting's real data followed 056.
--
-- Does NOT touch any deliveries or recruiting table. The only shared table
-- touched is public.profiles, and only via FKs (employee_uid, resolved_by,
-- etc. -> public.profiles(id)).

create schema if not exists timetracker;

-- ---------- employee_settings — timetracker-specific fields per person ------
-- Companion to public.profiles, 1:1, NOT a second profiles table. Original
-- timetracker kept these ON its own profiles row; here identity is shared
-- with deliveries/recruiting, so only timetracker_role/module_access (058)
-- live on public.profiles and everything module-specific — pay info, track
-- mode, activation status, soft-delete — lives here instead.
create table if not exists timetracker.employee_settings (
  id             uuid primary key references public.profiles(id) on delete cascade,
  city           text,
  pay_method     text,
  pay_details    text,
  worker_type    text check (worker_type in ('remote','inhouse')),
  track_mode     text check (track_mode in ('activity','inout')),
  breaks_enabled boolean,
  -- Pending until a timetracker admin activates them from Manager > People.
  -- Independent of module_access (058): being granted the module is a
  -- deliveries-admin decision, being "active" is a timetracker-admin one —
  -- same split as timetracker_role vs this, on purpose.
  active         boolean not null default false,
  deleted_at     timestamptz,
  created_at     timestamptz not null default now()
);

-- ---------- projects ---------------------------------------------------------
create table if not exists timetracker.projects (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  location       text default '',
  client         text default '',
  category       text default '',
  positions      jsonb not null default '[]'::jsonb,
  pay_period     text default 'weekly',
  archived       boolean default false,
  week_start_day integer, -- 0=Sun..6=Sat; null = use the global setting
  created_at     timestamptz not null default now()
);

-- ---------- assignments -------------------------------------------------------
create table if not exists timetracker.assignments (
  id                 uuid primary key default gen_random_uuid(),
  employee_uid       uuid not null references public.profiles(id) on delete cascade,
  project_id         uuid not null references timetracker.projects(id) on delete cascade,
  hourly_rate        numeric default 0,
  overtime_rate      numeric,
  overtime_threshold numeric,
  weekly_limit       numeric,
  payment_method     text,
  created_at         timestamptz not null default now()
);

-- ---------- payrolls — one batch per employee per week -----------------------
create table if not exists timetracker.payrolls (
  id            uuid primary key default gen_random_uuid(),
  employee_uid  uuid not null references public.profiles(id) on delete cascade,
  employee_name text,
  week_of       date,
  method        text,
  lines         jsonb default '[]'::jsonb,
  adjustments   jsonb default '[]'::jsonb,
  total         numeric default 0,
  paid          boolean default false,
  paid_at       timestamptz,
  paid_by       uuid, -- unconstrained in the original; kept as-is
  draft         boolean default false,
  session_count integer default 0,
  created_at    timestamptz not null default now()
);

-- ---------- sessions — the actual tracked time --------------------------------
create table if not exists timetracker.sessions (
  id               uuid primary key default gen_random_uuid(),
  employee_uid     uuid not null references public.profiles(id) on delete cascade,
  employee_name    text,
  project_id       uuid references timetracker.projects(id) on delete set null,
  assignment_id    uuid references timetracker.assignments(id) on delete set null,
  payroll_id       uuid references timetracker.payrolls(id) on delete set null,
  memo             text default '',
  week_of          date,
  date             date,
  start_ms         bigint,
  end_ms           bigint,
  duration_seconds integer default 0,
  active_seconds   integer default 0,
  idle_seconds     integer default 0,   -- excluded from counted duration (Upwork-style)
  screen_seconds   integer default 0,   -- smart-idle credit from on-screen activity
  keystrokes       integer default 0,
  clicks           integer default 0,
  lunch_seconds    integer default 0,
  break_seconds    integer default 0,
  break_events     jsonb default '[]'::jsonb,
  manual           boolean default false,
  source           text default 'timer',
  is_live          boolean default false, -- detect/finalize abandoned sessions on load
  live_note        text,
  created_at       timestamptz not null default now()
);
create index if not exists tt_sessions_emp_week_idx on timetracker.sessions (employee_uid, week_of);

-- ---------- requests — employee-initiated adjust/add/delete, admin approves --
create table if not exists timetracker.requests (
  id           uuid primary key default gen_random_uuid(),
  employee_uid uuid not null references public.profiles(id) on delete cascade,
  type         text,
  payload      jsonb default '{}'::jsonb,
  status       text not null default 'pending' check (status in ('pending','approved','rejected')),
  resolved_at  timestamptz,
  resolved_by  uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);

-- ---------- settings (singleton, id='app') -------------------------------------
create table if not exists timetracker.settings (
  id         text primary key default 'app',
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into timetracker.settings (id, data) values (
  'app',
  '{
    "currency": "$",
    "weekStartDay": 6,
    "payPeriod": "weekly",
    "paymentMethods": ["Cash", "Bank transfer", "PayPal"],
    "defaultWorkerType": "remote",
    "defaultTrackMode": "activity",
    "defaultBreaksEnabled": true,
    "adjustmentTypes": ["Bonus", "Advance", "Deduction"],
    "screenshotIntervalMin": 10,
    "companyName": "", "companyAddress": "", "companyTaxId": "",
    "companyPhone": "", "companyEmail": ""
  }'::jsonb
) on conflict (id) do nothing;

-- ---------- audit ----------------------------------------------------------------
create table if not exists timetracker.audit (
  id     uuid primary key default gen_random_uuid(),
  who    uuid,
  action text,
  detail text,
  at     timestamptz not null default now()
);

-- ---------- screenshots ----------------------------------------------------------
create table if not exists timetracker.screenshots (
  id               uuid primary key default gen_random_uuid(),
  employee_uid     uuid not null references public.profiles(id) on delete cascade,
  session_id       uuid references timetracker.sessions(id) on delete cascade,
  path             text,
  url              text,
  taken_at         timestamptz not null default now(),
  date             date,
  activity_percent integer default 0,
  -- Upwork-style blank slot: a 10-min segment with no keyboard/mouse activity
  -- gets a marker row (path null) instead of a captured screenshot.
  no_activity      boolean default false
);
create index if not exists tt_screenshots_emp_idx on timetracker.screenshots (employee_uid, taken_at);

create or replace function timetracker.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists tt_settings_touch on timetracker.settings;
create trigger tt_settings_touch before update on timetracker.settings
  for each row execute function timetracker.touch_updated_at();
