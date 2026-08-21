"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

// ============================================================
// UI preferences: language (EN/ES) + theme (light/dark).
// Persisted to localStorage, applied to <html> via data-theme + lang.
// Independent of the data layer, so it works in both local and Supabase modes.
// ============================================================

export type Lang = "en" | "es";
export type Theme = "light" | "dark";

interface Prefs {
  lang: Lang;
  theme: Theme;
  setLang: (l: Lang) => void;
  setTheme: (t: Theme) => void;
  toggleLang: () => void;
  toggleTheme: () => void;
  /** Pick the string for the current language. */
  t: (en: string, es: string) => string;
}

const Ctx = createContext<Prefs | null>(null);
const KEY = "rtg_prefs";

export function usePrefs(): Prefs {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePrefs must be used within PrefsProvider");
  return ctx;
}

// The timetracker desktop shell (window.ttDesktop) has no explicit
// preference the first time it ever runs — default it to dark (D-080),
// matching layout.tsx's inline pre-paint script. Everyone else still
// defaults to light, unchanged. Read once, lazily, so this only ever
// matters for the very first render before localStorage is checked below.
function defaultTheme(): Theme {
  return typeof window !== "undefined" && window.ttDesktop?.isDesktop ? "dark" : "light";
}

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");
  const [theme, setThemeState] = useState<Theme>(defaultTheme);

  // Load saved prefs on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<Prefs>;
        if (p.lang === "en" || p.lang === "es") setLangState(p.lang);
        if (p.theme === "light" || p.theme === "dark") setThemeState(p.theme);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Apply + persist whenever they change.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.setAttribute("lang", lang);
    try {
      localStorage.setItem(KEY, JSON.stringify({ lang, theme }));
    } catch {
      /* ignore */
    }
  }, [lang, theme]);

  const setLang = useCallback((l: Lang) => setLangState(l), []);
  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggleLang = useCallback(() => setLangState((l) => (l === "en" ? "es" : "en")), []);
  const toggleTheme = useCallback(() => setThemeState((t) => (t === "light" ? "dark" : "light")), []);
  const t = useCallback((en: string, es: string) => (lang === "es" ? es : en), [lang]);

  return (
    <Ctx.Provider value={{ lang, theme, setLang, setTheme, toggleLang, toggleTheme, t }}>
      {children}
    </Ctx.Provider>
  );
}
