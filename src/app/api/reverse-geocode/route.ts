import { NextResponse } from "next/server";

// ============================================================
// Resolve { lat, lng } -> a human-readable address — used right after
// dropping a manual pin on the map, so the Delivery Address field fills in
// automatically instead of staying blank. Same provider fallback as the
// other geocoding routes:
//   GOOGLE_MAPS_API_KEY → Google reverse geocoding
//   MAPBOX_TOKEN        → Mapbox reverse geocoding
//   (neither)           → OpenStreetMap Nominatim (free, no key)
// Returns { address: string } | { error }. Needs internet.
// ============================================================

export const runtime = "nodejs";

async function viaGoogle(lat: number, lng: number, key: string): Promise<string | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${key}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.results?.[0]?.formatted_address ?? null;
}

async function viaMapbox(lat: number, lng: number, token: string): Promise<string | null> {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?limit=1&access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.features?.[0]?.place_name ?? null;
}

async function viaOSM(lat: number, lng: number): Promise<string | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
  const res = await fetch(url, {
    headers: { "User-Agent": "RDZ-Deliveries/1.0 (internal logistics tool)" },
  });
  const data = await res.json();
  return data.display_name ?? null;
}

export async function POST(req: Request) {
  let body: { lat?: number; lng?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const { lat, lng } = body;
  if (typeof lat !== "number" || typeof lng !== "number") {
    return NextResponse.json({ error: "lat/lng required" }, { status: 400 });
  }

  const google = process.env.GOOGLE_MAPS_API_KEY;
  const mapbox = process.env.MAPBOX_TOKEN;

  try {
    const address = google ? await viaGoogle(lat, lng, google)
      : mapbox ? await viaMapbox(lat, lng, mapbox)
      : await viaOSM(lat, lng);
    if (!address) return NextResponse.json({ error: "No address found" }, { status: 404 });
    return NextResponse.json({ address });
  } catch {
    return NextResponse.json({ error: "Reverse geocoding failed" }, { status: 502 });
  }
}
