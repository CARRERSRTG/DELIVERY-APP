import type { Delivery, OrderEvent, Profile, Stage } from "@/lib/types";
import { isOverdue } from "@/lib/utils";

// ============================================================
// Read-only analytics over the deliveries + event log. Pure functions,
// mode-agnostic (works with both data providers), no side effects — so the
// Dashboard renders identically in local demo and Supabase modes.
// ============================================================

export interface Kpis {
  total: number;
  pending: number;      // awaiting approval
  approved: number;     // approved, not yet fulfilling
  inWarehouse: number;  // fulfilling + ready
  outForDelivery: number; // picked_up
  delivered: number;
  overdue: number;
  canceled: number;
  totalPallets: number;
  totalMiles: number;
  totalFees: number;        // delivery fees charged across these orders
  onTimePct: number | null; // delivered on/before delivery_date ÷ delivered with a date
}

const activeStages: Stage[] = ["draft", "pending", "approved", "fulfilling", "ready", "picked_up"];

export function computeKpis(deliveries: Delivery[]): Kpis {
  let pending = 0, approved = 0, inWarehouse = 0, outForDelivery = 0, delivered = 0, canceled = 0;
  let overdue = 0, totalPallets = 0, totalMiles = 0, totalFees = 0;
  let onTimeEligible = 0, onTime = 0;

  for (const d of deliveries) {
    switch (d.stage) {
      case "pending": pending++; break;
      case "approved": approved++; break;
      case "fulfilling": case "ready": inWarehouse++; break;
      case "picked_up": outForDelivery++; break;
      case "delivered": delivered++; break;
      case "canceled": canceled++; break;
    }
    if (isOverdue(d)) overdue++;
    totalPallets += Number(d.actual_pallets ?? d.est_pallets ?? 0);
    totalMiles += Number(d.route_miles ?? 0);
    if (d.stage !== "canceled") totalFees += Number(d.delivery_fee ?? 0);
    if (d.stage === "delivered" && d.delivery_date) {
      onTimeEligible++;
      // Delivered on time if the last "delivered" event (or updated_at) is on/before the delivery date.
      const deliveredWhen = new Date(d.updated_at).getTime();
      const due = new Date(d.delivery_date + "T23:59:59").getTime();
      if (deliveredWhen <= due) onTime++;
    }
  }

  return {
    total: deliveries.length,
    pending, approved, inWarehouse, outForDelivery, delivered, canceled, overdue,
    totalPallets: Math.round(totalPallets),
    totalMiles: Math.round(totalMiles * 10) / 10,
    totalFees: Math.round(totalFees * 100) / 100,
    onTimePct: onTimeEligible ? Math.round((onTime / onTimeEligible) * 100) : null,
  };
}

export interface StageCount { stage: Stage; count: number; }
export function countByStage(deliveries: Delivery[], stages: Stage[]): StageCount[] {
  return stages.map((stage) => ({ stage, count: deliveries.filter((d) => d.stage === stage).length }));
}

export interface DriverStat {
  driver: string;
  total: number;
  delivered: number;
  active: number;
  pallets: number;
  miles: number;
}

/** Per-driver workload + throughput, sorted by total orders desc. */
export function driverStats(deliveries: Delivery[]): DriverStat[] {
  const map = new Map<string, DriverStat>();
  for (const d of deliveries) {
    if (!d.assigned_driver) continue;
    const s = map.get(d.assigned_driver) ?? { driver: d.assigned_driver, total: 0, delivered: 0, active: 0, pallets: 0, miles: 0 };
    s.total++;
    if (d.stage === "delivered") s.delivered++;
    if (activeStages.includes(d.stage)) s.active++;
    s.pallets += Number(d.actual_pallets ?? d.est_pallets ?? 0);
    s.miles += Number(d.route_miles ?? 0);
    map.set(d.assigned_driver, s);
  }
  return [...map.values()]
    .map((s) => ({ ...s, pallets: Math.round(s.pallets), miles: Math.round(s.miles * 10) / 10 }))
    .sort((a, b) => b.total - a.total);
}

export interface GroupStat { key: string; total: number; delivered: number; pallets: number; }

/** Volume grouped by an arbitrary string field (store / account). */
export function groupVolume(deliveries: Delivery[], field: "store" | "account"): GroupStat[] {
  const map = new Map<string, GroupStat>();
  for (const d of deliveries) {
    const key = (d[field] || "").trim() || "—";
    const s = map.get(key) ?? { key, total: 0, delivered: 0, pallets: 0 };
    s.total++;
    if (d.stage === "delivered") s.delivered++;
    s.pallets += Number(d.actual_pallets ?? d.est_pallets ?? 0);
    map.set(key, s);
  }
  return [...map.values()]
    .map((s) => ({ ...s, pallets: Math.round(s.pallets) }))
    .sort((a, b) => b.total - a.total);
}

/** Average approval turnaround (pending → approved) in ms, from the event log. */
export function approvalTurnaroundMs(deliveries: Delivery[], events: OrderEvent[]): { avgMs: number | null; count: number } {
  let sum = 0, count = 0;
  const byDelivery = new Map<string, OrderEvent[]>();
  for (const e of events) {
    (byDelivery.get(e.delivery_id) ?? byDelivery.set(e.delivery_id, []).get(e.delivery_id)!).push(e);
  }
  for (const d of deliveries) {
    if (!d.approved_at) continue;
    const evs = byDelivery.get(d.id) ?? [];
    // Earliest moment the order entered "pending".
    const pendingEv = evs.filter((e) => e.kind === "pending").sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))[0];
    const start = pendingEv ? new Date(pendingEv.created_at).getTime() : new Date(d.created_at).getTime();
    const end = new Date(d.approved_at).getTime();
    if (end > start) { sum += end - start; count++; }
  }
  return { avgMs: count ? Math.round(sum / count) : null, count };
}

/** Orders whose delivery date has passed but that aren't delivered/canceled. */
export function overdueOrders(deliveries: Delivery[]): Delivery[] {
  return deliveries
    .filter(isOverdue)
    .sort((a, b) => (a.delivery_date || "").localeCompare(b.delivery_date || ""));
}

/** Filter deliveries to those whose delivery_date (fallback input_date) falls in [from, to] inclusive. */
export function inDateRange(deliveries: Delivery[], from: string, to: string): Delivery[] {
  return deliveries.filter((d) => {
    const day = d.delivery_date || d.input_date || d.created_at.slice(0, 10);
    return day >= from && day <= to;
  });
}
