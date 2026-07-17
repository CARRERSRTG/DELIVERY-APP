import { describe, it, expect } from "vitest";
import { parseWindow, suggestDriver, windowConflicts, routeOrder } from "@/lib/dispatch";
import { mkDelivery } from "@/lib/__fixtures";

describe("parseWindow", () => {
  it("parses HHMM-HHMM into minutes", () => {
    expect(parseWindow("0800-1200")).toEqual([480, 720]);
  });
  it("pads 3-digit times", () => {
    expect(parseWindow("830-930")).toEqual([510, 570]);
  });
  it("normalizes a reversed range", () => {
    expect(parseWindow("1200-0800")).toEqual([480, 720]);
  });
  it("returns null for junk or empty input", () => {
    expect(parseWindow("anytime")).toBeNull();
    expect(parseWindow(null)).toBeNull();
  });
});

describe("suggestDriver", () => {
  it("returns null when no drivers are configured", () => {
    expect(suggestDriver([], [])).toBeNull();
  });

  it("picks the driver with the fewest active assignments", () => {
    const deliveries = [
      mkDelivery({ assigned_driver: "Carlos", stage: "approved" }),
      mkDelivery({ assigned_driver: "Carlos", stage: "ready" }),
      mkDelivery({ assigned_driver: "Miguel", stage: "fulfilling" }),
    ];
    expect(suggestDriver(["Carlos", "Miguel"], deliveries)).toBe("Miguel");
  });

  it("does not count delivered/canceled orders as load", () => {
    const deliveries = [
      mkDelivery({ assigned_driver: "Carlos", stage: "delivered" }),
      mkDelivery({ assigned_driver: "Carlos", stage: "canceled" }),
      mkDelivery({ assigned_driver: "Miguel", stage: "approved" }),
    ];
    expect(suggestDriver(["Carlos", "Miguel"], deliveries)).toBe("Carlos");
  });
});

describe("windowConflicts", () => {
  const base = { id: "self", assigned_driver: "Carlos", delivery_date: "2026-07-20", delivery_windows: "0900-1100" };

  it("finds an overlapping window for the same driver and day", () => {
    const others = [mkDelivery({ order_no: 1002, assigned_driver: "Carlos", delivery_date: "2026-07-20", delivery_windows: "1000-1200", stage: "approved" })];
    expect(windowConflicts(base, others)).toHaveLength(1);
  });

  it("ignores a different driver", () => {
    const others = [mkDelivery({ assigned_driver: "Miguel", delivery_date: "2026-07-20", delivery_windows: "1000-1200", stage: "approved" })];
    expect(windowConflicts(base, others)).toHaveLength(0);
  });

  it("ignores non-overlapping windows", () => {
    const others = [mkDelivery({ assigned_driver: "Carlos", delivery_date: "2026-07-20", delivery_windows: "1100-1300", stage: "approved" })];
    expect(windowConflicts(base, others)).toHaveLength(0);
  });

  it("ignores delivered orders", () => {
    const others = [mkDelivery({ assigned_driver: "Carlos", delivery_date: "2026-07-20", delivery_windows: "1000-1200", stage: "delivered" })];
    expect(windowConflicts(base, others)).toHaveLength(0);
  });

  it("returns nothing when there is no driver assigned", () => {
    expect(windowConflicts({ ...base, assigned_driver: null }, [])).toEqual([]);
  });
});

describe("routeOrder", () => {
  it("sequences stops by window start, then by shortest drive", () => {
    const a = mkDelivery({ order_no: 1, delivery_windows: "1300-1500" });
    const b = mkDelivery({ order_no: 2, delivery_windows: "0800-1000" });
    const c = mkDelivery({ order_no: 3, delivery_windows: "0800-1000", route_miles: 2 });
    // b has no miles → sorts after c which has 2 miles, both at 0800
    expect(routeOrder([a, b, c]).map((d) => d.order_no)).toEqual([3, 2, 1]);
  });

  it("puts windowless stops last", () => {
    const a = mkDelivery({ order_no: 1, delivery_windows: null });
    const b = mkDelivery({ order_no: 2, delivery_windows: "0900-1000" });
    expect(routeOrder([a, b]).map((d) => d.order_no)).toEqual([2, 1]);
  });
});
