-- ============================================================
-- Migration: stores & drivers become {name, address} lists
-- so each location is searchable by the routing/map engine.
-- Converts existing text[] values (names) into jsonb objects with
-- an empty address (fill them in from the Settings page afterward).
-- Run once in Supabase → SQL Editor. (schema.sql already jsonb for fresh installs.)
-- ============================================================

alter table public.settings
  alter column stores type jsonb using (
    coalesce(
      (select jsonb_agg(jsonb_build_object('name', s, 'address', '')) from unnest(stores) as s),
      '[]'::jsonb
    )
  );

alter table public.settings
  alter column drivers type jsonb using (
    coalesce(
      (select jsonb_agg(jsonb_build_object('name', d, 'address', '')) from unnest(drivers) as d),
      '[]'::jsonb
    )
  );

alter table public.settings alter column stores  set default '[]'::jsonb;
alter table public.settings alter column drivers set default '[]'::jsonb;
