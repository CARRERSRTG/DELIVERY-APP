import { describe, it, expect } from "vitest";
import { defaultPermissions, permissionsFor, driverNames, DEFAULT_PERMISSIONS, ROLE_ORDER } from "@/lib/constants";

describe("driverNames", () => {
  const users = [
    { full_name: "Zoe Driver", role: "driver" as const },
    { full_name: "Carlos R.", role: "driver" as const },
    { full_name: "Sam Sales", role: "sales" as const },
    { full_name: "Wade Warehouse", role: "warehouse" as const },
  ];

  it("returns only users with the driver role", () => {
    expect(driverNames(users)).toEqual(["Carlos R.", "Zoe Driver"]);
  });

  it("sorts drivers alphabetically", () => {
    expect(driverNames(users)[0]).toBe("Carlos R.");
  });

  it("is empty when nobody is a driver", () => {
    expect(driverNames([{ full_name: "Sam", role: "sales" }])).toEqual([]);
  });

  it("skips blank names", () => {
    expect(driverNames([{ full_name: "", role: "driver" }])).toEqual([]);
  });
});

describe("defaultPermissions", () => {
  it("returns a non-empty list for every role", () => {
    for (const r of ROLE_ORDER) expect(defaultPermissions(r, "en").length).toBeGreaterThan(0);
  });

  it("translates to Spanish", () => {
    expect(defaultPermissions("driver", "es")).toContain("Capturar firmas");
    expect(defaultPermissions("driver", "en")).toContain("Capture signatures");
  });

  it("keeps EN and ES lists the same length for every role", () => {
    for (const r of ROLE_ORDER) {
      expect(defaultPermissions(r, "en").length).toBe(DEFAULT_PERMISSIONS[r].length);
      expect(defaultPermissions(r, "es").length).toBe(DEFAULT_PERMISSIONS[r].length);
    }
  });
});

describe("permissionsFor", () => {
  it("falls back to defaults when there are no overrides", () => {
    expect(permissionsFor("sales", "en")).toEqual(defaultPermissions("sales", "en"));
    expect(permissionsFor("sales", "en", null)).toEqual(defaultPermissions("sales", "en"));
    expect(permissionsFor("sales", "en", {})).toEqual(defaultPermissions("sales", "en"));
  });

  it("falls back when a role's override is an empty list", () => {
    expect(permissionsFor("sales", "en", { sales: [] })).toEqual(defaultPermissions("sales", "en"));
  });

  it("uses the admin's custom list when present", () => {
    const custom = ["Quote jobs", "Chase payment"];
    expect(permissionsFor("sales", "en", { sales: custom })).toEqual(custom);
  });

  it("only overrides the role it was set for", () => {
    const overrides = { sales: ["Custom only"] };
    expect(permissionsFor("sales", "en", overrides)).toEqual(["Custom only"]);
    expect(permissionsFor("driver", "en", overrides)).toEqual(defaultPermissions("driver", "en"));
  });

  it("shows a custom list verbatim regardless of language", () => {
    const custom = ["Cobrar al cliente"];
    expect(permissionsFor("sales", "en", { sales: custom })).toEqual(custom);
    expect(permissionsFor("sales", "es", { sales: custom })).toEqual(custom);
  });
});
