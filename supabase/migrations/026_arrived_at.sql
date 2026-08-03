-- 026: Arrival-at-stop timestamp.
--
-- arrived_at marks when the driver reached the delivery stop, between pickup
-- (pickup_gps_at) and hand-off (pod_delivered_at). It splits transit time into
-- driving (pickup → arrived) and dwell/service at the stop (arrived →
-- delivered), and makes idle-between-stops exact. Safe to re-run.

alter table public.deliveries add column if not exists arrived_at timestamptz;

notify pgrst, 'reload schema';
