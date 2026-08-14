"use client";

import { useEffect, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { useData } from "@/lib/data-provider";

// Connectivity indicator. Two different things are worth saying, and saying
// the wrong one is worse than saying nothing:
//
//   • "You're offline" — a warning. Most of the app can't save right now.
//   • "N deliveries saved, sending when there's signal" — a REASSURANCE. The
//     driver's work is on the phone and will go out by itself.
//
// The second one matters most: a driver who thinks a delivery was lost will
// record it again, or worse, stop trusting the app.
export function OfflineBanner() {
  const { t } = usePrefs();
  const { pendingSync, syncing } = useData();
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);

  // Work waiting to go out takes priority over the plain offline notice —
  // it's the more useful, and more calming, thing to know.
  if (pendingSync > 0) {
    return (
      <div className="offline-banner no-print" style={{ background: syncing ? "var(--accent)" : "#b9791a" }}>
        {syncing
          ? `↑ ${t(`Sending ${pendingSync} saved delivery(ies)…`, `Enviando ${pendingSync} entrega(s) guardada(s)…`)}`
          : `💾 ${t(
              `${pendingSync} delivery(ies) saved on this phone — they'll send by themselves when there's signal.`,
              `${pendingSync} entrega(s) guardada(s) en este teléfono — se enviarán solas cuando haya señal.`,
            )}`}
      </div>
    );
  }

  if (online) return null;
  return (
    <div className="offline-banner no-print">
      📴 {t(
        "You’re offline. Pick-ups and deliveries are saved on this phone and sent when you reconnect; other changes have to wait.",
        "Estás sin conexión. Las recolecciones y entregas se guardan en este teléfono y se envían al reconectar; los demás cambios tendrán que esperar.",
      )}
    </div>
  );
}
