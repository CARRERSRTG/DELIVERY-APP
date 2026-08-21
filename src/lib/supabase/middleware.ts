import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase auth session on every request and guards routes.
 * Unauthenticated users are redirected to /login (except for public paths).
 */
export async function updateSession(request: NextRequest) {
  // Local demo mode: skip all auth — the app has no backend.
  if (process.env.NEXT_PUBLIC_LOCAL_MODE === "true") {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic =
    path.startsWith("/login") || path.startsWith("/auth") || path.startsWith("/_next");

  // Bounced here from a guarded route while signed out — remember it as
  // `next` so signing in can return here instead of always landing on `/`.
  // Matters most for the timetracker desktop shell (D-076): its Electron
  // window has no address bar, so if login always dropped it on deliveries'
  // board, the only way back to Track Time was the module switcher — which
  // defeats the point of a dedicated client (screenshot/activity capture
  // only runs while mounted on /timetracker).
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  if (user && path.startsWith("/login")) {
    const url = request.nextUrl.clone();
    const next = request.nextUrl.searchParams.get("next");
    // Must be a real in-app path, not another hop through /login itself
    // (that would loop) or an absolute URL (open-redirect risk).
    url.pathname = next && next.startsWith("/") && !next.startsWith("/login") ? next : "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
