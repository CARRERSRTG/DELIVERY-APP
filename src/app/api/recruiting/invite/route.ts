import { NextResponse } from "next/server";
import { createClient } from "@/lib/recruiting/supabase/server";
import { createAdminClient } from "@/lib/recruiting/supabase/admin";

const ROLES = ["admin", "manager", "recruiter"] as const;
type Role = (typeof ROLES)[number];

export async function POST(req: Request) {
  // 1) Who is calling? Must be signed in AND a recruiting admin — checked via
  //    recruiting_role, not the deliveries `role` column on the same shared
  //    profiles table (see D-050/D-052; this is the same bug class as
  //    updateUserRole in recruiting-data-provider.tsx).
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const { data: me } = await supabase
    .schema("public")
    .from("profiles")
    .select("recruiting_role")
    .eq("id", user.id)
    .maybeSingle();
  if (me?.recruiting_role !== "admin") {
    return NextResponse.json({ error: "Only recruiting admins can add users." }, { status: 403 });
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
  const role: Role = ROLES.includes(body.role as Role) ? (body.role as Role) : "recruiter";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  // 3) Send the invite. Supabase emails the user a confirmation link; they set
  //    their password on that page. `recruiting_role` (NOT `role`) travels in
  //    user metadata — the shared handle_new_user() trigger reads that key
  //    specifically for recruiting access, defaulting the deliveries `role`
  //    column to 'sales' since this invite never sets it. A brand-new person
  //    invited here gets minimal deliveries access + recruiting access, which
  //    is the intended default (see D-050's fused handle_new_user()).
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "Server not configured: SUPABASE_SERVICE_ROLE_KEY is missing. Add it in Vercel and redeploy." },
      { status: 500 },
    );
  }

  const origin = new URL(req.url).origin;
  try {
    const { error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: full_name || email.split("@")[0], recruiting_role: role },
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
