import type { Delivery } from "@/lib/types";

// ============================================================
// Required-field rules for an order.
//
// Always required:
//   • Order Type
//   • Store (Sold From)
//   • Contact name + Delivery phone
//   • Pickup name + address
//   • Dropoff (delivery) name + address
//   • Delivery Date + Delivery Window
//   • Est. Pallets
//
// Document reference — depends on the order type:
//   • Intra-Tienda  → ANY ONE of PO #2 / SO # / Invoice #
//   • Transfer / Customer (picked up by the customer themselves) → optional (nothing required)
//   • Everything else (Delivery…) → Customer Invoice # required
//
// Nothing here hard-blocks: the rep is shown exactly what's missing and asked
// whether to continue anyway.
// ============================================================

export interface MissingField {
  /** Matches the form field so the UI can highlight it. */
  key: string;
  en: string;
  es: string;
}

/** Store-to-store transfer between branches ("Intra-Tienda"). */
export const isIntraStore = (orderType: string | null | undefined) => /intra|tienda/i.test(orderType || "");

/** Transfers and customer self-pickups don't need customer paperwork. */
export const isPickupOrTransfer = (orderType: string | null | undefined) =>
  /pick\s*-?\s*up|will\s*call|customer|transfer|^\s*pu\s*$/i.test(orderType || "");

const filled = (v: unknown) => !!String(v ?? "").trim();

export function missingFields(d: Partial<Delivery>): MissingField[] {
  const out: MissingField[] = [];

  if (!filled(d.order_type)) out.push({ key: "order_type", en: "Order Type", es: "Tipo de Orden" });
  if (!filled(d.store)) out.push({ key: "store", en: "Store (Sold From)", es: "Tienda (Vendido Desde)" });
  if (!filled(d.pickup_name)) out.push({ key: "pickup_name", en: "Pickup Name", es: "Nombre de Recolección" });
  if (!filled(d.pickup_address)) out.push({ key: "pickup_address", en: "Pickup Address", es: "Dirección de Recolección" });
  if (!filled(d.delivery_name)) out.push({ key: "delivery_name", en: "Dropoff Name", es: "Nombre de Destino" });
  if (!filled(d.delivery_address)) out.push({ key: "delivery_address", en: "Delivery Address (dropoff)", es: "Dirección de Entrega (destino)" });
  if (!filled(d.contact)) out.push({ key: "contact", en: "Contact name", es: "Nombre de Contacto" });
  // A usable phone: at least 7 digits once punctuation is stripped.
  if (String(d.delivery_phone ?? "").replace(/\D/g, "").length < 7) {
    out.push({ key: "delivery_phone", en: "Delivery Phone Number", es: "Teléfono de Entrega" });
  }
  if (!filled(d.delivery_date)) out.push({ key: "delivery_date", en: "Delivery Date", es: "Fecha de Entrega" });
  if (!filled(d.delivery_windows)) out.push({ key: "delivery_windows", en: "Delivery Time Window", es: "Ventana de Entrega" });
  if (d.est_pallets == null || Number(d.est_pallets) <= 0) {
    out.push({ key: "est_pallets", en: "Est. Pallets", es: "Tarimas Estimadas" });
  }

  // ---- Document reference, by order type ----
  // Which paperwork is needed depends entirely on the order type, so until one
  // is picked we only ask for the type itself rather than guessing.
  const type = d.order_type;
  if (!filled(type)) return out;

  if (isIntraStore(type)) {
    // Any one of the three is enough for a store-to-store transfer.
    if (!filled(d.po2) && !filled(d.so_num) && !filled(d.invoice_num)) {
      out.push({ key: "doc_ref", en: "PO #2, SO # or Invoice # (any one)", es: "PO #2, SO # o Factura # (cualquiera)" });
    }
  } else if (!isPickupOrTransfer(type)) {
    // Regular customer delivery — the customer invoice is required.
    if (!filled(d.invoice_num)) {
      out.push({ key: "invoice_num", en: "Customer Invoice #", es: "Factura del Cliente #" });
    }
  }

  return out;
}

/** Field keys to highlight in the form. */
export function missingKeys(d: Partial<Delivery>): Set<string> {
  const keys = new Set(missingFields(d).map((m) => m.key));
  // "doc_ref" means all three reference fields should light up.
  if (keys.has("doc_ref")) { keys.add("po2"); keys.add("so_num"); keys.add("invoice_num"); }
  return keys;
}
