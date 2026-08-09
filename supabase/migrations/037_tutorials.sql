-- Tutorials shown in the account view (admin-managed how-to videos, embedded
-- from external links). jsonb array of { id, title, description, url, added_by,
-- added_at }. Without this column saveSettings silently drops the list, so
-- tutorials wouldn't persist on the live site.
alter table public.settings
  add column if not exists tutorials jsonb not null default '[]'::jsonb;
