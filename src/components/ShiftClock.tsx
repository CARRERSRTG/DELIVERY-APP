"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { useLiveLocation } from "@/lib/useLiveLocation";
import { fmtDuration } from "@/lib/utils";

// ============================================================
// Driver shift clock. The driver taps "Clock in" when they start their day and
// "Clock out" when they finish. On-clock time (minus time actively out on a
// delivery) feeds the idle-time KPI on the dashboard. While on the clock the
// elapsed time ticks live.
// ============================================================

export function ShiftClock({ driverId }: { driverId: string }) {
  const { shifts, clockIn, clockOut } = useData();
  const { t } = usePrefs();
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const open = useMemo(
    () => shifts.find((s) => s.driver_id === driverId && !s.ended_at) ?? null,
    [shifts, driverId],
  );

  // Tick every second only while on the clock.
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open]);

  const elapsed = open ? now - new Date(open.started_at).getTime() : 0;

  // Position sharing runs exactly as long as the shift does — clocking out
  // stops it. The driver is told plainly that it's on, never silently.
  const { status: gps } = useLiveLocation(!!open);

  const doIn = async () => { setBusy(true); await clockIn(driverId); setBusy(false); };
  const doOut = async () => { setBusy(true); await clockOut(driverId); setBusy(false); };

  return (
    <div
      className="card"
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 12, marginBottom: 12, flexWrap: "wrap",
        borderColor: open ? "var(--green)" : "var(--line)",
        background: open ? "rgba(16,185,129,0.06)" : undefined,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 22 }}>{open ? "🟢" : "⏱️"}</span>
        <div>
          <div style={{ fontWeight: 700 }}>
            {open ? t("On the clock", "En turno") : t("Off the clock", "Fuera de turno")}
          </div>
          <div className="hint" style={{ fontVariantNumeric: "tabular-nums" }}>
            {open
              ? t("Working for", "Trabajando por") + " " + fmtDuration(elapsed)
              : t("Clock in when you start your shift.", "Marca entrada al iniciar tu turno.")}
          </div>
          {/* Location sharing is always stated out loud while on shift —
              the driver should never have to wonder whether it's on. */}
          {open && (
            <div className="hint" style={{ marginTop: 2 }}>
              {gps === "live" && <span style={{ color: "var(--green)" }}>📍 {t("Sharing your location with the office", "Compartiendo tu ubicación con la oficina")}</span>}
              {gps === "starting" && <span>📍 {t("Finding your location…", "Buscando tu ubicación…")}</span>}
              {gps === "denied" && <span style={{ color: "var(--amber)" }}>📍 {t("Location permission is off — turn it on so dispatch can see you", "Permiso de ubicación desactivado — actívalo para que logística te vea")}</span>}
              {gps === "unavailable" && <span style={{ color: "var(--amber)" }}>📍 {t("Location unavailable on this device", "Ubicación no disponible en este dispositivo")}</span>}
            </div>
          )}
        </div>
      </div>
      {open ? (
        <button className="btn btn-ghost" disabled={busy} onClick={doOut}>
          {t("Clock out", "Marcar salida")}
        </button>
      ) : (
        <button className="btn btn-primary" disabled={busy} onClick={doIn}>
          {t("Clock in", "Marcar entrada")}
        </button>
      )}
    </div>
  );
}
