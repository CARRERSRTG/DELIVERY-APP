"use client";

import Link from "next/link";
import { usePrefs } from "@/lib/prefs";
import { VersionFooter } from "@/components/VersionFooter";
import { MODULES, type ModuleInfo } from "@/lib/constants";
import type { Profile } from "@/lib/types";

// "Deliveries" itself is implicit for everyone (never in module_access, see
// landingRoute in constants.ts) so it isn't part of the shared MODULES list —
// it's prepended here, the one place that draws the full picker.
const DELIVERIES_CARD: ModuleInfo = {
  key: "deliveries",
  href: "/",
  emoji: "📦",
  label_en: "Deliveries",
  label_es: "Entregas",
  desc_en: "Orders, routes and drivers",
  desc_es: "Órdenes, rutas y choferes",
};

/** Only reached by someone with 2+ modules — see src/app/home/page.tsx. */
export function HomeSelector({ me }: { me: Profile }) {
  const { lang, t } = usePrefs();
  const available = [DELIVERIES_CARD, ...MODULES.filter((m) => me.module_access?.includes(m.key))];

  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ maxWidth: 480 }}>
        <h1>
          {t("Hi, ", "Hola, ")}
          {me.full_name}
        </h1>
        <p style={{ color: "var(--ink-soft)", marginBottom: 20 }}>
          {t("Which one do you want to open?", "¿Cuál quieres abrir?")}
        </p>
        <div className="module-pick-grid">
          {available.map((m) => (
            <Link key={m.key} href={m.href} className="module-pick-card">
              <span className="module-pick-emoji">{m.emoji}</span>
              <span className="module-pick-label">{lang === "es" ? m.label_es : m.label_en}</span>
              <span className="module-pick-desc">{lang === "es" ? m.desc_es : m.desc_en}</span>
            </Link>
          ))}
        </div>
      </div>
      <VersionFooter fixed />
    </div>
  );
}
