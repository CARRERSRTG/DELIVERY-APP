"use client";

import { useState } from "react";
import { useData } from "@/lib/timetracker-data-provider";
import { WorkDiary } from "@/components/timetracker/WorkDiary";
import type { Screenshot } from "@/lib/timetracker/types";

// Ported (D-069) from timetracker-clean's employee/EmployeeScreenshots.jsx —
// thin wrapper around the shared WorkDiary: my own screenshots, with the
// ability to delete one (RLS allows an employee to delete their own).
export default function WorkDiaryPage() {
  const { myScreenshots, mySessions, deleteScreenshot } = useData();
  const [busy, setBusy] = useState(false);

  async function del(s: Screenshot) {
    if (busy) return;
    if (!confirm("Delete this screenshot? This removes it permanently, for your manager too.")) return;
    setBusy(true);
    try { await deleteScreenshot(s.id, s.path); }
    catch (e) { const err = e as { message?: string } | null; alert("Could not delete: " + (err?.message || "unknown error")); }
    finally { setBusy(false); }
  }

  return (
    <div className="card">
      <h2>Work diary</h2>
      <WorkDiary shots={myScreenshots} sessions={mySessions} onDelete={del} />
      <p className="small muted" style={{ marginTop: 12 }}>
        One screenshot per ~10-minute segment (up to 6/hour), taken at a random time. The bar shows that segment&apos;s activity. Deleting a shot removes it for your manager too.
      </p>
    </div>
  );
}
