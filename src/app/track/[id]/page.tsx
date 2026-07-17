"use client";

import { useEffect, useState } from "react";
import { stageInfo } from "@/lib/constants";
import { fmtDate } from "@/lib/utils";
import type { Delivery } from "@/lib/types";

// ============================================================
// Public, read-only delivery tracking page (#25). A customer opens
// /track/<order-id> to see their delivery's status — no login.
//
// Local demo mode reads the browser's localStorage store. In Supabase mode,
// point this at a public "delivery_status" view protected by RLS (only the
// non-sensitive status columns) and fetch it with the anon client.
// ============================================================

const LS_KEY = "rtg_deliveries_local_v7";

// The public-facing journey (internal-only stages are collapsed out).
const PUBLIC_FLOW = ["approved", "fulfilling", "ready", "picked_up", "delivered"] as const;

// Customer-friendly labels (hide internal wording like "Picked Up").
const PUBLIC_LABEL: Record<string, string> = {
  approved: "Order confirmed",
  fulfilling: "Being prepared",
  ready: "Ready to go",
  picked_up: "Out for delivery",
  delivered: "Delivered",
};
const publicLabel = (stage: string) => PUBLIC_LABEL[stage] ?? stageInfo(stage).label;

export default function TrackPage({ params }: { params: { id: string } }) {
  const [order, setOrder] = useState<Delivery | null | undefined>(undefined);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const store = JSON.parse(raw) as { deliveries: Delivery[] };
        setOrder(store.deliveries.find((d) => d.id === params.id) ?? null);
        return;
      }
    } catch { /* ignore */ }
    setOrder(null);
  }, [params.id]);

  const currentIdx = order ? PUBLIC_FLOW.indexOf(order.stage as (typeof PUBLIC_FLOW)[number]) : -1;

  return (
    <div className="auth-wrap" style={{ alignItems: "flex-start", paddingTop: 60 }}>
      <div className="auth-card" style={{ maxWidth: 460 }}>
        <h1>RDZ<span>·</span>Tracking</h1>
        <p className="hint" style={{ marginBottom: 20 }}>Live status of your delivery</p>

        {order === undefined && <div className="empty">Loading…</div>}
        {order === null && <div className="empty">We couldn’t find that delivery. Please check your link.</div>}

        {order && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div>
                <div style={{ fontFamily: "Archivo, sans-serif", fontWeight: 800, fontSize: 24 }}>#{order.order_no}</div>
                {order.account && <div className="hint">{order.account}</div>}
              </div>
              <span className="sema" style={{ background: stageInfo(order.stage).color, color: "#fff", fontSize: 13 }}>
                {publicLabel(order.stage)}
              </span>
            </div>

            {order.stage === "canceled" || order.stage === "rejected" ? (
              <div className="card" style={{ background: "#fef6f6", borderColor: "var(--red)" }}>
                This order is not currently scheduled for delivery. Please contact us for details.
              </div>
            ) : (
              <div className="track-flow">
                {PUBLIC_FLOW.map((stage, i) => {
                  const info = stageInfo(stage);
                  const done = currentIdx >= 0 && i <= currentIdx;
                  return (
                    <div key={stage} className={"track-step " + (done ? "done" : "")}>
                      <span className="track-dot" style={{ background: done ? info.color : "var(--line)" }}>{done ? "✓" : ""}</span>
                      <span className="track-label">{publicLabel(stage)}</span>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ marginTop: 20 }}>
              {order.delivery_date && <Row k="Delivery date" v={fmtDate(order.delivery_date)} />}
              {order.delivery_windows && <Row k="Time window" v={order.delivery_windows} />}
              {order.delivery_address && <Row k="Delivery to" v={order.delivery_address} />}
              {order.assigned_driver && <Row k="Driver" v={order.assigned_driver} />}
              {order.pod_received_by && <Row k="Received by" v={order.pod_received_by} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="detail-row">
      <span className="dk">{k}</span>
      <span className="dv">{v}</span>
    </div>
  );
}
