"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { canPlanRoutes, stageInfo, stageLabel } from "@/lib/constants";
import { autoAssign, parseWindow, splitIntoTrips, unavailableDriverNames } from "@/lib/dispatch";
import { LeafletMap, type MapLine, type MapPoint } from "@/components/LeafletMap";
import { DispatchBoard, type BoardColumn } from "@/components/DispatchBoard";
import { GanttTimeline, type GanttRow } from "@/components/GanttTimeline";
import { printRouteManifest } from "@/lib/manifest";
import { fallbackDriverColor, fmtDate, fmtWindows, isOverdue, orderLabel, shiftDateISO, todayISO } from "@/lib/utils";
import { useAutoGeocode } from "@/lib/useAutoGeocode";
import type { Delivery, Profile } from "@/lib/types";

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
// Distinct colors for multiple selected unassigned loads (route + pin).
const SEL_PALETTE = ["#2456c9", "#0f8a8a", "#d1782e", "#7c4dbc", "#1f9d61", "#d64545", "#e9a13b"];
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
  const { me, users, deliveries, settings, saveSettings, updateDelivery, addNote, notify, availability, ready } = useData();
  const { lang, t } = usePrefs();
  const [date, setDate] = useState(todayISO());
  // Which drivers are highlighted on the map / focused in the tables. Empty
  // set = "no drivers selected" → everything shown at full strength (like
  // OptimoRoute). Selecting some highlights them and dims the rest.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<"routes" | "orders" | "board" | "timeline">("routes");
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
  const [autoAssigning, setAutoAssigning] = useState(false);
  // Multi-select + search + saved filter for the unassigned pool.
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [orderSearch, setOrderSearch] = useState("");
  const [poolFilter, setPoolFilter] = useState<"all" | "overdue" | "noloc" | "windowed">("all");
  // Cached pickup→dropoff geometry for selected unassigned loads (drawn on the map).
  const [selRouteCache, setSelRouteCache] = useState<Record<string, [number, number][]>>({});
  // Geocoded pickup coords per selected load — lets us show a pickup "P" pin and
  // a straight PU→DEL line immediately, before (or if) the road geometry loads.
  const [selPickup, setSelPickup] = useState<Record<string, [number, number]>>({});
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

  // "Route buckets" — build routes before a real driver exists. Each bucket is a
  // pseudo-driver (its name lives in assigned_driver) so the whole route/optimize
  // machinery works on it; later the route is handed to an actual driver.
  const bucketNames = useMemo(
    () => (settings.route_buckets ?? []).filter((n) => !drivers.some((d) => d.full_name === n)),
    [settings.route_buckets, drivers],
  );
  const isBucket = (name: string) => bucketNames.includes(name);

  // ---- Loads: a driver can run several routes in a day, each a separate
  // truckload/trip. A "lane" is one such load (or a route bucket). Its KEY is
  // the grouping id: the plain driver name for load 1 (unchanged), or
  // "Driver#L2" for the 2nd load, etc. driverOf() strips it back to the name. ----
  const LANE_SEP = "#L";
  const driverOf = (key: string) => {
    const i = key.lastIndexOf(LANE_SEP);
    return i >= 0 && /^\d+$/.test(key.slice(i + LANE_SEP.length)) ? key.slice(0, i) : key;
  };
  const laneKeyFor = (driver: string, load: number) => (load > 1 ? `${driver}${LANE_SEP}${load}` : driver);
  const loadNoOf = (d: Delivery) => (d.load_no && d.load_no > 1 ? d.load_no : 1);
  const orderLaneKey = (d: Delivery): string | null => {
    if (!d.assigned_driver) return null;
    if (isBucket(d.assigned_driver)) return d.assigned_driver;
    return laneKeyFor(d.assigned_driver, loadNoOf(d));
  };

  interface Lane { id: string; key: string; driver: string; load: number; label: string; isBucket: boolean; store: string | null; }
  // Lanes = each real driver's load(s) + each bucket, used everywhere we DISPLAY
  // or build routes. Auto-assign still uses `drivers` only.
  const lanes = useMemo<Lane[]>(() => {
    const out: Lane[] = [];
    for (const dr of drivers) {
      const loads = new Set<number>([1]);
      for (const d of dayOrders) if (d.assigned_driver === dr.full_name) loads.add(loadNoOf(d));
      [...loads].sort((a, b) => a - b).forEach((load) => out.push({
        id: load > 1 ? `${dr.id}${LANE_SEP}${load}` : dr.id,
        key: laneKeyFor(dr.full_name, load),
        driver: dr.full_name,
        load,
        label: load > 1 ? `${dr.full_name} · ${t("Load", "Carga")} ${load}` : dr.full_name,
        isBucket: false,
        store: dr.store ?? null,
      }));
    }
    for (const n of bucketNames) out.push({ id: `bucket:${n}`, key: n, driver: n, load: 1, label: n, isBucket: true, store: null });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drivers, dayOrders, bucketNames, t]);

  // The next free load number for a driver: 1 if they have no work yet,
  // otherwise one past their highest current load.
  const nextLoadFor = (driver: string) => {
    let max = 0;
    for (const d of dayOrders) if (d.assigned_driver === driver) max = Math.max(max, loadNoOf(d));
    return max === 0 ? 1 : max + 1;
  };
  // Friendly display name for a lane key (e.g. "José · Load 2").
  const laneLabel = (key: string) => lanes.find((l) => l.key === key)?.label ?? key;

  const addBucket = (): string => {
    const existing = settings.route_buckets ?? [];
    let n = 1;
    while (existing.includes(`Route ${n}`) || drivers.some((d) => d.full_name === `Route ${n}`)) n++;
    const name = `Route ${n}`;
    saveSettings({ route_buckets: [...existing, name] });
    notify(t(`Added ${name}`, `${name} agregada`));
    return name;
  };
  const removeBucket = (name: string) => {
    saveSettings({ route_buckets: (settings.route_buckets ?? []).filter((b) => b !== name) });
  };
  // Hand a whole bucket's route to a real driver as a distinct LOAD (keeping its
  // optimized sequence), then retire the bucket. If the driver already has
  // work, this becomes their next load — so one driver can carry several routes.
  const assignRouteToDriver = async (bucket: string, driver: string) => {
    if (!driver) return;
    const stops = byDriver.get(bucket) ?? [];
    const load = nextLoadFor(driver);
    for (const d of stops) {
      await updateDelivery(d.id, { assigned_driver: driver, load_no: load });
      addNote(d.id, `Route "${bucket}" assigned to ${driver} as load ${load}`);
    }
    removeBucket(bucket);
    notify(t(`Route "${bucket}" (${stops.length} stop(s)) → ${driver}, load ${load}`, `Ruta "${bucket}" (${stops.length} parada(s)) → ${driver}, carga ${load}`));
  };
  // Drivers on vacation/sick/maintenance for the selected day — excluded from auto-assign.
  const unavailableToday = useMemo(
    () => unavailableDriverNames(availability, new Map(users.map((u) => [u.id, u.full_name])), date),
    [availability, users, date],
  );
  const colorFor = (driver: string | null) => (driver ? settings.driver_colors?.[driver] || fallbackDriverColor(driver) : UNASSIGNED_COLOR);
  // A driver's own capacity, else the fleet-wide default, else the built-in.
  const capacityFor = (driver: string) => settings.driver_capacity?.[driver] ?? settings.default_truck_capacity ?? DEFAULT_CAPACITY;
  const setCapacity = (driver: string, capacity: number) => {
    clearRouteFor(driver);
    saveSettings({ driver_capacity: { ...(settings.driver_capacity ?? {}), [driver]: capacity } });
  };

  // A driver's route is a loop from the PICKUP point (where they load the
  // truck), out to the deliveries, and back to the pickup to reload for the
  // next truckload. The pickup is taken from the orders themselves (their
  // pickup_address / sold-from store), falling back to the driver's own
  // home store — whichever we can resolve.
  const pickupAddressFor = (laneKey: string): string | null => {
    const driver = driverOf(laneKey);
    const stops = byDriver.get(laneKey) ?? [];
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

  // Draw each selected unassigned load's pickup→dropoff route on the map
  // (throttled, cached), so pressing loads shows where they go.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const chosen = dayOrders.filter((d) => selectedOrders.has(d.id) && d.delivery_lat != null && d.delivery_lng != null);
      for (const d of chosen) {
        if (cancelled) return;
        const addr = (d.pickup_address || settings.stores.find((s) => s.name === d.store)?.address || d.store || "").trim();
        const pk = await getDepotCoords(addr);
        if (cancelled) return;
        if (!pk) continue;
        // Record the pickup point right away so the "P" pin + straight PU→DEL
        // line appear on selection, even while the road geometry is still loading.
        setSelPickup((p) => (p[d.id] && p[d.id][0] === pk[0] && p[d.id][1] === pk[1] ? p : { ...p, [d.id]: pk }));
        if (selRouteCache[d.id]) continue;
        try {
          const res = await fetch("/api/optimize-route", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stops: [{ id: "p", lat: pk[0], lng: pk[1] }, { id: "d", lat: d.delivery_lat, lng: d.delivery_lng }], roundtrip: false }),
          });
          const b = await res.json();
          if (!cancelled && res.ok && Array.isArray(b.geometry) && b.geometry.length) {
            const positions = (b.geometry as [number, number][]).map(([lng, lat]) => [lat, lng] as [number, number]);
            setSelRouteCache((p) => ({ ...p, [d.id]: positions }));
          }
        } catch { /* skip */ }
        await new Promise((r) => setTimeout(r, 120));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrders, dayOrders]);

  // A distinct color per selected load (shared by its pickup pin + route),
  // whether the load is assigned or still in the pool.
  const selColorById = useMemo(() => {
    const m = new Map<string, string>();
    dayOrders.filter((d) => selectedOrders.has(d.id)).forEach((d, i) => m.set(d.id, SEL_PALETTE[i % SEL_PALETTE.length]));
    return m;
  }, [dayOrders, selectedOrders]);

  // How many of the selected loads are still in the pool — the bulk-assign
  // controls act on these only (a selected assigned load is just a map view).
  const poolSelectedCount = useMemo(
    () => unassigned.reduce((n, d) => n + (selectedOrders.has(d.id) ? 1 : 0), 0),
    [unassigned, selectedOrders],
  );

  // Search + saved filter over the unassigned pool.
  const unassignedShown = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    return unassigned.filter((d) => {
      if (poolFilter === "overdue" && !isOverdue(d)) return false;
      if (poolFilter === "noloc" && d.delivery_lat != null) return false;
      if (poolFilter === "windowed" && !d.delivery_windows) return false;
      if (!q) return true;
      return (
        String(d.order_no).includes(q) ||
        (d.account || "").toLowerCase().includes(q) ||
        (d.delivery_address || "").toLowerCase().includes(q) ||
        (d.delivery_phone || "").toLowerCase().includes(q) ||
        (d.contact || "").toLowerCase().includes(q) ||
        (d.store || "").toLowerCase().includes(q)
      );
    });
  }, [unassigned, orderSearch, poolFilter]);

  // Each driver's stops for the day, in their current sequence (optimized
  // order first, unsequenced ones after — same rule as the Driver page).
  // Keyed by LANE (driver+load, or bucket), so each of a driver's loads is its
  // own optimizable route.
  const byDriver = useMemo(() => {
    const map = new Map<string, Delivery[]>();
    for (const d of dayOrders) {
      const key = orderLaneKey(d);
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(d);
      map.set(key, list);
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

  // Columns for the drag-and-drop board: the unassigned pool, then one per driver.
  const boardColumns: BoardColumn[] = useMemo(() => {
    const cols: BoardColumn[] = [
      { key: "__unassigned__", title: t("Unassigned", "Sin asignar"), color: UNASSIGNED_COLOR, orders: unassigned },
    ];
    for (const u of lanes) {
      const orders = byDriver.get(u.key) ?? [];
      const pallets = Math.round(orders.reduce((s, d) => s + Number(d.actual_pallets ?? d.est_pallets ?? 0), 0));
      cols.push({ key: u.key, title: u.label, color: colorFor(u.driver), orders, sub: `${pallets}/${capacityFor(u.driver)}` });
    }
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unassigned, lanes, byDriver, settings.driver_colors, settings.driver_capacity, lang]);

  // Print a driver's route for the selected day, in optimized stop sequence
  // (route_seq when planned, else by order number).
  const printManifestFor = (laneKey: string) => {
    const stops = [...(byDriver.get(laneKey) ?? [])].sort(
      (a, b) => (a.route_seq ?? 9999) - (b.route_seq ?? 9999) || a.order_no - b.order_no,
    );
    const label = lanes.find((l) => l.key === laneKey)?.label ?? driverOf(laneKey);
    printRouteManifest(label, stops, settings, lang, fmtDate(date));
  };

  // Timeline rows: drivers that have stops, each drawn over the day axis.
  const ganttRows: GanttRow[] = useMemo(
    () => boardColumns
      .filter((c) => c.key !== "__unassigned__" && c.orders.length > 0)
      .map((c) => ({ key: c.key, title: c.title, color: c.color, orders: c.orders })),
    [boardColumns],
  );

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
    // A plain (dropdown / drag) assignment always lands on the driver's first
    // load; multi-load assignment goes through assignRouteToDriver.
    return updateDelivery(id, { assigned_driver: driver || null, route_seq: null, load_no: null });
  };
  const unassign = (id: string) => {
    const d = dayOrders.find((x) => x.id === id);
    if (d) { const k = orderLaneKey(d); if (k) clearRouteFor(k); }
    return updateDelivery(id, { assigned_driver: null, route_seq: null, load_no: null });
  };

  // Parse a lane key ("Driver#L2") back into its load number (1 if none).
  const loadFromKey = (laneKey: string) => {
    const i = laneKey.lastIndexOf(LANE_SEP);
    const n = i >= 0 ? parseInt(laneKey.slice(i + LANE_SEP.length), 10) : NaN;
    return Number.isFinite(n) ? n : 1;
  };
  // Assign an order onto a specific LANE (a driver's load, or a bucket) — used
  // by the board's drag-and-drop onto a load column.
  const assignToLane = async (id: string, laneKey: string) => {
    const d = dayOrders.find((x) => x.id === id);
    clearRouteFor(laneKey);
    if (isBucket(laneKey)) {
      await updateDelivery(id, { assigned_driver: laneKey, route_seq: null, load_no: null });
    } else {
      const load = loadFromKey(laneKey);
      await updateDelivery(id, { assigned_driver: driverOf(laneKey), route_seq: null, load_no: load > 1 ? load : null });
    }
    addNote(id, `Moved to ${laneKey}${d?.assigned_driver ? ` (from ${orderLaneKey(d) ?? d.assigned_driver})` : ""}`);
  };

  // A single manual (re)assignment — assign + write an audit note.
  const manualAssign = (id: string, driver: string) => {
    const d = dayOrders.find((x) => x.id === id);
    assignTo(id, driver);
    addNote(id, `Assigned to ${driver}${d?.assigned_driver && d.assigned_driver !== driver ? ` (from ${d.assigned_driver})` : ""}`);
  };
  const manualUnassign = (id: string) => {
    const d = dayOrders.find((x) => x.id === id);
    unassign(id);
    if (d?.assigned_driver) addNote(id, `Unassigned (was ${d.assigned_driver})`);
  };

  // Drag-and-drop on the board: move an order to a driver column, or back to
  // the unassigned pool.
  const boardMove = (orderId: string, columnKey: string) => {
    const d = dayOrders.find((x) => x.id === orderId);
    if (!d) return;
    if (columnKey === "__unassigned__") { if (d.assigned_driver) manualUnassign(orderId); }
    else if (orderLaneKey(d) !== columnKey) assignToLane(orderId, columnKey);
  };

  /** Solve a driver's full day for the given stop list — capacity-split
   * round trips out from the pickup point and back — WITHOUT saving
   * anything. Both the real "Optimize route" and the add-order simulation
   * run through this. `extraStops` lets the simulation include an order
   * that isn't assigned to the driver yet, so its pickup counts too. */
  const computeRoute = async (laneKey: string, stopList: Delivery[]): Promise<RoutePlan> => {
    const driver = driverOf(laneKey);
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
    const withStops = lanes.filter((u) => (byDriver.get(u.key) ?? []).length > 0);
    if (!withStops.length) return;
    setOptimizingAll(true);
    setPreview(null);
    setErr(null);
    for (const u of withStops) {
      setBusyDriver(u.key);
      try {
        await applyPlan(u.key, await computeRoute(u.key, byDriver.get(u.key) ?? []));
      } catch (e) {
        setErr((e as Error).message);
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    setBusyDriver(null);
    setOptimizingAll(false);
  };

  // Auto-assign every unassigned order across the drivers (capacity + window +
  // proximity aware), then leave the "Optimize all routes" button to sequence
  // each driver's day into real OSRM routes.
  const runAutoAssign = async () => {
    if (autoAssigning || optimizingAll || busyDriver != null) return;
    const driverNames = drivers.map((u) => u.full_name);
    if (!driverNames.length) { notify(t("Add drivers first (give someone the Driver role).", "Agregue choferes primero (asigne el rol de Chofer).")); return; }
    const res = autoAssign(unassigned, driverNames, capacityFor, { maxTripsPerDay: 2, unavailable: unavailableToday });
    if (!res.assignments.length) {
      notify(t("Nothing could be auto-assigned (no coordinates or no capacity).", "No se pudo auto-asignar nada (sin coordenadas o sin capacidad)."));
      return;
    }
    setAutoAssigning(true);
    try {
      for (const a of res.assignments) await assignTo(a.orderId, a.driver);
    } finally {
      setAutoAssigning(false);
    }
    const nDrivers = new Set(res.assignments.map((a) => a.driver)).size;
    notify(t(
      `Auto-assigned ${res.assignments.length} order(s) to ${nDrivers} driver(s)${res.unassigned.length ? ` · ${res.unassigned.length} left (no location/capacity)` : ""}. Now tap “Optimize all routes”.`,
      `Auto-asignadas ${res.assignments.length} orden(es) a ${nDrivers} chofer(es)${res.unassigned.length ? ` · ${res.unassigned.length} sin colocar (sin ubicación/capacidad)` : ""}. Ahora toque “Optimizar todas las rutas”.`,
    ));
  };

  const toggleOrder = (id: string) =>
    setSelectedOrders((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const clearSelection = () => setSelectedOrders(new Set());

  // Assign every checked order to one driver.
  const bulkAssign = async (driver: string) => {
    const ids = unassigned.filter((d) => selectedOrders.has(d.id)).map((d) => d.id);
    if (!ids.length || !driver) return;
    setAutoAssigning(true);
    try { for (const id of ids) await assignTo(id, driver); } finally { setAutoAssigning(false); }
    clearSelection();
    notify(t(`Assigned ${ids.length} order(s) to ${driver}`, `Asignadas ${ids.length} orden(es) a ${driver}`));
  };

  // Auto-assign only the checked orders across the drivers.
  const bulkAutoAssign = async () => {
    const chosen = unassigned.filter((d) => selectedOrders.has(d.id));
    if (!chosen.length) return;
    const res = autoAssign(chosen, drivers.map((u) => u.full_name), capacityFor, { maxTripsPerDay: 2, unavailable: unavailableToday });
    if (!res.assignments.length) { notify(t("Couldn't place the selected orders.", "No se pudieron colocar las órdenes seleccionadas.")); return; }
    setAutoAssigning(true);
    try { for (const a of res.assignments) await assignTo(a.orderId, a.driver); } finally { setAutoAssigning(false); }
    clearSelection();
    const nDrivers = new Set(res.assignments.map((a) => a.driver)).size;
    notify(t(
      `Auto-assigned ${res.assignments.length} order(s) to ${nDrivers} driver(s)${res.unassigned.length ? ` · ${res.unassigned.length} left` : ""}.`,
      `Auto-asignadas ${res.assignments.length} orden(es) a ${nDrivers} chofer(es)${res.unassigned.length ? ` · ${res.unassigned.length} sin colocar` : ""}.`,
    ));
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
    const { orderId, driver, plan } = preview; // `driver` is a lane key
    setPreview(null);
    if (isBucket(driver)) {
      await updateDelivery(orderId, { assigned_driver: driver, load_no: null });
    } else {
      const load = loadFromKey(driver);
      await updateDelivery(orderId, { assigned_driver: driverOf(driver), load_no: load > 1 ? load : null });
    }
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
    for (const u of lanes) {
      if ((byDriver.get(u.key) ?? []).length) getDepotCoords(pickupAddressFor(u.key));
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
    // Color each assigned stop by its TRUCKLOAD (matching the route line),
    // so the map groups stops into the same colors as their loop.
    const stopColor = new Map<string, string>();
    for (const u of lanes) {
      const stops = byDriver.get(u.key) ?? [];
      splitIntoTrips(stops, capacityFor(u.driver)).forEach((batch, ti) => {
        const c = tripColor(colorFor(u.driver), ti);
        for (const d of batch) stopColor.set(d.id, c);
      });
    }

    const pts: MapPoint[] = [];
    // Pickup / base pins first, so a stop that sits right on the pickup still
    // draws on top of the "P" instead of being hidden behind it.
    for (const u of lanes) {
      if (!(byDriver.get(u.key) ?? []).length) continue;
      const addr = (pickupAddressFor(u.key) ?? "").trim();
      const coords = addr ? depotCoords[addr] : undefined;
      if (!coords) continue;
      pts.push({
        id: `__depot__${u.id}`,
        lat: coords[0],
        lng: coords[1],
        color: colorFor(u.driver),
        badge: "P",
        label: `${t("Pickup / base", "Recolección / base")} (${u.label}) — ${addr}`,
        dimmed: isDim(u.key) || selectedOrders.size > 0,
      });
    }
    const selActive = selectedOrders.size > 0;
    for (const d of dayOrders) {
      if (d.delivery_lat == null || d.delivery_lng == null) continue;
      if (!d.assigned_driver) {
        const sel = selectedOrders.has(d.id);
        pts.push({
          id: d.id,
          lat: d.delivery_lat,
          lng: d.delivery_lng,
          color: sel ? (selColorById.get(d.id) ?? "#2456c9") : UNASSIGNED_COLOR,
          badge: sel ? "D" : undefined,
          label: `#${orderLabel(d)} — ${sel ? t("Delivery", "Entrega") : t("Unassigned", "Sin asignar")}`,
          dimmed: sel ? false : (focused || selActive),
        });
        continue;
      }
      const sel = selectedOrders.has(d.id);
      const laneKey = orderLaneKey(d)!;
      const list = byDriver.get(laneKey) ?? [];
      const idx = list.findIndex((x) => x.id === d.id);
      const badge = d.route_seq != null ? String(idx + 1) : undefined;
      const loadTag = !isBucket(d.assigned_driver) && loadNoOf(d) > 1 ? ` · ${t("Load", "Carga")} ${loadNoOf(d)}` : "";
      pts.push({
        id: d.id,
        lat: d.delivery_lat,
        lng: d.delivery_lng,
        // A selected assigned stop pops in its own selection color, un-dimmed,
        // marked "D" so it pairs with its "P" pickup pin.
        color: sel ? (selColorById.get(d.id) ?? "#2456c9") : (stopColor.get(d.id) ?? colorFor(d.assigned_driver)),
        badge: sel ? "D" : badge,
        label: `#${orderLabel(d)} — ${d.assigned_driver}${loadTag}${badge ? ` (${t("Stop", "Parada")} ${badge})` : ""}`,
        dimmed: sel ? false : (isDim(laneKey) || selActive),
      });
    }
    // Pickup ("P") pin for each selected load (assigned or pool), in its own
    // color, so the PU→DEL pairing is visible even before the road route loads.
    for (const d of dayOrders) {
      if (!selectedOrders.has(d.id)) continue;
      const pk = selPickup[d.id];
      if (!pk) continue;
      pts.push({
        id: `__selpk__${d.id}`,
        lat: pk[0],
        lng: pk[1],
        color: selColorById.get(d.id) ?? "#2456c9",
        badge: "P",
        label: `#${orderLabel(d)} — ${t("Pickup", "Recolección")}`,
        dimmed: false,
      });
    }
    return pts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayOrders, byDriver, settings.driver_colors, settings.driver_capacity, selected, selectedOrders, selColorById, selPickup, depotCoords, lanes]);

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
        const color = tripColor(colorFor(driverOf(driver)), i);
        const dimmed = isDim(driver);
        const offset = (idx - center) * spacing;
        // Delivery run: solid. Empty drive back to the pickup: dashed, and
        // pushed to its own parallel offset so that when it retraces the
        // outbound road the dashes sit BESIDE the solid line (and stay
        // visible) instead of landing on top of the same-color run.
        out.push({ id: `line:${driver}#${i}`, color, positions: trace.delivery, dimmed, offset });
        if (trace.ret.length > 1) out.push({ id: `ret:${driver}#${i}`, color, positions: trace.ret, dimmed, dashed: true, offset: offset + 7 });
        idx++;
      });
    }
    if (preview) {
      const color = colorFor(driverOf(preview.driver));
      preview.plan.traces.forEach((trace, i) => {
        out.push({ id: `preview:${i}`, color, positions: trace.delivery, dashed: true });
        if (trace.ret.length > 1) out.push({ id: `pret:${i}`, color, positions: trace.ret, dashed: true, offset: 7 });
      });
    }
    // Selected loads (assigned or pool): each in its own color — the "go" leg
    // solid (pickup→dropoff) and the "return" leg dashed (dropoff→pickup),
    // offset so it sits beside the outbound line. When the road geometry isn't
    // ready (or fails to load), fall back to a straight pickup→dropoff line so
    // the PU→DEL pairing is ALWAYS shown, never just the dot.
    for (const d of dayOrders) {
      if (!selectedOrders.has(d.id)) continue;
      const color = selColorById.get(d.id) ?? "#2456c9";
      const pos = selRouteCache[d.id];
      if (pos && pos.length) {
        out.push({ id: `sel:${d.id}`, color, positions: pos });
        out.push({ id: `selret:${d.id}`, color, positions: [...pos].reverse(), dashed: true, offset: 6 });
      } else {
        const pk = selPickup[d.id];
        if (pk && d.delivery_lat != null && d.delivery_lng != null) {
          out.push({ id: `selstraight:${d.id}`, color, positions: [pk, [d.delivery_lat, d.delivery_lng]], dashed: true });
        }
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeLines, selected, preview, settings.driver_colors, selectedOrders, selRouteCache, selPickup, selColorById, dayOrders]);

  const onLineClick = (id: string) => {
    const m = id.match(/^(?:line|ret):(.+)#\d+$/);
    if (m) focusOnly(m[1]);
  };

  // What the map frames: the selected drivers' stops + pickups when any are
  // focused, otherwise the whole day.
  const fitTo: [number, number][] = useMemo(() => {
    // Selected unassigned loads take priority — frame them + their routes.
    if (selectedOrders.size > 0) {
      const pts: [number, number][] = [];
      for (const d of dayOrders) {
        if (!selectedOrders.has(d.id)) continue;
        if (d.delivery_lat != null && d.delivery_lng != null) pts.push([d.delivery_lat, d.delivery_lng]);
        const pk = selPickup[d.id];
        if (pk) pts.push(pk); // keep the pickup end in frame too
        const pos = selRouteCache[d.id];
        if (pos) pts.push(...pos);
      }
      if (pts.length) return pts;
    }
    if (!focused) return points.map((p) => [p.lat, p.lng] as [number, number]);
    const ids = new Set<string>();
    for (const key of selected) {
      for (const d of byDriver.get(key) ?? []) ids.add(d.id);
      const lane = lanes.find((l) => l.key === key);
      if (lane) ids.add(`__depot__${lane.id}`);
    }
    return points.filter((p) => ids.has(p.id)).map((p) => [p.lat, p.lng] as [number, number]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, selected, selectedOrders, selRouteCache, selPickup, dayOrders]);

  if (!me) return null;
  if (!canPlanRoutes(me)) {
    return <div className="empty">{t("You don’t have access to route planning.", "No tienes acceso a la planificación de rutas.")}</div>;
  }

  const withStops = lanes.filter((u) => (byDriver.get(u.key) ?? []).length > 0);
  const shownDrivers = focused ? lanes.filter((u) => selected.has(u.key)) : withStops;
  // Simulating an add targets a driver, so it needs exactly one selected.
  const singleSel = selected.size === 1 ? [...selected][0] : null;
  const scheduledCount = dayOrders.length - unassigned.length;

  return (
    <>
      <div className="page-head">
        <h2>{t("Routes Manager", "Gestor de Rutas")} <span className="count-tag">{dayOrders.length}</span></h2>
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
            className="btn btn-amber btn-sm"
            disabled={autoAssigning || optimizingAll || busyDriver != null || unassigned.length === 0 || drivers.length === 0}
            onClick={runAutoAssign}
            title={t("Distribute all unassigned orders across drivers", "Repartir todas las órdenes sin asignar entre los choferes")}
          >
            {autoAssigning ? `… ${t("Assigning", "Asignando")}` : `✨ ${t("Auto-assign", "Auto-asignar")} (${unassigned.length})`}
          </button>
          <button
            className="btn btn-primary btn-sm"
            disabled={optimizingAll || autoAssigning || busyDriver != null || lanes.every((u) => (byDriver.get(u.key) ?? []).length === 0)}
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
            <b style={{ flex: 1 }}>🚚 {t("Drivers & routes", "Choferes y rutas")}</b>
            <button className="btn btn-ghost btn-sm" onClick={addBucket} title={t("Build a route with no driver yet, then assign it later", "Arma una ruta sin chofer todavía, y asígnala después")}>＋ {t("Route", "Ruta")}</button>
            {focused && <button className="notif-clear" onClick={() => setSelected(new Set())}>{t("Show all", "Mostrar todos")}</button>}
          </div>
          {lanes.length === 0 ? (
            <div className="empty">{t("No drivers yet — tap “＋ Route” to build a route without one.", "Aún sin choferes — toca “＋ Ruta” para armar una ruta sin uno.")}</div>
          ) : (
            <div style={{ maxHeight: 470, overflowY: "auto" }}>
              {lanes.map((u) => {
                const stops = byDriver.get(u.key) ?? [];
                const info = routeInfo[u.key];
                const on = selected.has(u.key);
                const bucket = u.isBucket;
                // Load vs truck capacity — a filled bar the dispatcher can read
                // at a glance; over capacity turns red (the day needs a reload trip).
                const pallets = stops.reduce((s, o) => s + Number(o.actual_pallets ?? o.est_pallets ?? 0), 0);
                const cap = capacityFor(u.driver);
                const pct = cap > 0 ? Math.min(100, (pallets / cap) * 100) : 0;
                const over = pallets > cap;
                return (
                  <div
                    key={u.id}
                    onClick={() => focusOnly(u.key)}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderTop: "1px solid var(--line)", cursor: "pointer", background: on ? "var(--accent-soft)" : undefined }}
                  >
                    <input type="checkbox" checked={on} onClick={(e) => e.stopPropagation()} onChange={() => toggleDriver(u.key)} style={{ width: 15, height: 15, flex: "0 0 auto" }} />
                    <span style={{ width: 12, height: 12, borderRadius: "50%", background: colorFor(u.driver), flex: "0 0 auto", border: "2px solid #fff", boxShadow: "0 0 0 1px var(--line)" }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                        {u.label}
                        {bucket && <span className="sema" style={{ background: "var(--accent)", color: "#fff", fontSize: 10 }}>🧭 {t("route", "ruta")}</span>}
                        {u.load > 1 && <span className="sema" style={{ background: "var(--gray)", color: "#fff", fontSize: 10 }}>🚚 {t("load", "carga")} {u.load}</span>}
                        {bucket && stops.length === 0 && (
                          <button className="notif-clear" title={t("Remove empty route", "Quitar ruta vacía")}
                            onClick={(e) => { e.stopPropagation(); removeBucket(u.key); }}>✕</button>
                        )}
                      </div>
                      <div className="hint" style={{ marginTop: 2, display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <span>📦 {stops.length}</span>
                        {/* Travel time & miles only appear once a route has been calculated. */}
                        {info && <span>⏱ {info.duration_text}</span>}
                        {info && <span>⇥ {info.miles} mi</span>}
                      </div>
                      {/* Capacity meter: pallets loaded vs the truck's capacity. */}
                      <div style={{ marginTop: 5, display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ flex: 1, height: 6, borderRadius: 999, background: "var(--line)", overflow: "hidden" }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: over ? "var(--red)" : "var(--green)" }} />
                        </div>
                        <span className="hint" style={{ fontSize: 11, fontWeight: 700, color: over ? "var(--red)" : undefined }}>
                          {pallets}/{cap}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="card" style={{ flex: "3 1 460px", margin: 0, padding: 0, overflow: "hidden" }}>
          <LeafletMap points={points} lines={lines} onLineClick={onLineClick} fitTo={fitTo} height={520} onPointClick={(id) => {
            // Click any order pin (assigned or pool) to toggle its PU→DEL view.
            const d = dayOrders.find((x) => x.id === id);
            if (d) toggleOrder(d.id);
          }} />
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
        <div className="card" style={{ borderColor: colorFor(driverOf(preview.driver)) }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <b>
              🔮 {t(
                `Adding #${preview.orderNo} to ${laneLabel(preview.driver)}:`,
                `Agregando #${preview.orderNo} a ${laneLabel(preview.driver)}:`,
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
        <button className={"vt " + (tab === "board" ? "on" : "")} onClick={() => setTab("board")}>🗂 {t("Board", "Tablero")}</button>
        <button className={"vt " + (tab === "timeline" ? "on" : "")} onClick={() => setTab("timeline")}>📅 {t("Timeline", "Horario")}</button>
      </div>

      {/* ---------- Day timeline (Gantt) ---------- */}
      {tab === "timeline" && (
        <div className="card" style={{ margin: 0 }}>
          <p className="hint" style={{ marginTop: 0 }}>
            {t("Each driver's day by delivery window (07:00–19:00).", "El día de cada chofer por ventana de entrega (07:00–19:00).")}
          </p>
          {ganttRows.length === 0
            ? <div className="empty">{t("No assigned orders to show yet.", "Aún no hay órdenes asignadas.")}</div>
            : <GanttTimeline rows={ganttRows} t={t} />}
        </div>
      )}

      {/* ---------- Drag-and-drop board ---------- */}
      {tab === "board" && (
        <div className="card" style={{ margin: 0 }}>
          <p className="hint" style={{ marginTop: 0 }}>
            {t("Drag an order card onto a driver to assign it, or back to Unassigned to remove it.", "Arrastre una tarjeta a un chofer para asignarla, o de vuelta a Sin asignar para quitarla.")}
          </p>
          <DispatchBoard columns={boardColumns} onMove={boardMove} t={t} lang={lang} onPrint={printManifestFor} />
        </div>
      )}

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
              `Simulate adds a stop to ${laneLabel(singleSel)}'s day and shows the resulting route before anything is saved.`,
              `Simular agrega una parada al día de ${laneLabel(singleSel)} y muestra la ruta resultante antes de guardar nada.`,
            )}
          </p>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "10px 0" }}>
          <input
            value={orderSearch}
            onChange={(e) => setOrderSearch(e.target.value)}
            placeholder={t("Search # / customer / address / phone…", "Buscar # / cliente / dirección / teléfono…")}
            style={{ maxWidth: 300 }}
          />
          {(["all", "overdue", "windowed", "noloc"] as const).map((f) => (
            <button
              key={f}
              className={"btn btn-sm " + (poolFilter === f ? "btn-primary" : "btn-ghost")}
              onClick={() => setPoolFilter(f)}
            >
              {f === "all" ? t("All", "Todas")
                : f === "overdue" ? t("Overdue", "Atrasadas")
                : f === "windowed" ? t("Windowed", "Con ventana")
                : t("No location", "Sin ubicación")}
            </button>
          ))}
          {selectedOrders.size > 0 && (
            <>
              <span className="count-tag">{selectedOrders.size} {t("selected", "seleccionadas")}</span>
              {poolSelectedCount > 0 && (
                <>
                  <select defaultValue="" disabled={autoAssigning} style={{ width: "auto" }}
                    onChange={(e) => { const v = e.target.value; e.currentTarget.value = ""; if (v === "__newroute__") { bulkAssign(addBucket()); } else if (v) bulkAssign(v); }}>
                    <option value="">{t("Assign selected to…", "Asignar selección a…")}</option>
                    <optgroup label={t("Drivers", "Choferes")}>
                      {drivers.map((u) => <option key={u.id} value={u.full_name}>{u.full_name}</option>)}
                    </optgroup>
                    <optgroup label={t("Routes (no driver yet)", "Rutas (sin chofer)")}>
                      {bucketNames.map((n) => <option key={n} value={n}>🧭 {n}</option>)}
                      <option value="__newroute__">＋ {t("New route…", "Nueva ruta…")}</option>
                    </optgroup>
                  </select>
                  <button className="btn btn-amber btn-sm" onClick={bulkAutoAssign} disabled={autoAssigning}>✨ {t("Auto-assign selected", "Auto-asignar selección")}</button>
                </>
              )}
              <button className="btn btn-ghost btn-sm" onClick={clearSelection}>{t("Clear", "Limpiar")}</button>
            </>
          )}
        </div>
        {unassigned.length === 0 ? (
          <div className="empty">{t("Everything on this date has a driver.", "Todo en esta fecha ya tiene chofer.")}</div>
        ) : unassignedShown.length === 0 ? (
          <div className="empty">{t("No unassigned orders match your search.", "Ninguna orden sin asignar coincide con la búsqueda.")}</div>
        ) : (
          <div className="tbl-scroll" style={{ border: "none" }}>
            <table className="orders" style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th style={{ width: 28 }}>
                    <input
                      type="checkbox"
                      aria-label={t("Select all", "Seleccionar todo")}
                      checked={unassignedShown.length > 0 && unassignedShown.every((d) => selectedOrders.has(d.id))}
                      onChange={(e) => setSelectedOrders((s) => {
                        const n = new Set(s);
                        if (e.target.checked) unassignedShown.forEach((d) => n.add(d.id));
                        else unassignedShown.forEach((d) => n.delete(d.id));
                        return n;
                      })}
                    />
                  </th>
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
                {unassignedShown.map((d) => {
                  const s = stageInfo(d.stage);
                  return (
                    <tr key={d.id} className={selectedOrders.has(d.id) ? "row-selected" : ""} onClick={() => toggleOrder(d.id)} style={{ cursor: "pointer" }}>
                      <td>
                        <input type="checkbox" checked={selectedOrders.has(d.id)} readOnly aria-label={`#${orderLabel(d)}`} />
                        {selectedOrders.has(d.id) && <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: selColorById.get(d.id), marginLeft: 5, verticalAlign: "middle", boxShadow: "0 0 0 1px var(--line)" }} />}
                      </td>
                      <td className="ordno">#{d.order_no}</td>
                      <td>{d.account || "—"}</td>
                      <td>{d.store || "—"}</td>
                      <td>{d.actual_pallets ?? d.est_pallets ?? "—"}</td>
                      <td onClick={(e) => e.stopPropagation()}><DateCell d={d} date={date} onChange={reschedule} t={t} /></td>
                      <td>{fmtWindows(d.delivery_windows)}</td>
                      <td><span className="sema" style={{ background: s.color, color: "#fff" }}>{stageLabel(d.stage, lang)}</span></td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {singleSel ? (
                          <button
                            className="btn btn-ghost btn-sm"
                            disabled={previewBusy === d.id || busyDriver != null}
                            onClick={() => previewAdd(d, singleSel)}
                          >
                            {previewBusy === d.id ? "…" : `🔮 ${t("Simulate add", "Simular")}`}
                          </button>
                        ) : (
                          <select defaultValue="" onChange={(e) => { const v = e.target.value; e.currentTarget.value = ""; if (v === "__newroute__") { manualAssign(d.id, addBucket()); } else if (v) manualAssign(d.id, v); }} style={{ width: "auto" }}>
                            <option value="">{t("Assign to…", "Asignar a…")}</option>
                            <optgroup label={t("Drivers", "Choferes")}>
                              {drivers.map((u) => <option key={u.id} value={u.full_name}>{u.full_name}</option>)}
                            </optgroup>
                            <optgroup label={t("Routes (no driver yet)", "Rutas (sin chofer)")}>
                              {bucketNames.map((n) => <option key={n} value={n}>🧭 {n}</option>)}
                              <option value="__newroute__">＋ {t("New route…", "Nueva ruta…")}</option>
                            </optgroup>
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
        const stops = byDriver.get(u.key) ?? [];
        const sequenced = stops.length > 0 && stops.every((d) => d.route_seq != null);
        const missingPins = stops.filter((d) => d.delivery_lat == null).length;
        const info = routeInfo[u.key];
        const capacity = capacityFor(u.driver);
        const trips = splitIntoTrips(stops, capacity);
        const isC = isCollapsed(u.key);
        const bucket = u.isBucket;
        // Stops whose optimized ETA lands after the delivery window closes —
        // surfaced as a banner so the dispatcher acts before dispatch, not just
        // as a red cell buried in the table.
        const lateStops = stops.filter((d) => {
          const eta = routeEtas[u.key]?.[d.id];
          const win = parseWindow(d.delivery_windows);
          const etaMin = eta ? parseInt(eta.slice(0, 2), 10) * 60 + parseInt(eta.slice(3, 5), 10) : null;
          return etaMin != null && win != null && etaMin > win[1];
        });
        return (
          <div className="card" key={u.id} style={{ margin: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
              <button className="btn btn-ghost btn-sm" style={{ padding: "0 6px" }} onClick={() => toggleCollapse(u.key)} title={t("Collapse", "Contraer")}>{isC ? "▸" : "▾"}</button>
              <span style={{ width: 14, height: 14, borderRadius: "50%", background: colorFor(u.driver), border: "2px solid #fff", boxShadow: "0 0 0 1px var(--line)", flex: "0 0 auto" }} />
              <h2 style={{ margin: 0 }}>{u.label}</h2>
              {bucket && <span className="sema" style={{ background: "var(--accent)", color: "#fff" }}>🧭 {t("route", "ruta")}</span>}
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
                  onChange={(e) => { const v = Number(e.target.value); if (v > 0) setCapacity(u.driver, v); }}
                  style={{ width: 60 }}
                />
                {t("plt", "trm")}
              </label>
              <button className="btn btn-primary btn-sm" disabled={stops.length < 2 || busyDriver === u.key} onClick={() => optimize(u.key)}>
                {busyDriver === u.key ? "…" : `🧭 ${t("Optimize route", "Optimizar ruta")}`}
              </button>
              {bucket && (
                <select
                  defaultValue=""
                  disabled={stops.length === 0 || drivers.length === 0}
                  title={t("Hand this whole route to a driver", "Entregar toda esta ruta a un chofer")}
                  onChange={(e) => { const v = e.target.value; e.currentTarget.value = ""; if (v) assignRouteToDriver(u.key, v); }}
                  style={{ width: "auto" }}
                >
                  <option value="">👤 {t("Assign route to…", "Asignar ruta a…")}</option>
                  {drivers.map((dv) => <option key={dv.id} value={dv.full_name}>{dv.full_name}</option>)}
                </select>
              )}
            </div>
            {!isC && <>
            {lateStops.length > 0 && (
              <div className="card" style={{ marginBottom: 8, background: "#fef6f6", borderColor: "var(--red)" }}>
                <b style={{ color: "var(--red)" }}>⚠️ {t(`${lateStops.length} stop(s) will miss their delivery window`, `${lateStops.length} parada(s) no llegarán a tiempo a su ventana`)}</b>
                <div className="hint" style={{ marginTop: 2 }}>
                  {lateStops.slice(0, 6).map((d) => `#${orderLabel(d)}${d.account ? ` (${d.account})` : ""}`).join(", ")}{lateStops.length > 6 ? "…" : ""}
                  {" — "}{t("reorder the stops or move some to another driver.", "reordene las paradas o mueva algunas a otro chofer.")}
                </div>
              </div>
            )}
            {info && (
              <div className="hint" style={{ marginBottom: 8 }}>
                {t("Total (loop from pickup and back)", "Total (ciclo desde recolección y regreso)")}: <b>{info.miles} mi</b> · {info.duration_text}
                {info.trips > 1 && ` · ${info.trips} ${t("round trips back to pickup to reload", "viajes de ida y vuelta a recolección para recargar")}`}
              </div>
            )}
            {trips.length > 1 && (() => {
              const load = stops.reduce((s, d) => s + Number(d.actual_pallets ?? d.est_pallets ?? 0), 0);
              return (
                <div className="hint" style={{ marginBottom: 8, color: "var(--accent)" }}>
                  💡 {t(
                    `This is over the ${capacity}-pallet truck capacity (${load} on board), so it reloads at the pickup between loads. Raise the truck capacity to ${load} or more to carry it all in one trip (drop → drop).`,
                    `Supera la capacidad de ${capacity} tarimas del camión (${load} a bordo), por eso recarga en la recolección entre cargas. Sube la capacidad a ${load} o más para llevar todo en un solo viaje (parada → parada).`,
                  )}
                </div>
              );
            })()}
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
                      const tColor = tripColor(colorFor(u.driver), ti);
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
                            // Flag a stop whose optimized ETA lands after its window closes.
                            const eta = routeEtas[u.key]?.[d.id];
                            const win = parseWindow(d.delivery_windows);
                            const etaMin = eta ? parseInt(eta.slice(0, 2), 10) * 60 + parseInt(eta.slice(3, 5), 10) : null;
                            const late = etaMin != null && win != null && etaMin > win[1];
                            return (
                              <tr key={d.id}>
                                <td style={{ borderLeft: `4px solid ${tColor}` }}>{d.route_seq != null ? i + 1 : "—"}</td>
                                <td className="ordno">#{d.order_no}</td>
                                <td>{d.account || "—"}</td>
                                <td>{d.delivery_address || "—"}</td>
                                <td style={{ fontWeight: 600, color: late ? "var(--red)" : undefined }} title={late ? t("ETA is after the delivery window", "La llegada es después de la ventana") : undefined}>
                                  {eta ?? "—"}{late ? " ⚠️" : ""}
                                </td>
                                <td>{fmtWindows(d.delivery_windows)}</td>
                                <td style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                                  {sequenced && (
                                    <>
                                      <button className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => move(u.key, i, -1)} title={t("Move up", "Subir")}>↑</button>
                                      <button className="btn btn-ghost btn-sm" disabled={i === stops.length - 1} onClick={() => move(u.key, i, 1)} title={t("Move down", "Bajar")}>↓</button>
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
