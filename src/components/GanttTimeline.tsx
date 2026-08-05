"use client";

import { parseWindow } from "@/lib/dispatch";
import { fmtWindows, orderLabel } from "@/lib/utils";
import type { Delivery } from "@/lib/types";

// Fixed day axis for the schedule view.
const AXIS_START = 7 * 60;  // 07:00
const AXIS_END = 19 * 60;   // 19:00

export interface GanttRow {
  key: string;
  title: string;
  color: string;
  orders: Delivery[];
}

/** A per-driver day timeline: each order rendered as a bar over its delivery
 * window on a shared 07:00–19:00 axis. Read-only; orders with no window are
 * listed as a count so nothing silently disappears. */
export function GanttTimeline({ rows, t }: { rows: GanttRow[]; t: (en: string, es: string) => string }) {
  const range = AXIS_END - AXIS_START;
  const pct = (m: number) => ((m - AXIS_START) / range) * 100;
  const hours: number[] = [];
  for (let m = AXIS_START; m <= AXIS_END; m += 60) hours.push(m);

  return (
    <div className="gantt-scroll">
      <div className="gantt">
        <div className="gantt-axis">
          <div className="gantt-rowlabel" />
          <div className="gantt-track gantt-hours">
            {hours.map((m) => (
              <span key={m} className="gantt-hour" style={{ left: `${pct(m)}%` }}>{String(Math.floor(m / 60)).padStart(2, "0")}:00</span>
            ))}
          </div>
        </div>
        {rows.map((row) => {
          const noWindow = row.orders.filter((d) => !parseWindow(d.delivery_windows)).length;
          return (
            <div className="gantt-row" key={row.key}>
              <div className="gantt-rowlabel">
                <span className="dboard-dot" style={{ background: row.color }} /> {row.title}
                {noWindow > 0 && <span className="hint">+{noWindow} {t("no window", "sin ventana")}</span>}
              </div>
              <div className="gantt-track">
                {hours.map((m) => <span key={m} className="gantt-grid" style={{ left: `${pct(m)}%` }} />)}
                {row.orders.map((d) => {
                  const w = parseWindow(d.delivery_windows);
                  if (!w) return null;
                  const left = Math.max(0, pct(w[0]));
                  const width = Math.max(2, Math.min(100 - left, pct(w[1]) - pct(w[0])));
                  return (
                    <div
                      key={d.id}
                      className="gantt-bar"
                      title={`#${orderLabel(d)} · ${fmtWindows(d.delivery_windows)} · ${d.account || ""}`}
                      style={{ left: `${left}%`, width: `${width}%`, background: row.color }}
                    >
                      #{orderLabel(d)}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
