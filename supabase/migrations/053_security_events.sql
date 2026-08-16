-- 053: A record of who changed someone's access, and when.
--
-- An admin can reset passwords, change emails and usernames, switch roles and
-- grant capabilities — and until now NONE of it was written down anywhere.
-- The audit page covers orders only. With two admins and twenty-nine accounts,
-- "who changed this person's role, and when?" had no answer at all.
--
-- Deliberately NOT a general activity log: only the things that change what
-- somebody can reach or how they sign in. A log that records everything gets
-- read by nobody.
--
-- Never stores a password, old or new — the point is that a reset HAPPENED,
-- not what it produced.
--
-- Safe to re-run.

create table if not exists public.security_events (
  id          uuid primary key default gen_random_uuid(),
  -- Who did it. Null only for something the system did on its own.
  actor_id    uuid references auth.users(id) on delete set null,
  -- Who it was done to. Kept as a plain uuid with ON DELETE SET NULL so the
  -- record of a deletion survives the account it describes.
  target_id   uuid references auth.users(id) on delete set null,
  -- Denormalised on purpose: the whole point of the "user removed" entry is to
  -- still be readable after the profile is gone.
  target_name text,
  kind        text not null,
  detail      text,
  created_at  timestamptz not null default now()
);

create index if not exists security_events_created_idx on public.security_events (created_at desc);

alter table public.security_events enable row level security;

-- Admins read the log. Nobody edits or deletes it: an audit trail that its
-- readers can rewrite is not an audit trail.
drop policy if exists "security read admin"  on public.security_events;
drop policy if exists "security write admin" on public.security_events;

create policy "security read admin" on public.security_events
  for select using (public.current_user_role() = 'admin');

create policy "security write admin" on public.security_events
  for insert with check (auth.uid() = actor_id);
