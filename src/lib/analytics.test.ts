import { describe, it, expect } from "vitest";
import { computeKpis, driverStats, groupVolume, overdueOrders, inDateRange, approvalTurnaroundMs } from "@/lib/analytics";
import { mkDelivery } from "@/lib/__fixtures";
import type { OrderEvent } from "@/lib/types";

describe("computeKpis", () => {
  it("counts each stage into the right bucket", () => {
    const k = computeKpis([
      mkDelivery({ stage: "pending" }),
      mkDelivery({ stage: "approved" }),
      mkDelivery({ stage: "fulfilling" }),
      mkDelivery({ stage: "ready" }),
      mkDelivery({ stage: "picked_up" }),
      mkDelivery({ stage: "delivered" }),
      mkDelivery({ stage: "canceled" }),
    ]);
    expect(k.total).toBe(7);
    expect(k.pending).toBe(1);
    expect(k.approved).toBe(1);
    expect(k.inWarehouse).toBe(2); // fulfilling + ready
    expect(k.outForDelivery).toBe(1);
    expect(k.delivered).toBe(1);
    expect(k.canceled).toBe(1);
  });

  it("prefers actual pallets over estimated", () => {
    const k = computeKpis([mkDelivery({ est_pallets: 5, actual_pallets: 8 })]);
    expect(k.totalPallets).toBe(8);
  });

  it("sums delivery fees but excludes canceled orders", () => {
    const k = computeKpis([
      mkDelivery({ delivery_fee: 75 }),
      mkDelivery({ delivery_fee: 25 }),
      mkDelivery({ delivery_fee: 999, stage: "canceled" }),
    ]);
    expect(k.totalFees).toBe(100);
  });

  it("reports null on-time% when nothing delivered has a date", () => {
    expect(computeKpis([mkDelivery({ stage: "pending" })]).onTimePct).toBeNull();
  });

  it("counts a delivery completed before its date as on time", () => {
    const k = computeKpis([
      mkDelivery({ stage: "delivered", delivery_date: "2030-01-01", updated_at: "2029-12-31T10:00:00Z" }),
    ]);
    expect(k.onTimePct).toBe(100);
  });

  it("counts a delivery completed after its date as late", () => {
    const k = computeKpis([
      mkDelivery({ stage: "delivered", delivery_date: "2020-01-01", updated_at: "2020-01-05T10:00:00Z" }),
    ]);
    expect(k.onTimePct).toBe(0);
  });
});

describe("driverStats", () => {
  it("aggregates totals per driver, ignoring unassigned", () => {
    const stats = driverStats([
      mkDelivery({ assigned_driver: "Carlos", stage: "delivered", est_pallets: 2, route_miles: 10 }),
      mkDelivery({ assigned_driver: "Carlos", stage: "ready", est_pallets: 3, route_miles: 5 }),
      mkDelivery({ assigned_driver: null, stage: "ready" }),
    ]);
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ driver: "Carlos", total: 2, delivered: 1, active: 1, pallets: 5, miles: 15 });
  });
});

describe("groupVolume", () => {
  it("groups by store and sorts by volume desc", () => {
    const g = groupVolume([
      mkDelivery({ store: "Pharr" }),
      mkDelivery({ store: "McAllen" }),
      mkDelivery({ store: "McAllen" }),
    ], "store");
    expect(g[0]).toMatchObject({ key: "McAllen", total: 2 });
    expect(g[1]).toMatchObject({ key: "Pharr", total: 1 });
  });

  it("buckets blanks under a dash", () => {
    expect(groupVolume([mkDelivery({ account: null })], "account")[0].key).toBe("—");
  });
});

describe("overdueOrders", () => {
  it("includes past-due active orders and excludes delivered/canceled", () => {
    const rows = [
      mkDelivery({ order_no: 1, stage: "ready", delivery_date: "2020-01-01" }),
      mkDelivery({ order_no: 2, stage: "delivered", delivery_date: "2020-01-01" }),
      mkDelivery({ order_no: 3, stage: "canceled", delivery_date: "2020-01-01" }),
      mkDelivery({ order_no: 4, stage: "ready", delivery_date: "2099-01-01" }),
    ];
    expect(overdueOrders(rows).map((d) => d.order_no)).toEqual([1]);
  });
});

describe("inDateRange", () => {
  it("includes the range boundaries", () => {
    const rows = [
      mkDelivery({ order_no: 1, delivery_date: "2026-07-01" }),
      mkDelivery({ order_no: 2, delivery_date: "2026-07-15" }),
      mkDelivery({ order_no: 3, delivery_date: "2026-07-31" }),
    ];
    expect(inDateRange(rows, "2026-07-01", "2026-07-15").map((d) => d.order_no)).toEqual([1, 2]);
  });
});

describe("approvalTurnaroundMs", () => {
  it("measures pending → approved from the event log", () => {
    const d = mkDelivery({ id: "x", approved_at: "2026-07-15T11:00:00Z" });
    const events: OrderEvent[] = [
      { id: "e1", delivery_id: "x", kind: "pending", note: null, created_by: null, created_at: "2026-07-15T09:00:00Z" },
    ];
    const { avgMs, count } = approvalTurnaroundMs([d], events);
    expect(count).toBe(1);
    expect(avgMs).toBe(2 * 60 * 60 * 1000); // 2 hours
  });

  it("ignores orders that were never approved", () => {
    expect(approvalTurnaroundMs([mkDelivery({ approved_at: null })], []).count).toBe(0);
  });
});
