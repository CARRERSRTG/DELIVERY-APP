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
import type { Delivery, DriverAvailability, DriverShift, OrderEvent, Profile, Settings, Stage, UserRole } from "@/lib/types";
import { type AppNotification, notificationsForStage } from "@/lib/notifications";
import { canTransition } from "@/lib/constants";
import { orderOwner } from "@/lib/utils";

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
  order_types: ["Delivery", "Transfer", "Intratienda"],
  pickup_min_per_pallet: 4,
  delivery_min_per_pallet: 5,
  rc_calls_enabled: false,
  rc_auto_sms_enabled: false,
  manager_pending_cutoff: "16:00",
  sales_pending_cutoff: "16:15",
};

// Teaching-mode orders are numbered from this high base up, so practice orders
// never collide with, or consume a number from, the real order sequence.
const TRAINING_ORDER_BASE = 900000;

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
  /** Teaching (training) mode: when on, the app reads/writes only training
   * orders (is_training = true). They persist in the DB and never mix with
   * real orders. */
  teaching: boolean;
  setTeaching: (v: boolean) => void;
  /** Permanently delete every training order (is_training) — resets the
   * shared practice sandbox. Admin action. */
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
  addUser: (input: { email: string; full_name: string; role: UserRole; password?: string }) => Promise<{ ok: boolean; email?: string; password?: string }>;
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
}

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

  // ---- Teaching / training mode: scopes all data to is_training rows. ----
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
  const [events, setEvents] = useState<OrderEvent[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [availability, setAvailability] = useState<DriverAvailability[]>([]);
  const [shifts, setShifts] = useState<DriverShift[]>([]);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  }, []);

  const reloadAll = useCallback(async () => {
    const [s, p, d, e, n, av, sh] = await Promise.all([
      supabase.from("settings").select("*").eq("id", 1).maybeSingle(),
      supabase.from("profiles").select("id, full_name, role, store, avatar_url").order("full_name"),
      supabase.from("deliveries").select("*").eq("is_training", teaching).order("order_no", { ascending: false }),
      supabase.from("order_events").select("*").order("created_at", { ascending: false }),
      me
        ? supabase.from("notifications").select("*").eq("user_id", me.id).order("created_at", { ascending: false }).limit(50)
        : Promise.resolve({ data: [] as AppNotification[] }),
      supabase.from("driver_availability").select("*").order("start_date", { ascending: false }),
      supabase.from("driver_shifts").select("*").order("started_at", { ascending: false }),
    ]);
    if (s.data) setSettings(s.data as Settings);
    if (p.data) setUsers(p.data as Profile[]);
    if (d.data) setDeliveries(d.data as Delivery[]);
    if (e.data) setEvents(e.data as OrderEvent[]);
    if (n.data) setNotifications(n.data as AppNotification[]);
    if (av.data) setAvailability(av.data as DriverAvailability[]);
    if (sh.data) setShifts(sh.data as DriverShift[]);
    setReady(true);
  }, [supabase, me, teaching]);

  const clearTrainingData = useCallback(async () => {
    const { error } = await supabase.from("deliveries").delete().eq("is_training", true);
    if (error) { notify("Error: " + error.message); return; }
    await reloadAll();
    notify("Training data cleared");
  }, [supabase, notify, reloadAll]);

  // ---- Single-device sessions ----
  // On load, claim the account by stamping THIS session's id on the profile.
  // Any other signed-in device sees the change (realtime profile updates)
  // and signs itself out — one active device per account.
  const sessionId = useRef<string | null>(null);
  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const sid = data.session?.access_token ? data.session.access_token.slice(-24) : null;
      if (!sid || cancelled) return;
      sessionId.current = sid;
      await supabase.from("profiles").update({ active_session_id: sid }).eq("id", me.id);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, me?.id]);

  const checkSession = useCallback(async () => {
    if (!me || !sessionId.current) return;
    const { data } = await supabase.from("profiles").select("active_session_id").eq("id", me.id).maybeSingle();
    const active = (data as { active_session_id?: string | null } | null)?.active_session_id;
    if (active && active !== sessionId.current) {
      await supabase.auth.signOut();
      window.location.href = "/login?reason=session";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, me?.id]);

  useEffect(() => {
    reloadAll();
    const channel = supabase
      .channel("deliveries-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "deliveries" }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_events" }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "settings" }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => { reloadAll(); checkSession(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "driver_availability" }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "driver_shifts" }, reloadAll)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, reloadAll, checkSession]);

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
    async (args: { stage: Stage; order_no: number | null; delivery_id: string; creatorId: string | null; reason?: string | null }) => {
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
      // created_by is always the actual actor — a non-sales creator assigning
      // the order to a rep (OrderModal's Sales Rep picker) sets assigned_sales_rep
      // instead, which is what orderOwner() resolves for own-orders visibility.
      const payload: Partial<Delivery> = { ...d, created_by: me?.id ?? null, is_training: teaching };
      // Teaching mode is a parallel sandbox: practice orders must NOT consume a
      // real order number. order_no is a shared "by default" identity sequence,
      // so we assign training orders their own high number range explicitly —
      // Postgres keeps the identity value we pass without advancing the real
      // sequence, so real orders stay contiguous. (A pre-set order_no, e.g. a
      // split remainder, is respected.)
      if (teaching && payload.order_no == null) {
        const maxTraining = deliveries.reduce((m, x) => Math.max(m, Number(x.order_no ?? 0)), 0);
        payload.order_no = Math.max(maxTraining, TRAINING_ORDER_BASE) + 1;
      }
      const { data, error } = await supabase.from("deliveries").insert(payload).select().single();
      if (error) {
        notify("Error: " + error.message);
        return null;
      }
      const row = data as Delivery;
      setDeliveries((prev) => [row, ...prev]);
      await logEvent(row.id, "created");
      // An order created straight into "pending" (Submit for approval) alerts
      // managers — but never in teaching mode, where it would ping real people
      // about a practice order.
      if (!teaching && row.stage && row.stage !== "draft") {
        await emitStageNotifs({ stage: row.stage, order_no: row.order_no, delivery_id: row.id, creatorId: orderOwner(row) });
      }
      return row;
    },
    [supabase, me, notify, logEvent, emitStageNotifs, teaching, deliveries],
  );

  const updateDelivery = useCallback<DataState["updateDelivery"]>(
    async (id, patch) => {
      const { error } = await supabase.from("deliveries").update(patch).eq("id", id);
      if (error) {
        notify("Error: " + error.message);
        return false;
      }
      setDeliveries((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
      await logEvent(id, "edited");
      return true;
    },
    [supabase, notify, logEvent],
  );

  const deleteDelivery = useCallback<DataState["deleteDelivery"]>(
    async (id) => {
      setDeliveries((prev) => prev.filter((c) => c.id !== id));
      const { error } = await supabase.from("deliveries").delete().eq("id", id);
      if (error) notify("Error: " + error.message);
    },
    [supabase, notify],
  );

  const setStage = useCallback<DataState["setStage"]>(
    async (id, stage, note, extra) => {
      // Hard guard: reject illegal workflow moves (e.g. straight to fulfilling
      // without manager approval). Admins may override to any status.
      const current = deliveries.find((c) => c.id === id);
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
      const { error } = await supabase.from("deliveries").update(patch).eq("id", id);
      if (error) {
        notify(error.message);
        return false;
      }
      setDeliveries((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
      await logEvent(id, stage, note);
      const order = deliveries.find((c) => c.id === id);
      // Never notify real people about a teaching-mode (sandbox) order.
      if (!teaching) {
        await emitStageNotifs({ stage, order_no: order?.order_no ?? null, delivery_id: id, creatorId: order ? orderOwner(order) : null, reason: note });
      }
      return true;
    },
    [supabase, me, notify, logEvent, deliveries, emitStageNotifs, teaching],
  );

  const eventsFor = useCallback(
    (deliveryId: string) => events.filter((e) => e.delivery_id === deliveryId),
    [events],
  );

  const addNote = useCallback<DataState["addNote"]>(
    async (deliveryId, text) => {
      const body = text.trim();
      if (!body) return;
      const { data, error } = await supabase
        .from("order_events")
        .insert({ delivery_id: deliveryId, kind: "note", note: body, created_by: me?.id ?? null })
        .select()
        .single();
      if (error) { notify("Error: " + error.message); return; }
      setEvents((prev) => [data as OrderEvent, ...prev]);
    },
    [supabase, me, notify],
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
      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { notify(body.error || "Could not create user"); return { ok: false }; }
      notify(`User ${input.email} created`);
      reloadAll();
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

  const value: DataState = {
    ready, me: effectiveMe, realRole, viewAs, setViewAs, teaching, setTeaching, clearTrainingData, settings, users, deliveries, events, notifications, toast, notify,
    markNotifRead, markAllNotifsRead, pushNotifs,
    addDelivery, updateDelivery, deleteDelivery, setStage, eventsFor, addNote,
    saveSettings, addUser, updateUserRole, updateUserName, updateUserStore, updateUserPermissions, deleteUser,
    availability, addAvailability, removeAvailability,
    shifts, clockIn, clockOut,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {toast && <div className="toast">{toast}</div>}
    </Ctx.Provider>
  );
}
