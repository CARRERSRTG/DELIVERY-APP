import { NextResponse } from "next/server";

// ============================================================
// Address autocomplete (real-time search suggestions).
//
// Provider is chosen automatically by which env var is present, matching
// /api/distance so suggestions and routing agree:
//   GOOGLE_MAPS_API_KEY → Google Places Autocomplete
//   MAPBOX_TOKEN        → Mapbox geocoding (autocomplete)
//   (neither)           → OpenStreetMap Nominatim search (free, no key)
//
// Returns { suggestions: string[] }. Needs internet; degrades to [] on error.
// ============================================================

export const runtime = "nodejs";

async function viaGoogle(q: string, key: string): Promise<string[]> {
  const url =
    "https://maps.googleapis.com/maps/api/place/autocomplete/json" +
    `?input=${encodeURIComponent(q)}&components=country:us&key=${key}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(data.error_message || data.status || "Google autocomplete failed");
  }
  return (data.predictions || []).map((p: { description: string }) => p.description);
}

async function viaMapbox(q: string, token: string): Promise<string[]> {
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json` +
    `?autocomplete=true&limit=5&country=us&access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json();
  return (data.features || []).map((f: { place_name: string }) => f.place_name);
}

async function viaOSM(q: string): Promise<string[]> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&countrycodes=us`;
  const res = await fetch(url, {
    headers: { "User-Agent": "RDZ-Deliveries/1.0 (internal logistics tool)" },
  });
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data.map((d: { display_name: string }) => d.display_name);
}

export async function POST(req: Request) {
  let body: { q?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ suggestions: [] });
  }
  const q = (body.q || "").trim();
  if (q.length < 3) return NextResponse.json({ suggestions: [] });

  const google = process.env.GOOGLE_MAPS_API_KEY;
  const mapbox = process.env.MAPBOX_TOKEN;

  try {
    let suggestions: string[];
    if (google) suggestions = await viaGoogle(q, google);
    else if (mapbox) suggestions = await viaMapbox(q, mapbox);
    else suggestions = await viaOSM(q);
    return NextResponse.json({ suggestions: suggestions.slice(0, 6) });
  } catch {
    // Autocomplete is best-effort — never block typing.
    return NextResponse.json({ suggestions: [] });
  }
}
