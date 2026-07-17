"use client";

import { STAGES, stageLabel } from "@/lib/constants";
import { usePrefs } from "@/lib/prefs";
import { fmtDate } from "@/lib/utils";
import type { Delivery } from "@/lib/types";

/** Kanban-style board: one column per workflow stage, orders as cards. */
export function OrdersBoard({
  rows,
  onOpen,
}: {
  rows: Delivery[];
  onOpen: (d: Delivery) => void;
}) {
  const { lang, t } = usePrefs();

  return (
    <div className="board-scroll">
      <div className="board">
        {STAGES.map((s) => {
          const col = rows.filter((d) => d.stage === s.key);
          return (
            <div key={s.key} className="board-col">
              <div className="board-col-head" style={{ borderTopColor: s.color }}>
                <span className="board-col-dot" style={{ background: s.color }} />
                <span className="board-col-name">{stageLabel(s.key, lang)}</span>
                <span className="board-col-cnt">{col.length}</span>
              </div>
              <div className="board-col-body">
                {col.length === 0 ? (
                  <div className="board-empty">—</div>
                ) : (
                  col.map((d) => (
                    <button key={d.id} className="board-card" onClick={() => onOpen(d)}>
                      <div className="board-card-top">
                        <span className="board-card-no">#{d.order_no}</span>
                        {(d.actual_pallets ?? d.est_pallets) != null && (
                          <span className="board-card-pallets">{d.actual_pallets ?? d.est_pallets} {t("plt", "trm")}</span>
                        )}
                      </div>
                      <div className="board-card-acct">{d.account || t("(no account)", "(sin cuenta)")}</div>
                      <div className="board-card-meta">
                        {d.store && <span>{d.store}</span>}
                        {d.delivery_date && <span>📅 {fmtDate(d.delivery_date)}</span>}
                      </div>
                      {d.assigned_driver && <div className="board-card-driver">🚚 {d.assigned_driver}</div>}
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
