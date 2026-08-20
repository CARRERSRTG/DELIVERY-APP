"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { TABS } from "@/lib/timetracker/constants";
import { useData } from "@/lib/timetracker-data-provider";
import { getLang, setLang, useT } from "@/lib/timetracker/i18n";
import { ModuleSwitcher } from "@/components/ModuleSwitcher";
import type { UserRole } from "@/lib/types";

// deliveriesRole/moduleAccess threaded through separately from `me`
// (timetracker's own Employee type, where `role` means timetracker_role) —
// same pattern recruiting/TopBar.tsx already uses, same reason: `me.role`
// inside this module must never collide with the deliveries role (D-052's
// #1/#2 bug class).
export function TopBar({ deliveriesRole, moduleAccess }: { deliveriesRole: UserRole; moduleAccess: string[] | null | undefined }) {
  const pathname = usePathname();
  const { me, settings } = useData();
  const t = useT();
  // useT()'s own subscription already re-renders this component on any
  // setLang() call; this local state just remembers which icon to show.
  const [lang, setLangState] = useState(getLang());

  return (
    <div className="topbar">
      <div className="brand">{settings.appName || "TimeTracker"}</div>
      <div className="row" style={{ alignItems: "center", flexWrap: "wrap" }}>
        <div className="tabs">
          {TABS.map((tb) => {
            const active = tb.href === "/timetracker" ? pathname === "/timetracker" : pathname.startsWith(tb.href);
            return (
              <Link key={tb.id} href={tb.href} className={active ? "active" : ""}>
                {tb.label}
              </Link>
            );
          })}
        </div>
        <ModuleSwitcher current="timetracker" deliveriesRole={deliveriesRole} moduleAccess={moduleAccess} />
        <span className="small muted nowrap">{me.fullName}</span>
        <span className={"chip " + (me.role === "admin" ? "tag-admin" : "tag-emp")}>
          {me.role === "admin" ? t("shell.manager") : t("shell.employee")}
        </span>
        <button
          className="btn-ghost btn-sm"
          onClick={() => { const next = lang === "es" ? "en" : "es"; setLang(next); setLangState(next); }}
          title={t("lang.label")}
        >
          {lang === "es" ? "🇬🇧 EN" : "🇪🇸 ES"}
        </button>
        <form action="/auth/signout" method="post">
          <button className="btn-ghost btn-sm" type="submit">{t("shell.signOut")}</button>
        </form>
      </div>
    </div>
  );
}
