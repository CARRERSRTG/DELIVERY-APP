import { describe, expect, it } from "vitest";
import { decodePolyline, departureTimeFor } from "./google-routes";

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
