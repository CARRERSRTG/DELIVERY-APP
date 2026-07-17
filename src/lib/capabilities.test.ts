import { describe, it, expect } from "vitest";
import {
  hasCap, extraCaps, canApprove, canCreate, canFulfill, canDeliver,
  ROLE_CAPS, CAPABILITIES, ROLE_ORDER,
} from "@/lib/constants";

describe("role defaults", () => {
  it("gives admin every capability", () => {
    for (const c of CAPABILITIES) expect(hasCap({ role: "admin" }, c.key)).toBe(true);
  });

  it("keeps the default role matrix intact", () => {
    expect(canApprove({ role: "manager" })).toBe(true);
    expect(canApprove({ role: "sales" })).toBe(false);
    expect(canCreate({ role: "sales" })).toBe(true);
    expect(canCreate({ role: "warehouse" })).toBe(false);
    expect(canFulfill({ role: "warehouse" })).toBe(true);
    expect(canFulfill({ role: "driver" })).toBe(false);
    expect(canDeliver({ role: "driver" })).toBe(true);
    expect(canDeliver({ role: "manager" })).toBe(false);
  });

  it("only references known capability keys", () => {
    const known = new Set(CAPABILITIES.map((c) => c.key));
    for (const r of ROLE_ORDER) for (const c of ROLE_CAPS[r]) expect(known.has(c)).toBe(true);
  });
});

describe("per-user grants", () => {
  it("lets an admin grant approve to a salesperson", () => {
    const sam = { role: "sales" as const, permissions: ["approve"] };
    expect(canApprove(sam)).toBe(true);
    expect(canCreate(sam)).toBe(true); // still has their role's own caps
  });

  it("does not leak a grant to other users of the same role", () => {
    expect(canApprove({ role: "sales", permissions: ["approve"] })).toBe(true);
    expect(canApprove({ role: "sales" })).toBe(false);
  });

  it("grants never remove what the role already allows", () => {
    // Even with an unrelated grant, the role's own caps survive.
    expect(canFulfill({ role: "warehouse", permissions: ["dashboard"] })).toBe(true);
  });

  it("handles null/empty permissions safely", () => {
    expect(canApprove({ role: "sales", permissions: null })).toBe(false);
    expect(canApprove({ role: "sales", permissions: [] })).toBe(false);
  });

  it("ignores unknown permission strings", () => {
    expect(hasCap({ role: "sales", permissions: ["not-a-real-cap"] }, "approve")).toBe(false);
  });

  it("returns false for a missing user", () => {
    expect(hasCap(null, "approve")).toBe(false);
    expect(hasCap(undefined, "approve")).toBe(false);
  });
});

describe("extraCaps", () => {
  it("lists only what was granted beyond the role", () => {
    expect(extraCaps({ role: "sales", permissions: ["approve", "create"] })).toEqual(["approve"]);
  });

  it("is empty when a grant only duplicates the role", () => {
    expect(extraCaps({ role: "sales", permissions: ["create"] })).toEqual([]);
  });

  it("is empty for an admin, who already has everything", () => {
    expect(extraCaps({ role: "admin", permissions: ["approve"] })).toEqual([]);
  });

  it("is empty when nothing is granted", () => {
    expect(extraCaps({ role: "driver" })).toEqual([]);
  });
});
