"use client";

import { useEffect, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { APK_DOWNLOAD_URL, updateAvailable } from "@/lib/app-update";

// ============================================================
// Tells a driver running an OUTDATED APK that a new one is ready.
//
// Only appears inside the app, and only for a native update — everything else
// (screens, pricing, routing) already arrives with the deploy, so this stays
// silent for the changes that ship weekly.
//
// Tapping Update opens the APK URL: Android's own download manager fetches it
// and offers to install, so the app needs no install permission of its own.
// Because the new APK is signed with the same key, it installs OVER the old
// one and the driver keeps their session.
// ============================================================

export function AppUpdateBanner() {
  const { t } = usePrefs();
  // Read the user agent after mount: on the server there is no UA to inspect,
  // and rendering different HTML there than the client would break hydration.
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setShow(updateAvailable(navigator.userAgent));
  }, []);

  if (!show || dismissed) return null;

  return (
    <div
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        gap: 12, flexWrap: "wrap", padding: "8px 14px",
        background: "var(--accent)", color: "#fff", fontSize: 13.5, fontWeight: 600,
      }}
    >
      <span>⬆ {t("A new version of the app is available.", "Hay una nueva versión de la app.")}</span>
      <a
        href={APK_DOWNLOAD_URL}
        style={{
          background: "rgba(255,255,255,.22)", color: "#fff", textDecoration: "none",
          padding: "3px 12px", borderRadius: 7, fontWeight: 700,
        }}
      >
        {t("Update", "Actualizar")}
      </a>
      <button
        onClick={() => setDismissed(true)}
        title={t("Later", "Después")}
        style={{ background: "none", border: "none", color: "#fff", opacity: 0.85, cursor: "pointer", fontSize: 15, padding: "0 4px" }}
      >
        ✕
      </button>
    </div>
  );
}
