-- ============================================================
-- Migration: driver role support + re-delivery tracking
--   - profiles.store: store a warehouse worker / driver is scoped to
--   - deliveries.redelivery_of / redelivery_reason: repeats logged as
--     new orders linked to the original, for end-of-week review
-- Run once in Supabase → SQL Editor. Re-run roles.sql afterward to refresh
-- the stage guard so drivers can create + mark delivered.
-- ============================================================

alter table public.profiles
  add column if not exists store text;

alter table public.deliveries
  add column if not exists redelivery_of uuid references public.deliveries(id) on delete set null;

alter table public.deliveries
  add column if not exists redelivery_reason text;

create index if not exists deliveries_redelivery_of_idx on public.deliveries(redelivery_of);
