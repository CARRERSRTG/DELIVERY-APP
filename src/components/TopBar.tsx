"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TABS, ROLE_INFO, hasCap, roleLabel } from "@/lib/constants";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { avatarColor, initials } from "@/lib/utils";
import { NotificationBell } from "@/components/NotificationBell";
import { OfflineBanner } from "@/components/OfflineBanner";
import type { Profile } from "@/lib/types";

export function TopBar({ me }: { me: Profile }) {
  const pathname = usePathname();
  const { settings } = useData();
  const { lang, theme, toggleLang, toggleTheme, t } = usePrefs();
  const role = ROLE_INFO[me.role];

  return (
    <>
    <OfflineBanner />
    <div className="topbar">
      <h1>{settings.app_name || "RDZ·DELIVERIES"}</h1>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div className="tabs">
          {TABS.filter((tb) =>
            // Visible by role, or unlocked by a capability an admin granted this person.
            !tb.roles || tb.roles.includes(me.role) || (tb.cap ? hasCap(me, tb.cap) : false),
          ).map((tb) => {
            // Match the exact route or a sub-route — never a prefix of another
            // tab (e.g. "/accounts" must not light up the "/account" tab).
            const active = tb.href === "/"
              ? pathname === "/"
              : pathname === tb.href || pathname.startsWith(tb.href + "/");
            return (
              <Link key={tb.id} href={tb.href} className={"tab " + (active ? "active" : "")}>
                {lang === "es" ? tb.label_es : tb.label}
              </Link>
            );
          })}
        </div>
        <button className="tab" style={{ background: "rgba(255,255,255,.1)" }}
          onClick={toggleLang} title={t("Switch to Spanish", "Cambiar a inglés")}>
          {lang === "es" ? "🇬🇧 EN" : "🇪🇸 ES"}
        </button>
        <button className="tab" style={{ background: "rgba(255,255,255,.1)" }}
          onClick={toggleTheme} title={t("Toggle dark mode", "Alternar modo oscuro")}>
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
        <NotificationBell />
        <span style={{ fontSize: 12, opacity: 0.9, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span className="avatar sm" style={{ background: avatarColor(me.full_name || "?") }}>
            {initials(me.full_name || "?")}
          </span>
          {me.full_name}
          {role && (
            <span className="sema" style={{ marginLeft: 4, background: role.color, color: "#fff" }}>
              {roleLabel(me.role, lang)}
            </span>
          )}
        </span>
        <form action="/auth/signout" method="post">
          <button className="tab" type="submit" style={{ background: "rgba(255,255,255,.1)" }}>
            {t("Sign out", "Salir")}
          </button>
        </form>
      </div>
    </div>
    </>
  );
}
