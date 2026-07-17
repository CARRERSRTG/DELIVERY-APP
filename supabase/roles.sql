-- ============================================================
-- User roles & workflow enforcement — run AFTER schema.sql (one time).
-- Roles: admin | manager | sales | warehouse
--   admin     → full access + manage users
--   manager   → office manager: approves / rejects submitted orders
--   sales     → creates & edits orders, submits them for approval
--   warehouse → fulfills approved orders (prep, driver, deliver)
-- ============================================================

alter table public.profiles add column if not exists role text not null default 'sales';
-- Store a warehouse worker / driver is scoped to (null = all stores).
alter table public.profiles add column if not exists store text;

-- Current user's role (used by the guards below).
create or replace function public.current_user_role()
  returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

-- ---------- Guard: only an admin may change user roles ----------
create or replace function public.guard_role_change()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.role is distinct from OLD.role
     and auth.uid() is not null
     and coalesce(public.current_user_role(), 'sales') <> 'admin' then
    raise exception 'Only an admin can change user roles';
  end if;
  return NEW;
end $$;

drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role before update on public.profiles
  for each row execute function public.guard_role_change();

-- ---------- Guard: enforce who can move an order between stages ----------
-- Runs on every INSERT/UPDATE of a delivery. auth.uid() is null when run
-- from the SQL editor / service role, which bypasses the checks.
--
-- Allowed transitions by role (admin may do anything):
--   sales:     create draft; draft<->pending; rejected->pending; edit while draft/pending/rejected
--   manager:   pending->approved; pending->rejected; approved->pending (unlock)
--   warehouse: approved->fulfilling->ready->ready<->delivered; edit fulfillment fields
create or replace function public.guard_delivery_stage()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  r text := coalesce(public.current_user_role(), 'sales');
  old_stage text := case when TG_OP = 'UPDATE' then OLD.stage else null end;
  new_stage text := NEW.stage;
begin
  -- Service role / SQL editor: no auth context, allow everything.
  if auth.uid() is null then return NEW; end if;
  -- Admins bypass.
  if r = 'admin' then return NEW; end if;

  if TG_OP = 'INSERT' then
    -- A re-delivery (repeat of a prior order) may be logged by the people who
    -- handle fulfillment, and re-enters the flow already approved.
    if NEW.redelivery_of is not null then
      if r in ('warehouse','manager','driver') and new_stage in ('approved','pending') then
        return NEW;
      end if;
      raise exception 'Not allowed to log this re-delivery';
    end if;
    if r not in ('sales','driver') then
      raise exception 'Only sales or drivers can create orders';
    end if;
    if new_stage not in ('draft','pending') then
      raise exception 'New orders start as draft or pending';
    end if;
    return NEW;
  end if;

  -- UPDATE: if the stage did not change, allow role-appropriate field edits.
  if new_stage is not distinct from old_stage then
    if r in ('sales','driver') and old_stage in ('draft','pending','rejected') then return NEW; end if;
    if r = 'manager' then return NEW; end if;
    if r = 'warehouse' and old_stage in ('approved','fulfilling','ready','delivered') then return NEW; end if;
    raise exception 'You cannot edit an order in the % stage', old_stage;
  end if;

  -- Stage transitions.
  if r in ('sales','driver') then
    if (old_stage = 'draft'    and new_stage = 'pending')
    or (old_stage = 'pending'  and new_stage = 'draft')
    or (old_stage = 'rejected' and new_stage = 'pending')
    or (old_stage = 'draft'    and new_stage = 'canceled')
    or (old_stage = 'rejected' and new_stage = 'canceled')
    or (r = 'driver' and old_stage = 'ready'     and new_stage = 'picked_up')
    or (r = 'driver' and old_stage = 'picked_up' and new_stage = 'delivered')
    or (r = 'driver' and old_stage = 'picked_up' and new_stage = 'ready') then
      return NEW;
    end if;
    raise exception '% cannot move an order from % to %', r, old_stage, new_stage;
  elsif r = 'manager' then
    if (old_stage = 'pending'  and new_stage = 'approved')
    or (old_stage = 'pending'  and new_stage = 'rejected')
    or (old_stage = 'approved' and new_stage = 'pending') then
      return NEW;
    end if;
    raise exception 'Manager cannot move an order from % to %', old_stage, new_stage;
  elsif r = 'warehouse' then
    if (old_stage = 'approved'   and new_stage = 'fulfilling')
    or (old_stage = 'fulfilling' and new_stage = 'ready')
    or (old_stage = 'ready'      and new_stage = 'picked_up')
    or (old_stage = 'picked_up'  and new_stage = 'delivered')
    or (old_stage = 'ready'      and new_stage = 'fulfilling')
    or (old_stage = 'picked_up'  and new_stage = 'ready')
    or (old_stage = 'delivered'  and new_stage = 'picked_up') then
      return NEW;
    end if;
    raise exception 'Warehouse cannot move an order from % to %', old_stage, new_stage;
  end if;

  raise exception 'Not allowed';
end $$;

drop trigger if exists deliveries_guard_stage on public.deliveries;
create trigger deliveries_guard_stage before insert or update on public.deliveries
  for each row execute function public.guard_delivery_stage();

-- Bootstrap: make the earliest-registered user an admin if there's no admin yet.
update public.profiles set role = 'admin'
where id = (select id from public.profiles order by created_at asc limit 1)
  and not exists (select 1 from public.profiles where role = 'admin');

-- Realtime for live role updates in the Users tab.
alter publication supabase_realtime add table public.profiles;
