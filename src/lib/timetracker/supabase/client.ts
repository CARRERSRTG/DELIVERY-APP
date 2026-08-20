"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Supabase client for use in Client Components (browser).
 * Defaults every .from() call to the `timetracker` schema (see D-064) — the
 * shared `profiles` table lives in `public` and needs `.schema('public')`
 * per call where it's queried; storage calls are unaffected either way.
 * Mirrors src/lib/recruiting/supabase/client.ts exactly. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { db: { schema: "timetracker" } },
  );
}
