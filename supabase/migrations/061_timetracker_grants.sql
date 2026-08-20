-- 061: GRANTs on the timetracker schema.
--
-- RLS policies (060) only decide which ROWS a query can see — Postgres still
-- checks plain GRANT privileges first, at the schema and table level, before
-- RLS ever runs. `create schema` grants nothing to anyone but the owner by
-- default. recruiting.* already has these grants (verified against
-- production: `has_schema_privilege('authenticated','recruiting','USAGE')`
-- = true, plus per-table grants and a default-privileges rule for future
-- tables) but that setup was done by hand at some point and was never
-- captured as its own migration — a gap in this repo's own history, not a
-- new decision. Reproducing the same shape for timetracker.*, but as an
-- actual migration file this time.

grant usage on schema timetracker to anon, authenticated, service_role;

grant all on all tables in schema timetracker to anon, authenticated, service_role;
grant all on all sequences in schema timetracker to anon, authenticated, service_role;
grant all on all functions in schema timetracker to anon, authenticated, service_role;

-- So a table added to timetracker.* LATER (a future migration) gets the same
-- grants automatically, without this file needing to be revisited.
alter default privileges in schema timetracker
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema timetracker
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema timetracker
  grant all on functions to anon, authenticated, service_role;
