// ============================================================
// One-shot GPS capture for delivery milestones (#4, "stamp" variant).
//
// Grabs the device's coordinates at the moment the driver presses Pick up /
// Mark delivered — no continuous tracking, so no battery drain and no
// background-tab problem.
//
// IMPORTANT: browsers only expose geolocation over HTTPS (localhost is exempt).
// On plain HTTP, or if the driver denies permission, this resolves to null —
// it must NEVER block the delivery from being recorded.
// ============================================================

export interface GeoStamp {
  lat: number;
  lng: number;
  accuracy: number | null;
  at: string;
}

/** True when the browser can actually give us a position (HTTPS or localhost). */
export function geoAvailable(): boolean {
  if (typeof window === "undefined" || !("geolocation" in navigator)) return false;
  return window.isSecureContext;
}

/**
 * Try to read the current position. Resolves to null on any failure
 * (insecure context, permission denied, timeout, no signal).
 */
export function captureLocation(timeoutMs = 8000): Promise<GeoStamp | null> {
  if (!geoAvailable()) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: GeoStamp | null) => { if (!settled) { settled = true; resolve(v); } };
    // Hard backstop: never hang the delivery flow waiting on a GPS fix.
    const timer = setTimeout(() => done(null), timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        done({
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
          accuracy: pos.coords.accuracy != null ? Math.round(pos.coords.accuracy) : null,
          at: new Date().toISOString(),
        });
      },
      () => { clearTimeout(timer); done(null); },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

/** Google Maps link for a captured point (used to review where a stop happened). */
export function mapLink(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/** Straight-line distance between two points, in metres (haversine). */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)));
}
