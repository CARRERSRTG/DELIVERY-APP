import type { FeeBracket, Settings } from "@/lib/types";
import { cityFromAddress } from "@/lib/utils";

// ============================================================
// Local-zone delivery pricing.
//
//   LOCAL  (delivery city is in the local list) → a flat fee: a "list" price
//          and a lower "discount" price a rep may offer. Miles are only a
//          reference the rep checks; they don't change a local fee.
//   NOT    LOCAL (anything else) → priced by driving miles through a bracket
//          table, and flagged as needing manager approval.
//
// All of this is admin-editable in Settings; the defaults below seed it and
// keep the feature working before anything is configured.
// ============================================================

/** Cities inside the LOCAL delivery zone (the red outline on the RGV map). */
export const LOCAL_CITIES_DEFAULT = [
  "La Joya", "Alton", "Edinburg", "Elsa", "Palmview",
  "Mission", "McAllen", "Pharr", "San Juan", "Alamo", "Donna",
  "Weslaco", "Mercedes", "La Feria", "Harlingen", "San Benito",
  "Rio Hondo", "Ranch Viejo", "Brownsville", "Port Isabel", "South Padre",
];

/** LOCAL flat fee — standard "list" price. */
export const LOCAL_FEE_LIST_DEFAULT = 130;
/** LOCAL flat fee — discounted price a rep may offer. */
export const LOCAL_FEE_DISCOUNT_DEFAULT = 110;

/** NOT-LOCAL fee by driving miles. Seeded from the 27-mile example ($530/$430)
 * as a single "and up" bracket; admins split it into real ranges in Settings. */
export const NONLOCAL_BRACKETS_DEFAULT: FeeBracket[] = [
  { max_miles: null, list: 530, discount: 430 },
];

export function localCities(s?: Partial<Settings> | null): string[] {
  const c = s?.local_cities;
  return c && c.length ? c : LOCAL_CITIES_DEFAULT;
}

export function nonlocalBrackets(s?: Partial<Settings> | null): FeeBracket[] {
  const b = s?.nonlocal_fee_brackets;
  return b && b.length ? b : NONLOCAL_BRACKETS_DEFAULT;
}

/** True when `city` is one of the configured local-zone cities (case-insensitive). */
export function isLocalCity(city: string, s?: Partial<Settings> | null): boolean {
  const needle = (city || "").trim().toLowerCase();
  if (!needle) return false;
  return localCities(s).some((c) => c.trim().toLowerCase() === needle);
}

export type DeliveryZone = "local" | "nonlocal" | "unknown";

export interface FeeSuggestion {
  zone: DeliveryZone;
  /** Detected delivery city (best effort), for display. */
  city: string;
  /** Suggested standard price, or null when it can't be determined yet. */
  list: number | null;
  /** Suggested discounted price a rep may offer. */
  discount: number | null;
  /** NOT-LOCAL deliveries need manager approval before the price is committed. */
  needsApproval: boolean;
}

/** Pick the fee bracket for a mile figure: the first whose max_miles ≥ miles
 * (null max = "and up"). Returns null if the table is empty. */
export function bracketForMiles(miles: number, brackets: FeeBracket[]): FeeBracket | null {
  const sorted = [...brackets].sort((a, b) => (a.max_miles ?? Infinity) - (b.max_miles ?? Infinity));
  return sorted.find((b) => b.max_miles == null || miles <= b.max_miles) ?? sorted[sorted.length - 1] ?? null;
}

/** Suggest the delivery fee for an order from its delivery city (local flat) or
 * its driving miles (not-local bracket). */
export function suggestDeliveryFee(
  d: { delivery_address?: string | null; route_miles?: number | null },
  s?: Partial<Settings> | null,
): FeeSuggestion {
  const hasAddr = !!(d.delivery_address || "").trim();
  const city = cityFromAddress(d.delivery_address, localCities(s));
  if (!hasAddr) return { zone: "unknown", city: "", list: null, discount: null, needsApproval: false };

  if (isLocalCity(city, s)) {
    return {
      zone: "local",
      city,
      list: s?.local_fee_list ?? LOCAL_FEE_LIST_DEFAULT,
      discount: s?.local_fee_discount ?? LOCAL_FEE_DISCOUNT_DEFAULT,
      needsApproval: false,
    };
  }

  const brackets = nonlocalBrackets(s);
  // With miles we look up the bracket; without them, a single "and up" bracket
  // still gives an answer, otherwise we wait for the route to be calculated.
  const picked =
    d.route_miles != null ? bracketForMiles(d.route_miles, brackets)
    : brackets.length === 1 ? brackets[0]
    : null;
  return {
    zone: "nonlocal",
    city,
    list: picked ? picked.list : null,
    discount: picked ? picked.discount : null,
    needsApproval: true,
  };
}
