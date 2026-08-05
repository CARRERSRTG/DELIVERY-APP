-- Multiple loads per driver: a driver can run several routes in a day, each a
-- separate truckload/trip. load_no groups an order into its load (null/1 = the
-- driver's first load). Sequencing (route_seq) is per-load.
alter table public.deliveries add column if not exists load_no int;
