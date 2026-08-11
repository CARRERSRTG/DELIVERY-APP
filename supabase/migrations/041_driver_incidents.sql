-- 041: Driver incident log (logistics manager).
--
-- Each row records something a driver did that cost the company money — a
-- wasted round trip, damage, or inefficiency from a bad attitude. `cost` is the
-- estimated $ impact; `delivery_id` optionally links the order it relates to.
-- Only surfaced to logistics/admin/manager in the app. Safe to re-run.

create table if not exists public.driver_incidents (
  id            uuid primary key default gen_random_uuid(),
  driver_name   text not null,
  delivery_id   uuid references public.deliveries(id) on delete set null,
  incident_date date not null default current_date,
  description   text not null,
  cost          numeric not null default 0,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists driver_incidents_driver_idx on public.driver_incidents(driver_name, incident_date);

alter table public.driver_incidents enable row level security;
drop policy if exists "auth read driver_incidents"  on public.driver_incidents;
drop policy if exists "auth write driver_incidents" on public.driver_incidents;
create policy "auth read driver_incidents"  on public.driver_incidents for select to authenticated using (true);
create policy "auth write driver_incidents" on public.driver_incidents for all    to authenticated using (true) with check (true);

do $$ begin
  alter publication supabase_realtime add table public.driver_incidents;
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
