import { NextResponse } from "next/server";
import { APP_VERSION } from "@/lib/constants";
import { LATEST_APK_VERSION_CODE } from "@/lib/app-update";

// ============================================================
// What the newest deploy is — asked by pages that are already running.
//
// A phone left open in a truck cradle holds the JavaScript it downloaded that
// morning. Every fix shipped since then is on the server and none of it is on
// that phone, and nothing in the browser tells the page it has gone stale.
// This is the one thing a stale page can ask.
//
// Served fresh on purpose: a cached answer here would defeat the entire point.
// ============================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET() {
  return NextResponse.json(
    { web: APP_VERSION, apk: LATEST_APK_VERSION_CODE },
    { headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } },
  );
}
