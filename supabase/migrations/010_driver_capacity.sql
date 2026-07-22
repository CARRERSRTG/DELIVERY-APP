-- ============================================================
-- Migration: per-driver truck capacity for Route Planning
--   - settings.driver_capacity: jsonb map of driver full_name -> pallet
--     capacity. When a driver's assigned pallets exceed their truck's
--     capacity, the route optimizer splits the day into multiple round
--     trips back to their home store to reload, instead of one open route.
-- Run once in Supabase → SQL Editor.
-- ============================================================

alter table public.settings
  add column if not exists driver_capacity jsonb default '{}'::jsonb;
