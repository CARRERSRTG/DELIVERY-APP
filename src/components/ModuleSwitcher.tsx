"use client";

import { useState } from "react";
import Link from "next/link";
import { usePrefs } from "@/lib/prefs";
import { accessibleModules, roleHome } from "@/lib/constants";
import type { UserRole } from "@/lib/types";

// ============================================================
// Two ways to move between modules once you're inside one (D-054/D-055):
// jump straight to the other module, or step back to /home to pick from
// there. Same gate for both — neither exists for a 1-module user, and the
// driver exception is absolute regardless of module_access.
//
// Pure presentation — no hook from either DataProvider (deliveries' or
// recruiting's). Both TopBars mount this the same way, passing plain props
// built from whatever `me`/`profile` shape each already has. That's what
// lets one component live in both route groups without pulling in anything
// D-052 deliberately kept out of recruiting (no GPS tracking, no deliveries
// realtime channels) — a component with no data of its own can't leak either.
//
// `deliveriesRole` is named that on purpose, never `role`: inside recruiting's
// own TopBar, `me.role` means recruiting_role (admin|manager|recruiter) — the
// same name collision that caused two of D-052's three bugs. This component
// only ever needs the DELIVERIES role, because that's the only thing that
// decides the driver exception and where "back to Deliveries" lands.
// ============================================================

interface ModuleSwitcherProps {
  /** Which module this TopBar belongs to — never appears in its own menu. */
  current: string;
  deliveriesRole: UserRole;
  moduleAccess: string[] | null | undefined;
}

export function ModuleSwitcher({ current, deliveriesRole, moduleAccess }: ModuleSwitcherProps) {
  const { lang, t } = usePrefs();
  const [open, setOpen] = useState(false);

  const modules = accessibleModules(moduleAccess);
  // Same hard exception as landingRoute() (D-051) — a driver never sees this,
  // independent of whatever module_access happens to hold. Below 2 modules
  // there's nothing to switch to, so nothing renders at all (not hidden).
  if (deliveriesRole === "driver" || modules.length < 2) return null;

  const others = modules.filter((m) => m.key !== current);
  const hrefFor = (key: string, fallback: string) => (key === "deliveries" ? roleHome(deliveriesRole) : fallback);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0 }}>
      {/* Back to the hub — only makes sense here: for a 1-module person
          /home just redirects them right back out via landingRoute(), so
          the button never renders for them in the first place. */}
      <Link
        href="/home"
        className="tab"
        aria-label={t("Back to module picker", "Volver al selector de módulos")}
        title={t("Back to module picker", "Volver al selector de módulos")}
      >
        ⌂
      </Link>

      <div style={{ position: "relative" }}>
        <button
          className="tab"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t("Switch module", "Cambiar de módulo")}
          title={t("Switch module", "Cambiar de módulo")}
        >
          ⇄
        </button>
        {open && (
          <>
            <div style={{ position: "fixed", inset: 0, zIndex: 70 }} onClick={() => setOpen(false)} />
            <div className="col-menu" style={{ zIndex: 71, minWidth: 200, right: 0, left: "auto" }} role="menu">
              {others.map((m) => (
                <Link
                  key={m.key}
                  href={hrefFor(m.key, m.href)}
                  role="menuitem"
                  className="col-opt"
                  style={{ textDecoration: "none" }}
                  onClick={() => setOpen(false)}
                >
                  {m.emoji} {lang === "es" ? m.label_es : m.label_en}
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
