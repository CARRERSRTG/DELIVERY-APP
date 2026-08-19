"use client";

import Link from "next/link";
import { usePrefs } from "@/lib/prefs";
import { VersionFooter } from "@/components/VersionFooter";
import type { Profile } from "@/lib/types";

const MODULES: { key: string; href: string; emoji: string; label_en: string; label_es: string; desc_en: string; desc_es: string }[] = [
  {
    key: "deliveries",
    href: "/",
    emoji: "📦",
    label_en: "Deliveries",
    label_es: "Entregas",
    desc_en: "Orders, routes and drivers",
    desc_es: "Órdenes, rutas y choferes",
  },
  {
    key: "recruiting",
    href: "/recruiting",
    emoji: "🧑‍💼",
    label_en: "Recruiting",
    label_es: "Reclutamiento",
    desc_en: "Candidates and interviews",
    desc_es: "Candidatos y entrevistas",
  },
];

/** Only reached by someone with 2+ modules — see src/app/home/page.tsx. */
export function HomeSelector({ me }: { me: Profile }) {
  const { lang, t } = usePrefs();
  const available = MODULES.filter((m) => m.key === "deliveries" || me.module_access?.includes(m.key));

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
