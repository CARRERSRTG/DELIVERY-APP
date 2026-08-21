import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppUpdateBanner } from "@/components/AppUpdateBanner";

// The hub's own auth boundary — the one thing every page under /home
// genuinely shares. Profile fetching is NOT centralized here: Next can't
// inject props from a layout into `children`, so each page/nested-layout
// that needs `me` fetches its own copy, same as (app)/layout.tsx and
// recruiting/(recruiting)/layout.tsx already do independently of each other
// (D-052) — this is the third instance of that pattern, not a new one.
//
// AppUpdateBanner is mounted here too (D-063): it was living inside
// deliveries' own TopBar, so nobody outside (app) — the hub, recruiting —
// ever heard that a new deploy was ready. It has no dependency on
// deliveries' DataProvider; /api/version reads the same shared APP_VERSION
// this whole container app deploys as one unit under.
export default async function HomeLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/home");

  return (
    <>
      <AppUpdateBanner />
      {children}
    </>
  );
}
