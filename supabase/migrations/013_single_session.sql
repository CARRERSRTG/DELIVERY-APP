-- 013: One active device per account. The app stamps the current session id
-- on the profile at load; other devices detect the change and sign out.

alter table public.profiles add column if not exists active_session_id text;
