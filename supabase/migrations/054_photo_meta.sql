-- 054: Who took each photo.
--
-- `photos` is a list of URLs and nothing else, so a picture on an order has no
-- author. The activity log records that "photos" changed and by whom, but not
-- WHICH photo — with six pictures added over ten minutes there is no way to
-- attach a name to any one of them.
--
-- Stored beside the list rather than inside it: `photos` stays a plain array of
-- URLs, so every existing reader keeps working and photos taken before today
-- simply have no author instead of breaking.
--
-- Shape: { "<url>": { "by": "<uuid>", "at": "<iso>" } }
--
-- Safe to re-run.

alter table public.deliveries
  add column if not exists photo_meta jsonb;

comment on column public.deliveries.photo_meta is
  'Per-photo attribution keyed by URL: { url: { by: user uuid, at: iso } }. Absent for photos taken before this existed.';
