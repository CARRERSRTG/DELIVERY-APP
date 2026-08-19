"use client";

import Link from "next/link";
import { usePrefs } from "@/lib/prefs";
import { VersionFooter } from "@/components/VersionFooter";
import { accessibleModules, roleHome } from "@/lib/constants";
import type { Profile } from "@/lib/types";

/** Only reached by someone with 2+ modules — see src/app/home/page.tsx. */
export function HomeSelector({ me }: { me: Profile }) {
  const { lang, t } = usePrefs();
  const available = accessibleModules(me.module_access);
  // The deliveries card's own href is a placeholder ("/") — it's the same
  // ModuleInfo entry used by the app switcher and everywhere else, but where
  // deliveries actually lands depends on the person's role (warehouse -> its
  // own queue, logistics -> routes, not the Orders board everyone else gets).
  const hrefFor = (key: string, fallback: string) => (key === "deliveries" ? roleHome(me.role) : fallback);

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
            <Link key={m.key} href={hrefFor(m.key, m.href)} className="module-pick-card">
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
