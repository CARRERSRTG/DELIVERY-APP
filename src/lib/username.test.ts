import { describe, it, expect } from "vitest";
import { emailForUsername, isSyntheticEmail, isValidUsername, loginEmail, normalizeUsername } from "./username";

describe("normalizeUsername", () => {
  it("folds case so one person can't become two", () => {
    expect(normalizeUsername("Maximo")).toBe("maximo");
    expect(normalizeUsername("  MAXIMO  ")).toBe("maximo");
  });
});

describe("isValidUsername", () => {
  it("accepts what a person would actually pick", () => {
    for (const u of ["maximo", "maximo.garza", "m_garza", "driver-2", "abc"]) {
      expect(isValidUsername(u)).toBe(true);
    }
  });

  it("rejects anything that would break the address it becomes", () => {
    // These produce an account that looks fine and cannot sign in.
    for (const u of ["ma ximo", "maximo@rdz", "maximo!", "café", "a/b"]) {
      expect(isValidUsername(u)).toBe(false);
    }
  });

  it("rejects too short, too long, and empty", () => {
    expect(isValidUsername("ab")).toBe(false);
    expect(isValidUsername("a".repeat(31))).toBe(false);
    expect(isValidUsername("")).toBe(false);
    expect(isValidUsername(null)).toBe(false);
  });

  it("rejects a name starting with punctuation", () => {
    expect(isValidUsername(".maximo")).toBe(false);
    expect(isValidUsername("-maximo")).toBe(false);
  });
});

describe("loginEmail", () => {
  it("passes a real address through untouched", () => {
    // Rewriting someone's real email would lock them out of their own account.
    expect(loginEmail("careers@rdztilegroup.net")).toBe("careers@rdztilegroup.net");
    expect(loginEmail("  Careers@RDZTileGroup.net ")).toBe("careers@rdztilegroup.net");
  });

  it("turns a username into its derived address", () => {
    expect(loginEmail("maximo")).toBe(emailForUsername("maximo"));
    expect(loginEmail("MAXIMO")).toBe(emailForUsername("maximo"));
  });

  it("derives, never looks up — the same input always gives the same address", () => {
    // This is why there's no "does this username exist?" endpoint to probe.
    expect(loginEmail("maximo")).toBe(loginEmail("maximo"));
  });
});

describe("isSyntheticEmail", () => {
  it("knows an invented address from a real one", () => {
    expect(isSyntheticEmail(emailForUsername("maximo"))).toBe(true);
    expect(isSyntheticEmail("careers@rdztilegroup.net")).toBe(false);
    expect(isSyntheticEmail(null)).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isSyntheticEmail("MAXIMO@USERS.RDZTILEGROUP.NET")).toBe(true);
  });
});
