import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  // 1) Caller must be a signed-in admin.
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
    return NextResponse.json({ error: "Only admins can delete users." }, { status: 403 });
  }

  // 2) Validate.
  let body: { userId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const userId = (body.userId || "").trim();
  if (!userId) {
    return NextResponse.json({ error: "Missing user id." }, { status: 400 });
  }
  if (userId === user.id) {
    return NextResponse.json({ error: "You can't delete your own account." }, { status: 400 });
  }

  // 3) Delete the auth user. This cascades to their profile.
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "Server not configured: SUPABASE_SERVICE_ROLE_KEY is missing." },
      { status: 500 },
    );
  }

  try {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: "Delete failed: " + msg }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
