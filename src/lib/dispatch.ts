import type { Delivery, Stage } from "@/lib/types";

// ============================================================
// Dispatch helpers: driver auto-assignment (#6), delivery-window conflict
// detection (#5), and simple route ordering (#2). Pure functions, shared by
// the order modal and the driver page, mode-agnostic.
// ============================================================

const ACTIVE: Stage[] = ["approved", "fulfilling", "ready", "picked_up"];

/** Least-loaded driver by count of active (not-yet-delivered) assignments. */
export function suggestDriver(driverNames: string[], deliveries: Delivery[]): string | null {
  if (!driverNames.length) return null;
  const load = new Map<string, number>();
  for (const name of driverNames) load.set(name, 0);
  for (const d of deliveries) {
    if (d.assigned_driver && ACTIVE.includes(d.stage) && load.has(d.assigned_driver)) {
      load.set(d.assigned_driver, load.get(d.assigned_driver)! + 1);
    }
  }
  return [...load.entries()].sort((a, b) => a[1] - b[1])[0][0];
}

/** Parse a "HHMM-HHMM" window into [startMin, endMin], or null if unparseable. */
export function parseWindow(win: string | null | undefined): [number, number] | null {
  if (!win) return null;
  const m = win.match(/(\d{3,4})\s*[-–]\s*(\d{3,4})/);
  if (!m) return null;
  const toMin = (s: string) => {
    const p = s.padStart(4, "0");
    return parseInt(p.slice(0, 2), 10) * 60 + parseInt(p.slice(2), 10);
  };
  const a = toMin(m[1]), b = toMin(m[2]);
  return a <= b ? [a, b] : [b, a];
}

function overlaps(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[1] && b[0] < a[1];
}

interface WindowCheck {
  id?: string;
  assigned_driver: string | null | undefined;
  delivery_date: string | null | undefined;
  delivery_windows: string | null | undefined;
}

/** Other active orders that share this order's driver + date and overlap its window. */
export function windowConflicts(order: WindowCheck, deliveries: Delivery[]): Delivery[] {
  if (!order.assigned_driver || !order.delivery_date) return [];
  const mine = parseWindow(order.delivery_windows);
  if (!mine) return [];
  return deliveries.filter((d) => {
    if (d.id === order.id) return false;
    if (d.assigned_driver !== order.assigned_driver) return false;
    if (d.delivery_date !== order.delivery_date) return false;
    if (d.stage === "delivered" || d.stage === "canceled") return false;
    const w = parseWindow(d.delivery_windows);
    return w ? overlaps(mine, w) : false;
  });
}

/** Order a driver's stops for display. A Logistics Manager's optimized
 * sequence (route_seq) wins when set; anything not yet sequenced falls back
 * to delivery window start (then miles) — a simple, dependency-free guess. */
export function routeOrder(deliveries: Delivery[]): Delivery[] {
  return [...deliveries].sort((a, b) => {
    if (a.route_seq != null && b.route_seq != null) return a.route_seq - b.route_seq;
    if (a.route_seq != null) return -1;
    if (b.route_seq != null) return 1;
    const wa = parseWindow(a.delivery_windows);
    const wb = parseWindow(b.delivery_windows);
    const sa = wa ? wa[0] : Number.MAX_SAFE_INTEGER;
    const sb = wb ? wb[0] : Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    return (a.route_miles ?? Number.MAX_SAFE_INTEGER) - (b.route_miles ?? Number.MAX_SAFE_INTEGER);
  });
}
