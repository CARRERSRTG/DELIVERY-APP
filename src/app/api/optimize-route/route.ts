import { NextResponse } from "next/server";

// ============================================================
// Best visiting order for a driver's stops on a given day.
//
// Free OSRM "trip" service (no API key, same public server the OSM
// fallback in /api/distance uses) — solves the actual routing problem
// (shortest total driving distance/time), not just straight-line sorting.
// The public server only implements the trip solver with at least one
// endpoint fixed, so the route starts at the first stop given (the caller
// sorts stops so that's the earliest delivery window) and OSRM freely
// picks the best point to end at among the rest.
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

interface Stop { id: string; lat: number; lng: number }

export async function POST(req: Request) {
  let body: { stops?: Stop[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const stops = (body.stops ?? []).filter(
    (s): s is Stop => typeof s?.id === "string" && Number.isFinite(s?.lat) && Number.isFinite(s?.lng),
  );

  if (stops.length === 0) return NextResponse.json({ order: [], miles: 0, duration_text: "", geometry: [] });
  if (stops.length === 1) return NextResponse.json({ order: [stops[0].id], miles: 0, duration_text: "", geometry: [] });

  const coords = stops.map((s) => `${s.lng},${s.lat}`).join(";");
  const url =
    `https://router.project-osrm.org/trip/v1/driving/${coords}` +
    "?overview=full&geometries=geojson&roundtrip=false&source=first&destination=any";

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.code !== "Ok" || !data.trips?.[0] || !Array.isArray(data.waypoints)) {
      throw new Error(data.message || "Route optimization failed");
    }
    const order = stops
      .map((s, i) => ({ id: s.id, seq: data.waypoints[i].waypoint_index as number }))
      .sort((a, b) => a.seq - b.seq)
      .map((w) => w.id);
    const trip = data.trips[0];
    return NextResponse.json({
      order,
      miles: Math.round((trip.distance / METERS_PER_MILE) * 10) / 10,
      duration_text: fmtDuration(trip.duration),
      // The actual road-following path, as [lng, lat] pairs — traced on the
      // Routes map so a driver's line matches real streets, not straight
      // lines between stops.
      geometry: (trip.geometry?.coordinates ?? []) as [number, number][],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Route optimization failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
