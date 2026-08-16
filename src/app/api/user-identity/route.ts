import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailForUsername, isSyntheticEmail, isValidUsername, normalizeUsername } from "@/lib/username";

// ============================================================
// Change how a person signs in: their username, their email, or both.
//
// The two are not independent. A user with no email signs in at an address
// DERIVED from their username, so renaming them without moving that address
// would lock them out of an account that still looks fine in the list. Both
// moves happen here, together, or neither does.
//
// Admins only, and never touches passwords — this changes who someone is, not
// how they prove it.
// ============================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read how someone signs in today.
 *
 * The email lives in auth, not in `profiles`, so the office had no way to see
 * what address an account actually uses — only to overwrite it blind.
 */
export async function GET(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "Missing user." }, { status: 400 });

  const admin = createAdminClient();
  const { data } = await admin.auth.admin.getUserById(id);
  if (!data?.user) return NextResponse.json({ error: "No such user." }, { status: 404 });

  const email = data.user.email ?? "";
  const synthetic = isSyntheticEmail(email);
  return NextResponse.json({
    // A derived address is machinery, not a contact. Reporting it as this
    // person's email would put it on a customer form one day.
    email: synthetic ? "" : email,
    synthetic,
    can_reset_own_password: !synthetic,
    last_sign_in_at: data.user.last_sign_in_at ?? null,
  });
}

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "Only admins can change sign-in details." }, { status: 403 });
  }

  let body: { id?: string; username?: string | null; email?: string | null };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid body." }, { status: 400 }); }

  const id = (body.id || "").trim();
  if (!id) return NextResponse.json({ error: "Missing user." }, { status: 400 });

  const admin = createAdminClient();
  const { data: target, error: findErr } = await admin.auth.admin.getUserById(id);
  if (findErr || !target?.user) return NextResponse.json({ error: "No such user." }, { status: 404 });
  const currentEmail = target.user.email ?? "";

  // ---- Username -----------------------------------------------------------
  const wantsUsername = body.username !== undefined;
  const username = body.username === null ? null : normalizeUsername(body.username);
  if (wantsUsername && username !== null && !isValidUsername(username)) {
    return NextResponse.json({
      error: "Username must be 3–30 characters: letters, numbers, dot, dash or underscore, starting with a letter or number.",
    }, { status: 400 });
  }

  // ---- Email --------------------------------------------------------------
  const wantsEmail = body.email !== undefined && body.email !== null && body.email.trim() !== "";
  const email = wantsEmail ? body.email!.trim().toLowerCase() : "";
  if (wantsEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  // A real email always wins: giving someone a proper address is also giving
  // them the ability to reset their own password, which a derived one can
  // never do. Otherwise, a username change moves the derived address with it —
  // but only when the address WAS derived. Rewriting a real email because
  // someone edited a username would be silent account theft.
  let nextEmail: string | null = null;
  if (wantsEmail) nextEmail = email;
  else if (wantsUsername && username && isSyntheticEmail(currentEmail)) nextEmail = emailForUsername(username);

  if (nextEmail && nextEmail !== currentEmail.toLowerCase()) {
    const { error } = await admin.auth.admin.updateUserById(id, { email: nextEmail, email_confirm: true });
    if (error) {
      const taken = /already|registered|exists/i.test(error.message);
      return NextResponse.json(
        { error: taken ? "That email or username is already taken." : error.message },
        { status: taken ? 409 : 500 },
      );
    }
  }

  if (wantsUsername) {
    const { error } = await admin.from("profiles").update({ username }).eq("id", id);
    if (error) {
      const taken = /duplicate|unique/i.test(error.message);
      return NextResponse.json(
        { error: taken ? "That username is already taken." : error.message },
        { status: taken ? 409 : 500 },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    email: nextEmail ?? currentEmail,
    username: wantsUsername ? username : undefined,
    // The office needs to know when a person has no way back in on their own.
    can_reset_own_password: !isSyntheticEmail(nextEmail ?? currentEmail),
  });
}
