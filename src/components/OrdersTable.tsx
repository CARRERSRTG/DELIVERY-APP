"use client";

import { stageInfo, stageLabel } from "@/lib/constants";
import { usePrefs } from "@/lib/prefs";
import { fmtDate, fmtMilitary, fmtMoney, isOverdue } from "@/lib/utils";
import type { Delivery } from "@/lib/types";

// ---- Column registry (#13 column customization) ---------------------------
// "ID" is always shown; everything else can be toggled by the user.
export interface OrderColumn {
  key: string;
  en: string;
  es: string;
  cell: (d: Delivery, ctx: { lang: "en" | "es"; t: (en: string, es: string) => string }) => React.ReactNode;
}

export const ORDER_COLUMNS: OrderColumn[] = [
  { key: "stage", en: "Stage", es: "Etapa", cell: (d, { lang }) => {
      const s = stageInfo(d.stage);
      return <span className="sema" style={{ background: s.color, color: "#fff" }}>{stageLabel(d.stage, lang)}</span>;
    } },
  { key: "type", en: "Type", es: "Tipo", cell: (d) => d.order_type || "—" },
  { key: "store", en: "Store", es: "Tienda", cell: (d) => d.store || "—" },
  { key: "account", en: "Account", es: "Cuenta", cell: (d) => d.account || "—" },
  { key: "so", en: "SO #", es: "SO #", cell: (d) => d.so_num || "—" },
  { key: "po", en: "PO #2", es: "PO #2", cell: (d) => d.po2 || "—" },
  { key: "invoice", en: "Invoice #", es: "Factura #", cell: (d) => d.invoice_num || "—" },
  { key: "date", en: "Delivery Date", es: "Fecha entrega", cell: (d, { t }) => {
      const late = isOverdue(d);
      return (
        <span style={late ? { color: "var(--red)", fontWeight: 700 } : undefined}>
          {fmtDate(d.delivery_date)}
          {late && <span className="sema" style={{ background: "var(--red)", color: "#fff", marginLeft: 6 }}>{t("Late", "Tarde")}</span>}
        </span>
      );
    } },
  { key: "windows", en: "Windows", es: "Ventanas", cell: (d) => d.delivery_windows || "—" },
  { key: "pallets", en: "Pallets", es: "Tarimas", cell: (d) => d.actual_pallets ?? d.est_pallets ?? "—" },
  { key: "fee", en: "Fee", es: "Costo", cell: (d) => (d.delivery_fee == null ? "—" : fmtMoney(d.delivery_fee)) },
  { key: "driver", en: "Driver", es: "Chofer", cell: (d) => d.assigned_driver || "—" },
  { key: "contact", en: "Contact", es: "Contacto", cell: (d) => d.contact || "—" },
  { key: "address", en: "Delivery Address", es: "Dirección", cell: (d) => d.delivery_address || "—" },
];

export const DEFAULT_COLUMNS = ["stage", "type", "store", "account", "so", "date", "windows", "pallets", "driver"];

/** Compact, horizontally-scrollable table of orders. Click a row to open it.
 * Optionally supports row selection (bulk actions) and custom columns. */
export function OrdersTable({
  rows,
  onOpen,
  empty = "No orders here.",
  visible = DEFAULT_COLUMNS,
  selectable = false,
  selected,
  onToggle,
  onToggleAll,
}: {
  rows: Delivery[];
  onOpen: (d: Delivery) => void;
  empty?: string;
  visible?: string[];
  selectable?: boolean;
  selected?: Set<string>;
  onToggle?: (id: string) => void;
  onToggleAll?: () => void;
}) {
  const { lang, t } = usePrefs();
  if (!rows.length) return <div className="empty">{empty}</div>;

  const cols = ORDER_COLUMNS.filter((c) => visible.includes(c.key));
  const allChecked = !!selected && rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <div className="tbl-scroll">
      <table className="orders">
        <thead>
          <tr>
            {selectable && (
              <th style={{ width: 34 }}>
                <input type="checkbox" checked={allChecked} onChange={onToggleAll} style={{ width: 15, height: 15 }} />
              </th>
            )}
            <th>ID</th>
            {cols.map((c) => <th key={c.key}>{lang === "es" ? c.es : c.en}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id} className="clickable" onClick={() => onOpen(d)}>
              {selectable && (
                <td onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={!!selected?.has(d.id)} onChange={() => onToggle?.(d.id)} style={{ width: 15, height: 15 }} />
                </td>
              )}
              <td className="ordno">#{d.order_no}</td>
              {cols.map((c) => <td key={c.key}>{c.cell(d, { lang, t })}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export { fmtMilitary };
