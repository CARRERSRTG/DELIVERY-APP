import { describe, it, expect } from "vitest";
import { nextTrainingOrderNo, TRAINING_ORDER_BASE } from "@/lib/utils";

// Teaching mode must never consume a real order number. These cover the
// client-side numbering that keeps practice orders in their own high range.
describe("nextTrainingOrderNo", () => {
  it("starts at the base + 1 when there are no training orders yet", () => {
    expect(nextTrainingOrderNo([])).toBe(TRAINING_ORDER_BASE + 1);
    expect(nextTrainingOrderNo([], 900000)).toBe(900001);
  });

  it("continues from the highest existing training number", () => {
    expect(nextTrainingOrderNo([{ order_no: 900003 }, { order_no: 900001 }])).toBe(900004);
  });

  it("ignores null/undefined order numbers", () => {
    expect(nextTrainingOrderNo([{ order_no: null }, { order_no: undefined }, { order_no: 900010 }])).toBe(900011);
  });

  it("never drops below the base even if only low (real-looking) numbers exist", () => {
    // A stray low number must not pull training numbering back into the real range.
    expect(nextTrainingOrderNo([{ order_no: 42 }])).toBe(TRAINING_ORDER_BASE + 1);
  });

  it("respects a custom base", () => {
    expect(nextTrainingOrderNo([{ order_no: 5_000_001 }], 5_000_000)).toBe(5_000_002);
  });
});
