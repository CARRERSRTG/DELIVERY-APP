import { describe, it, expect } from "vitest";
import { serviceMin, tripTiming, dayMinutes, DEFAULT_SERVICE_MIN, RELOAD_MIN } from "./trip-timing";

describe("serviceMin", () => {
  it("reads the number the office typed, in whatever form", () => {
    expect(serviceMin("30")).toBe(30);
    expect(serviceMin("30 min")).toBe(30);
    expect(serviceMin("45 minutos")).toBe(45);
  });

  it("falls back to the default when there's nothing usable", () => {
    for (const v of [null, undefined, "", "n/a", "quick"]) {
      expect(serviceMin(v)).toBe(DEFAULT_SERVICE_MIN);
    }
  });

  it("never lets a stop cost zero minutes", () => {
    // A "0" here would make a load of ten stops look like pure driving.
    expect(serviceMin("0")).toBe(DEFAULT_SERVICE_MIN);
    expect(serviceMin("0 min")).toBe(DEFAULT_SERVICE_MIN);
  });
});

describe("tripTiming", () => {
  it("adds unload time to wheel time", () => {
    const t = tripTiming(90, ["30", "20", "10"]);
    expect(t.driveMin).toBe(90);
    expect(t.serviceMin).toBe(60);
    expect(t.totalMin).toBe(150);
  });

  it("uses the default for stops with no duration set", () => {
    const t = tripTiming(60, [null, undefined, "30"]);
    expect(t.serviceMin).toBe(DEFAULT_SERVICE_MIN * 2 + 30);
  });

  it("is just the drive when a load somehow has no stops", () => {
    expect(tripTiming(45, []).totalMin).toBe(45);
  });
});

describe("dayMinutes", () => {
  it("counts a reload between loads, but not after the last one", () => {
    const a = tripTiming(60, ["30", "30"]);   // 120
    const b = tripTiming(50, ["20"]);         //  70
    // 120 + 70 + one reload — the truck is turned around once, not twice.
    expect(dayMinutes([a, b])).toBe(120 + 70 + RELOAD_MIN);
  });

  it("adds no reload for a single truckload", () => {
    const a = tripTiming(60, ["30"]);
    expect(dayMinutes([a])).toBe(90);
  });

  it("is zero for a driver with nothing assigned", () => {
    expect(dayMinutes([])).toBe(0);
  });

  it("catches a day that only busts 8 hours once unloading counts", () => {
    // 6 h of driving looks fine on its own; eight 30-minute unloads don't.
    const drive = 6 * 60;
    const stops = Array(8).fill("30");
    expect(tripTiming(drive, stops).driveMin).toBeLessThan(8 * 60);
    expect(dayMinutes([tripTiming(drive, stops)])).toBeGreaterThan(8 * 60);
  });
});
