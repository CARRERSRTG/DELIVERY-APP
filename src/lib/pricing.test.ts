import { describe, it, expect } from "vitest";
import { isLocalCity, bracketForMiles, suggestDeliveryFee, NONLOCAL_BRACKETS_DEFAULT } from "@/lib/pricing";
import type { FeeBracket } from "@/lib/types";

describe("isLocalCity", () => {
  it("matches a local-zone city case-insensitively", () => {
    expect(isLocalCity("McAllen")).toBe(true);
    expect(isLocalCity("mcallen")).toBe(true);
    expect(isLocalCity("BROWNSVILLE")).toBe(true);
  });
  it("rejects a city outside the zone", () => {
    expect(isLocalCity("Laredo")).toBe(false);
    expect(isLocalCity("Corpus Christi")).toBe(false);
    expect(isLocalCity("")).toBe(false);
  });
  it("honors an admin-overridden city list", () => {
    expect(isLocalCity("McAllen", { local_cities: ["Roma"] })).toBe(false);
    expect(isLocalCity("Roma", { local_cities: ["Roma"] })).toBe(true);
  });
});

describe("bracketForMiles", () => {
  const table: FeeBracket[] = [
    { max_miles: 15, list: 130, discount: 110 },
    { max_miles: 30, list: 530, discount: 430 },
    { max_miles: null, list: 800, discount: 700 },
  ];
  it("picks the first bracket whose ceiling covers the miles", () => {
    expect(bracketForMiles(10, table)?.list).toBe(130);
    expect(bracketForMiles(15, table)?.list).toBe(130);
    expect(bracketForMiles(27, table)?.list).toBe(530);
  });
  it("falls to the open-ended bracket beyond the table", () => {
    expect(bracketForMiles(200, table)?.list).toBe(800);
  });
});

describe("suggestDeliveryFee", () => {
  it("gives the LOCAL flat fee for a local city, no approval", () => {
    const s = suggestDeliveryFee({ delivery_address: "123 Main St, McAllen, TX 78501", route_miles: 8 });
    expect(s.zone).toBe("local");
    expect(s.list).toBe(130);
    expect(s.discount).toBe(110);
    expect(s.needsApproval).toBe(false);
  });

  it("prices a not-local delivery by miles and flags approval", () => {
    const s = suggestDeliveryFee({ delivery_address: "500 Ranch Rd, Falfurrias, TX", route_miles: 27 });
    expect(s.zone).toBe("nonlocal");
    expect(s.list).toBe(NONLOCAL_BRACKETS_DEFAULT[0].list); // 530 (single "and up" seed)
    expect(s.discount).toBe(NONLOCAL_BRACKETS_DEFAULT[0].discount); // 430
    expect(s.needsApproval).toBe(true);
  });

  it("uses the admin overrides when set", () => {
    const s = suggestDeliveryFee(
      { delivery_address: "1 Palm Ave, McAllen, TX", route_miles: 5 },
      { local_fee_list: 99, local_fee_discount: 80 },
    );
    expect(s.list).toBe(99);
    expect(s.discount).toBe(80);
  });

  it("stays 'unknown' with no delivery address", () => {
    expect(suggestDeliveryFee({ delivery_address: "", route_miles: null }).zone).toBe("unknown");
  });
});
