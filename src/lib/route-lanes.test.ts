import { describe, it, expect } from "vitest";
import type { Delivery } from "@/lib/types";
import {
  driverOf, laneKeyFor, loadFromKey, loadNoOf, orderLaneKey, nextLoadFor,
  targetPatch, planMerge, groupByLane, type LaneLite,
} from "@/lib/route-lanes";

// A tiny order factory — only the fields the lane logic reads.
const mk = (id: string, assigned_driver: string | null, load_no: number | null = null): Delivery =>
  ({ id, assigned_driver, load_no, route_seq: null } as unknown as Delivery);

// In the sandbox, route buckets are just names in a list.
const bucketSet = (names: string[]) => (n: string) => names.includes(n);

describe("lane key helpers", () => {
  it("keeps load 1 as the bare driver name; load ≥2 gets a suffix", () => {
    expect(laneKeyFor("José", 1)).toBe("José");
    expect(laneKeyFor("José", 2)).toBe("José#L2");
    expect(driverOf("José")).toBe("José");
    expect(driverOf("José#L2")).toBe("José");
    expect(loadFromKey("José#L2")).toBe(2);
    expect(loadFromKey("José")).toBe(1);
  });

  it("doesn't mistake a driver name that contains #L for a load", () => {
    expect(driverOf("A#Lpha")).toBe("A#Lpha"); // not digits after #L
    expect(loadFromKey("A#Lpha")).toBe(1);
  });

  it("resolves an order's lane: bucket name, or driver+load", () => {
    const isB = bucketSet(["Route 1"]);
    expect(orderLaneKey(mk("x", null), isB)).toBeNull();
    expect(orderLaneKey(mk("x", "Route 1"), isB)).toBe("Route 1");
    expect(orderLaneKey(mk("x", "José", 1), isB)).toBe("José");
    expect(orderLaneKey(mk("x", "José", 2), isB)).toBe("José#L2");
  });

  it("computes the next free load for a driver", () => {
    const orders = [mk("a", "José", 1), mk("b", "José", null), mk("c", "María", 1)];
    expect(nextLoadFor(orders, "José")).toBe(2);   // already has a load-1
    expect(nextLoadFor(orders, "María")).toBe(2);
    expect(nextLoadFor(orders, "Empty")).toBe(1);  // no work yet
  });
});

describe("targetPatch", () => {
  it("bucket target clears the load", () => {
    expect(targetPatch({ isBucket: true, driver: "Route 2", load: 1 }))
      .toEqual({ assigned_driver: "Route 2", load_no: null, route_seq: null });
  });
  it("driver load 1 stores null, load ≥2 stores the number", () => {
    expect(targetPatch({ isBucket: false, driver: "José", load: 1 }))
      .toEqual({ assigned_driver: "José", load_no: null, route_seq: null });
    expect(targetPatch({ isBucket: false, driver: "José", load: 2 }))
      .toEqual({ assigned_driver: "José", load_no: 2, route_seq: null });
  });
});

// Full teaching-mode-style flow, run purely on the lane logic (no DB): create
// orders, drop them into route buckets, hand a bucket to a driver as a load,
// then merge two lanes into one.
describe("teaching-mode flow: buckets → loads → merge", () => {
  const lanesFor = (orders: Delivery[], drivers: string[], buckets: string[]): LaneLite[] => {
    const isB = bucketSet(buckets);
    const out: LaneLite[] = [];
    for (const dr of drivers) {
      const loads = new Set<number>([1]);
      for (const d of orders) if (d.assigned_driver === dr) loads.add(loadNoOf(d));
      [...loads].sort((a, b) => a - b).forEach((load) =>
        out.push({ key: laneKeyFor(dr, load), driver: dr, load, isBucket: false }));
    }
    for (const b of buckets) out.push({ key: b, driver: b, load: 1, isBucket: true });
    return out;
  };

  it("assigns a bucket to a driver as their next load, then merges two loads", () => {
    const isB = bucketSet(["Route 1", "Route 2"]);
    // Two route buckets, each with orders (built with no driver).
    const orders: Delivery[] = [
      mk("a", "Route 1"), mk("b", "Route 1"),
      mk("c", "Route 2"), mk("d", "Route 2"), mk("e", "Route 2"),
    ];

    // Hand Route 1 → José: José has no work → load 1.
    const load1 = nextLoadFor(orders, "José");
    expect(load1).toBe(1);
    for (const d of orders) if (d.assigned_driver === "Route 1") { d.assigned_driver = "José"; d.load_no = load1 > 1 ? load1 : null; }

    // Hand Route 2 → José: he now has load-1 work → becomes load 2.
    const load2 = nextLoadFor(orders, "José");
    expect(load2).toBe(2);
    for (const d of orders) if (d.assigned_driver === "Route 2") { d.assigned_driver = "José"; d.load_no = load2; }

    // José now has two loads.
    let byLane = groupByLane(orders, isB);
    expect([...byLane.keys()].sort()).toEqual(["José", "José#L2"]);
    expect(byLane.get("José")!.map((o) => o.id)).toEqual(["a", "b"]);
    expect(byLane.get("José#L2")!.map((o) => o.id)).toEqual(["c", "d", "e"]);

    // Merge the two loads into one route (check both lanes, target = first).
    const lanes = lanesFor(orders, ["José"], []);
    const plan = planMerge(lanes, new Set(["José", "José#L2"]), byLane);
    expect(plan).not.toBeNull();
    expect(plan!.targetKey).toBe("José");
    expect(plan!.patch).toEqual({ assigned_driver: "José", load_no: null, route_seq: null });
    expect(plan!.moveIds).toEqual(["c", "d", "e"]); // load-2 orders move onto load 1

    // Apply the plan the way the page would.
    for (const id of plan!.moveIds) Object.assign(orders.find((o) => o.id === id)!, plan!.patch);
    byLane = groupByLane(orders, isB);
    expect([...byLane.keys()]).toEqual(["José"]);          // one route now
    expect(byLane.get("José")!.map((o) => o.id).sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("merging two buckets retires the emptied one", () => {
    const buckets = ["Route 1", "Route 2"];
    const isB = bucketSet(buckets);
    const orders = [mk("a", "Route 1"), mk("b", "Route 2"), mk("c", "Route 2")];
    const lanes = lanesFor(orders, [], buckets);
    const plan = planMerge(lanes, new Set(["Route 1", "Route 2"]), groupByLane(orders, isB));
    expect(plan!.targetKey).toBe("Route 1");
    expect(plan!.moveIds).toEqual(["b", "c"]);
    expect(plan!.removeBuckets).toEqual(["Route 2"]); // emptied bucket retired
  });

  it("won't merge with fewer than two lanes checked", () => {
    const orders = [mk("a", "José", 1)];
    const lanes = lanesFor(orders, ["José"], []);
    expect(planMerge(lanes, new Set(["José"]), groupByLane(orders, bucketSet([])))).toBeNull();
  });
});
