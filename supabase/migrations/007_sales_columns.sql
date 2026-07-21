-- ============================================================
-- Migration: admin-fixed Orders-table columns for the Sales role
--   - settings.sales_columns: jsonb array of column keys, or null to fall
--     back to the built-in default. Sales reps get no Columns picker of
--     their own — an admin sets this once in Settings for everyone.
-- Run once in Supabase → SQL Editor.
-- ============================================================

alter table public.settings
  add column if not exists sales_columns jsonb;
