-- 027: Explicit per-order-type field rules + rename the default types.
--
-- Order types used to drive their field requirements by keyword-matching the
-- name (fragile: renaming "Delivery" to "Customer" would have flipped it to a
-- no-paperwork pickup). Rules are now explicit per type:
--   { storeToStore: bool, docRef: 'invoice' | 'any' | 'none' }
-- Also renames the shipped defaults: Delivery -> Customer, Intratienda ->
-- Intertienda (Transfer unchanged). Safe to re-run.

alter table public.settings
  add column if not exists order_type_rules jsonb not null default '{}'::jsonb;

-- Rename the two default types in the ordered list (leaves any custom types).
update public.settings
set order_types = (
  select array_agg(
    case x
      when 'Delivery'    then 'Customer'
      when 'Intratienda' then 'Intertienda'
      else x
    end order by ord)
  from unnest(order_types) with ordinality as u(x, ord)
)
where id = 1;

-- Seed the rules for the known types (merge — keeps any other configured keys).
update public.settings
set order_type_rules = order_type_rules || jsonb_build_object(
  'Customer',    jsonb_build_object('storeToStore', false, 'docRef', 'invoice'),
  'Intertienda', jsonb_build_object('storeToStore', true,  'docRef', 'any'),
  'Transfer',    jsonb_build_object('storeToStore', true,  'docRef', 'none')
)
where id = 1;

notify pgrst, 'reload schema';
