"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { useLiveLocation } from "@/lib/useLiveLocation";
import { batteryGuardState, openOemBatterySettings, requestBatteryExemption, type BatteryGuardState } from "@/lib/native-bridge";
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
  const { status: gps, native } = useLiveLocation(!!open);

  // Android throttles background location unless the app is exempt from
  // battery optimisation, so an unexempt phone silently stops reporting once
  // the screen goes off. Check on shift start, and re-check when the driver
  // comes back to the app (i.e. after the system dialog).
  const [battery, setBattery] = useState<BatteryGuardState | null>(null);
  useEffect(() => {
    if (!open || !native) { setBattery(null); return; }
    let cancelled = false;
    const check = async () => {
      const state = await batteryGuardState();
      if (!cancelled) setBattery(state);
    };
    void check();
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [open, native]);

  const doIn = async () => { setBusy(true); await clockIn(driverId); setBusy(false); };
  const doOut = async () => { setBusy(true); await clockOut(driverId); setBusy(false); };

  return (
    <>
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
              {gps === "live" && (
                <span style={{ color: "var(--green)" }}>
                  📍 {native
                    ? t("Sharing your location — keeps working with the screen off", "Compartiendo tu ubicación — sigue con la pantalla apagada")
                    : t("Sharing your location while this app is open", "Compartiendo tu ubicación mientras esta app esté abierta")}
                </span>
              )}
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

    {/* Android will quietly throttle the location service once the screen is
        off unless the app is exempt. Surfaced as a fixable prompt rather than
        letting the truck vanish off the dispatcher's map mid-route. */}
    {open && battery && !battery.ignoring && (
      <div className="card" style={{ marginBottom: 12, background: "#fff7ec", borderColor: "var(--amber)" }}>
        <b style={{ color: "#b9791a" }}>
          🔋 {t("Your phone may stop sharing your location", "Tu teléfono puede dejar de compartir tu ubicación")}
        </b>
        <div className="hint" style={{ marginTop: 4 }}>
          {t(
            "Android can pause the app to save battery once the screen is off. Tap Allow so dispatch keeps seeing you all shift.",
            "Android puede pausar la app para ahorrar batería cuando la pantalla se apaga. Toca Permitir para que logística te siga viendo todo el turno.",
          )}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button className="btn btn-primary btn-sm" onClick={() => void requestBatteryExemption()}>
            {t("Allow", "Permitir")}
          </button>
          {/* Samsung/Xiaomi/Oppo add their own killer on top of Android's, on a
              screen no app is allowed to change — the driver taps through it. */}
          {battery.hasOemSettings && (
            <button className="btn btn-ghost btn-sm" onClick={() => void openOemBatterySettings()}>
              {t(`${battery.manufacturer} settings`, `Ajustes de ${battery.manufacturer}`)}
            </button>
          )}
        </div>
      </div>
    )}
    </>
  );
}
