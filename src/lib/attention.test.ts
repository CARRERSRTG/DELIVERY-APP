import { describe, it, expect } from "vitest";
import { attentionItems, deliveredWithoutProof, missingPin, overdueUnassigned } from "./attention";
import { blankDelivery } from "./blank-delivery";
import type { Delivery } from "./types";

const TODAY = "2026-08-16";
const mk = (over: Partial<Delivery>): Delivery => ({ ...blankDelivery(), ...over });

describe("overdueUnassigned", () => {
  it("catches live work past its date with nobody driving it", () => {
    // The real one this was written for: eleven days past, still 'approved',
    // no driver, and nothing anywhere said so.
    const d = mk({ stage: "approved", delivery_date: "2026-08-05", assigned_driver: null });
    expect(overdueUnassigned([d], TODAY)).toHaveLength(1);
  });

  it("stays quiet about TODAY's unassigned work", () => {
    // Normal at 8am. Flagging it would cry wolf every single morning.
    const d = mk({ stage: "ready", delivery_date: TODAY, assigned_driver: null });
    expect(overdueUnassigned([d], TODAY)).toHaveLength(0);
  });

  it("ignores an overdue order that already has a driver", () => {
    const d = mk({ stage: "ready", delivery_date: "2026-08-05", assigned_driver: "Maximo Garza" });
    expect(overdueUnassigned([d], TODAY)).toHaveLength(0);
  });

  it("ignores finished and abandoned orders", () => {
    for (const stage of ["delivered", "canceled", "rejected", "draft"] as const) {
      expect(overdueUnassigned([mk({ stage, delivery_date: "2026-08-01", assigned_driver: null })], TODAY)).toHaveLength(0);
    }
  });

  it("ignores an undated order", () => {
    expect(overdueUnassigned([mk({ stage: "ready", delivery_date: null, assigned_driver: null })], TODAY)).toHaveLength(0);
  });
});

describe("missingPin", () => {
  it("catches live work the optimizer would silently skip", () => {
    expect(missingPin([mk({ stage: "ready", delivery_lat: null })])).toHaveLength(1);
  });

  it("ignores a stop that has coordinates", () => {
    expect(missingPin([mk({ stage: "ready", delivery_lat: 25.9, delivery_lng: -97.5 })])).toHaveLength(0);
  });

  it("ignores drafts nobody has committed to", () => {
    expect(missingPin([mk({ stage: "draft", delivery_lat: null })])).toHaveLength(0);
  });
});

describe("deliveredWithoutProof", () => {
  it("catches a delivery recorded with nothing at all", () => {
    const d = mk({ stage: "delivered", pod_delivered_at: "2026-08-14T19:32:00Z" });
    expect(deliveredWithoutProof([d])).toHaveLength(1);
  });

  it("ignores the backlog that was marked in bulk", () => {
    // 35 orders were marked delivered when the system was set up. They never
    // had proof and never will; flagging them would bury the ones that matter.
    const d = mk({ stage: "delivered", pod_delivered_at: null });
    expect(deliveredWithoutProof([d])).toHaveLength(0);
  });

  it("accepts ANY one piece of evidence as enough", () => {
    const base = { stage: "delivered" as const, pod_delivered_at: "2026-08-14T19:32:00Z" };
    expect(deliveredWithoutProof([mk({ ...base, pod_received_by: "Ana" })])).toHaveLength(0);
    expect(deliveredWithoutProof([mk({ ...base, pod_signature: "data:image/png;base64,x" })])).toHaveLength(0);
    expect(deliveredWithoutProof([mk({ ...base, pod_lat: 25.9, pod_lng: -97.5 })])).toHaveLength(0);
    expect(deliveredWithoutProof([mk({ ...base, photos: ["u"] })])).toHaveLength(0);
  });
});

describe("attentionItems", () => {
  it("puts overdue work ahead of bookkeeping", () => {
    const items = attentionItems([
      mk({ id: "a", stage: "delivered", pod_delivered_at: "2026-08-14T19:32:00Z" }),
      mk({ id: "b", stage: "approved", delivery_date: "2026-08-05", assigned_driver: null, delivery_lat: 25.9, delivery_lng: -97.5 }),
    ], TODAY);
    expect(items[0].kind).toBe("overdue_unassigned");
    expect(items[items.length - 1].kind).toBe("no_proof");
  });

  it("is empty on a healthy board", () => {
    expect(attentionItems([mk({ stage: "ready", delivery_date: TODAY, assigned_driver: "Maximo Garza", delivery_lat: 25.9, delivery_lng: -97.5 })], TODAY)).toEqual([]);
  });
});
