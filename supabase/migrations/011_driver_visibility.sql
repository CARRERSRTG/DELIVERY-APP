-- 011: Drivers may only read orders assigned to them (or that they created).
-- Everyone else keeps full read access. Run in the Supabase SQL Editor.

drop policy if exists "auth read deliveries" on public.deliveries;
create policy "auth read deliveries" on public.deliveries
  for select to authenticated
  using (
    (select role from public.profiles where id = auth.uid()) <> 'driver'
    or created_by = auth.uid()
    or assigned_driver = (select full_name from public.profiles where id = auth.uid())
  );
