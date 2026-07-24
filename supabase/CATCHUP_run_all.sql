-- ============================================================
-- CATCH-UP SCRIPT — brings an existing database fully in sync with
-- the app code (migrations 001–014 in one idempotent script).
--
-- SAFE TO RUN as many times as you like: every statement either uses
-- "if not exists" / "create or replace" / "drop ... if exists", or is
-- guarded so it only runs when needed. Paste the whole thing into
-- Supabase → SQL Editor → Run.
-- ============================================================

-- ---------- 001: notifications ----------
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
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; end $$;

-- ---------- 002: warehouse actual pallets ----------
alter table public.deliveries add column if not exists actual_pallets numeric;

-- ---------- 003: stores/drivers text[] -> jsonb  (GUARDED so re-runs are safe) ----------
do $$
begin
  if (select data_type from information_schema.columns
      where table_schema='public' and table_name='settings' and column_name='stores') = 'ARRAY' then
    alter table public.settings alter column stores type jsonb using (
      coalesce((select jsonb_agg(jsonb_build_object('name', s, 'address', '')) from unnest(stores) as s), '[]'::jsonb));
    alter table public.settings alter column stores set default '[]'::jsonb;
  end if;
  if (select data_type from information_schema.columns
      where table_schema='public' and table_name='settings' and column_name='drivers') = 'ARRAY' then
    alter table public.settings alter column drivers type jsonb using (
      coalesce((select jsonb_agg(jsonb_build_object('name', d, 'address', '')) from unnest(drivers) as d), '[]'::jsonb));
    alter table public.settings alter column drivers set default '[]'::jsonb;
  end if;
end $$;

-- ---------- 004: driver scope + re-delivery ----------
alter table public.profiles   add column if not exists store text;
alter table public.deliveries add column if not exists redelivery_of uuid references public.deliveries(id) on delete set null;
alter table public.deliveries add column if not exists redelivery_reason text;
create index if not exists deliveries_redelivery_of_idx on public.deliveries(redelivery_of);

-- ---------- 005: map + deadline alerts ----------
alter table public.deliveries add column if not exists delivery_lat double precision;
alter table public.deliveries add column if not exists delivery_lng double precision;
alter table public.deliveries add column if not exists delivery_pin_source text;
alter table public.settings   add column if not exists manager_pending_cutoff text default '16:00';
alter table public.settings   add column if not exists sales_pending_cutoff   text default '16:15';
alter table public.settings   add column if not exists driver_colors jsonb default '{}'::jsonb;

-- ---------- 006: saved accounts ----------
alter table public.settings add column if not exists accounts jsonb default '[]'::jsonb;

-- ---------- 007: sales columns ----------
alter table public.settings add column if not exists sales_columns jsonb;

-- ---------- 008: assigned sales rep ----------
alter table public.deliveries add column if not exists assigned_sales_rep uuid references public.profiles(id) on delete set null;

-- ---------- 009 + 012: route_seq + stage guard (with logistics + split-load insert) ----------
alter table public.deliveries add column if not exists route_seq integer;

create or replace function public.guard_delivery_stage()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  r text := coalesce(public.current_user_role(), 'sales');
  old_stage text := case when TG_OP = 'UPDATE' then OLD.stage else null end;
  new_stage text := NEW.stage;
begin
  if auth.uid() is null then return NEW; end if;   -- SQL editor / service role
  if r = 'admin' then return NEW; end if;

  if TG_OP = 'INSERT' then
    -- Split-load remainder (the "b" order) is inserted directly, already in the flow.
    if NEW.order_suffix is not null then
      if r in ('warehouse','driver','logistics','manager') and new_stage in ('ready','approved','fulfilling') then
        return NEW;
      end if;
      raise exception 'Not allowed to create this split load';
    end if;
    -- Re-delivery: re-enters already approved/pending.
    if NEW.redelivery_of is not null then
      if r in ('warehouse','manager','driver') and new_stage in ('approved','pending') then return NEW; end if;
      raise exception 'Not allowed to log this re-delivery';
    end if;
    if r not in ('sales','driver') then raise exception 'Only sales or drivers can create orders'; end if;
    if new_stage not in ('draft','pending') then raise exception 'New orders start as draft or pending'; end if;
    return NEW;
  end if;

  -- UPDATE with no stage change: role-appropriate field edits.
  if new_stage is not distinct from old_stage then
    if r in ('sales','driver') and old_stage in ('draft','pending','rejected') then return NEW; end if;
    if r = 'manager' then return NEW; end if;
    if r = 'warehouse'  and old_stage in ('approved','fulfilling','ready','picked_up','delivered') then return NEW; end if;
    if r = 'logistics'  and old_stage in ('approved','fulfilling','ready') then return NEW; end if;
    raise exception 'You cannot edit an order in the % stage', old_stage;
  end if;

  -- Stage transitions.
  if r in ('sales','driver') then
    if (old_stage = 'draft'    and new_stage = 'pending')
    or (old_stage = 'pending'  and new_stage = 'draft')
    or (old_stage = 'rejected' and new_stage = 'pending')
    or (old_stage = 'draft'    and new_stage = 'canceled')
    or (old_stage = 'rejected' and new_stage = 'canceled')
    or (r = 'driver' and old_stage = 'ready'     and new_stage = 'picked_up')
    or (r = 'driver' and old_stage = 'picked_up' and new_stage = 'delivered')
    or (r = 'driver' and old_stage = 'picked_up' and new_stage = 'ready') then
      return NEW;
    end if;
    raise exception '% cannot move an order from % to %', r, old_stage, new_stage;
  elsif r = 'manager' then
    if (old_stage = 'pending'  and new_stage = 'approved')
    or (old_stage = 'pending'  and new_stage = 'rejected')
    or (old_stage = 'approved' and new_stage = 'pending') then return NEW; end if;
    raise exception 'Manager cannot move an order from % to %', old_stage, new_stage;
  elsif r = 'warehouse' then
    if (old_stage = 'approved'   and new_stage = 'fulfilling')
    or (old_stage = 'fulfilling' and new_stage = 'ready')
    or (old_stage = 'ready'      and new_stage = 'picked_up')
    or (old_stage = 'picked_up'  and new_stage = 'delivered')
    or (old_stage = 'ready'      and new_stage = 'fulfilling')
    or (old_stage = 'picked_up'  and new_stage = 'ready')
    or (old_stage = 'delivered'  and new_stage = 'picked_up') then return NEW; end if;
    raise exception 'Warehouse cannot move an order from % to %', old_stage, new_stage;
  end if;

  raise exception 'Not allowed';
end $$;

drop trigger if exists deliveries_guard_stage on public.deliveries;
create trigger deliveries_guard_stage before insert or update on public.deliveries
  for each row execute function public.guard_delivery_stage();

-- ---------- 010: driver capacity ----------
alter table public.settings add column if not exists driver_capacity jsonb default '{}'::jsonb;

-- ---------- 011 + 015: role-scoped read (drivers own-only, warehouse approved+) ----------
drop policy if exists "auth read deliveries" on public.deliveries;
create policy "auth read deliveries" on public.deliveries
  for select to authenticated
  using (
    case (select role from public.profiles where id = auth.uid())
      when 'driver' then
        created_by = auth.uid()
        or assigned_driver = (select full_name from public.profiles where id = auth.uid())
      when 'warehouse' then
        stage in ('approved','fulfilling','ready','picked_up','delivered')
      else true
    end
  );

-- ---------- 012: split-load suffix ----------
alter table public.deliveries add column if not exists order_suffix text;

-- ---------- 013: single active device ----------
alter table public.profiles add column if not exists active_session_id text;

-- ---------- 014: fill every remaining column the code expects ----------
alter table public.deliveries
  add column if not exists prepared_status     text,
  add column if not exists status_temp         text,
  add column if not exists order_type          text,
  add column if not exists store               text,
  add column if not exists po2                 text,
  add column if not exists so_num              text,
  add column if not exists invoice_num         text,
  add column if not exists input_date          date,
  add column if not exists input_time          text,
  add column if not exists delivery_date       date,
  add column if not exists pickup_name         text,
  add column if not exists pickup_address      text,
  add column if not exists pickup_duration     text,
  add column if not exists delivery_fee        numeric,
  add column if not exists est_pallets         numeric,
  add column if not exists assigned_driver     text,
  add column if not exists delivery_duration   text,
  add column if not exists delivery_name       text,
  add column if not exists delivery_address    text,
  add column if not exists delivery_windows    text,
  add column if not exists account             text,
  add column if not exists contact             text,
  add column if not exists delivery_phone      text,
  add column if not exists delivery_notes      text,
  add column if not exists route_miles         numeric,
  add column if not exists route_duration      text,
  add column if not exists route_provider      text,
  add column if not exists route_traffic       boolean,
  add column if not exists pod_received_by     text,
  add column if not exists pod_signature       text,
  add column if not exists pod_delivered_at    timestamptz,
  add column if not exists photos              jsonb,
  add column if not exists pickup_lat          double precision,
  add column if not exists pickup_lng          double precision,
  add column if not exists pickup_gps_at       timestamptz,
  add column if not exists pod_lat             double precision,
  add column if not exists pod_lng             double precision,
  add column if not exists pod_accuracy        double precision,
  add column if not exists approved_by         uuid,
  add column if not exists approved_at         timestamptz;

-- Refresh PostgREST's schema cache so new columns are usable immediately.
notify pgrst, 'reload schema';
