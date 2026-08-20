"use client";

import { useEffect, useState } from "react";
import { useData } from "@/lib/timetracker-data-provider";
import { useT } from "@/lib/timetracker/i18n";
import { fmtClock, fmtTime } from "@/lib/timetracker/helpers";

// Ported (D-071) from timetracker-clean's manager/LiveMonitor.jsx — "who's
// working now", live via the provider's `liveSessions` (its own realtime
// channel, filtered to is_live=true — see the provider's block comment).
export default function LiveMonitorPage() {
  const { me, liveSessions, allEmployees: users, allProjects: projects } = useData();
  const t = useT();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);

  const uMap = new Map(users.map((u) => [u.id, u]));
  const pMap = new Map(projects.map((p) => [p.id, p]));
  const rows = liveSessions.slice().sort((a, b) => (a.startMs || 0) - (b.startMs || 0));

  function status(note: string | null) {
    if (!note) return null;
    if (note === "idle") return { pill: "wait", text: t("mgr.live.idle") };
    if (note === "break") return { pill: "wait", text: t("mgr.live.break") };
    if (note === "active") return { pill: "on", text: t("mgr.live.working") };
    return { pill: "on", text: "🟢 " + note };
  }

  if (me.role !== "admin") return <div className="card"><p className="muted">Admins only.</p></div>;

  return (
    <div className="card">
      <div className="between">
        <h2 style={{ margin: 0 }}>{t("mgr.tab.live")}</h2>
        <span className="chip">{t("mgr.live.active", { n: rows.length })}</span>
      </div>
      {rows.length === 0 ? (
        <p className="muted" style={{ marginTop: 12 }}>{t("mgr.live.empty")}</p>
      ) : (
        <div className="pbtns" style={{ marginTop: 12 }}>
          {rows.map((s) => {
            const emp = uMap.get(s.employeeUid);
            const proj = pMap.get(s.projectId ?? "");
            const elapsed = s.startMs ? Math.max(0, Math.floor((now - s.startMs) / 1000)) : (s.durationSeconds || 0);
            const dur = s.durationSeconds || 0;
            const pct = dur > 0 ? Math.round(((s.activeSeconds || 0) / dur) * 100) : 0;
            const screen = s.screenSeconds || 0;
            const inputActive = Math.max(0, (s.activeSeconds || 0) - screen);
            const idle = s.idleSeconds || 0;
            const st = status(s.liveNote);
            return (
              <div key={s.id} className="box">
                <div style={{ fontWeight: 700 }}>
                  {emp ? emp.fullName : (s.employeeName || "—")}
                  {st ? <span className={"pill " + st.pill} style={{ marginLeft: 6 }}>{st.text}</span>
                    : <span className="pill on" style={{ marginLeft: 6 }}>{t("mgr.live.livePill")}</span>}
                </div>
                <div className="small muted">{proj ? proj.name : "—"}{s.memo ? " · " + s.memo : ""}</div>
                <div className="row between" style={{ marginTop: 6 }}>
                  <span className="timer-big" style={{ fontSize: 26 }}>{fmtClock(elapsed)}</span>
                  <span className="small muted" style={{ textAlign: "right" }}>
                    {t("mgr.live.activity", { pct })}<br />{t("mgr.live.since", { time: s.startMs ? fmtTime(s.startMs) : "—" })}
                  </span>
                </div>
                <div className="small muted" style={{ marginTop: 6 }}>
                  ⌨ {fmtClock(inputActive)} {t("mgr.live.wInput")} · 🖥 {fmtClock(screen)} {t("mgr.live.wScreen")} · 💤 {fmtClock(idle)} {t("mgr.live.wIdle")}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="small muted" style={{ marginTop: 10 }}>{t("mgr.live.foot")}</p>
    </div>
  );
}
