import { describe, expect, it } from "vitest";
import { fmtDateShort, storeTag } from "./utils";

// The three short labels that share one line on a driver's phone. They exist
// to fit, so the tests are mostly about not growing and not going blank.

describe("storeTag", () => {
  it("uses the branch codes the team already says out loud", () => {
    expect(storeTag("RDZ Brownsville")).toBe("BRO");
    expect(storeTag("RDZ McAllen")).toBe("MCA");
    expect(storeTag("RDZ Pharr")).toBe("PHR");
    expect(storeTag("RDZ Edinburg")).toBe("EDG");
  });

  it("falls back to the last word for a branch added later", () => {
    expect(storeTag("RDZ Laredo")).toBe("LAR");
  });

  it("returns empty for no store", () => {
    expect(storeTag(null)).toBe("");
    expect(storeTag("")).toBe("");
  });
});

describe("fmtDateShort", () => {
  it("drops the year — the list only holds days around today", () => {
    expect(fmtDateShort("2026-08-13", "en")).toBe("Aug 13");
  });

  it("localises the month", () => {
    // es-MX renders "13 ago"; the exact order is the locale's business, so
    // assert on the parts rather than a fixed string.
    const out = fmtDateShort("2026-08-13", "es");
    expect(out).toContain("13");
    expect(out.toLowerCase()).toContain("ago");
  });

  it("reads a date-only value as that calendar day, not the day before", () => {
    // Parsed at noon so a timezone shift can't roll it back — the classic
    // off-by-one that makes a delivery look a day early.
    expect(fmtDateShort("2026-01-01", "en")).toBe("Jan 1");
    expect(fmtDateShort("2026-12-31", "en")).toBe("Dec 31");
  });

  it("returns empty for a missing or unparseable date", () => {
    expect(fmtDateShort(null)).toBe("");
    expect(fmtDateShort(undefined)).toBe("");
    expect(fmtDateShort("not-a-date")).toBe("");
  });
});
