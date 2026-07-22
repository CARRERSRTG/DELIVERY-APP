"use client";

import { useEffect, useRef, useState } from "react";
import type { Delivery } from "@/lib/types";

/** Geocodes (and caches) any order missing a map pin but with an address —
 * sequential + slightly throttled, since the free OSM fallback provider
 * asks for at most ~1 request/second. Shared by the Map and Routes pages.
 * Returns how many geocodes are currently in flight (for a loading hint). */
export function useAutoGeocode(
  orders: Delivery[],
  updateDelivery: (id: string, patch: Partial<Delivery>) => Promise<boolean>,
): number {
  const [geocoding, setGeocoding] = useState(0);
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    const todo = orders.filter(
      (d) => d.delivery_lat == null && (d.delivery_address || "").trim() && !inFlight.current.has(d.id),
    );
    if (!todo.length) return;

    (async () => {
      for (const d of todo) {
        if (cancelled) return;
        inFlight.current.add(d.id);
        setGeocoding((n) => n + 1);
        try {
          const res = await fetch("/api/geocode-point", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ address: d.delivery_address }),
          });
          if (res.ok) {
            const point = await res.json();
            if (!cancelled) await updateDelivery(d.id, { delivery_lat: point.lat, delivery_lng: point.lng, delivery_pin_source: "geocoded" });
          }
        } catch { /* best-effort — a pin just won't appear for this one */ }
        inFlight.current.delete(d.id);
        setGeocoding((n) => n - 1);
        await new Promise((r) => setTimeout(r, 350));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders]);

  return geocoding;
}
