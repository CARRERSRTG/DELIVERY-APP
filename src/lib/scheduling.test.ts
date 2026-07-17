import { describe, it, expect } from "vitest";
import { checkSchedule } from "@/lib/scheduling";
import { mkDelivery } from "@/lib/__fixtures";

const DATE = "2026-07-20";
const codes = (ws: { code: string }[]) => ws.map((w) => w.code).sort();

describe("checkSchedule", () => {
  it("passes a clean morning slot with nothing else booked", () => {
    const c = { store: "McAllen", delivery_date: DATE, delivery_windows: "0900-1100" };
    expect(checkSchedule(c, [])).toEqual([]);
  });

  it("returns nothing when the date or window is missing (nothing to check yet)", () => {
    expect(checkSchedule({ store: "McAllen", delivery_date: null, delivery_windows: "0900-1100" }, [])).toEqual([]);
    expect(checkSchedule({ store: "McAllen", delivery_date: DATE, delivery_windows: null }, [])).toEqual([]);
  });

  it("flags a window outside 0830-1730 working hours", () => {
    const early = checkSchedule({ store: "McAllen", delivery_date: DATE, delivery_windows: "0700-0800" }, []);
    expect(codes(early)).toContain("outside_hours");
    const late = checkSchedule({ store: "McAllen", delivery_date: DATE, delivery_windows: "1700-1800" }, []);
    expect(codes(late)).toContain("outside_hours");
  });

  it("accepts the exact boundaries 0830-1730", () => {
    expect(checkSchedule({ store: "McAllen", delivery_date: DATE, delivery_windows: "0830-1730" }, [])).toEqual([]);
  });

  it("flags an identical window already booked", () => {
    const existing = [mkDelivery({ order_no: 1001, stage: "approved", delivery_date: DATE, delivery_windows: "0900-1100" })];
    const w = checkSchedule({ store: "McAllen", delivery_date: DATE, delivery_windows: "0900-1100" }, existing);
    expect(codes(w)).toContain("same_window");
  });

  it("flags another delivery starting within 3 hours", () => {
    const existing = [mkDelivery({ order_no: 1001, stage: "approved", delivery_date: DATE, delivery_windows: "0900-1000" })];
    // 1030 starts 90 min after 0900 → inside the 3h cluster
    const w = checkSchedule({ store: "McAllen", delivery_date: DATE, delivery_windows: "1030-1130" }, existing);
    expect(codes(w)).toContain("cluster");
  });

  it("does NOT flag a cluster when the gap is 3 hours or more", () => {
    const existing = [mkDelivery({ order_no: 1001, stage: "approved", delivery_date: DATE, delivery_windows: "0900-1000" })];
    // 1200 is exactly 3h after 0900 → outside the cluster window
    const w = checkSchedule({ store: "McAllen", delivery_date: DATE, delivery_windows: "1200-1300" }, existing);
    expect(codes(w)).not.toContain("cluster");
  });

  it("alerts when more than one delivery lands before 12:00", () => {
    const existing = [mkDelivery({ order_no: 1001, stage: "approved", delivery_date: DATE, delivery_windows: "0830-0930" })];
    // Far enough apart to avoid the cluster rule, still both AM
    const w = checkSchedule({ store: "McAllen", delivery_date: DATE, delivery_windows: "1145-1200" }, existing);
    expect(codes(w)).toContain("am_overload");
  });

  it("alerts when more than one delivery lands after 12:00", () => {
    const existing = [mkDelivery({ order_no: 1001, stage: "approved", delivery_date: DATE, delivery_windows: "1200-1300" })];
    const w = checkSchedule({ store: "McAllen", delivery_date: DATE, delivery_windows: "1600-1700" }, existing);
    expect(codes(w)).toContain("pm_overload");
    expect(codes(w)).not.toContain("am_overload");
  });

  it("counts AM and PM independently — one each is fine", () => {
    const existing = [mkDelivery({ order_no: 1001, stage: "approved", delivery_date: DATE, delivery_windows: "0900-1000" })];
    const w = checkSchedule({ store: "McAllen", delivery_date: DATE, delivery_windows: "1500-1600" }, existing);
    expect(w).toEqual([]);
  });

  it("ignores canceled and rejected orders", () => {
    const existing = [
      mkDelivery({ order_no: 1001, stage: "canceled", delivery_date: DATE, delivery_windows: "0900-1100" }),
      mkDelivery({ order_no: 1002, stage: "rejected", delivery_date: DATE, delivery_windows: "0900-1100" }),
    ];
    expect(checkSchedule({ store: "McAllen", delivery_date: DATE, delivery_windows: "0900-1100" }, existing)).toEqual([]);
  });

  it("scopes capacity per store — another store's orders don't conflict", () => {
    const existing = [mkDelivery({ order_no: 1001, stage: "approved", store: "Pharr", delivery_date: DATE, delivery_windows: "0900-1100" })];
    expect(checkSchedule({ store: "McAllen", delivery_date: DATE, delivery_windows: "0900-1100" }, existing)).toEqual([]);
  });

  it("ignores orders on a different date", () => {
    const existing = [mkDelivery({ order_no: 1001, stage: "approved", delivery_date: "2026-07-21", delivery_windows: "0900-1100" })];
    expect(checkSchedule({ store: "McAllen", delivery_date: DATE, delivery_windows: "0900-1100" }, existing)).toEqual([]);
  });

  it("excludes the order being edited from its own conflict check", () => {
    const self = mkDelivery({ id: "self", order_no: 1001, stage: "approved", delivery_date: DATE, delivery_windows: "0900-1100" });
    const w = checkSchedule({ id: "self", store: "McAllen", delivery_date: DATE, delivery_windows: "0900-1100" }, [self]);
    expect(w).toEqual([]);
  });
});
