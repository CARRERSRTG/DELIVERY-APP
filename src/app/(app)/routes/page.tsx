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

function fmtMinutes(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h} h ${rem} min` : `${h} h`;
}

/** A fully-solved (but not yet saved) plan for one driver's day. */
interface RoutePlan {
  orderedIds: string[];
  miles: number;
  seconds: number;
  traces: [number, number][][];
  trips: number;
}

export default function RoutesPage() {
  const { me, users, deliveries, settings, saveSettings, updateDelivery, ready } = useData();
  const { lang, t } = usePrefs();
  const [date, setDate] = useState(todayISO());
  const [selectedDriver, setSelectedDriver] = useState<string>("all");
  const [busyDriver, setBusyDriver] = useState<string | null>(null);
  const [routeInfo, setRouteInfo] = useState<Record<string, { miles: number; duration_text: string; trips: number }>>({});
  const [routeLines, setRouteLines] = useState<Record<string, [number, number][][]>>({});
  const [depotCoords, setDepotCoords] = useState<Record<string, [number, number]>>({});
  // A simulated "what if we add this order to this driver" plan, shown as a
  // dashed trace + totals until it's either confirmed (saved) or dismissed.
  const [preview, setPreview] = useState<{ orderId: string; orderNo: number; driver: string; plan: RoutePlan } | null>(null);
  const [previewBusy, setPreviewBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // A newly-viewed date invalidates any optimize summary/trace from before.
  useEffect(() => { setRouteInfo({}); setRouteLines({}); setPreview(null); setErr(null); }, [date]);
  // Switching drivers drops any half-finished simulation.
  useEffect(() => { setPreview(null); }, [selectedDriver]);

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

  // The depot for a driver's round trips is their home store (Users page).
  // Store addresses aren't pre-geocoded like order addresses, so resolve
  // (and cache) it here the first time it's needed.
  const getDepotCoords = async (storeName: string): Promise<[number, number] | null> => {
    if (depotCoords[storeName]) return depotCoords[storeName];
    const address = settings.stores.find((s) => s.name === storeName)?.address;
    if (!address) return null;
    try {
      const res = await fetch("/api/geocode-point", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      if (!res.ok) return null;
      const point = await res.json();
      const coords: [number, number] = [point.lat, point.lng];
      setDepotCoords((p) => ({ ...p, [storeName]: coords }));
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
   * round trips from their home store — WITHOUT saving anything. Both the
   * real "Optimize route" and the add-order simulation run through this. */
  const computeRoute = async (driver: string, stopList: Delivery[]): Promise<RoutePlan> => {
    const profile = users.find((u) => u.full_name === driver);
    // Earliest delivery window first (OSRM only supports a fixed start for
    // the trip solver — see /api/optimize-route); everything after that is
    // freely reordered within its trip for the shortest drive.
    const sorted = stopList
      .filter((d) => d.delivery_lat != null && d.delivery_lng != null)
      .sort((a, b) => (parseWindow(a.delivery_windows)?.[0] ?? Infinity) - (parseWindow(b.delivery_windows)?.[0] ?? Infinity));

    const depot = profile?.store ? await getDepotCoords(profile.store) : null;
    // No known home store/address to round-trip from — fall back to one
    // open (one-way) route across everything.
    const batches = depot ? splitIntoTrips(sorted, capacityFor(driver)) : [sorted];

    let miles = 0;
    let seconds = 0;
    const orderedIds: string[] = [];
    const traces: [number, number][][] = [];

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
      orderedIds.push(...(data.order as string[]).filter((id) => id !== "__depot__"));
      miles += data.miles;
      seconds += data.duration_seconds;
      traces.push((data.geometry as [number, number][]).map(([lng, lat]) => [lat, lng]));
    }

    return { orderedIds, miles: Math.round(miles * 10) / 10, seconds, traces, trips: batches.length };
  };

  /** Save a solved plan as the driver's actual route. */
  const applyPlan = async (driver: string, plan: RoutePlan) => {
    await Promise.all(plan.orderedIds.map((id, i) => updateDelivery(id, { route_seq: i })));
    setRouteInfo((p) => ({ ...p, [driver]: { miles: plan.miles, duration_text: fmtMinutes(plan.seconds / 60), trips: plan.trips } }));
    setRouteLines((p) => ({ ...p, [driver]: plan.traces }));
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

  // Only the selected driver's world (plus the unassigned pool, which is
  // what they might still take on) — or everything when viewing "All".
  const visibleOrders = useMemo(
    () => (selectedDriver === "all" ? dayOrders : dayOrders.filter((d) => !d.assigned_driver || d.assigned_driver === selectedDriver)),
    [dayOrders, selectedDriver],
  );

  const points: MapPoint[] = useMemo(() => {
    const pts: MapPoint[] = [];
    for (const d of visibleOrders) {
      if (d.delivery_lat == null || d.delivery_lng == null) continue;
      if (!d.assigned_driver) {
        pts.push({ id: d.id, lat: d.delivery_lat, lng: d.delivery_lng, color: UNASSIGNED_COLOR, label: `#${d.order_no} — ${t("Unassigned", "Sin asignar")}` });
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
      });
    }
    return pts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleOrders, byDriver, settings.driver_colors]);

  const lines: MapLine[] = useMemo(() => {
    const out: MapLine[] = Object.entries(routeLines)
      .filter(([driver]) => selectedDriver === "all" || driver === selectedDriver)
      .flatMap(([driver, trips]) =>
        trips.map((positions, i) => ({ id: `${driver}#${i}`, color: colorFor(driver), positions })),
      );
    if (preview) {
      out.push(...preview.plan.traces.map((positions, i) => ({
        id: `preview#${i}`, color: colorFor(preview.driver), positions, dashed: true,
      })));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeLines, selectedDriver, preview, settings.driver_colors]);

  if (!me) return null;
  if (!canPlanRoutes(me)) {
    return <div className="empty">{t("You don’t have access to route planning.", "No tienes acceso a la planificación de rutas.")}</div>;
  }

  const shownDrivers = selectedDriver === "all"
    ? drivers.filter((u) => (byDriver.get(u.full_name) ?? []).length > 0)
    : drivers.filter((u) => u.full_name === selectedDriver);

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
          {geocoding > 0 && <span className="hint">{t("Locating addresses…", "Ubicando direcciones…")}</span>}
        </div>
      </div>

      {/* ---------- Driver switcher ---------- */}
      <div className="filters">
        <button className={"chip " + (selectedDriver === "all" ? "on" : "")} onClick={() => setSelectedDriver("all")}>
          {t("All drivers", "Todos los choferes")} <span className="cnt">{dayOrders.length - unassigned.length}</span>
        </button>
        {drivers.map((u) => (
          <button
            key={u.id}
            className={"chip " + (selectedDriver === u.full_name ? "on" : "")}
            onClick={() => setSelectedDriver(u.full_name)}
          >
            <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: colorFor(u.full_name), marginRight: 5, verticalAlign: "baseline" }} />
            {u.full_name} <span className="cnt">{(byDriver.get(u.full_name) ?? []).length}</span>
          </button>
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

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <LeafletMap points={points} lines={lines} height={360} />
      </div>
      <div className="hint" style={{ marginTop: 8, marginBottom: 14 }}>
        {t(
          "Numbered pins show a driver's optimized stop order, traced along actual roads once optimized. Gray pins still need a driver. A dashed line is a simulation, not saved yet.",
          "Los pines numerados muestran el orden optimizado de paradas, trazado sobre las calles reales una vez optimizada. Los pines grises aún necesitan chofer. Una línea punteada es una simulación, aún sin guardar.",
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

      {/* ---------- Unassigned pool ---------- */}
      <div className="card">
        <h2>📦 {t("Unassigned orders", "Órdenes sin asignar")} — {fmtDate(date)}</h2>
        {selectedDriver !== "all" && unassigned.length > 0 && (
          <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
            {t(
              `Simulate adds a stop to ${selectedDriver}'s day and shows the resulting route before anything is saved.`,
              `Simular agrega una parada al día de ${selectedDriver} y muestra la ruta resultante antes de guardar nada.`,
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
                  <th>{selectedDriver === "all" ? t("Assign to", "Asignar a") : ""}</th>
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
                        {selectedDriver === "all" ? (
                          <select defaultValue="" onChange={(e) => { if (e.target.value) assignTo(d.id, e.target.value); }} style={{ width: "auto" }}>
                            <option value="">{t("Select driver…", "Seleccione chofer…")}</option>
                            {drivers.map((u) => <option key={u.id} value={u.full_name}>{u.full_name}</option>)}
                          </select>
                        ) : (
                          <button
                            className="btn btn-ghost btn-sm"
                            disabled={previewBusy === d.id || busyDriver != null}
                            onClick={() => previewAdd(d, selectedDriver)}
                          >
                            {previewBusy === d.id ? "…" : `🔮 ${t("Simulate add", "Simular")}`}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---------- Per-driver routes ---------- */}
      {shownDrivers.map((u) => {
        const stops = byDriver.get(u.full_name) ?? [];
        const sequenced = stops.length > 0 && stops.every((d) => d.route_seq != null);
        const missingPins = stops.filter((d) => d.delivery_lat == null).length;
        const info = routeInfo[u.full_name];
        const capacity = capacityFor(u.full_name);
        const trips = splitIntoTrips(stops, capacity);
        return (
          <div className="card" key={u.id}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
              <span style={{ width: 14, height: 14, borderRadius: "50%", background: colorFor(u.full_name), border: "2px solid #fff", boxShadow: "0 0 0 1px var(--line)", flex: "0 0 auto" }} />
              <h2 style={{ margin: 0 }}>{u.full_name}</h2>
              <span className="count-tag">{stops.length} {t("stops", "paradas")}</span>
              {stops.length > 0 && trips.length > 1 && (
                <span className="sema" style={{ background: "var(--amber)", color: "#fff" }}>{trips.length} {t("truckloads", "viajes")}</span>
              )}
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
            {info && (
              <div className="hint" style={{ marginBottom: 8 }}>
                {t("Total", "Total")}: <b>{info.miles} mi</b> · {info.duration_text}
                {info.trips > 1 && ` · ${info.trips} ${t("round trips back to base to reload", "viajes de ida y vuelta a la tienda para recargar")}`}
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
                      <th>{t("Delivery Date", "Fecha de Entrega")}</th>
                      <th>{t("Windows", "Ventanas")}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {trips.map((batch, ti) => {
                      const startIdx = trips.slice(0, ti).reduce((n, b) => n + b.length, 0);
                      const load = batch.reduce((n, d) => n + (d.actual_pallets ?? d.est_pallets ?? 0), 0);
                      const free = Math.max(0, capacity - load);
                      return (
                        <Fragment key={ti}>
                          {trips.length > 1 && (
                            <tr>
                              <td colSpan={7} style={{ background: "var(--card-hover)", fontWeight: 700, fontSize: 12 }}>
                                🚚 {t("Truckload", "Viaje")} {ti + 1} — {load}/{capacity} {t("pallets", "tarimas")}
                                {free > 0 && <span style={{ color: "var(--green)", marginLeft: 6 }}>({free} {t("free", "libres")})</span>}
                              </td>
                            </tr>
                          )}
                          {batch.map((d, bi) => {
                            const i = startIdx + bi;
                            return (
                              <tr key={d.id}>
                                <td>{d.route_seq != null ? i + 1 : "—"}</td>
                                <td className="ordno">#{d.order_no}</td>
                                <td>{d.account || "—"}</td>
                                <td>{d.delivery_address || "—"}</td>
                                <td><DateCell d={d} date={date} onChange={reschedule} t={t} /></td>
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
          </div>
        );
      })}

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
