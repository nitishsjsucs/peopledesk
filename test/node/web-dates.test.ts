// Whole-day arithmetic for the SPA (src/web/lib/dates.ts): UTC date parts, never a negative phrase.
import { describe, expect, it } from "vitest";
import { dayOf, daysBetween, plural, relativeDays } from "../../src/web/lib/dates.ts";

describe("web date helpers", () => {
  it("counts whole days between dates and timestamps on their UTC date", () => {
    expect(daysBetween("2026-09-06", "2026-10-01")).toBe(25);
    expect(daysBetween("2026-10-01", "2026-09-06")).toBe(-25);
    expect(daysBetween("2026-10-01", "2027-03-01")).toBe(151);
    expect(daysBetween("2026-10-01", "2026-10-31T16:00:00.000Z")).toBe(30);
    expect(daysBetween("2026-10-01T23:59:00.000Z", "2026-10-02T00:01:00.000Z")).toBe(1);
    expect(dayOf("2026-10-31T16:00:00.000Z")).toBe("2026-10-31");
  });

  it("says today, in N days or N days ago, never a negative number", () => {
    expect(relativeDays("2026-10-01", "2026-10-01")).toBe("today");
    expect(relativeDays("2026-10-02", "2026-10-01")).toBe("in 1 day");
    expect(relativeDays("2026-10-22T15:00:00.000Z", "2026-10-01")).toBe("in 21 days");
    expect(relativeDays("2026-09-30", "2026-10-01")).toBe("1 day ago");
    expect(relativeDays("2026-03-22T09:00:00.000Z", "2026-10-01")).toBe("193 days ago");
    expect(plural(1, "person", "people")).toBe("1 person");
    expect(plural(3, "ticket")).toBe("3 tickets");
  });
});
