-- Driver override: the actual address where an order was delivered when it was
-- NOT the ordered delivery_address. Null = delivered at the ordered address.
-- The off-address delivery is also written to the audit log (order_events) at
-- the moment of delivery, so it's reported even before this column exists.
alter table public.deliveries
  add column if not exists delivered_address text;
