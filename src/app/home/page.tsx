import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { landingRoute } from "@/lib/constants";
import { HomeSelector } from "@/components/HomeSelector";
import type { Profile } from "@/lib/types";

// The module selector. Reached only by people with 2+ modules (today: just
// whoever has recruiting access on top of deliveries) — everyone else is
// bounced straight to their actual landing route by landingRoute() below,
// the SAME function that decided nobody should have ended up here in the
// first place. A driver typing this URL directly lands here too, and
// landingRoute() sends them to /driver unconditionally — see D-050/D-051.
export default async function HomePage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // A deep-link (e.g. a notification's ?order=<id>) always wins — never trap
  // it behind the selector. Forward it into deliveries, params intact.
  const qs = new URLSearchParams(
    Object.entries(searchParams).flatMap(([k, v]) =>
      v == null ? [] : (Array.isArray(v) ? v : [v]).map((val) => [k, val] as [string, string]),
    ),
  ).toString();
  if (qs) redirect(`/?${qs}`);

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, module_access")
    .eq("id", user.id)
    .maybeSingle();
  const me: Profile = profile ?? { id: user.id, full_name: user.email ?? "Me", role: "sales" };

  const dest = landingRoute(me);
  if (dest !== "/home") redirect(dest);

  return <HomeSelector me={me} />;
}
