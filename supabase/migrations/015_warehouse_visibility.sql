-- 015: Warehouse may only read orders that have been approved (approved,
-- fulfilling, ready, picked_up, delivered) — never draft/pending/rejected/
-- canceled. Drivers keep their own-orders-only rule; everyone else reads all.
-- Run in the Supabase SQL Editor (or it's applied by the runner).

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
