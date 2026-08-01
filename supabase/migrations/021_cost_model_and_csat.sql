-- 021: Delivery cost model + customer satisfaction (Epic D part 2).
--
--  • settings cost model — fuel price ($/gal), fleet MPG, and a flat overhead
--    $/delivery. Fuel cost and cost-per-delivery KPIs are DERIVED from these
--    plus each order's route_miles, so no per-order cost column is needed.
--  • deliveries.csat_rating (1–5) + csat_comment — the customer's satisfaction,
--    recorded on a delivered order from the order form.
-- Safe to re-run.

alter table public.settings
  add column if not exists fuel_price        numeric,   -- $ per gallon
  add column if not exists fleet_mpg         numeric,   -- average miles per gallon
  add column if not exists cost_per_delivery numeric;   -- flat overhead $ per stop

alter table public.deliveries
  add column if not exists csat_rating  integer,        -- 1..5
  add column if not exists csat_comment text;

-- Refresh PostgREST's schema cache so the new columns are usable immediately.
notify pgrst, 'reload schema';
