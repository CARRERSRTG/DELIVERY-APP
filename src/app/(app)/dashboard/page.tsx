"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { stageInfo, stageLabel, STAGES } from "@/lib/constants";
import {
  approvalTurnaroundMs, computeKpis, countByStage, driverStats,
  groupVolume, inDateRange, overdueOrders, salesRepStatsThisMonth,
} from "@/lib/analytics";
import {
  daysBetween, downloadCSV, endOfMonthISO, endOfWeekISO, fmtDate, fmtDuration, fmtMoney,
  shiftDateISO, shiftMonthISO, startOfMonthISO, startOfWeekISO, toCSV, todayISO, deliveryColumns,
} from "@/lib/utils";
import type { Stage } from "@/lib/types";

// Default the date-range to the last 30 days.
function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// Which quick-range is active — governs how the ◀ / ▶ arrows step the range:
// a week steps by 7 days, a month steps by a calendar month (so it lands on
// real month boundaries instead of drifting), a custom range steps by its
// own exact length.
type RangeMode = "week" | "month" | "custom";

export default function DashboardPage() {
  const { me, users, deliveries, events, ready } = useData();
  const { lang, t } = usePrefs();
  const router = useRouter();
  const [from, setFrom] = useState(daysAgoISO(30));
  const [to, setTo] = useState(todayISO());
  const [rangeMode, setRangeMode] = useState<RangeMode>("custom");

  const setRange = (f: string, tt: string, mode: RangeMode) => {
    setFrom(f);
    setTo(tt > todayISO() ? todayISO() : tt);
    setRangeMode(mode);
  };

  const thisWeek = () => setRange(startOfWeekISO(), endOfWeekISO(), "week");
  const thisMonth = () => setRange(startOfMonthISO(), endOfMonthISO(), "month");
  const lastMonth = () => {
    const anchor = shiftMonthISO(startOfMonthISO(), -1);
    setRange(startOfMonthISO(new Date(anchor + "T12:00:00")), endOfMonthISO(new Date(anchor + "T12:00:00")), "month");
  };

  const step = (dir: 1 | -1) => {
    if (rangeMode === "month") {
      const nextFrom = shiftMonthISO(from, dir);
      setRange(startOfMonthISO(new Date(nextFrom + "T12:00:00")), endOfMonthISO(new Date(nextFrom + "T12:00:00")), "month");
    } else if (rangeMode === "week") {
      setRange(shiftDateISO(from, dir * 7), shiftDateISO(to, dir * 7), "week");
    } else {
      const span = daysBetween(to, from) + 1; // inclusive day count
      setRange(shiftDateISO(from, dir * span), shiftDateISO(to, dir * span), "custom");
    }
  };

  // Everything below is scoped to the selected delivery-date range.
  const scoped = useMemo(() => inDateRange(deliveries, from, to), [deliveries, from, to]);

  const kpis = useMemo(() => computeKpis(scoped), [scoped]);
  const stageCounts = useMemo(() => countByStage(scoped, STAGES.map((s) => s.key) as Stage[]), [scoped]);
  const drivers = useMemo(() => driverStats(scoped), [scoped]);
  const stores = useMemo(() => groupVolume(scoped, "store"), [scoped]);
  const accounts = useMemo(() => groupVolume(scoped, "account").slice(0, 8), [scoped]);
  const turnaround = useMemo(() => approvalTurnaroundMs(scoped, events), [scoped, events]);
  const overdue = useMemo(() => overdueOrders(scoped), [scoped]);
  // Not scoped to the from/to range picker above — this is always "this
  // calendar month", regardless of what range is selected elsewhere on the page.
  const repStats = useMemo(() => salesRepStatsThisMonth(deliveries, users), [deliveries, users]);

  if (!me) return null;

  const maxStage = Math.max(1, ...stageCounts.map((s) => s.count));
  const maxStore = Math.max(1, ...stores.map((s) => s.total));

  const exportRange = () => {
    if (!scoped.length) return;
    const headers = deliveryColumns(scoped[0]).map(([h]) => h).concat("Stage");
    const data = scoped.map((d) => deliveryColumns(d).map(([, v]) => v).concat(d.stage));
    downloadCSV(`deliveries_${from}_to_${to}.csv`, toCSV(headers, data));
  };

  const openOrder = (id: string) => router.push(`/?order=${id}`);

  return (
    <>
      <div className="page-head">
        <h2>{t("Dashboard", "Panel")}</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div className="viewtoggle">
            <button className="vt" onClick={() => step(-1)} title={t("Previous period", "Período anterior")}>◀</button>
            <label style={{ margin: 0, textTransform: "none", letterSpacing: 0, padding: "0 4px" }}>
              {t("From", "Desde")}
              <input type="date" value={from} max={to} onChange={(e) => { setFrom(e.target.value); setRangeMode("custom"); }} style={{ width: 150, marginTop: 2 }} />
            </label>
            <label style={{ margin: 0, textTransform: "none", letterSpacing: 0, padding: "0 4px" }}>
              {t("To", "Hasta")}
              <input type="date" value={to} min={from} max={todayISO()} onChange={(e) => { setTo(e.target.value); setRangeMode("custom"); }} style={{ width: 150, marginTop: 2 }} />
            </label>
            <button className="vt" onClick={() => step(1)} title={t("Next period", "Período siguiente")}>▶</button>
          </div>
          <button className={"btn btn-sm " + (rangeMode === "week" && from === startOfWeekISO() ? "btn-primary" : "btn-ghost")} onClick={thisWeek}>{t("This week", "Esta semana")}</button>
          <button className={"btn btn-sm " + (rangeMode === "month" && from === startOfMonthISO() ? "btn-primary" : "btn-ghost")} onClick={thisMonth}>{t("This month", "Este mes")}</button>
          <button className="btn btn-ghost btn-sm" onClick={lastMonth}>{t("Last month", "Mes pasado")}</button>
          <button className="btn btn-ghost" onClick={exportRange} disabled={!scoped.length}>⬇ {t("Export range", "Exportar rango")}</button>
        </div>
      </div>

      {!ready ? (
        <div className="empty">{t("Loading…", "Cargando…")}</div>
      ) : (
        <>
          {/* ---------- KPI tiles ---------- */}
          <div className="kpi-grid">
            <Kpi n={kpis.total} label={t("Orders", "Órdenes")} />
            <Kpi n={kpis.pending} label={t("Pending approval", "Pendientes")} tone="amber" />
            <Kpi n={kpis.inWarehouse} label={t("In warehouse", "En almacén")} tone="purple" />
            <Kpi n={kpis.outForDelivery} label={t("Out for delivery", "En reparto")} tone="accent" />
            <Kpi n={kpis.delivered} label={t("Delivered", "Entregadas")} tone="green" />
            <Kpi n={kpis.overdue} label={t("Overdue", "Atrasadas")} tone={kpis.overdue ? "red" : undefined} />
            <Kpi n={kpis.totalPallets} label={t("Pallets", "Tarimas")} />
            <Kpi n={kpis.totalMiles} label={t("Route miles", "Millas")} />
            <Kpi n={fmtMoney(kpis.totalFees)} label={t("Fees charged", "Cobros de entrega")} tone="green" small />
            <Kpi n={kpis.onTimePct == null ? "—" : `${kpis.onTimePct}%`} label={t("On-time", "A tiempo")} tone={kpis.onTimePct != null && kpis.onTimePct < 80 ? "amber" : "green"} />
            <Kpi n={turnaround.avgMs == null ? "—" : fmtDuration(turnaround.avgMs)} label={t("Avg approval", "Aprob. prom.")} small />
          </div>

          <div className="dash-cols">
            {/* ---------- Orders by stage ---------- */}
            <div className="card">
              <h2>📦 {t("Orders by stage", "Órdenes por etapa")}</h2>
              <div className="bar-list">
                {stageCounts.map((s) => {
                  const info = stageInfo(s.stage);
                  return (
                    <div className="bar-row" key={s.stage}>
                      <span className="bar-label">{stageLabel(s.stage, lang)}</span>
                      <span className="bar-track">
                        <span className="bar-fill" style={{ width: `${(s.count / maxStage) * 100}%`, background: info.color }} />
                      </span>
                      <span className="bar-num">{s.count}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ---------- Store volume ---------- */}
            <div className="card">
              <h2>🏬 {t("Volume by store", "Volumen por tienda")}</h2>
              {stores.length === 0 ? (
                <div className="empty">{t("No orders in this range.", "No hay órdenes en este rango.")}</div>
              ) : (
                <div className="bar-list">
                  {stores.map((s) => (
                    <div className="bar-row" key={s.key}>
                      <span className="bar-label">{s.key}</span>
                      <span className="bar-track">
                        <span className="bar-fill" style={{ width: `${(s.total / maxStore) * 100}%`, background: "var(--accent)" }} />
                      </span>
                      <span className="bar-num">{s.total}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ---------- Driver performance ---------- */}
          <div className="card">
            <h2>🚚 {t("Driver performance", "Rendimiento de choferes")}</h2>
            {drivers.length === 0 ? (
              <div className="empty">{t("No drivers assigned in this range.", "No hay choferes asignados en este rango.")}</div>
            ) : (
              <div className="tbl-scroll" style={{ border: "none" }}>
                <table className="orders" style={{ minWidth: 520 }}>
                  <thead>
                    <tr>
                      <th>{t("Driver", "Chofer")}</th>
                      <th>{t("Total", "Total")}</th>
                      <th>{t("Delivered", "Entregadas")}</th>
                      <th>{t("Active", "Activas")}</th>
                      <th>{t("Pallets", "Tarimas")}</th>
                      <th>{t("Miles", "Millas")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drivers.map((d) => (
                      <tr key={d.driver}>
                        <td style={{ fontWeight: 700 }}>{d.driver}</td>
                        <td>{d.total}</td>
                        <td>{d.delivered}</td>
                        <td>{d.active}</td>
                        <td>{d.pallets}</td>
                        <td>{d.miles}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ---------- Sales rep performance, this month ---------- */}
          <div className="card">
            <h2>🧑‍💼 {t("Sales reps — this month", "Vendedores — este mes")}</h2>
            {repStats.length === 0 ? (
              <div className="empty">{t("No orders logged this month.", "Sin órdenes registradas este mes.")}</div>
            ) : (
              <div className="tbl-scroll" style={{ border: "none" }}>
                <table className="orders" style={{ minWidth: 480 }}>
                  <thead>
                    <tr>
                      <th>{t("Sales rep", "Vendedor")}</th>
                      <th>{t("Deliveries", "Entregas")}</th>
                      <th>{t("Charged total", "Total cobrado")}</th>
                      <th>{t("Avg $/delivery", "Prom. $/entrega")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {repStats.map((r) => (
                      <tr key={r.rep}>
                        <td style={{ fontWeight: 700 }}>{r.rep}</td>
                        <td>{r.deliveries}</td>
                        <td>{fmtMoney(r.chargedTotal)}</td>
                        <td>{fmtMoney(r.avgPerDelivery)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ---------- Top accounts ---------- */}
          <div className="dash-cols">
            <div className="card">
              <h2>🏢 {t("Top accounts", "Cuentas principales")}</h2>
              {accounts.length === 0 ? (
                <div className="empty">{t("No accounts in this range.", "No hay cuentas en este rango.")}</div>
              ) : (
                <div className="bar-list">
                  {accounts.map((a) => (
                    <div className="bar-row" key={a.key}>
                      <span className="bar-label">{a.key}</span>
                      <span className="bar-track">
                        <span className="bar-fill" style={{ width: `${(a.total / Math.max(1, accounts[0].total)) * 100}%`, background: "var(--teal)" }} />
                      </span>
                      <span className="bar-num">{a.total}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ---------- Overdue list ---------- */}
            <div className="card">
              <h2 style={{ color: overdue.length ? "var(--red)" : undefined }}>
                ⏰ {t("Overdue orders", "Órdenes atrasadas")} {overdue.length > 0 && <span className="sema" style={{ background: "var(--red)", color: "#fff" }}>{overdue.length}</span>}
              </h2>
              {overdue.length === 0 ? (
                <div className="empty">✅ {t("Nothing overdue. Nice.", "Nada atrasado. ¡Bien!")}</div>
              ) : (
                <div className="bar-list">
                  {overdue.slice(0, 8).map((d) => (
                    <button key={d.id} className="overdue-row" onClick={() => openOrder(d.id)}>
                      <span className="ordno">#{d.order_no}</span>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.account || t("(no account)", "(sin cuenta)")}</span>
                      <span className="sema" style={{ background: stageInfo(d.stage).color, color: "#fff" }}>{stageLabel(d.stage, lang)}</span>
                      <span style={{ color: "var(--red)", fontWeight: 700 }}>{fmtDate(d.delivery_date)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

function Kpi({ n, label, tone, small }: { n: number | string; label: string; tone?: "amber" | "green" | "red" | "accent" | "purple"; small?: boolean }) {
  const color =
    tone === "amber" ? "var(--amber)" :
    tone === "green" ? "var(--green)" :
    tone === "red" ? "var(--red)" :
    tone === "accent" ? "var(--accent)" :
    tone === "purple" ? "var(--purple)" : "var(--text)";
  return (
    <div className="kpi">
      <b style={{ color, fontSize: small ? 17 : undefined }}>{n}</b>
      <span>{label}</span>
    </div>
  );
}
