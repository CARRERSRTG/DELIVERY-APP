-- 045: Remember whether a truckload was grouped by the optimizer or by a person.
--
-- `load_no` says WHICH truckload an order rides on, but not who decided that.
-- Without the difference, the two are indistinguishable and the optimizer has
-- to choose between two bad behaviours: re-group every time (throwing away a
-- dispatcher's deliberate split) or never re-group (so orders added later in
-- the day are stuck on whatever load they landed on).
--
-- true  = the optimizer grouped this one, and may regroup it freely.
-- false = a person put it here on purpose; leave it alone.
--
-- Defaults to false, so every load that exists today is treated as deliberate.
-- Safe to re-run.

alter table public.deliveries
  add column if not exists load_auto boolean not null default false;
