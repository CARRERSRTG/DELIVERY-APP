"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createClient } from "@/lib/timetracker/supabase/client";
import { rowToCamel, toSnakeRow } from "@/lib/timetracker/supabase/rowcase";
import { APP_SETTINGS, type AppSettings, syncAppSettings } from "@/lib/timetracker/helpers";
import type { Assignment, Employee, Payroll, Project, RequestType, Screenshot, Session, TimeRequest } from "@/lib/timetracker/types";

// ============================================================
// Etapa 2, pass 1 (D-066): foundation + the Track Time screen only. This
// DataState is deliberately narrower than the ~18-screen surface the full
// port eventually needs (projects/assignments/requests/payrolls/reports/
// live-monitor CRUD aren't here yet) — grown incrementally as each screen
// lands, same as recruiting-data-provider.tsx grew across D-050 through
// D-057 rather than arriving complete on day one.
//
// Row<->camel convention: every write/read here goes through
// toSnakeRow/rowToCamel (lib/timetracker/supabase/rowcase.ts), NOT the
// snake_case-everywhere shape recruiting-data-provider.tsx uses — see the
// comment on that module for why.
// ============================================================

interface DataState {
  ready: boolean;
  me: Employee;
  settings: AppSettings;
  projects: Project[];
  /** My own assignments, each with its `project` attached and archived
   * projects filtered out — mirrors the original's EmployeeDashboard
   * `myAssignments` computation exactly. */
  myAssignments: Assignment[];
  /** My own sessions, every one ever tracked (bounded by "one employee",
   * not company-wide — see the module comment on why this can be a plain
   * reloadAll() unlike the manager-facing screens still to come). */
  mySessions: Session[];
  /** My own payroll batches (one per paid/unpaid week). */
  myPayrolls: Payroll[];
  /** My own add/adjust/delete requests, pending or resolved. */
  myRequests: TimeRequest[];
  addRequest: (type: RequestType, payload: Record<string, unknown>) => Promise<void>;
  toast: string;
  notify: (msg: string) => void;

  // ---- sessions (Track Time) ----
  /** This employee's own currently-live (is_live=true) sessions — used to
   * detect and resolve the "already running elsewhere" conflict before a
   * new one starts, and to close out abandoned ones on load. */
  listLiveSessions: () => Promise<Session[]>;
  startSession: (payload: Partial<Session>) => Promise<Session>;
  updateSession: (id: string, patch: Partial<Session>) => Promise<void>;

  // ---- screenshots (desktop-captured; read-only from the web port) ----
  latestScreenshot: Screenshot | null;
  screenshotSignedUrl: (path: string, expiresIn?: number) => Promise<string>;
}

const Ctx = createContext<DataState | null>(null);

export function useData(): DataState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}

/** True if an error looks like a Postgres RLS rejection — almost always a
 * stale/absent JWT (auth.uid() came back null), fixable by a token refresh.
 * Ported from the original's isRlsError(); same reasoning. */
function isRlsError(e: unknown): boolean {
  const err = e as { message?: string; code?: string } | null;
  const msg = String(err?.message || err?.code || "").toLowerCase();
  return msg.includes("row-level security") || msg.includes("42501") || err?.code === "42501";
}

export function DataProvider({ children, me }: { children: React.ReactNode; me: Employee }) {
  const supabase = useMemo(() => createClient(), []);
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(APP_SETTINGS);
  const [projects, setProjects] = useState<Project[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [payrolls, setPayrolls] = useState<Payroll[]>([]);
  const [requests, setRequests] = useState<TimeRequest[]>([]);
  const [latestScreenshot, setLatestScreenshot] = useState<Screenshot | null>(null);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2400);
  }, []);

  // Make sure we hold a live access token before an authenticated write.
  // Without this, a write can fire while the token is missing/expired —
  // Postgres sees auth.uid() = null and RLS rejects the row. Ported from
  // the original's auth.ensureSession()/forceRefresh().
  const ensureSession = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const nowSec = Math.floor(Date.now() / 1000);
    if (!session || !session.expires_at || session.expires_at - nowSec < 60) {
      await supabase.auth.refreshSession().catch(() => {});
    }
  }, [supabase]);
  const forceRefresh = useCallback(async () => {
    await supabase.auth.refreshSession().catch(() => {});
  }, [supabase]);

  const reloadAll = useCallback(async () => {
    const [pr, asn, ss, py, rq, set] = await Promise.all([
      supabase.from("projects").select("*").eq("archived", false).order("created_at"),
      supabase.from("assignments").select("*").eq("employee_uid", me.id),
      supabase.from("sessions").select("*").eq("employee_uid", me.id),
      supabase.from("payrolls").select("*").eq("employee_uid", me.id),
      supabase.from("requests").select("*").eq("employee_uid", me.id),
      supabase.from("settings").select("*").eq("id", "app").maybeSingle(),
    ]);
    const projectRows = ((pr.data as Record<string, unknown>[] | null) ?? []).map((r) => rowToCamel<Project>(r)!);
    setProjects(projectRows);
    const byId = new Map(projectRows.map((p) => [p.id, p]));
    const asnRows = ((asn.data as Record<string, unknown>[] | null) ?? [])
      .map((r) => rowToCamel<Omit<Assignment, "project">>(r)!)
      .map((a) => ({ ...a, project: byId.get(a.projectId) }))
      .filter((a): a is Assignment => !!a.project);
    setAssignments(asnRows);
    setSessions(((ss.data as Record<string, unknown>[] | null) ?? []).map((r) => rowToCamel<Session>(r)!));
    setPayrolls(((py.data as Record<string, unknown>[] | null) ?? []).map((r) => rowToCamel<Payroll>(r)!));
    setRequests(((rq.data as Record<string, unknown>[] | null) ?? []).map((r) => rowToCamel<TimeRequest>(r)!));
    if (set.data) {
      const merged: AppSettings = { ...APP_SETTINGS, ...((set.data as { data: Partial<AppSettings> }).data) };
      syncAppSettings(merged);
      setSettings({ ...APP_SETTINGS });
    }
    setReady(true);
  }, [supabase, me.id]);

  useEffect(() => {
    reloadAll();
    // Narrow, filtered realtime — NOT a blunt "reload on any change to this
    // table" like recruiting-data-provider.tsx uses. sessions/screenshots
    // tick every ~10s while ANYONE is tracking; an unfiltered subscription
    // here would reload every employee's whole session history on every
    // other employee's tick. Filtered to `employee_uid=eq.<me>` so only
    // MY OWN writes (this tab, another tab, or the desktop app) trigger it.
    const channel = supabase
      .channel(`timetracker:${me.id}`)
      .on("postgres_changes", { event: "*", schema: "timetracker", table: "projects" }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "timetracker", table: "assignments", filter: `employee_uid=eq.${me.id}` }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "timetracker", table: "sessions", filter: `employee_uid=eq.${me.id}` }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "timetracker", table: "payrolls", filter: `employee_uid=eq.${me.id}` }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "timetracker", table: "requests", filter: `employee_uid=eq.${me.id}` }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "timetracker", table: "settings" }, reloadAll)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, me.id, reloadAll]);

  // Latest own screenshot — desktop-captured, so this stays empty for anyone
  // tracking only from the web (there's no browser screenshot capture; see
  // ARCHITECTURE.md on why). Filtered realtime, same reasoning as sessions.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from("screenshots").select("*").eq("employee_uid", me.id)
        .order("taken_at", { ascending: false }).limit(1);
      if (!cancelled) setLatestScreenshot(rowToCamel<Screenshot>((data as Record<string, unknown>[] | null)?.[0] ?? null));
    };
    load();
    const channel = supabase
      .channel(`timetracker-shots:${me.id}`)
      .on("postgres_changes", { event: "*", schema: "timetracker", table: "screenshots", filter: `employee_uid=eq.${me.id}` }, load)
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [supabase, me.id]);

  const listLiveSessions = useCallback<DataState["listLiveSessions"]>(async () => {
    const { data, error } = await supabase
      .from("sessions").select("*").eq("employee_uid", me.id).eq("is_live", true);
    if (error) throw error;
    return ((data as Record<string, unknown>[] | null) ?? []).map((r) => rowToCamel<Session>(r)!);
  }, [supabase, me.id]);

  const startSession = useCallback<DataState["startSession"]>(async (payload) => {
    await ensureSession();
    const row = toSnakeRow(payload as Record<string, unknown>);
    try {
      const { data, error } = await supabase.from("sessions").insert(row).select().single();
      if (error) throw error;
      return rowToCamel<Session>(data as Record<string, unknown>)!;
    } catch (e) {
      if (!isRlsError(e)) throw e;
      // RLS rejection almost always means a stale JWT — force a fresh token
      // and retry once before giving up (ported from the original).
      await forceRefresh();
      const { data, error } = await supabase.from("sessions").insert(row).select().single();
      if (error) throw error;
      return rowToCamel<Session>(data as Record<string, unknown>)!;
    }
  }, [supabase, ensureSession, forceRefresh]);

  const updateSession = useCallback<DataState["updateSession"]>(async (id, patch) => {
    const row = toSnakeRow(patch as Record<string, unknown>);
    const { error } = await supabase.from("sessions").update(row).eq("id", id);
    if (error) throw error;
  }, [supabase]);

  const screenshotSignedUrl = useCallback<DataState["screenshotSignedUrl"]>(async (path, expiresIn = 3600) => {
    const { data, error } = await supabase.storage.from("timetracker-screenshots").createSignedUrl(path, expiresIn);
    if (error) throw error;
    return data.signedUrl;
  }, [supabase]);

  const addRequest = useCallback<DataState["addRequest"]>(async (type, payload) => {
    const row = toSnakeRow({ employeeUid: me.id, type, status: "pending", payload });
    const { error } = await supabase.from("requests").insert(row);
    if (error) throw error;
  }, [supabase, me.id]);

  const value: DataState = {
    ready, me, settings, projects, myAssignments: assignments, mySessions: sessions, myPayrolls: payrolls,
    myRequests: requests, addRequest,
    toast, notify,
    listLiveSessions, startSession, updateSession,
    latestScreenshot, screenshotSignedUrl,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {toast && <div className="toast">{toast}</div>}
    </Ctx.Provider>
  );
}
