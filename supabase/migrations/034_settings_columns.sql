-- Settings fields added over the routes/loads work that were missing DB columns
-- (so saveSettings silently failed and the values reverted on reload — e.g. a
-- newly created temp driver / route bucket would "disappear").
alter table public.settings add column if not exists route_buckets text[] not null default '{}';
alter table public.settings add column if not exists default_truck_capacity numeric;
alter table public.settings add column if not exists require_pod boolean not null default false;
alter table public.settings add column if not exists customer_scope jsonb not null default '{}'::jsonb;
