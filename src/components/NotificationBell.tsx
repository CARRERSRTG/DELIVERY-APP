"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/data-provider";
import { stageInfo } from "@/lib/constants";

// Compact "3m", "2h", "4d" relative time for the notification list.
function ago(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** Bell with an unread badge + dropdown of the current user's workflow alerts. */
export function NotificationBell() {
  const { notifications, markNotifRead, markAllNotifsRead } = useData();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Mark read and jump to the order the notification is about.
  const onPick = (id: string, read: boolean, deliveryId: string | null) => {
    if (!read) markNotifRead(id);
    setOpen(false);
    if (deliveryId) router.push(`/?order=${deliveryId}`);
  };

  const unread = notifications.filter((n) => !n.read).length;

  // Close when clicking outside the panel.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="notif-wrap" ref={ref}>
      <button
        className="tab notif-btn"
        style={{ background: "rgba(255,255,255,.1)" }}
        onClick={() => setOpen((v) => !v)}
        title="Notifications"
      >
        🔔
        {unread > 0 && <span className="notif-badge">{unread > 9 ? "9+" : unread}</span>}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-head">
            <b>Notifications</b>
            {unread > 0 && (
              <button className="notif-clear" onClick={() => markAllNotifsRead()}>
                Mark all read
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div className="notif-empty">You&apos;re all caught up 🎉</div>
          ) : (
            <div className="notif-list">
              {notifications.map((n) => {
                const info = stageInfo(n.kind);
                return (
                  <button
                    key={n.id}
                    className={"notif-item" + (n.read ? "" : " unread")}
                    onClick={() => onPick(n.id, n.read, n.delivery_id)}
                  >
                    <span className="notif-dot" style={{ background: info.color }} />
                    <span className="notif-body">
                      <span className="notif-msg">{n.message}</span>
                      <span className="notif-time">{ago(n.created_at)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
