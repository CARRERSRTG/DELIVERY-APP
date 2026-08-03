"use client";

// ============================================================
// Tiny inline-SVG sparkline — no chart library, no external requests. Plots a
// series (nulls are gaps), scales to its own min/max, and marks the last known
// point. Purely presentational.
// ============================================================

export function Sparkline({
  values, width = 160, height = 36, color = "var(--accent)", strokeWidth = 1.75,
}: {
  values: (number | null)[];
  width?: number;
  height?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const present = values.filter((v): v is number => v != null);
  if (present.length === 0) return <span className="hint">—</span>;

  const min = Math.min(...present);
  const max = Math.max(...present);
  const range = max - min || 1;
  const n = values.length;
  const pad = 3;
  const x = (i: number) => (n <= 1 ? width / 2 : pad + (i / (n - 1)) * (width - pad * 2));
  const y = (v: number) => height - pad - ((v - min) / range) * (height - pad * 2);

  // Path across the non-null points (moveTo on the first, lineTo after).
  let dPath = "";
  let lastIdx = -1;
  values.forEach((v, i) => {
    if (v == null) return;
    dPath += `${dPath === "" ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
    lastIdx = i;
  });

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-hidden style={{ display: "block" }}>
      <path d={dPath.trim()} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
      {lastIdx >= 0 && <circle cx={x(lastIdx)} cy={y(values[lastIdx] as number)} r={2.4} fill={color} />}
    </svg>
  );
}
