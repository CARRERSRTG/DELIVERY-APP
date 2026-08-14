-- 047: Stop requiring proof of delivery.
--
-- With signatures off (046), `require_pod` could only be satisfied by a
-- material photo — and the delivery sheet that demanded one had no camera in
-- it. A driver typed the receiver's name, pressed Confirm, and nothing
-- happened, with no way forward from where he was standing.
--
-- The sheet now carries the camera (v1.3.4), so the requirement is at least
-- satisfiable. Turning it off is a separate, deliberate business call: the
-- office decided a photo on every stop is not worth the tap.
--
-- Nothing is deleted. Flip it back on in Settings and drivers are asked for a
-- photo again, this time with a camera in front of them.
-- Safe to re-run.

update public.settings set require_pod = false where require_pod;
