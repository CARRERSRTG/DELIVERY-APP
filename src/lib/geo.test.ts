import { describe, it, expect } from "vitest";
import { distanceMeters, mapLink } from "@/lib/geo";

describe("distanceMeters", () => {
  it("is zero for the same point", () => {
    const p = { lat: 26.2034, lng: -98.2300 };
    expect(distanceMeters(p, p)).toBe(0);
  });

  it("measures a short hop with sane accuracy", () => {
    // ~0.001° of latitude ≈ 111 m
    const a = { lat: 26.2034, lng: -98.23 };
    const b = { lat: 26.2044, lng: -98.23 };
    const d = distanceMeters(a, b);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(125);
  });

  it("is symmetric", () => {
    const a = { lat: 26.2034, lng: -98.23 };
    const b = { lat: 26.3017, lng: -98.1633 };
    expect(distanceMeters(a, b)).toBe(distanceMeters(b, a));
  });

  it("measures McAllen → Edinburg in the right ballpark (~13 km)", () => {
    const mcallen = { lat: 26.2034, lng: -98.23 };
    const edinburg = { lat: 26.3017, lng: -98.1633 };
    const km = distanceMeters(mcallen, edinburg) / 1000;
    expect(km).toBeGreaterThan(10);
    expect(km).toBeLessThan(16);
  });
});

describe("mapLink", () => {
  it("builds a Google Maps query link for the point", () => {
    expect(mapLink(26.2034, -98.23)).toBe("https://www.google.com/maps/search/?api=1&query=26.2034,-98.23");
  });
});
