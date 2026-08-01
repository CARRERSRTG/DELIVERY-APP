-- 022: Driver availability (Epic C groundwork).
--
-- Records when a driver is unavailable — vacation, sick leave, vehicle
-- maintenance, or other — as a date range. The auto-assignment optimizer
-- (Epic A) and the dispatch board (Epic C) will treat a driver as unavailable
-- on any day covered by a row here. Schema only for now; the management UI and
-- optimizer integration follow. Safe to re-run.

create table if not exists public.driver_availability (
  id         uuid primary key default gen_random_uuid(),
  driver_id  uuid not null references public.profiles(id) on delete cascade,
  kind       text not null default 'vacation',   -- vacation | sick | maintenance | other
  start_date date not null,
  end_date   date not null,
  note       text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists driver_availability_driver_idx on public.driver_availability(driver_id, start_date);

alter table public.driver_availability enable row level security;
drop policy if exists "auth read driver_availability"  on public.driver_availability;
drop policy if exists "auth write driver_availability" on public.driver_availability;
create policy "auth read driver_availability"  on public.driver_availability for select to authenticated using (true);
create policy "auth write driver_availability" on public.driver_availability for all    to authenticated using (true) with check (true);

do $$ begin
  alter publication supabase_realtime add table public.driver_availability;
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
