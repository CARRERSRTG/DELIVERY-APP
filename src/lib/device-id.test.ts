import { describe, it, expect } from "vitest";
import { isShiftDevice } from "./device-id";

describe("isShiftDevice", () => {
  it("lets the phone that clocked in report", () => {
    expect(isShiftDevice("abc", "abc")).toBe(true);
  });

  it("keeps a second device signed into the same account quiet", () => {
    // The case this exists for: the office logs into a driver's account to
    // check something and starts reporting its own position, mixing two
    // places into one day's track.
    expect(isShiftDevice("abc", "xyz")).toBe(false);
  });

  it("tracks permissively when the shift predates device binding", () => {
    // A shift already in progress must not go dark because a column was added
    // underneath it.
    expect(isShiftDevice(null, "abc")).toBe(true);
    expect(isShiftDevice(undefined, "abc")).toBe(true);
    expect(isShiftDevice("", "abc")).toBe(true);
  });

  it("tracks permissively when this device can't identify itself", () => {
    // Private mode or storage disabled. Silently going dark on a real driver
    // mid-route is worse than the double-reporting this prevents.
    expect(isShiftDevice("abc", null)).toBe(true);
  });
});
