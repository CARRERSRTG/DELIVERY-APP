-- 052: Extra per-person permissions actually have somewhere to live.
--
-- The Users page has offered per-person capability toggles for a long time,
-- the Profile type declares `permissions`, and `extraCaps()` reads it — but the
-- column was never created. Every toggle wrote to a column that did not exist
-- and failed; every read came back undefined, so the checkboxes always looked
-- empty and nobody could tell the difference between "not granted" and "did
-- not save".
--
-- text[] rather than jsonb: it is a list of capability keys, and a real array
-- can be queried and constrained like one.
--
-- Safe to re-run.

alter table public.profiles
  add column if not exists permissions text[];

comment on column public.profiles.permissions is
  'Capability keys granted to this individual ON TOP of their role (see ROLE_CAPS). Null/empty = role only.';
