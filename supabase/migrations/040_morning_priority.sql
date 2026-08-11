-- Morning-priority flag on deliveries:
--   morning_priority — set when a missed order is reprogrammed for a later date
--                      and flagged to go out FIRST thing the next morning. The
--                      driver's route bumps these stops to the front.
-- Without this column the OrderModal checkbox would silently drop its value.
alter table public.deliveries add column if not exists morning_priority boolean not null default false;
