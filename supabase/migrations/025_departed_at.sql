-- 025: Drive-to-pickup timestamp.
--
-- departed_at marks when the driver set off toward the pickup, before they
-- actually load (pickup_gps_at). The idle-time KPI uses it as the start of
-- "active" time when present, so the drive to the first stop counts as work
-- instead of idle. Safe to re-run.

alter table public.deliveries add column if not exists departed_at timestamptz;

notify pgrst, 'reload schema';
