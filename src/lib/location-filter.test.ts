import { describe, expect, it } from "vitest";
import { HEARTBEAT_MS, MAX_ACCURACY_M, MIN_INTERVAL_MS, heartbeatDue, metresBetween, shouldSend } from "./location-filter";

describe("metresBetween", () => {
  it("measures a known RGV distance", () => {
    // McAllen → Brownsville is roughly 90 km straight-line.
    const m = metresBetween(26.2034, -98.23, 25.9017, -97.4975);
    expect(m).toBeGreaterThan(75_000);
    expect(m).toBeLessThan(95_000);
  });

  it("is zero for the same point", () => {
    expect(metresBetween(26.2, -98.2, 26.2, -98.2)).toBeCloseTo(0, 5);
  });
});

describe("shouldSend", () => {
  const here = { lat: 26.2034, lng: -98.23 };
  const now = 1_700_000_000_000;

  it("sends the first fix of a shift", () => {
    expect(shouldSend(here, null, now)).toBe(true);
  });

  it("drops a cell-tower-grade fix", () => {
    // A 500m-accurate fix would put the truck on the wrong side of town.
    expect(shouldSend({ ...here, accuracy: 500 }, null, now)).toBe(false);
  });

  it("keeps a precise fix", () => {
    expect(shouldSend({ ...here, accuracy: 12 }, null, now)).toBe(true);
  });

  it("throttles fixes that arrive too close together", () => {
    const last = { ...here, at: now - 5_000 };
    // Moved a long way, but only 5s later — the interval guard still applies,
    // otherwise a parked-but-drifting GPS floods the table.
    expect(shouldSend({ lat: 26.3, lng: -98.3 }, last, now)).toBe(false);
  });

  it("skips a truck that hasn't really moved", () => {
    const last = { ...here, at: now - 60_000 };
    // ~10 m of GPS drift while parked at a stop.
    expect(shouldSend({ lat: 26.20349, lng: -98.23 }, last, now)).toBe(false);
  });

  it("sends once the truck has moved and enough time passed", () => {
    const last = { ...here, at: now - 60_000 };
    expect(shouldSend({ lat: 26.2065, lng: -98.23 }, last, now)).toBe(true);
  });
});

// ---- Heartbeat -------------------------------------------------------------
// Without one, a parked truck and a killed app are the same thing in the data.
describe("heartbeat", () => {
  const here = { lat: 26.2034, lng: -98.23 };
  const last = { ...here, at: 0 };

  it("writes a fix that hasn't moved once the heartbeat is due", () => {
    expect(shouldSend(here, last, MIN_INTERVAL_MS)).toBe(false);   // parked, too soon
    expect(shouldSend(here, last, HEARTBEAT_MS)).toBe(true);       // parked, but overdue
  });

  it("still refuses a vague fix, heartbeat or not", () => {
    expect(shouldSend({ ...here, accuracy: MAX_ACCURACY_M + 1 }, last, HEARTBEAT_MS)).toBe(false);
  });

  it("lands well inside the dispatcher's 15-minute quiet flag", () => {
    expect(HEARTBEAT_MS).toBeLessThan(15 * 60_000);
  });

  it("heartbeatDue only fires after something was actually sent", () => {
    expect(heartbeatDue(null, HEARTBEAT_MS * 10)).toBe(false);
    expect(heartbeatDue(0, HEARTBEAT_MS - 1)).toBe(false);
    expect(heartbeatDue(0, HEARTBEAT_MS)).toBe(true);
  });
});
