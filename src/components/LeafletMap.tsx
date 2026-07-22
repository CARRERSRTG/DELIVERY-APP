"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMapInstance, Marker } from "leaflet";

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
}

export function LeafletMap({
  points = [],
  onPointClick,
  center,
  zoom = 11,
  pickable = false,
  onPick,
  pickedPoint,
  height = 420,
}: {
  points?: MapPoint[];
  onPointClick?: (id: string) => void;
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
  const pickMarkerRef = useRef<Marker | null>(null);
  const hoverMarkerRef = useRef<Marker | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const onClickRef = useRef(onPointClick);
  onClickRef.current = onPointClick;

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

  // Keep the colored fleet markers in sync with `points`.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !mapRef.current) return;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      for (const p of points) {
        const size = p.badge ? 22 : 18;
        const icon = L.divIcon({
          className: "",
          html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${p.color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700;font-family:sans-serif">${p.badge ?? ""}</div>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        });
        const marker = L.marker([p.lat, p.lng], { icon }).addTo(mapRef.current!);
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
