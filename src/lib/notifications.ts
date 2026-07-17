import type { Profile, Stage } from "@/lib/types";

// ============================================================
// Role-targeted, in-app notifications.
//
// A stage transition fans out to the people who need to act next:
//   → pending    managers          "an order needs approval"
//   → approved   warehouse + sales "approved — fulfill it" / "your order was approved"
//   → rejected   sales             "your order was rejected (reason)"
//   → ready      sales             "your order is ready"
//   → delivered  sales             "your order was delivered"
//
// The same logic drives both the Supabase and local providers, so the
// two stay in lock-step. The actor is never notified about their own action.
// ============================================================

export interface AppNotification {
  id: string;
  user_id: string;          // recipient
  delivery_id: string | null;
  order_no: number | null;
  kind: string;             // pending / approved / rejected / ready / delivered
  message: string;
  read: boolean;
  created_at: string;
}

/** A notification about to be created (id/read/created_at supplied by the store). */
export type NotifSeed = Pick<AppNotification, "user_id" | "delivery_id" | "order_no" | "kind" | "message">;

export function notificationsForStage(args: {
  stage: Stage;
  order_no: number | null;
  delivery_id: string | null;
  creatorId: string | null;
  actorId: string | null;
  users: Profile[];
  reason?: string | null;
}): NotifSeed[] {
  const { stage, order_no, delivery_id, creatorId, actorId, users, reason } = args;
  const seeds: NotifSeed[] = [];
  const label = order_no != null ? `#${order_no}` : "";

  const push = (userId: string | null | undefined, kind: string, message: string) => {
    if (!userId || userId === actorId) return;          // never notify the actor
    if (seeds.some((s) => s.user_id === userId && s.kind === kind)) return; // de-dupe
    seeds.push({ user_id: userId, delivery_id, order_no, kind, message });
  };

  const withRole = (role: Profile["role"]) => users.filter((u) => u.role === role);

  switch (stage) {
    case "pending":
      for (const m of withRole("manager")) push(m.id, "pending", `Order ${label} is awaiting your approval`);
      break;
    case "approved":
      for (const w of withRole("warehouse")) push(w.id, "approved", `Order ${label} was approved — ready to fulfill`);
      push(creatorId, "approved", `Your order ${label} was approved`);
      break;
    case "rejected":
      push(creatorId, "rejected", `Your order ${label} was rejected${reason ? `: ${reason}` : ""}`);
      break;
    case "ready":
      push(creatorId, "ready", `Order ${label} is ready for delivery`);
      break;
    case "picked_up":
      push(creatorId, "picked_up", `Order ${label} was picked up — out for delivery`);
      break;
    case "delivered":
      push(creatorId, "delivered", `Order ${label} was delivered`);
      break;
    default:
      break;
  }
  return seeds;
}
