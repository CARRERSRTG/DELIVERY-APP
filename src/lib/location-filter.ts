// ============================================================
// Rules for which GPS fixes are worth sending to the server.
//
// Kept free of React so it can be tested on its own — and because these are
// the rules that decide a driver's battery life and how much position history
// the database carries. A phone reports a fix every second or two; almost all
// of them say nothing new.
// ============================================================

/** Don't write more often than this, however many fixes the phone offers. */
export const MIN_INTERVAL_MS = 25_000;
/** Coarser than this is a cell-tower guess, not a position — ignore it. */
export const MAX_ACCURACY_M = 200;
/** Below this the truck is parked and the GPS is just drifting. */
export const MIN_MOVE_M = 40;

/** Metres between two lat/lng points (haversine). */
export function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Is this fix worth a write? Too soon, too vague, or hasn't moved → no. */
export function shouldSend(
  fix: { lat: number; lng: number; accuracy?: number | null },
  last: { lat: number; lng: number; at: number } | null,
  now: number,
): boolean {
  if (fix.accuracy != null && fix.accuracy > MAX_ACCURACY_M) return false;
  if (!last) return true;
  if (now - last.at < MIN_INTERVAL_MS) return false;
  return metresBetween(last.lat, last.lng, fix.lat, fix.lng) >= MIN_MOVE_M;
}
