"use client";

import { useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { canFulfill } from "@/lib/constants";
import { OrdersTable } from "@/components/OrdersTable";
import { OrderModal } from "@/components/OrderModal";
import type { Delivery } from "@/lib/types";

const TABS = [
  { key: "approved", label: "Approved (new)", label_es: "Aprobado (nuevo)" },
  { key: "fulfilling", label: "Fulfilling", label_es: "Preparando" },
  { key: "ready", label: "Ready", label_es: "Listo" },
  { key: "delivered", label: "Delivered", label_es: "Entregado" },
  { key: "all", label: "All", label_es: "Todas" },
] as const;

export default function WarehousePage() {
  const { me, deliveries, settings, ready } = useData();
  const { lang, t } = usePrefs();
  const [open, setOpen] = useState<Delivery | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("approved");
  // Shows every location by default; narrow to a single store when needed.
  const [storeFilter, setStoreFilter] = useState<string>("");

  const scoped = useMemo(
    () => (storeFilter ? deliveries.filter((d) => d.store === storeFilter) : deliveries),
    [deliveries, storeFilter],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of scoped) c[d.stage] = (c[d.stage] ?? 0) + 1;
    return c;
  }, [scoped]);

  const rows = useMemo(
    () => (tab === "all" ? [...scoped].sort((a, b) => b.order_no - a.order_no) : scoped.filter((d) => d.stage === tab)),
    [scoped, tab],
  );

  if (!me) return null;
  if (!canFulfill(me)) return <div className="empty">{t("You don’t have access to the warehouse queue.", "No tienes acceso a la cola del almacén.")}</div>;

  return (
    <>
      <div className="page-head">
        <h2>{t("Warehouse", "Almacén")} <span className="count-tag">{rows.length}</span></h2>
        <label style={{ margin: 0, textTransform: "none", letterSpacing: 0, display: "flex", alignItems: "center", gap: 8 }}>
          {t("Store", "Tienda")}
          <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)} style={{ width: "auto" }}>
            <option value="">{t("All stores", "Todas las tiendas")}</option>
            {settings.stores.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </label>
      </div>

      <div className="filters">
        {TABS.map((tb) => (
          <button key={tb.key} className={"chip " + (tab === tb.key ? "on" : "")} onClick={() => setTab(tb.key)}>
            {lang === "es" ? tb.label_es : tb.label} <span className="cnt">{tb.key === "all" ? scoped.length : (counts[tb.key] ?? 0)}</span>
          </button>
        ))}
      </div>

      {ready ? (
        <OrdersTable rows={rows} onOpen={setOpen} empty={t("Nothing in this queue.", "Nada en esta cola.")} />
      ) : (
        <div className="empty">{t("Loading…", "Cargando…")}</div>
      )}

      {open && <OrderModal me={me} existing={open} startEditing={false} onClose={() => setOpen(null)} />}
    </>
  );
}
