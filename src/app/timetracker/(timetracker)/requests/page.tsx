"use client";

import { useState } from "react";
import { useData } from "@/lib/timetracker-data-provider";
import { APP_SETTINGS, dateISO, fmtClock, weekIsFinished, weekStartISO } from "@/lib/timetracker/helpers";
import type { RequestType } from "@/lib/timetracker/types";

// Ported (D-066, pass 3) from timetracker-clean's employee/EmployeeRequests.jsx —
// a form to ask a manager to add/adjust/delete a time entry, plus a list of
// past requests and their status. No desktop/offline concerns; a plain form
// + insert, mechanically translated.

const LABEL: Record<RequestType, string> = { add: "Add time", adjust: "Adjust time", delete: "Delete time" };

function hhmm(ms: number | null): string {
  if (!ms) return "";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: APP_SETTINGS.timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));
  } catch { return ""; }
}
function tParse(t: string): number | null { if (!t) return null; const p = t.split(":"); return Number(p[0]) * 60 + Number(p[1] || 0); }
function rangeHours(from: string, to: string): number {
  const a = tParse(from), b = tParse(to);
  if (a == null || b == null) return 0;
  let d = b - a; if (d < 0) d += 1440;
  return d / 60;
}
function mmhh(min: number): string { return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`; }
// [start, end] minutes-since-midnight, sorted, for every already-tracked
// session on `date` — a new "add time" request must not land inside any of
// these (the whole point is filling in time that was NEVER tracked).
type Range = { startMin: number; endMin: number };

interface FormState { assignmentId: string; date: string; fromTime: string; toTime: string; sessionId: string; reason: string }

export default function MyRequestsPage() {
  const { me, myAssignments: assignments, mySessions: sessions, myRequests: requests, addRequest } = useData();
  const aMap = new Map(assignments.map((a) => [a.id, a]));
  const [type, setType] = useState<RequestType>("add");
  const blank: FormState = { assignmentId: "", date: dateISO(new Date()), fromTime: "", toTime: "", sessionId: "", reason: "" };
  const [f, setF] = useState<FormState>(blank);
  const [msg, setMsg] = useState("");
  const upd = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));
  const mySessions = sessions.slice().sort((a, b) => (b.startMs || 0) - (a.startMs || 0)).slice(0, 60);
  const hrs = rangeHours(f.fromTime, f.toTime);

  // Already-tracked blocks on the selected date, for "add time" only — an
  // add request exists to fill in time that was NEVER on the clock, so it
  // must not overlap a session that already covers part of that day.
  const trackedRanges: Range[] = type === "add"
    ? sessions
        .filter((s) => s.date === f.date && s.startMs != null)
        .map((s) => {
          const startMin = tParse(hhmm(s.startMs))!;
          const endMs = s.endMs ?? s.startMs!;
          let endMin = tParse(hhmm(endMs))!;
          if (endMin < startMin) endMin = 1440; // crossed midnight — clip the visible day at 24:00
          return { startMin, endMin };
        })
        .sort((a, b) => a.startMin - b.startMin)
    : [];
  const overlapsTracked = (fromMin: number, toMin: number) =>
    trackedRanges.some((r) => fromMin < r.endMin && toMin > r.startMin);
  // The open gap the currently-picked "From" time falls in (or the day's
  // first gap if nothing's picked yet) — used as min/max on the time
  // inputs. A single min/max range can't express multiple disjoint gaps,
  // so this covers the common case; overlapsTracked() below is the real
  // guarantee, checked again on submit regardless of what the picker allowed.
  const fromMinNow = tParse(f.fromTime) ?? 0;
  let gapStart = 0, gapEnd = 1440;
  for (const r of trackedRanges) {
    if (r.endMin <= fromMinNow) gapStart = Math.max(gapStart, r.endMin);
    if (r.startMin >= fromMinNow && r.startMin < gapEnd) gapEnd = r.startMin;
  }

  function pickSession(id: string) {
    const s = sessions.find((x) => x.id === id);
    if (s) setF((p) => ({ ...p, sessionId: id, date: s.date ?? p.date, fromTime: hhmm(s.startMs), toTime: hhmm(s.endMs || s.startMs) }));
    else setF((p) => ({ ...p, sessionId: id }));
  }

  async function send() {
    setMsg("");
    const involved: (string | null | undefined)[] = [];
    if (type === "add") involved.push(f.date);
    else {
      const s = sessions.find((x) => x.id === f.sessionId);
      if (s) involved.push(s.date);
      if (type === "adjust") involved.push(f.date);
    }
    if (involved.some((dt) => dt && weekIsFinished(weekStartISO(dt), "weekly"))) { setMsg("That week is closed and in review — you can no longer request changes to it."); return; }
    try {
      let payload: Record<string, unknown>;
      if (type === "add") {
        if (!f.assignmentId) { setMsg("Pick a project."); return; }
        if (!f.fromTime || !f.toTime) { setMsg("Enter the start and end time."); return; }
        if (hrs <= 0) { setMsg("End time must be after start time."); return; }
        // The real guarantee — min/max on the inputs only expresses one gap
        // at a time, this catches every already-tracked block on the date.
        if (overlapsTracked(tParse(f.fromTime)!, tParse(f.toTime)!)) {
          setMsg("That overlaps time you already tracked that day — pick a range that isn't covered yet.");
          return;
        }
        const a = aMap.get(f.assignmentId)!;
        payload = { employeeName: me.fullName, projectId: a.projectId, assignmentId: a.id, date: f.date, fromTime: f.fromTime, toTime: f.toTime, hours: Number(hrs.toFixed(2)), reason: f.reason.trim() };
      } else if (type === "adjust") {
        if (!f.sessionId) { setMsg("Pick an entry."); return; }
        if (!f.fromTime || !f.toTime) { setMsg("Enter the new start and end time."); return; }
        if (hrs <= 0) { setMsg("End time must be after start time."); return; }
        const s = sessions.find((x) => x.id === f.sessionId)!;
        payload = { employeeName: me.fullName, projectId: s.projectId, assignmentId: s.assignmentId, sessionId: s.id, date: f.date, fromTime: f.fromTime, toTime: f.toTime, hours: Number(hrs.toFixed(2)), oldSeconds: s.durationSeconds, reason: f.reason.trim() };
      } else {
        if (!f.sessionId) { setMsg("Pick an entry."); return; }
        const s = sessions.find((x) => x.id === f.sessionId)!;
        payload = { employeeName: me.fullName, projectId: s.projectId, assignmentId: s.assignmentId, sessionId: s.id, date: s.date, reason: f.reason.trim() };
      }
      await addRequest(type, payload);
      setF(blank);
      setMsg("Request sent. The manager must approve it.");
    } catch (e) {
      const err = e as { message?: string } | null;
      setMsg(err?.message || "Failed to send.");
    }
  }

  const sorted = requests.slice().sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

  return (
    <>
      <div className="card">
        <h2>New request</h2>
        {msg && <div className="banner info">{msg}</div>}
        <label>Type</label>
        <div className="row">
          {(["add", "adjust", "delete"] as const).map((rt) => (
            <button key={rt} className={type === rt ? "" : "btn-ghost"} onClick={() => { setType(rt); setF(blank); }}>{LABEL[rt]}</button>
          ))}
        </div>

        {type === "add" && (
          <>
            <div className="grid g2" style={{ marginTop: 10 }}>
              <div>
                <label>Project</label>
                <select value={f.assignmentId} onChange={(e) => upd("assignmentId", e.target.value)}>
                  <option value="">Pick…</option>
                  {assignments.map((a) => <option key={a.id} value={a.id}>{a.project.name}</option>)}
                </select>
              </div>
              <div><label>Date</label><input type="date" value={f.date} onChange={(e) => upd("date", e.target.value)} /></div>
            </div>
            {trackedRanges.length > 0 && (
              <div className="hint" style={{ marginTop: 6 }}>
                Already tracked that day: {trackedRanges.map((r) => `${mmhh(r.startMin)}–${mmhh(r.endMin)}`).join(", ")}
              </div>
            )}
            <div className="grid g2">
              <div>
                <label>From</label>
                <input type="time" value={f.fromTime} min={mmhh(gapStart)} max={mmhh(gapEnd)} onChange={(e) => upd("fromTime", e.target.value)} />
              </div>
              <div>
                <label>To</label>
                <input type="time" value={f.toTime} min={mmhh(gapStart)} max={mmhh(gapEnd)} onChange={(e) => upd("toTime", e.target.value)} />
              </div>
            </div>
          </>
        )}

        {type === "adjust" && (
          <>
            <label style={{ marginTop: 10 }}>Entry to fix</label>
            <select value={f.sessionId} onChange={(e) => pickSession(e.target.value)}>
              <option value="">Pick an entry…</option>
              {mySessions.map((s) => {
                const a = aMap.get(s.assignmentId ?? "");
                return <option key={s.id} value={s.id}>{s.date} · {a ? a.project.name : "—"} · {fmtClock(s.durationSeconds)} · {s.memo || "no note"}</option>;
              })}
            </select>
            <div className="grid g2" style={{ marginTop: 8 }}>
              <div><label>Date</label><input type="date" value={f.date} onChange={(e) => upd("date", e.target.value)} /></div>
              <div />
            </div>
            <div className="grid g2">
              <div><label>New From</label><input type="time" value={f.fromTime} onChange={(e) => upd("fromTime", e.target.value)} /></div>
              <div><label>New To</label><input type="time" value={f.toTime} onChange={(e) => upd("toTime", e.target.value)} /></div>
            </div>
          </>
        )}

        {type === "delete" && (
          <>
            <label style={{ marginTop: 10 }}>Entry to delete</label>
            <select value={f.sessionId} onChange={(e) => upd("sessionId", e.target.value)}>
              <option value="">Pick an entry…</option>
              {mySessions.map((s) => {
                const a = aMap.get(s.assignmentId ?? "");
                return <option key={s.id} value={s.id}>{s.date} · {a ? a.project.name : "—"} · {fmtClock(s.durationSeconds)} · {s.memo || "no note"}</option>;
              })}
            </select>
          </>
        )}

        {(type === "add" || type === "adjust") && hrs > 0 && (
          <div className="small muted" style={{ marginTop: 4 }}>That&apos;s <b>{hrs.toFixed(2)} h</b> — the system calculates it from the times.</div>
        )}
        <label style={{ marginTop: 8 }}>Reason (optional)</label>
        <input value={f.reason} onChange={(e) => upd("reason", e.target.value)} placeholder="e.g. forgot to start the timer" />
        <button style={{ marginTop: 14 }} onClick={send}>Send request</button>
      </div>

      <div className="card">
        <h2>My requests</h2>
        {sorted.length === 0 ? <p className="muted">You haven&apos;t sent any yet.</p> : (
          <table>
            <thead><tr><th>Type</th><th>Detail</th><th>Status</th></tr></thead>
            <tbody>
              {sorted.map((r) => {
                const p = (r.payload || {}) as Record<string, unknown>;
                const a = aMap.get((p.assignmentId as string) ?? "");
                const proj = a ? a.project.name : "";
                const det = r.type === "delete"
                  ? `${proj} · ${p.date}`
                  : `${proj} · ${p.date} · ${p.fromTime || ""}-${p.toTime || ""} (${p.hours} h)`;
                return (
                  <tr key={r.id}>
                    <td>{r.type ? LABEL[r.type] : "—"}</td>
                    <td className="small muted">{det}</td>
                    <td>
                      {r.status === "pending" ? <span className="pill wait">Pending</span>
                        : r.status === "approved" ? <span className="pill on">Approved</span>
                        : <span className="pill off">Rejected</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
