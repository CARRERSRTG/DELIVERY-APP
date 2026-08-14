-- 046: The customer signature is OFF by default.
--
-- 044 shipped it on, which was the safe way to introduce it — nothing changed
-- for anyone until an admin opted out. In practice most deliveries here don't
-- need a drawn signature, and an empty signature box between the driver and
-- "delivered" is friction on every single stop.
--
-- With this off, pressing Delivered records the stop in one tap: time, GPS and
-- the driver. An admin turning it back on in Settings restores the name +
-- signature sheet.
--
-- `require_pod` is untouched: an office that demands proof still gets it (a
-- material photo), and the delivery is still blocked without it.
-- Safe to re-run.

alter table public.settings
  alter column pod_signature_enabled set default false;

update public.settings set pod_signature_enabled = false where pod_signature_enabled;
