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
  myScreenshots: Screenshot[];
  latestScreenshot: Screenshot | null;
  screenshotSignedUrl: (path: string, expiresIn?: number) => Promise<string>;
  /** Own-delete only (RLS: employee_uid = auth.uid()) — mirrors the
   * original's deleteWithFile(): best-effort storage removal, then the
   * metadata row (which is what actually matters to the diary/manager). */
  deleteScreenshot: (id: string, path: string | null) => Promise<void>;

  // ---- account ----
  updateMyAccount: (patch: { fullName: string; city: string; payMethod: string; payDetails: string }) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
  signOutEverywhere: () => Promise<void>;

  // ---- manager-only (D-070) ----
  // Empty arrays for a non-admin — never fetched for them, RLS would return
  // nothing anyway (is_timetracker_admin() gates every one of these), so
  // there's no wasted round trip. Reference data (who exists, what projects/
  // assignments/requests exist) via reloadAll()+realtime, same as everything
  // above. Sessions are NOT here: company-wide time entries are a genuinely
  // unbounded, ever-growing dataset — bulk-loading and realtime-subscribing
  // to ALL of them (the way `mySessions` safely does for ONE employee) would
  // not scale. Manager screens that need a time window call `sessionsSince`
  // on demand instead.
  allEmployees: Employee[];
  allProjects: Project[];
  allAssignments: Assignment[];
  allRequests: TimeRequest[];
  /** On-demand, not part of reloadAll()/realtime — see the block comment
   * above. Every session (any employee) with date >= startISO. */
  sessionsSince: (startISO: string) => Promise<Session[]>;
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
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [allAssignments, setAllAssignments] = useState<Assignment[]>([]);
  const [allRequests, setAllRequests] = useState<TimeRequest[]>([]);
  const isAdmin = me.role === "admin";
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

  // Manager-only reference data (D-070) — gated to isAdmin so a non-admin
  // never even issues these queries (RLS would empty them anyway, but no
  // sense paying for round trips nobody can use).
  const reloadAdmin = useCallback(async () => {
    if (!isAdmin) return;
    const [pf, es, pr, asn, rq] = await Promise.all([
      supabase.schema("public").from("profiles")
        .select("id, full_name, timetracker_role")
        .not("timetracker_role", "is", null)
        .order("full_name"),
      supabase.from("employee_settings").select("*"),
      supabase.from("projects").select("*").order("created_at"),
      supabase.from("assignments").select("*"),
      supabase.from("requests").select("*").order("created_at", { ascending: false }),
    ]);
    const esById = new Map(
      ((es.data as Record<string, unknown>[] | null) ?? []).map((r) => [r.id as string, rowToCamel<Omit<Employee, "id" | "fullName" | "role" | "email">>(r)!]),
    );
    const employees = ((pf.data as { id: string; full_name: string | null; timetracker_role: string }[] | null) ?? []).map((p) => {
      const s = esById.get(p.id);
      const emp: Employee = {
        id: p.id, fullName: p.full_name ?? "—", email: null, role: p.timetracker_role as Employee["role"],
        city: s?.city ?? null, payMethod: s?.payMethod ?? null, payDetails: s?.payDetails ?? null,
        workerType: s?.workerType ?? null, trackMode: s?.trackMode ?? null, breaksEnabled: s?.breaksEnabled ?? null,
        active: s?.active ?? false, deletedAt: s?.deletedAt ?? null,
      };
      return emp;
    });
    // Live employees only — soft-deleted (deleted_at set) are filtered out
    // everywhere the app lists people, same as the original's subscribeAll().
    setAllEmployees(employees.filter((e) => !e.deletedAt));
    const projectRows = ((pr.data as Record<string, unknown>[] | null) ?? []).map((r) => rowToCamel<Project>(r)!);
    setAllProjects(projectRows);
    const byId = new Map(projectRows.map((p) => [p.id, p]));
    setAllAssignments(
      ((asn.data as Record<string, unknown>[] | null) ?? [])
        .map((r) => rowToCamel<Omit<Assignment, "project">>(r)!)
        .map((a) => ({ ...a, project: byId.get(a.projectId) }))
        .filter((a): a is Assignment => !!a.project),
    );
    setAllRequests(((rq.data as Record<string, unknown>[] | null) ?? []).map((r) => rowToCamel<TimeRequest>(r)!));
  }, [supabase, isAdmin]);

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

  // Manager-only reference data — its own effect/channel so a non-admin
  // never opens it at all (isAdmin is stable per session; role changes
  // require a re-login, same as every other role check in this app).
  useEffect(() => {
    if (!isAdmin) return;
    reloadAdmin();
    const channel = supabase
      .channel(`timetracker-admin:${me.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, reloadAdmin)
      .on("postgres_changes", { event: "*", schema: "timetracker", table: "employee_settings" }, reloadAdmin)
      .on("postgres_changes", { event: "*", schema: "timetracker", table: "projects" }, reloadAdmin)
      .on("postgres_changes", { event: "*", schema: "timetracker", table: "assignments" }, reloadAdmin)
      .on("postgres_changes", { event: "*", schema: "timetracker", table: "requests" }, reloadAdmin)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, me.id, isAdmin, reloadAdmin]);

  const sessionsSince = useCallback<DataState["sessionsSince"]>(async (startISO) => {
    if (!isAdmin) return [];
    const { data, error } = await supabase.from("sessions").select("*").gte("date", startISO);
    if (error) throw error;
    return ((data as Record<string, unknown>[] | null) ?? []).map((r) => rowToCamel<Session>(r)!);
  }, [supabase, isAdmin]);

  // My own screenshots — desktop-captured, so this stays empty for anyone
  // tracking only from the web (there's no browser screenshot capture; see
  // ARCHITECTURE.md on why). Filtered realtime, same reasoning as sessions.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from("screenshots").select("*").eq("employee_uid", me.id)
        .order("taken_at", { ascending: false });
      if (!cancelled) setScreenshots(((data as Record<string, unknown>[] | null) ?? []).map((r) => rowToCamel<Screenshot>(r)!));
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

  const deleteScreenshot = useCallback<DataState["deleteScreenshot"]>(async (id, path) => {
    if (path) { try { await supabase.storage.from("timetracker-screenshots").remove([path]); } catch { /* best-effort */ } }
    const { error } = await supabase.from("screenshots").delete().eq("id", id);
    if (error) throw error;
  }, [supabase]);

  // profiles.full_name lives in `public` (shared identity); employee_settings
  // (city/pay info) lives in `timetracker` — two writes, same split D-066
  // already established for reads. employee_settings may not have a row yet
  // (nobody creates one on grant — see layout.tsx), so this upserts.
  const updateMyAccount = useCallback<DataState["updateMyAccount"]>(async (patch) => {
    const [p, es] = await Promise.all([
      supabase.schema("public").from("profiles").update({ full_name: patch.fullName.trim() }).eq("id", me.id),
      supabase.from("employee_settings").upsert({
        id: me.id, city: patch.city.trim(), pay_method: patch.payMethod || null, pay_details: patch.payDetails.trim(),
      }),
    ]);
    if (p.error) throw p.error;
    if (es.error) throw es.error;
  }, [supabase, me.id]);

  const updatePassword = useCallback<DataState["updatePassword"]>(async (newPassword) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  }, [supabase]);

  const signOutEverywhere = useCallback<DataState["signOutEverywhere"]>(async () => {
    const { error } = await supabase.auth.signOut({ scope: "global" });
    if (error) throw error;
  }, [supabase]);

  const value: DataState = {
    ready, me, settings, projects, myAssignments: assignments, mySessions: sessions, myPayrolls: payrolls,
    myRequests: requests, addRequest,
    toast, notify,
    listLiveSessions, startSession, updateSession,
    myScreenshots: screenshots, latestScreenshot: screenshots[0] ?? null, screenshotSignedUrl, deleteScreenshot,
    updateMyAccount, updatePassword, signOutEverywhere,
    allEmployees, allProjects, allAssignments, allRequests, sessionsSince,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {toast && <div className="toast">{toast}</div>}
    </Ctx.Provider>
  );
}
