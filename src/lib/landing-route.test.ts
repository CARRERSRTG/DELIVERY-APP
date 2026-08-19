import { describe, it, expect } from "vitest";
import { landingRoute } from "@/lib/constants";

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
