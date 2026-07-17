import type { Delivery } from "./types";

/** A date as local YYYY-MM-DD.
 * NOT toISOString() — that converts to UTC, so anywhere west of Greenwich the
 * date rolls forward late in the evening (7pm CDT is already tomorrow in UTC).
 * Delivery dates are calendar days in the user's timezone, so they must be
 * derived from local parts to stay consistent with isOverdue()/isToday(). */
export function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const todayISO = () => localISO(new Date());

/** Current local time as a 4-digit military string, e.g. "1430". */
export const nowMilitary = () => {
  const n = new Date();
  return `${String(n.getHours()).padStart(2, "0")}${String(n.getMinutes()).padStart(2, "0")}`;
};

export function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  return d.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-US", { day: "2-digit", month: "short" }) +
    " " +
    d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
  );
}

/** Normalize free-typed military time to 4 digits, e.g. "830" → "0830". "" if empty. */
export function fmtMilitary(t: string | null): string {
  const s = (t || "").replace(/[^0-9]/g, "");
  if (!s) return "—";
  return s.padStart(4, "0").slice(0, 4);
}

export const telClean = (t: string | null) => (t || "").replace(/[^0-9+]/g, "");

/** Auto-calculated duration from pallet count × minutes-per-pallet, e.g. "20 min".
 * Returns "" when there are no pallets so the field stays blank. */
export function palletDuration(pallets: number | null | undefined, minPerPallet: number): string {
  const n = Number(pallets);
  if (!n || n <= 0 || !minPerPallet) return "";
  return `${Math.round(n * minPerPallet)} min`;
}

/** Format a USD amount, e.g. 75 → "$75.00". "—" when unset. */
export function fmtMoney(v: number | null | undefined): string {
  if (v == null || !isFinite(Number(v))) return "—";
  return "$" + Number(v).toFixed(2);
}

export function initials(name: string): string {
  const parts = (name || "").trim().split(/\s+/);
  return ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase();
}

const AVATAR_COLORS = ["#2456c9", "#7c4dbc", "#0f8a8a", "#e9a13b", "#1f9d61", "#d64545", "#3d4d68"];

export function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < (name || "").length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/** An order is overdue when its delivery date is in the past and it hasn't
 * reached a terminal stage (delivered/canceled). Used for SLA flagging. */
export function isOverdue(d: Delivery): boolean {
  if (!d.delivery_date) return false;
  if (d.stage === "delivered" || d.stage === "canceled") return false;
  const due = new Date(d.delivery_date.length === 10 ? d.delivery_date + "T23:59:59" : d.delivery_date);
  return due.getTime() < Date.now();
}

/** Whole days between two ISO timestamps (a - b), floored. */
export function daysBetween(aISO: string, bISO: string): number {
  return Math.floor((new Date(aISO).getTime() - new Date(bISO).getTime()) / 86_400_000);
}

/** Human "2 h 5 min" from a millisecond span (drops zero parts). "—" if invalid. */
export function fmtDuration(ms: number | null): string {
  if (ms == null || !isFinite(ms) || ms < 0) return "—";
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  const n = new Date();
  return (
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  );
}

/** Build a CSV string from rows of records (values are stringified + quoted). */
export function toCSV(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}

export function downloadCSV(filename: string, csv: string): void {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Every data column of a delivery, as [header, value] — used for CSV export & detail view. */
// Spanish labels for the delivery column keys, used by the view-mode detail
// grid. CSV export keeps the English keys as headers.
const COLUMN_ES: Record<string, string> = {
  "ID": "ID",
  "Prepared Status": "Estado de Preparación",
  "Status (Temp)": "Estado (Temp)",
  "Order Type": "Tipo de Orden",
  "Store (Sold From)": "Tienda (Vendido Desde)",
  "PO #2": "PO #2",
  "SO #": "SO #",
  "Invoice #": "Factura #",
  "Input Date": "Fecha de Ingreso",
  "Input Military Time": "Hora de Ingreso (militar)",
  "Delivery Date": "Fecha de Entrega",
  "Pickup Name": "Nombre de Recolección",
  "Pickup Address": "Dirección de Recolección",
  "Pickup Duration": "Duración de Recolección",
  "Delivery Fee": "Costo de Entrega",
  "Est. Pallets (sales)": "Tarimas Est. (ventas)",
  "Actual Pallets (warehouse)": "Tarimas Reales (almacén)",
  "Assigned Driver": "Chofer Asignado",
  "Delivery Duration": "Duración de Entrega",
  "Delivery Address": "Dirección de Entrega",
  "Delivery Military Time Windows": "Ventanas de Entrega (militar)",
  "Account": "Cuenta",
  "Contact": "Contacto",
  "Delivery Phone Number": "Teléfono de Entrega",
  "Delivery Notes": "Notas de Entrega",
  "Route Miles": "Millas de Ruta",
  "Est. Travel Time": "Tiempo de Viaje Est.",
  "Re-delivery reason": "Motivo de Reentrega",
};

/** Translate a delivery-column key for display (English keys pass through). */
export function colLabel(key: string, lang: "en" | "es"): string {
  return lang === "es" ? COLUMN_ES[key] ?? key : key;
}

export function deliveryColumns(d: Delivery): [string, string][] {
  return [
    ["ID", String(d.order_no)],
    ["Prepared Status", d.prepared_status ?? ""],
    ["Status (Temp)", d.status_temp ?? ""],
    ["Order Type", d.order_type ?? ""],
    ["Store (Sold From)", d.store ?? ""],
    ["PO #2", d.po2 ?? ""],
    ["SO #", d.so_num ?? ""],
    ["Invoice #", d.invoice_num ?? ""],
    ["Input Date", d.input_date ?? ""],
    ["Input Military Time", fmtMilitary(d.input_time)],
    ["Delivery Date", d.delivery_date ?? ""],
    ["Pickup Name", d.pickup_name ?? ""],
    ["Pickup Address", d.pickup_address ?? ""],
    ["Pickup Duration", d.pickup_duration ?? ""],
    ["Delivery Fee", d.delivery_fee == null ? "" : fmtMoney(d.delivery_fee)],
    ["Est. Pallets (sales)", d.est_pallets == null ? "" : String(d.est_pallets)],
    ["Actual Pallets (warehouse)", d.actual_pallets == null ? "" : String(d.actual_pallets)],
    ["Assigned Driver", d.assigned_driver ?? ""],
    ["Delivery Duration", d.delivery_duration ?? ""],
    ["Delivery Address", d.delivery_address ?? ""],
    ["Delivery Military Time Windows", d.delivery_windows ?? ""],
    ["Account", d.account ?? ""],
    ["Contact", d.contact ?? ""],
    ["Delivery Phone Number", d.delivery_phone ?? ""],
    ["Delivery Notes", d.delivery_notes ?? ""],
    ["Route Miles", d.route_miles == null ? "" : `${d.route_miles} mi`],
    ["Est. Travel Time", d.route_duration ?? ""],
    ["Re-delivery reason", d.redelivery_reason ?? ""],
  ];
}
