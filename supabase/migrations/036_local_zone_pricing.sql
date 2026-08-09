-- Local-zone delivery pricing on settings:
--   local_cities          — cities that count as the LOCAL delivery zone
--   local_fee_list        — LOCAL flat fee, standard "list" price
--   local_fee_discount    — LOCAL flat fee, discounted price
--   nonlocal_fee_brackets — NOT-LOCAL fee by driving miles (jsonb array of
--                           { max_miles, list, discount }; max_miles null = "and up")
-- Without these columns saveSettings silently drops the values, so the editor
-- in Settings → Local-zone pricing wouldn't persist. Defaults keep it working.
alter table public.settings add column if not exists local_cities text[] not null default '{}';
alter table public.settings add column if not exists local_fee_list numeric;
alter table public.settings add column if not exists local_fee_discount numeric;
alter table public.settings add column if not exists nonlocal_fee_brackets jsonb not null default '[]'::jsonb;
