-- Same-day delivery surcharge on settings:
--   same_day_surcharge — extra $ added to the delivery fee when the delivery
--                        date is today. Default 0 = feature off.
-- Without this column saveSettings silently drops the value, so the input in
-- Settings → Local-zone pricing wouldn't persist.
alter table public.settings add column if not exists same_day_surcharge numeric not null default 0;
