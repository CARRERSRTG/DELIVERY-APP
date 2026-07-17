import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DataProvider } from "@/lib/data-provider";
import { LocalApp } from "@/components/LocalApp";
import { TopBar } from "@/components/TopBar";
import { VersionFooter } from "@/components/VersionFooter";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import type { Profile } from "@/lib/types";

const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Local demo mode: no Supabase, everything runs in the browser.
  if (LOCAL_MODE) return <LocalApp>{children}</LocalApp>;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  const me: Profile = profile ?? { id: user.id, full_name: user.email ?? "Me", role: "sales" };

  return (
    <DataProvider me={me}>
      <TopBar me={me} />
      <div className="wrap"><ErrorBoundary>{children}</ErrorBoundary></div>
      <VersionFooter />
    </DataProvider>
  );
}
