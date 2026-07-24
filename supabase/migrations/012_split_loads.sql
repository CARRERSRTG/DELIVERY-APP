-- 012: Split loads. When a driver can only load part of an order, the loaded
-- part keeps the order_no with suffix 'a' and the remainder becomes a new
-- order with the SAME order_no and suffix 'b'. Run in the Supabase SQL Editor.

alter table public.deliveries add column if not exists order_suffix text;

-- The stage-transition guard now allows drivers/warehouse to insert the "b"
-- remainder order directly in 'ready'. After running this file, RE-RUN
-- supabase/roles.sql (it is safe to re-run) to pick up the updated trigger.
