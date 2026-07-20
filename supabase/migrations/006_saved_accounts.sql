-- ============================================================
-- Migration: saved accounts with a default contact + phone
--   - settings.accounts: jsonb array of { name, contact, phone } — picking a
--     saved account on an order auto-fills Contact name / Delivery Phone
--     Number, the same way a saved pickup/dropoff auto-fills its address.
-- Run once in Supabase → SQL Editor.
-- ============================================================

alter table public.settings
  add column if not exists accounts jsonb default '[]'::jsonb;
