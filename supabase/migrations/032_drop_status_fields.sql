-- 032: Drop the unused prepared_status / status_temp columns.
--
-- These were never used in practice (removed from the form in v0.3.9 and from
-- the type/detail/CSV in v0.4.x). Safe to re-run.

alter table public.deliveries drop column if exists prepared_status;
alter table public.deliveries drop column if exists status_temp;

notify pgrst, 'reload schema';
