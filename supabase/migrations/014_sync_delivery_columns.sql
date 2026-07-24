-- ============================================================
-- Migration 014: sync the deliveries table with every column the
-- app code expects. Fixes "Could not find the 'delivery_fee' column
-- of 'deliveries' in the schema cache" (order creation failing).
--
-- Every statement is `add column if not exists`, so this is safe to
-- run even if some columns already exist — it only fills the gaps.
-- Run once in Supabase → SQL Editor.
-- ============================================================

alter table public.deliveries
  -- workflow / linkage
  add column if not exists order_suffix        text,
  add column if not exists redelivery_of       uuid,
  add column if not exists redelivery_reason   text,

  -- core order data
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

  -- pickup
  add column if not exists pickup_name         text,
  add column if not exists pickup_address      text,
  add column if not exists pickup_duration     text,

  -- pallets + money
  add column if not exists delivery_fee        numeric,
  add column if not exists est_pallets         numeric,
  add column if not exists actual_pallets      numeric,

  -- driver / routing
  add column if not exists assigned_driver     text,
  add column if not exists route_seq           integer,
  add column if not exists delivery_duration   text,

  -- delivery destination
  add column if not exists delivery_name       text,
  add column if not exists delivery_address    text,
  add column if not exists delivery_windows    text,
  add column if not exists account             text,
  add column if not exists contact             text,
  add column if not exists delivery_phone      text,
  add column if not exists delivery_notes      text,

  -- computed route
  add column if not exists route_miles         numeric,
  add column if not exists route_duration      text,
  add column if not exists route_provider      text,
  add column if not exists route_traffic       boolean,

  -- proof of delivery
  add column if not exists pod_received_by     text,
  add column if not exists pod_signature       text,
  add column if not exists pod_delivered_at    timestamptz,
  add column if not exists photos              jsonb,

  -- GPS stamps
  add column if not exists pickup_lat          double precision,
  add column if not exists pickup_lng          double precision,
  add column if not exists pickup_gps_at       timestamptz,
  add column if not exists pod_lat             double precision,
  add column if not exists pod_lng             double precision,
  add column if not exists pod_accuracy        double precision,
  add column if not exists delivery_lat        double precision,
  add column if not exists delivery_lng        double precision,
  add column if not exists delivery_pin_source text,

  -- ownership / audit
  add column if not exists assigned_sales_rep  uuid,
  add column if not exists approved_by         uuid,
  add column if not exists approved_at         timestamptz;

-- Tell PostgREST to refresh its schema cache immediately so the new
-- columns are usable without waiting for the periodic reload.
notify pgrst, 'reload schema';
