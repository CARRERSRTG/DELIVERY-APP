-- 030: Support contact settings.
--
-- The Settings type has long referenced help_email, but the column was never
-- added — so saving it errored and it never persisted (it silently fell back to
-- DEFAULT_HELP_EMAIL). Adds both help_email and the new help_phone (shown as a
-- Call link on the Help button). Safe to re-run.

alter table public.settings add column if not exists help_email text;
alter table public.settings add column if not exists help_phone text;

notify pgrst, 'reload schema';
