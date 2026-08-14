import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DataProvider } from "@/lib/data-provider";
import { ConfirmProvider } from "@/lib/confirm";
import { LocalApp } from "@/components/LocalApp";
import { TopBar } from "@/components/TopBar";
import { VersionFooter } from "@/components/VersionFooter";
import { HelpButton } from "@/components/HelpButton";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { DriverGate } from "@/components/DriverGate";
import { AssignmentPing } from "@/components/AssignmentPing";
import type { Profile } from "@/lib/types";

const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Local demo mode: no Supabase, everything runs in the browser.
  if (LOCAL_MODE) return <ConfirmProvider><LocalApp>{children}</LocalApp></ConfirmProvider>;

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
    <ConfirmProvider>
      <DataProvider me={me}>
        <TopBar me={me} />
        {/* Buzzes the phone when a driver is handed a stop. Renders nothing. */}
        <AssignmentPing role={me.role} />
        {/* Drivers don't get in until their phone can actually report. Only
            they are gated: nobody else's work depends on background GPS, and
            the gate is inert outside the APK anyway. */}
        {me.role === "driver" ? (
          <DriverGate><div className="wrap"><ErrorBoundary>{children}</ErrorBoundary></div></DriverGate>
        ) : (
          <div className="wrap"><ErrorBoundary>{children}</ErrorBoundary></div>
        )}
        <HelpButton me={me} />
        <VersionFooter />
      </DataProvider>
    </ConfirmProvider>
  );
}
