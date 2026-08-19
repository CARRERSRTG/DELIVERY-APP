"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useData } from "@/lib/recruiting-data-provider";
import { useUI } from "@/components/recruiting/ModalHost";
import { usePrefs } from "@/lib/prefs";
import { stageOf } from "@/lib/recruiting/constants";
import { avatarColor, initials, telClean } from "@/lib/recruiting/utils";

export function GlobalSearch() {
  const { candidates, stages } = useData();
  const { openProfile } = useUI();
  const { t } = usePrefs();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Position the dropdown as a viewport-fixed box clamped to stay on screen,
  // so it can never render off the edge no matter where the top bar wraps.
  const place = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
    setPos({ top: r.bottom + 6, left, width });
  }, []);

  // keep it anchored while open (scroll / resize)
  useEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  // "/" focuses the search from anywhere (ignoring when typing in a field)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // close when clicking outside
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const digits = telClean(s);
    return candidates
      .filter((c) => {
        const hay = (
          c.name +
          " " + c.phone +
          " " + (c.email || "") +
          " " + (c.role || "") +
          " " + c.tags.join(" ") +
          " " + c.extra_phones.join(" ") +
          " " + c.extra_emails.join(" ")
        ).toLowerCase();
        return hay.includes(s) || (digits.length >= 3 && telClean(c.phone).includes(digits));
      })
      .sort((a, b) => Number(b.pinned) - Number(a.pinned))
      .slice(0, 8);
  }, [q, candidates]);

  useEffect(() => setActive(0), [q]);

  const pick = (id: string) => {
    openProfile(id);
    setOpen(false);
    setQ("");
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      pick(results[active].id);
    }
  };

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); place(); }}
        onFocus={() => { setOpen(true); place(); }}
        onKeyDown={onKeyDown}
        placeholder={t("🔍 Search candidates…  ( / )", "🔍 Buscar candidatos…  ( / )")}
        style={{
          width: 240,
          height: 32,
          padding: "0 10px",
          borderRadius: 8,
          border: "1px solid rgba(255,255,255,.25)",
          background: "rgba(255,255,255,.12)",
          color: "#fff",
          fontSize: 13,
        }}
      />
      {open && q.trim() && pos && (
        <div
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            width: pos.width,
            maxHeight: "min(380px, calc(100vh - " + (pos.top + 16) + "px))",
            overflowY: "auto",
            background: "var(--card, #fff)",
            color: "var(--ink, #1a1f2b)",
            borderRadius: 10,
            boxShadow: "0 12px 32px rgba(0,0,0,.24)",
            border: "1px solid rgba(0,0,0,.08)",
            zIndex: 1000,
            padding: 6,
          }}
        >
          {results.length === 0 && (
            <div style={{ padding: 12, fontSize: 13, opacity: 0.7 }}>{t("No matches.", "Sin resultados.")}</div>
          )}
          {results.map((c, i) => {
            const st = stageOf(stages, c.status);
            return (
              <button
                key={c.id}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(c.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 10px",
                  border: "none",
                  borderRadius: 8,
                  background: i === active ? "rgba(37,99,235,.12)" : "transparent",
                  cursor: "pointer",
                }}
              >
                {c.photo ? (
                  <div className="avatar" style={{ backgroundImage: `url(${c.photo})`, width: 30, height: 30, flex: "0 0 30px" }} />
                ) : (
                  <div className="avatar" style={{ background: avatarColor(c.name), width: 30, height: 30, flex: "0 0 30px", fontSize: 12 }}>{initials(c.name)}</div>
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {c.pinned && "📌 "}{c.name}
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.7, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {[c.role, c.phone].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <span className="sema" style={{ flex: "0 0 auto", background: st.color + "22", color: st.color, fontSize: 10 }}>
                  {st.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
