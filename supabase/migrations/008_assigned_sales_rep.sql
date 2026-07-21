-- ============================================================
-- Migration: assigned_sales_rep on deliveries
--   - When an office/admin/driver creates an order on behalf of a sales rep
--     (OrderModal's Sales Rep picker), created_by stays the actual creator
--     and this column records who the order is FOR. lib/utils.ts's
--     orderOwner() resolves assigned_sales_rep ?? created_by everywhere
--     "whose order is this" matters (visibility, notifications, dashboard
--     and export credit).
-- Run once in Supabase → SQL Editor.
-- ============================================================

alter table public.deliveries
  add column if not exists assigned_sales_rep uuid references public.profiles(id) on delete set null;
