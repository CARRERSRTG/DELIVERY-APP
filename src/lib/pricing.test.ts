import { describe, it, expect } from "vitest";
import { isLocalCity, listFee, discountFee, suggestDeliveryFee } from "@/lib/pricing";

describe("isLocalCity", () => {
  it("matches a local-zone city case-insensitively", () => {
    expect(isLocalCity("McAllen")).toBe(true);
    expect(isLocalCity("mcallen")).toBe(true);
    expect(isLocalCity("BROWNSVILLE")).toBe(true);
  });
  it("rejects a city outside the zone", () => {
    expect(isLocalCity("Laredo")).toBe(false);
    expect(isLocalCity("")).toBe(false);
  });
  it("honors an admin-overridden city list", () => {
    expect(isLocalCity("McAllen", { local_cities: ["Roma"] })).toBe(false);
    expect(isLocalCity("Roma", { local_cities: ["Roma"] })).toBe(true);
  });
});

describe("listFee (office formula, rounded to $10)", () => {
  it("is a flat $100 under 11 miles", () => {
    expect(listFee(0)).toBe(100);
    expect(listFee(10)).toBe(100);
  });
  it("uses 120 + mi*0.8 between 11 and 50 miles", () => {
    expect(listFee(11)).toBe(130); // round10(128.8)
    expect(listFee(13)).toBe(130); // round10(130.4)
    expect(listFee(27)).toBe(140); // round10(141.6)
    expect(listFee(50)).toBe(160); // round10(160)
  });
  it("uses 350 + mi over 50 miles", () => {
    expect(listFee(51)).toBe(400); // round10(401)
    expect(listFee(60)).toBe(410); // round10(410)
    expect(listFee(180)).toBe(530); // round10(530)
  });
});

describe("discountFee (office formula, rounded to $10)", () => {
  it("is a flat $80 under 11 miles", () => {
    expect(discountFee(0)).toBe(80);
    expect(discountFee(10)).toBe(80);
  });
  it("uses 100 + mi*0.8 between 11 and 50 miles", () => {
    expect(discountFee(13)).toBe(110); // round10(110.4)
    expect(discountFee(27)).toBe(120); // round10(121.6)
    expect(discountFee(50)).toBe(140); // round10(140)
  });
  it("uses 200 + mi over 50 miles", () => {
    expect(discountFee(60)).toBe(260); // round10(260)
    expect(discountFee(180)).toBe(380); // round10(380)
  });
});

describe("suggestDeliveryFee", () => {
  it("prices by miles and marks a local city as no-approval", () => {
    const s = suggestDeliveryFee({ delivery_address: "123 Main St, McAllen, TX 78501", route_miles: 13 });
    expect(s.zone).toBe("local");
    expect(s.list).toBe(130);
    expect(s.discount).toBe(110);
    expect(s.needsApproval).toBe(false);
  });
  it("uses the not-local formula (500+mi / 400+mi) and flags for approval", () => {
    const s = suggestDeliveryFee({ delivery_address: "500 Ranch Rd, Falfurrias, TX", route_miles: 60 });
    expect(s.zone).toBe("nonlocal");
    expect(s.list).toBe(560);      // round10(500 + 60)
    expect(s.discount).toBe(460);  // round10(400 + 60)
    expect(s.needsApproval).toBe(true);
  });
  it("not-local fee helpers", () => {
    expect(listFee(60, false)).toBe(560);
    expect(discountFee(60, false)).toBe(460);
  });
  it("leaves the fee null until the route miles are known", () => {
    const s = suggestDeliveryFee({ delivery_address: "1 Palm Ave, McAllen, TX", route_miles: null });
    expect(s.list).toBeNull();
    expect(s.discount).toBeNull();
  });
  it("stays 'unknown' with no delivery address", () => {
    expect(suggestDeliveryFee({ delivery_address: "", route_miles: 20 }).zone).toBe("unknown");
  });
});
