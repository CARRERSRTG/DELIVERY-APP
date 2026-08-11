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
import { createClient } from "@/lib/supabase/client";
import type { Delivery, DriverAvailability, DriverIncident, DriverShift, OrderEvent, Profile, Settings, Stage, UserRole } from "@/lib/types";
import { type AppNotification, notificationsForStage } from "@/lib/notifications";
import { canTransition } from "@/lib/constants";
import { orderOwner, changedFieldsNote } from "@/lib/utils";
import { nextOrderCode, codeBand } from "@/lib/order-code";
import { blankDelivery } from "@/lib/blank-delivery";

const DEFAULT_SETTINGS: Settings = {
  id: 1,
  app_name: "RDZ·DELIVERIES",
  stores: [
    { name: "Brownsville", address: "" },
    { name: "Weslaco", address: "" },
    { name: "Pharr", address: "" },
    { name: "McAllen", address: "" },
    { name: "Mission", address: "" },
    { name: "Edinburg", address: "" },
  ],
  order_types: ["Customer", "Intertienda", "Transfer"],
  order_type_rules: {
    Customer:    { storeToStore: false, docRef: "invoice" },
    Intertienda: { storeToStore: true,  docRef: "any", homeIsDestination: true },
    Transfer:    { storeToStore: true,  docRef: "estimate" },
  },
  pickup_min_per_pallet: 4,
  delivery_min_per_pallet: 5,
  rc_calls_enabled: false,
  rc_auto_sms_enabled: false,
  manager_pending_cutoff: "16:00",
  sales_pending_cutoff: "16:15",
};

export interface DataState {
  ready: boolean;
  /** The EFFECTIVE user — role is overridden while an admin is "viewing as"
   * another role (the sandbox preview). Everything role-gated follows this. */
  me: Profile | null;
  /** The signed-in user's real role, never overridden — use this to decide
   * whether to show the admin-only "view as" control itself. */
  realRole: UserRole | null;
  /** Which role an admin is previewing as, or null when viewing as themselves. */
  viewAs: UserRole | null;
  setViewAs: (r: UserRole | null) => void;
  /** Teaching (training) mode: a purely LOCAL sandbox layered over the live
   * data. Creates/edits/deletes go to an in-memory overlay and never touch the
   * DB; the real rows keep updating underneath, so others' live changes still
   * appear. Turning it off discards the overlay. */
  teaching: boolean;
  setTeaching: (v: boolean) => void;
  /** Discard the local practice overlay and reset the sandbox to the current
   * real data. Nothing in the DB is touched. */
  clearTrainingData: () => Promise<void>;
  settings: Settings;
  users: Profile[];
  deliveries: Delivery[];
  events: OrderEvent[];
  notifications: AppNotification[];
  toast: string;
  notify: (msg: string) => void;

  // in-app notifications (role-targeted workflow alerts)
  markNotifRead: (id: string) => Promise<void>;
  markAllNotifsRead: () => Promise<void>;
  /** Insert arbitrary notifications directly (e.g. the pending-approval
   * deadline escalation) — bypasses the stage-transition fan-out. */
  pushNotifs: (seeds: import("@/lib/notifications").NotifSeed[]) => Promise<void>;

  // delivery CRUD
  addDelivery: (d: Partial<Delivery>) => Promise<Delivery | null>;
  updateDelivery: (id: string, patch: Partial<Delivery>) => Promise<boolean>;
  deleteDelivery: (id: string) => Promise<void>;
  /** Move an order to a new workflow stage and log the event. `extra` merges
   * additional column updates into the SAME write (e.g. proof-of-delivery),
   * so they persist atomically instead of being clobbered by a follow-up save. */
  setStage: (id: string, stage: Stage, note?: string, extra?: Partial<Delivery>) => Promise<boolean>;
  eventsFor: (deliveryId: string) => OrderEvent[];
  /** Append a free-text note to an order's activity thread. */
  addNote: (deliveryId: string, text: string) => Promise<void>;

  // settings
  saveSettings: (patch: Partial<Settings>) => Promise<void>;

  // user management
  addUser: (input: { email: string; full_name: string; role: UserRole; password?: string; store?: string | null; quiet?: boolean }) => Promise<{ ok: boolean; email?: string; password?: string; error?: string }>;
  updateUserRole: (userId: string, role: Profile["role"]) => Promise<void>;
  updateUserName: (userId: string, name: string) => Promise<void>;
  /** Assign the store a warehouse worker / driver is scoped to (null = none). */
  updateUserStore: (userId: string, store: string | null) => Promise<void>;
  /** Grant a specific person extra capabilities on top of their role. */
  updateUserPermissions: (userId: string, permissions: string[]) => Promise<void>;
  deleteUser: (userId: string) => Promise<boolean>;

  // driver availability (vacation / sick / vehicle maintenance)
  availability: DriverAvailability[];
  addAvailability: (seed: Omit<DriverAvailability, "id" | "created_at" | "created_by">) => Promise<void>;
  removeAvailability: (id: string) => Promise<void>;

  // driver shift clock (idle-time KPI)
  shifts: DriverShift[];
  clockIn: (driverId: string) => Promise<void>;
  clockOut: (driverId: string) => Promise<void>;

  // logistics-manager driver incident log (things that cost the company money)
  incidents: DriverIncident[];
  addIncident: (inc: Omit<DriverIncident, "id" | "created_at" | "created_by">) => Promise<boolean>;
  removeIncident: (id: string) => Promise<void>;
}

// Teaching-mode sandbox: a local diff over the live data. `created` are orders
// that exist only in the sandbox; `updated` are field patches keyed by real id;
// `deleted` are real ids hidden while practising. None of this ever hits the DB.
type Overlay = { created: Delivery[]; updated: Record<string, Partial<Delivery>>; deleted: Set<string>; events: OrderEvent[] };
const emptyOverlay = (): Overlay => ({ created: [], updated: {}, deleted: new Set(), events: [] });
// The teaching sandbox is persisted here so practice changes survive reloads
// until "Reset sandbox" is pressed (the Set is stored as an array for JSON).
const TEACHING_OVERLAY_KEY = "rtg_teaching_overlay";

export const Ctx = createContext<DataState | null>(null);

export function useData(): DataState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}

export function DataProvider({ children, me }: { children: React.ReactNode; me: Profile | null }) {
  const supabase = useMemo(() => createClient(), []);
  const [ready, setReady] = useState(false);

  // ---- Admin "view as" sandbox: preview the app as any role, admin-only. ----
  const realRole: UserRole | null = me?.role ?? null;
  const [viewAs, setViewAsState] = useState<UserRole | null>(null);
  useEffect(() => {
    if (realRole !== "admin") { setViewAsState(null); return; }
    try {
      const raw = localStorage.getItem("rtg_view_as");
      if (raw && raw !== "admin") setViewAsState(raw as UserRole);
    } catch { /* ignore */ }
  }, [realRole]);
  const setViewAs = useCallback((r: UserRole | null) => {
    setViewAsState(r);
    try {
      if (r) localStorage.setItem("rtg_view_as", r);
      else localStorage.removeItem("rtg_view_as");
    } catch { /* ignore */ }
  }, []);
  const effectiveMe: Profile | null =
    me && realRole === "admin" && viewAs ? { ...me, role: viewAs } : me;

  // ---- Teaching mode: local sandbox overlay on the live data (see Overlay). ----
  const [teaching, setTeachingState] = useState(false);
  useEffect(() => {
    try { setTeachingState(localStorage.getItem("rtg_teaching") === "1"); } catch { /* ignore */ }
  }, []);
  const setTeaching = useCallback((v: boolean) => {
    setTeachingState(v);
    try { if (v) localStorage.setItem("rtg_teaching", "1"); else localStorage.removeItem("rtg_teaching"); } catch { /* ignore */ }
  }, []);

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [users, setUsers] = useState<Profile[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  // ---- Teaching-mode sandbox ----
  // Teaching mode is a purely LOCAL overlay on top of the real, live data:
  // creations, edits and deletions are recorded here and NEVER written to the
  // database, so nothing a user does in teaching mode is visible to anyone else.
  // Because the real `deliveries` keep updating from realtime, changes other
  // people make to the LIVE data still flow in underneath the sandbox while you
  // practice. The sandbox PERSISTS (localStorage) across reloads and across
  // toggling teaching off/on — practice changes stay until "Reset sandbox".
  const [overlay, setOverlay] = useState<Overlay>(emptyOverlay);
  const overlayLoaded = useRef(false);
  // Restore a saved sandbox on first load.
  useEffect(() => {
    if (overlayLoaded.current) return;
    overlayLoaded.current = true;
    try {
      const raw = localStorage.getItem(TEACHING_OVERLAY_KEY);
      if (raw) {
        const o = JSON.parse(raw);
        setOverlay({
          created: Array.isArray(o.created) ? o.created : [],
          updated: o.updated && typeof o.updated === "object" ? o.updated : {},
          deleted: new Set(Array.isArray(o.deleted) ? o.deleted : []),
          events: Array.isArray(o.events) ? o.events : [],
        });
      }
    } catch { /* ignore */ }
  }, []);
  // Persist the sandbox whenever it changes; clear the key once it's empty.
  useEffect(() => {
    if (!overlayLoaded.current) return;
    try {
      const empty = overlay.created.length === 0 && Object.keys(overlay.updated).length === 0
        && overlay.deleted.size === 0 && overlay.events.length === 0;
      if (empty) localStorage.removeItem(TEACHING_OVERLAY_KEY);
      else localStorage.setItem(TEACHING_OVERLAY_KEY, JSON.stringify({ ...overlay, deleted: [...overlay.deleted] }));
    } catch { /* ignore */ }
  }, [overlay]);
  const [events, setEvents] = useState<OrderEvent[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [availability, setAvailability] = useState<DriverAvailability[]>([]);
  const [shifts, setShifts] = useState<DriverShift[]>([]);
  const [incidents, setIncidents] = useState<DriverIncident[]>([]);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  }, []);

  // What the app actually renders. In live mode that's just the real rows; in
  // teaching mode it's the real rows with the local sandbox diff applied on top
  // (hide deleted, patch updated, prepend sandbox-created).
  const effectiveDeliveries = useMemo(() => {
    if (!teaching) return deliveries;
    const base = deliveries
      .filter((c) => !overlay.deleted.has(c.id))
      .map((c) => (overlay.updated[c.id] ? { ...c, ...overlay.updated[c.id] } : c));
    return [...overlay.created, ...base];
  }, [teaching, deliveries, overlay]);

  const reloadAll = useCallback(async () => {
    const [s, p, d, e, n, av, sh, inc] = await Promise.all([
      supabase.from("settings").select("*").eq("id", 1).maybeSingle(),
      supabase.from("profiles").select("id, full_name, role, store, avatar_url").order("full_name"),
      // Teaching mode never loads from the DB — the live (non-training) rows are
      // always the base, and the sandbox lives only in the local overlay.
      supabase.from("deliveries").select("*").eq("is_training", false).order("order_no", { ascending: false }),
      supabase.from("order_events").select("*").order("created_at", { ascending: false }),
      me
        ? supabase.from("notifications").select("*").eq("user_id", me.id).order("created_at", { ascending: false }).limit(50)
        : Promise.resolve({ data: [] as AppNotification[] }),
      supabase.from("driver_availability").select("*").order("start_date", { ascending: false }),
      supabase.from("driver_shifts").select("*").order("started_at", { ascending: false }),
      supabase.from("driver_incidents").select("*").order("incident_date", { ascending: false }),
    ]);
    if (s.data) setSettings(s.data as Settings);
    if (p.data) setUsers(p.data as Profile[]);
    if (d.data) setDeliveries(d.data as Delivery[]);
    if (e.data) setEvents(e.data as OrderEvent[]);
    if (n.data) setNotifications(n.data as AppNotification[]);
    if (av.data) setAvailability(av.data as DriverAvailability[]);
    if (sh.data) setShifts(sh.data as DriverShift[]);
    if (inc.data) setIncidents(inc.data as DriverIncident[]);
    setReady(true);
  }, [supabase, me]);

  // In the overlay model there's nothing in the DB to clear — the sandbox is
  // purely local — so "clear" just resets the local overlay back to empty.
  const clearTrainingData = useCallback(async () => {
    setOverlay(emptyOverlay());
    notify("Practice sandbox reset");
  }, [notify]);

  // Multiple concurrent sessions per account are allowed: a user can be signed
  // in on several devices/tabs at once (phone + desktop, or different roles in
  // separate browsers) without any of them being forced to sign out. The old
  // single-device lock (stamp active_session_id, sign out on mismatch) was
  // removed on purpose.

  useEffect(() => {
    reloadAll();
    const channel = supabase
      .channel("deliveries-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "deliveries" }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_events" }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "settings" }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "driver_availability" }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "driver_shifts" }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "driver_incidents" }, reloadAll)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, reloadAll]);

  // ---------------- Event log helper ----------------
  const logEvent = useCallback(
    async (deliveryId: string, kind: string, note?: string) => {
      await supabase.from("order_events").insert({
        delivery_id: deliveryId,
        kind,
        note: note ?? null,
        created_by: me?.id ?? null,
      });
    },
    [supabase, me],
  );

  // ---------------- Notification fan-out ----------------
  // Insert one row per recipient. Realtime pushes them to each user's bell.
  const emitStageNotifs = useCallback(
    async (args: { stage: Stage; order_no: number | null; order_code?: string | null; delivery_id: string; creatorId: string | null; reason?: string | null }) => {
      const seeds = notificationsForStage({ ...args, actorId: me?.id ?? null, users });
      if (!seeds.length) return;
      const { error } = await supabase.from("notifications").insert(seeds);
      if (error) console.error("notification insert failed:", error.message);
    },
    [supabase, me, users],
  );

  const pushNotifs = useCallback<DataState["pushNotifs"]>(
    async (seeds) => {
      if (!seeds.length) return;
      const { error } = await supabase.from("notifications").insert(seeds);
      if (error) console.error("notification insert failed:", error.message);
    },
    [supabase],
  );

  // ---------------- Delivery CRUD ----------------
  const addDelivery = useCallback<DataState["addDelivery"]>(
    async (d) => {
      // Teaching mode: build the order entirely client-side and keep it in the
      // local overlay. It never touches the DB, so no order number/code is
      // consumed, no events are logged, and nobody else is notified.
      if (teaching) {
        const nowIso = new Date().toISOString();
        const row = blankDelivery({
          ...d,
          id: d.id && d.id.length ? d.id : `teach-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          order_code: d.order_code ?? nextOrderCode(effectiveDeliveries.map((x) => x.order_code), new Date()),
          order_no: d.order_no ?? (effectiveDeliveries.reduce((m, x) => Math.max(m, x.order_no || 0), 900000) + 1),
          is_training: true,
          created_by: me?.id ?? null,
          created_at: nowIso,
          updated_at: nowIso,
        });
        setOverlay((o) => ({ ...o, created: [row, ...o.created] }));
        return row;
      }
      // created_by is always the actual actor — a non-sales creator assigning
      // the order to a rep (OrderModal's Sales Rep picker) sets assigned_sales_rep
      // instead, which is what orderOwner() resolves for own-orders visibility.
      const payload: Partial<Delivery> = { ...d, created_by: me?.id ?? null, is_training: false };
      // Assign the human-facing order code (split remainders pass one in). On a
      // rare race two orders can compute the same code — a unique index rejects
      // the second, so re-fetch the band's codes and retry a few times.
      let data: Delivery | null = null;
      let error: { code?: string; message: string } | null = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        if (payload.order_code == null) {
          let codes = deliveries.filter((x) => !x.is_training).map((x) => x.order_code);
          if (attempt > 0) {
            // Pull the freshest codes for this band straight from the DB.
            const band = codeBand(new Date());
            const { data: rows } = await supabase.from("deliveries")
              .select("order_code").eq("is_training", false)
              .gte("order_code", band.prefix + "100").lt("order_code", band.prefix + "999");
            if (rows) codes = (rows as { order_code: string | null }[]).map((r) => r.order_code);
          }
          payload.order_code = nextOrderCode(codes, new Date());
        }
        const res = await supabase.from("deliveries").insert(payload).select().single();
        data = res.data as Delivery | null;
        error = res.error;
        if (!error) break;
        if (error.code === "23505" && (error.message || "").includes("order_code")) {
          payload.order_code = null; // collision — recompute and retry
          continue;
        }
        break;
      }
      if (error || !data) {
        notify("Error: " + (error?.message ?? "insert failed"));
        return null;
      }
      const row = data as Delivery;
      setDeliveries((prev) => [row, ...prev]);
      await logEvent(row.id, "created");
      // An order created straight into "pending" (Submit for approval) alerts managers.
      if (row.stage && row.stage !== "draft") {
        await emitStageNotifs({ stage: row.stage, order_no: row.order_no, order_code: row.order_code, delivery_id: row.id, creatorId: orderOwner(row) });
      }
      return row;
    },
    [supabase, me, notify, logEvent, emitStageNotifs, teaching, deliveries, effectiveDeliveries],
  );

  const updateDelivery = useCallback<DataState["updateDelivery"]>(
    async (id, patch) => {
      // Teaching mode: record the edit in the local overlay only.
      if (teaching) {
        setOverlay((o) => {
          if (o.created.some((c) => c.id === id)) {
            return { ...o, created: o.created.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
          }
          return { ...o, updated: { ...o.updated, [id]: { ...o.updated[id], ...patch } } };
        });
        return true;
      }
      const before = deliveries.find((c) => c.id === id);
      const { error } = await supabase.from("deliveries").update(patch).eq("id", id);
      if (error) {
        notify("Error: " + error.message);
        return false;
      }
      setDeliveries((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
      // Record WHICH fields changed, so the activity log / audit is field-level.
      await logEvent(id, "edited", before ? (changedFieldsNote(before as unknown as Record<string, unknown>, patch as Record<string, unknown>) || undefined) : undefined);
      return true;
    },
    [supabase, notify, logEvent, teaching, deliveries],
  );

  const deleteDelivery = useCallback<DataState["deleteDelivery"]>(
    async (id) => {
      // Teaching mode: hide the row locally — drop it if it was sandbox-created,
      // otherwise mark the real id deleted in the overlay. The DB is untouched.
      if (teaching) {
        setOverlay((o) => {
          if (o.created.some((c) => c.id === id)) {
            return { ...o, created: o.created.filter((c) => c.id !== id) };
          }
          const deleted = new Set(o.deleted); deleted.add(id);
          const updated = { ...o.updated }; delete updated[id];
          return { ...o, deleted, updated };
        });
        return;
      }
      setDeliveries((prev) => prev.filter((c) => c.id !== id));
      const { error } = await supabase.from("deliveries").delete().eq("id", id);
      if (error) notify("Error: " + error.message);
    },
    [supabase, notify, teaching],
  );

  const setStage = useCallback<DataState["setStage"]>(
    async (id, stage, note, extra) => {
      // Hard guard: reject illegal workflow moves (e.g. straight to fulfilling
      // without manager approval). Admins may override to any status.
      const current = effectiveDeliveries.find((c) => c.id === id);
      if (current && me?.role !== "admin" && !canTransition(current.stage, stage)) {
        notify("This order must be approved by a manager first.");
        return false;
      }
      const patch: Partial<Delivery> = { stage, ...extra };
      if (stage === "approved") {
        patch.approved_by = me?.id ?? null;
        patch.approved_at = new Date().toISOString();
      }
      if (stage === "rejected") patch.rejected_reason = note ?? null;
      // Teaching mode: apply the stage change to the local overlay only.
      if (teaching) {
        setOverlay((o) => {
          if (o.created.some((c) => c.id === id)) {
            return { ...o, created: o.created.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
          }
          return { ...o, updated: { ...o.updated, [id]: { ...o.updated[id], ...patch } } };
        });
        return true;
      }
      const { error } = await supabase.from("deliveries").update(patch).eq("id", id);
      if (error) {
        notify(error.message);
        return false;
      }
      setDeliveries((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
      await logEvent(id, stage, note);
      const order = deliveries.find((c) => c.id === id);
      await emitStageNotifs({ stage, order_no: order?.order_no ?? null, order_code: order?.order_code ?? null, delivery_id: id, creatorId: order ? orderOwner(order) : null, reason: note });
      return true;
    },
    [supabase, me, notify, logEvent, deliveries, effectiveDeliveries, emitStageNotifs, teaching],
  );

  const eventsFor = useCallback(
    (deliveryId: string) => {
      const real = events.filter((e) => e.delivery_id === deliveryId);
      if (!teaching) return real;
      // Fold in sandbox-only notes for this order (newest first).
      const local = overlay.events.filter((e) => e.delivery_id === deliveryId);
      return [...local, ...real];
    },
    [events, teaching, overlay.events],
  );

  const addNote = useCallback<DataState["addNote"]>(
    async (deliveryId, text) => {
      const body = text.trim();
      if (!body) return;
      // Teaching mode: keep the note in the local overlay — never write to DB
      // (a sandbox order id doesn't exist in the DB, which would error anyway).
      if (teaching) {
        const ev: OrderEvent = {
          id: `teach-ev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          delivery_id: deliveryId,
          kind: "note",
          note: body,
          created_by: me?.id ?? null,
          created_at: new Date().toISOString(),
        };
        setOverlay((o) => ({ ...o, events: [ev, ...o.events] }));
        return;
      }
      const { data, error } = await supabase
        .from("order_events")
        .insert({ delivery_id: deliveryId, kind: "note", note: body, created_by: me?.id ?? null })
        .select()
        .single();
      if (error) { notify("Error: " + error.message); return; }
      setEvents((prev) => [data as OrderEvent, ...prev]);
    },
    [supabase, me, notify, teaching],
  );

  // ---------------- Notifications ----------------
  const markNotifRead = useCallback<DataState["markNotifRead"]>(
    async (id) => {
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
      await supabase.from("notifications").update({ read: true }).eq("id", id);
    },
    [supabase],
  );

  const markAllNotifsRead = useCallback<DataState["markAllNotifsRead"]>(async () => {
    if (!me) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    await supabase.from("notifications").update({ read: true }).eq("user_id", me.id).eq("read", false);
  }, [supabase, me]);

  // ---------------- Settings ----------------
  const saveSettings = useCallback<DataState["saveSettings"]>(
    async (patch) => {
      setSettings((prev) => ({ ...prev, ...patch }));
      const { error } = await supabase.from("settings").update(patch).eq("id", 1);
      if (error) notify("Error: " + error.message);
    },
    [supabase, notify],
  );

  // ---------------- User management ----------------
  const addUser = useCallback<DataState["addUser"]>(
    async (input) => {
      const { quiet, ...payload } = input;
      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { if (!quiet) notify(body.error || "Could not create user"); return { ok: false, error: body.error || "Could not create user" }; }
      if (!quiet) { notify(`User ${input.email} created`); reloadAll(); }
      return { ok: true, email: body.email, password: body.password };
    },
    [notify, reloadAll],
  );

  const updateUserRole = useCallback<DataState["updateUserRole"]>(
    async (userId, role) => {
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)));
      const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
      if (error) { notify(error.message); reloadAll(); }
    },
    [supabase, notify, reloadAll],
  );

  const updateUserName = useCallback<DataState["updateUserName"]>(
    async (userId, name) => {
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, full_name: name } : u)));
      const { error } = await supabase.from("profiles").update({ full_name: name }).eq("id", userId);
      if (error) notify(error.message);
    },
    [supabase, notify],
  );

  const updateUserStore = useCallback<DataState["updateUserStore"]>(
    async (userId, store) => {
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, store } : u)));
      const { error } = await supabase.from("profiles").update({ store }).eq("id", userId);
      if (error) { notify(error.message); reloadAll(); }
    },
    [supabase, notify, reloadAll],
  );

  const updateUserPermissions = useCallback<DataState["updateUserPermissions"]>(
    async (userId, permissions) => {
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, permissions } : u)));
      const { error } = await supabase.from("profiles").update({ permissions }).eq("id", userId);
      if (error) { notify(error.message); reloadAll(); }
    },
    [supabase, notify, reloadAll],
  );

  const deleteUser = useCallback<DataState["deleteUser"]>(
    async (userId) => {
      const res = await fetch("/api/delete-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { notify(body.error || "Delete failed"); return false; }
      setUsers((prev) => prev.filter((u) => u.id !== userId));
      notify("User removed");
      return true;
    },
    [notify],
  );

  const addAvailability = useCallback<DataState["addAvailability"]>(async (seed) => {
    const { error } = await supabase.from("driver_availability").insert({ ...seed, created_by: me?.id ?? null });
    if (error) { notify("Error: " + error.message); return; }
    await reloadAll();
  }, [supabase, me, notify, reloadAll]);

  const removeAvailability = useCallback<DataState["removeAvailability"]>(async (id) => {
    const { error } = await supabase.from("driver_availability").delete().eq("id", id);
    if (error) { notify("Error: " + error.message); return; }
    await reloadAll();
  }, [supabase, notify, reloadAll]);

  const clockIn = useCallback<DataState["clockIn"]>(async (driverId) => {
    // Guard against a second open shift (also enforced by a partial unique index).
    if (shifts.some((sh) => sh.driver_id === driverId && !sh.ended_at)) return;
    const { error } = await supabase.from("driver_shifts").insert({ driver_id: driverId });
    if (error) { notify("Error: " + error.message); return; }
    await reloadAll();
  }, [supabase, shifts, notify, reloadAll]);

  const clockOut = useCallback<DataState["clockOut"]>(async (driverId) => {
    const open = shifts.find((sh) => sh.driver_id === driverId && !sh.ended_at);
    if (!open) return;
    const { error } = await supabase.from("driver_shifts").update({ ended_at: new Date().toISOString() }).eq("id", open.id);
    if (error) { notify("Error: " + error.message); return; }
    await reloadAll();
  }, [supabase, shifts, notify, reloadAll]);

  const addIncident = useCallback<DataState["addIncident"]>(async (inc) => {
    const { error } = await supabase.from("driver_incidents").insert({ ...inc, created_by: me?.id ?? null });
    if (error) { notify("Error: " + error.message); return false; }
    await reloadAll();
    return true;
  }, [supabase, me, notify, reloadAll]);

  const removeIncident = useCallback<DataState["removeIncident"]>(async (id) => {
    const { error } = await supabase.from("driver_incidents").delete().eq("id", id);
    if (error) { notify("Error: " + error.message); return; }
    await reloadAll();
  }, [supabase, notify, reloadAll]);

  const value: DataState = {
    ready, me: effectiveMe, realRole, viewAs, setViewAs, teaching, setTeaching, clearTrainingData, settings, users, deliveries: effectiveDeliveries, events, notifications, toast, notify,
    markNotifRead, markAllNotifsRead, pushNotifs,
    addDelivery, updateDelivery, deleteDelivery, setStage, eventsFor, addNote,
    saveSettings, addUser, updateUserRole, updateUserName, updateUserStore, updateUserPermissions, deleteUser,
    availability, addAvailability, removeAvailability,
    shifts, clockIn, clockOut,
    incidents, addIncident, removeIncident,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {toast && <div className="toast">{toast}</div>}
    </Ctx.Provider>
  );
}
