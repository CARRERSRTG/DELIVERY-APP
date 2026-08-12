-- 043: Live driver GPS positions.
--
-- Each row is one location fix from a driver's phone while they are ON SHIFT.
-- Logistics reads the newest fix per driver to see the fleet moving in real
-- time; the history behind it also answers "where was the truck at 2pm".
--
-- Tracking is shift-bound by design: the app only sends fixes between clock-in
-- and clock-out, so there is no record of a driver's own time. Drivers have
-- been informed and agreed to this.
--
-- Safe to re-run.

create table if not exists public.driver_locations (
  id           uuid primary key default gen_random_uuid(),
  driver_id    uuid not null references public.profiles(id) on delete cascade,
  lat          double precision not null,
  lng          double precision not null,
  -- Fix quality, straight from the device. accuracy_m is the radius the phone
  -- claims the point is good to — a 500m fix is worth showing differently
  -- from a 5m one rather than trusting both equally.
  accuracy_m   real,
  speed_mps    real,
  heading      real,
  battery_pct  smallint,
  -- When the DEVICE took the fix (may lag created_at if it was queued offline).
  recorded_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

-- The two access patterns: newest fix per driver (live map), and one driver's
-- trail over a time range (history).
create index if not exists driver_locations_driver_time_idx
  on public.driver_locations (driver_id, recorded_at desc);
create index if not exists driver_locations_time_idx
  on public.driver_locations (recorded_at desc);

alter table public.driver_locations enable row level security;

-- A driver may only ever write their OWN position — one phone can't report
-- another driver's whereabouts.
drop policy if exists "driver writes own location" on public.driver_locations;
create policy "driver writes own location" on public.driver_locations
  for insert to authenticated
  with check (driver_id = auth.uid());

-- Office roles see the whole fleet; a driver sees only their own trail.
drop policy if exists "read fleet locations" on public.driver_locations;
create policy "read fleet locations" on public.driver_locations
  for select to authenticated
  using (
    driver_id = auth.uid()
    or coalesce(public.current_user_role(), '') in ('admin','logistics','manager')
  );

-- Housekeeping: positions are operational data, not an archive. Six drivers
-- pinging through a shift is on the order of 10k rows/day, so old trails are
-- dropped rather than kept forever. Called from the app (or a cron) — it is
-- security definer so it can clean up regardless of who invokes it.
create or replace function public.prune_driver_locations(keep_days int default 30)
  returns integer language plpgsql security definer set search_path = public as $$
declare removed integer;
begin
  delete from public.driver_locations
   where recorded_at < now() - (keep_days || ' days')::interval;
  get diagnostics removed = row_count;
  return removed;
end $$;

-- Live map updates without polling.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'driver_locations'
  ) then
    alter publication supabase_realtime add table public.driver_locations;
  end if;
end $$;
