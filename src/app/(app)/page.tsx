"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { useConfirm } from "@/lib/confirm";
import { canCreate, driverNames, ROLE_DEFAULT_COLUMNS, STAGES, stageLabel } from "@/lib/constants";
import { OrdersTable, ORDER_COLUMNS, DEFAULT_COLUMNS } from "@/components/OrdersTable";
import { OrdersBoard } from "@/components/OrdersBoard";
import { OrderModal } from "@/components/OrderModal";
import { deliveryColumns, downloadCSV, isOverdue, isPendingUrgent, isToday, toCSV, todayISO, yesterdayISO } from "@/lib/utils";
import { exportExcelByEmployee, exportPDFByEmployee } from "@/lib/export";
import type { Delivery, Stage, UserRole } from "@/lib/types";

// Quick saved views — one-tap presets layered on top of the stage chip.
type Preset = "all" | "today" | "overdue" | "unassigned" | "mine";

// Column choices are remembered per role — so switching "View as" in local
// demo mode (or just different people on different roles) doesn't clobber
// each other's picks, and each role starts from its own sensible default.
const colsKey = (role: UserRole) => `rtg_order_columns_${role}`;
const defaultColsFor = (role: UserRole) => ROLE_DEFAULT_COLUMNS[role] ?? DEFAULT_COLUMNS;

export default function OrdersPage() {
  const { me, users, deliveries, settings, ready, updateDelivery, setStage, notify } = useData();
  const { lang, t } = usePrefs();
  const confirmAction = useConfirm();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState<string>("all");
  const [preset, setPreset] = useState<Preset>("all");
  const [q, setQ] = useState("");
  const [view, setView] = useState<"table" | "board">("table");
  const [open, setOpen] = useState<Delivery | null>(null);
  const [creating, setCreating] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  // Bulk selection (#1) + user-chosen columns (#13, persisted per browser).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cols, setCols] = useState<string[]>(DEFAULT_COLUMNS);
  const [showCols, setShowCols] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Managers land on Pending Approval instead of All — that's the queue they
  // actually need to act on. Only applied once per role, on first load, so
  // manually picking a different chip afterward isn't fought.
  const defaultFilterApplied = useRef<UserRole | null>(null);
  useEffect(() => {
    if (!me || defaultFilterApplied.current === me.role) return;
    defaultFilterApplied.current = me.role;
    if (me.role === "manager") setFilter("pending");
  }, [me?.role]);

  // Reloads whenever the role changes too (e.g. the local-demo "View as"
  // switcher), so each role shows its own saved columns, defaulting to
  // ROLE_DEFAULT_COLUMNS the first time that role is seen in this browser.
  // Sales is the exception: there's no self-customizing for that role — an
  // admin sets the one fixed list for everyone in Settings, so it's read
  // straight from there (and stays reactive if an admin changes it live).
  useEffect(() => {
    if (!me) return;
    if (me.role === "sales") {
      setCols(settings.sales_columns ?? defaultColsFor("sales"));
      return;
    }
    try {
      const raw = localStorage.getItem(colsKey(me.role));
      setCols(raw ? JSON.parse(raw) : defaultColsFor(me.role));
    } catch {
      setCols(defaultColsFor(me.role));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.role, settings.sales_columns]);

  const saveCols = (next: string[]) => {
    setCols(next);
    if (!me || me.role === "sales") return;
    try { localStorage.setItem(colsKey(me.role), JSON.stringify(next)); } catch { /* ignore */ }
  };

  // Keyboard shortcuts (#12): "n" new order, "/" focus search, "Esc" clear.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable;
      if (typing) {
        if (e.key === "Escape") (el as HTMLInputElement).blur();
        return;
      }
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key.toLowerCase() === "n" && me && canCreate(me)) { e.preventDefault(); setCreating(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [me]);

  // Deep-link: /?order=<id> (e.g. from a notification) opens that order.
  const orderParam = searchParams.get("order");
  useEffect(() => {
    if (!orderParam || !ready) return;
    const found = deliveries.find((d) => d.id === orderParam);
    if (found) setOpen(found);
    // Clear the param so re-navigating to the same order works again.
    router.replace("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderParam, ready, deliveries]);

  // Everything this person can see, before the stage chip / preset narrow it
  // further — the "All" count and every stage chip's count come from this,
  // not the full company-wide `deliveries`, so the numbers on the chips
  // always match what actually shows up in the table below them.
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return deliveries.filter((d) => {
      // Sales only ever sees their own orders — a hard boundary, not
      // relaxed by search, unlike the date-window restriction below.
      if (me?.role === "sales" && d.created_by !== me.id) return false;
      if (!needle) {
        // Sales' default view is scoped to yesterday/today/future — older
        // history is still there, just reached by searching (e.g. an invoice #)
        // rather than scrolled to, so the list stays focused on active work.
        if (me?.role === "sales" && d.delivery_date && d.delivery_date < yesterdayISO()) return false;
        return true;
      }
      const hay = [d.order_no, d.account, d.so_num, d.po2, d.invoice_num, d.store, d.delivery_address, d.contact, d.assigned_driver, d.delivery_phone]
        .map((x) => String(x ?? "").toLowerCase()).join(" ");
      return hay.includes(needle);
    });
  }, [deliveries, q, me?.id, me?.role]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: visible.length };
    for (const d of visible) c[d.stage] = (c[d.stage] ?? 0) + 1;
    return c;
  }, [visible]);

  const rows = useMemo(() => {
    // The board shows every stage as its own column, so ignore the stage chip there.
    const activeFilter = view === "board" ? "all" : filter;
    return visible.filter((d) => {
      if (activeFilter !== "all" && d.stage !== activeFilter) return false;
      if (preset === "today" && !isToday(d.delivery_date)) return false;
      if (preset === "overdue" && !isOverdue(d)) return false;
      if (preset === "unassigned" && d.assigned_driver) return false;
      if (preset === "mine" && d.created_by !== me?.id) return false;
      return true;
    });
  }, [visible, filter, preset, view, me?.id]);

  const presets: { id: Preset; en: string; es: string }[] = [
    { id: "all", en: "All", es: "Todas" },
    { id: "today", en: "Today", es: "Hoy" },
    { id: "overdue", en: "Overdue", es: "Atrasadas" },
    { id: "unassigned", en: "No driver", es: "Sin chofer" },
    { id: "mine", en: "Mine", es: "Mías" },
  ];

  if (!me) return null;
  if (me.role === "warehouse") return <div className="empty">{t("Not available for your role — use the Warehouse or Driver view.", "No disponible para su rol — use la vista de Almacén o Chofer.")}</div>;

  // ---- Bulk actions (#1) ----
  const toggle = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () =>
    setSelected((prev) => (rows.every((r) => prev.has(r.id)) ? new Set() : new Set(rows.map((r) => r.id))));
  const chosen = rows.filter((r) => selected.has(r.id));

  const bulkAssignDriver = async (driver: string) => {
    if (!driver || !chosen.length) return;
    setBulkBusy(true);
    for (const d of chosen) await updateDelivery(d.id, { assigned_driver: driver });
    setBulkBusy(false);
    notify(t(`Assigned ${chosen.length} order(s) to ${driver}`, `${chosen.length} orden(es) asignadas a ${driver}`));
    setSelected(new Set());
  };

  const bulkStage = async (to: "pending" | "approved") => {
    if (!chosen.length) return;
    setBulkBusy(true);
    let ok = 0;
    for (const d of chosen) { if (await setStage(d.id, to)) ok++; }
    setBulkBusy(false);
    notify(t(`${ok} of ${chosen.length} order(s) updated`, `${ok} de ${chosen.length} orden(es) actualizadas`));
    setSelected(new Set());
  };

  // Admin-only: force any status on the selection, skipping the normal workflow
  // steps. One confirmation for the whole batch, and every order records the
  // override in its own activity history so it's never a silent change.
  const bulkOverride = async (to: Stage) => {
    if (!to || !chosen.length) return;
    const label = stageLabel(to, lang);
    const list = chosen.slice(0, 8).map((d) => `#${d.order_no}`).join(", ") + (chosen.length > 8 ? "…" : "");
    const ok = await confirmAction(t(
      `Override ${chosen.length} order(s) to "${label}"?\n\n${list}\n\nThis skips the normal workflow steps. Each order's history will record the override.`,
      `¿Forzar ${chosen.length} orden(es) a "${label}"?\n\n${list}\n\nEsto omite los pasos normales del flujo. El historial de cada orden registrará el cambio.`,
    ), { danger: true, confirmLabel: t("Override", "Forzar") });
    if (!ok) return;
    setBulkBusy(true);
    let done = 0;
    for (const d of chosen) {
      const note = t(
        `Status overridden ${stageLabel(d.stage, lang)} → ${label} by ${me.full_name}`,
        `Estado forzado ${stageLabel(d.stage, lang)} → ${label} por ${me.full_name}`,
      );
      if (await setStage(d.id, to, note)) done++;
    }
    setBulkBusy(false);
    notify(t(`${done} of ${chosen.length} order(s) set to ${label}`, `${done} de ${chosen.length} orden(es) a ${label}`));
    setSelected(new Set());
  };

  const exportSelected = () => {
    if (!chosen.length) return;
    const headers = deliveryColumns(chosen[0]).map(([h]) => h).concat("Stage");
    const data = chosen.map((d) => deliveryColumns(d).map(([, v]) => v).concat(d.stage));
    downloadCSV(`deliveries_selected_${todayISO()}.csv`, toCSV(headers, data));
  };

  const exportCSV = () => {
    if (!rows.length) return;
    const headers = deliveryColumns(rows[0]).map(([h]) => h).concat("Stage");
    const data = rows.map((d) => deliveryColumns(d).map(([, v]) => v).concat(d.stage));
    downloadCSV(`deliveries_${todayISO()}.csv`, toCSV(headers, data));
  };

  return (
    <>
      <div className="page-head">
        <h2>{t("Orders", "Órdenes")} <span className="count-tag">{rows.length}</span></h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div className="viewtoggle">
            <button className={"vt " + (view === "table" ? "on" : "")} onClick={() => setView("table")}>☰ {t("Table", "Tabla")}</button>
            <button className={"vt " + (view === "board" ? "on" : "")} onClick={() => setView("board")}>▦ {t("Board", "Tablero")}</button>
          </div>
          <button className="btn btn-ghost" onClick={() => exportExcelByEmployee(rows, users, lang)} disabled={!rows.length} title={t("Excel grouped by employee, collapsible", "Excel agrupado por empleado, colapsable")}>📊 {t("Excel", "Excel")}</button>
          <button className="btn btn-ghost" onClick={() => exportPDFByEmployee(rows, users, lang)} disabled={!rows.length}>🖨 {t("PDF", "PDF")}</button>
          <button className="btn btn-ghost" onClick={exportCSV} disabled={!rows.length}>⬇ {t("CSV", "CSV")}</button>
          {view === "table" && me.role !== "sales" && (
            <div style={{ position: "relative" }}>
              <button className="btn btn-ghost" onClick={() => setShowCols((s) => !s)}>⚙ {t("Columns", "Columnas")}</button>
              {showCols && (
                <div className="col-menu">
                  <div className="col-menu-head">
                    <b>{t("Show columns", "Mostrar columnas")}</b>
                    <button className="notif-clear" onClick={() => saveCols(defaultColsFor(me.role))}>{t("Reset", "Restablecer")}</button>
                  </div>
                  {ORDER_COLUMNS.map((c) => (
                    <label key={c.key} className="col-opt">
                      <input
                        type="checkbox"
                        checked={cols.includes(c.key)}
                        onChange={() => saveCols(cols.includes(c.key) ? cols.filter((k) => k !== c.key) : [...cols, c.key])}
                      />
                      {lang === "es" ? c.es : c.en}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          {canCreate(me) && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>+ {t("New order", "Nueva orden")}</button>
          )}
        </div>
      </div>

      <div className="filters">
        <div className="viewtoggle">
          {presets.map((p) => (
            <button key={p.id} className={"vt " + (preset === p.id ? "on" : "")} onClick={() => setPreset(p.id)}>
              {t(p.en, p.es)}
            </button>
          ))}
        </div>
      </div>

      <div className="filters">
        <input
          ref={searchRef}
          style={{ maxWidth: 260 }}
          placeholder={t("Search…  (press / )", "Buscar…  (tecla / )")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {view === "table" && (
          <>
            <button className={"chip " + (filter === "all" ? "on" : "")} onClick={() => setFilter("all")}>
              {t("All", "Todas")} <span className="cnt">{counts.all ?? 0}</span>
            </button>
            {STAGES.map((s) => (
              <button key={s.key} className={"chip " + (filter === s.key ? "on" : "")} onClick={() => setFilter(s.key)}>
                {stageLabel(s.key, lang)} <span className="cnt">{counts[s.key] ?? 0}</span>
              </button>
            ))}
          </>
        )}
      </div>

      {view === "table" && chosen.length > 0 && (
        <div className="bulk-bar">
          <b>{chosen.length} {t("selected", "seleccionadas")}</b>
          <span style={{ flex: 1 }} />
          {me.role === "admin" && (
            <select defaultValue="" disabled={bulkBusy} onChange={(e) => { bulkAssignDriver(e.target.value); e.target.value = ""; }} style={{ width: "auto" }}>
              <option value="">🚚 {t("Assign driver…", "Asignar chofer…")}</option>
              {driverNames(users).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          )}
          {me.role === "admin" && (
            <select
              defaultValue=""
              disabled={bulkBusy}
              title={t("Force any status, skipping the workflow", "Forzar cualquier estado, omitiendo el flujo")}
              onChange={(e) => { const v = e.target.value as Stage; e.target.value = ""; if (v) bulkOverride(v); }}
              style={{ width: "auto" }}
            >
              <option value="">⚡ {t("Override status…", "Forzar estado…")}</option>
              {STAGES.map((s) => <option key={s.key} value={s.key}>{stageLabel(s.key, lang)}</option>)}
            </select>
          )}
          {canCreate(me) && (
            <button className="btn btn-ghost btn-sm" disabled={bulkBusy} onClick={() => bulkStage("pending")}>{t("Submit for approval", "Enviar a aprobación")}</button>
          )}
          {(me.role === "manager" || me.role === "admin") && (
            <button className="btn btn-green btn-sm" disabled={bulkBusy} onClick={() => bulkStage("approved")}>{t("Approve", "Aprobar")}</button>
          )}
          <button className="btn btn-ghost btn-sm" disabled={bulkBusy} onClick={exportSelected}>⬇ {t("Export", "Exportar")}</button>
          <button className="btn btn-sm" onClick={() => setSelected(new Set())}>✕</button>
        </div>
      )}

      {ready ? (
        view === "board" ? (
          <OrdersBoard rows={rows} onOpen={setOpen} />
        ) : (
          <OrdersTable
            rows={rows}
            onOpen={setOpen}
            empty={t("No orders match this view.", "No hay órdenes en esta vista.")}
            visible={cols}
            selectable
            selected={selected}
            onToggle={toggle}
            onToggleAll={toggleAll}
            isUrgent={(d) => {
              const cutoff = me.role === "manager" ? settings.manager_pending_cutoff
                : me.role === "sales" ? settings.sales_pending_cutoff
                : null;
              return isPendingUrgent(d, cutoff);
            }}
          />
        )
      ) : (
        <div className="empty">{t("Loading…", "Cargando…")}</div>
      )}

      {open && <OrderModal me={me} existing={open} startEditing={false} onClose={() => setOpen(null)} />}
      {creating && <OrderModal me={me} existing={null} startEditing onClose={() => setCreating(false)} />}
    </>
  );
}
