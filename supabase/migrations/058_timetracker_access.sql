-- 058: Timetracker module access on profiles (additive only).
--
-- Same shape as 055 (recruiting): a role INSIDE the module, and a flag saying
-- this identity may even open it.
--
--   timetracker_role  -- admin | employee inside timetracker. Null = none.
--   module_access     -- already exists (055); 'timetracker' becomes a third
--                         valid value alongside 'recruiting'.
--
-- Deliberately NOT the rest of timetracker's old `profiles` columns
-- (pay_method, pay_details, worker_type, track_mode, breaks_enabled, active,
-- city, deleted_at) — those are business data specific to the module, not
-- identity/access, and go in timetracker.employee_settings (059) instead.
-- Recruiting's profile barely had fields of its own; timetracker's does, and
-- bloating the shared table with them would leak module-specific shape into
-- every other module that reads public.profiles.
--
-- Safe to re-run.

alter table public.profiles
  add column if not exists timetracker_role text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_timetracker_role_check') then
    alter table public.profiles
      add constraint profiles_timetracker_role_check
        check (timetracker_role is null or timetracker_role in ('admin','employee'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_timetracker_access_needs_role') then
    alter table public.profiles
      add constraint profiles_timetracker_access_needs_role
        check (not ('timetracker' = any(module_access)) or timetracker_role is not null);
  end if;
end $$;

create or replace function public.current_timetracker_role()
  returns text language sql stable security definer set search_path = public as $$
  select timetracker_role from public.profiles where id = auth.uid();
$$;

-- Both functions below are wrapped as `select coalesce((select ...), false)`,
-- not a bare `select <boolean expr> from profiles where id = auth.uid()`.
-- The bare form returns NULL, not false, whenever the row doesn't match
-- (no profile for this uid) OR the compared column is null — and NULL is
-- silently treated as "don't block" by a plpgsql `if not ... then raise`
-- guard (NOT NULL = NULL = falsy to an IF). Caught this exact bug in
-- testing: a non-admin was able to self-activate through
-- guard_employee_settings_privilege_columns() because the first cut of
-- is_timetracker_admin() returned NULL, not false, for them. RLS `using`
-- clauses tolerate NULL (behaves like false there), but a boolean helper
-- meant to gate a privilege check must never return anything but true/false.
create or replace function public.has_timetracker_access()
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select timetracker_role is not null from public.profiles where id = auth.uid()), false);
$$;

-- Convenience wrapper — timetracker's original schema had a flat `is_admin()`
-- used all over its RLS; this is that same shape, scoped to the module, so
-- 059/060 can read close to the original policies instead of spelling out
-- current_timetracker_role() = 'admin' everywhere.
create or replace function public.is_timetracker_admin()
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select timetracker_role = 'admin' from public.profiles where id = auth.uid()), false);
$$;

-- Guard: only a DELIVERIES admin may grant/revoke timetracker access or
-- change someone's timetracker_role. New trigger, not an extension of
-- guard_role_change() or guard_recruiting_access_change() — each module's
-- access gate stays independent so one module's bug can't touch another's.
create or replace function public.guard_timetracker_access_change()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (NEW.timetracker_role is distinct from OLD.timetracker_role
      or NEW.module_access  is distinct from OLD.module_access)
     and auth.uid() is not null
     and coalesce(public.current_user_role(), 'sales') <> 'admin' then
    raise exception 'Only an admin can change timetracker access or role';
  end if;
  return NEW;
end $$;

drop trigger if exists profiles_guard_timetracker_access on public.profiles;
create trigger profiles_guard_timetracker_access before update on public.profiles
  for each row execute function public.guard_timetracker_access_change();

-- Last-admin guard, scoped to timetracker_role only — same shape as
-- protect_last_recruiting_admin() (056), independent of it.
create or replace function public.protect_last_timetracker_admin()
  returns trigger language plpgsql security definer set search_path = public as $$
declare admin_count int;
begin
  if TG_OP = 'UPDATE' and OLD.timetracker_role = 'admin' and NEW.timetracker_role is distinct from 'admin' then
    select count(*) into admin_count from public.profiles where timetracker_role = 'admin';
    if admin_count <= 1 then
      raise exception 'There must always be at least one timetracker admin';
    end if;
  elsif TG_OP = 'DELETE' and OLD.timetracker_role = 'admin' then
    select count(*) into admin_count from public.profiles where timetracker_role = 'admin';
    if admin_count <= 1 then
      raise exception 'Cannot delete the last timetracker admin';
    end if;
  end if;
  return case when TG_OP = 'DELETE' then OLD else NEW end;
end $$;

drop trigger if exists profiles_protect_timetracker_admin on public.profiles;
create trigger profiles_protect_timetracker_admin before update or delete on public.profiles
  for each row execute function public.protect_last_timetracker_admin();

-- handle_new_user() is NOT touched here. Timetracker's original trigger made
-- the first-ever signup an admin — meaningless once merged into a container
-- that already has years of users and an admin. Access is granted the same
-- way recruiting's is: an existing deliveries admin sets timetracker_role
-- from the hub's Users dialog (D-057's MODULE_ACCESS pattern), never by
-- signing up. Every normal signup keeps getting timetracker_role=null.
