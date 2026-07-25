-- 018: Teaching mode is a fully open sandbox — every authenticated user can
-- read ALL training orders (is_training = true), bypassing the driver/warehouse
-- read restrictions. Real orders keep their role-scoped visibility. Re-runnable.

drop policy if exists "auth read deliveries" on public.deliveries;
create policy "auth read deliveries" on public.deliveries
  for select to authenticated
  using (
    is_training  -- open practice sandbox: everyone sees every training order
    or case (select role from public.profiles where id = auth.uid())
         when 'driver' then
           created_by = auth.uid()
           or assigned_driver = (select full_name from public.profiles where id = auth.uid())
         when 'warehouse' then
           stage in ('approved','fulfilling','ready','picked_up','delivered')
         else true
       end
  );
