"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMapInstance, Marker, Polyline } from "leaflet";

// ============================================================
// Thin wrapper around Leaflet (free OpenStreetMap tiles, no API key) — used
// by the dispatch map (color-coded points) and the "drop an exact pin"
// picker in the order form. Leaflet touches the DOM directly, so it's only
// ever imported inside useEffect (client-only, never during SSR).
// ============================================================

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  color: string;
  label: string;
  /** Shown inside the marker itself (e.g. a route stop number), not just on
   * hover — used by the route planner so a driver's stop order is visible
   * at a glance. Omit for a plain dot (the default everywhere else). */
  badge?: string;
  /** Faded back (low opacity) — used to push everything that isn't the
   * currently-focused driver into the background. */
  dimmed?: boolean;
}

/** A traced route — e.g. one driver's optimized stop-to-stop path. */
export interface MapLine {
  id: string;
  color: string;
  /** [lat, lng] pairs, in driving order, following actual roads. */
  positions: [number, number][];
  /** Dashed rendering — used for simulated/preview routes that aren't
   * committed yet, so they read as tentative next to the solid ones. */
  dashed?: boolean;
  /** Faded + thinned, so the focused route stands out over the rest. */
  dimmed?: boolean;
}

export function LeafletMap({
  points = [],
  lines = [],
  onPointClick,
  onLineClick,
  fitTo,
  center,
  zoom = 11,
  pickable = false,
  onPick,
  pickedPoint,
  height = 420,
}: {
  points?: MapPoint[];
  /** Route traces drawn under the pins (e.g. per-driver optimized paths). */
  lines?: MapLine[];
  onPointClick?: (id: string) => void;
  /** Click a traced route — used to focus that route's driver. */
  onLineClick?: (id: string) => void;
  /** Coordinates the map should frame; refits whenever this set changes. */
  fitTo?: [number, number][];
  center?: [number, number];
  zoom?: number;
  /** Click-to-place-a-pin mode (used by the manual location picker). */
  pickable?: boolean;
  onPick?: (lat: number, lng: number) => void;
  /** The currently-picked point, shown as its own marker in pickable mode. */
  pickedPoint?: [number, number] | null;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMapInstance | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const linesRef = useRef<Polyline[]>([]);
  const pickMarkerRef = useRef<Marker | null>(null);
  const hoverMarkerRef = useRef<Marker | null>(null);
  const fitSigRef = useRef<string>("");
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const onClickRef = useRef(onPointClick);
  onClickRef.current = onPointClick;
  const onLineClickRef = useRef(onLineClick);
  onLineClickRef.current = onLineClick;

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let map: LeafletMapInstance | null = null;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current) return;
      const fallback: [number, number] = [26.2034, -98.2300]; // Rio Grande Valley, TX
      const startCenter = center ?? (points[0] ? [points[0].lat, points[0].lng] as [number, number] : fallback);
      map = L.map(containerRef.current).setView(startCenter, zoom);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);
      mapRef.current = map;

      if (pickable) {
        // Hover shows a light preview of where the pin would land; a
        // right-click commits it. Two-handed but far less error-prone than
        // a plain left-click, which fires on every accidental click while
        // panning around to find the right spot.
        const previewIcon = L.divIcon({
          className: "",
          html: `<div style="font-size:28px;line-height:1;opacity:.45;transform:translate(-50%,-90%)">📍</div>`,
          iconSize: [0, 0],
        });
        map.on("mousemove", (e: { latlng: { lat: number; lng: number } }) => {
          if (hoverMarkerRef.current) hoverMarkerRef.current.setLatLng(e.latlng);
          else if (mapRef.current) hoverMarkerRef.current = L.marker(e.latlng, { icon: previewIcon, interactive: false }).addTo(mapRef.current);
        });
        map.on("mouseout", () => {
          hoverMarkerRef.current?.remove();
          hoverMarkerRef.current = null;
        });
        map.on("contextmenu", (e: { latlng: { lat: number; lng: number }; originalEvent?: MouseEvent }) => {
          e.originalEvent?.preventDefault?.();
          onPickRef.current?.(e.latlng.lat, e.latlng.lng);
        });
      }

      // Force a resize pass — Leaflet miscalculates tile bounds when its
      // container was hidden/zero-size at construction time (e.g. inside a
      // modal that just opened).
      setTimeout(() => map?.invalidateSize(), 50);
    })();
    return () => {
      cancelled = true;
      hoverMarkerRef.current?.remove();
      hoverMarkerRef.current = null;
      map?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the traced routes in sync with `lines`. Drawn each time so they
  // stay underneath the pins (markers are re-added after this runs). Dimmed
  // routes are drawn first so focused ones paint on top of them.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !mapRef.current) return;
      linesRef.current.forEach((l) => l.remove());
      linesRef.current = [];
      const ordered = [...lines].sort((a, b) => Number(!!b.dimmed) - Number(!!a.dimmed));
      for (const line of ordered) {
        if (line.positions.length < 2) continue;
        // A fat invisible line under each makes routes easy to click even
        // where they're thin or overlapping.
        const hit = L.polyline(line.positions, { color: line.color, weight: 18, opacity: 0 }).addTo(mapRef.current!);
        const poly = L.polyline(line.positions, {
          color: line.color,
          weight: line.dimmed ? 3 : 5,
          opacity: line.dimmed ? 0.25 : 0.9,
          dashArray: line.dashed ? "6 10" : undefined,
        }).addTo(mapRef.current!);
        const fire = () => onLineClickRef.current?.(line.id);
        hit.on("click", fire);
        poly.on("click", fire);
        if (onLineClickRef.current) { hit.getElement()?.setAttribute("style", "cursor:pointer"); }
        linesRef.current.push(hit, poly);
      }
    })();
    return () => { cancelled = true; };
  }, [lines]);

  // Reframe the map whenever the caller's focus set changes (e.g. selecting
  // a driver zooms to just their stops).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !mapRef.current || !fitTo || fitTo.length === 0) return;
      const sig = JSON.stringify(fitTo);
      if (sig === fitSigRef.current) return;
      fitSigRef.current = sig;
      const bounds = L.latLngBounds(fitTo.map((c) => L.latLng(c[0], c[1])));
      mapRef.current.fitBounds(bounds, { padding: [45, 45], maxZoom: 14, animate: true });
    })();
    return () => { cancelled = true; };
  }, [fitTo]);

  // Keep the colored fleet markers in sync with `points`.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !mapRef.current) return;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      // Dimmed pins first, so focused ones sit above them.
      const orderedPts = [...points].sort((a, b) => Number(!!b.dimmed) - Number(!!a.dimmed));
      for (const p of orderedPts) {
        // A badge (a stop number, or "P" for a pickup/base) → a proper
        // teardrop map pin with the label inside. No badge → a plain dot
        // (unassigned orders, and every other map in the app).
        const icon = p.badge
          ? L.divIcon({
              className: "",
              html: `<div style="width:30px;height:30px"><div style="width:26px;height:26px;transform:rotate(-45deg);background:${p.color};border:2px solid #fff;border-radius:50% 50% 50% 0;box-shadow:0 2px 5px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center"><span style="transform:rotate(45deg);color:#fff;font-weight:800;font-size:12px;font-family:sans-serif;line-height:1">${p.badge}</span></div></div>`,
              iconSize: [30, 30],
              iconAnchor: [13, 28],
            })
          : L.divIcon({
              className: "",
              html: `<div style="width:16px;height:16px;border-radius:50%;background:${p.color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5)"></div>`,
              iconSize: [16, 16],
              iconAnchor: [8, 8],
            });
        const marker = L.marker([p.lat, p.lng], { icon, opacity: p.dimmed ? 0.35 : 1, zIndexOffset: p.dimmed ? 0 : 500 }).addTo(mapRef.current!);
        marker.bindTooltip(p.label);
        marker.on("click", () => onClickRef.current?.(p.id));
        markersRef.current.push(marker);
      }
    })();
    return () => { cancelled = true; };
  }, [points]);

  // Keep the single "picked" marker in sync (manual pin picker mode).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !mapRef.current) return;
      pickMarkerRef.current?.remove();
      pickMarkerRef.current = null;
      if (pickedPoint) {
        const icon = L.divIcon({
          className: "",
          html: `<div style="font-size:28px;line-height:1;transform:translate(-50%,-90%)">📍</div>`,
          iconSize: [0, 0],
        });
        pickMarkerRef.current = L.marker(pickedPoint, { icon }).addTo(mapRef.current);
      }
    })();
    return () => { cancelled = true; };
  }, [pickedPoint]);

  return <div ref={containerRef} style={{ height, borderRadius: 12, border: "1px solid var(--line)" }} />;
}
