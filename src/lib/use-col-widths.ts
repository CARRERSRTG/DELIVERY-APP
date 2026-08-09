"use client";

import { useState } from "react";

// Excel-style resizable table columns. Keeps a width per column (persisted per
// table in localStorage) and hands back a mousedown handler for a drag handle
// placed at each header cell's right edge. Pair with a <colgroup> of <col>s and
// a `table-layout: fixed` table (see the .tbl-resize CSS).
export function useColWidths(storageKey: string, defaults: number[]) {
  const [widths, setWidths] = useState<number[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) { const p = JSON.parse(raw); if (Array.isArray(p) && p.length === defaults.length) return p; }
    } catch { /* ignore */ }
    return defaults;
  });

  // Returns a mousedown handler for the resize grip on column `i`.
  const startResize = (i: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const base = widths[i];
    const onMove = (ev: MouseEvent) => {
      setWidths((w) => { const n = [...w]; n[i] = Math.max(16, base + (ev.clientX - startX)); return n; });
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      setWidths((w) => { try { localStorage.setItem(storageKey, JSON.stringify(w)); } catch { /* ignore */ } return w; });
    };
    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const reset = () => {
    setWidths(defaults);
    try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
  };

  return { widths, startResize, reset };
}

// Same idea, but keyed by column KEY instead of index — for tables whose column
// set is dynamic (e.g. the Orders table's user-toggled columns).
export function useColWidthMap(storageKey: string, defaultWidth = 150) {
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try { const raw = localStorage.getItem(storageKey); if (raw) return JSON.parse(raw); } catch { /* ignore */ }
    return {};
  });
  const widthOf = (key: string) => widths[key] ?? defaultWidth;

  const startResize = (key: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const base = widths[key] ?? defaultWidth;
    const onMove = (ev: MouseEvent) => {
      setWidths((w) => ({ ...w, [key]: Math.max(16, base + (ev.clientX - startX)) }));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      setWidths((w) => { try { localStorage.setItem(storageKey, JSON.stringify(w)); } catch { /* ignore */ } return w; });
    };
    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // Double-click a grip to reset just that column to the default width.
  const resetCol = (key: string) => {
    setWidths((w) => { const n = { ...w }; delete n[key]; try { localStorage.setItem(storageKey, JSON.stringify(n)); } catch { /* ignore */ } return n; });
  };

  return { widthOf, startResize, resetCol };
}
