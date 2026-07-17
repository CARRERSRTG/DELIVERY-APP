import { NextResponse } from "next/server";

// ============================================================
// Distance + travel-time between two addresses.
//
// Provider is chosen automatically by which env var is present:
//   GOOGLE_MAPS_API_KEY → Google (live traffic)
//   MAPBOX_TOKEN        → Mapbox (live traffic)
//   (neither)           → OpenStreetMap: Nominatim geocode + OSRM route
//                         (real road miles + typical time, NO live traffic)
//
// Runs server-side so any API key stays secret. Works in local mode too,
// as long as the machine has internet access.
// ============================================================

export const runtime = "nodejs";

const METERS_PER_MILE = 1609.344;

function fmtDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

interface Result {
  miles: number;
  duration_text: string;
  duration_min: number;
  provider: string;
  traffic: boolean;
}

// ---------- Google (Distance Matrix, traffic-aware) ----------
async function viaGoogle(origin: string, destination: string, key: string): Promise<Result> {
  const url =
    "https://maps.googleapis.com/maps/api/distancematrix/json" +
    `?origins=${encodeURIComponent(origin)}` +
    `&destinations=${encodeURIComponent(destination)}` +
    `&departure_time=now&units=imperial&key=${key}`;
  const res = await fetch(url);
  const data = await res.json();
  const el = data?.rows?.[0]?.elements?.[0];
  if (data.status !== "OK" || !el || el.status !== "OK") {
    throw new Error(el?.status || data?.error_message || data?.status || "Google routing failed");
  }
  const seconds = (el.duration_in_traffic ?? el.duration).value as number;
  return {
    miles: (el.distance.value as number) / METERS_PER_MILE,
    duration_text: fmtDuration(seconds),
    duration_min: Math.round(seconds / 60),
    provider: "Google Maps",
    traffic: !!el.duration_in_traffic,
  };
}

// ---------- Mapbox (geocode + driving-traffic) ----------
async function mapboxGeocode(q: string, token: string): Promise<[number, number]> {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?limit=1&access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json();
  const c = data?.features?.[0]?.center;
  if (!c) throw new Error(`Could not find location: "${q}"`);
  return [c[0], c[1]]; // [lon, lat]
}

async function viaMapbox(origin: string, destination: string, token: string): Promise<Result> {
  const [o, d] = await Promise.all([mapboxGeocode(origin, token), mapboxGeocode(destination, token)]);
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${o[0]},${o[1]};${d[0]},${d[1]}` +
    `?overview=false&access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json();
  const route = data?.routes?.[0];
  if (!route) throw new Error(data?.message || "Mapbox routing failed");
  return {
    miles: route.distance / METERS_PER_MILE,
    duration_text: fmtDuration(route.duration),
    duration_min: Math.round(route.duration / 60),
    provider: "Mapbox",
    traffic: true,
  };
}

// ---------- OpenStreetMap (Nominatim + OSRM, no key) ----------
async function osmGeocode(q: string): Promise<[number, number]> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`;
  const res = await fetch(url, {
    headers: { "User-Agent": "RDZ-Deliveries/1.0 (internal logistics tool)" },
  });
  const data = await res.json();
  if (!Array.isArray(data) || !data[0]) throw new Error(`Could not find location: "${q}"`);
  return [parseFloat(data[0].lon), parseFloat(data[0].lat)]; // [lon, lat]
}

async function viaOSM(origin: string, destination: string): Promise<Result> {
  // Nominatim asks for <=1 req/sec, so geocode sequentially.
  const o = await osmGeocode(origin);
  const d = await osmGeocode(destination);
  const url = `https://router.project-osrm.org/route/v1/driving/${o[0]},${o[1]};${d[0]},${d[1]}?overview=false`;
  const res = await fetch(url);
  const data = await res.json();
  const route = data?.routes?.[0];
  if (!route) throw new Error(data?.message || "OSRM routing failed");
  return {
    miles: route.distance / METERS_PER_MILE,
    duration_text: fmtDuration(route.duration),
    duration_min: Math.round(route.duration / 60),
    provider: "OpenStreetMap",
    traffic: false,
  };
}

export async function POST(req: Request) {
  let body: { origin?: string; destination?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const origin = (body.origin || "").trim();
  const destination = (body.destination || "").trim();
  if (!origin || !destination) {
    return NextResponse.json({ error: "Both a pickup and a delivery address are required." }, { status: 400 });
  }

  const google = process.env.GOOGLE_MAPS_API_KEY;
  const mapbox = process.env.MAPBOX_TOKEN;

  try {
    let result: Result;
    if (google) result = await viaGoogle(origin, destination, google);
    else if (mapbox) result = await viaMapbox(origin, destination, mapbox);
    else result = await viaOSM(origin, destination);
    return NextResponse.json({
      ...result,
      miles: Math.round(result.miles * 10) / 10,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Routing failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
