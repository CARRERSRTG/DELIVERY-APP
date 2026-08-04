import { describe, it, expect } from "vitest";
import { isoWeek, isoWeekYear, weeksInIsoYear, codeBand, nextOrderCode, codeLabel } from "@/lib/order-code";

// Local noon so the date's local y/m/d (what isoWeek reads) is exactly y/m/d.
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12);

describe("ISO week helpers", () => {
  it("2026 is a 53-week ISO year; 2025 has 52", () => {
    expect(weeksInIsoYear(2026)).toBe(53);
    expect(weeksInIsoYear(2025)).toBe(52);
  });
  it("Jan 1 2026 is ISO week 1 of 2026", () => {
    expect(isoWeek(day(2026, 1, 1))).toBe(1);
    expect(isoWeekYear(day(2026, 1, 1))).toBe(2026);
  });
});

describe("codeBand", () => {
  it("2026 week 1 (odd) → FA / 100", () => {
    const b = codeBand(day(2026, 1, 1));
    expect(b.prefix).toBe("FA");
    expect(b.base).toBe(100);
    expect(b.ceil).toBe(500);
  });
  it("2026 week 2 (even) → FA / 500", () => {
    // Jan 5 2026 is a Monday → ISO week 2.
    const b = codeBand(day(2026, 1, 5));
    expect(b.week).toBe(2);
    expect(b.prefix).toBe("FA");
    expect(b.base).toBe(500);
  });
  it("2026 week 3 → FB / 100, week 4 → FB / 500", () => {
    expect(codeBand(day(2026, 1, 12)).prefix).toBe("FB");
    expect(codeBand(day(2026, 1, 12)).base).toBe(100);
    expect(codeBand(day(2026, 1, 19)).base).toBe(500);
  });
  it("year letter follows year−2020 (2027 = G)", () => {
    expect(codeBand(day(2027, 1, 4)).prefix[0]).toBe("G");
  });
});

describe("53-week year — Z holds weeks 51/52/53 at 100/400/700", () => {
  it("2026 weeks 51/52/53 map to FZ 100 / 400 / 700", () => {
    // 2026 week 51 ≈ Dec 14, 52 ≈ Dec 21, 53 ≈ Dec 28.
    const w51 = codeBand(day(2026, 12, 14));
    const w52 = codeBand(day(2026, 12, 21));
    const w53 = codeBand(day(2026, 12, 28));
    expect([w51.week, w52.week, w53.week]).toEqual([51, 52, 53]);
    expect(w51.prefix).toBe("FZ"); expect(w51.base).toBe(100); expect(w51.ceil).toBe(400);
    expect(w52.prefix).toBe("FZ"); expect(w52.base).toBe(400); expect(w52.ceil).toBe(700);
    expect(w53.prefix).toBe("FZ"); expect(w53.base).toBe(700); expect(w53.ceil).toBe(1000);
  });
});

describe("nextOrderCode", () => {
  const d = day(2026, 1, 1); // FA, base 100
  it("first order in a band is the base", () => {
    expect(nextOrderCode([], d)).toBe("FA100");
  });
  it("increments within the band, ignoring other bands/prefixes", () => {
    expect(nextOrderCode(["FA100", "FA101", "FB100", "FA500"], d)).toBe("FA102");
  });
  it("even week counts up from 500 independently", () => {
    const even = day(2026, 1, 5);
    expect(nextOrderCode(["FA100", "FA101"], even)).toBe("FA500");
    expect(nextOrderCode(["FA500", "FA501"], even)).toBe("FA502");
  });
});

describe("codeLabel", () => {
  it("uses the code, appending any split suffix", () => {
    expect(codeLabel({ order_code: "FA100" })).toBe("FA100");
    expect(codeLabel({ order_code: "FA100", order_suffix: "b" })).toBe("FA100b");
  });
  it("falls back to the number if no code yet", () => {
    expect(codeLabel({ order_no: 1042 })).toBe("1042");
  });
});
