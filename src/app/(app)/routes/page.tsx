"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { canPlanRoutes, stageInfo, stageLabel } from "@/lib/constants";
import { parseWindow } from "@/lib/dispatch";
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
// ============================================================

const UNASSIGNED_COLOR = "#6b7686";
// Orders that need dispatching: approved but not yet picked up.
const ROUTE_STAGES: Delivery["stage"][] = ["approved", "fulfilling", "ready"];

export default function RoutesPage() {
  const { me, users, deliveries, settings, updateDelivery, ready } = useData();
  const { lang, t } = usePrefs();
  const [date, setDate] = useState(todayISO());
  const [busyDriver, setBusyDriver] = useState<string | null>(null);
  const [routeInfo, setRouteInfo] = useState<Record<string, { miles: number; duration_text: string }>>({});
  const [routeLines, setRouteLines] = useState<Record<string, [number, number][]>>({});
  const [err, setErr] = useState<string | null>(null);

  // A newly-viewed date invalidates any optimize summary/trace from before.
  useEffect(() => { setRouteInfo({}); setRouteLines({}); setErr(null); }, [date]);

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

  // A driver's stops changed, so any earlier optimize summary/trace for them
  // is stale — drop it rather than show a route that no longer matches.
  const clearRouteFor = (driver: string) => {
    setRouteInfo((p) => { const { [driver]: _drop, ...rest } = p; return rest; });
    setRouteLines((p) => { const { [driver]: _drop, ...rest } = p; return rest; });
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

  const optimize = async (driver: string) => {
    // The route starts at the earliest delivery window (OSRM only supports
    // a fixed start for the open trip solver — see /api/optimize-route);
    // everything after that is freely reordered for the shortest drive.
    const stops = (byDriver.get(driver) ?? [])
      .filter((d) => d.delivery_lat != null && d.delivery_lng != null)
      .sort((a, b) => (parseWindow(a.delivery_windows)?.[0] ?? Infinity) - (parseWindow(b.delivery_windows)?.[0] ?? Infinity));
    if (stops.length < 2) return;
    setBusyDriver(driver);
    setErr(null);
    try {
      const res = await fetch("/api/optimize-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stops: stops.map((d) => ({ id: d.id, lat: d.delivery_lat, lng: d.delivery_lng })) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Route optimization failed");
      await Promise.all((data.order as string[]).map((id, i) => updateDelivery(id, { route_seq: i })));
      setRouteInfo((p) => ({ ...p, [driver]: { miles: data.miles, duration_text: data.duration_text } }));
      const trace: [number, number][] = (data.geometry as [number, number][]).map(([lng, lat]) => [lat, lng]);
      setRouteLines((p) => ({ ...p, [driver]: trace }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyDriver(null);
    }
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

  const points: MapPoint[] = useMemo(() => {
    const pts: MapPoint[] = [];
    for (const d of dayOrders) {
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
  }, [dayOrders, byDriver, settings.driver_colors]);

  const lines: MapLine[] = useMemo(
    () =>
      Object.entries(routeLines).map(([driver, positions]) => ({
        id: driver,
        color: colorFor(driver),
        positions,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routeLines, settings.driver_colors],
  );

  if (!me) return null;
  if (!canPlanRoutes(me)) {
    return <div className="empty">{t("You don’t have access to route planning.", "No tienes acceso a la planificación de rutas.")}</div>;
  }

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
          "Numbered pins show a driver's optimized stop order, traced along actual roads once optimized. Gray pins still need a driver.",
          "Los pines numerados muestran el orden optimizado de paradas de un chofer, trazado sobre las calles reales una vez optimizada. Los pines grises aún necesitan chofer.",
        )}
      </div>

      <div className="card">
        <h2>📦 {t("Unassigned orders", "Órdenes sin asignar")} — {fmtDate(date)}</h2>
        {unassigned.length === 0 ? (
          <div className="empty">{t("Everything on this date has a driver.", "Todo en esta fecha ya tiene chofer.")}</div>
        ) : (
          <div className="tbl-scroll" style={{ border: "none" }}>
            <table className="orders" style={{ minWidth: 480 }}>
              <thead>
                <tr>
                  <th>{t("ID", "ID")}</th>
                  <th>{t("Account", "Cuenta")}</th>
                  <th>{t("Store", "Tienda")}</th>
                  <th>{t("Delivery Date", "Fecha de Entrega")}</th>
                  <th>{t("Windows", "Ventanas")}</th>
                  <th>{t("Status", "Estado")}</th>
                  <th>{t("Assign to", "Asignar a")}</th>
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
                      <td><DateCell d={d} date={date} onChange={reschedule} t={t} /></td>
                      <td>{d.delivery_windows || "—"}</td>
                      <td><span className="sema" style={{ background: s.color, color: "#fff" }}>{stageLabel(d.stage, lang)}</span></td>
                      <td>
                        <select defaultValue="" onChange={(e) => { if (e.target.value) assignTo(d.id, e.target.value); }} style={{ width: "auto" }}>
                          <option value="">{t("Select driver…", "Seleccione chofer…")}</option>
                          {drivers.map((u) => <option key={u.id} value={u.full_name}>{u.full_name}</option>)}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {drivers.filter((u) => (byDriver.get(u.full_name) ?? []).length > 0).map((u) => {
        const stops = byDriver.get(u.full_name) ?? [];
        const sequenced = stops.length > 0 && stops.every((d) => d.route_seq != null);
        const missingPins = stops.filter((d) => d.delivery_lat == null).length;
        const info = routeInfo[u.full_name];
        return (
          <div className="card" key={u.id}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
              <span style={{ width: 14, height: 14, borderRadius: "50%", background: colorFor(u.full_name), border: "2px solid #fff", boxShadow: "0 0 0 1px var(--line)", flex: "0 0 auto" }} />
              <h2 style={{ margin: 0 }}>{u.full_name}</h2>
              <span className="count-tag">{stops.length} {t("stops", "paradas")}</span>
              <span style={{ flex: 1 }} />
              <button className="btn btn-primary btn-sm" disabled={stops.length < 2 || busyDriver === u.full_name} onClick={() => optimize(u.full_name)}>
                {busyDriver === u.full_name ? "…" : `🧭 ${t("Optimize route", "Optimizar ruta")}`}
              </button>
            </div>
            {info && (
              <div className="hint" style={{ marginBottom: 8 }}>
                {t("Total", "Total")}: <b>{info.miles} mi</b> · {info.duration_text}
              </div>
            )}
            {!sequenced && (
              <div className="hint" style={{ marginBottom: 8 }}>
                {t("Not optimized yet — run “Optimize route” to get a sequence.", "Aún no optimizada — ejecute “Optimizar ruta” para obtener una secuencia.")}
              </div>
            )}
            {missingPins > 0 && (
              <div className="hint" style={{ marginBottom: 8 }}>
                {t(`${missingPins} stop(s) have no address pin yet, so they're left out of optimization.`, `${missingPins} parada(s) aún no tienen pin de dirección, así que se excluyen de la optimización.`)}
              </div>
            )}
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
                  {stops.map((d, i) => (
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
                  ))}
                </tbody>
              </table>
            </div>
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
