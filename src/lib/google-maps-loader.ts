"use client";

// ============================================================
// Loads the Google Maps JavaScript API once per page.
//
// Every map in the app shares one script tag and one in-flight promise —
// loading it twice throws, and each load is billable, so this is deliberately
// a singleton.
//
// The key here is a BROWSER key and is visible to anyone who opens devtools.
// That's unavoidable with the Maps JS API, which is why it must be a SEPARATE,
// referrer-restricted key from the server-side one that pays for Routes and
// Geocoding. See mobile/README + .env.local.example.
// ============================================================

export const BROWSER_MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY ?? "";

/** Optional Cloud-styled Map ID. Advanced markers need one; without it the
 * map still renders and we fall back to classic markers. */
export const MAPS_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? "";

/** True when a browser key is configured — otherwise callers keep Leaflet. */
export function googleMapsEnabled(): boolean {
  return BROWSER_MAPS_KEY.length > 0;
}

let loadPromise: Promise<typeof google.maps> | null = null;

/** Resolve the Maps JS namespace, loading the script on first call. */
export function loadGoogleMaps(): Promise<typeof google.maps> {
  if (typeof window === "undefined") return Promise.reject(new Error("Maps JS is browser-only"));
  if (!BROWSER_MAPS_KEY) return Promise.reject(new Error("No browser Maps key configured"));
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    // Another bundle may have injected it already (e.g. a hot reload).
    if (window.google?.maps) { resolve(window.google.maps); return; }

    const params = new URLSearchParams({
      key: BROWSER_MAPS_KEY,
      v: "weekly",
      libraries: "marker,geometry",
      language: "es",
      region: "US",
      loading: "async",
    });
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      // Let the next caller retry — a failed load is usually a blocked
      // request or a restricted key, both of which can be fixed live.
      loadPromise = null;
      reject(new Error("Google Maps failed to load"));
    };
    script.onload = () => {
      if (window.google?.maps) resolve(window.google.maps);
      else { loadPromise = null; reject(new Error("Google Maps loaded without the maps namespace")); }
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}
