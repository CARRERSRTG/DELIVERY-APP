import { describe, expect, it } from "vitest";
import { applyOutbox, isOfflineError, pendingIds, type OutboxItem } from "./outbox";
import type { Delivery } from "./types";

const order = (id: string, stage: Delivery["stage"]): Delivery =>
  ({ id, stage, order_no: 1, order_code: "FQ100" } as Delivery);

const item = (over: Partial<OutboxItem> & { deliveryId: string; stage: Delivery["stage"] }): OutboxItem => ({
  id: `q-${Math.random()}`,
  patch: {},
  at: "2026-08-13T10:00:00.000Z",
  tries: 0,
  ...over,
});

describe("isOfflineError", () => {
  it("treats a dropped connection as offline", () => {
    expect(isOfflineError(new Error("TypeError: Failed to fetch"))).toBe(true);
    expect(isOfflineError({ message: "NetworkError when attempting to fetch resource" })).toBe(true);
    expect(isOfflineError({ message: "Load failed" })).toBe(true);      // Safari
    expect(isOfflineError({ message: "fetch failed" })).toBe(true);
  });

  it("does NOT queue a rejection — retrying it would never succeed", () => {
    // These are the server saying no. Queueing them would hide a real problem
    // behind a spinner that never resolves.
    expect(isOfflineError({ message: "You cannot edit an order in the ready stage" })).toBe(false);
    expect(isOfflineError({ message: "new row violates row-level security policy" })).toBe(false);
    expect(isOfflineError({ message: "duplicate key value violates unique constraint" })).toBe(false);
  });

  it("returns false for nothing useful", () => {
    expect(isOfflineError(null)).toBe(false);
    expect(isOfflineError(undefined)).toBe(false);
    expect(isOfflineError({})).toBe(false);
  });
});

describe("applyOutbox", () => {
  it("leaves rows alone when nothing is queued", () => {
    const rows = [order("a", "ready")];
    expect(applyOutbox(rows, [])).toBe(rows);
  });

  it("shows a queued milestone as already done", () => {
    // The whole point: the driver marked it delivered, so their screen must
    // say delivered — otherwise they'll do it again.
    const out = applyOutbox(
      [order("a", "picked_up")],
      [item({ deliveryId: "a", stage: "delivered", patch: { pod_received_by: "Juan" } })],
    );
    expect(out[0].stage).toBe("delivered");
    expect(out[0].pod_received_by).toBe("Juan");
  });

  it("ends on the LAST milestone when a stop was picked up and delivered offline", () => {
    const out = applyOutbox(
      [order("a", "ready")],
      [
        item({ deliveryId: "a", stage: "picked_up", at: "2026-08-13T10:00:00.000Z" }),
        item({ deliveryId: "a", stage: "delivered", at: "2026-08-13T11:00:00.000Z" }),
      ],
    );
    expect(out[0].stage).toBe("delivered");
  });

  it("applies in real time order, not the order they happen to sit in", () => {
    const out = applyOutbox(
      [order("a", "ready")],
      [
        item({ deliveryId: "a", stage: "delivered", at: "2026-08-13T11:00:00.000Z" }),
        item({ deliveryId: "a", stage: "picked_up", at: "2026-08-13T10:00:00.000Z" }),
      ],
    );
    expect(out[0].stage).toBe("delivered");
  });

  it("touches only the orders that have something queued", () => {
    const out = applyOutbox(
      [order("a", "ready"), order("b", "ready")],
      [item({ deliveryId: "a", stage: "delivered" })],
    );
    expect(out[0].stage).toBe("delivered");
    expect(out[1].stage).toBe("ready");
  });

  it("ignores a queued item whose order isn't loaded", () => {
    const out = applyOutbox([order("a", "ready")], [item({ deliveryId: "gone", stage: "delivered" })]);
    expect(out).toHaveLength(1);
    expect(out[0].stage).toBe("ready");
  });
});

describe("pendingIds", () => {
  it("lists each order once, however many milestones are waiting", () => {
    const ids = pendingIds([
      item({ deliveryId: "a", stage: "picked_up" }),
      item({ deliveryId: "a", stage: "delivered" }),
      item({ deliveryId: "b", stage: "delivered" }),
    ]);
    expect([...ids].sort()).toEqual(["a", "b"]);
  });
});
