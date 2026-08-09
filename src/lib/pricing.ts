import type { Settings } from "@/lib/types";
import { cityFromAddress } from "@/lib/utils";

// ============================================================
// Delivery fee = a function of driving miles (the office's real formulas).
// Two prices per order: a standard "list" fee and a lower "discount" fee a
// rep may offer. Both round to the nearest $10.
//
//   list:      < 11 mi → $100 · > 50 mi → round10(350 + mi) · else round10(120 + mi·0.8)
//   discount:  < 11 mi →  $80 · > 50 mi → round10(200 + mi) · else round10(100 + mi·0.8)
//
// The LOCAL city list only drives the LOCAL / NOT-LOCAL badge and the "needs
// approval" flag — it does NOT change the fee, which is purely miles-based.
// ============================================================

/** Cities inside the LOCAL delivery zone (the red outline on the RGV map). */
export const LOCAL_CITIES_DEFAULT = [
  "La Joya", "Alton", "Edinburg", "Elsa", "Palmview",
  "Mission", "McAllen", "Pharr", "San Juan", "Alamo", "Donna",
  "Weslaco", "Mercedes", "La Feria", "Harlingen", "San Benito",
  "Rio Hondo", "Ranch Viejo", "Brownsville", "Port Isabel", "South Padre",
];

export function localCities(s?: Partial<Settings> | null): string[] {
  const c = s?.local_cities;
  return c && c.length ? c : LOCAL_CITIES_DEFAULT;
}

/** True when `city` is one of the configured local-zone cities (case-insensitive). */
export function isLocalCity(city: string, s?: Partial<Settings> | null): boolean {
  const needle = (city || "").trim().toLowerCase();
  if (!needle) return false;
  return localCities(s).some((c) => c.trim().toLowerCase() === needle);
}

/** Round to the nearest $10 (Excel ROUND(x, -1) for non-negative amounts). */
const round10 = (x: number) => Math.round(x / 10) * 10;

/** Standard "list" delivery fee for a mile figure. */
export function listFee(miles: number): number {
  if (miles < 11) return 100;
  if (miles > 50) return round10(350 + miles);
  return round10(120 + miles * 0.8);
}

/** Discounted delivery fee a rep may offer for a mile figure. */
export function discountFee(miles: number): number {
  if (miles < 11) return 80;
  if (miles > 50) return round10(200 + miles);
  return round10(100 + miles * 0.8);
}

export type DeliveryZone = "local" | "nonlocal" | "unknown";

export interface FeeSuggestion {
  zone: DeliveryZone;
  /** Detected delivery city (best effort), for display. */
  city: string;
  /** Suggested standard price, or null until the route miles are known. */
  list: number | null;
  /** Suggested discounted price a rep may offer. */
  discount: number | null;
  /** NOT-LOCAL deliveries need manager approval before the price is committed. */
  needsApproval: boolean;
}

/** Suggest the delivery fee for an order from its driving miles (the formulas
 * above). The delivery city only sets the zone badge + approval flag. */
export function suggestDeliveryFee(
  d: { delivery_address?: string | null; route_miles?: number | null },
  s?: Partial<Settings> | null,
): FeeSuggestion {
  const hasAddr = !!(d.delivery_address || "").trim();
  const city = cityFromAddress(d.delivery_address, localCities(s));
  if (!hasAddr) return { zone: "unknown", city: "", list: null, discount: null, needsApproval: false };

  const local = isLocalCity(city, s);
  const miles = d.route_miles;
  return {
    zone: local ? "local" : "nonlocal",
    city,
    list: miles != null ? listFee(miles) : null,
    discount: miles != null ? discountFee(miles) : null,
    needsApproval: !local,
  };
}
