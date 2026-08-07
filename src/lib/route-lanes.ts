import type { Delivery } from "@/lib/types";

// ============================================================
// Route "lanes" — the pure logic behind the Routes Manager's multi-load and
// merge features. A lane is one truckload of a driver's day (or a route
// bucket). Its KEY groups the orders: the plain driver name for load 1
// (unchanged), or "Driver#L2" for the 2nd load, etc. Kept here (framework-free)
// so it's unit-testable without the page. See app/(app)/routes/page.tsx.
// ============================================================

export const LANE_SEP = "#L";

/** Strip a lane key back to the driver name ("José#L2" → "José"). */
export function driverOf(key: string): string {
  const i = key.lastIndexOf(LANE_SEP);
  return i >= 0 && /^\d+$/.test(key.slice(i + LANE_SEP.length)) ? key.slice(0, i) : key;
}

/** Build a lane key from a driver + load number (load 1 = the bare name). */
export function laneKeyFor(driver: string, load: number): string {
  return load > 1 ? `${driver}${LANE_SEP}${load}` : driver;
}

/** The load number encoded in a lane key (1 when there's none). */
export function loadFromKey(key: string): number {
  const i = key.lastIndexOf(LANE_SEP);
  const n = i >= 0 ? parseInt(key.slice(i + LANE_SEP.length), 10) : NaN;
  return Number.isFinite(n) ? n : 1;
}

type OrderLite = Pick<Delivery, "assigned_driver" | "load_no">;

/** An order's effective load number (null/1 → 1). */
export function loadNoOf(d: Pick<Delivery, "load_no">): number {
  return d.load_no && d.load_no > 1 ? d.load_no : 1;
}

/** Which lane an order belongs to — one lane per driver / temp driver. The load
 * number is NOT part of the key: a driver is a single route CARD, and loads are
 * truckload sections inside it (see groupIntoLoads). The `isBucket` arg is
 * accepted for signature stability but no longer needed. */
export function orderLaneKey(d: OrderLite, _isBucket?: (name: string) => boolean): string | null {
  return d.assigned_driver || null;
}

/** Split a lane's stops into truckloads by their load number — each distinct
 * load is one truckload/pickup, in ascending order. Used when the dispatcher
 * has manually assigned loads (otherwise the route splits by truck capacity). */
export function groupIntoLoads<T extends { load_no?: number | null }>(stops: T[]): T[][] {
  const byLoad = new Map<number, T[]>();
  for (const d of stops) {
    const L = d.load_no && d.load_no > 1 ? d.load_no : 1;
    (byLoad.get(L) ?? byLoad.set(L, []).get(L)!).push(d);
  }
  return [...byLoad.keys()].sort((a, b) => a - b).map((L) => byLoad.get(L)!);
}

/** True when a lane's stops carry manual load assignments (any load ≥ 2). */
export function hasManualLoads(stops: { load_no?: number | null }[]): boolean {
  return stops.some((d) => (d.load_no ?? 1) > 1);
}

/** Next free load number for a driver: 1 if they have no work yet, else one
 * past their highest current load. */
export function nextLoadFor(orders: OrderLite[], driver: string): number {
  let max = 0;
  for (const d of orders) if (d.assigned_driver === driver) max = Math.max(max, loadNoOf(d));
  return max === 0 ? 1 : max + 1;
}

export interface LaneTarget { isBucket: boolean; driver: string; load: number; }

/** The order patch that puts a delivery onto a target lane (resets sequence). */
export function targetPatch(target: LaneTarget): Partial<Delivery> {
  return target.isBucket
    ? { assigned_driver: target.driver, load_no: null, route_seq: null }
    : { assigned_driver: target.driver, load_no: target.load > 1 ? target.load : null, route_seq: null };
}

export interface LaneLite { key: string; isBucket: boolean; driver: string; load: number; }
export interface MergePlan { targetKey: string; patch: Partial<Delivery>; moveIds: string[]; removeBuckets: string[]; }

/** Plan a merge of the checked lanes into ONE route: the first checked lane (in
 * the given display order) is the target; every other checked lane's orders
 * move onto it, and emptied buckets are retired. Pure — the page applies it. */
export function planMerge(
  lanes: LaneLite[],
  selectedKeys: Set<string>,
  ordersByLane: Map<string, { id: string }[]>,
): MergePlan | null {
  const keys = lanes.filter((l) => selectedKeys.has(l.key)).map((l) => l.key);
  if (keys.length < 2) return null;
  const targetKey = keys[0];
  const target = lanes.find((l) => l.key === targetKey);
  if (!target) return null;
  const patch = targetPatch(target);
  const moveIds: string[] = [];
  const removeBuckets: string[] = [];
  for (const src of keys.slice(1)) {
    for (const d of ordersByLane.get(src) ?? []) moveIds.push(d.id);
    const lane = lanes.find((l) => l.key === src);
    if (lane?.isBucket) removeBuckets.push(src);
  }
  return { targetKey, patch, moveIds, removeBuckets };
}

/** Group orders by their lane key (mirrors the page's byDriver map). */
export function groupByLane(orders: Delivery[], isBucket: (name: string) => boolean): Map<string, Delivery[]> {
  const map = new Map<string, Delivery[]>();
  for (const d of orders) {
    const key = orderLaneKey(d, isBucket);
    if (!key) continue;
    (map.get(key) ?? map.set(key, []).get(key)!).push(d);
  }
  return map;
}
