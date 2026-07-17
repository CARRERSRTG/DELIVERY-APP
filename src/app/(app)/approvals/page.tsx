"use client";

import { useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { canApprove, STAGES, stageLabel } from "@/lib/constants";
import { OrdersTable } from "@/components/OrdersTable";
import { OrderModal } from "@/components/OrderModal";
import type { Delivery } from "@/lib/types";

export default function ApprovalsPage() {
  const { me, deliveries, ready } = useData();
  const { lang, t } = usePrefs();
  const [open, setOpen] = useState<Delivery | null>(null);
  // Any workflow stage, or "all" — the manager has full visibility.
  const [tab, setTab] = useState<string>("pending");

  // "all" gives the manager full visibility of every order, not just the
  // approval queue (newest first).
  const rows = useMemo(
    () => (tab === "all" ? [...deliveries].sort((a, b) => b.order_no - a.order_no) : deliveries.filter((d) => d.stage === tab)),
    [deliveries, tab],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of deliveries) c[d.stage] = (c[d.stage] ?? 0) + 1;
    return c;
  }, [deliveries]);

  if (!me) return null;
  if (!canApprove(me)) return <div className="empty">{t("You don’t have access to approvals.", "No tienes acceso a las aprobaciones.")}</div>;

  return (
    <>
      <div className="page-head">
        <h2>{t("Approvals", "Aprobaciones")} <span className="count-tag">{rows.length}</span></h2>
      </div>

      <div className="filters">
        <button className={"chip " + (tab === "all" ? "on" : "")} onClick={() => setTab("all")}>
          {t("All", "Todas")} <span className="cnt">{deliveries.length}</span>
        </button>
        {STAGES.map((s) => (
          <button key={s.key} className={"chip " + (tab === s.key ? "on" : "")} onClick={() => setTab(s.key)}>
            {stageLabel(s.key, lang)} <span className="cnt">{counts[s.key] ?? 0}</span>
          </button>
        ))}
      </div>

      {ready ? (
        <OrdersTable
          rows={rows}
          onOpen={setOpen}
          empty={tab === "pending" ? t("Nothing waiting for approval. 🎉", "Nada esperando aprobación. 🎉") : t("No orders here.", "No hay órdenes aquí.")}
        />
      ) : (
        <div className="empty">{t("Loading…", "Cargando…")}</div>
      )}

      {open && <OrderModal me={me} existing={open} startEditing={false} onClose={() => setOpen(null)} />}
    </>
  );
}
