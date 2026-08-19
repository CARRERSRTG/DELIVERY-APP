"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TABS, ROLE_INFO } from "@/lib/recruiting/constants";
import { useData } from "@/lib/recruiting-data-provider";
import { usePrefs } from "@/lib/prefs";
import { GlobalSearch } from "@/components/recruiting/GlobalSearch";
import { avatarColor, initials } from "@/lib/recruiting/utils";
import type { Profile } from "@/lib/recruiting/types";

const TAB_ES: Record<string, string> = {
  today: "🏠 Hoy", candidates: "👥 Candidatos", board: "🗂 Tablero", outcomes: "🤝 Resultados", questions: "❓ Preguntas",
  metrics: "📊 Métricas", calendar: "📅 Calendario", settings: "⚙️ Ajustes", users: "🛡 Usuarios",
};
const ROLE_ES: Record<string, string> = { admin: "Admin", manager: "Gerente", recruiter: "Reclutador" };

export function TopBar({ me }: { me: Profile }) {
  const pathname = usePathname();
  const { settings, recruiters } = useData();
  const { lang, setLang, t } = usePrefs();
  const role = ROLE_INFO[me.role];
  const avatar = recruiters.find((r) => r.id === me.id)?.avatar_url ?? me.avatar_url ?? null;

  return (
    <div className="topbar">
      <h1>{settings.app_name || "RECRUIT·HN"}</h1>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <GlobalSearch />
        <div className="tabs">
          {TABS.filter((t) => !t.adminOnly || me.role === "admin").map((t) => {
            {/* "/recruiting" (candidates) needs an exact match — a plain
                startsWith would also light it up on /recruiting/board etc. */}
            const active = t.href === "/recruiting" ? pathname === "/recruiting" : pathname.startsWith(t.href);
            return (
              <Link key={t.id} href={t.href} className={"tab " + (active ? "active" : "")}>
                {lang === "es" ? TAB_ES[t.id] ?? t.label : t.label}
              </Link>
            );
          })}
        </div>
        <span style={{ fontSize: 12, opacity: 0.8, display: "inline-flex", alignItems: "center", gap: 6 }}>
          {avatar ? (
            <span className="avatar" style={{ width: 24, height: 24, backgroundImage: `url(${avatar})` }} />
          ) : (
            <span className="avatar" style={{ width: 24, height: 24, fontSize: 10, background: avatarColor(me.full_name || "?") }}>{initials(me.full_name || "?")}</span>
          )}
          {me.full_name}
          {role && <span className="sema" style={{ marginLeft: 6, background: role.color + "33", color: "#fff" }}>{lang === "es" ? ROLE_ES[me.role] : role.label}</span>}
        </span>
        <button
          className="tab"
          onClick={() => setLang(lang === "es" ? "en" : "es")}
          style={{ background: "rgba(255,255,255,.1)" }}
          title={t("Switch to Spanish", "Cambiar a inglés")}
        >
          {lang === "es" ? "🇬🇧 EN" : "🇪🇸 ES"}
        </button>
        <form action="/auth/signout" method="post">
          <button
            className="tab"
            type="submit"
            style={{ background: "rgba(255,255,255,.1)" }}
          >
            {t("Sign out", "Salir")}
          </button>
        </form>
      </div>
    </div>
  );
}
