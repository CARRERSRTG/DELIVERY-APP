"use client";

import { useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { AddressInput } from "@/components/AddressInput";
import type { Delivery, NamedLocation, Settings } from "@/lib/types";

// ============================================================
// Data — the reusable reference lists behind the order form: pickup points,
// dropoff sites, stores and order types. Everything an admin needs to curate
// the pick-lists that sales choose from, in one place.
//
// Saved locations accumulate as reps hit "Save for next time" on an order, so
// they need somewhere to be corrected or cleaned up. That's this page.
// ============================================================

export default function DataPage() {
  const { me, settings, deliveries, saveSettings, notify } = useData();
  const { t } = usePrefs();

  if (!me) return null;
  if (me.role !== "admin") return <div className="empty">{t("Admins only.", "Solo administradores.")}</div>;

  const save = (patch: Partial<Settings>, msg: string) => { saveSettings(patch); notify(msg); };

  return (
    <>
      <div className="page-head"><h2>{t("Data", "Datos")}</h2></div>
      <p className="hint" style={{ marginTop: -8, marginBottom: 16 }}>
        {t(
          "The reference lists the order form pulls from. Anything a salesperson saves while writing an order lands here — edit or remove it any time.",
          "Las listas de referencia que usa el formulario de órdenes. Lo que un vendedor guarde al escribir una orden aparece aquí — edítelo o elimínelo cuando quiera.",
        )}
      </p>

      <LocationTable
        title={`📦 ${t("Pickup points", "Puntos de recolección")}`}
        blurb={t("Warehouses, yards and suppliers a driver collects from.", "Almacenes, patios y proveedores donde el chofer recoge.")}
        items={settings.pickup_locations ?? []}
        usageField="pickup_name"
        deliveries={deliveries}
        onChange={(v) => save({ pickup_locations: v }, t("Pickup points saved", "Puntos de recolección guardados"))}
        t={t}
      />

      <LocationTable
        title={`🏁 ${t("Dropoff sites", "Sitios de entrega")}`}
        blurb={t("Recurring customer sites and job sites.", "Sitios de clientes y obras recurrentes.")}
        items={settings.delivery_locations ?? []}
        usageField="delivery_name"
        deliveries={deliveries}
        onChange={(v) => save({ delivery_locations: v }, t("Dropoff sites saved", "Sitios de entrega guardados"))}
        t={t}
      />

      <LocationTable
        title={`🏬 ${t("Stores (Sold From)", "Tiendas (Vendido desde)")}`}
        blurb={t("Your branches. Also offered as pickup points on every order.", "Sus sucursales. También se ofrecen como puntos de recolección.")}
        items={settings.stores}
        usageField="store"
        deliveries={deliveries}
        onChange={(v) => save({ stores: v }, t("Stores saved", "Tiendas guardadas"))}
        t={t}
      />

      <TagTable
        title={`🏷 ${t("Order types", "Tipos de orden")}`}
        blurb={t("Drives which paperwork an order requires (Intra-Tienda, Pickup and Transfer are treated specially).", "Determina qué papeleo requiere una orden (Intra-Tienda, Pickup y Transfer son especiales).")}
        items={settings.order_types}
        deliveries={deliveries}
        onChange={(v) => save({ order_types: v }, t("Order types saved", "Tipos de orden guardados"))}
        t={t}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

/** Editable table of named locations, with in-place edit + usage-aware delete. */
function LocationTable({
  title, blurb, items, usageField, deliveries, onChange, t,
}: {
  title: string;
  blurb: string;
  items: NamedLocation[];
  usageField: "pickup_name" | "delivery_name" | "store";
  deliveries: Delivery[];
  onChange: (v: NamedLocation[]) => void;
  t: (en: string, es: string) => string;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<NamedLocation>({ name: "", address: "" });
  const [adding, setAdding] = useState(false);

  // How many orders reference each entry — so deleting isn't a blind act.
  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of deliveries) {
      const v = d[usageField];
      if (v) m.set(v, (m.get(v) ?? 0) + 1);
    }
    return m;
  }, [deliveries, usageField]);

  const startAdd = () => { setDraft({ name: "", address: "" }); setEditing(null); setAdding(true); };
  const startEdit = (i: number) => { setDraft({ ...items[i] }); setAdding(false); setEditing(i); };
  const cancel = () => { setEditing(null); setAdding(false); };

  const commit = () => {
    const name = draft.name.trim();
    if (!name) return;
    const clash = items.some((x, i) => x.name.toLowerCase() === name.toLowerCase() && i !== editing);
    if (clash) { alert(t(`"${name}" already exists.`, `"${name}" ya existe.`)); return; }
    const next = [...items];
    if (adding) next.push({ name, address: draft.address.trim() });
    else if (editing != null) next[editing] = { name, address: draft.address.trim() };
    onChange(next);
    cancel();
  };

  const remove = (i: number) => {
    const it = items[i];
    const used = usage.get(it.name) ?? 0;
    const msg = used
      ? t(
          `"${it.name}" is used by ${used} order(s). Those orders keep the address already saved on them, but it won't be offered on new orders. Delete it?`,
          `"${it.name}" se usa en ${used} orden(es). Esas órdenes conservan la dirección ya guardada, pero no se ofrecerá en órdenes nuevas. ¿Eliminar?`,
        )
      : t(`Delete "${it.name}"?`, `¿Eliminar "${it.name}"?`);
    if (!confirm(msg)) return;
    onChange(items.filter((_, x) => x !== i));
  };

  const Form = (
    <div className="data-form">
      <div className="grid g2">
        <div className="field">
          <label>{t("Name", "Nombre")}</label>
          <input value={draft.name} autoFocus placeholder={t("e.g. Rio Supply Yard", "ej. Patio Rio Supply")}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </div>
        <AddressInput
          label={t("Address", "Dirección")}
          value={draft.address}
          onChange={(v) => setDraft({ ...draft, address: v })}
          placeholder={t("Search an address…", "Busca una dirección…")}
        />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-ghost btn-sm" onClick={cancel}>{t("Cancel", "Cancelar")}</button>
        <button className="btn btn-primary btn-sm" onClick={commit} disabled={!draft.name.trim()}>{t("Save", "Guardar")}</button>
      </div>
    </div>
  );

  return (
    <div className="card">
      <h2>{title} <span className="count-tag">{items.length}</span></h2>
      <p className="hint" style={{ marginTop: -6, marginBottom: 12 }}>{blurb}</p>

      {items.length === 0 && !adding && <div className="empty">{t("Nothing saved yet.", "Nada guardado aún.")}</div>}

      <div className="loc-list">
        {items.map((it, i) =>
          editing === i ? (
            <div key={i}>{Form}</div>
          ) : (
            <div className="loc-item" key={i}>
              <div>
                <b>{it.name}</b>
                <span className="loc-addr">{it.address || t("(no address)", "(sin dirección)")}</span>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flex: "0 0 auto" }}>
                {(usage.get(it.name) ?? 0) > 0 && (
                  <span className="sema" style={{ background: "var(--gray)", color: "#fff" }}>
                    {usage.get(it.name)} {t("used", "usos")}
                  </span>
                )}
                <button className="btn btn-ghost btn-sm" onClick={() => startEdit(i)}>{t("Edit", "Editar")}</button>
                <button className="btn btn-danger btn-sm" onClick={() => remove(i)}>✕</button>
              </div>
            </div>
          ),
        )}
      </div>

      {adding ? Form : (
        <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={startAdd}>
          + {t("Add", "Agregar")}
        </button>
      )}
    </div>
  );
}

/** Editable list of plain string tags (order types). */
function TagTable({
  title, blurb, items, deliveries, onChange, t,
}: {
  title: string;
  blurb: string;
  items: string[];
  deliveries: Delivery[];
  onChange: (v: string[]) => void;
  t: (en: string, es: string) => string;
}) {
  const [val, setVal] = useState("");

  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of deliveries) {
      if (d.order_type) m.set(d.order_type, (m.get(d.order_type) ?? 0) + 1);
    }
    return m;
  }, [deliveries]);

  const add = () => {
    const v = val.trim();
    if (!v || items.some((i) => i.toLowerCase() === v.toLowerCase())) { setVal(""); return; }
    onChange([...items, v]);
    setVal("");
  };

  const remove = (x: string) => {
    const used = usage.get(x) ?? 0;
    if (used && !confirm(t(
      `"${x}" is used by ${used} order(s). They keep their type, but it won't be offered on new orders. Delete it?`,
      `"${x}" se usa en ${used} orden(es). Conservan su tipo, pero no se ofrecerá en órdenes nuevas. ¿Eliminar?`,
    ))) return;
    onChange(items.filter((i) => i !== x));
  };

  return (
    <div className="card">
      <h2>{title} <span className="count-tag">{items.length}</span></h2>
      <p className="hint" style={{ marginTop: -6, marginBottom: 12 }}>{blurb}</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, maxWidth: 460 }}>
        <input value={val} placeholder={t("Add an order type", "Agregar tipo de orden")}
          onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="btn btn-primary" onClick={add} disabled={!val.trim()}>{t("Add", "Agregar")}</button>
      </div>
      <div className="pill-list">
        {items.map((x) => (
          <span className="pill-item" key={x}>
            {x}
            {(usage.get(x) ?? 0) > 0 && <span style={{ color: "var(--gray)", fontWeight: 600 }}>· {usage.get(x)}</span>}
            <button onClick={() => remove(x)} title={t("Remove", "Quitar")}>✕</button>
          </span>
        ))}
      </div>
    </div>
  );
}
