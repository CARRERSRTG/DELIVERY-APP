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
import type { Delivery, OrderEvent, Profile, Settings, Stage, UserRole } from "@/lib/types";
import { type AppNotification, notificationsForStage } from "@/lib/notifications";
import { canTransition } from "@/lib/constants";

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
  order_types: ["Delivery", "Pickup", "Intra-Tienda", "Transfer", "Will Call"],
  pickup_min_per_pallet: 4,
  delivery_min_per_pallet: 5,
  rc_calls_enabled: false,
  rc_auto_sms_enabled: false,
};

export interface DataState {
  ready: boolean;
  me: Profile | null;
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
  addUser: (input: { email: string; full_name: string; role: UserRole }) => Promise<boolean>;
  updateUserRole: (userId: string, role: Profile["role"]) => Promise<void>;
  updateUserName: (userId: string, name: string) => Promise<void>;
  /** Assign the store a warehouse worker / driver is scoped to (null = none). */
  updateUserStore: (userId: string, store: string | null) => Promise<void>;
  /** Grant a specific person extra capabilities on top of their role. */
  updateUserPermissions: (userId: string, permissions: string[]) => Promise<void>;
  deleteUser: (userId: string) => Promise<boolean>;
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
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [users, setUsers] = useState<Profile[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [events, setEvents] = useState<OrderEvent[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  }, []);

  const reloadAll = useCallback(async () => {
    const [s, p, d, e, n] = await Promise.all([
      supabase.from("settings").select("*").eq("id", 1).maybeSingle(),
      supabase.from("profiles").select("id, full_name, role, store, avatar_url").order("full_name"),
      supabase.from("deliveries").select("*").order("order_no", { ascending: false }),
      supabase.from("order_events").select("*").order("created_at", { ascending: false }),
      me
        ? supabase.from("notifications").select("*").eq("user_id", me.id).order("created_at", { ascending: false }).limit(50)
        : Promise.resolve({ data: [] as AppNotification[] }),
    ]);
    if (s.data) setSettings(s.data as Settings);
    if (p.data) setUsers(p.data as Profile[]);
    if (d.data) setDeliveries(d.data as Delivery[]);
    if (e.data) setEvents(e.data as OrderEvent[]);
    if (n.data) setNotifications(n.data as AppNotification[]);
    setReady(true);
  }, [supabase, me]);

  useEffect(() => {
    reloadAll();
    const channel = supabase
      .channel("deliveries-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "deliveries" }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_events" }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "settings" }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, reloadAll)
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
    async (args: { stage: Stage; order_no: number | null; delivery_id: string; creatorId: string | null; reason?: string | null }) => {
      const seeds = notificationsForStage({ ...args, actorId: me?.id ?? null, users });
      if (!seeds.length) return;
      const { error } = await supabase.from("notifications").insert(seeds);
      if (error) console.error("notification insert failed:", error.message);
    },
    [supabase, me, users],
  );

  // ---------------- Delivery CRUD ----------------
  const addDelivery = useCallback<DataState["addDelivery"]>(
    async (d) => {
      const payload = { ...d, created_by: me?.id ?? null };
      const { data, error } = await supabase.from("deliveries").insert(payload).select().single();
      if (error) {
        notify("Error: " + error.message);
        return null;
      }
      const row = data as Delivery;
      setDeliveries((prev) => [row, ...prev]);
      await logEvent(row.id, "created");
      // An order created straight into "pending" (Submit for approval) alerts managers.
      if (row.stage && row.stage !== "draft") {
        await emitStageNotifs({ stage: row.stage, order_no: row.order_no, delivery_id: row.id, creatorId: row.created_by });
      }
      return row;
    },
    [supabase, me, notify, logEvent, emitStageNotifs],
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
      await emitStageNotifs({ stage, order_no: order?.order_no ?? null, delivery_id: id, creatorId: order?.created_by ?? null, reason: note });
      return true;
    },
    [supabase, me, notify, logEvent, deliveries, emitStageNotifs],
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
      if (!res.ok) { notify(body.error || "Invite failed"); return false; }
      notify(`Invite sent to ${input.email}`);
      reloadAll();
      return true;
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

  const value: DataState = {
    ready, me: me ?? null, settings, users, deliveries, events, notifications, toast, notify,
    markNotifRead, markAllNotifsRead,
    addDelivery, updateDelivery, deleteDelivery, setStage, eventsFor, addNote,
    saveSettings, addUser, updateUserRole, updateUserName, updateUserStore, updateUserPermissions, deleteUser,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {toast && <div className="toast">{toast}</div>}
    </Ctx.Provider>
  );
}
