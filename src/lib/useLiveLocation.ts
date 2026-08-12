"use client";

import { useEffect, useRef, useState } from "react";
import { useData } from "@/lib/data-provider";
import { shouldSend } from "@/lib/location-filter";

// ============================================================
// Shares the driver's position with the office WHILE THEY ARE ON SHIFT.
//
// Deliberately shift-bound: tracking starts at clock-in and stops at
// clock-out, so the app never records where someone is on their own time.
//
// In the browser this only runs while the page is open. The Android app
// (Capacitor) provides the same fixes from a foreground service, so it keeps
// reporting with the phone locked — it calls `submit` through the same bridge.
// ============================================================

export type LocationStatus = "off" | "starting" | "live" | "denied" | "unavailable";

/** Watch and report position while `active` is true. */
export function useLiveLocation(active: boolean): { status: LocationStatus; lastAt: string | null } {
  const { pushLocation } = useData();
  const [status, setStatus] = useState<LocationStatus>("off");
  const [lastAt, setLastAt] = useState<string | null>(null);
  const lastRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  // Keep the latest pushLocation without restarting the GPS watch on rerender.
  const pushRef = useRef(pushLocation);
  pushRef.current = pushLocation;

  useEffect(() => {
    if (!active) { setStatus("off"); lastRef.current = null; return; }
    if (typeof navigator === "undefined" || !navigator.geolocation) { setStatus("unavailable"); return; }

    setStatus("starting");
    let cancelled = false;

    const onFix = async (pos: GeolocationPosition) => {
      if (cancelled) return;
      setStatus("live");
      const now = Date.now();
      const c = pos.coords;
      if (!shouldSend({ lat: c.latitude, lng: c.longitude, accuracy: c.accuracy }, lastRef.current, now)) return;
      lastRef.current = { lat: c.latitude, lng: c.longitude, at: now };
      const ok = await pushRef.current({
        lat: c.latitude,
        lng: c.longitude,
        accuracy_m: c.accuracy ?? null,
        speed_mps: c.speed ?? null,
        heading: c.heading ?? null,
        recorded_at: new Date(pos.timestamp || now).toISOString(),
      });
      if (ok && !cancelled) setLastAt(new Date().toISOString());
    };

    const onErr = (err: GeolocationPositionError) => {
      if (cancelled) return;
      setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable");
    };

    const id = navigator.geolocation.watchPosition(onFix, onErr, {
      enableHighAccuracy: true,
      // A fix up to 20s old is fine — it avoids waking the GPS chip for every
      // callback, which is what actually drains a phone on a long route.
      maximumAge: 20_000,
      timeout: 30_000,
    });

    return () => { cancelled = true; navigator.geolocation.clearWatch(id); };
  }, [active]);

  return { status, lastAt };
}
