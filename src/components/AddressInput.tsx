"use client";

import { useEffect, useRef, useState } from "react";

// ============================================================
// Text input with real-time address autocomplete. As the user types (3+ chars),
// it queries /api/geocode (debounced) and shows a dropdown of suggestions.
// Picking one sets the value — which the order form uses to recompute mileage.
// Free-typing still works; suggestions are best-effort and need internet.
// ============================================================

export function AddressInput({
  label,
  value,
  onChange,
  disabled,
  placeholder,
  invalid,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Highlight as a missing required field. */
  invalid?: boolean;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  // Ignore the fetch that a programmatic pick would otherwise trigger.
  const justPicked = useRef(false);

  const text = value ?? "";

  // Debounced lookup whenever the text changes (unless it was just picked).
  useEffect(() => {
    if (disabled) return;
    if (justPicked.current) { justPicked.current = false; return; }
    const q = text.trim();
    if (q.length < 3) { setSuggestions([]); return; }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/geocode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q }),
        });
        const body = await res.json();
        setSuggestions(Array.isArray(body.suggestions) ? body.suggestions : []);
        setOpen(true);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, disabled]);

  // Close the dropdown when clicking away.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const pick = (s: string) => {
    justPicked.current = true;
    onChange(s);
    setSuggestions([]);
    setOpen(false);
  };

  return (
    <div className="field addr-field" ref={wrap}>
      <label>{label}{invalid && <span className="req-star"> *</span>}</label>
      <input
        className={invalid ? "invalid" : ""}
        type="text"
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => suggestions.length && setOpen(true)}
      />
      {loading && <span className="addr-spin" />}
      {open && suggestions.length > 0 && (
        <div className="addr-menu">
          {suggestions.map((s, i) => (
            <button type="button" key={i} className="addr-opt" onClick={() => pick(s)}>
              📍 {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
