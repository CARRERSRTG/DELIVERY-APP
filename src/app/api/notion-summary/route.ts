import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildDailySummary, summaryLines } from "@/lib/daily-summary";
import { createNotionPage, notionConfigured } from "@/lib/notion";
import { orderLabel, todayISO } from "@/lib/utils";
import type { Delivery, DriverShift } from "@/lib/types";

// ============================================================
// Posts the day's summary to Notion.
//
// Two ways in, and they need different proof:
//   • Vercel Cron  — sends Authorization: Bearer $CRON_SECRET
//   • A person     — must be a signed-in admin
//
// Anything else is refused. Without that, a public URL that writes to the
// company's Notion could be hit all day by anyone who guessed it.
// ============================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorized(req: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") === `Bearer ${secret}`) return true;

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return me?.role === "admin";
}

async function post(req: Request): Promise<NextResponse> {
  if (!(await authorized(req))) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  if (!notionConfigured()) return NextResponse.json({ skipped: "Notion not configured" });

  // The date to report on: today in business time, or ?date=YYYY-MM-DD to
  // re-run a day by hand.
  const asked = new URL(req.url).searchParams.get("date");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(asked ?? "") ? asked! : todayISO();

  // Service role: a cron run has no user session to read the board with.
  const admin = createAdminClient();
  const [{ data: deliveries }, { data: shifts }] = await Promise.all([
    admin.from("deliveries").select("*"),
    admin.from("driver_shifts").select("*"),
  ]);

  const summary = buildDailySummary(
    (deliveries ?? []) as Delivery[],
    (shifts ?? []) as DriverShift[],
    date,
    (d) => orderLabel(d),
  );

  const res = await createNotionPage(`Resumen ${date}`, summaryLines(summary, "es"));
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 502 });
  return NextResponse.json({ ok: true, date, url: res.url, delivered: summary.delivered, missed: summary.missed });
}

// Vercel Cron issues a GET; a person testing it will reach for POST.
export const GET = post;
export const POST = post;
