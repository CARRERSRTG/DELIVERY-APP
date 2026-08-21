import { describe, it, expect } from "vitest";
import {
  DAY_MIN, endOptions, isSlotOccupied, maxEndAfter, mmhh, rangeOverlapsAny, rangesOverlap, startOptions,
  type OccupiedRange,
} from "./timeOverlap";

const OCCUPIED_10_12: OccupiedRange = { startMin: 600, endMin: 720 }; // 10:00-12:00

describe("rangesOverlap", () => {
  it("flags a range inside another", () => {
    expect(rangesOverlap(630, 660, 600, 720)).toBe(true); // 10:30-11:00 inside 10:00-12:00
  });

  it("does not flag touching edges — one ending exactly where the next starts", () => {
    expect(rangesOverlap(480, 600, 600, 720)).toBe(false); // 8:00-10:00 then 10:00-12:00
    expect(rangesOverlap(720, 780, 600, 720)).toBe(false); // 12:00-13:00 after 10:00-12:00
  });

  it("flags a range that crosses a block entirely (both endpoints outside it)", () => {
    expect(rangesOverlap(540, 780, 600, 720)).toBe(true); // 9:00-13:00 swallows 10:00-12:00
  });
});

describe("isSlotOccupied", () => {
  it("marks a 10-min slot inside the occupied range", () => {
    expect(isSlotOccupied(630, [OCCUPIED_10_12])).toBe(true); // 10:30
  });

  it("leaves the slot touching the start free (10:00 IS occupied, 9:50 is not)", () => {
    expect(isSlotOccupied(590, [OCCUPIED_10_12])).toBe(false); // 9:50
    expect(isSlotOccupied(600, [OCCUPIED_10_12])).toBe(true); // 10:00
  });

  it("leaves the slot exactly at the end of the block free", () => {
    expect(isSlotOccupied(720, [OCCUPIED_10_12])).toBe(false); // 12:00
    expect(isSlotOccupied(710, [OCCUPIED_10_12])).toBe(true); // 11:50, still inside
  });

  it("is free every slot on a day with no tracked entries", () => {
    expect(isSlotOccupied(630, [])).toBe(false);
  });

  it("catches an entry not aligned to the step (a real session rarely starts on :X0)", () => {
    const messy: OccupiedRange = { startMin: 603, endMin: 647 }; // 10:03-10:47
    expect(isSlotOccupied(600, [messy])).toBe(true); // the 10:00-10:10 slot overlaps 10:03
    expect(isSlotOccupied(640, [messy])).toBe(true); // the 10:40-10:50 slot overlaps up to 10:47
    expect(isSlotOccupied(650, [messy])).toBe(false); // 10:50-11:00 is clear
  });
});

describe("maxEndAfter — the range-crosses-a-block guarantee", () => {
  it("caps at the start of the next block when picking a start before it", () => {
    expect(maxEndAfter(540, [OCCUPIED_10_12])).toBe(600); // starting 9:00, can't end past 10:00
  });

  it("is end-of-day when nothing follows the chosen start", () => {
    expect(maxEndAfter(780, [OCCUPIED_10_12])).toBe(DAY_MIN); // starting 13:00, block is behind it
  });

  it("is end-of-day on a day with no tracked entries at all", () => {
    expect(maxEndAfter(0, [])).toBe(DAY_MIN);
  });

  it("picks the nearest of several blocks, not just the first one", () => {
    const occupied: OccupiedRange[] = [
      { startMin: 600, endMin: 720 }, // 10:00-12:00
      { startMin: 780, endMin: 840 }, // 13:00-14:00
    ];
    expect(maxEndAfter(540, occupied)).toBe(600); // 9:00 -> capped at 10:00, not 13:00
    expect(maxEndAfter(720, occupied)).toBe(780); // 12:00 (touching the first block's end) -> capped at 13:00
  });
});

describe("startOptions / endOptions — what the dropdowns actually render", () => {
  it("disables every 10-min start slot the occupied block touches, nothing else", () => {
    const opts = startOptions([OCCUPIED_10_12]);
    const disabled = opts.filter((o) => o.disabled).map((o) => o.label);
    expect(disabled).toEqual(["10:00", "10:10", "10:20", "10:30", "10:40", "10:50", "11:00", "11:10", "11:20", "11:30", "11:40", "11:50"]);
    expect(opts.find((o) => o.label === "09:50")!.disabled).toBe(false);
    expect(opts.find((o) => o.label === "12:00")!.disabled).toBe(false);
  });

  it("caps end options at the next block's start, leaving the rest visible but disabled", () => {
    const opts = endOptions(540, [OCCUPIED_10_12]); // start 9:00
    expect(opts.find((o) => o.label === "10:00")!.disabled).toBe(false); // touching the block's start is fine
    expect(opts.find((o) => o.label === "10:10")!.disabled).toBe(true);
    expect(opts.find((o) => o.label === "12:00")!.disabled).toBe(true);
    expect(opts[opts.length - 1].label).toBe("24:00");
  });

  it("end options are wide open on a day with no tracked entries", () => {
    const opts = endOptions(0, []);
    expect(opts.every((o) => !o.disabled)).toBe(true);
  });

  it("handles several occupied entries the same day", () => {
    const occupied: OccupiedRange[] = [
      { startMin: 480, endMin: 540 }, // 8:00-9:00
      { startMin: 600, endMin: 720 }, // 10:00-12:00
    ];
    const starts = startOptions(occupied);
    expect(starts.find((o) => o.label === "08:30")!.disabled).toBe(true);
    expect(starts.find((o) => o.label === "09:00")!.disabled).toBe(false); // gap between blocks
    expect(starts.find((o) => o.label === "11:00")!.disabled).toBe(true);
    // starting in the 9:00-10:00 gap, end is capped at the SECOND block, not the first
    expect(maxEndAfter(540, occupied)).toBe(600);
  });
});

describe("rangeOverlapsAny — the real guarantee checked again on submit/accept", () => {
  it("catches a range that crosses a block even though both endpoints look free", () => {
    expect(rangeOverlapsAny(540, 780, [OCCUPIED_10_12])).toBe(true); // 9:00-13:00
  });

  it("allows touching an existing block on either side", () => {
    expect(rangeOverlapsAny(480, 600, [OCCUPIED_10_12])).toBe(false); // 8:00-10:00
    expect(rangeOverlapsAny(720, 780, [OCCUPIED_10_12])).toBe(false); // 12:00-13:00
  });

  it("is always false with nothing tracked that day", () => {
    expect(rangeOverlapsAny(0, DAY_MIN, [])).toBe(false);
  });
});

describe("mmhh", () => {
  it("formats minutes as zero-padded HH:MM", () => {
    expect(mmhh(0)).toBe("00:00");
    expect(mmhh(90)).toBe("01:30");
    expect(mmhh(1430)).toBe("23:50");
  });
});
