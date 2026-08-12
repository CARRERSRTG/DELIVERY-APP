"use client";

import { useEffect, useState } from "react";
import type { StoreMarker } from "@/components/LeafletMap";
import type { NamedLocation } from "@/lib/types";

// Module-level cache (keyed by lowercased address) so a store's geocode is
// resolved once and shared across every map in the app, not redone per page.
const geoCache = new Map<string, [number, number]>();

/**
 * Resolve each store to a map coordinate so it can be drawn as a big red point.
 * A store with a verified lat/lng on its record is used directly; otherwise its
 * address is geocoded (throttled) and cached. Results publish progressively so
 * points appear as they resolve.
 */
export function useStoreMarkers(stores: NamedLocation[]): StoreMarker[] {
  const [markers, setMarkers] = useState<StoreMarker[]>([]);
  // Only re-run when the store list's identity (name/address/point) changes.
  const sig = stores.map((s) => `${s.name}|${s.address}|${s.lat ?? ""}|${s.lng ?? ""}`).join("~");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: StoreMarker[] = [];
      // First pass: everything we already know (verified point or cached geocode).
      for (const s of stores) {
        if (s.lat != null && s.lng != null) { out.push({ name: s.name, lat: s.lat, lng: s.lng }); continue; }
        const key = (s.address || "").trim().toLowerCase();
        if (key && geoCache.has(key)) { const [lat, lng] = geoCache.get(key)!; out.push({ name: s.name, lat, lng }); }
      }
      if (!cancelled) setMarkers([...out]);

      // Second pass: geocode any store still missing a point.
      for (const s of stores) {
        if (cancelled) return;
        if (s.lat != null && s.lng != null) continue;
        const key = (s.address || "").trim().toLowerCase();
        if (!key || geoCache.has(key)) continue;
        try {
          const res = await fetch("/api/geocode-point", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ address: s.address }),
          });
          if (res.ok) {
            const p = await res.json();
            if (typeof p?.lat === "number" && typeof p?.lng === "number") {
              geoCache.set(key, [p.lat, p.lng]);
              out.push({ name: s.name, lat: p.lat, lng: p.lng });
              if (!cancelled) setMarkers([...out]);
            }
          }
        } catch { /* skip a store that won't geocode */ }
        await new Promise((r) => setTimeout(r, 120));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  return markers;
}
