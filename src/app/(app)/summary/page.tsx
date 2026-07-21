"use client";

import { useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { stageInfo, stageLabel } from "@/lib/constants";
import { OrderModal } from "@/components/OrderModal";
import { fmtDate, fmtMoney, isOverdue, orderOwner } from "@/lib/utils";
import type { Delivery } from "@/lib/types";

// ============================================================
// "Summary" — every signed-in user gets this, whatever their role.
// A quick look at their own work: orders they logged, or runs assigned to
// them if they're a driver, plus the most recent ones.
// ============================================================

export default function SummaryPage() {
  const { me, deliveries } = useData();
  const { lang, t } = usePrefs();
  const [open, setOpen] = useState<Delivery | null>(null);

  // A driver's work is what's assigned to them; a sales rep's is what they
  // own (theirs, plus anything an office/admin/driver assigned to them);
  // everyone else's is what they personally logged.
  const mine = useMemo(() => {
    if (!me) return [];
    if (me.role === "driver") return deliveries.filter((d) => d.assigned_driver === me.full_name || d.created_by === me.id);
    if (me.role === "sales") return deliveries.filter((d) => orderOwner(d) === me.id);
    return deliveries.filter((d) => d.created_by === me.id);
  }, [deliveries, me]);

  const stats = useMemo(() => {
    const active = mine.filter((d) => !["delivered", "canceled", "rejected"].includes(d.stage));
    return {
      total: mine.length,
      active: active.length,
      delivered: mine.filter((d) => d.stage === "delivered").length,
      overdue: mine.filter(isOverdue).length,
      fees: Math.round(mine.filter((d) => d.stage !== "canceled").reduce((s, d) => s + (d.delivery_fee ?? 0), 0) * 100) / 100,
    };
  }, [mine]);

  const recent = useMemo(() => [...mine].sort((a, b) => b.order_no - a.order_no).slice(0, 8), [mine]);

  if (!me) return null;

  return (
    <>
      <div className="page-head"><h2>{t("Summary", "Resumen")}</h2></div>

      {/* ---------- My numbers ---------- */}
      <div className="card">
        <h2>📊 {me.role === "driver" ? t("My deliveries", "Mis entregas") : t("My orders", "Mis órdenes")}</h2>
        <div className="kpi-grid" style={{ marginBottom: 0 }}>
          <div className="kpi"><b>{stats.total}</b><span>{t("Total", "Total")}</span></div>
          <div className="kpi"><b style={{ color: "var(--accent)" }}>{stats.active}</b><span>{t("In progress", "En curso")}</span></div>
          <div className="kpi"><b style={{ color: "var(--green)" }}>{stats.delivered}</b><span>{t("Delivered", "Entregadas")}</span></div>
          <div className="kpi"><b style={{ color: stats.overdue ? "var(--red)" : undefined }}>{stats.overdue}</b><span>{t("Overdue", "Atrasadas")}</span></div>
          {me.role !== "driver" && (
            <div className="kpi"><b style={{ color: "var(--green)", fontSize: 17 }}>{fmtMoney(stats.fees)}</b><span>{t("Fees charged", "Cobros")}</span></div>
          )}
        </div>
      </div>

      {/* ---------- Recent work ---------- */}
      <div className="card">
        <h2>🕑 {t("Recent", "Recientes")}</h2>
        {recent.length === 0 ? (
          <div className="empty">{t("Nothing logged yet.", "Nada registrado aún.")}</div>
        ) : (
          <div className="bar-list">
            {recent.map((d) => (
              <button key={d.id} className="acct-row" style={{ textAlign: "left", cursor: "pointer" }} onClick={() => setOpen(d)}>
                <span className="ordno">#{d.order_no}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {d.account || t("(no account)", "(sin cuenta)")}
                </span>
                <span className="hint">{fmtDate(d.delivery_date)}</span>
                <span className="sema" style={{ background: stageInfo(d.stage).color, color: "#fff" }}>{stageLabel(d.stage, lang)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {open && <OrderModal me={me} existing={open} startEditing={false} onClose={() => setOpen(null)} />}
    </>
  );
}
