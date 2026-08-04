-- 029: Estimate # for Transfer orders + docRef "estimate".
--
-- Transfer (branch-to-branch) uses a single internal Estimate # instead of the
-- customer Invoice / PO / SO trio. Adds the column and switches Transfer's
-- document-reference rule to "estimate" (which shows one optional Estimate #
-- field). Idempotent. Applied live.

alter table public.deliveries add column if not exists estimate_num text;

update public.settings
set order_type_rules = jsonb_set(order_type_rules, '{Transfer,docRef}', '"estimate"')
where id = 1;

notify pgrst, 'reload schema';
