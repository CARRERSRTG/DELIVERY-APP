import { describe, it, expect } from "vitest";
import { cleanFixes, nameStop, summarizeTrack, GAP_MINUTES, STOP_MIN_MINUTES, type Fix } from "./track-history";

const T0 = new Date("2026-08-14T13:00:00Z").getTime();
/** A fix `mins` after the start, at a point `metresEast` from the depot. */
const at = (mins: number, metresEast = 0, accuracy_m?: number): Fix => ({
  lat: 26.2034,
  // One degree of longitude is 111_320 m at the equator, shrinking with the
  // cosine of the latitude. Getting this wrong makes every distance 11% off.
  lng: -98.23 + metresEast / (111_320 * Math.cos(26.2034 * Math.PI / 180)),
  at: new Date(T0 + mins * 60_000).toISOString(),
  accuracy_m,
});

describe("cleanFixes", () => {
  it("drops cell-tower guesses and puts the rest in order", () => {
    const out = cleanFixes([at(5), at(1), at(3, 0, 900)]);
    expect(out).toHaveLength(2);
    expect(new Date(out[0].at).getTime()).toBeLessThan(new Date(out[1].at).getTime());
  });

  it("drops nonsense rather than producing NaN totals", () => {
    expect(cleanFixes([{ lat: NaN, lng: 0, at: new Date().toISOString() }])).toHaveLength(0);
    expect(cleanFixes([{ lat: 26, lng: -98, at: "not a date" }])).toHaveLength(0);
  });
});

describe("summarizeTrack", () => {
  it("says nothing about a day with no fixes", () => {
    const s = summarizeTrack([]);
    expect(s.miles).toBe(0);
    expect(s.fixes).toBe(0);
    expect(s.firstAt).toBeNull();
  });

  it("measures a straight drive", () => {
    // 1 km east over 10 minutes.
    const s = summarizeTrack([at(0, 0), at(10, 1000)]);
    expect(s.miles).toBeCloseTo(0.6, 1);
    expect(s.movingMinutes).toBe(10);
    expect(s.stoppedMinutes).toBe(0);
  });

  it("counts standing still as stopped, not driven", () => {
    // Three fixes within GPS drift over 12 minutes.
    const s = summarizeTrack([at(0, 0), at(6, 10), at(12, 20)]);
    expect(s.miles).toBe(0);
    expect(s.movingMinutes).toBe(0);
    expect(s.stoppedMinutes).toBe(12);
  });

  it("records a long stop and ignores a traffic light", () => {
    const s = summarizeTrack([
      at(0, 0), at(20, 15),              // parked 20 min at the start
      at(30, 3000),                      // drove off
      at(31, 3010),                      // paused a minute
      at(45, 9000),                      // drove on
    ]);
    expect(s.stops).toHaveLength(1);
    expect(s.stops[0].minutes).toBe(20);
    expect(STOP_MIN_MINUTES).toBeGreaterThan(1);   // the 1-minute pause is not a stop
  });

  it("refuses to guess what happened across a long gap", () => {
    // This is the whole point. A silent hour could be a truck parked at a
    // customer or the app asleep while it drove across the Valley. Calling it
    // "time at stores" would invent time the driver never spent standing
    // around; calling it driving would invent miles.
    const s = summarizeTrack([at(0, 0), at(GAP_MINUTES + 40, 30000)]);
    expect(s.unknownMinutes).toBe(GAP_MINUTES + 40);
    expect(s.stoppedMinutes).toBe(0);
    expect(s.movingMinutes).toBe(0);
    expect(s.gaps).toBe(1);
    expect(s.sparse).toBe(true);
    // The distance is still real: the truck genuinely ended up there.
    expect(s.miles).toBeGreaterThan(15);
  });

  it("does not open a stop on either side of a gap", () => {
    const s = summarizeTrack([at(0, 0), at(5, 5), at(5 + GAP_MINUTES + 10, 10), at(5 + GAP_MINUTES + 16, 15)]);
    // The two short still stretches must not be welded into one long stop
    // spanning the gap.
    for (const stop of s.stops) expect(stop.minutes).toBeLessThan(GAP_MINUTES);
  });

  it("flags a day too sparse to trust the mileage", () => {
    const dense = summarizeTrack([at(0, 0), at(2, 1000), at(4, 2000), at(6, 3000)]);
    expect(dense.sparse).toBe(false);
    const thin = summarizeTrack([at(0, 0), at(15, 20000)]);
    expect(thin.sparse).toBe(true);
  });

  it("survives duplicate timestamps", () => {
    const s = summarizeTrack([at(0, 0), at(0, 0), at(5, 500)]);
    expect(Number.isFinite(s.miles)).toBe(true);
    expect(s.movingMinutes).toBe(5);
  });

  it("reports the span of the day", () => {
    const s = summarizeTrack([at(0, 0), at(10, 900), at(90, 5000)]);
    expect(s.firstAt).toBe(new Date(T0).toISOString());
    expect(s.lastAt).toBe(new Date(T0 + 90 * 60_000).toISOString());
  });
});

describe("nameStop", () => {
  const stop = { at: { lat: 26.2034, lng: -98.23 }, from: "", to: "", minutes: 20 };

  it("names a stop that really is at the place", () => {
    expect(nameStop(stop, [{ label: "Bodega McAllen", lat: 26.2035, lng: -98.2301 }])).toBe("Bodega McAllen");
  });

  it("leaves a stop unnamed rather than blaming the nearest customer", () => {
    // Half a mile away is a different address. An unnamed stop is honest.
    expect(nameStop(stop, [{ label: "Cliente lejano", lat: 26.215, lng: -98.23 }])).toBeNull();
  });

  it("picks the closest of several", () => {
    expect(nameStop(stop, [
      { label: "lejos", lat: 26.2060, lng: -98.23 },
      { label: "cerca", lat: 26.2035, lng: -98.23 },
    ])).toBe("cerca");
  });

  it("ignores places with no coordinates", () => {
    expect(nameStop(stop, [{ label: "sin pin", lat: NaN, lng: NaN }])).toBeNull();
  });
});

describe("impossible jumps", () => {
  it("refuses a distance no vehicle could have covered", () => {
    // Found in real data: fixes from a second device 1,300 miles away turned
    // one day's driving into 4,936 miles. Averaging that in would have made
    // every mileage figure meaningless and hidden the reason.
    const far: Fix[] = [
      { lat: 25.9589, lng: -97.5099, at: new Date(T0).toISOString() },
      { lat: 15.7667, lng: -86.7849, at: new Date(T0 + 30 * 60_000).toISOString() },
      { lat: 25.9590, lng: -97.5096, at: new Date(T0 + 60 * 60_000).toISOString() },
    ];
    const s = summarizeTrack(far);
    expect(s.teleports).toBe(2);
    expect(s.miles).toBe(0);
    expect(s.sparse).toBe(true);
  });

  it("still accepts a fast highway run", () => {
    // 60 miles in an hour is a truck on the expressway, not a teleport.
    const s = summarizeTrack([
      { lat: 26.2034, lng: -98.2300, at: new Date(T0).toISOString() },
      { lat: 25.9017, lng: -97.4975, at: new Date(T0 + 60 * 60_000).toISOString() },
    ]);
    expect(s.teleports).toBe(0);
    expect(s.miles).toBeGreaterThan(40);
  });
});

describe("jitter is not a teleport", () => {
  it("ignores two fixes a fraction of a second apart", () => {
    // Straight from production: 21.7 m in 0.30 s implies 160 mph. Dividing by
    // a near-zero time makes any GPS wobble look supersonic, and the day was
    // flagged for a jump that never happened.
    const s = summarizeTrack([
      { lat: 25.9589943, lng: -97.5096401, at: new Date(T0).toISOString() },
      { lat: 25.9588708, lng: -97.5098081, at: new Date(T0 + 300).toISOString() },
    ]);
    expect(s.teleports).toBe(0);
  });

  it("ignores two fixes with the very same timestamp", () => {
    const s = summarizeTrack([
      { lat: 25.9589, lng: -97.5097, at: new Date(T0).toISOString() },
      { lat: 25.9589, lng: -97.5097, at: new Date(T0).toISOString() },
    ]);
    expect(s.teleports).toBe(0);
    expect(Number.isFinite(s.miles)).toBe(true);
  });

  it("still catches a jump that is actually far", () => {
    const s = summarizeTrack([
      { lat: 25.9589, lng: -97.5099, at: new Date(T0).toISOString() },
      { lat: 15.7667, lng: -86.7849, at: new Date(T0 + 30 * 60_000).toISOString() },
    ]);
    expect(s.teleports).toBe(1);
  });
});
