-- 055: Recruiting module access on profiles (additive only).
--
-- Two new fields, deliberately separate:
--   recruiting_role  -- this person's permission tier INSIDE the recruiting
--                        module (admin | manager | recruiter). Null = none.
--   module_access    -- which OTHER modules (besides deliveries itself) this
--                        identity may even open. A list, not a boolean, so a
--                        future third module doesn't need a new column.
--
-- Every existing deliveries user gets module_access='{}' and
-- recruiting_role=null from the column DEFAULT the moment this runs --
-- nobody gains recruiting access by accident.
--
-- Does NOT touch guard_role_change() / profiles_guard_role — that trigger
-- keeps governing `role` exactly as it does today, untouched.
--
-- Safe to re-run.

alter table public.profiles
  add column if not exists recruiting_role text,
  add column if not exists module_access  text[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_recruiting_role_check') then
    alter table public.profiles
      add constraint profiles_recruiting_role_check
        check (recruiting_role is null or recruiting_role in ('admin','manager','recruiter'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_recruiting_access_needs_role') then
    alter table public.profiles
      add constraint profiles_recruiting_access_needs_role
        check (not ('recruiting' = any(module_access)) or recruiting_role is not null);
  end if;
end $$;

-- This app's own role (deliveries: admin|manager|sales|warehouse|driver|...).
-- Already exists (roles.sql) -- repeated here only as the reference point for
-- the new function below, unchanged.

create or replace function public.current_recruiting_role()
  returns text language sql stable security definer set search_path = public as $$
  select recruiting_role from public.profiles where id = auth.uid();
$$;

create or replace function public.has_recruiting_access()
  returns boolean language sql stable security definer set search_path = public as $$
  select recruiting_role is not null from public.profiles where id = auth.uid();
$$;

-- Guard: only a DELIVERIES admin may grant/revoke recruiting access or change
-- someone's recruiting_role. Deliberately a NEW trigger, not an extension of
-- guard_role_change() -- that one keeps governing `role` on its own, exactly
-- as before, at zero risk of regression.
create or replace function public.guard_recruiting_access_change()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (NEW.recruiting_role is distinct from OLD.recruiting_role
      or NEW.module_access  is distinct from OLD.module_access)
     and auth.uid() is not null
     and coalesce(public.current_user_role(), 'sales') <> 'admin' then
    raise exception 'Only an admin can change recruiting access or role';
  end if;
  return NEW;
end $$;

drop trigger if exists profiles_guard_recruiting_access on public.profiles;
create trigger profiles_guard_recruiting_access before update on public.profiles
  for each row execute function public.guard_recruiting_access_change();
