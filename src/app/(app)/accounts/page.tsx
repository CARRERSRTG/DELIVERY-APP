"use client";

import { useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { stageInfo, stageLabel } from "@/lib/constants";
import { OrderModal } from "@/components/OrderModal";
import { deliveryColumns, downloadCSV, fmtDate, fmtMoney, isOverdue, toCSV, todayISO } from "@/lib/utils";
import type { Delivery } from "@/lib/types";

// ============================================================
// Customer accounts — every order grouped by the customer it belongs to.
// Pick an account to see its whole delivery history, totals and open work.
// Read-only view over the orders they can already see. Not shown to sales or
// drivers — they work order-by-order, not account-by-account.
// ============================================================

interface AccountRow {
  name: string;
  orders: Delivery[];
  total: number;
  active: number;
  delivered: number;
  overdue: number;
  pallets: number;
  fees: number;
  lastDate: string | null;
}

const CLOSED = ["delivered", "canceled", "rejected"];

export default function AccountsPage() {
  const { me, deliveries, ready } = useData();
  const { lang, t } = usePrefs();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [open, setOpen] = useState<Delivery | null>(null);

  const accounts = useMemo<AccountRow[]>(() => {
    const map = new Map<string, Delivery[]>();
    for (const d of deliveries) {
      const key = (d.account || "").trim() || t("(no account)", "(sin cuenta)");
      (map.get(key) ?? map.set(key, []).get(key)!).push(d);
    }
    return [...map.entries()]
      .map(([name, orders]) => ({
        name,
        orders: orders.sort((a, b) => b.order_no - a.order_no),
        total: orders.length,
        active: orders.filter((d) => !CLOSED.includes(d.stage)).length,
        delivered: orders.filter((d) => d.stage === "delivered").length,
        overdue: orders.filter(isOverdue).length,
        pallets: Math.round(orders.reduce((s, d) => s + Number(d.actual_pallets ?? d.est_pallets ?? 0), 0)),
        fees: Math.round(orders.filter((d) => d.stage !== "canceled").reduce((s, d) => s + (d.delivery_fee ?? 0), 0) * 100) / 100,
        lastDate: orders.map((d) => d.delivery_date).filter(Boolean).sort().reverse()[0] ?? null,
      }))
      .sort((a, b) => b.total - a.total);
  }, [deliveries, t]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return accounts;
    return accounts.filter((a) => a.name.toLowerCase().includes(needle));
  }, [accounts, q]);

  const current = picked ? accounts.find((a) => a.name === picked) ?? null : null;

  if (!me) return null;
  if (me.role === "sales" || me.role === "driver" || me.role === "warehouse") return <div className="empty">{t("Not available for your role.", "No disponible para su rol.")}</div>;

  const exportAccount = (a: AccountRow) => {
    const headers = deliveryColumns(a.orders[0]).map(([h]) => h).concat("Stage");
    const data = a.orders.map((d) => deliveryColumns(d).map(([, v]) => v).concat(d.stage));
    downloadCSV(`account_${a.name.replace(/[^a-z0-9]+/gi, "_")}_${todayISO()}.csv`, toCSV(headers, data));
  };

  // ---------- Detail: one account's history ----------
  if (current) {
    return (
      <>
        <div className="page-head">
          <h2>
            <button className="btn btn-ghost btn-sm" onClick={() => setPicked(null)}>← {t("Accounts", "Cuentas")}</button>{" "}
            {current.name}
          </h2>
          <button className="btn btn-ghost" onClick={() => exportAccount(current)}>⬇ {t("Export", "Exportar")}</button>
        </div>

        <div className="kpi-grid">
          <div className="kpi"><b>{current.total}</b><span>{t("Orders", "Órdenes")}</span></div>
          <div className="kpi"><b style={{ color: "var(--accent)" }}>{current.active}</b><span>{t("Open", "Abiertas")}</span></div>
          <div className="kpi"><b style={{ color: "var(--green)" }}>{current.delivered}</b><span>{t("Delivered", "Entregadas")}</span></div>
          <div className="kpi"><b style={{ color: current.overdue ? "var(--red)" : undefined }}>{current.overdue}</b><span>{t("Overdue", "Atrasadas")}</span></div>
          <div className="kpi"><b>{current.pallets}</b><span>{t("Pallets", "Tarimas")}</span></div>
          <div className="kpi"><b style={{ color: "var(--green)", fontSize: 17 }}>{fmtMoney(current.fees)}</b><span>{t("Fees", "Cobros")}</span></div>
        </div>

        <div className="card">
          <h2>🕑 {t("Delivery history", "Historial de entregas")}</h2>
          <div className="bar-list">
            {current.orders.map((d) => (
              <button key={d.id} className="acct-row" style={{ textAlign: "left", cursor: "pointer" }} onClick={() => setOpen(d)}>
                <span className="ordno">#{d.order_no}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {d.delivery_address || d.store || "—"}
                </span>
                <span className="hint">{fmtDate(d.delivery_date)}</span>
                {d.delivery_fee != null && <span className="hint">{fmtMoney(d.delivery_fee)}</span>}
                <span className="sema" style={{ background: stageInfo(d.stage).color, color: "#fff" }}>{stageLabel(d.stage, lang)}</span>
              </button>
            ))}
          </div>
        </div>

        {open && <OrderModal me={me} existing={open} startEditing={false} onClose={() => setOpen(null)} />}
      </>
    );
  }

  // ---------- List: all accounts ----------
  return (
    <>
      <div className="page-head">
        <h2>{t("Accounts", "Cuentas")} <span className="count-tag">{rows.length}</span></h2>
      </div>

      <div className="filters">
        <input
          style={{ maxWidth: 280 }}
          placeholder={t("Search account…", "Buscar cuenta…")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {!ready ? (
        <div className="empty">{t("Loading…", "Cargando…")}</div>
      ) : rows.length === 0 ? (
        <div className="empty">{t("No accounts match.", "No hay cuentas que coincidan.")}</div>
      ) : (
        <div className="tbl-scroll">
          <table className="orders">
            <thead>
              <tr>
                <th>{t("Account", "Cuenta")}</th>
                <th>{t("Orders", "Órdenes")}</th>
                <th>{t("Open", "Abiertas")}</th>
                <th>{t("Delivered", "Entregadas")}</th>
                <th>{t("Overdue", "Atrasadas")}</th>
                <th>{t("Pallets", "Tarimas")}</th>
                <th>{t("Fees", "Cobros")}</th>
                <th>{t("Last delivery", "Última entrega")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.name} className="clickable" onClick={() => setPicked(a.name)}>
                  <td style={{ fontWeight: 700 }}>{a.name}</td>
                  <td>{a.total}</td>
                  <td>{a.active || "—"}</td>
                  <td>{a.delivered || "—"}</td>
                  <td style={a.overdue ? { color: "var(--red)", fontWeight: 700 } : undefined}>{a.overdue || "—"}</td>
                  <td>{a.pallets || "—"}</td>
                  <td>{a.fees ? fmtMoney(a.fees) : "—"}</td>
                  <td>{a.lastDate ? fmtDate(a.lastDate) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
