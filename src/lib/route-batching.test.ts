import { describe, it, expect } from "vitest";
import { buildGeoLoads, fillByCapacity, haversineMi, loadCostMi, planCostMi, type BatchStop } from "./route-batching";

// Real RGV geography, so the distances mean something.
const MCALLEN = { lat: 26.2034, lng: -98.2300 };          // depot
const stop = (id: string, lat: number, lng: number, pallets = 2): BatchStop => ({ id, lat, lng, pallets });

/** Which load each stop landed on, as a lookup. */
function loadIndexById(loads: BatchStop[][]): Record<string, number> {
  const m: Record<string, number> = {};
  loads.forEach((l, i) => l.forEach((s) => { m[s.id] = i; }));
  return m;
}

describe("haversineMi", () => {
  it("measures a known RGV hop", () => {
    // McAllen → Brownsville is about 60 miles as the crow flies.
    const miles = haversineMi(MCALLEN, { lat: 25.9017, lng: -97.4975 });
    expect(miles).toBeGreaterThan(45);
    expect(miles).toBeLessThan(60);
  });

  it("is zero for the same point and symmetric", () => {
    expect(haversineMi(MCALLEN, MCALLEN)).toBeCloseTo(0);
    const b = { lat: 26.19, lng: -97.69 };
    expect(haversineMi(MCALLEN, b)).toBeCloseTo(haversineMi(b, MCALLEN), 9);
  });
});

describe("buildGeoLoads — the bug this exists to fix", () => {
  it("keeps two neighbouring stops on the same truck even when list order splits them", () => {
    // Two deliveries on the same Brownsville block, listed either side of the
    // capacity boundary. The old splitter cut between them; nothing downstream
    // could fix that, because the router only reorders within a load.
    const stops = [
      stop("far-a", 25.9017, -97.4975, 5),
      stop("near-1", 26.2100, -98.2400, 5),   // both of these are minutes
      stop("near-2", 26.2110, -98.2410, 5),   // apart, right by the depot
      stop("far-b", 25.9100, -97.5000, 5),
    ];

    const old = loadIndexById(fillByCapacity(stops, 12));
    expect(old["near-1"]).not.toBe(old["near-2"]);   // the reported symptom

    const fixed = loadIndexById(buildGeoLoads(stops, MCALLEN, 12));
    expect(fixed["near-1"]).toBe(fixed["near-2"]);   // and the fix
    expect(fixed["far-a"]).toBe(fixed["far-b"]);     // the far pair pairs up too
    expect(fixed["near-1"]).not.toBe(fixed["far-a"]);
  });

  it("beats plain capacity filling on total distance", () => {
    const stops = [
      stop("w1", 26.20, -98.30, 3), stop("e1", 26.10, -97.60, 3),
      stop("w2", 26.21, -98.31, 3), stop("e2", 26.11, -97.61, 3),
    ];
    const geo = planCostMi(MCALLEN, buildGeoLoads(stops, MCALLEN, 6));
    const naive = planCostMi(MCALLEN, fillByCapacity(stops, 6));
    expect(geo).toBeLessThan(naive);
  });
});

describe("buildGeoLoads — constraints it must not break", () => {
  it("never puts more pallets on a truck than it holds", () => {
    const stops = Array.from({ length: 12 }, (_, i) =>
      stop(`s${i}`, 26.2 + (i % 4) * 0.01, -98.23 + Math.floor(i / 4) * 0.01, 4));
    for (const load of buildGeoLoads(stops, MCALLEN, 12)) {
      expect(load.reduce((n, s) => n + s.pallets, 0)).toBeLessThanOrEqual(12);
    }
  });

  it("carries every stop exactly once", () => {
    const stops = Array.from({ length: 9 }, (_, i) => stop(`s${i}`, 26.1 + i * 0.05, -98.0 - i * 0.05, 3));
    const ids = buildGeoLoads(stops, MCALLEN, 9).flat().map((s) => s.id).sort();
    expect(ids).toEqual(stops.map((s) => s.id).sort());
  });

  it("gives an oversized stop its own truck instead of dropping it", () => {
    const stops = [stop("huge", 26.21, -98.24, 20), stop("small", 26.22, -98.25, 2)];
    const loads = buildGeoLoads(stops, MCALLEN, 12);
    expect(loads.flat().map((s) => s.id).sort()).toEqual(["huge", "small"]);
    expect(loads.find((l) => l.some((s) => s.id === "huge"))).toHaveLength(1);
  });

  it("still places stops that have no map pin", () => {
    const stops: BatchStop[] = [
      stop("pinned-1", 26.21, -98.24, 2),
      stop("pinned-2", 26.22, -98.25, 2),
      { id: "no-pin", lat: null, lng: null, pallets: 2 },
    ];
    const loads = buildGeoLoads(stops, MCALLEN, 12);
    expect(loads.flat().map((s) => s.id).sort()).toEqual(["no-pin", "pinned-1", "pinned-2"]);
  });

  it("is deterministic — the same board twice gives the same loads", () => {
    const stops = Array.from({ length: 8 }, (_, i) => stop(`s${i}`, 26.0 + i * 0.07, -98.4 + i * 0.09, 3));
    const once = buildGeoLoads(stops, MCALLEN, 9).map((l) => l.map((s) => s.id));
    const twice = buildGeoLoads(stops, MCALLEN, 9).map((l) => l.map((s) => s.id));
    expect(once).toEqual(twice);
  });

  it("sends the furthest-reaching load out first", () => {
    const stops = [
      stop("close", 26.21, -98.24, 6), stop("close2", 26.22, -98.25, 6),
      stop("far", 25.90, -97.49, 6), stop("far2", 25.91, -97.50, 6),
    ];
    const loads = buildGeoLoads(stops, MCALLEN, 12);
    expect(loads[0].map((s) => s.id).sort()).toEqual(["far", "far2"]);
  });
});

describe("buildGeoLoads — falls back rather than misbehaving", () => {
  it("fills by capacity when there is no depot to measure from", () => {
    const stops = [stop("a", 26.2, -98.2, 8), stop("b", 26.3, -98.3, 8)];
    expect(buildGeoLoads(stops, null, 12)).toEqual(fillByCapacity(stops, 12));
  });

  it("fills by capacity when capacity is not set", () => {
    const stops = [stop("a", 26.2, -98.2, 8), stop("b", 26.3, -98.3, 8)];
    expect(buildGeoLoads(stops, MCALLEN, 0)).toEqual(fillByCapacity(stops, 0));
  });

  it("handles an empty board", () => {
    expect(buildGeoLoads([], MCALLEN, 12)).toEqual([]);
  });

  it("puts everything on one truck when it all fits", () => {
    const stops = [stop("a", 26.2, -98.2, 2), stop("b", 26.3, -98.3, 2), stop("c", 26.25, -98.25, 2)];
    expect(buildGeoLoads(stops, MCALLEN, 12)).toHaveLength(1);
  });

  it("does not crash when no stop has a pallet count", () => {
    // Uncounted stops weigh nothing, so they all fit on one truck. The board
    // warns about this separately; the batcher must not blow up on it.
    const stops = [
      { id: "a", lat: 26.2, lng: -98.2, pallets: 0 },
      { id: "b", lat: 25.9, lng: -97.5, pallets: 0 },
    ];
    expect(buildGeoLoads(stops, MCALLEN, 12).flat()).toHaveLength(2);
  });
});

describe("loadCostMi", () => {
  it("is the round trip out and back for a single stop", () => {
    const s = { id: "a", lat: 25.9017, lng: -97.4975 };
    expect(loadCostMi(MCALLEN, [s])).toBeCloseTo(2 * haversineMi(MCALLEN, s), 6);
  });

  it("is zero with no stops", () => {
    expect(loadCostMi(MCALLEN, [])).toBe(0);
  });

  it("untangles a crossed tour", () => {
    // Listed in a deliberately crossing order; 2-opt should straighten it.
    const pts = [
      { id: "a", lat: 26.20, lng: -98.20 },
      { id: "c", lat: 26.20, lng: -98.00 },
      { id: "b", lat: 26.30, lng: -98.10 },
      { id: "d", lat: 26.10, lng: -98.10 },
    ];
    const naive = (() => {
      let sum = haversineMi(MCALLEN, pts[0]);
      for (let i = 1; i < pts.length; i++) sum += haversineMi(pts[i - 1], pts[i]);
      return sum + haversineMi(pts[pts.length - 1], MCALLEN);
    })();
    expect(loadCostMi(MCALLEN, pts)).toBeLessThanOrEqual(naive);
  });
});
