import { describe, expect, it } from "vitest";
import { decodePolyline, departureTimeFor, resolveOptimizedOrder } from "./google-routes";

describe("resolveOptimizedOrder", () => {
  it("keeps a real permutation from Google", () => {
    expect(resolveOptimizedOrder([2, 0, 1], 3)).toEqual([2, 0, 1]);
  });

  it("falls back to the sent order when Google answers [-1]", () => {
    // Google returns [-1] when there is a single intermediate — nothing to
    // solve. Indexing with -1 used to crash the whole optimize call.
    expect(resolveOptimizedOrder([-1], 1)).toEqual([0]);
  });

  it("ignores a truncated, out-of-range or duplicated answer", () => {
    expect(resolveOptimizedOrder([0], 3)).toEqual([0, 1, 2]);        // wrong length
    expect(resolveOptimizedOrder([0, 5], 2)).toEqual([0, 1]);        // out of range
    expect(resolveOptimizedOrder([1, 1], 2)).toEqual([0, 1]);        // duplicate
    expect(resolveOptimizedOrder(undefined, 2)).toEqual([0, 1]);     // field absent
    expect(resolveOptimizedOrder("nope", 2)).toEqual([0, 1]);        // wrong type
  });

  it("handles a route with no intermediates", () => {
    expect(resolveOptimizedOrder(undefined, 0)).toEqual([]);
  });
});

describe("decodePolyline", () => {
  it("decodes Google's reference example to [lng, lat] pairs", () => {
    // From Google's encoded-polyline docs: (38.5,-120.2) (40.7,-120.95) (43.252,-126.453)
    const pts = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(pts).toHaveLength(3);
    // Stored [lng, lat] — the same shape the OSRM GeoJSON path used, so the
    // map layer didn't have to change.
    expect(pts[0][1]).toBeCloseTo(38.5, 5);
    expect(pts[0][0]).toBeCloseTo(-120.2, 5);
    expect(pts[2][1]).toBeCloseTo(43.252, 5);
    expect(pts[2][0]).toBeCloseTo(-126.453, 5);
  });

  it("returns nothing for an empty polyline", () => {
    expect(decodePolyline("")).toEqual([]);
  });
});

describe("departureTimeFor", () => {
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  it("targets 08:00 business time on a future run date", () => {
    const future = new Date(Date.now() + 30 * 86400000);
    const out = departureTimeFor(iso(future));
    expect(out).toBeTruthy();
    // 08:00 in America/Chicago is 13:00 UTC (CDT) or 14:00 UTC (CST).
    const hourUTC = new Date(out!).getUTCHours();
    expect([13, 14]).toContain(hourUTC);
  });

  it("omits a departure time that has already passed", () => {
    // Google rejects a past departureTime, so yesterday must yield undefined
    // and let the router price the drive from now instead.
    const past = new Date(Date.now() - 5 * 86400000);
    expect(departureTimeFor(iso(past))).toBeUndefined();
  });

  it("ignores a missing or malformed date", () => {
    expect(departureTimeFor(null)).toBeUndefined();
    expect(departureTimeFor(undefined)).toBeUndefined();
    expect(departureTimeFor("not-a-date")).toBeUndefined();
    expect(departureTimeFor("2026-13-45")).toBeUndefined();
  });
});
