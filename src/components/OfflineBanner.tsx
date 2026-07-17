"use client";

import { useEffect, useState } from "react";
import { usePrefs } from "@/lib/prefs";

// Connectivity indicator (#40). In local demo mode the app is fully usable
// offline (data lives in the browser); in Supabase mode this warns that
// changes won't sync until the connection returns.
export function OfflineBanner() {
  const { t } = usePrefs();
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);

  if (online) return null;
  return (
    <div className="offline-banner no-print">
      📴 {t("You’re offline — changes are saved locally and will sync when you reconnect.", "Estás sin conexión — los cambios se guardan localmente y se sincronizarán al reconectar.")}
    </div>
  );
}
