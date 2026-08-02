import { NextResponse } from "next/server";

// ============================================================
// Live places lookup for the Market Map — queries OpenStreetMap in real time
// (Overpass API, free, no key) for businesses in the Rio Grande Valley across
// Hidalgo + Cameron counties. Categories map to the three "questions" on the
// map: flooring companies, big-box secondary sellers, and hardware / building-
// supply partnership prospects.
//
// Coverage is community-mapped, so it reflects whatever is tagged in OSM today
// (which grows over time) rather than a hand-curated directory.
// ============================================================

export const runtime = "nodejs";

// Bounding box (south, west, north, east) covering Hidalgo + Cameron counties.
const BBOX = "25.83,-98.62,26.66,-97.10";

// Overpass union clauses per category. Flooring also matches by NAME (floor/
// tile/carpet), since RGV flooring shops are rarely tagged shop=flooring in OSM.
const CATEGORY_QUERY: Record<string, (bbox: string) => string> = {
  // Shop-tag queries stay fast. RGV flooring shops are sparsely tagged in OSM,
  // so this layer is thin until Google Places (a key) is wired — see route note.
  flooring: (b) => `nwr["shop"~"^(flooring|carpet|tiles|doors|interior_decoration)$"](${b});`,
  bigbox: (b) => `nwr["shop"="doityourself"](${b});`,
  hardware: (b) => `nwr["shop"~"^(hardware|trade|building_materials|paint)$"](${b});`,
};

interface Place {
  id: string;
  name: string;
  lat: number;
  lng: number;
  shop: string | null;
  brand: string | null;
  city: string | null;
  phone: string | null;
}

// ---- Google Places (New) — used when GOOGLE_MAPS_API_KEY is set. Far better
// RGV coverage than OSM for flooring businesses. ----
const GOOGLE_QUERIES: Record<string, string[]> = {
  flooring: ["flooring store", "tile store", "carpet store"],
  bigbox: ["home improvement store"],
  hardware: ["hardware store", "building materials supplier"],
};
// Search anchors across the two counties (McAllen, Harlingen, Brownsville).
const CENTERS: [number, number][] = [[26.20, -98.23], [26.19, -97.70], [25.90, -97.50]];

function cityFromGoogle(addr: string | undefined): string | null {
  const m = (addr ?? "").match(/,\s*([^,]+),\s*TX/);
  return m ? m[1].trim() : null;
}

async function viaGoogle(key: string, category: string): Promise<Place[]> {
  const queries = GOOGLE_QUERIES[category] ?? [];
  const byId = new Map<string, Place>();
  for (const textQuery of queries) {
    for (const [lat, lng] of CENTERS) {
      try {
        const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": key,
            "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.formattedAddress,places.nationalPhoneNumber,places.rating",
          },
          body: JSON.stringify({
            textQuery,
            maxResultCount: 20,
            locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 35000 } },
          }),
        });
        if (!res.ok) continue;
        const data = await res.json();
        for (const p of (data.places ?? []) as Record<string, unknown>[]) {
          const loc = p.location as { latitude?: number; longitude?: number } | undefined;
          if (typeof loc?.latitude !== "number" || typeof loc?.longitude !== "number") continue;
          const id = String(p.id);
          byId.set(id, {
            id,
            name: (p.displayName as { text?: string } | undefined)?.text ?? "(unnamed)",
            lat: loc.latitude,
            lng: loc.longitude,
            shop: null,
            brand: null,
            city: cityFromGoogle(p.formattedAddress as string | undefined),
            phone: (p.nationalPhoneNumber as string | undefined) ?? null,
          });
        }
      } catch { /* skip this query/center */ }
    }
  }
  return [...byId.values()];
}

export async function GET(req: Request) {
  const category = new URL(req.url).searchParams.get("category") ?? "flooring";
  const build = CATEGORY_QUERY[category];
  if (!build) return NextResponse.json({ error: "Unknown category" }, { status: 400 });

  // Prefer Google Places (rich RGV coverage) when a key is configured.
  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  if (googleKey) {
    const places = await viaGoogle(googleKey, category);
    return NextResponse.json({ places, count: places.length, source: "google" });
  }

  const q = `[out:json][timeout:25];(${build(BBOX)});out center tags;`;

  // Overpass rejects requests without a real User-Agent; a couple of mirrors in
  // case one is busy.
  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];
  try {
    let res: Response | null = null;
    for (const url of endpoints) {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "RDZ-Deliveries/1.0 (market map; internal tool)",
          Accept: "application/json",
        },
        body: "data=" + encodeURIComponent(q),
      });
      if (res.ok) break;
    }
    if (!res || !res.ok) return NextResponse.json({ error: `Overpass ${res?.status ?? "unreachable"}` }, { status: 502 });
    const data = await res.json();
    const places: Place[] = ((data.elements ?? []) as Record<string, unknown>[])
      .map((el) => {
        const tags = (el.tags ?? {}) as Record<string, string>;
        const lat = (el.lat as number) ?? (el.center as { lat: number } | undefined)?.lat;
        const lng = (el.lon as number) ?? (el.center as { lon: number } | undefined)?.lon;
        if (typeof lat !== "number" || typeof lng !== "number") return null;
        return {
          id: `${el.type}/${el.id}`,
          name: tags.name || tags.brand || "(unnamed)",
          lat,
          lng,
          shop: tags.shop ?? null,
          brand: tags.brand ?? null,
          city: tags["addr:city"] ?? null,
          phone: tags.phone ?? tags["contact:phone"] ?? null,
        } as Place;
      })
      .filter((p): p is Place => p !== null && p.name !== "(unnamed)");

    return NextResponse.json({ places, count: places.length, source: "osm" });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
