-- 051: Sign in with a username, for people who have no email.
--
-- Supabase Auth identifies people by email and that isn't negotiable, so a
-- user with no address gets a synthetic one derived from their username
-- (see src/lib/username.ts). This column is what the office edits and what
-- the app shows; the derived address is an implementation detail.
--
-- Unique, case-folded: "Maximo" and "maximo" must never be two people.
-- Null is allowed — everyone who signs in with a real email has no username
-- and needs none.
--
-- Safe to re-run.

alter table public.profiles
  add column if not exists username text;

create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username))
  where username is not null;

comment on column public.profiles.username is
  'Login name for users without an email. Signs in as <username>@users.rdztilegroup.net. Null for email users.';
