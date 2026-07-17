-- ============================================================
-- Migration: warehouse-revised pallet count
-- Sales estimates est_pallets; the warehouse confirms actual_pallets.
-- Run once in Supabase → SQL Editor if the DB predates this column.
-- (schema.sql already includes it for fresh installs.)
-- ============================================================

alter table public.deliveries
  add column if not exists actual_pallets numeric;
