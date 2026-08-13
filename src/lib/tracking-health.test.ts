import { describe, expect, it } from "vitest";
import { liveDriverNames, trackingGaps } from "./tracking-health";
import type { DriverLocation, DriverShift, Profile } from "./types";

const NOW = Date.parse("2026-08-12T18:00:00Z");
const minsAgo = (m: number) => new Date(NOW - m * 60000).toISOString();

const users = [
  { id: "d1", full_name: "Maximo Garza", role: "driver" },
  { id: "d2", full_name: "Luis Perez", role: "driver" },
] as Profile[];

const shift = (driver_id: string, startedMinAgo: number, ended = false): DriverShift => ({
  id: `s-${driver_id}`,
  driver_id,
  started_at: minsAgo(startedMinAgo),
  ended_at: ended ? minsAgo(1) : null,
  note: null,
  created_at: minsAgo(startedMinAgo),
});

const fix = (driver_id: string, minAgo: number): DriverLocation => ({
  id: `l-${driver_id}-${minAgo}`,
  driver_id,
  lat: 26.2, lng: -98.2,
  accuracy_m: 10, speed_mps: null, heading: null, battery_pct: null,
  recorded_at: minsAgo(minAgo),
  created_at: minsAgo(minAgo),
});

describe("trackingGaps", () => {
  it("stays quiet when a driver is reporting normally", () => {
    expect(trackingGaps(users, [shift("d1", 120)], [fix("d1", 1)], NOW)).toEqual([]);
  });

  it("flags a driver whose phone stopped reporting", () => {
    const gaps = trackingGaps(users, [shift("d1", 120)], [fix("d1", 40)], NOW);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].driver).toBe("Maximo Garza");
    expect(gaps[0].quietForMin).toBe(40);
  });

  it("ignores a driver who clocked out — silence is expected", () => {
    expect(trackingGaps(users, [shift("d1", 120, true)], [fix("d1", 90)], NOW)).toEqual([]);
  });

  it("gives a driver who just clocked in time for a first fix", () => {
    expect(trackingGaps(users, [shift("d1", 3)], [], NOW)).toEqual([]);
  });

  it("flags a driver who never reported after a long time on shift", () => {
    const gaps = trackingGaps(users, [shift("d1", 90)], [], NOW);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].quietForMin).toBeNull();
  });

  it("ignores a fix from before this shift started", () => {
    // Yesterday's leftover says nothing about whether the phone reports now.
    const gaps = trackingGaps(users, [shift("d1", 30)], [fix("d1", 600)], NOW);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].quietForMin).toBeNull();
  });

  it("reports the worst offender first", () => {
    const gaps = trackingGaps(
      users,
      [shift("d1", 120), shift("d2", 120)],
      [fix("d1", 20), fix("d2", 55)],
      NOW,
    );
    expect(gaps.map((g) => g.driver)).toEqual(["Luis Perez", "Maximo Garza"]);
  });
});

describe("liveDriverNames", () => {
  it("marks a clocked-in driver who is reporting", () => {
    const live = liveDriverNames(users, [shift("d1", 60)], [fix("d1", 2)], NOW);
    expect([...live]).toEqual(["Maximo Garza"]);
  });

  it("drops a driver whose phone went quiet", () => {
    // Same threshold as the stale warning, so a driver can never be both
    // "LIVE" and flagged as not reporting.
    expect(liveDriverNames(users, [shift("d1", 60)], [fix("d1", 40)], NOW).size).toBe(0);
  });

  it("ignores a driver who clocked out, even with a recent fix", () => {
    expect(liveDriverNames(users, [shift("d1", 60, true)], [fix("d1", 1)], NOW).size).toBe(0);
  });

  it("ignores a clocked-in driver who never reported", () => {
    expect(liveDriverNames(users, [shift("d1", 60)], [], NOW).size).toBe(0);
  });
});
