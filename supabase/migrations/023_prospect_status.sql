-- 023: Market Map prospect CRM.
--
-- A jsonb map on settings, keyed by external place id (Google/OSM), tracking a
-- sales status per prospect: contacted / interested / partner / not_interested,
-- with an optional note. Layered over the live places on the Market Map; no
-- per-place table needed. Safe to re-run.

alter table public.settings
  add column if not exists prospect_status jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
