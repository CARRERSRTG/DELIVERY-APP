-- Role-targeted notes on an order: a small list of { id, role, text, by,
-- by_name, at } left on demand and tagged with the role it's meant for
-- (sales / warehouse / logistics / driver / everyone). Everyone can see every
-- note; the tag just says whose attention it wants. Stored as jsonb so an
-- order with no notes carries an empty array (no crowding of the form).
alter table public.deliveries
  add column if not exists role_notes jsonb not null default '[]'::jsonb;
