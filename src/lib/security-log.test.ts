import { describe, it, expect } from "vitest";
import { change, isSensitive, securityLabel } from "./security-log";

describe("change", () => {
  it("reads as a before and after", () => {
    expect(change("driver", "logistics")).toBe("driver → logistics");
  });

  it("shows a dash rather than the word 'null'", () => {
    // A log line reading "null → RDZ Brownsville" makes the reader wonder
    // whether that is a value someone typed.
    expect(change(null, "RDZ Brownsville")).toBe("— → RDZ Brownsville");
    expect(change("RDZ Brownsville", "")).toBe("RDZ Brownsville → —");
    expect(change(undefined, undefined)).toBe("— → —");
  });

  it("spells out a list of permissions", () => {
    expect(change([], ["dashboard", "route_plan"])).toBe("— → dashboard, route_plan");
  });
});

describe("securityLabel", () => {
  it("turns a key into something a person can read", () => {
    expect(securityLabel("password_reset", "en")).toBe("Password reset");
    expect(securityLabel("password_reset", "es")).toBe("Contraseña restablecida");
  });

  it("falls back to the key rather than showing nothing", () => {
    // A kind added later must still appear in the log, not vanish from it.
    expect(securityLabel("something_new", "en")).toBe("something_new");
  });
});

describe("isSensitive", () => {
  it("marks the ones worth a second look", () => {
    for (const k of ["password_reset", "user_removed", "email_changed", "recruiting_access_changed"]) {
      expect(isSensitive(k)).toBe(true);
    }
  });

  it("leaves routine changes unmarked", () => {
    // If everything is highlighted, nothing is.
    for (const k of ["role_changed", "store_changed", "user_created"]) {
      expect(isSensitive(k)).toBe(false);
    }
  });
});
