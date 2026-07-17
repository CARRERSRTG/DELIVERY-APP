-- ============================================================
-- Migration: in-app notifications
-- Run once in Supabase → SQL Editor if you set up the DB before
-- notifications existed. (schema.sql already includes all of this
-- for fresh installs.)
-- ============================================================

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  delivery_id  uuid references public.deliveries(id) on delete cascade,
  order_no     bigint,
  kind         text not null,
  message      text not null,
  read         boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications(user_id, read);

alter table public.notifications enable row level security;
drop policy if exists "notif read own"   on public.notifications;
drop policy if exists "notif insert any" on public.notifications;
drop policy if exists "notif update own" on public.notifications;
create policy "notif read own"   on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "notif insert any" on public.notifications for insert to authenticated with check (true);
create policy "notif update own" on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Add to realtime (ignore error if already a member).
do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null;
end $$;
