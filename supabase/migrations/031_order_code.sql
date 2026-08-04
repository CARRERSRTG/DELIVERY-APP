-- 031: Human-facing order code (e.g. "FA100").
--
-- Adds order_code — the id shown throughout the app (order_no stays as the
-- internal sequence / sort key / split-load anchor, never displayed). A split
-- load shares its parent's code with a different order_suffix, so uniqueness is
-- on (is_training, order_code, suffix) — with coalesce so two null-suffix rows
-- still collide (Postgres treats plain NULLs as distinct). Backfill of existing
-- rows is done from the app (needs the ISO-week/letter logic). Safe to re-run.

alter table public.deliveries add column if not exists order_code text;

create unique index if not exists deliveries_order_code_idx
  on public.deliveries (is_training, order_code, coalesce(order_suffix, ''))
  where order_code is not null;

notify pgrst, 'reload schema';
