"use client";

import { useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { canCreate, canDeliver } from "@/lib/constants";
import { routeOrder } from "@/lib/dispatch";
import { OrdersTable } from "@/components/OrdersTable";
import { OrderModal } from "@/components/OrderModal";
import type { Delivery } from "@/lib/types";

const TABS = [
  { key: "ready", label: "To pick up", label_es: "Por recoger" },
  { key: "picked_up", label: "Out for delivery", label_es: "En reparto" },
  { key: "delivered", label: "Delivered", label_es: "Entregadas" },
  { key: "fulfilling", label: "Being prepared", label_es: "En preparación" },
  { key: "all", label: "All", label_es: "Todas" },
] as const;

export default function DriverPage() {
  const { me, deliveries, settings, ready } = useData();
  const { lang, t } = usePrefs();
  const [open, setOpen] = useState<Delivery | null>(null);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("ready");
  // Shows every location by default; narrow to a single store when needed.
  const [storeFilter, setStoreFilter] = useState<string>("");

  // Orders for the chosen store, plus anything assigned to this driver by name.
  const scoped = useMemo(() => {
    if (!me) return [];
    if (!storeFilter) return deliveries;
    return deliveries.filter((d) => d.store === storeFilter || d.assigned_driver === me.full_name);
  }, [deliveries, me, storeFilter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of scoped) c[d.stage] = (c[d.stage] ?? 0) + 1;
    return c;
  }, [scoped]);

  // For the active delivery tabs, sequence stops by delivery window for an
  // efficient route (nearest window first, then shortest drive).
  const routed = tab === "ready" || tab === "picked_up";
  const rows = useMemo(() => {
    const list = tab === "all" ? [...scoped].sort((a, b) => b.order_no - a.order_no) : scoped.filter((d) => d.stage === tab);
    return routed ? routeOrder(list) : list;
  }, [scoped, tab, routed]);

  if (!me) return null;
  if (!canDeliver(me)) {
    return <div className="empty">{t("You don’t have access to the driver view.", "No tienes acceso a la vista de chofer.")}</div>;
  }

  return (
    <>
      <div className="page-head">
        <h2>{t("Driver", "Chofer")} <span className="count-tag">{rows.length}</span></h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ margin: 0, textTransform: "none", letterSpacing: 0, display: "flex", alignItems: "center", gap: 8 }}>
            {t("Store", "Tienda")}
            <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)} style={{ width: "auto" }}>
              <option value="">{t("All stores", "Todas las tiendas")}</option>
              {settings.stores.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          </label>
          {canCreate(me) && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>+ {t("New order", "Nueva orden")}</button>
          )}
        </div>
      </div>

      <div className="filters">
        {TABS.map((tb) => (
          <button key={tb.key} className={"chip " + (tab === tb.key ? "on" : "")} onClick={() => setTab(tb.key)}>
            {lang === "es" ? tb.label_es : tb.label} <span className="cnt">{tb.key === "all" ? scoped.length : (counts[tb.key] ?? 0)}</span>
          </button>
        ))}
      </div>

      {routed && rows.length > 1 && (
        <div className="hint" style={{ marginTop: -4, marginBottom: 10 }}>
          🧭 {t("Ordered by delivery window for an efficient route.", "Ordenado por ventana de entrega para una ruta eficiente.")}
        </div>
      )}

      {ready ? (
        <OrdersTable rows={rows} onOpen={setOpen} empty={t("Nothing here right now.", "Nada aquí por ahora.")} />
      ) : (
        <div className="empty">{t("Loading…", "Cargando…")}</div>
      )}

      {open && <OrderModal me={me} existing={open} startEditing={false} onClose={() => setOpen(null)} />}
      {creating && <OrderModal me={me} existing={null} startEditing onClose={() => setCreating(false)} />}
    </>
  );
}
