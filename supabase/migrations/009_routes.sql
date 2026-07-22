-- ============================================================
-- Migration: Logistics Manager route planning
--   - deliveries.route_seq: this order's stop position (0-based) in its
--     driver's route for the day, set by the route optimizer. null = not
--     sequenced yet.
--   - "logistics" is a new value for profiles.role (a plain text column,
--     not an enum — see roles.sql — so no column change needed there).
--   - guard_delivery_stage() is replaced to let a "logistics" user edit an
--     order (assign a driver, set route_seq) without changing its stage,
--     while it sits in approved/fulfilling/ready — the same coarse-grained
--     "stage didn't change" rule warehouse/manager already get.
-- Run once in Supabase → SQL Editor, AFTER roles.sql.
-- ============================================================

alter table public.deliveries
  add column if not exists route_seq integer;

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
    -- Logistics: assign a driver / set the route sequence while dispatching.
    if r = 'logistics' and old_stage in ('approved','fulfilling','ready') then return NEW; end if;
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
