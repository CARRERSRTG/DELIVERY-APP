import { describe, it, expect } from "vitest";
import { accessibleModules, HUB_TOOLS, landingRoute, MODULE_ACCESS } from "@/lib/constants";

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

  it("adds timetracker when granted (D-064)", () => {
    expect(accessibleModules(["timetracker"]).map((m) => m.key)).toEqual(["deliveries", "timetracker"]);
  });

  it("adds both when granted, in MODULES declaration order", () => {
    expect(accessibleModules(["recruiting", "timetracker"]).map((m) => m.key)).toEqual(["deliveries", "recruiting", "timetracker"]);
  });

  it("ignores a module_access entry with no matching MODULES entry", () => {
    // A stale or typo'd value shouldn't crash the switcher into showing a
    // card for a module that doesn't exist.
    expect(accessibleModules(["not-a-real-module"]).map((m) => m.key)).toEqual(["deliveries"]);
  });
});

// D-056: Users is the first hub tool — granted by ROLE, not module_access.
describe("HUB_TOOLS", () => {
  it("users is visible only to a deliveries admin", () => {
    const users = HUB_TOOLS.find((t) => t.key === "users")!;
    expect(users.visible({ role: "admin" })).toBe(true);
    for (const role of ["manager", "sales", "warehouse", "driver", "logistics", "accounting"] as const) {
      expect(users.visible({ role })).toBe(false);
    }
  });
});

// D-057: the structural defense against the D-052/D-053 class of bug — two
// modules writing to the same profiles column. If this ever fails, someone
// added a module whose role lives on a column another module already owns.
describe("MODULE_ACCESS", () => {
  it("no two modules write their role to the same column", () => {
    const columns = MODULE_ACCESS.map((m) => m.roleColumn);
    expect(new Set(columns).size).toBe(columns.length);
  });

  it("deliveries is always-on; recruiting and timetracker are not", () => {
    const deliveries = MODULE_ACCESS.find((m) => m.key === "deliveries")!;
    const recruiting = MODULE_ACCESS.find((m) => m.key === "recruiting")!;
    const timetracker = MODULE_ACCESS.find((m) => m.key === "timetracker")!;
    expect(deliveries.alwaysOn).toBe(true);
    expect(recruiting.alwaysOn).toBe(false);
    expect(timetracker.alwaysOn).toBe(false);
  });

  it("only deliveries carries fine-grained capabilities", () => {
    const deliveries = MODULE_ACCESS.find((m) => m.key === "deliveries")!;
    const recruiting = MODULE_ACCESS.find((m) => m.key === "recruiting")!;
    const timetracker = MODULE_ACCESS.find((m) => m.key === "timetracker")!;
    expect(deliveries.capabilities?.length).toBeGreaterThan(0);
    expect(recruiting.capabilities).toBeUndefined();
    expect(timetracker.capabilities).toBeUndefined();
  });
});
