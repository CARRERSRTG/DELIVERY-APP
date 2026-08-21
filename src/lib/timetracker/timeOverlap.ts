// Overlap logic for "Add time" manual requests (D-086), Upwork-style: once a
// start time is picked, only end times up to the next already-occupied block
// are selectable — not just individually-disabled options, since a start and
// an end can each be free on their own while the RANGE between them still
// swallows an occupied block whole. Pure and framework-free so it's directly
// testable; the dropdown components just render what this computes.

export const STEP_MIN = 10;
export const DAY_MIN = 24 * 60;

/** A busy span, in minutes since midnight. Half-open: [startMin, endMin). */
export interface OccupiedRange {
  startMin: number;
  endMin: number;
}

export interface TimeOption {
  min: number;
  label: string;
  disabled: boolean;
}

export function mmhh(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Half-open interval overlap — touching edges (one ends exactly where the
 * other starts) is NOT an overlap, so back-to-back entries are allowed. */
export function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/** Any occupied span counts against every step it touches, even if the span
 * itself isn't aligned to `stepMin` (a real tracked session rarely starts on
 * a clean 10-minute mark). */
export function isSlotOccupied(slotMin: number, occupied: OccupiedRange[], stepMin: number = STEP_MIN): boolean {
  const slotEnd = slotMin + stepMin;
  return occupied.some((r) => rangesOverlap(slotMin, slotEnd, r.startMin, r.endMin));
}

/** Start-time dropdown options for the whole day, occupied slots disabled
 * (shown, not hidden) so the reason is visible. */
export function startOptions(occupied: OccupiedRange[], stepMin: number = STEP_MIN): TimeOption[] {
  const opts: TimeOption[] = [];
  for (let m = 0; m < DAY_MIN; m += stepMin) {
    opts.push({ min: m, label: mmhh(m), disabled: isSlotOccupied(m, occupied, stepMin) });
  }
  return opts;
}

/** The latest minute a range starting at `startMin` may end at before it
 * would swallow an occupied block — the start of the next occupied block at
 * or after `startMin`, or end-of-day if nothing follows. This is the actual
 * "range crosses a block" guarantee; it does not depend on end options being
 * individually disabled. */
export function maxEndAfter(startMin: number, occupied: OccupiedRange[]): number {
  let max = DAY_MIN;
  for (const r of occupied) {
    if (r.startMin >= startMin && r.startMin < max) max = r.startMin;
  }
  return max;
}

/** End-time dropdown options for a given start: every step after `startMin`
 * up to end-of-day, disabled once past `maxEndAfter(startMin, occupied)`.
 * `DAY_MIN` itself (24:00, end of day) is always included as the last
 * option. */
export function endOptions(startMin: number, occupied: OccupiedRange[], stepMin: number = STEP_MIN): TimeOption[] {
  const cap = maxEndAfter(startMin, occupied);
  const opts: TimeOption[] = [];
  for (let m = startMin + stepMin; m <= DAY_MIN; m += stepMin) {
    opts.push({ min: m, label: m === DAY_MIN ? "24:00" : mmhh(m), disabled: m > cap });
  }
  return opts;
}

/** The real guarantee, independent of whatever the dropdowns showed at
 * selection time — re-check the whole requested range against every
 * occupied block. Used on submit and again when a manager accepts. */
export function rangeOverlapsAny(startMin: number, endMin: number, occupied: OccupiedRange[]): boolean {
  return occupied.some((r) => rangesOverlap(startMin, endMin, r.startMin, r.endMin));
}
