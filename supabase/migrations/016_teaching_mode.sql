-- 016: Teaching / training mode. Orders created while a user is in teaching
-- mode are flagged is_training = true and live entirely alongside real orders
-- in the same table — the app just reads/writes one set or the other depending
-- on the mode. Training data persists (it is never auto-deleted on exit).

alter table public.deliveries add column if not exists is_training boolean not null default false;
create index if not exists deliveries_is_training_idx on public.deliveries(is_training);
