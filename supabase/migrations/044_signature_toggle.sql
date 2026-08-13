-- 044: Turn the customer signature on or off.
--
-- Proof of delivery has two halves: the signature the customer draws, and the
-- photos of the material. `require_pod` already says whether SOME proof is
-- mandatory; this says whether the signature is offered at all.
--
-- Defaults to true, so nothing changes for anyone until an admin turns it off.
-- Safe to re-run.

alter table public.settings
  add column if not exists pod_signature_enabled boolean not null default true;
