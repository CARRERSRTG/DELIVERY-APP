"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { driverNames, stageInfo, stageLabel } from "@/lib/constants";
import { OrderModal } from "@/components/OrderModal";
import { LeafletMap, type MapPoint, type MapLine } from "@/components/LeafletMap";
import { cityFromAddress, deliveryRisk, fallbackDriverColor, fmtDate, orderOwner, shiftDateISO, todayISO } from "@/lib/utils";
import { useAutoGeocode } from "@/lib/useAutoGeocode";
import { assignmentWarnings, recommendDriver, type AssignWarning } from "@/lib/dispatch";
import type { Delivery } from "@/lib/types";

const UNASSIGNED_COLOR = "#6b7686";
// Matches the Routes Manager default when a driver has no capacity set.
const DEFAULT_CAPACITY = 12;

export default function MapPage() {
  const { me, users, deliveries, settings, saveSettings, updateDelivery, addNote, notify, pushNotifs, ready } = useData();
  const { lang, t } = usePrefs();
  const [date, setDate] = useState(todayISO());
  const [open, setOpen] = useState<Delivery | null>(null);

  // Clicking a pin selects that order: we draw its pickup→dropoff route (with
  // distance + time) and let a dispatcher assign a driver on the spot.
  const [selected, setSelected] = useState<Delivery | null>(null);
  const [pickupPt, setPickupPt] = useState<{ lat: number; lng: number } | null>(null);
  const [route, setRoute] = useState<{ positions: [number, number][]; miles: number; duration: string } | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [assignBusy, setAssignBusy] = useState(false);
  // Draw every unassigned order's pickup→dropoff route on the map, so a
  // dispatcher sees where the day's open work needs to go at a glance.
  const [showRoutes, setShowRoutes] = useState(true);
  const [unassignedRoutes, setUnassignedRoutes] = useState<Record<string, [number, number][]>>({});

  const canManageColors = me?.role === "manager" || me?.role === "admin";
  // Everyone who reaches this page except sales can dispatch (warehouse/driver
  // are blocked below); sales sees pins but can't assign.
  const canAssign = !!me && me.role !== "sales";

  // Unlike the Orders page, sales sees every delivery's point on the map —
  // full situational awareness of the day's dispatch activity. But the Map
  // view never opens the order detail modal for sales, even for their own
  // orders — clicking a pin or row is purely visual here; they still edit
  // their orders from the Orders page as usual.
  const dayOrders = useMemo(() => {
    return deliveries.filter((d) => d.delivery_date === date && d.stage !== "canceled");
  }, [deliveries, date]);

  // Unassigned orders that have a delivery point — the ones we auto-route.
  const unassignedOrders = useMemo(
    () => dayOrders.filter((d) => !d.assigned_driver && d.delivery_lat != null && d.delivery_lng != null),
    [dayOrders],
  );

  const isMine = (d: Delivery) => me?.role !== "sales" || orderOwner(d) === me.id;

  const openPoint = (d: Delivery) => {
    if (me?.role !== "sales") setOpen(d);
  };

  // Geocode (and cache) any order on this date that has an address but no
  // point yet.
  const geocoding = useAutoGeocode(dayOrders, updateDelivery);

  const colorFor = (driver: string | null) => {
    if (!driver) return UNASSIGNED_COLOR;
    return settings.driver_colors?.[driver] || fallbackDriverColor(driver);
  };

  // Best-effort pickup coordinates for an order: its own captured point, else
  // geocode the pickup address (or the sold-from store's address).
  const resolvePickup = async (d: Delivery): Promise<{ lat: number; lng: number } | null> => {
    if (d.pickup_lat != null && d.pickup_lng != null) return { lat: d.pickup_lat, lng: d.pickup_lng };
    const addr = (d.pickup_address || settings.stores.find((s) => s.name === d.store)?.address || d.store || "").trim();
    if (!addr) return null;
    try {
      const res = await fetch("/api/geocode-point", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: addr }) });
      if (!res.ok) return null;
      const p = await res.json();
      return typeof p?.lat === "number" && typeof p?.lng === "number" ? p : null;
    } catch { return null; }
  };

  // Select an order (from a pin click): draw its pickup→dropoff route and time.
  const selectOrder = async (d: Delivery) => {
    setSelected(d);
    setRoute(null);
    setPickupPt(null);
    if (d.delivery_lat == null || d.delivery_lng == null) return;
    setRouteBusy(true);
    const pk = await resolvePickup(d);
    setPickupPt(pk);
    if (pk) {
      try {
        const res = await fetch("/api/optimize-route", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stops: [{ id: "p", lat: pk.lat, lng: pk.lng }, { id: "d", lat: d.delivery_lat, lng: d.delivery_lng }], roundtrip: false }),
        });
        const b = await res.json();
        if (res.ok && Array.isArray(b.geometry) && b.geometry.length) {
          setRoute({
            positions: (b.geometry as [number, number][]).map(([lng, lat]) => [lat, lng]),
            miles: b.miles ?? 0,
            duration: b.duration_text || "",
          });
        }
      } catch { /* leave route null */ }
    }
    setRouteBusy(false);
  };

  // Fill in each unassigned order's pickup→dropoff road route, one at a time
  // (throttled so we don't hammer the routing service), cached by order id.
  useEffect(() => {
    if (!showRoutes) return;
    let cancelled = false;
    (async () => {
      for (const d of unassignedOrders) {
        if (cancelled) return;
        if (unassignedRoutes[d.id]) continue;
        const pk = await resolvePickup(d);
        if (cancelled) return;
        if (!pk) continue;
        try {
          const res = await fetch("/api/optimize-route", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stops: [{ id: "p", lat: pk.lat, lng: pk.lng }, { id: "d", lat: d.delivery_lat, lng: d.delivery_lng }], roundtrip: false }),
          });
          const b = await res.json();
          if (!cancelled && res.ok && Array.isArray(b.geometry) && b.geometry.length) {
            const positions = (b.geometry as [number, number][]).map(([lng, lat]) => [lat, lng] as [number, number]);
            setUnassignedRoutes((prev) => ({ ...prev, [d.id]: positions }));
          }
        } catch { /* skip this one */ }
        await new Promise((r) => setTimeout(r, 120));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRoutes, unassignedOrders]);

  const closePanel = () => { setSelected(null); setRoute(null); setPickupPt(null); };

  const assignDriver = async (driver: string | null) => {
    if (!selected) return;
    setAssignBusy(true);
    const prev = selected.assigned_driver;
    const ok = await updateDelivery(selected.id, { assigned_driver: driver });
    setAssignBusy(false);
    if (ok) {
      setSelected((s) => (s ? { ...s, assigned_driver: driver } : s));
      // Audit trail: record the (re)assignment as a note.
      addNote(selected.id, driver
        ? `Assigned to ${driver}${prev && prev !== driver ? ` (from ${prev})` : ""}`
        : `Unassigned${prev ? ` (was ${prev})` : ""}`);
      notify(driver
        ? t(`#${selected.order_no} assigned to ${driver}`, `#${selected.order_no} asignada a ${driver}`)
        : t(`#${selected.order_no} unassigned`, `#${selected.order_no} sin asignar`));
      // Notify the driver in-app that a delivery landed on their plate.
      if (driver) {
        const du = users.find((u) => u.role === "driver" && u.full_name === driver);
        if (du) {
          await pushNotifs([{
            user_id: du.id,
            delivery_id: selected.id,
            order_no: selected.order_no,
            kind: "assigned",
            message: `Order #${selected.order_no} was assigned to you${selected.delivery_windows ? ` (${selected.delivery_windows})` : ""}`,
          }]);
        }
      }
    }
  };

  const points: MapPoint[] = useMemo(
    () => {
      const pts: MapPoint[] = dayOrders
        .filter((d) => d.delivery_lat != null && d.delivery_lng != null)
        .map((d) => ({
          id: d.id,
          lat: d.delivery_lat!,
          lng: d.delivery_lng!,
          color: colorFor(d.assigned_driver),
          // Not your order (sales only): the label reveals nothing beyond
          // "there's a delivery here" — no account, no driver.
          label: isMine(d)
            ? `#${d.order_no} — ${d.account || t("(no account)", "(sin cuenta)")} — ${d.assigned_driver || t("Unassigned", "Sin asignar")}`
            : t("Delivery", "Entrega"),
          // Dim everything except the selected order once one is picked.
          dimmed: !!selected && d.id !== selected.id,
        }));
      // The selected order's pickup point, marked "P".
      if (selected && pickupPt) {
        pts.push({ id: "__pickup", lat: pickupPt.lat, lng: pickupPt.lng, color: "#111827", label: `${t("Pickup", "Recolección")}: ${selected.store || ""}`, badge: "P" });
      }
      return pts;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dayOrders, settings.driver_colors, me, selected, pickupPt],
  );

  // Unassigned orders' pickup→dropoff routes (dimmed when one order is focused),
  // plus the focused order's own route on top.
  const lines: MapLine[] = useMemo(() => {
    const out: MapLine[] = [];
    if (showRoutes) {
      for (const d of unassignedOrders) {
        const pos = unassignedRoutes[d.id];
        if (pos && pos.length) out.push({ id: `u:${d.id}`, color: UNASSIGNED_COLOR, positions: pos, dashed: true, dimmed: !!selected });
      }
    }
    if (route) out.push({ id: "route", color: "#2456c9", positions: route.positions });
    return out;
  }, [route, showRoutes, unassignedOrders, unassignedRoutes, selected]);

  // Zoom to the selected order's route when one is drawn.
  const fitTo = useMemo<[number, number][] | undefined>(
    () => (route && route.positions.length ? route.positions : undefined),
    [route],
  );

  const drivers = driverNames(users);
  const missingPoints = dayOrders.length - points.length;

  // Smart-assist for the selected order: a recommended driver, plus warnings
  // (window conflict / over capacity) for whoever is currently assigned.
  const capacityOf = (n: string) => settings.driver_capacity?.[n] ?? DEFAULT_CAPACITY;
  const recommendation = useMemo(
    () => (selected ? recommendDriver(selected, drivers, deliveries, capacityOf) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, drivers, deliveries, settings.driver_capacity],
  );
  const currentWarnings = useMemo(
    () => (selected?.assigned_driver ? assignmentWarnings(selected, selected.assigned_driver, deliveries, capacityOf(selected.assigned_driver)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, deliveries, settings.driver_capacity],
  );
  const warnText = (w: AssignWarning) =>
    w.kind === "conflict"
      ? t(
          `Overlaps ${w.conflicts!.map((c) => `#${c.order_no} (${c.delivery_windows || "?"})`).join(", ")}`,
          `Se traslapa con ${w.conflicts!.map((c) => `#${c.order_no} (${c.delivery_windows || "?"})`).join(", ")}`,
        )
      : t(
          `Over capacity: ${w.used} + ${w.adding} > ${w.capacity} pallets`,
          `Sobre capacidad: ${w.used} + ${w.adding} > ${w.capacity} tarimas`,
        );

  const riskChip = (risk: "overdue" | "at_risk" | null) => {
    if (!risk) return null;
    const over = risk === "overdue";
    return (
      <span className="sema" style={{ background: over ? "var(--red, #d64545)" : "var(--amber, #e9a13b)", color: "#fff", marginLeft: 6 }}>
        {over ? t("Overdue", "Atrasada") : t("At risk", "En riesgo")}
      </span>
    );
  };

  // From/To/pallets summary for this date — same "own orders only" boundary
  // as everything else on this page for sales.
  const cityNames = settings.stores.map((s) => s.name);
  const summaryRows = useMemo(
    () =>
      dayOrders
        .filter(isMine)
        .map((d) => ({
          id: d.id,
          order_no: d.order_no,
          from: d.store || "—",
          to: cityFromAddress(d.delivery_address, cityNames),
          pallets: d.actual_pallets ?? d.est_pallets ?? null,
          windows: d.delivery_windows || "",
          stage: d.stage,
          risk: deliveryRisk(d),
        }))
        .sort((a, b) => a.windows.localeCompare(b.windows) || a.order_no - b.order_no),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dayOrders, me],
  );
  const totalPallets = summaryRows.reduce((sum, r) => sum + (r.pallets ?? 0), 0);

  if (!me) return null;
  if (me.role === "warehouse" || me.role === "driver") return <div className="empty">{t("Not available for your role.", "No disponible para su rol.")}</div>;

  return (
    <>
      <div className="page-head">
        <h2>{t("Delivery Map", "Mapa de Entregas")} <span className="count-tag">{points.length}</span></h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div className="viewtoggle">
            <button className="vt" onClick={() => setDate((d) => shiftDateISO(d, -1))} title={t("Previous day", "Día anterior")}>◀</button>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: "auto" }} />
            <button className="vt" onClick={() => setDate((d) => shiftDateISO(d, 1))} title={t("Next day", "Día siguiente")}>▶</button>
          </div>
          {date !== todayISO() && (
            <button className="btn btn-ghost btn-sm" onClick={() => setDate(todayISO())}>{t("Today", "Hoy")}</button>
          )}
          {canAssign && unassignedOrders.length > 0 && (
            <button
              className={"btn btn-sm " + (showRoutes ? "btn-primary" : "btn-ghost")}
              onClick={() => setShowRoutes((v) => !v)}
              title={t("Show each unassigned order's pickup→dropoff route", "Mostrar la ruta recolección→entrega de cada orden sin asignar")}
            >
              🧭 {t("Unassigned routes", "Rutas sin asignar")} ({unassignedOrders.length})
            </button>
          )}
          {geocoding > 0 && <span className="hint">{t("Locating addresses…", "Ubicando direcciones…")}</span>}
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <LeafletMap points={points} lines={lines} fitTo={fitTo} onPointClick={(id) => {
          if (id === "__pickup") return;
          const d = dayOrders.find((x) => x.id === id);
          if (!d) return;
          // Sales: pins are visual only. Everyone else: open the dispatch panel.
          if (canAssign) selectOrder(d); else openPoint(d);
        }} />
      </div>

      {selected && canAssign && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>
              #{selected.order_no} — {selected.account || t("(no account)", "(sin cuenta)")}{" "}
              <span className="sema" style={{ background: stageInfo(selected.stage).color, color: "#fff" }}>{stageLabel(selected.stage, lang)}</span>
              {riskChip(deliveryRisk(selected))}
            </h2>
            <button className="btn btn-ghost btn-sm" onClick={closePanel}>✕ {t("Close", "Cerrar")}</button>
          </div>
          <div className="detail-row"><span className="dk">{t("Route", "Ruta")}</span><span className="dv">{selected.store || "—"} → {cityFromAddress(selected.delivery_address, cityNames) || selected.delivery_address || "—"}</span></div>
          <div className="detail-row"><span className="dk">{t("Window", "Ventana")}</span><span className="dv">{selected.delivery_windows || "—"}</span></div>
          <div className="detail-row"><span className="dk">{t("Pallets", "Tarimas")}</span><span className="dv">{selected.actual_pallets ?? selected.est_pallets ?? "—"}</span></div>
          <div className="detail-row">
            <span className="dk">{t("Pickup → Dropoff", "Recolección → Entrega")}</span>
            <span className="dv" style={{ fontWeight: 700 }}>
              {routeBusy
                ? t("Calculating…", "Calculando…")
                : route
                  ? `${route.miles} mi · ${route.duration}`
                  : t("Route unavailable", "Ruta no disponible")}
            </span>
          </div>
          {recommendation && recommendation.driver !== selected.assigned_driver && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13.5 }}>
                {t("Suggested", "Sugerido")}: <b>★ {recommendation.driver}</b>
                {recommendation.warnings.length === 0
                  ? <span className="sema" style={{ background: "var(--green)", color: "#fff", marginLeft: 8 }}>{t("clear", "sin conflictos")}</span>
                  : <span className="hint" style={{ marginLeft: 8 }}>{t("(best available)", "(mejor disponible)")}</span>}
              </span>
              <button className="btn btn-sm btn-primary" disabled={assignBusy} onClick={() => assignDriver(recommendation.driver)}>
                {t("Assign", "Asignar")}
              </button>
            </div>
          )}

          <div className="field" style={{ maxWidth: 320, marginTop: 10 }}>
            <label>{t("Assign driver", "Asignar chofer")}</label>
            <select value={selected.assigned_driver ?? ""} disabled={assignBusy} onChange={(e) => assignDriver(e.target.value || null)}>
              <option value="">{t("Unassigned", "Sin asignar")}</option>
              {drivers.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          {currentWarnings.length > 0 && (
            <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
              {currentWarnings.map((w, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 12px", borderRadius: 8, background: "color-mix(in srgb, var(--amber, #e9a13b) 14%, transparent)", border: "1px solid color-mix(in srgb, var(--amber, #e9a13b) 45%, transparent)", fontSize: 13.5 }}>
                  <span aria-hidden>⚠️</span><span>{warnText(w)}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setOpen(selected)}>{t("Open full order", "Abrir orden completa")}</button>
          </div>
        </div>
      )}

      {missingPoints > 0 && (
        <div className="hint" style={{ marginTop: 8 }}>
          {t(
            `${missingPoints} order(s) on this date have no address to place on the map yet.`,
            `${missingPoints} orden(es) en esta fecha aún no tienen dirección para ubicar en el mapa.`,
          )}
        </div>
      )}

      <div className="card">
        <h2>📋 {t("Summary", "Resumen")} — {fmtDate(date)}</h2>
        {summaryRows.length === 0 ? (
          <div className="empty">{t("No orders on this date.", "Sin órdenes en esta fecha.")}</div>
        ) : (
          <div className="tbl-scroll" style={{ border: "none" }}>
            <table className="orders" style={{ minWidth: 420 }}>
              <thead>
                <tr>
                  <th>{t("ID", "ID")}</th>
                  <th>{t("From", "Desde")}</th>
                  <th>{t("To", "Hasta")}</th>
                  <th>{t("Windows", "Ventanas")}</th>
                  <th>{t("Status", "Estado")}</th>
                  <th>{t("Pallets", "Tarimas")}</th>
                </tr>
              </thead>
              <tbody>
                {summaryRows.map((r) => {
                  const s = stageInfo(r.stage);
                  return (
                    <tr
                      key={r.id}
                      className={me.role === "sales" ? "" : "clickable"}
                      onClick={() => { const d = dayOrders.find((x) => x.id === r.id); if (d) openPoint(d); }}
                    >
                      <td className="ordno">#{r.order_no}</td>
                      <td>{r.from}</td>
                      <td>{r.to}</td>
                      <td>{r.windows || "—"}</td>
                      <td><span className="sema" style={{ background: s.color, color: "#fff" }}>{stageLabel(r.stage, lang)}</span>{riskChip(r.risk)}</td>
                      <td>{r.pallets ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5} style={{ fontWeight: 700, textAlign: "right" }}>{t("Total pallets", "Total de tarimas")}</td>
                  <td style={{ fontWeight: 700 }}>{totalPallets}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>🎨 {t("Driver colors", "Colores de chofer")}</h2>
        {!canManageColors && <p className="hint" style={{ marginTop: 0 }}>{t("Assigned by a manager or admin.", "Asignados por un gerente o administrador.")}</p>}
        {drivers.length === 0 ? (
          <div className="empty">{t("No one has the Driver role yet.", "Nadie tiene el rol de Chofer todavía.")}</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {drivers.map((name) => (
              <div key={name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 16, height: 16, borderRadius: "50%", background: colorFor(name), border: "2px solid #fff", boxShadow: "0 0 0 1px var(--line)", flex: "0 0 auto" }} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{name}</span>
                {canManageColors && (
                  <input
                    type="color"
                    value={/^#[0-9a-f]{6}$/i.test(settings.driver_colors?.[name] || "") ? settings.driver_colors![name] : fallbackDriverColor(name)}
                    onChange={(e) => saveSettings({ driver_colors: { ...(settings.driver_colors ?? {}), [name]: e.target.value } })}
                    style={{ width: 28, height: 28, padding: 0, border: "none", background: "none", cursor: "pointer" }}
                  />
                )}
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 16, height: 16, borderRadius: "50%", background: UNASSIGNED_COLOR, border: "2px solid #fff", boxShadow: "0 0 0 1px var(--line)" }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{t("Unassigned", "Sin asignar")}</span>
            </div>
          </div>
        )}
      </div>

      {!ready && <div className="empty">{t("Loading…", "Cargando…")}</div>}

      {open && <OrderModal me={me} existing={open} startEditing={false} onClose={() => setOpen(null)} />}
    </>
  );
}
