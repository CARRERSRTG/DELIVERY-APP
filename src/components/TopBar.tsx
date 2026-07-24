"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TABS, ROLE_INFO, ROLE_ORDER, extraCaps, roleLabel } from "@/lib/constants";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { avatarColor, initials } from "@/lib/utils";
import { NotificationBell } from "@/components/NotificationBell";
import { OfflineBanner } from "@/components/OfflineBanner";
import { PendingDeadlineWatcher } from "@/components/PendingDeadlineWatcher";
import type { Profile, UserRole } from "@/lib/types";

export function TopBar({ me: propMe }: { me: Profile }) {
  const pathname = usePathname();
  const { settings, me: ctxMe, realRole, viewAs, setViewAs } = useData();
  const { lang, t } = usePrefs();
  // `me` is the EFFECTIVE user — its role follows the admin "view as" preview.
  const me = ctxMe ?? propMe;
  const role = ROLE_INFO[me.role];

  return (
    <>
    <PendingDeadlineWatcher />
    <OfflineBanner />
    <div className="topbar">
      <h1>{settings.app_name || "RDZ·DELIVERIES"}</h1>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div className="tabs">
          {TABS.filter((tb) =>
            // Visible by role, or unlocked by a capability an admin granted
            // this INDIVIDUAL beyond what their role already gives them —
            // NOT just because their role happens to carry that capability
            // (e.g. warehouse has the "deliver" capability so fulfillment
            // actions work, but that alone shouldn't surface the Driver tab).
            !tb.roles || tb.roles.includes(me.role) || (tb.cap ? extraCaps(me).includes(tb.cap) : false),
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
        <NotificationBell />
        {/* Admin sandbox: discreetly preview the app as any role. Only the real
            admin ever sees this, and it never changes their account/role in the DB. */}
        {realRole === "admin" && (
          <label
            title={t("Preview the app as another role (admin only)", "Previsualiza la app como otro rol (solo admin)")}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12,
              background: viewAs ? "rgba(233,161,59,.25)" : "rgba(255,255,255,.1)",
              padding: "5px 9px", borderRadius: 8 }}
          >
            <span aria-hidden>👁</span>
            <select
              value={viewAs ?? "admin"}
              onChange={(e) => setViewAs(e.target.value === "admin" ? null : (e.target.value as UserRole))}
              style={{ width: "auto", background: "transparent", color: "#fff", border: "none",
                padding: 0, fontSize: 12, fontWeight: 600 }}
            >
              {ROLE_ORDER.map((r) => (
                <option key={r} value={r} style={{ color: "#000" }}>
                  {r === "admin" ? t("View as… (me)", "Ver como… (yo)") : roleLabel(r, lang)}
                </option>
              ))}
            </select>
          </label>
        )}
        <span style={{ fontSize: 12, opacity: 0.9, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span className="avatar sm" style={{ background: avatarColor(me.full_name || "?") }}>
            {initials(me.full_name || "?")}
          </span>
          {me.full_name}
          {role && (
            <span className="sema" style={{ marginLeft: 4, background: role.color, color: "#fff" }}>
              {viewAs ? "👁 " : ""}{roleLabel(me.role, lang)}
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
