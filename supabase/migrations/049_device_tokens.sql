-- 049: Where to push a notification, per phone.
--
-- The in-app bell reaches a driver who is looking at the app. FCM reaches a
-- phone in a pocket — but only if we know which phone. Firebase hands each
-- install a token; this is where it lives.
--
-- Keyed by the token itself, not by user: the same phone reinstalled gets a
-- new token, and the same person can carry two phones. A token that moves to a
-- different user (a shared phone handed over) simply updates its owner.
--
-- Safe to re-run.

create table if not exists public.device_tokens (
  token       text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  platform    text not null default 'android',
  -- Refreshed on every app start, so a token nobody has used in months can be
  -- recognised as dead weight later.
  updated_at  timestamptz not null default now()
);

create index if not exists device_tokens_user_idx on public.device_tokens(user_id);

alter table public.device_tokens enable row level security;

-- A person may only ever see or touch their own phones.
drop policy if exists "tokens read own"   on public.device_tokens;
drop policy if exists "tokens write own"  on public.device_tokens;
drop policy if exists "tokens update own" on public.device_tokens;
drop policy if exists "tokens delete own" on public.device_tokens;

create policy "tokens read own"   on public.device_tokens for select using (user_id = auth.uid());
create policy "tokens write own"  on public.device_tokens for insert with check (user_id = auth.uid());
create policy "tokens update own" on public.device_tokens for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "tokens delete own" on public.device_tokens for delete using (user_id = auth.uid());
