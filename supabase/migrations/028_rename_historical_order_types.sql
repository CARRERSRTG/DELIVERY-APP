-- 028: Rename historical orders to the new order-type names.
--
-- Migration 027 renamed the type list + rules but left existing rows on their
-- old type strings (they still validated via keyword fallback). This brings the
-- historical rows in line with the new names. Idempotent. Applied live.

update public.deliveries set order_type = 'Customer'    where order_type = 'Delivery';
update public.deliveries set order_type = 'Intertienda' where order_type = 'Intratienda';
