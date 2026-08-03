"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
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
