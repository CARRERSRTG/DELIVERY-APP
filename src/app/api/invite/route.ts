import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const ROLES = ["admin", "manager", "sales", "warehouse", "driver", "logistics"] as const;
type Role = (typeof ROLES)[number];

/** A readable temporary password like "Swift-Puma-4821". */
function generatePassword(): string {
  const adj = ["Swift", "Bright", "Bold", "Calm", "Sharp", "Quick", "Solid", "Prime"];
  const noun = ["Puma", "Falcon", "Cedar", "River", "Delta", "Comet", "Harbor", "Summit"];
  const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];
  return `${pick(adj)}-${pick(noun)}-${1000 + Math.floor(Math.random() * 9000)}`;
}

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
  let body: { email?: string; full_name?: string; role?: string; password?: string };
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
  const wanted = (body.password || "").trim();
  if (wanted && wanted.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });
  }
  const password = wanted || generatePassword();

  // 3) Create the account directly, pre-confirmed. No email is sent, so the
  //    user can sign in immediately with the email + password below. full_name
  //    + role travel in metadata and are applied by the handle_new_user trigger.
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "Server not configured: SUPABASE_SERVICE_ROLE_KEY is missing. Add it in Vercel and redeploy." },
      { status: 500 },
    );
  }

  try {
    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // bypass email verification — account is active at once
      user_metadata: { full_name: full_name || email.split("@")[0], role },
    });
    if (error) {
      const msg = /already been registered|already exists|duplicate/i.test(error.message)
        ? "That email already has an account."
        : error.message;
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: "Create failed: " + msg }, { status: 500 });
  }

  // Return the password so the admin can hand it to the user.
  return NextResponse.json({ ok: true, email, password });
}
