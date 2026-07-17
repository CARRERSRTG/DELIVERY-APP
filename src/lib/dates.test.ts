import { describe, it, expect, vi, afterEach } from "vitest";
import { localISO, todayISO, isToday, isOverdue } from "@/lib/utils";
import { mkDelivery } from "@/lib/__fixtures";

// Regression cover for a real bug: dates were derived with toISOString(), which
// converts to UTC. West of Greenwich that rolls the calendar day forward late in
// the evening — 7pm CDT is already "tomorrow" in UTC — so "today" and overdue
// checks silently disagreed with the user's actual date after ~7pm.

afterEach(() => vi.useRealTimers());

describe("localISO", () => {
  it("uses local calendar parts, not UTC", () => {
    // 19:30 on 15 Jul, local. In UTC (behind Greenwich) this is already 16 Jul.
    const d = new Date(2026, 6, 15, 19, 30, 0);
    expect(localISO(d)).toBe("2026-07-15");
  });

  it("zero-pads month and day", () => {
    expect(localISO(new Date(2026, 0, 5, 12, 0, 0))).toBe("2026-01-05");
  });

  it("holds at 23:59 local — the worst case for a UTC shift", () => {
    expect(localISO(new Date(2026, 6, 15, 23, 59, 59))).toBe("2026-07-15");
  });

  it("holds at 00:01 local", () => {
    expect(localISO(new Date(2026, 6, 15, 0, 1, 0))).toBe("2026-07-15");
  });
});

describe("todayISO at a late-evening clock", () => {
  it("still reports today, not tomorrow", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 15, 19, 30, 0));
    expect(todayISO()).toBe("2026-07-15");
  });
});

describe("isToday / isOverdue agree with the local date late in the day", () => {
  it("treats today's order as today at 19:30", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 15, 19, 30, 0));
    expect(isToday("2026-07-15")).toBe(true);
    expect(isOverdue(mkDelivery({ stage: "ready", delivery_date: "2026-07-15" }))).toBe(false);
  });

  it("marks yesterday's undelivered order overdue at 19:30", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 15, 19, 30, 0));
    expect(isOverdue(mkDelivery({ stage: "ready", delivery_date: "2026-07-14" }))).toBe(true);
  });

  it("never marks a delivered or canceled order overdue", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 15, 19, 30, 0));
    expect(isOverdue(mkDelivery({ stage: "delivered", delivery_date: "2026-07-01" }))).toBe(false);
    expect(isOverdue(mkDelivery({ stage: "canceled", delivery_date: "2026-07-01" }))).toBe(false);
  });
});
