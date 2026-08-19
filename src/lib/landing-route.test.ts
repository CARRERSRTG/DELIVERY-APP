import { describe, it, expect } from "vitest";
import { accessibleModules, landingRoute } from "@/lib/constants";

describe("landingRoute", () => {
  it("sends a driver to /driver, even with recruiting access", () => {
    expect(landingRoute({ role: "driver" })).toBe("/driver");
    expect(landingRoute({ role: "driver", module_access: ["recruiting"] })).toBe("/driver");
  });

  it("sends someone with 2+ modules to the selector", () => {
    expect(landingRoute({ role: "admin", module_access: ["recruiting"] })).toBe("/home");
    expect(landingRoute({ role: "sales", module_access: ["recruiting"] })).toBe("/home");
  });

  it("falls back to roleHome for everyone else — no module_access", () => {
    expect(landingRoute({ role: "admin" })).toBe("/");
    expect(landingRoute({ role: "manager" })).toBe("/");
    expect(landingRoute({ role: "sales" })).toBe("/");
    expect(landingRoute({ role: "warehouse" })).toBe("/warehouse");
    expect(landingRoute({ role: "logistics" })).toBe("/routes");
  });

  it("falls back to roleHome when module_access is present but empty", () => {
    expect(landingRoute({ role: "sales", module_access: [] })).toBe("/");
    expect(landingRoute({ role: "warehouse", module_access: null })).toBe("/warehouse");
  });
});

// D-054: the single source both HomeSelector and ModuleSwitcher read from.
describe("accessibleModules", () => {
  it("is just deliveries with no module_access", () => {
    expect(accessibleModules(null).map((m) => m.key)).toEqual(["deliveries"]);
    expect(accessibleModules(undefined).map((m) => m.key)).toEqual(["deliveries"]);
    expect(accessibleModules([]).map((m) => m.key)).toEqual(["deliveries"]);
  });

  it("adds recruiting when granted — deliveries always first", () => {
    expect(accessibleModules(["recruiting"]).map((m) => m.key)).toEqual(["deliveries", "recruiting"]);
  });

  it("ignores a module_access entry with no matching MODULES entry", () => {
    // A stale or typo'd value shouldn't crash the switcher into showing a
    // card for a module that doesn't exist.
    expect(accessibleModules(["not-a-real-module"]).map((m) => m.key)).toEqual(["deliveries"]);
  });
});
