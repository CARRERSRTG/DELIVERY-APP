import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const ROLES = ["admin", "manager", "sales", "warehouse", "driver", "logistics"] as const;
type Role = (typeof ROLES)[number];

export async function POST(req: Request) {
  // 1) Who is calling? Must be a signed-in admin.
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "Only admins can add users." }, { status: 403 });
  }

  // 2) Validate input.
  let body: { email?: string; full_name?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const email = (body.email || "").trim().toLowerCase();
  const full_name = (body.full_name || "").trim();
  const role: Role = ROLES.includes(body.role as Role) ? (body.role as Role) : "sales";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  // 3) Send the invite. Supabase emails the user a link where they set their
  //    password. full_name + role travel in user metadata and are applied by
  //    the handle_new_user trigger when the account is created.
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "Server not configured: SUPABASE_SERVICE_ROLE_KEY is missing. Add it in Vercel and redeploy." },
      { status: 500 },
    );
  }

  // The emailed link must point at the real deployment, never localhost.
  // Priority: explicit NEXT_PUBLIC_SITE_URL → the proxy-forwarded host
  // (what the admin's browser actually hit) → the raw request URL.
  const fwdHost = req.headers.get("x-forwarded-host");
  const fwdProto = req.headers.get("x-forwarded-proto") ?? "https";
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    (fwdHost ? `${fwdProto}://${fwdHost}` : new URL(req.url).origin);
  try {
    const { error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: full_name || email.split("@")[0], role },
      redirectTo: `${origin}/auth/callback`,
    });
    if (error) {
      const msg = /already been registered|already exists/i.test(error.message)
        ? "That email already has an account."
        : error.message;
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: "Invite failed: " + msg }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
