-- 057: RLS on recruiting.* — replaces "any authenticated" with
-- has_recruiting_access(). Same pattern on every table, no per-table
-- variation (D3: harden the module BOUNDARY, not internal tiers).
do $$
declare
  t text;
  tables text[] := array[
    'settings','questions','templates','custom_fields','question_sets',
    'candidates','contacts','jobs','stages','stage_history','attachments'
  ];
begin
  foreach t in array tables loop
    execute format('alter table recruiting.%I enable row level security', t);
    execute format('drop policy if exists "auth read %1$s"  on recruiting.%1$I', t);
    execute format('drop policy if exists "auth write %1$s" on recruiting.%1$I', t);
    execute format(
      'create policy "recruiting read %1$s" on recruiting.%1$I for select to authenticated using (public.has_recruiting_access())', t);
    execute format(
      'create policy "recruiting write %1$s" on recruiting.%1$I for all to authenticated using (public.has_recruiting_access()) with check (public.has_recruiting_access())', t);
  end loop;
end $$;

-- storage.objects for the "resumes" bucket — same guard.
-- (No-op locally: this rehearsal has no storage schema. Applied for real in
-- the actual deliveries project, which does.)
