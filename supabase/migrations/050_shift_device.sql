-- 050: A shift remembers WHICH phone clocked in.
--
-- Tracking used to run on any device signed into a driver's account with an
-- open shift. So when the owner logged into a driver's account to check
-- something, that device started reporting position too — which is exactly how
-- one day's track came out at 4,936 miles, with fixes from two places at once.
--
-- The shift now records the phone that started it, and only that phone reports.
--
-- Null is PERMISSIVE on purpose: shifts opened before this column existed, and
-- any clock-in that can't identify its device, still track as they did. A guard
-- that silently stopped tracking an in-progress shift would be worse than the
-- problem it fixes.
--
-- Safe to re-run.

alter table public.driver_shifts
  add column if not exists device_id text;

comment on column public.driver_shifts.device_id is
  'Opaque per-install id of the phone that clocked in. Only that device reports position for this shift. Null = unknown, which tracks permissively.';
