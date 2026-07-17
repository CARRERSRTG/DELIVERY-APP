import type { Delivery } from "@/lib/types";
import { parseWindow } from "@/lib/dispatch";

// ============================================================
// Delivery scheduling rules (capacity + conflict guard).
//
// When a sales rep picks a delivery date + time window, we check it against the
// orders already booked that day (same store) and surface warnings. None of
// these hard-block: the rep is asked "Request anyway?" so an exception is still
// possible — it just can't happen by accident.
//
// Rules:
//   1. Outside working hours (default 0830–1730)
//   2. Exact same window already booked
//   3. Another delivery within a 3-hour range of the requested window
//   4. More than 1 delivery scheduled in the MORNING (before 12:00)
//   5. More than 1 delivery scheduled in the AFTERNOON (12:00 and later)
// ============================================================

/** Working day, in minutes from midnight. 0830 → 1730. */
export const DAY_START = 8 * 60 + 30;   // 08:30
export const DAY_END = 17 * 60 + 30;    // 17:30
export const NOON = 12 * 60;            // 12:00
/** Two deliveries whose windows start within this span are "clustered". */
export const CLUSTER_MINUTES = 3 * 60;  // 3 hours
/** How many deliveries are allowed per half-day before we alert. */
export const HALF_DAY_LIMIT = 1;

export interface ScheduleWarning {
  code: "outside_hours" | "same_window" | "cluster" | "am_overload" | "pm_overload";
  en: string;
  es: string;
}

interface Candidate {
  id?: string;
  store?: string | null;
  delivery_date?: string | null;
  delivery_windows?: string | null;
}

const isLive = (d: Delivery) => d.stage !== "canceled" && d.stage !== "rejected";

const fmt = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}${String(mins % 60).padStart(2, "0")}`;

/** Orders already booked the same day at the same store (excluding this one). */
export function sameDayOrders(c: Candidate, deliveries: Delivery[]): Delivery[] {
  if (!c.delivery_date) return [];
  return deliveries.filter(
    (d) =>
      d.id !== c.id &&
      isLive(d) &&
      d.delivery_date === c.delivery_date &&
      // Capacity is per store (each branch runs its own trucks). If the draft has
      // no store yet, compare across all of them.
      (!c.store || d.store === c.store),
  );
}

/**
 * Evaluate a proposed delivery slot. Returns every rule it trips (empty = clean).
 */
export function checkSchedule(c: Candidate, deliveries: Delivery[]): ScheduleWarning[] {
  const warnings: ScheduleWarning[] = [];
  const win = parseWindow(c.delivery_windows);
  if (!c.delivery_date || !win) return warnings; // nothing to check yet
  const [start, end] = win;

  // 1 ── outside the working day
  if (start < DAY_START || end > DAY_END) {
    warnings.push({
      code: "outside_hours",
      en: `That window (${c.delivery_windows}) is outside delivery hours ${fmt(DAY_START)}–${fmt(DAY_END)}.`,
      es: `Esa ventana (${c.delivery_windows}) está fuera del horario de entrega ${fmt(DAY_START)}–${fmt(DAY_END)}.`,
    });
  }

  const others = sameDayOrders(c, deliveries);
  const withWindows = others
    .map((d) => ({ d, w: parseWindow(d.delivery_windows) }))
    .filter((x): x is { d: Delivery; w: [number, number] } => x.w !== null);

  // 2 ── the exact same window is already taken
  const exact = withWindows.filter((x) => x.w[0] === start && x.w[1] === end);
  if (exact.length) {
    warnings.push({
      code: "same_window",
      en: `Window ${c.delivery_windows} is already booked by ${exact.map((x) => `#${x.d.order_no}`).join(", ")}.`,
      es: `La ventana ${c.delivery_windows} ya está reservada por ${exact.map((x) => `#${x.d.order_no}`).join(", ")}.`,
    });
  }

  // 3 ── another delivery starts within 3 hours of this one
  const near = withWindows.filter((x) => x.w[0] !== start || x.w[1] !== end).filter((x) => Math.abs(x.w[0] - start) < CLUSTER_MINUTES);
  if (near.length) {
    warnings.push({
      code: "cluster",
      en: `${near.length} other delivery(ies) within 3 hours of this window: ${near.map((x) => `#${x.d.order_no} (${x.d.delivery_windows})`).join(", ")}.`,
      es: `${near.length} entrega(s) dentro de 3 horas de esta ventana: ${near.map((x) => `#${x.d.order_no} (${x.d.delivery_windows})`).join(", ")}.`,
    });
  }

  // 4/5 ── half-day capacity (this order counts toward its own half)
  const amOthers = withWindows.filter((x) => x.w[0] < NOON);
  const pmOthers = withWindows.filter((x) => x.w[0] >= NOON);
  const isAM = start < NOON;
  const amTotal = amOthers.length + (isAM ? 1 : 0);
  const pmTotal = pmOthers.length + (isAM ? 0 : 1);

  if (isAM && amTotal > HALF_DAY_LIMIT) {
    warnings.push({
      code: "am_overload",
      en: `${amTotal} deliveries would be scheduled before 12:00 that day (${amOthers.map((x) => `#${x.d.order_no}`).join(", ")}). Only ${HALF_DAY_LIMIT} is planned for.`,
      es: `Habría ${amTotal} entregas antes de las 12:00 ese día (${amOthers.map((x) => `#${x.d.order_no}`).join(", ")}). Solo se planifica ${HALF_DAY_LIMIT}.`,
    });
  }
  if (!isAM && pmTotal > HALF_DAY_LIMIT) {
    warnings.push({
      code: "pm_overload",
      en: `${pmTotal} deliveries would be scheduled after 12:00 that day (${pmOthers.map((x) => `#${x.d.order_no}`).join(", ")}). Only ${HALF_DAY_LIMIT} is planned for.`,
      es: `Habría ${pmTotal} entregas después de las 12:00 ese día (${pmOthers.map((x) => `#${x.d.order_no}`).join(", ")}). Solo se planifica ${HALF_DAY_LIMIT}.`,
    });
  }

  return warnings;
}
