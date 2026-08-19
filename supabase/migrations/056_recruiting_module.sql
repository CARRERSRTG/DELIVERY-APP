-- 056: recruiting module — schema, tables, functions/triggers.
--
-- Recreates recruiting's CURRENT final shape (as of its migration 20) in its
-- own schema, `recruiting`, instead of replaying its 20 historical migrations
-- against `public`. No seed data here — real production data is loaded by a
-- separate data-migration step (057).
--
-- Does NOT touch any deliveries table. The only shared table touched is
-- public.profiles, and only via the FKs below (assigned_recruiter, created_by,
-- changed_by -> public.profiles(id)) plus the fused handle_new_user() at the
-- bottom, which stays additive.

create schema if not exists recruiting;

-- ---------- question_sets (before questions/jobs, which reference it) ------
create table if not exists recruiting.question_sets (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  is_default boolean not null default false,
  role       text,
  created_at timestamptz not null default now()
);
create unique index if not exists question_sets_role_key
  on recruiting.question_sets (role) where role is not null;

-- ---------- questions -------------------------------------------------------
create table if not exists recruiting.questions (
  id         uuid primary key default gen_random_uuid(),
  text       text not null,
  text_es    text,
  category   text,
  role       text not null default 'all',
  active     boolean not null default true,
  weight     int not null default 1,
  sort       int not null default 0,
  set_id     uuid references recruiting.question_sets(id) on delete set null,
  scale      jsonb,
  created_at timestamptz not null default now()
);

-- ---------- templates -------------------------------------------------------
create table if not exists recruiting.templates (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  text       text not null,
  created_at timestamptz not null default now()
);

-- ---------- custom_fields ---------------------------------------------------
create table if not exists recruiting.custom_fields (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  sort       int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- jobs -------------------------------------------------------------
create table if not exists recruiting.jobs (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  role            text,
  status          text not null default 'open',
  target_score    numeric,
  openings        int not null default 1,
  notes           text,
  question_set_id uuid references recruiting.question_sets(id) on delete set null,
  created_at      timestamptz not null default now()
);

-- ---------- stages -----------------------------------------------------------
create table if not exists recruiting.stages (
  id         uuid primary key default gen_random_uuid(),
  key        text unique not null,
  label      text not null,
  color      text not null default '#6b7686',
  type       text not null default 'active',
  sort       int  not null default 0,
  max_days   int,
  created_at timestamptz not null default now()
);

-- ---------- candidates --------------------------------------------------------
create table if not exists recruiting.candidates (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  phone              text not null,
  email              text,
  role               text,
  location           text,
  home_location      text,
  source             text default 'Indeed',
  alt_sources        text[] not null default '{}',
  reg_date           date not null default current_date,
  notes              text,
  status             text not null default 'registered',
  phone_date         timestamptz,
  inperson_date      timestamptz,
  resume_passed      boolean not null default false,
  favorite           boolean not null default false,
  photo              text,
  custom             jsonb not null default '{}'::jsonb,
  prescreen          jsonb not null default '{}'::jsonb,
  interview          jsonb,
  follow_up          date,
  summary_sent       boolean not null default false,
  discard_reason     text,
  discard_source     text,
  resume_path        text,
  resume_name        text,
  offer_salary       text,
  offer_start_date   date,
  offer_status       text not null default 'none',
  offer_notes        text,
  tags               text[] not null default '{}',
  extra_phones       text[] not null default '{}',
  extra_emails       text[] not null default '{}',
  pinned             boolean not null default false,
  archived           boolean not null default false,
  stage_changed_at   timestamptz not null default now(),
  job_id             uuid references recruiting.jobs(id) on delete set null,
  assigned_recruiter uuid references public.profiles(id) on delete set null,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists candidates_status_idx    on recruiting.candidates(status);
create index if not exists candidates_recruiter_idx on recruiting.candidates(assigned_recruiter);

drop trigger if exists candidates_touch on recruiting.candidates;
create trigger candidates_touch before update on recruiting.candidates
  for each row execute function public.touch_updated_at();

-- ---------- contacts -----------------------------------------------------------
create table if not exists recruiting.contacts (
  id           uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references recruiting.candidates(id) on delete cascade,
  type         text not null,
  result       text,
  note         text,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists contacts_candidate_idx on recruiting.contacts(candidate_id);

-- ---------- stage_history -------------------------------------------------------
create table if not exists recruiting.stage_history (
  id           uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references recruiting.candidates(id) on delete cascade,
  stage_key    text not null,
  entered_at   timestamptz not null default now(),
  changed_by   uuid references public.profiles(id) on delete set null
);
create index if not exists stage_history_candidate_idx on recruiting.stage_history(candidate_id, entered_at);

create or replace function recruiting.log_stage_change()
returns trigger language plpgsql security definer set search_path = recruiting, public as $$
begin
  if (tg_op = 'INSERT') then
    insert into recruiting.stage_history (candidate_id, stage_key, entered_at, changed_by)
    values (new.id, new.status, coalesce(new.stage_changed_at, new.created_at, now()), auth.uid());
  elsif (tg_op = 'UPDATE' and new.status is distinct from old.status) then
    insert into recruiting.stage_history (candidate_id, stage_key, entered_at, changed_by)
    values (new.id, new.status, coalesce(new.stage_changed_at, now()), auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists candidates_log_stage on recruiting.candidates;
create trigger candidates_log_stage
  after insert or update of status on recruiting.candidates
  for each row execute function recruiting.log_stage_change();

-- ---------- attachments -------------------------------------------------------
create table if not exists recruiting.attachments (
  id           uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references recruiting.candidates(id) on delete cascade,
  path         text not null,
  name         text not null,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists attachments_candidate_idx on recruiting.attachments(candidate_id);

-- ---------- settings (singleton, id=1) -----------------------------------------
create table if not exists recruiting.settings (
  id         int primary key default 1,
  app_name   text not null default 'RECRUIT·HN',
  roles      text[] not null default array['Dispatcher','Customer Service','Sales'],
  scale      jsonb,
  updated_at timestamptz not null default now(),
  constraint settings_singleton check (id = 1)
);

-- FKs added after both sides exist (idempotent).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'candidates_job_fk') then
    alter table recruiting.candidates
      add constraint candidates_job_fk foreign key (job_id) references recruiting.jobs(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'jobs_question_set_fk') then
    alter table recruiting.jobs
      add constraint jobs_question_set_fk foreign key (question_set_id) references recruiting.question_sets(id) on delete set null;
  end if;
end $$;

-- ============================================================
-- Recruiting-internal guards, repointed from `current_user_role()`
-- (deliveries role) to `current_recruiting_role()` (recruiting_role on the
-- now-shared profiles table). Renamed to make the scope obvious.
-- ============================================================

-- Only the last recruiting-admin is protected -- this is scoped to
-- recruiting_role, NOT to deliveries' `role`. Deliveries has no equivalent
-- last-admin guard of its own; this one is deliberately narrow to recruiting.
create or replace function public.protect_last_recruiting_admin()
  returns trigger language plpgsql security definer set search_path = public as $$
declare admin_count int;
begin
  if TG_OP = 'UPDATE' and OLD.recruiting_role = 'admin' and NEW.recruiting_role is distinct from 'admin' then
    select count(*) into admin_count from public.profiles where recruiting_role = 'admin';
    if admin_count <= 1 then
      raise exception 'There must always be at least one recruiting admin';
    end if;
  elsif TG_OP = 'DELETE' and OLD.recruiting_role = 'admin' then
    select count(*) into admin_count from public.profiles where recruiting_role = 'admin';
    if admin_count <= 1 then
      raise exception 'Cannot delete the last recruiting admin';
    end if;
  end if;
  return case when TG_OP = 'DELETE' then OLD else NEW end;
end $$;

drop trigger if exists profiles_protect_recruiting_admin on public.profiles;
create trigger profiles_protect_recruiting_admin before update or delete on public.profiles
  for each row execute function public.protect_last_recruiting_admin();

create or replace function recruiting.guard_app_name_change()
  returns trigger language plpgsql security definer set search_path = recruiting, public as $$
begin
  if NEW.app_name is distinct from OLD.app_name
     and auth.uid() is not null
     and coalesce(public.current_recruiting_role(), 'recruiter') <> 'admin' then
    raise exception 'Only a recruiting admin can change the app name';
  end if;
  return NEW;
end $$;

drop trigger if exists settings_guard_app_name on recruiting.settings;
create trigger settings_guard_app_name before update on recruiting.settings
  for each row execute function recruiting.guard_app_name_change();

-- ============================================================
-- handle_new_user() -- fused. Still lives in `public` (fires on auth.users,
-- which is schema-agnostic). Default stays "no recruiting access" unless the
-- signup metadata explicitly carries a valid recruiting_role -- matching
-- exactly what /api/invite sends today (nothing), so every normal deliveries
-- signup keeps getting recruiting_role=null / module_access='{}'.
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  meta_recruiting_role text := new.raw_user_meta_data->>'recruiting_role';
begin
  insert into public.profiles (id, full_name, role, recruiting_role, module_access)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'sales'),
    case when meta_recruiting_role in ('admin','manager','recruiter')
         then meta_recruiting_role else null end,
    case when meta_recruiting_role in ('admin','manager','recruiter')
         then array['recruiting'] else '{}'::text[] end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
