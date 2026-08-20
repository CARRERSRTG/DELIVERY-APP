import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// The hub's own auth boundary — the one thing every page under /home
// genuinely shares. Profile fetching is NOT centralized here: Next can't
// inject props from a layout into `children`, so each page/nested-layout
// that needs `me` fetches its own copy, same as (app)/layout.tsx and
// recruiting/(recruiting)/layout.tsx already do independently of each other
// (D-052) — this is the third instance of that pattern, not a new one.
export default async function HomeLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <>{children}</>;
}
