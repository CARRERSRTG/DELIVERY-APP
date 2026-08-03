-- 024: Driver shift clock (idle-time KPI).
--
-- Each row is one driver work session: started_at when they clock in,
-- ended_at when they clock out (null = on the clock right now). The dashboard
-- derives idle time = on-clock time minus time spent actively working a
-- delivery (pickup_gps_at → pod_delivered_at). Safe to re-run.

create table if not exists public.driver_shifts (
  id         uuid primary key default gen_random_uuid(),
  driver_id  uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists driver_shifts_driver_idx on public.driver_shifts(driver_id, started_at);
-- At most one open (un-clocked-out) shift per driver.
create unique index if not exists driver_shifts_one_open_idx
  on public.driver_shifts(driver_id) where ended_at is null;

alter table public.driver_shifts enable row level security;
drop policy if exists "auth read driver_shifts"  on public.driver_shifts;
drop policy if exists "auth write driver_shifts" on public.driver_shifts;
create policy "auth read driver_shifts"  on public.driver_shifts for select to authenticated using (true);
create policy "auth write driver_shifts" on public.driver_shifts for all    to authenticated using (true) with check (true);

do $$ begin
  alter publication supabase_realtime add table public.driver_shifts;
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
