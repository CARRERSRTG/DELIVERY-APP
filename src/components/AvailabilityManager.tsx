"use client";

import { useState } from "react";
import type { DriverAvailability, Profile } from "@/lib/types";
import { fmtDate, todayISO } from "@/lib/utils";

const KINDS = [
  { key: "vacation", en: "Vacation", es: "Vacaciones" },
  { key: "sick", en: "Sick", es: "Enfermedad" },
  { key: "maintenance", en: "Maintenance", es: "Mantenimiento" },
  { key: "other", en: "Other", es: "Otro" },
] as const;

/** Schedule and list driver time off (vacation / sick / maintenance). The
 * auto-assign optimizer skips a driver on any day covered by a row here. */
export function AvailabilityManager({
  drivers, availability, onAdd, onRemove, t,
}: {
  drivers: Profile[];
  availability: DriverAvailability[];
  onAdd: (seed: Omit<DriverAvailability, "id" | "created_at" | "created_by">) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  t: (en: string, es: string) => string;
}) {
  const [driverId, setDriverId] = useState("");
  const [kind, setKind] = useState<DriverAvailability["kind"]>("vacation");
  const [start, setStart] = useState(todayISO());
  const [end, setEnd] = useState(todayISO());
  const [busy, setBusy] = useState(false);

  const nameById = new Map(drivers.map((d) => [d.id, d.full_name]));
  const rows = availability
    .filter((a) => nameById.has(a.driver_id))
    .sort((a, b) => a.start_date.localeCompare(b.start_date));

  const add = async () => {
    if (!driverId || !start || !end) return;
    setBusy(true);
    try {
      await onAdd({
        driver_id: driverId,
        kind,
        start_date: start <= end ? start : end,
        end_date: end >= start ? end : start,
        note: null,
      });
      setDriverId("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ margin: 0 }}>
      <h2 style={{ margin: 0 }}>🌴 {t("Driver time off", "Ausencias de choferes")}</h2>
      <p className="hint" style={{ marginTop: 6 }}>
        {t(
          "Vacation, sick leave or vehicle maintenance. Auto-assign skips a driver on their off days.",
          "Vacaciones, enfermedad o mantenimiento. La auto-asignación omite al chofer en sus días libres.",
        )}
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <select value={driverId} onChange={(e) => setDriverId(e.target.value)} style={{ width: "auto" }}>
          <option value="">{t("Driver…", "Chofer…")}</option>
          {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value as DriverAvailability["kind"])} style={{ width: "auto" }}>
          {KINDS.map((k) => <option key={k.key} value={k.key}>{t(k.en, k.es)}</option>)}
        </select>
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)} style={{ width: "auto" }} />
        <span aria-hidden>→</span>
        <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} style={{ width: "auto" }} />
        <button className="btn btn-primary btn-sm" onClick={add} disabled={busy || !driverId}>{t("Add", "Agregar")}</button>
      </div>
      {rows.length === 0 ? (
        <div className="empty">{t("No time off scheduled.", "Sin ausencias programadas.")}</div>
      ) : (
        <div className="loc-list">
          {rows.map((a) => {
            const k = KINDS.find((x) => x.key === a.kind);
            return (
              <div className="loc-item" key={a.id}>
                <div>
                  <b>{nameById.get(a.driver_id)}</b>{" "}
                  <span className="loc-addr">{(k ? t(k.en, k.es) : a.kind)} · {fmtDate(a.start_date)} → {fmtDate(a.end_date)}</span>
                </div>
                <button className="btn btn-danger btn-sm" onClick={() => onRemove(a.id)} title={t("Remove", "Quitar")}>✕</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
