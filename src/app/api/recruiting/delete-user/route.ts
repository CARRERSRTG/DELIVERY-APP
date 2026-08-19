import { NextResponse } from "next/server";
import { createClient } from "@/lib/recruiting/supabase/server";
import { createAdminClient } from "@/lib/recruiting/supabase/admin";

// Ported from recruiting-app's /api/delete-user with a deliberate behavior
// change, not just a schema fix: the original called
// admin.auth.admin.deleteUser(userId), which deletes the AUTH USER — fine
// when recruiting was someone's only account, but that same auth user is now
// deliveries' shared identity too (D-050). Deleting it from here would take
// someone's deliveries login down with it. This now REVOKES recruiting
// access only (recruiting_role -> null, 'recruiting' removed from
// module_access) and leaves the account itself untouched.
export async function POST(req: Request) {
  // 1) Caller must be signed in AND a recruiting admin (recruiting_role, not
  //    the shared `role` column — same bug class as updateUserRole).
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
    return NextResponse.json({ error: "Only recruiting admins can remove users." }, { status: 403 });
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
    return NextResponse.json({ error: "You can't remove your own recruiting access." }, { status: 400 });
  }

  // 3) Revoke recruiting access via the service-role client — the
  //    guard_recruiting_access_change trigger requires a DELIVERIES admin to
  //    change recruiting_role/module_access for anyone else; the service role
  //    runs with auth.uid() null, which the trigger already treats as
  //    trusted (same path the SQL editor / service calls always use). The
  //    protect_last_recruiting_admin trigger still applies underneath this
  //    and blocks removing the last recruiting admin, surfaced below.
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
    const { data: target } = await admin.schema("public").from("profiles").select("module_access").eq("id", userId).maybeSingle();
    const nextModules = (target?.module_access ?? []).filter((m: string) => m !== "recruiting");
    const { error } = await admin
      .schema("public")
      .from("profiles")
      .update({ recruiting_role: null, module_access: nextModules })
      .eq("id", userId);
    if (error) {
      const msg = /at least one.*admin|last.*admin/i.test(error.message)
        ? "There must always be at least one recruiting admin."
        : error.message;
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: "Remove failed: " + msg }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
