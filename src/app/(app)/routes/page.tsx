"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { canPlanRoutes, stageInfo, stageLabel } from "@/lib/constants";
import { parseWindow, splitIntoTrips } from "@/lib/dispatch";
import { LeafletMap, type MapLine, type MapPoint } from "@/components/LeafletMap";
import { fallbackDriverColor, fmtDate, isOverdue, shiftDateISO, todayISO } from "@/lib/utils";
import { useAutoGeocode } from "@/lib/useAutoGeocode";
import type { Delivery } from "@/lib/types";

// ============================================================
// Logistics Manager tool: assign the day's approved-but-undelivered orders
// to a driver, then let the system work out the best visiting order for
// that driver's stops (a real routing solve via OSRM, not just a guess).
//
// Scope is deliberately just sequencing, not auto-assignment — a person
// still decides which driver takes which order; the system only decides
// the best order to run them in once that's settled.
//
// Each driver's truck has a pallet capacity. When their assigned stops add
// up to more than it can carry in one load, the route is split into
// several round trips — out to a batch of stops, back to the driver's home
// store to reload, out again — rather than one trip that assumes an
// infinitely large truck.
//
// The page is driven by a driver switcher: pick one driver to see just
// their pins, routes and truckloads (or "All" for the whole day at once).
// With a driver selected, adding an order first SIMULATES the resulting
// route (dashed trace + totals) and asks to confirm before assigning.
// ============================================================

const UNASSIGNED_COLOR = "#6b7686";
// Orders that need dispatching: approved but not yet picked up.
const ROUTE_STAGES: Delivery["stage"][] = ["approved", "fulfilling", "ready"];
// Used whenever a driver has no capacity set yet in Settings.
const DEFAULT_CAPACITY = 12;

// The day's routes are timed from this clock, with a reload buffer added at
// the pickup between truckloads. Service (unload) time per stop comes from
// the order's own delivery_duration.
const DAY_START_MIN = 8 * 60; // 08:00
const RELOAD_MIN = 20;

function fmtMinutes(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h} h ${rem} min` : `${h} h`;
}

function fmtClock(min: number): string {
  const total = Math.round(min);
  const h = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function serviceMin(d: Delivery): number {
  const m = String(d.delivery_duration ?? "").match(/\d+/);
  return m ? parseInt(m[0], 10) : 15;
}

function hexToHsl(hex: string): [number, number, number] {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16) / 255, g = parseInt(c.slice(2, 4), 16) / 255, b = parseInt(c.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const hx = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

// Truckload 1 keeps the driver's own color; later truckloads rotate the HUE
// far away (not a lighter shade), so each loop is an unmistakably different
// color from the driver's and from each other.
const HUE_OFFSETS = [150, 60, 240, 300, 120, 30, 210];

/** A distinctly different color per truckload. */
function tripColor(base: string, index: number): string {
  if (index === 0) return base;
  const [h, s] = hexToHsl(base);
  return hslToHex(h + HUE_OFFSETS[(index - 1) % HUE_OFFSETS.length], Math.max(0.6, s), 0.45);
}

/** One truckload's traced path, split so the delivery run and the empty
 * drive back to the pickup can be styled differently (solid vs dashed). */
interface TripTrace {
  delivery: [number, number][];
  ret: [number, number][];
}

/** A fully-solved (but not yet saved) plan for one driver's day. */
interface RoutePlan {
  orderedIds: string[];
  miles: number;
  seconds: number;
  traces: TripTrace[];
  trips: number;
  /** Estimated arrival time per stop id, "HH:MM". */
  etas: Record<string, string>;
}

export default function RoutesPage() {
  const { me, users, deliveries, settings, saveSettings, updateDelivery, ready } = useData();
  const { lang, t } = usePrefs();
  const [date, setDate] = useState(todayISO());
  // Which drivers are highlighted on the map / focused in the tables. Empty
  // set = "no drivers selected" → everything shown at full strength (like
  // OptimoRoute). Selecting some highlights them and dims the rest.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<"routes" | "orders">("routes");
  const [busyDriver, setBusyDriver] = useState<string | null>(null);
  const [routeInfo, setRouteInfo] = useState<Record<string, { miles: number; duration_text: string; trips: number }>>({});
  const [routeLines, setRouteLines] = useState<Record<string, TripTrace[]>>({});
  const [routeEtas, setRouteEtas] = useState<Record<string, Record<string, string>>>({});
  const [depotCoords, setDepotCoords] = useState<Record<string, [number, number]>>({});
  // A simulated "what if we add this order to this driver" plan, shown as a
  // dashed trace + totals until it's either confirmed (saved) or dismissed.
  const [preview, setPreview] = useState<{ orderId: string; orderNo: number; driver: string; plan: RoutePlan } | null>(null);
  const [previewBusy, setPreviewBusy] = useState<string | null>(null);
  const [optimizingAll, setOptimizingAll] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Which panels are collapsed — the unassigned pool ("__unassigned__") and
  // each driver (by name), so a busy board can be folded down to just the
  // one being worked on.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const isCollapsed = (id: string) => collapsed.has(id);
  const toggleCollapse = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // A newly-viewed date invalidates any optimize summary/trace from before.
  useEffect(() => { setRouteInfo({}); setRouteLines({}); setRouteEtas({}); setPreview(null); setErr(null); }, [date]);
  // Changing the driver selection drops any half-finished simulation.
  useEffect(() => { setPreview(null); }, [selected]);

  const focusOnly = (name: string) => setSelected(new Set([name]));
  const toggleDriver = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });

  // Viewing today also carries forward anything overdue that never went out —
  // logistics needs to see it to actually dispatch it, not just what's newly
  // due today. Browsing another date (planning ahead) shows only that date.
  const viewingToday = date === todayISO();
  const dayOrders = useMemo(
    () =>
      deliveries.filter((d) => {
        if (!ROUTE_STAGES.includes(d.stage)) return false;
        if (d.delivery_date === date) return true;
        return viewingToday && isOverdue(d);
      }),
    [deliveries, date, viewingToday],
  );

  // The one thing logistics can change on a carried-forward order: push its
  // delivery date up to today, or leave it — either way it's on this list.
  const reschedule = (id: string, delivery_date: string) => updateDelivery(id, { delivery_date });

  const geocoding = useAutoGeocode(dayOrders, updateDelivery);

  const drivers = useMemo(() => users.filter((u) => u.role === "driver"), [users]);
  const colorFor = (driver: string | null) => (driver ? settings.driver_colors?.[driver] || fallbackDriverColor(driver) : UNASSIGNED_COLOR);
  const capacityFor = (driver: string) => settings.driver_capacity?.[driver] ?? DEFAULT_CAPACITY;
  const setCapacity = (driver: string, capacity: number) => {
    clearRouteFor(driver);
    saveSettings({ driver_capacity: { ...(settings.driver_capacity ?? {}), [driver]: capacity } });
  };

  // A driver's route is a loop from the PICKUP point (where they load the
  // truck), out to the deliveries, and back to the pickup to reload for the
  // next truckload. The pickup is taken from the orders themselves (their
  // pickup_address / sold-from store), falling back to the driver's own
  // home store — whichever we can resolve.
  const pickupAddressFor = (driver: string): string | null => {
    const stops = byDriver.get(driver) ?? [];
    const counts = new Map<string, number>();
    for (const d of stops) {
      const a = (d.pickup_address || "").trim();
      if (a) counts.set(a, (counts.get(a) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestN = 0;
    for (const [a, n] of counts) if (n > bestN) { best = a; bestN = n; }
    if (best) return best;
    // No pickup address on the orders — fall back to a sold-from store's
    // address, then the driver's assigned home store.
    for (const d of stops) {
      const addr = settings.stores.find((s) => s.name === d.store)?.address;
      if (addr) return addr;
    }
    const profile = users.find((u) => u.full_name === driver);
    return profile?.store ? (settings.stores.find((s) => s.name === profile.store)?.address ?? null) : null;
  };

  // Geocode (and cache, keyed by the address string) a pickup/depot address.
  const getDepotCoords = async (address: string | null): Promise<[number, number] | null> => {
    const key = (address ?? "").trim();
    if (!key) return null;
    if (depotCoords[key]) return depotCoords[key];
    try {
      const res = await fetch("/api/geocode-point", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: key }),
      });
      if (!res.ok) return null;
      const point = await res.json();
      const coords: [number, number] = [point.lat, point.lng];
      setDepotCoords((p) => ({ ...p, [key]: coords }));
      return coords;
    } catch {
      return null;
    }
  };

  const unassigned = useMemo(
    () => dayOrders.filter((d) => !d.assigned_driver).sort((a, b) => a.order_no - b.order_no),
    [dayOrders],
  );

  // Each driver's stops for the day, in their current sequence (optimized
  // order first, unsequenced ones after — same rule as the Driver page).
  const byDriver = useMemo(() => {
    const map = new Map<string, Delivery[]>();
    for (const d of dayOrders) {
      if (!d.assigned_driver) continue;
      const list = map.get(d.assigned_driver) ?? [];
      list.push(d);
      map.set(d.assigned_driver, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (a.route_seq != null && b.route_seq != null) return a.route_seq - b.route_seq;
        if (a.route_seq != null) return -1;
        if (b.route_seq != null) return 1;
        return a.order_no - b.order_no;
      });
    }
    return map;
  }, [dayOrders]);

  // A driver's stops changed, so any earlier optimize summary/trace (and any
  // in-flight simulation) is stale — drop it rather than show a route that
  // no longer matches.
  const clearRouteFor = (driver: string) => {
    setRouteInfo((p) => { const { [driver]: _drop, ...rest } = p; return rest; });
    setRouteLines((p) => { const { [driver]: _drop, ...rest } = p; return rest; });
    setRouteEtas((p) => { const { [driver]: _drop, ...rest } = p; return rest; });
    setPreview(null);
  };
  const assignTo = (id: string, driver: string) => {
    clearRouteFor(driver);
    return updateDelivery(id, { assigned_driver: driver || null, route_seq: null });
  };
  const unassign = (id: string) => {
    const d = dayOrders.find((x) => x.id === id);
    if (d?.assigned_driver) clearRouteFor(d.assigned_driver);
    return updateDelivery(id, { assigned_driver: null, route_seq: null });
  };

  /** Solve a driver's full day for the given stop list — capacity-split
   * round trips out from the pickup point and back — WITHOUT saving
   * anything. Both the real "Optimize route" and the add-order simulation
   * run through this. `extraStops` lets the simulation include an order
   * that isn't assigned to the driver yet, so its pickup counts too. */
  const computeRoute = async (driver: string, stopList: Delivery[]): Promise<RoutePlan> => {
    // Earliest delivery window first (OSRM only supports a fixed start for
    // the trip solver — see /api/optimize-route); everything after that is
    // freely reordered within its trip for the shortest drive.
    const sorted = stopList
      .filter((d) => d.delivery_lat != null && d.delivery_lng != null)
      .sort((a, b) => (parseWindow(a.delivery_windows)?.[0] ?? Infinity) - (parseWindow(b.delivery_windows)?.[0] ?? Infinity));

    // The loop's anchor: pickup on the orders, else the driver's home store.
    const pickupAddr = (() => {
      const counts = new Map<string, number>();
      for (const d of sorted) { const a = (d.pickup_address || "").trim(); if (a) counts.set(a, (counts.get(a) ?? 0) + 1); }
      let best: string | null = null, bestN = 0;
      for (const [a, n] of counts) if (n > bestN) { best = a; bestN = n; }
      if (best) return best;
      for (const d of sorted) { const addr = settings.stores.find((s) => s.name === d.store)?.address; if (addr) return addr; }
      const profile = users.find((u) => u.full_name === driver);
      return profile?.store ? (settings.stores.find((s) => s.name === profile.store)?.address ?? null) : null;
    })();
    const depot = await getDepotCoords(pickupAddr);
    // No pickup we can geocode — fall back to one open (one-way) route.
    const batches = depot ? splitIntoTrips(sorted, capacityFor(driver)) : [sorted];
    const byId = new Map(sorted.map((d) => [d.id, d]));

    let miles = 0;
    let seconds = 0;
    const orderedIds: string[] = [];
    const traces: TripTrace[] = [];
    const etas: Record<string, string> = {};
    let clock = DAY_START_MIN; // arrival clock, continuous across truckloads

    for (const batch of batches) {
      if (!batch.length) continue;
      if (batch.length < 2 && !depot) {
        // A single leftover stop with no depot to round-trip from — nothing
        // to optimize between, it just goes next.
        orderedIds.push(batch[0].id);
        continue;
      }
      const stopsForCall = depot
        ? [{ id: "__depot__", lat: depot[0], lng: depot[1] }, ...batch.map((d) => ({ id: d.id, lat: d.delivery_lat!, lng: d.delivery_lng! }))]
        : batch.map((d) => ({ id: d.id, lat: d.delivery_lat!, lng: d.delivery_lng! }));
      const res = await fetch("/api/optimize-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stops: stopsForCall, roundtrip: !!depot }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Route optimization failed");
      const stopIds = (data.order as string[]).filter((id) => id !== "__depot__");
      const legs = (data.legs ?? []) as number[];
      orderedIds.push(...stopIds);
      miles += data.miles;
      seconds += data.duration_seconds;

      // Split the loop geometry into the delivery run and the empty drive back
      // to the pickup. The return leg starts at the last stop, so find where
      // the path is closest to it (searching from the end) and cut there.
      const geom = (data.geometry as [number, number][]).map(([lng, lat]) => [lat, lng] as [number, number]);
      const lastStop = depot && stopIds.length ? byId.get(stopIds[stopIds.length - 1]) : undefined;
      if (lastStop?.delivery_lat != null && lastStop.delivery_lng != null && geom.length > 2) {
        let cut = geom.length - 1, best = Infinity;
        for (let k = geom.length - 1; k >= 1; k--) {
          const dLat = geom[k][0] - lastStop.delivery_lat, dLng = geom[k][1] - lastStop.delivery_lng;
          const d2 = dLat * dLat + dLng * dLng;
          if (d2 < best) { best = d2; cut = k; }
        }
        traces.push({ delivery: geom.slice(0, cut + 1), ret: geom.slice(cut) });
      } else {
        traces.push({ delivery: geom, ret: [] });
      }

      // Walk the legs into per-stop arrival clocks. With a depot the trip is
      // [depot, s1, …, sN] so leg k drives INTO stop k; without one the first
      // stop is the start (no lead-in drive).
      for (let j = 0; j < stopIds.length; j++) {
        if (depot || j > 0) clock += (legs[depot ? j : j - 1] ?? 0) / 60;
        etas[stopIds[j]] = fmtClock(clock);
        const stop = byId.get(stopIds[j]);
        if (stop) clock += serviceMin(stop);
      }
      if (depot) {
        clock += (legs[stopIds.length] ?? 0) / 60; // drive back to pickup
        clock += RELOAD_MIN;                        // reload for the next load
      }
    }

    return { orderedIds, miles: Math.round(miles * 10) / 10, seconds, traces, trips: batches.length, etas };
  };

  /** Save a solved plan as the driver's actual route. */
  const applyPlan = async (driver: string, plan: RoutePlan) => {
    await Promise.all(plan.orderedIds.map((id, i) => updateDelivery(id, { route_seq: i })));
    setRouteInfo((p) => ({ ...p, [driver]: { miles: plan.miles, duration_text: fmtMinutes(plan.seconds / 60), trips: plan.trips } }));
    setRouteLines((p) => ({ ...p, [driver]: plan.traces }));
    setRouteEtas((p) => ({ ...p, [driver]: plan.etas }));
  };

  const optimize = async (driver: string) => {
    const stops = byDriver.get(driver) ?? [];
    if (stops.length < 1) return;
    setBusyDriver(driver);
    setPreview(null);
    setErr(null);
    try {
      await applyPlan(driver, await computeRoute(driver, stops));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyDriver(null);
    }
  };

  // Solve every driver's route in one go so the whole board lights up at
  // once. Sequential + gently throttled — the free OSRM server asks for no
  // more than ~1 request/second.
  const optimizeAll = async () => {
    const withStops = drivers.filter((u) => (byDriver.get(u.full_name) ?? []).length > 0);
    if (!withStops.length) return;
    setOptimizingAll(true);
    setPreview(null);
    setErr(null);
    for (const u of withStops) {
      setBusyDriver(u.full_name);
      try {
        await applyPlan(u.full_name, await computeRoute(u.full_name, byDriver.get(u.full_name) ?? []));
      } catch (e) {
        setErr((e as Error).message);
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    setBusyDriver(null);
    setOptimizingAll(false);
  };

  /** Simulate adding an unassigned order to the selected driver's day —
   * shows the would-be route (dashed) and totals without saving anything. */
  const previewAdd = async (d: Delivery, driver: string) => {
    if (d.delivery_lat == null || d.delivery_lng == null) {
      setErr(t("That order has no address pin yet, so its route can't be simulated.", "Esa orden aún no tiene pin de dirección, así que su ruta no se puede simular."));
      return;
    }
    setPreviewBusy(d.id);
    setErr(null);
    try {
      const plan = await computeRoute(driver, [...(byDriver.get(driver) ?? []), d]);
      setPreview({ orderId: d.id, orderNo: d.order_no, driver, plan });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setPreviewBusy(null);
    }
  };

  const confirmPreview = async () => {
    if (!preview) return;
    const { orderId, driver, plan } = preview;
    setPreview(null);
    await updateDelivery(orderId, { assigned_driver: driver });
    await applyPlan(driver, plan);
  };

  // Manual nudge — only offered once every stop already has a computed
  // sequence, so swapping two positions can't collide with an unset one.
  const move = async (driver: string, index: number, dir: -1 | 1) => {
    const list = byDriver.get(driver) ?? [];
    const j = index + dir;
    if (j < 0 || j >= list.length) return;
    const a = list[index], b = list[j];
    // The traced path/distance were computed for the old order — a manual
    // nudge no longer matches them, so drop both rather than mislead.
    clearRouteFor(driver);
    await Promise.all([
      updateDelivery(a.id, { route_seq: b.route_seq }),
      updateDelivery(b.id, { route_seq: a.route_seq }),
    ]);
  };

  const focused = selected.size > 0;
  const isDim = (driver: string | null) => focused && !!driver && !selected.has(driver);

  // Resolve every driver's pickup point up front, so the map can show each
  // as its loop's start/end pin even before a route's been optimized.
  useEffect(() => {
    for (const u of drivers) {
      if ((byDriver.get(u.full_name) ?? []).length) getDepotCoords(pickupAddressFor(u.full_name));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byDriver, settings.stores]);

  // Selecting a driver auto-draws their route: if they have stops but no
  // computed route yet, optimize it so the traced line + times appear right
  // away. One at a time (re-runs as each finishes), gentle on the router.
  useEffect(() => {
    if (busyDriver != null || optimizingAll) return;
    for (const name of selected) {
      if ((byDriver.get(name)?.length ?? 0) >= 1 && !routeInfo[name]) { optimize(name); return; }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, routeInfo, busyDriver, optimizingAll]);

  // The whole day is always on the map — a driver focus dims the rest rather
  // than hiding it, so the full picture stays visible.
  const points: MapPoint[] = useMemo(() => {
    const pts: MapPoint[] = [];
    for (const d of dayOrders) {
      if (d.delivery_lat == null || d.delivery_lng == null) continue;
      if (!d.assigned_driver) {
        pts.push({ id: d.id, lat: d.delivery_lat, lng: d.delivery_lng, color: UNASSIGNED_COLOR, label: `#${d.order_no} — ${t("Unassigned", "Sin asignar")}`, dimmed: focused });
        continue;
      }
      const list = byDriver.get(d.assigned_driver) ?? [];
      const idx = list.findIndex((x) => x.id === d.id);
      const badge = d.route_seq != null ? String(idx + 1) : undefined;
      pts.push({
        id: d.id,
        lat: d.delivery_lat,
        lng: d.delivery_lng,
        color: colorFor(d.assigned_driver),
        badge,
        label: `#${d.order_no} — ${d.assigned_driver}${badge ? ` (${t("Stop", "Parada")} ${badge})` : ""}`,
        dimmed: isDim(d.assigned_driver),
      });
    }
    // Pickup / base pin ("P") for each driver that has one resolved.
    for (const u of drivers) {
      if (!(byDriver.get(u.full_name) ?? []).length) continue;
      const addr = (pickupAddressFor(u.full_name) ?? "").trim();
      const coords = addr ? depotCoords[addr] : undefined;
      if (!coords) continue;
      pts.push({
        id: `__depot__${u.id}`,
        lat: coords[0],
        lng: coords[1],
        color: colorFor(u.full_name),
        badge: "P",
        label: `${t("Pickup / base", "Recolección / base")} (${u.full_name}) — ${addr}`,
        dimmed: isDim(u.full_name),
      });
    }
    return pts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayOrders, byDriver, settings.driver_colors, selected, depotCoords, drivers]);

  // Every optimized driver's routes are always drawn; a focus just dims the
  // others. Clicking a route focuses its driver (see onLineClick below).
  const lines: MapLine[] = useMemo(() => {
    const entries = Object.entries(routeLines);
    // Fan the routes out with a small perpendicular offset each, so where two
    // run along the same road they sit side by side rather than on top of
    // each other. Centered so the spread stays close to the actual road.
    const total = entries.reduce((n, [, trips]) => n + trips.length, 0);
    const spacing = 5;
    const center = (total - 1) / 2;
    const out: MapLine[] = [];
    let idx = 0;
    for (const [driver, trips] of entries) {
      trips.forEach((trace, i) => {
        const color = tripColor(colorFor(driver), i);
        const dimmed = isDim(driver);
        const offset = (idx - center) * spacing;
        // Delivery run: solid. Empty drive back to the pickup: dashed.
        out.push({ id: `line:${driver}#${i}`, color, positions: trace.delivery, dimmed, offset });
        if (trace.ret.length > 1) out.push({ id: `ret:${driver}#${i}`, color, positions: trace.ret, dimmed, dashed: true, offset });
        idx++;
      });
    }
    if (preview) {
      const color = colorFor(preview.driver);
      preview.plan.traces.forEach((trace, i) => {
        out.push({ id: `preview:${i}`, color, positions: trace.delivery, dashed: true });
        if (trace.ret.length > 1) out.push({ id: `pret:${i}`, color, positions: trace.ret, dashed: true });
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeLines, selected, preview, settings.driver_colors]);

  const onLineClick = (id: string) => {
    const m = id.match(/^(?:line|ret):(.+)#\d+$/);
    if (m) focusOnly(m[1]);
  };

  // What the map frames: the selected drivers' stops + pickups when any are
  // focused, otherwise the whole day.
  const fitTo: [number, number][] = useMemo(() => {
    if (!focused) return points.map((p) => [p.lat, p.lng] as [number, number]);
    const ids = new Set<string>();
    for (const name of selected) {
      for (const d of byDriver.get(name) ?? []) ids.add(d.id);
      const prof = users.find((u) => u.full_name === name);
      if (prof) ids.add(`__depot__${prof.id}`);
    }
    return points.filter((p) => ids.has(p.id)).map((p) => [p.lat, p.lng] as [number, number]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, selected]);

  if (!me) return null;
  if (!canPlanRoutes(me)) {
    return <div className="empty">{t("You don’t have access to route planning.", "No tienes acceso a la planificación de rutas.")}</div>;
  }

  const withStops = drivers.filter((u) => (byDriver.get(u.full_name) ?? []).length > 0);
  const shownDrivers = focused ? drivers.filter((u) => selected.has(u.full_name)) : withStops;
  // Simulating an add targets a driver, so it needs exactly one selected.
  const singleSel = selected.size === 1 ? [...selected][0] : null;
  const scheduledCount = dayOrders.length - unassigned.length;

  return (
    <>
      <div className="page-head">
        <h2>{t("Route Planning", "Planificación de Rutas")} <span className="count-tag">{dayOrders.length}</span></h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div className="viewtoggle">
            <button className="vt" onClick={() => setDate((d) => shiftDateISO(d, -1))} title={t("Previous day", "Día anterior")}>◀</button>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: "auto" }} />
            <button className="vt" onClick={() => setDate((d) => shiftDateISO(d, 1))} title={t("Next day", "Día siguiente")}>▶</button>
          </div>
          {date !== todayISO() && (
            <button className="btn btn-ghost btn-sm" onClick={() => setDate(todayISO())}>{t("Today", "Hoy")}</button>
          )}
          <button
            className="btn btn-primary btn-sm"
            disabled={optimizingAll || busyDriver != null || drivers.every((u) => (byDriver.get(u.full_name) ?? []).length === 0)}
            onClick={optimizeAll}
          >
            {optimizingAll ? `… ${t("Optimizing", "Optimizando")} ${busyDriver ?? ""}` : `🧭 ${t("Optimize all routes", "Optimizar todas las rutas")}`}
          </button>
          {geocoding > 0 && <span className="hint">{t("Locating addresses…", "Ubicando direcciones…")}</span>}
        </div>
      </div>

      {/* ---------- Stats strip ---------- */}
      <div className="card" style={{ display: "flex", padding: 0, overflow: "hidden", marginBottom: 14 }}>
        {[
          { n: scheduledCount, label: t("Scheduled", "Programadas") },
          { n: unassigned.length, label: t("Unscheduled", "Sin programar"), accent: true },
          { n: dayOrders.length, label: t("Total", "Total") },
          { n: withStops.length, label: t("Routes", "Rutas") },
        ].map((s, i) => (
          <div key={i} style={{ flex: 1, textAlign: "center", padding: "12px 8px", borderLeft: i ? "1px solid var(--line)" : undefined }}>
            <div style={{ fontFamily: "Archivo, sans-serif", fontSize: 22, fontWeight: 800, color: s.accent && s.n > 0 ? "var(--amber)" : "var(--text)" }}>{s.n}</div>
            <div className="hint" style={{ marginTop: 0 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {viewingToday && (
        <div className="hint" style={{ marginBottom: 8 }}>
          {t(
            "Today's list also carries forward any earlier order that's still not delivered — reschedule it (or leave its date as-is) and dispatch it today.",
            "La lista de hoy también arrastra cualquier orden anterior que aún no se ha entregado — reprograme su fecha (o déjela igual) y despáchela hoy.",
          )}
        </div>
      )}

      {err && <div className="hint" style={{ color: "var(--red)", marginBottom: 8 }}>⚠ {err}</div>}

      {/* ---------- Driver panel + map ---------- */}
      <div style={{ display: "flex", gap: 14, alignItems: "stretch", flexWrap: "wrap", marginBottom: 8 }}>
        <div className="card" style={{ flex: "1 1 250px", maxWidth: 340, margin: 0, padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--line)" }}>
            <b style={{ flex: 1 }}>🚚 {t("Drivers", "Choferes")}</b>
            {focused && <button className="notif-clear" onClick={() => setSelected(new Set())}>{t("Show all", "Mostrar todos")}</button>}
          </div>
          {drivers.length === 0 ? (
            <div className="empty">{t("No one has the Driver role yet.", "Nadie tiene el rol de Chofer todavía.")}</div>
          ) : (
            <div style={{ maxHeight: 470, overflowY: "auto" }}>
              {drivers.map((u) => {
                const stops = byDriver.get(u.full_name) ?? [];
                const info = routeInfo[u.full_name];
                const on = selected.has(u.full_name);
                return (
                  <div
                    key={u.id}
                    onClick={() => focusOnly(u.full_name)}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderTop: "1px solid var(--line)", cursor: "pointer", background: on ? "var(--accent-soft)" : undefined }}
                  >
                    <input type="checkbox" checked={on} onClick={(e) => e.stopPropagation()} onChange={() => toggleDriver(u.full_name)} style={{ width: 15, height: 15, flex: "0 0 auto" }} />
                    <span style={{ width: 12, height: 12, borderRadius: "50%", background: colorFor(u.full_name), flex: "0 0 auto", border: "2px solid #fff", boxShadow: "0 0 0 1px var(--line)" }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{u.full_name}</div>
                      <div className="hint" style={{ marginTop: 2, display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <span>⏱ {info?.duration_text ?? "—"}</span>
                        <span>📦 {stops.length}</span>
                        <span>⇥ {info ? `${info.miles} mi` : "—"}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="card" style={{ flex: "3 1 460px", margin: 0, padding: 0, overflow: "hidden" }}>
          <LeafletMap points={points} lines={lines} onLineClick={onLineClick} fitTo={fitTo} height={520} />
        </div>
      </div>
      <div className="hint" style={{ marginTop: 4, marginBottom: 14 }}>
        {t(
          "Every route is on the map at once. Click a route or a driver to highlight it (the rest dim and the map zooms in); check drivers to compare several. Each route loops from the pickup point (P) out and back. A dashed line is an unsaved simulation.",
          "Todas las rutas están en el mapa a la vez. Haz clic en una ruta o un chofer para resaltarla (el resto se atenúa y el mapa hace zoom); marca varios choferes para comparar. Cada ruta hace un ciclo desde el punto de recolección (P) y regresa. Una línea punteada es una simulación sin guardar.",
        )}
      </div>

      {/* ---------- Simulation banner ---------- */}
      {preview && (
        <div className="card" style={{ borderColor: colorFor(preview.driver) }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <b>
              🔮 {t(
                `Adding #${preview.orderNo} to ${preview.driver}:`,
                `Agregando #${preview.orderNo} a ${preview.driver}:`,
              )}
            </b>
            <span>
              <b>{preview.plan.miles} mi</b> · {fmtMinutes(preview.plan.seconds / 60)}
              {preview.plan.trips > 1 && ` · ${preview.plan.trips} ${t("truckloads", "viajes")}`}
            </span>
            {routeInfo[preview.driver] && (
              <span className="hint" style={{ marginTop: 0 }}>
                ({t("currently", "actualmente")} {routeInfo[preview.driver].miles} mi · {routeInfo[preview.driver].duration_text})
              </span>
            )}
            <span style={{ flex: 1 }} />
            <button className="btn btn-green btn-sm" onClick={confirmPreview}>✓ {t("Add to route", "Agregar a la ruta")}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setPreview(null)}>✕ {t("Cancel", "Cancelar")}</button>
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            {t(
              "The dashed line on the map is this simulated route — nothing is saved until you add it.",
              "La línea punteada en el mapa es esta ruta simulada — nada se guarda hasta que la agregue.",
            )}
          </div>
        </div>
      )}

      {/* ---------- Tabs ---------- */}
      <div className="viewtoggle" style={{ marginBottom: 12 }}>
        <button className={"vt " + (tab === "routes" ? "on" : "")} onClick={() => setTab("routes")}>🧭 {t("Routes", "Rutas")} ({withStops.length})</button>
        <button className={"vt " + (tab === "orders" ? "on" : "")} onClick={() => setTab("orders")}>📦 {t("Unassigned", "Sin asignar")} ({unassigned.length})</button>
      </div>

      {/* ---------- Unassigned pool ---------- */}
      {tab === "orders" && (
      <div className="card" style={{ margin: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }} onClick={() => toggleCollapse("__unassigned__")}>
          <button className="btn btn-ghost btn-sm" style={{ padding: "0 6px" }} title={t("Collapse", "Contraer")}>{isCollapsed("__unassigned__") ? "▸" : "▾"}</button>
          <h2 style={{ margin: 0 }}>📦 {t("Unassigned orders", "Órdenes sin asignar")}</h2>
          <span className="count-tag">{unassigned.length}</span>
        </div>
        {!isCollapsed("__unassigned__") && <>
        {singleSel && unassigned.length > 0 && (
          <p className="hint" style={{ marginTop: 8, marginBottom: 10 }}>
            {t(
              `Simulate adds a stop to ${singleSel}'s day and shows the resulting route before anything is saved.`,
              `Simular agrega una parada al día de ${singleSel} y muestra la ruta resultante antes de guardar nada.`,
            )}
          </p>
        )}
        {unassigned.length === 0 ? (
          <div className="empty">{t("Everything on this date has a driver.", "Todo en esta fecha ya tiene chofer.")}</div>
        ) : (
          <div className="tbl-scroll" style={{ border: "none" }}>
            <table className="orders" style={{ minWidth: 520 }}>
              <thead>
                <tr>
                  <th>{t("ID", "ID")}</th>
                  <th>{t("Account", "Cuenta")}</th>
                  <th>{t("Store", "Tienda")}</th>
                  <th>{t("Pallets", "Tarimas")}</th>
                  <th>{t("Delivery Date", "Fecha de Entrega")}</th>
                  <th>{t("Windows", "Ventanas")}</th>
                  <th>{t("Status", "Estado")}</th>
                  <th>{singleSel ? t("Add to", "Agregar a") : t("Assign to", "Asignar a")}</th>
                </tr>
              </thead>
              <tbody>
                {unassigned.map((d) => {
                  const s = stageInfo(d.stage);
                  return (
                    <tr key={d.id}>
                      <td className="ordno">#{d.order_no}</td>
                      <td>{d.account || "—"}</td>
                      <td>{d.store || "—"}</td>
                      <td>{d.actual_pallets ?? d.est_pallets ?? "—"}</td>
                      <td><DateCell d={d} date={date} onChange={reschedule} t={t} /></td>
                      <td>{d.delivery_windows || "—"}</td>
                      <td><span className="sema" style={{ background: s.color, color: "#fff" }}>{stageLabel(d.stage, lang)}</span></td>
                      <td>
                        {singleSel ? (
                          <button
                            className="btn btn-ghost btn-sm"
                            disabled={previewBusy === d.id || busyDriver != null}
                            onClick={() => previewAdd(d, singleSel)}
                          >
                            {previewBusy === d.id ? "…" : `🔮 ${t("Simulate add", "Simular")}`}
                          </button>
                        ) : (
                          <select defaultValue="" onChange={(e) => { if (e.target.value) assignTo(d.id, e.target.value); }} style={{ width: "auto" }}>
                            <option value="">{t("Select driver…", "Seleccione chofer…")}</option>
                            {drivers.map((u) => <option key={u.id} value={u.full_name}>{u.full_name}</option>)}
                          </select>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        </>}
      </div>
      )}

      {/* ---------- Per-driver routes ---------- */}
      {tab === "routes" && (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(440px, 1fr))", gap: 14, alignItems: "start" }}>
      {shownDrivers.length === 0 && (
        <div className="card" style={{ margin: 0 }}>
          <div className="empty">{t("No routes yet — assign orders to drivers in the Unassigned tab, or select drivers on the left.", "Aún sin rutas — asigna órdenes a los choferes en la pestaña Sin asignar, o selecciona choferes a la izquierda.")}</div>
        </div>
      )}
      {shownDrivers.map((u) => {
        const stops = byDriver.get(u.full_name) ?? [];
        const sequenced = stops.length > 0 && stops.every((d) => d.route_seq != null);
        const missingPins = stops.filter((d) => d.delivery_lat == null).length;
        const info = routeInfo[u.full_name];
        const capacity = capacityFor(u.full_name);
        const trips = splitIntoTrips(stops, capacity);
        const isC = isCollapsed(u.full_name);
        return (
          <div className="card" key={u.id} style={{ margin: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
              <button className="btn btn-ghost btn-sm" style={{ padding: "0 6px" }} onClick={() => toggleCollapse(u.full_name)} title={t("Collapse", "Contraer")}>{isC ? "▸" : "▾"}</button>
              <span style={{ width: 14, height: 14, borderRadius: "50%", background: colorFor(u.full_name), border: "2px solid #fff", boxShadow: "0 0 0 1px var(--line)", flex: "0 0 auto" }} />
              <h2 style={{ margin: 0 }}>{u.full_name}</h2>
              <span className="count-tag">{stops.length} {t("stops", "paradas")}</span>
              {stops.length > 0 && trips.length > 1 && (
                <span className="sema" style={{ background: "var(--amber)", color: "#fff" }}>{trips.length} {t("truckloads", "viajes")}</span>
              )}
              {info && <span className="hint" style={{ marginTop: 0 }}>· {info.miles} mi · {info.duration_text}</span>}
              <span style={{ flex: 1 }} />
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--gray)" }}>
                🚚 {t("Truck capacity", "Capacidad del camión")}
                <input
                  type="number" min={1} value={capacity}
                  onChange={(e) => { const v = Number(e.target.value); if (v > 0) setCapacity(u.full_name, v); }}
                  style={{ width: 60 }}
                />
                {t("plt", "trm")}
              </label>
              <button className="btn btn-primary btn-sm" disabled={stops.length < 2 || busyDriver === u.full_name} onClick={() => optimize(u.full_name)}>
                {busyDriver === u.full_name ? "…" : `🧭 ${t("Optimize route", "Optimizar ruta")}`}
              </button>
            </div>
            {!isC && <>
            {info && (
              <div className="hint" style={{ marginBottom: 8 }}>
                {t("Total (loop from pickup and back)", "Total (ciclo desde recolección y regreso)")}: <b>{info.miles} mi</b> · {info.duration_text}
                {info.trips > 1 && ` · ${info.trips} ${t("round trips back to pickup to reload", "viajes de ida y vuelta a recolección para recargar")}`}
              </div>
            )}
            {stops.length === 0 && (
              <div className="empty">
                {t("No stops yet — pick this driver and use “Simulate add” on an unassigned order above.", "Aún sin paradas — con este chofer seleccionado use “Simular” en una orden sin asignar arriba.")}
              </div>
            )}
            {!u.store && stops.length > 0 && trips.length > 1 && (
              <div className="hint" style={{ marginBottom: 8 }}>
                {t(
                  "This driver has no home store assigned (Users), so trips can't be anchored to a depot — optimizing will run one open route instead of round trips.",
                  "Este chofer no tiene tienda asignada (Usuarios), así que los viajes no pueden anclarse a un depósito — al optimizar se hará una sola ruta abierta en vez de viajes de ida y vuelta.",
                )}
              </div>
            )}
            {stops.length > 0 && !sequenced && (
              <div className="hint" style={{ marginBottom: 8 }}>
                {t("Not optimized yet — run “Optimize route” to get a sequence.", "Aún no optimizada — ejecute “Optimizar ruta” para obtener una secuencia.")}
              </div>
            )}
            {missingPins > 0 && (
              <div className="hint" style={{ marginBottom: 8 }}>
                {t(`${missingPins} stop(s) have no address pin yet, so they're left out of optimization.`, `${missingPins} parada(s) aún no tienen pin de dirección, así que se excluyen de la optimización.`)}
              </div>
            )}
            {stops.length > 0 && (
              <div className="tbl-scroll" style={{ border: "none" }}>
                <table className="orders" style={{ minWidth: 480 }}>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{t("ID", "ID")}</th>
                      <th>{t("Account", "Cuenta")}</th>
                      <th>{t("Address", "Dirección")}</th>
                      <th>{t("ETA", "Llegada")}</th>
                      <th>{t("Windows", "Ventanas")}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {trips.map((batch, ti) => {
                      const startIdx = trips.slice(0, ti).reduce((n, b) => n + b.length, 0);
                      const load = batch.reduce((n, d) => n + (d.actual_pallets ?? d.est_pallets ?? 0), 0);
                      const free = Math.max(0, capacity - load);
                      const tColor = tripColor(colorFor(u.full_name), ti);
                      return (
                        <Fragment key={ti}>
                          <tr>
                            <td colSpan={7} style={{ background: "var(--card-hover)", fontWeight: 700, fontSize: 12 }}>
                              <span style={{ display: "inline-block", width: 11, height: 11, borderRadius: 3, background: tColor, marginRight: 7, verticalAlign: "-1px", boxShadow: "0 0 0 1px var(--line)" }} />
                              🚚 {t("Truckload", "Viaje")} {ti + 1} — {load}/{capacity} {t("pallets", "tarimas")} · {t("loads at pickup ↺", "carga en recolección ↺")}
                              {free > 0 && <span style={{ color: "var(--green)", marginLeft: 6 }}>({free} {t("free", "libres")})</span>}
                            </td>
                          </tr>
                          {batch.map((d, bi) => {
                            const i = startIdx + bi;
                            return (
                              <tr key={d.id}>
                                <td style={{ borderLeft: `4px solid ${tColor}` }}>{d.route_seq != null ? i + 1 : "—"}</td>
                                <td className="ordno">#{d.order_no}</td>
                                <td>{d.account || "—"}</td>
                                <td>{d.delivery_address || "—"}</td>
                                <td style={{ fontWeight: 600 }}>{routeEtas[u.full_name]?.[d.id] ?? "—"}</td>
                                <td>{d.delivery_windows || "—"}</td>
                                <td style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                                  {sequenced && (
                                    <>
                                      <button className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => move(u.full_name, i, -1)} title={t("Move up", "Subir")}>↑</button>
                                      <button className="btn btn-ghost btn-sm" disabled={i === stops.length - 1} onClick={() => move(u.full_name, i, 1)} title={t("Move down", "Bajar")}>↓</button>
                                    </>
                                  )}
                                  <button className="btn btn-ghost btn-sm" onClick={() => unassign(d.id)} title={t("Unassign", "Quitar asignación")}>✕</button>
                                </td>
                              </tr>
                            );
                          })}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            </>}
          </div>
        );
      })}
      </div>
      )}

      {!ready && <div className="empty">{t("Loading…", "Cargando…")}</div>}
    </>
  );
}

/** Delivery date cell: plain text for an order due on the day being viewed;
 * an editable date input (with a "Late" flag) for one carried forward from
 * a past date that was never delivered — the one field logistics can change
 * here, and only here. Leaving it alone still dispatches it today. */
function DateCell({
  d, date, onChange, t,
}: {
  d: Delivery;
  date: string;
  onChange: (id: string, delivery_date: string) => void;
  t: (en: string, es: string) => string;
}) {
  if (d.delivery_date === date) return <>{fmtDate(d.delivery_date)}</>;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span className="sema" style={{ background: "var(--red)", color: "#fff" }}>{t("Late", "Atrasada")}</span>
      <input
        type="date"
        value={d.delivery_date ?? ""}
        onChange={(e) => e.target.value && onChange(d.id, e.target.value)}
        style={{ width: "auto" }}
      />
    </div>
  );
}
