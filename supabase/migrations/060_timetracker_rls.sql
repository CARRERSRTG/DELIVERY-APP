-- 060: RLS on timetracker.* + storage bucket + realtime + retention.
--
-- Unlike recruiting's flat "any module member can touch anything" boundary
-- (057), timetracker keeps its ORIGINAL owner-or-admin granularity for
-- sessions/requests/payrolls/screenshots — that fine-grain is the whole
-- point of the payroll-privacy fix already baked into timetracker's own
-- history (an employee must never read anyone else's pay). projects/
-- assignments/settings are read-all-module-members, write-admin-only, same
-- shape as recruiting's boundary since there's no per-row ownership there.

alter table timetracker.employee_settings enable row level security;
alter table timetracker.projects          enable row level security;
alter table timetracker.assignments       enable row level security;
alter table timetracker.sessions          enable row level security;
alter table timetracker.requests          enable row level security;
alter table timetracker.payrolls          enable row level security;
alter table timetracker.settings          enable row level security;
alter table timetracker.audit             enable row level security;
alter table timetracker.screenshots       enable row level security;

-- employee_settings: read own or admin; insert self; update own or admin,
-- but `active` is pinned unless the actor is a timetracker admin (same
-- privilege-escalation class timetracker's own history already found and
-- fixed on `profiles.role`/`profiles.active` — not repeating it here).
create policy "tt employee_settings read"   on timetracker.employee_settings
  for select to authenticated using (public.is_timetracker_admin() or id = auth.uid());
create policy "tt employee_settings insert" on timetracker.employee_settings
  for insert to authenticated with check (id = auth.uid() or public.is_timetracker_admin());
create policy "tt employee_settings update" on timetracker.employee_settings
  for update to authenticated using (public.is_timetracker_admin() or id = auth.uid());

create or replace function timetracker.guard_employee_settings_privilege_columns()
returns trigger language plpgsql security definer set search_path = timetracker, public as $$
begin
  if not public.is_timetracker_admin() and new.active is distinct from old.active then
    raise exception 'Only a timetracker admin can change active status';
  end if;
  return new;
end $$;

drop trigger if exists tt_guard_employee_settings_privilege on timetracker.employee_settings;
create trigger tt_guard_employee_settings_privilege
  before update on timetracker.employee_settings
  for each row execute function timetracker.guard_employee_settings_privilege_columns();

-- projects / assignments / settings: read any module member, write admin only
create policy "tt projects read"  on timetracker.projects for select to authenticated using (public.has_timetracker_access());
create policy "tt projects write" on timetracker.projects for all    to authenticated using (public.is_timetracker_admin()) with check (public.is_timetracker_admin());

create policy "tt assignments read"  on timetracker.assignments for select to authenticated using (public.has_timetracker_access());
create policy "tt assignments write" on timetracker.assignments for all    to authenticated using (public.is_timetracker_admin()) with check (public.is_timetracker_admin());

create policy "tt settings read"  on timetracker.settings for select to authenticated using (public.has_timetracker_access());
create policy "tt settings write" on timetracker.settings for all    to authenticated using (public.is_timetracker_admin()) with check (public.is_timetracker_admin());

-- sessions: own or admin read/insert; update own only while unpaid
-- (payroll_id is null) or admin always; delete admin only.
create policy "tt sessions read"   on timetracker.sessions for select to authenticated using (public.is_timetracker_admin() or employee_uid = auth.uid());
create policy "tt sessions insert" on timetracker.sessions for insert to authenticated with check (public.is_timetracker_admin() or employee_uid = auth.uid());
create policy "tt sessions update" on timetracker.sessions for update to authenticated using (public.is_timetracker_admin() or (employee_uid = auth.uid() and payroll_id is null));
create policy "tt sessions delete" on timetracker.sessions for delete to authenticated using (public.is_timetracker_admin());

-- requests: employee reads/creates own; only admin resolves (approve/reject)
create policy "tt requests read"   on timetracker.requests for select to authenticated using (public.is_timetracker_admin() or employee_uid = auth.uid());
create policy "tt requests insert" on timetracker.requests for insert to authenticated with check (employee_uid = auth.uid());
create policy "tt requests update" on timetracker.requests for update to authenticated using (public.is_timetracker_admin());

-- payrolls: employee reads OWN only; admin does everything
create policy "tt payrolls read"  on timetracker.payrolls for select to authenticated using (public.is_timetracker_admin() or employee_uid = auth.uid());
create policy "tt payrolls write" on timetracker.payrolls for all    to authenticated using (public.is_timetracker_admin()) with check (public.is_timetracker_admin());

-- audit: admin only, both ways
create policy "tt audit read"   on timetracker.audit for select to authenticated using (public.is_timetracker_admin());
create policy "tt audit insert" on timetracker.audit for insert to authenticated with check (public.is_timetracker_admin());

-- screenshots: employee reads/deletes own, admin reads/deletes all; owner inserts
create policy "tt screenshots read"   on timetracker.screenshots for select to authenticated using (public.is_timetracker_admin() or employee_uid = auth.uid());
create policy "tt screenshots insert" on timetracker.screenshots for insert to authenticated with check (employee_uid = auth.uid());
create policy "tt screenshots delete" on timetracker.screenshots for delete to authenticated using (public.is_timetracker_admin() or employee_uid = auth.uid());

-- =====================================================================
--  STORAGE — private bucket for desktop screenshots.
--  Named "timetracker-screenshots", not "screenshots" — the original app
--  owned that name outright; here it shares a Storage namespace with
--  deliveries' own buckets and recruiting's "resumes", so it gets the same
--  module prefix everything else in this project uses.
--  Path convention unchanged: <employee_uid>/<session_id>/<timestamp>.jpg
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('timetracker-screenshots', 'timetracker-screenshots', false)
on conflict (id) do nothing;

create policy "tt shots upload own"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'timetracker-screenshots' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "tt shots read own or admin"
  on storage.objects for select to authenticated
  using (bucket_id = 'timetracker-screenshots'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_timetracker_admin()));

create policy "tt shots delete own or admin"
  on storage.objects for delete to authenticated
  using (bucket_id = 'timetracker-screenshots'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_timetracker_admin()));

-- =====================================================================
--  REALTIME — timetracker's app relies on live updates (was Firestore
--  onSnapshot before its own Supabase port). RLS still applies to realtime,
--  so an employee only receives their own rows, same as every other table.
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'employee_settings','projects','assignments','sessions',
    'requests','payrolls','settings','audit','screenshots'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'timetracker' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table timetracker.%I', t);
    end if;
  end loop;
end $$;

-- =====================================================================
--  SCREENSHOT RETENTION — auto-delete shots older than N days, daily via
--  pg_cron. Namespaced under timetracker.* so it can't collide with any
--  other module's retention job.
-- =====================================================================
create extension if not exists pg_cron;

create or replace function timetracker.purge_old_screenshots(older_than interval default '14 days')
returns integer
language plpgsql
security definer
set search_path = timetracker, storage
as $$
declare
  n integer;
begin
  delete from storage.objects
  where bucket_id = 'timetracker-screenshots'
    and created_at < now() - older_than;
  with del as (
    delete from timetracker.screenshots
    where taken_at < now() - older_than
    returning 1
  )
  select count(*) into n from del;
  return n;
end;
$$;

do $$
begin
  perform cron.unschedule('purge_old_timetracker_screenshots')
    where exists (select 1 from cron.job where jobname = 'purge_old_timetracker_screenshots');
  perform cron.schedule('purge_old_timetracker_screenshots', '0 3 * * *',
    $cmd$ select timetracker.purge_old_screenshots('14 days'); $cmd$);
end $$;
