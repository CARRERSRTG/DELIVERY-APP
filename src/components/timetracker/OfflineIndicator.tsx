"use client";

import { useEffect, useState } from "react";
import { subscribeOfflineStatus, type OfflineStatus } from "@/lib/timetracker/offlineQueue";

// Fixed bottom-left pill reporting anything buffered by the offline queue
// (D-074), ported from timetracker-clean's App.jsx OfflineIndicator.
export function OfflineIndicator() {
  const [s, setS] = useState<OfflineStatus>({ online: true, sessions: 0, shots: 0, total: 0 });
  useEffect(() => subscribeOfflineStatus(setS), []);
  if (s.online && s.total === 0) return null;
  const parts: string[] = [];
  if (s.sessions) parts.push(s.sessions + " time" + (s.sessions > 1 ? " updates" : " update"));
  if (s.shots) parts.push(s.shots + " screenshot" + (s.shots > 1 ? "s" : ""));
  const queued = parts.join(" + ");
  return (
    <div
      style={{ position: "fixed", left: 16, bottom: 16, zIndex: 9997, maxWidth: 320 }}
      className="box"
      title="Your work is saved on this device and will upload automatically."
    >
      <div className="small" style={{ fontWeight: 700 }}>
        {s.online ? "🔄 Syncing…" : "⚠ Offline"}
      </div>
      <div className="small muted">
        {s.total > 0
          ? `${queued} saved on this device — will sync ${s.online ? "now" : "when you're back online"}.`
          : "No connection. Your tracked time is still being recorded locally."}
      </div>
    </div>
  );
}
