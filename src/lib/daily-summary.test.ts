import { describe, it, expect } from "vitest";
import { buildDailySummary, summaryLines } from "./daily-summary";
import { blankDelivery } from "./blank-delivery";
import type { Delivery } from "./types";

const DAY = "2026-08-17";
const mk = (over: Partial<Delivery>): Delivery => ({ ...blankDelivery(), ...over });
const label = (d: Delivery) => d.order_code ?? String(d.order_no);
const build = (ds: Delivery[]) => buildDailySummary(ds, [], DAY, label);

describe("buildDailySummary", () => {
  it("counts a delivery on the day it actually happened", () => {
    // Scheduled yesterday, handed over today: it belongs to today's numbers,
    // and it is also the reason "late" is reported separately.
    const slipped = mk({ stage: "delivered", delivery_date: "2026-08-16", pod_delivered_at: `${DAY}T19:00:00Z` });
    const s = build([slipped]);
    expect(s.delivered).toBe(1);
    expect(s.lateDelivered).toBe(1);
  });

  it("does not count one delivered on a different day", () => {
    const s = build([mk({ stage: "delivered", delivery_date: DAY, pod_delivered_at: "2026-08-16T19:00:00Z" })]);
    expect(s.delivered).toBe(0);
  });

  it("counts what was scheduled today and never went out", () => {
    const s = build([
      mk({ id: "a", stage: "ready", delivery_date: DAY }),
      mk({ id: "b", stage: "approved", delivery_date: DAY }),
    ]);
    expect(s.missed).toBe(2);
  });

  it("does not call a canceled or draft order 'missed'", () => {
    // Nobody failed to deliver an order that was called off or never sent.
    const s = build([
      mk({ id: "a", stage: "canceled", delivery_date: DAY }),
      mk({ id: "b", stage: "rejected", delivery_date: DAY }),
      mk({ id: "c", stage: "draft", delivery_date: DAY }),
    ]);
    expect(s.missed).toBe(0);
  });

  it("groups the day's work by driver, busiest first", () => {
    const s = build([
      mk({ id: "a", stage: "delivered", assigned_driver: "Ana", delivery_date: DAY, pod_delivered_at: `${DAY}T15:00:00Z`, actual_pallets: 3 }),
      mk({ id: "b", stage: "delivered", assigned_driver: "Beto", delivery_date: DAY, pod_delivered_at: `${DAY}T16:00:00Z`, actual_pallets: 2 }),
      mk({ id: "c", stage: "delivered", assigned_driver: "Ana", delivery_date: DAY, pod_delivered_at: `${DAY}T17:00:00Z`, actual_pallets: 4 }),
    ]);
    expect(s.perDriver[0]).toEqual({ driver: "Ana", delivered: 2, pallets: 7 });
    expect(s.perDriver[1].driver).toBe("Beto");
  });

  it("names what needs attention instead of only counting it", () => {
    // "3 orders are stuck" sends someone hunting; the code is what they search.
    const s = build([mk({ order_code: "FQ503", stage: "ready", delivery_date: DAY, account: "Guadalupe Homes" })]);
    expect(s.attention[0]).toContain("FQ503");
    expect(s.attention[0]).toContain("Guadalupe Homes");
  });

  it("flags work past its date with nobody driving it", () => {
    const s = build([mk({ stage: "approved", delivery_date: "2026-08-05", assigned_driver: null })]);
    expect(s.overdueUnassigned).toBe(1);
  });

  it("does not list the same order twice when it is both missed and overdue", () => {
    const s = build([mk({ id: "x", order_code: "FP500", stage: "approved", delivery_date: "2026-08-05", assigned_driver: null })]);
    expect(s.attention.filter((a) => a.includes("FP500"))).toHaveLength(1);
  });

  it("caps the list so a bad day doesn't produce a wall of codes", () => {
    const many = Array.from({ length: 40 }, (_, i) => mk({ id: `o${i}`, order_code: `FQ${i}`, stage: "ready", delivery_date: DAY }));
    expect(build(many).attention).toHaveLength(15);
    expect(build(many).missed).toBe(40);
  });

  it("survives a day with nothing in it", () => {
    const s = build([]);
    expect(s.delivered).toBe(0);
    expect(s.attention).toEqual([]);
  });
});

describe("summaryLines", () => {
  it("leads with the numbers anyone would ask for first", () => {
    const s = build([mk({ stage: "delivered", delivery_date: DAY, pod_delivered_at: `${DAY}T15:00:00Z` })]);
    expect(summaryLines(s)[0]).toContain("1 entregadas");
  });

  it("stays quiet about zeros rather than padding the report", () => {
    // A clean day should read as a clean day, not as a list of noughts.
    const lines = summaryLines(build([])).join("\n");
    expect(lines).not.toContain("siguen en el camión");
    expect(lines).not.toContain("sin chofer");
  });
});
