-- ============================================================
-- Migration: dispatch map + pending-approval deadline alerts
--   - deliveries.delivery_lat/lng: planned delivery point (geocoded from the
--     address and cached, OR a manually-dropped pin for sites with no real
--     address yet, e.g. a construction site)
--   - deliveries.delivery_pin_source: "geocoded" | "manual" — manual pins are
--     never overwritten by re-geocoding
--   - settings.manager_pending_cutoff / sales_pending_cutoff: end-of-day
--     "HH:MM" cutoffs after which a still-pending order is flagged urgent
--   - settings.driver_colors: jsonb map of driver full_name -> color, used
--     to color-code pins on the dispatch map (assigned by a manager/admin)
-- Run once in Supabase → SQL Editor.
-- ============================================================

alter table public.deliveries
  add column if not exists delivery_lat double precision;

alter table public.deliveries
  add column if not exists delivery_lng double precision;

alter table public.deliveries
  add column if not exists delivery_pin_source text check (delivery_pin_source in ('geocoded', 'manual'));

alter table public.settings
  add column if not exists manager_pending_cutoff text default '16:00';

alter table public.settings
  add column if not exists sales_pending_cutoff text default '16:15';

alter table public.settings
  add column if not exists driver_colors jsonb default '{}'::jsonb;
