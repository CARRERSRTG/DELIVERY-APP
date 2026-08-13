"use client";

import { useEffect, useRef, useState } from "react";
import { useData } from "@/lib/data-provider";
import { shouldSend, MIN_MOVE_M } from "@/lib/location-filter";
import { isNativeApp, startNativeWatch, type NativeFix } from "@/lib/native-bridge";

// ============================================================
// Shares the driver's position with the office WHILE THEY ARE ON SHIFT.
//
// Deliberately shift-bound: tracking starts at clock-in and stops at
// clock-out, so the app never records where someone is on their own time.
//
// Inside the driver APK this runs through Android's foreground service, so it
// keeps reporting with the phone locked in the truck — and Android shows a
// permanent notification the whole time. In a plain browser it falls back to
// the page's own geolocation, which only runs while the app is open.
// ============================================================

export type LocationStatus = "off" | "starting" | "live" | "denied" | "unavailable";

/** Watch and report position while `active` is true. */
export function useLiveLocation(active: boolean): { status: LocationStatus; lastAt: string | null; native: boolean } {
  const { pushLocation } = useData();
  const [status, setStatus] = useState<LocationStatus>("off");
  const [lastAt, setLastAt] = useState<string | null>(null);
  const [native, setNative] = useState(false);
  const lastRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  // Keep the latest pushLocation without restarting the GPS watch on rerender.
  const pushRef = useRef(pushLocation);
  pushRef.current = pushLocation;

  useEffect(() => {
    if (!active) { setStatus("off"); lastRef.current = null; return; }

    let cancelled = false;
    let stopNative: (() => void) | null = null;
    let browserWatchId: number | null = null;

    // Shared by both sources: filter, then write.
    const report = async (fix: NativeFix) => {
      if (cancelled) return;
      setStatus("live");
      const now = Date.now();
      if (!shouldSend({ lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy_m }, lastRef.current, now)) return;
      lastRef.current = { lat: fix.lat, lng: fix.lng, at: now };
      const ok = await pushRef.current(fix);
      if (ok && !cancelled) setLastAt(new Date().toISOString());
    };

    setStatus("starting");

    (async () => {
      // Preferred path: the APK's background service.
      if (isNativeApp()) {
        const stop = await startNativeWatch(
          (fix) => void report(fix),
          (_msg, denied) => { if (!cancelled) setStatus(denied ? "denied" : "unavailable"); },
          // Android forces a permanent notification for a background location
          // service and no app may suppress it, so this text is always visible
          // to the driver. Kept factual: the service does run for the duration
          // of the shift. Android additionally shows its own location indicator
          // in the status bar, independent of anything written here.
          {
            title: "RDZ Deliveries",
            message: "Turno en curso",
          },
          MIN_MOVE_M,
        );
        if (cancelled) { stop?.(); return; }
        if (stop) { stopNative = stop; setNative(true); return; }
        // No plugin despite being native — fall through to the browser API.
      }

      if (typeof navigator === "undefined" || !navigator.geolocation) {
        if (!cancelled) setStatus("unavailable");
        return;
      }
      browserWatchId = navigator.geolocation.watchPosition(
        (pos) => {
          const c = pos.coords;
          void report({
            lat: c.latitude,
            lng: c.longitude,
            accuracy_m: c.accuracy ?? null,
            speed_mps: c.speed ?? null,
            heading: c.heading ?? null,
            recorded_at: new Date(pos.timestamp || Date.now()).toISOString(),
          });
        },
        (err) => { if (!cancelled) setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"); },
        {
          enableHighAccuracy: true,
          // A fix up to 20s old is fine — it avoids waking the GPS chip for
          // every callback, which is what actually drains a phone on a route.
          maximumAge: 20_000,
          timeout: 30_000,
        },
      );
    })();

    return () => {
      cancelled = true;
      stopNative?.();
      if (browserWatchId != null) navigator.geolocation.clearWatch(browserWatchId);
    };
  }, [active]);

  return { status, lastAt, native };
}
