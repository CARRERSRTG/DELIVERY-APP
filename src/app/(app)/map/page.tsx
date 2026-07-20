"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { driverNames } from "@/lib/constants";
import { OrderModal } from "@/components/OrderModal";
import { LeafletMap, type MapPoint } from "@/components/LeafletMap";
import { shiftDateISO, todayISO } from "@/lib/utils";
import type { Delivery } from "@/lib/types";

const UNASSIGNED_COLOR = "#6b7686";

/** Deterministic fallback color for a driver with no assigned color yet,
 * so pins are still distinguishable before a manager sets real colors. */
function fallbackColor(name: string): string {
  const palette = ["#2456c9", "#0f8a8a", "#d1782e", "#7c4dbc", "#1f9d61", "#d64545", "#e9a13b"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

export default function MapPage() {
  const { me, users, deliveries, settings, saveSettings, updateDelivery, ready } = useData();
  const { t } = usePrefs();
  const [date, setDate] = useState(todayISO());
  const [open, setOpen] = useState<Delivery | null>(null);
  const [restricted, setRestricted] = useState(false);
  const [geocoding, setGeocoding] = useState(0);
  const geocodingInFlight = useRef(new Set<string>());

  const canManageColors = me?.role === "manager" || me?.role === "admin";

  // Unlike the Orders page, sales sees every delivery's point on the map —
  // full situational awareness of the day's dispatch activity. What happens
  // on CLICK is what's restricted: opening a pin only shows the full order
  // if it's theirs; for anyone else's it just confirms a delivery is there.
  const dayOrders = useMemo(() => {
    return deliveries.filter((d) => d.delivery_date === date && d.stage !== "canceled");
  }, [deliveries, date]);

  const isMine = (d: Delivery) => me?.role !== "sales" || d.created_by === me.id;

  const openPoint = (d: Delivery) => {
    if (isMine(d)) setOpen(d);
    else setRestricted(true);
  };

  // Geocode (and cache) any order on this date that has an address but no
  // point yet. Sequential + slightly throttled — the free OSM fallback
  // provider asks for at most ~1 request/second.
  useEffect(() => {
    let cancelled = false;
    const todo = dayOrders.filter(
      (d) => d.delivery_lat == null && (d.delivery_address || "").trim() && !geocodingInFlight.current.has(d.id),
    );
    if (!todo.length) return;

    (async () => {
      for (const d of todo) {
        if (cancelled) return;
        geocodingInFlight.current.add(d.id);
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
        geocodingInFlight.current.delete(d.id);
        setGeocoding((n) => n - 1);
        await new Promise((r) => setTimeout(r, 350));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayOrders]);

  const colorFor = (driver: string | null) => {
    if (!driver) return UNASSIGNED_COLOR;
    return settings.driver_colors?.[driver] || fallbackColor(driver);
  };

  const points: MapPoint[] = useMemo(
    () =>
      dayOrders
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
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dayOrders, settings.driver_colors, me],
  );

  const drivers = driverNames(users);
  const missingPoints = dayOrders.length - points.length;

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
          {geocoding > 0 && <span className="hint">{t("Locating addresses…", "Ubicando direcciones…")}</span>}
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <LeafletMap points={points} onPointClick={(id) => {
          const d = dayOrders.find((x) => x.id === id);
          if (d) openPoint(d);
        }} />
      </div>

      {missingPoints > 0 && (
        <div className="hint" style={{ marginTop: 8 }}>
          {t(
            `${missingPoints} order(s) on this date have no address to place on the map yet.`,
            `${missingPoints} orden(es) en esta fecha aún no tienen dirección para ubicar en el mapa.`,
          )}
        </div>
      )}

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
                    value={/^#[0-9a-f]{6}$/i.test(settings.driver_colors?.[name] || "") ? settings.driver_colors![name] : fallbackColor(name)}
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

      {restricted && (
        <div className="overlay" onClick={() => setRestricted(false)}>
          <div className="modal" style={{ maxWidth: 320, textAlign: "center" }}>
            <div style={{ fontSize: 36 }}>📦</div>
            <p style={{ margin: "10px 0 16px" }}>{t("There's a delivery here.", "Hay una entrega aquí.")}</p>
            <button className="btn btn-primary" onClick={() => setRestricted(false)}>{t("OK", "Aceptar")}</button>
          </div>
        </div>
      )}
    </>
  );
}
